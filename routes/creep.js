const express = require('express');
const moment = require('moment-timezone');
const router = express.Router();
const userCache = require('../utils/user-cache');

// Use _helpers when available (same as load/backlog)
let BOARD_ID, jiraClient, config, isHtmxRequest, debugLog, debugError;
try {
  const h = require('./_helpers');
  BOARD_ID = h.BOARD_ID;
  jiraClient = h.jiraClient;
  config = h.config;
  isHtmxRequest = h.isHtmxRequest;
  debugLog = h.debugLog;
  debugError = h.debugError;
} catch (e) {
  const axios = require('axios');
  BOARD_ID = process.env.BOARD_ID || 7;
  config = { jira: { host: process.env.JIRA_HOST || '' } };
  jiraClient = axios.create({
    baseURL: `https://${process.env.JIRA_HOST}`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  isHtmxRequest = (req) => !!(req.headers && req.headers['hx-request']);
  debugLog = () => {};
  debugError = (a, b) => console.error(a, b);
}

const ET = 'America/New_York';

/** Canonical order for sorting issues by status. */
const STATUS_ORDER = [
  'to do', 'ready for development', 'in progress', 'in review',
  'done', "won't do", 'wont do', 'backlog', 'open', 'closed',
];
function statusSortRank(s) {
  const k = (s || '').toLowerCase().trim();
  const i = STATUS_ORDER.indexOf(k);
  return i >= 0 ? i : STATUS_ORDER.length;
}

function statusSlug(statusName) {
  return (statusName || '—').toLowerCase().replace(/\s+/g, '-').replace(/'/g, '');
}

/** Compact, humanized date range: "Jan 14-27, 2026" same month; "Feb 27–Mar 15, 2026" same year; "Dec 27, 2025–Jan 13, 2026" span. */
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

/** True if assignee looks like an account id (ug:uuid or bare UUID) that needs resolution to a display name. */
function needsAssigneeResolution(a) {
  if (typeof a !== 'string' || !a.trim()) return false;
  const s = a.trim();
  return /^ug:[a-f0-9-]+$/i.test(s) || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
}

/**
 * Try GreenHopper sprint report (Server/DC). Returns null on Cloud/404.
 */
async function tryGetSprintReport(boardId, sprintId) {
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
    const addedCount = Array.isArray(addedMap) ? addedMap.length : Object.keys(addedMap).length;
    const inAtEnd = completed.length + incomplete.length;
    const removedAfterStart = punted.length;
    const inAtStart = Math.max(0, inAtEnd - addedCount + removedAfterStart);
    const toIssue = (e) => {
      const key = e.key ?? e.id ?? (typeof e === 'string' ? e : '');
      const fields = e.fields ?? e;
      const rawAssignee = fields.assignee;
      userCache.seedFromJiraUser(rawAssignee);
      const assignee = (rawAssignee && rawAssignee.displayName) || (typeof rawAssignee === 'string' ? rawAssignee : null) || 'Unassigned';
      return {
        key,
        summary: (fields.summary ?? '').toString(),
        status: (fields.status?.name ?? fields.status ?? '—').toString(),
        assignee,
        link: `https://${config.jira.host}/browse/${key}`,
      };
    };
    const addedKeys = Array.isArray(addedMap) ? addedMap : Object.keys(addedMap || {});
    const addedKeySet = new Set(addedKeys.map((k) => (typeof k === 'object' && k && k.key != null) ? k.key : String(k)));
    const puntedKeySet = new Set(punted.map((e) => e.key ?? e.id ?? (typeof e === 'string' ? e : null)).filter(Boolean));
    const issues = [
      ...completed.map(toIssue),
      ...incomplete.map(toIssue),
      ...punted.map(toIssue),
      ...addedKeys.map((k) => toIssue(typeof k === 'object' && k && k.key ? k : { key: String(k) })),
    ].filter((i) => i.key);
    const seen = new Set();
    const deduped = issues.filter((i) => {
      if (seen.has(i.key)) return false;
      seen.add(i.key);
      return true;
    });
    deduped.forEach((i) => {
      i.statusSlug = statusSlug(i.status);
      i.sprintChange = puntedKeySet.has(i.key) ? 'removed' : addedKeySet.has(i.key) ? 'added' : null;
    });
    deduped.sort((a, b) => statusSortRank(a.status) - statusSortRank(b.status) || (a.key || '').localeCompare(b.key || ''));
    return {
      inAtStart,
      inAtEnd,
      completedDuring: completed.length,
      removedAfterStart,
      addedAfterStart: addedCount,
      issues: deduped,
    };
  } catch (err) {
    debugError('Sprint report failed for sprint ' + sprintId, err.message);
    return null;
  }
}

router.get('/creep', async (req, res) => {
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
      const startM = moment.tz(sprint.startDate, ET).add(1, 'day').endOf('day');
      const endM = isActive ? moment.tz(ET).endOf('day') : moment.tz(sprint.endDate, ET).endOf('day');
      const endDisplayM = moment.tz(sprint.endDate, ET);

      const report = await tryGetSprintReport(boardId, sprint.id);
      if (report) {
        const { inAtStart, inAtEnd, completedDuring, removedAfterStart, addedAfterStart, issues } = report;
        const completedPct = inAtEnd > 0 ? (100 * completedDuring / inAtEnd).toFixed(1) : '—';
        const netChange = inAtEnd - inAtStart;
        const creepDisplay = inAtStart > 0
          ? (netChange >= 0 ? '+' : '') + (100 * netChange / inAtStart).toFixed(1) + '%'
          : '—';
        const changeDisplay = `+ ${addedAfterStart} / - ${removedAfterStart}`;
        sprintRows.push({
          id: sprint.id,
          name: sprint.name,
          dateRangeDisplay: formatDateRange(startM, endDisplayM),
          startDate: startM.format('MMM D, YYYY'),
          endDate: moment(sprint.endDate).format('MMM D, YYYY'),
          isActive,
          startedWith: inAtStart,
          endedWith: inAtEnd,
          done: completedDuring,
          completedPct,
          changeDisplay,
          creepDisplay,
          issues,
          fromReportApi: true,
        });
        continue;
      }

      // Changelog fallback: use zeros and no issues when report isn't available
      const startedWith = 0;
      const endedWith = 0;
      const done = 0;
      const removedAfterStart = 0;
      const addedAfterStart = 0;
      const completedPct = '—';
      const creepDisplay = startedWith > 0 ? '0%' : '—';
      const changeDisplay = `+ ${addedAfterStart} / - ${removedAfterStart}`;
      sprintRows.push({
        id: sprint.id,
        name: sprint.name,
        dateRangeDisplay: formatDateRange(startM, endDisplayM),
        startDate: startM.format('MMM D, YYYY'),
        endDate: moment(sprint.endDate).format('MMM D, YYYY'),
        isActive,
        startedWith,
        endedWith,
        done,
        completedPct,
        changeDisplay,
        creepDisplay,
        issues: [],
        fromReportApi: false,
      });
    }

    // Resolve account ids (ug:uuid or bare UUID) to display names: cache first, then issue API, then resolveAsync
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
    const resolved = new Map();
    for (const ug of needResolve) {
      const hit = userCache.get(ug);
      if (hit) resolved.set(ug, hit);
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
          const issues = searchRes.data?.issues || [];
          for (const iss of issues) {
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
          debugError('Creep: issue fetch for assignees failed', e?.message || e);
        }
      }
    }
    const stillNeed = [...needResolve].filter((ug) => !resolved.has(ug));
    await Promise.all(stillNeed.map(async (ug) => {
      const r = await userCache.resolveAsync(ug, jiraClient, config);
      resolved.set(ug, r);
    }));
    for (const row of sprintRows) {
      for (const issue of row.issues || []) {
        if (resolved.has(issue.assignee)) {
          const r = resolved.get(issue.assignee);
          issue.assignee = r.displayName;
          if (r.avatarUrl) issue.assigneeAvatarUrl = r.avatarUrl;
        }
      }
      // Primary sort: status; secondary: assignee (display name); tertiary: key
      if (row.issues && row.issues.length) {
        row.issues.sort((a, b) =>
          statusSortRank(a.status) - statusSortRank(b.status) ||
          (a.assignee || '').localeCompare(b.assignee || '') ||
          (a.key || '').localeCompare(b.key || ''));
      }
    }

    const totalSprintRows = sprintRows.length;
    const reportApiUsedCount = sprintRows.filter((r) => r.fromReportApi).length;

    const templateData = {
      sprintRows,
      totalSprintRows,
      reportApiUsedCount,
      noDateRows: [],
    };

    if (isHtmxRequest(req)) {
      return res.render('creep', templateData, (err, html) => {
        if (err) {
          debugError('Error rendering creep template', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<link rel="stylesheet" href="/css/routes/creep.css" hx-swap-oob="true" id="route-stylesheet">
<script src="/js/creep.js" hx-swap-oob="true" id="route-script"></script>
${html}`;
        res.send(response);
      });
    }
    return res.render('base', {
      title: 'Scope Creep',
      template: 'creep',
      templateData,
      stylesheet: '/css/routes/creep.css',
      script: '/js/creep.js',
    });
  } catch (err) {
    debugError('Creep route error', err);
    const templateData = {
      error: true,
      errorMessage: err.message,
      sprintRows: [],
      totalSprintRows: 0,
      reportApiUsedCount: 0,
      noDateRows: [],
    };
    if (isHtmxRequest(req)) {
      return res.render('creep', templateData, (renderErr, html) => {
        if (renderErr) return res.status(500).send('Error rendering page');
        res.send(html);
      });
    }
    return res.render('base', {
      title: 'Scope Creep',
      template: 'creep',
      templateData,
      stylesheet: '/css/routes/creep.css',
      script: '/js/creep.js',
    });
  }
});

module.exports = router;
