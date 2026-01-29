/**
 * Last Sprint Retro – report for the MOST RECENTLY ENDED sprint.
 * GET /retro
 * GET /retro?format=html – email-safe fragment only
 */
const express = require('express');
const moment = require('moment-timezone');
const router = express.Router();
const { debugLog, debugError, TARGET_STATUSES, BOARD_ID, jiraClient, githubClient, config, getTz } = require('./_helpers');
const userCache = require('../utils/user-cache');

/** Return display name or accountId (so we can resolve later). Never cache raw id as name. */
function assigneeDisplay(assignee) {
  if (!assignee) return 'Unassigned';
  userCache.seedFromJiraUser(assignee);
  const name = (assignee.displayName || assignee.name || '').toString().trim();
  if (name && name !== (assignee.accountId || '')) return name;
  return assignee.accountId || (typeof assignee === 'string' ? assignee : null) || 'Unassigned';
}

function assigneeAvatar(assignee) {
  if (!assignee?.avatarUrls) return null;
  const u = assignee.avatarUrls;
  return u['48x48'] || u['32x32'] || u['24x24'] || u['16x16'] || null;
}

/** First name only for table display (e.g. "Joey Perricone" -> "Joey"). */
function firstName(displayName) {
  if (!displayName || typeof displayName !== 'string') return displayName || '—';
  const first = displayName.trim().split(/\s+/)[0];
  return first || displayName;
}

const DONE_STATUSES = new Set(['done', "won't do", 'wont do']);
const digestConfig = config.digest || {};
const highPriorityNames = digestConfig.highPriorityNames || ['Highest', 'High'];
const backlogAgeWeeksThreshold = digestConfig.coachingBacklogAgeWeeksThreshold ?? 12;
const sweatGapPercent = digestConfig.coachingSweatGapPercent ?? 30;
const loadImbalanceRatio = digestConfig.coachingLoadImbalanceRatio ?? 2;
const prOpenDaysThreshold = digestConfig.coachingPROpenDaysThreshold ?? 5;

/** Get project key from board */
async function getProjectKey() {
  try {
    const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}`);
    if (boardResponse.data?.location?.projectKey) return boardResponse.data.location.projectKey;
  } catch (e) {
    debugError('Retro: board config', e?.message);
  }
  try {
    const r = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, { params: { fields: 'key', maxResults: 1 } });
    const key = r.data?.issues?.[0]?.key;
    if (key) return key.split('-')[0];
  } catch (e) {
    debugError('Retro: sample issue', e?.message);
  }
  return null;
}

/** Most recently ended sprint (for retro). Closed sprints sorted by endDate desc, take first. */
async function getLastClosedSprint() {
  try {
    const r = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/sprint`, { params: { maxResults: 50, state: 'closed' } });
    const closed = (r.data?.values || [])
      .filter(s => s.endDate && moment(s.endDate).isBefore(moment()))
      .sort((a, b) => moment(b.endDate).valueOf() - moment(a.endDate).valueOf());
    const sprint = closed[0];
    if (!sprint?.id) return null;
    return { id: sprint.id, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate };
  } catch (e) {
    debugError('Retro: lastClosedSprint', e?.message);
    return null;
  }
}

/** Resolve assignee key to { displayName, avatarUrl }; use cache or resolveAsync. */
async function resolveAssignee(key, jiraClient, config) {
  if (!key || key === 'Unassigned') return { displayName: 'Unassigned', avatarUrl: null };
  const hit = userCache.get(key);
  if (hit) return hit;
  return userCache.resolveAsync(key, jiraClient, config);
}

/**
 * Same as /sweat and /creep: fetch issues by key to get full assignee from API, populate resolved + cache.
 * issueKeys: Jira issue keys to fetch; keyToAssigneeKey: issue key -> assignee key we use in rows.
 */
async function resolveAssigneesViaIssueApi(issueKeys, keyToAssigneeKey, resolved, jiraClient, config) {
  const keysToFetch = [...new Set(issueKeys)].filter((k) => keyToAssigneeKey[k] && !resolved.has(keyToAssigneeKey[k]));
  if (keysToFetch.length === 0) return;
  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  for (const keyChunk of chunk(keysToFetch, 50)) {
    try {
      const searchRes = await jiraClient.post('/rest/api/3/search/jql', {
        jql: `key in (${keyChunk.join(',')})`,
        maxResults: keyChunk.length,
        fields: ['assignee'],
      });
      const apiIssues = searchRes.data?.issues || [];
      for (const iss of apiIssues) {
        const assigneeKey = keyToAssigneeKey[iss.key];
        if (!assigneeKey) continue;
        const assignee = iss.fields?.assignee;
        userCache.seedFromJiraUser(assignee);
        const urls = (assignee?.avatarUrls && typeof assignee.avatarUrls === 'object') ? assignee.avatarUrls : {};
        const avatarUrl = urls['48x48'] || urls['32x32'] || urls['24x24'] || urls['16x16'] || null;
        const displayName = ((assignee?.displayName || assignee?.name) ?? '').toString().trim();
        const accountId = (assignee?.accountId ?? '').toString();
        const name = (displayName && displayName !== accountId) ? displayName : assigneeKey;
        resolved.set(assigneeKey, { displayName: name, avatarUrl });
        if (displayName && displayName !== accountId) userCache.set(assigneeKey, { displayName, avatarUrl });
      }
    } catch (e) {
      debugError('Retro: issue fetch for assignees failed', e?.message);
    }
  }
}

/** Done in sprint: completed (Done/Won't Do) in the given sprint */
async function getDoneData(projectKey, sprint) {
  if (!projectKey || !sprint) return { count: 0, issues: [], periodLabel: sprint?.name || 'Sprint' };
  const jql = `project = "${projectKey}" AND sprint = ${sprint.id} AND status in (Done, "Won't Do")`;
  try {
    const r = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, { params: { jql, fields: 'key,summary,assignee,resolutiondate,issuetype', maxResults: 100 } });
    const raw = (r.data?.issues || []).slice(0, 50);
    const toResolve = new Set();
    const keyToAssigneeKey = {};
    raw.forEach(i => {
      const key = assigneeDisplay(i.fields?.assignee);
      if (key !== 'Unassigned') {
        keyToAssigneeKey[i.key] = key;
        if (!userCache.get(key)) toResolve.add(key);
      }
    });
    const resolved = new Map();
    for (const id of toResolve) {
      const hit = userCache.get(id);
      if (hit) resolved.set(id, { displayName: hit.displayName, avatarUrl: hit.avatarUrl });
    }
    await resolveAssigneesViaIssueApi(raw.map((i) => i.key), keyToAssigneeKey, resolved, jiraClient, config);
    const stillNeed = [...toResolve].filter((id) => !resolved.has(id));
    await Promise.all(stillNeed.map(async (id) => {
      const entry = await resolveAssignee(id, jiraClient, config);
      resolved.set(id, entry);
    }));
    const issues = raw.map(i => {
      let assignee = assigneeDisplay(i.fields?.assignee);
      let avatarUrl = assigneeAvatar(i.fields?.assignee);
      const res = resolved.get(assignee) || userCache.get(assignee);
      if (res) {
        assignee = res.displayName;
        avatarUrl = res.avatarUrl || avatarUrl;
      }
      return {
        key: i.key,
        summary: i.fields?.summary || '',
        assignee,
        assigneeShort: firstName(assignee),
        avatarUrl,
        issueType: (i.fields?.issuetype?.name || 'Task').toString(),
        link: `https://${config.jira.host}/browse/${i.key}`,
      };
    });
    return { count: r.data?.total ?? 0, issues, periodLabel: sprint.name };
  } catch (e) {
    debugError('Retro: done', e?.message);
    return { count: 0, issues: [], periodLabel: sprint.name };
  }
}

/** Incomplete in sprint: not Done (carried over). Paginate to get all. */
async function getIncompleteData(projectKey, sprint) {
  if (!projectKey || !sprint) return { incomplete: [], total: 0 };
  const jql = `project = "${projectKey}" AND sprint = ${sprint.id} AND status not in (Done, "Won't Do")`;
  const all = [];
  let startAt = 0;
  const pageSize = 100;
  try {
    do {
      const r = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, { params: { jql, fields: 'key,summary,status,assignee,updated,issuetype', startAt, maxResults: pageSize } });
      const issues = r.data?.issues || [];
      issues.forEach(i => {
        const updated = i.fields?.updated ? moment(i.fields.updated) : moment();
        const days = moment().diff(updated, 'days');
        const assigneeKey = assigneeDisplay(i.fields?.assignee);
        all.push({
          key: i.key,
          summary: (i.fields?.summary || '').slice(0, 80),
          status: i.fields?.status?.name || '—',
          assigneeKey,
          assignee: assigneeKey,
          assigneeShort: firstName(assigneeKey),
          avatarUrl: assigneeAvatar(i.fields?.assignee),
          issueType: (i.fields?.issuetype?.name || 'Task').toString(),
          daysNotUpdated: days,
          link: `https://${config.jira.host}/browse/${i.key}`,
        });
      });
      startAt += issues.length;
      if (issues.length === 0 || startAt >= (r.data?.total || 0)) break;
    } while (true);
    const toResolve = new Set();
    const keyToAssigneeKey = {};
    all.forEach(i => {
      if (i.assigneeKey !== 'Unassigned') {
        keyToAssigneeKey[i.key] = i.assigneeKey;
        if (!userCache.get(i.assigneeKey)) toResolve.add(i.assigneeKey);
      }
    });
    const resolved = new Map();
    for (const id of toResolve) {
      const hit = userCache.get(id);
      if (hit) resolved.set(id, { displayName: hit.displayName, avatarUrl: hit.avatarUrl });
    }
    await resolveAssigneesViaIssueApi(all.map((i) => i.key), keyToAssigneeKey, resolved, jiraClient, config);
    const stillNeed = [...toResolve].filter((id) => !resolved.has(id));
    await Promise.all(stillNeed.map(async (id) => {
      const entry = await resolveAssignee(id, jiraClient, config);
      resolved.set(id, entry);
    }));
    all.forEach(i => {
      const res = resolved.get(i.assigneeKey) || userCache.get(i.assigneeKey);
      if (res) {
        i.assignee = res.displayName;
        i.assigneeShort = firstName(res.displayName);
        i.avatarUrl = res.avatarUrl || i.avatarUrl;
      }
      delete i.assigneeKey;
    });
    return { incomplete: all, total: all.length };
  } catch (e) {
    debugError('Retro: incomplete', e?.message);
    return { incomplete: [], total: 0 };
  }
}

/** Load: assignee × total for the given sprint */
async function getLoadData(projectKey, sprint) {
  if (!projectKey || !sprint) return { sprintInfo: null, loadRows: [], imbalanceCallout: null };
  try {
    const jql = `project = "${projectKey}" AND sprint = ${sprint.id}`;
    let startAt = 0;
    const allIssues = [];
    do {
      const r = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, { params: { jql, fields: 'key,status,assignee', startAt, maxResults: 100 } });
      const issues = r.data?.issues || [];
      allIssues.push(...issues);
      startAt += issues.length;
      if (issues.length === 0 || startAt >= (r.data?.total || 0)) break;
    } while (true);

    const totalByAssignee = new Map();
    const avatarByAssignee = new Map();
    allIssues.forEach(issue => {
      const assignee = issue.fields?.assignee;
      const name = assigneeDisplay(assignee);
      const avatar = assigneeAvatar(assignee);
      totalByAssignee.set(name, (totalByAssignee.get(name) || 0) + 1);
      if (avatar && !avatarByAssignee.has(name)) avatarByAssignee.set(name, avatar);
    });
    const totals = Array.from(totalByAssignee.entries()).map(([name, total]) => ({ name, total, avatarUrl: avatarByAssignee.get(name) || null }));
    const sum = totals.reduce((s, t) => s + t.total, 0);
    const mean = totals.length ? sum / totals.length : 0;
    const maxRow = totals.length ? totals.reduce((a, b) => (b.total > a.total ? b : a)) : null;
    let imbalanceCallout = null;
    if (maxRow && mean > 0 && maxRow.total >= loadImbalanceRatio * mean) {
      imbalanceCallout = { name: maxRow.name, count: maxRow.total, avg: Math.round(mean * 10) / 10, avatarUrl: avatarByAssignee.get(maxRow.name) || null };
    }
    const loadRows = totals.sort((a, b) => (a.name === 'Unassigned' ? 1 : b.name === 'Unassigned' ? -1 : a.name.localeCompare(b.name)));
    return {
      sprintInfo: { name: sprint.name },
      loadRows,
      imbalanceCallout,
    };
  } catch (e) {
    debugError('Retro: load', e?.message);
    return { sprintInfo: null, loadRows: [], imbalanceCallout: null };
  }
}

/** Backlog: total, median age (days), optional note if median > threshold */
async function getBacklogData(projectKey) {
  let jql = `status not in (Done, "Won't Do")`;
  if (projectKey) jql += ` AND project = "${projectKey}" AND (sprint IS EMPTY OR (sprint NOT in openSprints() AND sprint NOT in futureSprints()))`;
  try {
    const r = await jiraClient.post('/rest/api/3/search/jql', { jql, maxResults: 500, fields: ['created'] });
    const issues = r.data?.issues || [];
    const now = moment();
    const ages = issues.map(i => (i.fields?.created ? now.diff(moment(i.fields.created), 'days', true) : 0)).sort((a, b) => a - b);
    const total = issues.length;
    const medianDays = ages.length ? (ages.length % 2 === 0 ? (ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2 : ages[Math.floor(ages.length / 2)]) : 0;
    const medianWeeks = medianDays / 7;
    const backlogNote = medianWeeks >= backlogAgeWeeksThreshold ? { medianWeeks: Math.round(medianWeeks * 10) / 10, threshold: backlogAgeWeeksThreshold } : null;
    return { total, medianDays, medianWeeks, backlogNote };
  } catch (e) {
    debugError('Retro: backlog', e?.message);
    return { total: 0, medianDays: 0, medianWeeks: 0, backlogNote: null };
  }
}

/** High priority: in given sprint */
async function getHighPriorityData(projectKey, sprint) {
  if (!projectKey || !sprint) return [];
  const names = highPriorityNames.map(n => `"${n}"`).join(',');
  const jql = `project = "${projectKey}" AND sprint = ${sprint.id} AND priority in (${names})`;
  try {
    const r = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, { params: { jql, fields: 'key,summary,assignee,status,priority,issuetype', maxResults: 50 } });
    const raw = (r.data?.issues || []).map(i => {
      const assigneeKey = assigneeDisplay(i.fields?.assignee);
      return {
        key: i.key,
        summary: (i.fields?.summary || '').slice(0, 50),
        assigneeKey,
        avatarUrl: assigneeAvatar(i.fields?.assignee),
        status: i.fields?.status?.name || '—',
        issueType: (i.fields?.issuetype?.name || 'Task').toString(),
        link: `https://${config.jira.host}/browse/${i.key}`,
      };
    });
    const toResolve = new Set();
    const keyToAssigneeKey = {};
    raw.forEach(i => {
      if (i.assigneeKey !== 'Unassigned') {
        keyToAssigneeKey[i.key] = i.assigneeKey;
        if (!userCache.get(i.assigneeKey)) toResolve.add(i.assigneeKey);
      }
    });
    const resolved = new Map();
    for (const id of toResolve) {
      const hit = userCache.get(id);
      if (hit) resolved.set(id, { displayName: hit.displayName, avatarUrl: hit.avatarUrl });
    }
    await resolveAssigneesViaIssueApi(raw.map((i) => i.key), keyToAssigneeKey, resolved, jiraClient, config);
    const stillNeed = [...toResolve].filter((id) => !resolved.has(id));
    await Promise.all(stillNeed.map(async (id) => {
      const entry = await resolveAssignee(id, jiraClient, config);
      resolved.set(id, entry);
    }));
    return raw.map(i => {
      const res = resolved.get(i.assigneeKey) || userCache.get(i.assigneeKey);
      const assignee = res ? res.displayName : i.assigneeKey;
      const avatarUrl = res ? (res.avatarUrl || i.avatarUrl) : i.avatarUrl;
      return {
        key: i.key,
        summary: i.summary,
        assignee,
        assigneeShort: firstName(assignee),
        avatarUrl,
        status: i.status,
        issueType: i.issueType,
        link: i.link,
      };
    });
  } catch (e) {
    debugError('Retro: highPriority', e?.message);
    return [];
  }
}

/** Creep / scope: sprint report with started, ended, creep, % complete (GreenHopper) */
async function getCreepData(sprint) {
  if (!sprint?.id) return null;
  try {
    const url = `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${BOARD_ID}&sprintId=${sprint.id}`;
    const res = await jiraClient.get(url, { timeout: 8000, validateStatus: (s) => s === 200 });
    const raw = res.data?.contents ?? res.data;
    const completedList = Array.isArray(raw?.completedIssues) ? raw.completedIssues : [];
    const incompleteList = Array.isArray(raw?.incompletedIssues) ? raw.incompletedIssues : (Array.isArray(raw?.issuesNotCompletedInCurrentSprint) ? raw.issuesNotCompletedInCurrentSprint : []);
    const punted = Array.isArray(raw?.puntedIssues) ? raw.puntedIssues : [];
    const addedMap = raw?.issueKeysAddedDuringSprint && typeof raw.issueKeysAddedDuringSprint === 'object' ? raw.issueKeysAddedDuringSprint : {};
    const addedKeys = Array.isArray(addedMap) ? addedMap : Object.keys(addedMap || {});
    const addedKeySet = new Set(addedKeys.map((k) => (typeof k === 'object' && k && k.key != null) ? k.key : String(k)));
    const completed = completedList.length;
    const incomplete = incompleteList.length;
    const endedWith = completed + incomplete;
    const addedCount = addedKeySet.size;
    const removedCount = punted.length;
    const startedWith = Math.max(0, endedWith - addedCount + removedCount);
    const completedFromStart = completedList.filter((i) => !addedKeySet.has((i.key ?? i.id ?? '').toString())).length;
    const completedFromAdded = completed - completedFromStart;
    const incompleteFromAdded = incompleteList.filter((i) => addedKeySet.has((i.key ?? i.id ?? '').toString())).length;
    const incompleteFromStart = incomplete - incompleteFromAdded;
    const pctCompleteEnded = endedWith ? Math.round((completed / endedWith) * 100) : 0;
    const pctCompleteStarted = startedWith ? Math.round((completedFromStart / startedWith) * 100) : 0;
    const creepNet = addedCount - removedCount;
    return {
      sprintName: sprint.name,
      startedWith,
      endedWith,
      completed,
      incomplete,
      completedFromStart,
      completedFromAdded,
      incompleteFromStart,
      incompleteFromAdded,
      addedCount,
      removedCount,
      creepNet,
      pctCompleteEnded,
      pctCompleteStarted,
    };
  } catch (e) {
    debugError('Retro: creep', e?.message);
    return null;
  }
}

/** Sweat: last closed sprint – assigned vs completed per assignee (GreenHopper) */
async function getSweatData(sprint) {
  if (!sprint?.id) return { sprintName: null, rows: [] };
  try {
    const url = `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${BOARD_ID}&sprintId=${sprint.id}`;
    const res = await jiraClient.get(url, { timeout: 8000, validateStatus: (s) => s === 200 });
    const raw = res.data?.contents ?? res.data;
    const completed = Array.isArray(raw?.completedIssues) ? raw.completedIssues : [];
    const incomplete = Array.isArray(raw?.incompletedIssues) ? raw.incompletedIssues : (Array.isArray(raw?.issuesNotCompletedInCurrentSprint) ? raw.issuesNotCompletedInCurrentSprint : []);
    const allIssues = [...completed, ...incomplete];
    const toRow = (e) => {
      const fields = e.fields ?? e;
      const a = fields.assignee;
      const assigneeKey = assigneeDisplay(a);
      const status = (fields.status?.name ?? fields.status ?? '').toString().toLowerCase().trim();
      return { assigneeKey, completed: DONE_STATUSES.has(status) };
    };
    const byKey = new Map();
    const keyToAssigneeKey = {};
    allIssues.forEach(i => {
      const { assigneeKey, completed: done } = toRow(i);
      const issueKey = (i.key ?? i.id ?? '').toString();
      if (issueKey) keyToAssigneeKey[issueKey] = assigneeKey;
      if (!byKey.has(assigneeKey)) byKey.set(assigneeKey, { assigned: 0, completed: 0 });
      const r = byKey.get(assigneeKey);
      r.assigned += 1;
      if (done) r.completed += 1;
    });
    const needResolve = new Set();
    for (const key of byKey.keys()) {
      if (key !== 'Unassigned' && !userCache.get(key)) needResolve.add(key);
    }
    const resolved = new Map(); // key -> { displayName, avatarUrl }
    for (const id of needResolve) {
      const hit = userCache.get(id);
      if (hit) resolved.set(id, { displayName: hit.displayName, avatarUrl: hit.avatarUrl || null });
    }
    const issueKeys = allIssues.map((i) => (i.key ?? i.id ?? '').toString()).filter(Boolean);
    await resolveAssigneesViaIssueApi(issueKeys, keyToAssigneeKey, resolved, jiraClient, config);
    const stillNeed = [...needResolve].filter(id => !resolved.has(id));
    await Promise.all(stillNeed.map(async (id) => {
      const r = await resolveAssignee(id, jiraClient, config);
      resolved.set(id, { displayName: r.displayName, avatarUrl: r.avatarUrl || null });
    }));
    const rows = Array.from(byKey.entries())
      .filter(([key]) => key !== 'Unassigned')
      .map(([key, r]) => {
        const res = resolved.get(key) || userCache.get(key);
        const displayName = res ? res.displayName : key;
        const avatarUrl = res ? (res.avatarUrl || null) : null;
        return {
          assignee: displayName,
          assigneeShort: firstName(displayName),
          avatarUrl,
          assigned: r.assigned,
          completed: r.completed,
          gapPct: r.assigned ? Math.round((1 - r.completed / r.assigned) * 100) : 0,
        };
      })
      .sort((a, b) => a.assignee.localeCompare(b.assignee));
    return { sprintName: sprint.name, rows };
  } catch (e) {
    debugError('Retro: sweat', e?.message);
    return { sprintName: null, rows: [] };
  }
}

/** PR summary (optional, if GitHub configured) */
async function getPRSummary() {
  if (!config.github?.token || !config.github?.org) return null;
  try {
    const reposRes = await githubClient.get(`/orgs/${config.github.org}/repos`, { params: { per_page: 100, sort: 'updated' } });
    const repos = (reposRes.data || []).filter(r => !r.archived).slice(0, 30);
    const allPRs = [];
    const fiveDaysAgo = moment().subtract(prOpenDaysThreshold, 'days');
    for (const repo of repos.slice(0, 15)) {
      try {
        const prRes = await githubClient.get(`/repos/${repo.full_name}/pulls`, { params: { state: 'open', per_page: 50 } });
        const prs = prRes.data || [];
        prs.forEach(pr => {
          const updatedAt = pr.updated_at ? moment(pr.updated_at) : null;
          const hasReviewers = (pr.requested_reviewers && pr.requested_reviewers.length > 0) || (pr.requested_teams && pr.requested_teams.length > 0);
          allPRs.push({
            openOver5Days: updatedAt ? updatedAt.isBefore(fiveDaysAgo) : false,
            noReviewers: !hasReviewers && !pr.draft,
          });
        });
      } catch (_) {}
    }
    const total = allPRs.length;
    const openOver5Days = allPRs.filter(p => p.openOver5Days).length;
    const noReviewers = allPRs.filter(p => p.noReviewers).length;
    return { total, openOver5Days, noReviewers };
  } catch (e) {
    debugError('Retro: PR summary', e?.message);
    return null;
  }
}

/** Map Jira priority name to H/M/L for display (H=red, M=orange, L=blue). */
function priorityLevel(priorityName) {
  if (!priorityName || typeof priorityName !== 'string') return 'M';
  const n = priorityName.toLowerCase();
  if (n.includes('high') && !n.includes('low')) return 'H';
  if (n.includes('low')) return 'L';
  return 'M';
}

/** Stuck: incomplete in last closed sprint, in same status 7+ days. No PR fields. */
async function getStuckData(projectKey, sprint) {
  if (!projectKey || !sprint?.id) return { stuck: [] };
  const tz = getTz();
  const jql = `project = "${projectKey}" AND sprint = ${sprint.id} AND status not in (Done, "Won't Do")`;
  let issues = [];
  let startAt = 0;
  const pageSize = 100;
  try {
    do {
      const r = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
        params: { jql, fields: 'key,summary,status,assignee,created,priority,issuetype', startAt, maxResults: pageSize },
      });
      const page = r.data?.issues || [];
      issues = issues.concat(page);
      startAt += page.length;
      if (page.length === 0 || startAt >= (r.data?.total || 0)) break;
    } while (true);
  } catch (e) {
    debugError('Retro: stuck fetch', e?.message);
    return { stuck: [] };
  }

  if (issues.length === 0) return { stuck: [] };

  const now = moment().tz(tz);
  const issuesWithChangelog = await Promise.all(
    issues.map(async (issue) => {
      const changelogValues = [];
      let startAtCl = 0;
      const pageSizeCl = 100;
      let total = 0;
      let page = [];
      do {
        try {
          const cr = await jiraClient.get(`/rest/api/3/issue/${issue.key}/changelog`, {
            params: { startAt: startAtCl, maxResults: pageSizeCl },
          });
          page = cr.data?.values || [];
          total = cr.data?.total != null ? cr.data.total : changelogValues.length + page.length;
          changelogValues.push(...page);
          startAtCl += page.length;
        } catch (_) {
          break;
        }
      } while (startAtCl < total && page.length > 0);
      return { ...issue, changelog: { histories: changelogValues } };
    })
  );

  const stuckRaw = issuesWithChangelog.map((issue) => {
    const currentStatus = issue.fields?.status?.name || '—';
    const history = issue.changelog?.histories || [];
    const statusTransitions = [];
    history.forEach((record) => {
      if (!record.items || !Array.isArray(record.items)) return;
      record.items.forEach((item) => {
        if (item.field === 'status') {
          statusTransitions.push({
            date: moment(record.created),
            fromStatus: item.fromString,
            toStatus: item.toString,
          });
        }
      });
    });
    statusTransitions.sort((a, b) => a.date.valueOf() - b.date.valueOf());

    let enteredCurrentStatusAt = null;
    if (statusTransitions.length === 0) {
      enteredCurrentStatusAt = moment(issue.fields?.created);
    } else {
      const first = statusTransitions[0];
      if (first.fromStatus === currentStatus) {
        enteredCurrentStatusAt = moment(issue.fields?.created);
      }
    }
    for (const t of statusTransitions) {
      if (t.toStatus === currentStatus && t.fromStatus !== currentStatus) {
        enteredCurrentStatusAt = t.date;
      } else if (t.fromStatus === currentStatus && t.toStatus !== currentStatus) {
        enteredCurrentStatusAt = null;
      }
    }
    const daysInStatus = enteredCurrentStatusAt ? now.diff(enteredCurrentStatusAt, 'days') : 0;

    const priorityName = (issue.fields?.priority?.name || 'Medium').toString();
    const level = priorityLevel(priorityName);
    const issueType = (issue.fields?.issuetype?.name || 'Task').toString();
    return {
      key: issue.key,
      summary: (issue.fields?.summary || '').slice(0, 80),
      status: currentStatus,
      issueType,
      assigneeKey: assigneeDisplay(issue.fields?.assignee),
      avatarUrl: assigneeAvatar(issue.fields?.assignee),
      daysInStatus,
      priorityName,
      priorityLevel: level,
      link: `https://${config.jira.host}/browse/${issue.key}`,
    };
  }).filter((i) => i.daysInStatus >= 7);

  // Badge color: same thresholds as /slow — grey / yellow / red pill
  let sprintDurationDays = 14;
  if (sprint.startDate && sprint.endDate) {
    const start = moment.tz(sprint.startDate, tz);
    const end = moment.tz(sprint.endDate, tz);
    sprintDurationDays = end.diff(start, 'days');
  }
  const twoSprintsDays = sprintDurationDays * 2;
  stuckRaw.forEach((issue) => {
    if (issue.daysInStatus >= twoSprintsDays) {
      issue.badgeClass = 'danger';
    } else if (issue.daysInStatus >= sprintDurationDays) {
      issue.badgeClass = 'warning';
    } else {
      issue.badgeClass = '';
    }
  });

  const toResolve = new Set();
  const keyToAssigneeKey = {};
  stuckRaw.forEach((i) => {
    if (i.assigneeKey !== 'Unassigned') {
      keyToAssigneeKey[i.key] = i.assigneeKey;
      if (!userCache.get(i.assigneeKey)) toResolve.add(i.assigneeKey);
    }
  });
  const resolved = new Map();
  for (const id of toResolve) {
    const hit = userCache.get(id);
    if (hit) resolved.set(id, { displayName: hit.displayName, avatarUrl: hit.avatarUrl });
  }
  await resolveAssigneesViaIssueApi(stuckRaw.map((i) => i.key), keyToAssigneeKey, resolved, jiraClient, config);
  const stillNeed = [...toResolve].filter((id) => !resolved.has(id));
  await Promise.all(stillNeed.map(async (id) => {
    const entry = await resolveAssignee(id, jiraClient, config);
    resolved.set(id, entry);
  }));

  const stuck = stuckRaw
    .map((i) => {
      const res = resolved.get(i.assigneeKey) || userCache.get(i.assigneeKey);
      const assignee = res ? res.displayName : i.assigneeKey;
      const avatarUrl = res ? (res.avatarUrl || i.avatarUrl) : i.avatarUrl;
      return {
        key: i.key,
        summary: i.summary,
        status: i.status,
        issueType: i.issueType,
        assignee,
        assigneeShort: firstName(assignee),
        avatarUrl,
        daysInStatus: i.daysInStatus,
        badgeClass: i.badgeClass || '',
        priorityName: i.priorityName,
        priorityLevel: i.priorityLevel,
        link: i.link,
      };
    })
    .sort((a, b) => b.daysInStatus - a.daysInStatus);
  return { stuck };
}

/** Retro notes: rollover callout only (no per-person completion rates). Sprint stats + bar live in template via digest.creep. */
function buildRetroNotes(digest) {
  const out = [];
  if (digest.incomplete?.total > 0) {
    out.push({ type: 'summary', message: `${digest.incomplete.total} ticket(s) incomplete in sprint (carried over).` });
  }
  return out;
}

router.get('/retro', async (req, res) => {
  const formatHtml = req.query.format === 'html';
  const tz = getTz();
  const generatedAt = moment().tz(tz).format('MMM D, YYYY h:mm A');

  try {
    const projectKey = await getProjectKey();
    const sprint = await getLastClosedSprint();
    if (!sprint) {
      return res.status(503).send('No closed sprint found for retro.');
    }
    const [done, incomplete, backlog, highPriority, creep, sweat, pr, stuck] = await Promise.all([
      getDoneData(projectKey, sprint),
      getIncompleteData(projectKey, sprint),
      getBacklogData(projectKey),
      getHighPriorityData(projectKey, sprint),
      getCreepData(sprint),
      getSweatData(sprint),
      getPRSummary(),
      getStuckData(projectKey, sprint),
    ]);

    const digest = {
      sprintName: sprint.name,
      periodLabel: sprint.name,
      generatedAt,
      progress: done,
      incomplete,
      backlog,
      highPriority,
      creep,
      sweat,
      pr,
      stuck: stuck?.stuck ?? [],
      prOpenDaysThreshold,
      retroNotes: [],
    };
    digest.retroNotes = buildRetroNotes(digest);

    if (formatHtml) {
      return res.render('retro-fragment', { digest }, (err, html) => {
        if (err) {
          debugError('Retro fragment render', err);
          return res.status(500).send('Error rendering retro');
        }
        res.type('text/html').send(html);
      });
    }

    const isHtmxRequest = req.headers['hx-request'] === 'true';
    if (isHtmxRequest) {
      return res.render('retro', { digest }, (err, html) => {
        if (err) {
          debugError('Retro render', err);
          return res.status(500).send('Error rendering retro');
        }
        res.send(`<title hx-swap-oob="true">Last Sprint Retro – ${digest.periodLabel}</title>
<link rel="stylesheet" href="/css/routes/retro.css" hx-swap-oob="true" id="route-stylesheet">
<script src="/js/retro.js" data-route-script></script>${html}`);
      });
    }
    return res.render('base', {
      title: `Last Sprint Retro – ${digest.periodLabel}`,
      template: 'retro',
      templateData: { digest },
      stylesheet: '/css/routes/retro.css',
      script: '/js/retro.js',
    });
  } catch (error) {
    debugError('Retro route error', error);
    res.status(500).send(`Retro error: ${error.message}`);
  }
});

module.exports = router;
