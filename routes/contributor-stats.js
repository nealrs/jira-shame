/**
 * Route: /sweat – “the report that should make you sweat”
 * Single pivot table: rows = assignees, columns = sprints. Each cell shows
 * "Assigned (Completed %)" for developer productivity over time.
 * Not linked from nav or dashboard.
 */
const express = require('express');
const moment = require('moment-timezone');
const router = express.Router();
const userCache = require('../utils/user-cache');

let BOARD_ID, jiraClient, config, isHtmxRequest, debugError;
try {
  const h = require('./_helpers');
  BOARD_ID = h.BOARD_ID;
  jiraClient = h.jiraClient;
  config = h.config;
  isHtmxRequest = h.isHtmxRequest;
  debugError = h.debugError;
} catch (e) {
  const axios = require('axios');
  BOARD_ID = process.env.BOARD_ID || 7;
  config = { jira: { host: process.env.JIRA_HOST || '' } };
  isHtmxRequest = (req) => !!(req.headers && req.headers['hx-request']);
  jiraClient = axios.create({
    baseURL: `https://${process.env.JIRA_HOST}`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  debugError = (a, b) => console.error(a, b);
}

const ET = 'America/New_York';

const DONE_STATUSES = new Set(['done', "won't do", 'wont do']);

function formatDateRange(startM, endM) {
  if (!startM || !endM || !startM.isValid() || !endM.isValid()) return '—';
  const sy = startM.year();
  const ey = endM.year();
  const sm = startM.month();
  const em = endM.month();
  if (sy === ey && sm === em) {
    return startM.format('MMM D') + '-' + endM.format('D, YYYY');
  }
  if (sy === ey) {
    return startM.format('MMM D') + '–' + endM.format('MMM D, YYYY');
  }
  return startM.format('MMM D, YYYY') + '–' + endM.format('MMM D, YYYY');
}

/** Fetch GreenHopper sprint report; return issues with key, assignee (raw), status, issuetype. */
async function getSprintIssuesForStats(boardId, sprintId) {
  try {
    const url = `/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${boardId}&sprintId=${sprintId}`;
    const res = await jiraClient.get(url, { timeout: 10000, validateStatus: (s) => s === 200 });
    const raw = res.data?.contents ?? res.data;
    if (!raw || typeof raw !== 'object') return null;
    const completed = Array.isArray(raw.completedIssues) ? raw.completedIssues : [];
    const incomplete = Array.isArray(raw.incompletedIssues)
      ? raw.incompletedIssues
      : Array.isArray(raw.issuesNotCompletedInCurrentSprint) ? raw.issuesNotCompletedInCurrentSprint : [];
    const punted = Array.isArray(raw.puntedIssues) ? raw.puntedIssues : [];
    const addedMap = raw.issueKeysAddedDuringSprint && typeof raw.issueKeysAddedDuringSprint === 'object'
      ? raw.issueKeysAddedDuringSprint
      : {};
    const addedKeys = Array.isArray(addedMap) ? addedMap : Object.keys(addedMap || {});

    const toRow = (e) => {
      const key = e.key ?? e.id ?? (typeof e === 'string' ? e : '');
      const fields = e.fields ?? e;
      const rawAssignee = fields.assignee;
      userCache.seedFromJiraUser(rawAssignee);
      const assignee = (rawAssignee && rawAssignee.displayName)
        || (typeof rawAssignee === 'string' ? rawAssignee : null)
        || 'Unassigned';
      const status = (fields.status?.name ?? fields.status ?? '—').toString();
      return { key, assignee, status };
    };

    const issues = [
      ...completed.map(toRow),
      ...incomplete.map(toRow),
      ...punted.map(toRow),
      ...addedKeys.map((k) => {
        const key = (typeof k === 'object' && k && k.key != null) ? k.key : String(k);
        return { key, assignee: 'Unassigned', status: '—' };
      }),
    ].filter((i) => i.key);

    const seen = new Set();
    const deduped = issues.filter((i) => {
      if (seen.has(i.key)) return false;
      seen.add(i.key);
      return true;
    });
    return deduped;
  } catch (err) {
    debugError('Contributor-stats: sprint report failed for ' + sprintId, err.message);
    return null;
  }
}

/** Aggregate by assignee: assigned, completed. */
function aggregateByAssignee(issues) {
  const byAssignee = new Map();
  for (const i of issues) {
    const a = i.assignee || 'Unassigned';
    if (!byAssignee.has(a)) {
      byAssignee.set(a, { assignee: a, assigned: 0, completed: 0 });
    }
    const rec = byAssignee.get(a);
    rec.assigned += 1;
    if (DONE_STATUSES.has((i.status || '').toLowerCase().trim())) rec.completed += 1;
  }
  return Array.from(byAssignee.values());
}

router.get('/sweat', async (req, res) => {
  try {
    const boardId = BOARD_ID;
    const sprintsRes = await jiraClient.get(`/rest/agile/1.0/board/${boardId}/sprint`, {
      params: { maxResults: 50, state: 'active,closed' },
    });
    const all = sprintsRes.data.values || [];
    const now = moment().tz(ET);
    const allClosed = all.filter((s) => (s.state || '').toLowerCase() === 'closed');
    const allActive = all.filter((s) => (s.state || '').toLowerCase() === 'active');
    const withDatesClosed = allClosed.filter((s) => s.startDate && s.endDate);
    const lastClosed = withDatesClosed
      .sort((a, b) => moment(b.endDate).valueOf() - moment(a.endDate).valueOf())
      .slice(0, 12);
    const activeWithDates = allActive.filter((s) => s.startDate && s.endDate);
    const activeSprint = activeWithDates.find(
      (s) => now.isBetween(moment.tz(s.startDate, ET), moment.tz(s.endDate, ET), null, '[]')
    ) || null;
    const sprintsToProcess = activeSprint ? [activeSprint, ...lastClosed] : lastClosed;

    const sprintRows = [];

    for (const sprint of sprintsToProcess) {
      const isActive = Boolean(activeSprint && sprint.id === activeSprint.id);
      const startM = moment.tz(sprint.startDate, ET);
      const endDisplayM = moment.tz(sprint.endDate, ET);
      const dateRangeDisplay = formatDateRange(startM, endDisplayM);

      const issues = await getSprintIssuesForStats(boardId, sprint.id);

      sprintRows.push({
        id: sprint.id,
        name: sprint.name,
        dateRangeDisplay,
        isActive,
        issues: issues || [],
      });
    }

    // Resolve assignee ids (ug:uuid / bare uuid) using same approach as creep: cache, issue API, then resolveAsync
    const needResolve = new Set();
    const keyToAccountId = {};
    for (const row of sprintRows) {
      for (const issue of row.issues || []) {
        const a = issue.assignee;
        if (userCache.isAccountId(a)) {
          needResolve.add(a);
          keyToAccountId[issue.key] = a;
        }
      }
    }
    const resolved = new Map(); // id -> { displayName, avatarUrl }
    for (const ug of needResolve) {
      const hit = userCache.get(ug);
      if (hit) resolved.set(ug, { displayName: hit.displayName, avatarUrl: hit.avatarUrl });
    }
    const keysToFetch = [...new Set(Object.keys(keyToAccountId).filter((k) => !resolved.has(keyToAccountId[k])))];
    if (keysToFetch.length > 0) {
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
            const accountId = keyToAccountId[iss.key];
            if (!accountId) continue;
            const assignee = iss.fields?.assignee;
            userCache.seedFromJiraUser(assignee);
            const urls = (assignee?.avatarUrls && typeof assignee.avatarUrls === 'object') ? assignee.avatarUrls : {};
            const avatarUrl = urls['48x48'] || urls['32x32'] || urls['24x24'] || urls['16x16'] || null;
            const displayName = ((assignee?.displayName || assignee?.name) ?? accountId).toString().trim();
            resolved.set(accountId, { displayName, avatarUrl });
            userCache.set(accountId, { displayName, avatarUrl });
          }
        } catch (e) {
          debugError('Contributor-stats: issue fetch for assignees failed', e?.message || e);
        }
      }
    }
    const stillNeed = [...needResolve].filter((id) => !resolved.has(id));
    await Promise.all(stillNeed.map(async (id) => {
      const r = await userCache.resolveAsync(id, jiraClient, config);
      resolved.set(id, { displayName: r.displayName, avatarUrl: r.avatarUrl });
    }));

    // Derive contributors from issues using resolved display names and avatars
    for (const row of sprintRows) {
      const byDisplay = new Map();
      for (const issue of row.issues || []) {
        const r = resolved.get(issue.assignee);
        const display = r ? r.displayName : (issue.assignee || 'Unassigned');
        const avatarUrl = r ? r.avatarUrl : null;
        if (!byDisplay.has(display)) {
          byDisplay.set(display, { assignee: issue.assignee, assigneeDisplay: display, assigneeAvatarUrl: avatarUrl, assigned: 0, completed: 0 });
        }
        const rec = byDisplay.get(display);
        if (avatarUrl && !rec.assigneeAvatarUrl) rec.assigneeAvatarUrl = avatarUrl;
        rec.assigned += 1;
        if (DONE_STATUSES.has((issue.status || '').toLowerCase().trim())) rec.completed += 1;
      }
      row.contributors = Array.from(byDisplay.values());
    }

    // Skip deactivated/unrecognized or rk:-style ids
    const isIgnoredDev = (c) => {
      const display = c.assigneeDisplay != null ? c.assigneeDisplay : c.assignee;
      if (/^rk:/i.test(display || '')) return true;
      if (userCache.isAccountId(c.assignee) && (c.assigneeDisplay || c.assignee) === c.assignee) return true;
      return false;
    };

    // Pivot: rows = assignees, columns = sprints. Cell = "assigned (pct%)" or "—"
    const assigneeSet = new Set();
    for (const row of sprintRows) {
      for (const c of row.contributors || []) {
        if (isIgnoredDev(c)) continue;
        const display = c.assigneeDisplay != null ? c.assigneeDisplay : c.assignee;
        if (display === 'Unassigned') continue;
        assigneeSet.add(display);
      }
    }
    const assignees = [...assigneeSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const sprints = sprintRows.map((r) => ({ id: r.id, name: r.name, dateRangeDisplay: r.dateRangeDisplay, isActive: r.isActive }));
    const assigneeRows = assignees.map((assignee) => {
      const cells = sprintRows.map((row) => {
        const c = (row.contributors || []).find((x) => !isIgnoredDev(x) && ((x.assigneeDisplay != null ? x.assigneeDisplay : x.assignee) === assignee));
        if (!c || c.assigned === 0) return { assigned: 0, completed: 0, text: '—' };
        const pct = (100 * c.completed / c.assigned).toFixed(0);
        return { assigned: c.assigned, completed: c.completed, text: `${c.assigned} (${pct}%)` };
      });
      const totalAssigned = cells.reduce((s, cell) => s + cell.assigned, 0);
      const totalCompleted = cells.reduce((s, cell) => s + cell.completed, 0);
      const avgPct = totalAssigned > 0 ? (100 * totalCompleted / totalAssigned).toFixed(1) + '%' : '—';
      const firstContributor = sprintRows.map((row) => (row.contributors || []).find((x) => !isIgnoredDev(x) && ((x.assigneeDisplay != null ? x.assigneeDisplay : x.assignee) === assignee))).find(Boolean);
      const avatarUrl = firstContributor ? firstContributor.assigneeAvatarUrl : null;
      const assigneeShort = (assignee || '').split(/\s+/)[0] || assignee;
      return { assignee, assigneeShort, assigneeAvatarUrl: avatarUrl, cells, avgPct };
    });

    const templateData = {
      sprints,
      assigneeRows,
      error: false,
    };
    if (isHtmxRequest(req)) {
      return res.render('contributor-stats', templateData, (err, html) => {
        if (err) {
          debugError('Error rendering contributor-stats template', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<title hx-swap-oob="true">Sweat</title>
<link rel="stylesheet" href="/css/routes/contributor-stats.css" hx-swap-oob="true" id="route-stylesheet">
${html}`;
        res.send(response);
      });
    }
    return res.render('base', {
      title: 'Sweat',
      template: 'contributor-stats',
      templateData,
      stylesheet: '/css/routes/contributor-stats.css',
      script: null,
    });
  } catch (err) {
    debugError('Contributor-stats route error', err);
    const errorData = {
      error: true,
      errorMessage: err.message,
      sprints: [],
      assigneeRows: [],
    };
    if (isHtmxRequest(req)) {
      return res.render('contributor-stats', errorData, (renderErr, html) => {
        if (renderErr) return res.status(500).send('Error rendering page');
        const response = `<title hx-swap-oob="true">Sweat</title>
<link rel="stylesheet" href="/css/routes/contributor-stats.css" hx-swap-oob="true" id="route-stylesheet">
${html}`;
        res.send(response);
      });
    }
    return res.render('base', {
      title: 'Sweat',
      template: 'contributor-stats',
      templateData: errorData,
      stylesheet: '/css/routes/contributor-stats.css',
      script: null,
    });
  }
});

module.exports = router;
