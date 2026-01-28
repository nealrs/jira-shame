/**
 * In-memory cache for Jira user display names and avatar URLs.
 * Keyed by accountId or "ug:uuid". Use seedFromJiraUser when you have a full
 * Jira user object; use resolveAsync to resolve "ug:..." or accountId to { displayName, avatarUrl }.
 * Jira can surface the same user as bare UUID or "ug:uuid"; we treat both and cross-hit the cache.
 */
const cache = new Map();

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const UG_UUID_RE = /^ug:[a-f0-9-]+$/i;
/** Jira Cloud accountId: numeric prefix + colon + uuid (e.g. 557058:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) */
const CLOUD_ACCOUNT_ID_RE = /^\d+:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function altKey(key) {
  if (!key || typeof key !== 'string') return null;
  const k = key.trim();
  if (UG_UUID_RE.test(k)) return k.replace(/^ug:/i, '');
  if (UUID_RE.test(k)) return 'ug:' + k;
  return null;
}

function get(accountIdOrUg) {
  if (!accountIdOrUg || typeof accountIdOrUg !== 'string') return null;
  const key = accountIdOrUg.trim();
  return cache.get(key) || (altKey(key) ? cache.get(altKey(key)) : null) || null;
}

function set(accountId, entry) {
  if (!accountId || typeof accountId !== 'string') return;
  const key = accountId.trim();
  const value = {
    displayName: entry.displayName != null ? String(entry.displayName) : 'Unknown',
    avatarUrl: entry.avatarUrl != null ? String(entry.avatarUrl) : null,
  };
  cache.set(key, value);
  const other = altKey(key);
  if (other) cache.set(other, value);
}

/**
 * Seed cache from a Jira API user/assignee object (e.g. issue.fields.assignee).
 * Accepts { accountId, displayName, avatarUrls } or similar.
 * Only stores when we have a real display name (not raw accountId) so we don't cache "ug:uuid" as the name.
 */
function seedFromJiraUser(jiraUser) {
  if (!jiraUser || typeof jiraUser !== 'object') return;
  const accountId = jiraUser.accountId || (typeof jiraUser === 'string' ? jiraUser : null);
  if (!accountId) return;
  const displayName = (jiraUser.displayName || jiraUser.name || '').toString().trim();
  if (!displayName || displayName === accountId) return;
  const urls = jiraUser.avatarUrls || {};
  const avatarUrl = urls['48x48'] || urls['32x32'] || urls['24x24'] || urls['16x16'] || null;
  set(accountId, { displayName, avatarUrl });
}

function userFromResponse(u, fallbackKey) {
  if (!u || typeof u !== 'object') return null;
  const urls = (u.avatarUrls && typeof u.avatarUrls === 'object') ? u.avatarUrls : {};
  const avatarUrl = urls['48x48'] || urls['32x32'] || urls['24x24'] || urls['16x16'] || null;
  const displayName = (u.displayName || u.name || '').toString().trim() || fallbackKey;
  return { displayName, avatarUrl };
}

/**
 * Resolve accountId or "ug:uuid" to { displayName, avatarUrl }.
 * Uses cache first; on miss tries several Jira API strategies (Cloud, bulk, Server/DC).
 */
async function resolveAsync(accountIdOrUg, jiraClient, config) {
  if (!accountIdOrUg || typeof accountIdOrUg !== 'string') {
    return { displayName: 'Unassigned', avatarUrl: null };
  }
  const key = accountIdOrUg.trim();
  const hit = cache.get(key);
  if (hit) return hit;

  const idsToTry = UG_UUID_RE.test(key)
    ? [key.replace(/^ug:/i, ''), key]
    : UUID_RE.test(key)
      ? [key, 'ug:' + key]
      : [key];

  const endpoints = [
    { url: '/rest/api/3/user', params: (id) => ({ accountId: id }) },
    { url: '/rest/api/3/user/bulk', params: (id) => ({ accountId: [id] }), pluck: (data) => (data && data.values && data.values[0]) || null },
    { url: '/rest/api/2/user', params: (id) => ({ accountId: id }) },
    { url: '/rest/api/2/user', params: (id) => ({ username: id }) },
  ];

  for (const accountId of idsToTry) {
    for (const ep of endpoints) {
      try {
        const res = await jiraClient.get(ep.url, {
          params: ep.params(accountId),
          validateStatus: (s) => s === 200,
        });
        const raw = res.data;
        const u = ep.pluck ? ep.pluck(raw) : raw;
        const entry = userFromResponse(u, key);
        if (entry) {
          set(accountId, entry);
          if (key !== accountId) cache.set(key, entry);
          return entry;
        }
      } catch (_) {
        continue;
      }
    }
  }
  return { displayName: key, avatarUrl: null };
}

/** True if the string looks like an account id (ug:uuid, bare UUID, or Cloud digits:uuid) that needs resolution. */
function isAccountId(s) {
  if (typeof s !== 'string' || !s.trim()) return false;
  const k = s.trim();
  return UG_UUID_RE.test(k) || UUID_RE.test(k) || CLOUD_ACCOUNT_ID_RE.test(k);
}

module.exports = {
  get,
  set,
  seedFromJiraUser,
  resolveAsync,
  isAccountId,
};
