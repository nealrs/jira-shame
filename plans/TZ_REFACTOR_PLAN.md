# Timezone (TZ) refactor plan

Use `TZ` / `config.timezone` everywhere “now” or period boundaries are used, so behavior is correct when the server runs in another timezone (e.g. UTC).

**DRY:** One shared `getTz()` in `_helpers.js`; all routes that need it import from there. No per-route `getTz` definitions.

---

## 1. Add dependency

**File:** `package.json`

Add `moment-timezone` so all routes can use it. Creep and contributor-stats already `require('moment-timezone')`; the rest currently use `moment` and will switch.

```diff
   "dependencies": {
     "axios": "^1.6.0",
     "dotenv": "^16.3.0",
     "ejs": "^3.1.9",
     "express": "^4.18.2",
     "moment": "^2.29.4"
+    "moment-timezone": "^0.5.45"
   },
```

Then run: `npm install`

---

## 2. Shared helper (DRY)

**File:** `routes/_helpers.js`

Add and export `getTz` so every route gets the same logic from one place.

**Add** (after the `config` require, before `module.exports`):

```js
function getTz() {
  return config.timezone || process.env.TZ || 'America/New_York';
}
```

**Change** `module.exports` to include `getTz`:

```diff
 module.exports = {
   isHtmxRequest,
   debugLog,
   debugWarn,
   debugError,
   TARGET_STATUSES,
   BOARD_ID,
   jiraClient,
   githubClient,
   config,
+  getTz,
   logger
 };
```

---

## 3. Routes that already use TZ — use shared getTz

These already use `moment-timezone` and a local `getTz`. Switch to `getTz` from `_helpers` and remove the local definition.

### 3a. `routes/creep.js`

**Change require and destructuring:**

```diff
- let BOARD_ID, jiraClient, config, isHtmxRequest, debugLog, debugError;
+ let BOARD_ID, jiraClient, config, isHtmxRequest, debugLog, debugError, getTz;
  try {
    const h = require('./_helpers');
    BOARD_ID = h.BOARD_ID;
    jiraClient = h.jiraClient;
    config = h.config;
    isHtmxRequest = h.isHtmxRequest;
    debugLog = h.debugLog;
    debugError = h.debugError;
+   getTz = h.getTz;
  } catch (e) {
    ...
+   getTz = () => process.env.TZ || 'America/New_York';
  }
```

**Remove** the local definition:

```diff
- const getTz = () => (config && config.timezone) || process.env.TZ || 'America/New_York';
-
  /** Canonical order for sorting issues by status. */
```

(No other logic changes in creep — it already uses `getTz()` everywhere it needs TZ.)

### 3b. `routes/contributor-stats.js`

**Change require and destructuring:**

```diff
- let BOARD_ID, jiraClient, config, isHtmxRequest, debugError;
+ let BOARD_ID, jiraClient, config, isHtmxRequest, debugError, getTz;
  try {
    const h = require('./_helpers');
    BOARD_ID = h.BOARD_ID;
    jiraClient = h.jiraClient;
    config = h.config;
    isHtmxRequest = h.isHtmxRequest;
    debugError = h.debugError;
+   getTz = h.getTz;
  } catch (e) {
    ...
+   getTz = () => process.env.TZ || 'America/New_York';
  }
```

**Remove** the local definition:

```diff
- const getTz = () => (config && config.timezone) || process.env.TZ || 'America/New_York';
-
  const DONE_STATUSES
```

---

## 4. `routes/done.js` — use TZ for all period logic

**Require and helper:**

```diff
- const moment = require('moment');
+ const moment = require('moment-timezone');
  const router = express.Router();
- const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config } = require('./_helpers');
+ const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config, getTz } = require('./_helpers');
```

**At the start of the period block** (right after `let useSprintFilter = false;`), set:

```diff
-   const now = moment();
+   const tz = getTz();
+   const now = moment().tz(tz);
```

**Replace every period `moment()` with `moment.tz(tz)`:**

| Current | Replacement |
|--------|-------------|
| `moment()` | `moment.tz(tz)` |
| `moment().subtract(1, 'year').startOf('day')` | `moment.tz(tz).subtract(1, 'year').startOf('day')` |
| `moment().endOf('day')` | `moment.tz(tz).endOf('day')` |
| `moment().startOf('day')` | `moment.tz(tz).startOf('day')` |
| `moment().subtract(1, 'day').startOf('day')` | `moment.tz(tz).subtract(1, 'day').startOf('day')` |
| `moment().subtract(1, 'day').endOf('day')` | `moment.tz(tz).subtract(1, 'day').endOf('day')` |
| `moment().startOf('week')` | `moment.tz(tz).startOf('week')` |
| `moment().endOf('week')` | `moment.tz(tz).endOf('week')` |
| `moment().subtract(6, 'days').startOf('day')` | `moment.tz(tz).subtract(6, 'days').startOf('day')` |
| `moment().startOf('month')` | `moment.tz(tz).startOf('month')` |
| `moment().endOf('month')` | `moment.tz(tz).endOf('month')` |
| `moment().subtract(1, 'month').startOf('month')` | `moment.tz(tz).subtract(1, 'month').startOf('month')` |
| `moment().subtract(1, 'month').endOf('month')` | `moment.tz(tz).subtract(1, 'month').endOf('month')` |

Apply these in the single `switch (period) { ... }` block (and the fallback `default`). No other logic changes in done.js.

---

## 5. `routes/progress.js` — use TZ for period logic

**Require and helper:**

```diff
- const moment = require('moment');
+ const moment = require('moment-timezone');
  const router = express.Router();
- const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config } = require('./_helpers');
+ const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config, getTz } = require('./_helpers');
```

**At the start of the period block** (after `let useSprintFilter = false;`):

```diff
-     const now = moment();
+     const tz = getTz();
+     const now = moment().tz(tz);
```

**Replace every `moment()` in the period logic** with `moment.tz(tz)` in the same way as done.js:

- `if (days && days > 0)` branch:  
  `moment().subtract(...)` / `moment().endOf('day')` → `moment.tz(tz).subtract(...)` / `moment.tz(tz).endOf('day')`
- Inside `switch (period)`: every `moment().startOf(...)` / `moment().endOf(...)` / `moment().subtract(...)` → `moment.tz(tz).startOf(...)` etc.

Same mapping as the table in section 4. No other logic changes.

---

## 6. `routes/load.js` — use TZ for “now” and active/future sprint logic

**Require and helper:**

```diff
- const moment = require('moment');
+ const moment = require('moment-timezone');
  const router = express.Router();
- const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config } = require('./_helpers');
+ const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config, getTz } = require('./_helpers');
```

**Where `const now = moment();` is used** (around line 351, inside the block that fetches sprints):

```diff
-     const now = moment();
+     const tz = getTz();
+     const now = moment().tz(tz);
```

**Active/future sprint logic** (same block, ~lines 357–366):

```diff
        if (sprint.startDate && sprint.endDate) {
-         const startDate = moment(sprint.startDate);
-         const endDate = moment(sprint.endDate);
+         const startDate = moment.tz(sprint.startDate, tz);
+         const endDate = moment.tz(sprint.endDate, tz);
          isActive = now.isBetween(startDate, endDate, null, '[]');
        }
        ...
-       if (!sprint.startDate || moment(sprint.startDate).isAfter(now)) {
+       if (!sprint.startDate || moment.tz(sprint.startDate, tz).isAfter(now)) {
```

**Display formatting** (lines 668–669, 829–830, 855–856): optional but consistent to format in TZ. For “MMM D, YYYY” display only, existing `moment(...)` is acceptable; for strict consistency use `moment.tz(..., tz).format(...)`. Plan: **use TZ for display** so “current sprint” and “upcoming” dates match the same zone.

- Around 668–669 (current sprint HTML):  
  `moment(currentSprint.startDate)` → `moment.tz(currentSprint.startDate, tz)`  
  and similarly for `endDate`. Variable `tz` must be in scope there (same handler, define `const tz = getTz();` near the top of the handler if not already).
- Same for 829–830 (`currentSprintData`) and 855–856 (`upcomingSprintsData`): use `moment.tz(..., tz).format('MMM D, YYYY')`.

**Where to set `tz` in load.js:**  
The “now” and active/future logic live inside a large handler. Add near the top of the handler (e.g. after the first `try {`):

```js
const tz = getTz();
```

Then use `tz` everywhere we parse or display dates in this route.

---

## 7. `routes/slow.js` — use TZ for “now” and sprint duration

**Require and helper:**

```diff
- const moment = require('moment');
+ const moment = require('moment-timezone');
  const router = express.Router();
- const { isHtmxRequest, debugLog, debugError, TARGET_STATUSES, BOARD_ID, jiraClient, config } = require('./_helpers');
+ const { isHtmxRequest, debugLog, debugError, TARGET_STATUSES, BOARD_ID, jiraClient, config, getTz } = require('./_helpers');
```

**Where “now” is used for “days in status”** (around line 171):

```diff
-     const now = moment();
+     const tz = getTz();
+     const now = moment().tz(tz);
```

(This is inside a `.map()`; `tz` can be computed once before the `.map()` and closed over, e.g. at the start of the processing block that contains this map.)

**Sprint duration** (lines 318–319):

```diff
        if (currentSprint.startDate && currentSprint.endDate) {
-         const start = moment(currentSprint.startDate);
-         const end = moment(currentSprint.endDate);
+         const start = moment.tz(currentSprint.startDate, tz);
+         const end = moment.tz(currentSprint.endDate, tz);
          sprintDurationDays = end.diff(start, 'days');
        }
```

Add `const tz = getTz();` once at the top of the handler so both the “now” block and the sprint-duration block can use it.

---

## 8. `routes/backlog.js` — use TZ for “now” (age)

**Require and helper:**

```diff
- const moment = require('moment');
+ const moment = require('moment-timezone');
  const router = express.Router();
- const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config } = require('./_helpers');
+ const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config, getTz } = require('./_helpers');
```

**Where “now” is used for age** (around line 240):

```diff
-   const now = moment();
+   const tz = getTz();
+   const now = moment().tz(tz);
```

Add near the start of the handler (e.g. before the logic that uses `now`).

---

## 9. `routes/pr.js` — use TZ for “now” (PR age)

**Require and helper:**

```diff
- const moment = require('moment');
+ const moment = require('moment-timezone');
  const router = express.Router();
- const { isHtmxRequest, debugLog, debugWarn, debugError, githubClient, config } = require('./_helpers');
+ const { isHtmxRequest, debugLog, debugWarn, debugError, githubClient, config, getTz } = require('./_helpers');
```

**Where `const now = moment();` is used** (around line 506):

```diff
-   const now = moment();
+   const tz = getTz();
+   const now = moment().tz(tz);
```

Use `tz` only for `now`; PR `createdAt` etc. can stay as parsed (UTC), and “age” will be “age from now in app TZ,” which is the desired behavior.

---

## 10. Summary table

| File               | Change |
|--------------------|--------|
| `package.json`     | Add `moment-timezone` dependency. |
| `routes/_helpers.js` | Add `getTz()`, export it. |
| `routes/creep.js`  | Use `getTz` from _helpers; remove local `getTz`. |
| `routes/contributor-stats.js` | Same as creep. |
| `routes/done.js`   | `moment` → `moment-timezone`; add `getTz`; all period `moment()` → `moment.tz(tz)`. |
| `routes/progress.js` | Same pattern as done. |
| `routes/load.js`   | `moment` → `moment-timezone`; add `getTz`; `now` and active/future sprint logic use `tz`; sprint date display use `moment.tz(..., tz)`. |
| `routes/slow.js`   | `moment` → `moment-timezone`; add `getTz`; `now` and sprint start/end use `tz`. |
| `routes/backlog.js` | `moment` → `moment-timezone`; add `getTz`; `now` uses `tz`. |
| `routes/pr.js`     | `moment` → `moment-timezone`; add `getTz`; `now` uses `tz`. |

---

## 11. Order of edits (recommended)

1. `package.json` — add dependency; run `npm install`.
2. `routes/_helpers.js` — add and export `getTz`.
3. `routes/creep.js` — use shared `getTz`, remove local one.
4. `routes/contributor-stats.js` — same.
5. `routes/done.js` — full TZ refactor for period logic.
6. `routes/progress.js` — full TZ refactor for period logic.
7. `routes/load.js` — TZ for `now`, active/future logic, and display.
8. `routes/slow.js` — TZ for `now` and sprint duration.
9. `routes/backlog.js` — TZ for `now`.
10. `routes/pr.js` — TZ for `now`.

No new files. No changes to templates, config (config already has `timezone`), or Docker.
