# Refactor Plan: Convert /done and /slow Routes to EJS Templates + htmx

## Overview
This plan refactors the `/done` and `/slow` routes to use EJS templates and htmx for SPA-like navigation. This is a test implementation to validate the architecture before converting remaining routes.

## Prerequisites
- Node.js 18+
- Existing Express app structure
- Jira API access configured

## Step 1: Install Dependencies

### 1.1 Install EJS template engine
```bash
npm install ejs
```

### 1.2 Install htmx via CDN
CDN (recommended for simplicity)**
- Add to base template (see Step 2)


## Step 2: Configure Express for EJS

### 2.1 Update `server.js` - Add EJS configuration
**Location**: After line 8 (after `const app = express();`)

**Add:**
```javascript
// Configure EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'templates'));
```

**Location**: After line 13 (after static file serving)

**Add:**
```javascript
// Serve htmx if using npm package (skip if using CDN)
// app.use('/js', express.static(path.join(__dirname, 'node_modules/htmx.org/dist')));
```

## Step 3: Create Directory Structure

### 3.1 Create directories
```bash
mkdir -p templates/partials
mkdir -p public/js
mkdir -p public/css/routes
```

### 3.2 File structure after refactoring
```
templates/
  ├── base.html (existing - will be updated)
  ├── nav.html (existing - will be updated)
  ├── partials/
  │   ├── period-selector.ejs (new)
  │   └── filter-bar.ejs (new)
  ├── slow.ejs (new)
  └── done.ejs (new)

public/
  ├── css/
  │   ├── common.css (existing)
  │   └── routes/
  │       ├── slow.css (new)
  │       └── done.css (new)
  └── js/
      ├── slow.js (new)
      └── done.js (new)
```

## Step 4: Update Base Template for htmx

### 4.1 Update `templates/base.html`
**Replace entire file with:**

```html
<!DOCTYPE html>
<html>
<head>
  <title><%= typeof title !== 'undefined' ? title : 'Jira Shame' %></title>
  <link rel="icon" type="image/png" href="/img/favico.png">
  <link rel="stylesheet" href="/css/common.css">
  <% if (typeof stylesheet !== 'undefined' && stylesheet) { %>
    <link rel="stylesheet" href="<%= stylesheet %>">
  <% } %>
  <% if (typeof additionalStyles !== 'undefined' && additionalStyles) { %>
    <%- additionalStyles %>
  <% } %>
</head>
<body>
  <%- include('nav') %>
  <div id="main-content" class="container">
    <%- typeof content !== 'undefined' ? content : '' %>
  </div>
  
  <!-- htmx from CDN -->
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  
  <!-- Route-specific scripts -->
  <% if (typeof script !== 'undefined' && script) { %>
    <script src="<%= script %>"></script>
  <% } %>
  <% if (typeof inlineScript !== 'undefined' && inlineScript) { %>
    <script><%- inlineScript %></script>
  <% } %>
</body>
</html>
```

## Step 5: Update Navigation for htmx

### 5.1 Update `templates/nav.html`
**Replace entire file with:**

```html
<div class="nav-links">
  <a href="/" 
     hx-get="/" 
     hx-target="#main-content" 
     hx-swap="innerHTML" 
     hx-push-url="true">Home</a>
  <a href="/slow" 
     hx-get="/slow" 
     hx-target="#main-content" 
     hx-swap="innerHTML" 
     hx-push-url="true">Slow Motion</a>
  <a href="/done" 
     hx-get="/done" 
     hx-target="#main-content" 
     hx-swap="innerHTML" 
     hx-push-url="true">Completed</a>
  <a href="/backlog" 
     hx-get="/backlog" 
     hx-target="#main-content" 
     hx-swap="innerHTML" 
     hx-push-url="true">Backlog</a>
  <a href="/progress" 
     hx-get="/progress" 
     hx-target="#main-content" 
     hx-swap="innerHTML" 
     hx-push-url="true">Progress</a>
  <a href="/load" 
     hx-get="/load" 
     hx-target="#main-content" 
     hx-swap="innerHTML" 
     hx-push-url="true">Load</a>
  <a href="/pr" 
     hx-get="/pr" 
     hx-target="#main-content" 
     hx-swap="innerHTML" 
     hx-push-url="true">Pull Requests</a>
</div>
```

## Step 6: Create Shared Partials

### 6.1 Create `templates/partials/period-selector.ejs`
```html
<div class="period-selector">
  <% const periods = [
    { key: 'this-sprint', label: 'This Sprint' },
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'this-week', label: 'This Week' },
    { key: 'last-7-days', label: 'Last 7 Days' },
    { key: 'this-month', label: 'This Month' },
    { key: 'last-month', label: 'Last Month' }
  ]; %>
  <% periods.forEach(p => { %>
    <a href="<%= basePath %>?period=<%= p.key %>" 
       class="<%= currentPeriod === p.key ? 'active' : '' %>"
       hx-get="<%= basePath %>?period=<%= p.key %>"
       hx-target="#main-content"
       hx-swap="innerHTML"
       hx-push-url="true"><%= p.label %></a>
  <% }); %>
</div>
```

### 6.2 Create `templates/partials/filter-bar.ejs`
```html
<div class="filter-bar">
  <span class="filter-label all active" data-filter="all" onclick="filterByAssignee('all', event)">All</span>
  <% assignees.forEach(assignee => { %>
    <% 
      const escapedAssignee = assignee.replace(/'/g, "&#39;").replace(/"/g, '&quot;');
      const jsSafeAssignee = assignee.replace(/'/g, "\\'").replace(/"/g, '\\"');
    %>
    <span class="filter-label" 
          data-filter="<%= escapedAssignee %>" 
          onclick="filterByAssignee('<%= jsSafeAssignee %>', event)"><%= assignee %></span>
  <% }); %>
</div>
```

## Step 7: Extract Stylesheets

### 7.1 Create `public/css/routes/slow.css`
**Extract all CSS from `/slow` route (lines 589-627 in server.js):**

```css
.container { max-width: 1600px; margin: 0 auto; }
.status-columns { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
.status-group { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); display: flex; flex-direction: column; min-height: 200px; }
.status-header { font-size: 1.2em; font-weight: bold; padding-bottom: 15px; border-bottom: 2px solid #dfe1e6; margin-bottom: 15px; display: flex; justify-content: space-between; }
.status-content { flex: 1; }
.ticket { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid #EBECF0; }
.ticket:last-child { border-bottom: none; }
.days-badge { 
  background: #dfe1e6; color: #42526E; 
  min-width: 50px; height: 50px; border-radius: 50%; 
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  margin-right: 20px; font-weight: bold; flex-shrink: 0;
}
.days-badge.warning { background: #FFFAE6; color: #BF2600; }
.days-badge.danger { background: #DE350B; color: white; }
.days-count { font-size: 18px; line-height: 1; }
.days-label { font-size: 9px; text-transform: uppercase; margin-top: 2px; }
.details { flex-grow: 1; }
.summary { color: #172B4D; }
.meta { font-size: 12px; color: #6B778C; margin-top: 4px; }
.pr-info { margin-top: 6px; }
.pr-link { display: inline-block; background: #E3FCEF; color: #006644; padding: 2px 8px; border-radius: 4px; margin-right: 6px; text-decoration: none; font-size: 11px; }
.pr-link:hover { background: #ABF5D1; }
.pr-status { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; margin-left: 4px; }
.pr-status.open { background: #DEEBFF; color: #0052CC; }
.pr-status.merged { background: #E3FCEF; color: #006644; }
.pr-status.closed { background: #FFEBE6; color: #BF2600; }
.pr-review-status { font-size: 10px; color: #6B778C; margin-left: 4px; }
.pr-review-status.needs-review { color: #BF2600; font-weight: 500; }
.pr-review-status.approved { color: #006644; }
@media (max-width: 1400px) {
  .status-columns { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 800px) {
  .status-columns { grid-template-columns: 1fr; }
}
```

### 7.2 Create `public/css/routes/done.css`
**Extract all CSS from `/done` route (lines 1112-1119 in server.js):**

```css
.container { max-width: 1400px; margin: 0 auto; }
.ticket { display: grid; grid-template-columns: 120px 1fr 150px 150px 140px; gap: 20px; align-items: center; }
.header-row { display: grid; grid-template-columns: 120px 1fr 150px 150px 140px; gap: 20px; }
.duration { font-weight: 600; color: #172B4D; }
.completed-date { font-size: 12px; color: #6B778C; }
```

## Step 8: Extract JavaScript

### 8.1 Create `public/js/slow.js`
**Extract JavaScript from `/slow` route (lines 628-667 in server.js):**

```javascript
function filterByAssignee(assignee, event) {
  document.querySelectorAll('.filter-label').forEach(label => {
    label.classList.remove('active');
  });
  if (event && event.target) {
    event.target.classList.add('active');
  } else {
    const filterValue = assignee === 'all' ? 'all' : assignee.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    const label = document.querySelector('.filter-label[data-filter="' + filterValue + '"]');
    if (label) label.classList.add('active');
  }
  const tickets = document.querySelectorAll('.ticket');
  tickets.forEach(ticket => {
    if (assignee === 'all') {
      ticket.classList.remove('hidden');
    } else {
      const ticketAssignee = ticket.getAttribute('data-assignee');
      const decodedAssignee = assignee.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const decodedTicketAssignee = ticketAssignee.replace(/&quot;/g, '"');
      if (decodedTicketAssignee === decodedAssignee) {
        ticket.classList.remove('hidden');
      } else {
        ticket.classList.add('hidden');
      }
    }
  });
  updateTicketCounts();
}

function updateTicketCounts() {
  const statusGroups = document.querySelectorAll('.status-group');
  statusGroups.forEach(group => {
    const visibleTickets = group.querySelectorAll('.ticket:not(.hidden)').length;
    const countSpan = group.querySelector('.status-header span:last-child');
    if (countSpan) {
      countSpan.textContent = visibleTickets + ' tickets';
    }
  });
}

// Re-initialize after htmx swap
document.body.addEventListener('htmx:afterSwap', function(evt) {
  if (evt.detail.target.id === 'main-content') {
    // Scripts are re-executed automatically, but ensure functions are available
    window.filterByAssignee = filterByAssignee;
    window.updateTicketCounts = updateTicketCounts;
  }
});
```

### 8.2 Create `public/js/done.js`
**Extract JavaScript from `/done` route (lines 1120-1157 in server.js):**

```javascript
function filterByAssignee(assignee, event) {
  document.querySelectorAll('.filter-label').forEach(label => {
    label.classList.remove('active');
  });
  if (event && event.target) {
    event.target.classList.add('active');
  } else {
    const filterValue = assignee === 'all' ? 'all' : assignee.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
    const label = document.querySelector('.filter-label[data-filter="' + filterValue + '"]');
    if (label) label.classList.add('active');
  }
  const tickets = document.querySelectorAll('.ticket');
  tickets.forEach(ticket => {
    if (assignee === 'all') {
      ticket.classList.remove('hidden');
    } else {
      const ticketAssignee = ticket.getAttribute('data-assignee');
      const decodedAssignee = assignee.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const decodedTicketAssignee = ticketAssignee.replace(/&quot;/g, '"');
      if (decodedTicketAssignee === decodedAssignee) {
        ticket.classList.remove('hidden');
      } else {
        ticket.classList.add('hidden');
      }
    }
  });
  updateTicketCount();
}

function updateTicketCount() {
  const visibleTickets = document.querySelectorAll('.ticket:not(.hidden)').length;
  const summaryElement = document.querySelector('.summary');
  if (summaryElement) {
    const periodLabel = summaryElement.getAttribute('data-period-label');
    if (periodLabel) {
      summaryElement.textContent = visibleTickets + ' ticket' + (visibleTickets !== 1 ? 's' : '') + ' completed in ' + periodLabel;
    }
  }
}

// Re-initialize after htmx swap
document.body.addEventListener('htmx:afterSwap', function(evt) {
  if (evt.detail.target.id === 'main-content') {
    window.filterByAssignee = filterByAssignee;
    window.updateTicketCount = updateTicketCount;
  }
});
```

## Step 9: Create EJS Templates

### 9.1 Create `templates/slow.ejs`
```html
<h1>SLOW MOTION</h1>
<p style="text-align: center; color: #6B778C; margin-bottom: 30px; font-size: 14px;">
  Tickets which have been in the same status for over 7 days
</p>

<%- include('partials/filter-bar', { assignees: allAssignees }) %>

<div class="status-columns">
  <% TARGET_STATUSES.forEach(status => { %>
    <% const list = grouped[status] || []; %>
    <div class="status-group">
      <div class="status-header">
        <span><%= status %></span>
        <span><%= list.length %> tickets</span>
      </div>
      <div class="status-content">
        <% if (list.length === 0) { %>
          <p style="color: #6B778C; text-align: center; padding: 20px;">No tickets</p>
        <% } else { %>
          <% list.forEach(i => { %>
            <div class="ticket" data-assignee="<%= i.assignee.replace(/"/g, '&quot;') %>">
              <div class="days-badge <%= i.badgeClass || '' %>">
                <span class="days-count"><%= i.days %></span>
                <span class="days-label">days</span>
              </div>
              <div class="details">
                <div>
                  <a href="<%= i.link %>" class="key" target="_blank"><%= i.key %></a>
                  <span class="issue-type-badge <%= i.issueType %>"><%= i.issueType %></span>
                  <span class="summary"><%= i.summary %></span>
                </div>
                <div class="meta">
                  <span class="assignee"><%= i.assignee %></span>
                </div>
                <% if (i.prs && i.prs.length > 0) { %>
                  <div class="pr-info">
                    <% i.prs.forEach(pr => { %>
                      <% 
                        let reviewText = '';
                        if (pr.needsReview) {
                          reviewText = `<span class="pr-review-status needs-review">⚠ Needs review (${pr.completedReviewCount || 0}/${pr.reviewerCount} completed)</span>`;
                        } else if (pr.approvedCount > 0) {
                          reviewText = `<span class="pr-review-status approved">✓ ${pr.approvedCount} approved</span>`;
                        } else if (pr.reviewerCount > 0 && pr.completedReviewCount === pr.reviewerCount) {
                          reviewText = `<span class="pr-review-status approved">✓ All reviews complete</span>`;
                        }
                      %>
                      <a href="<%= pr.url %>" class="pr-link" target="_blank">PR #<%= pr.number %></a>
                      <span class="pr-status <%= pr.status %>"><%= pr.status %></span>
                      <%- reviewText %>
                    <% }); %>
                  </div>
                <% } %>
              </div>
            </div>
          <% }); %>
        <% } %>
      </div>
    </div>
  <% }); %>
</div>
```

### 9.2 Create `templates/done.ejs`
```html
<h1>COMPLETED TICKETS</h1>
<%- include('partials/period-selector', { currentPeriod: period, basePath: '/done' }) %>
<p class="summary" data-period-label="<%= periodLabel %>">
  <%= processedIssues.length %> ticket<%= processedIssues.length !== 1 ? 's' : '' %> completed in <%= periodLabel %>
</p>

<%- include('partials/filter-bar', { assignees: allAssignees }) %>

<div class="tickets-list">
  <div class="header-row">
    <div>Key</div>
    <div>Summary</div>
    <div>Assignee</div>
    <div>Reporter</div>
    <div>Duration</div>
  </div>
  <div class="tickets-container">
    <% processedIssues.forEach(issue => { %>
      <div class="ticket" data-assignee="<%= issue.assignee.replace(/"/g, '&quot;') %>">
        <div>
          <a href="<%= issue.link %>" class="key" target="_blank"><%= issue.key %></a>
        </div>
        <div class="summary-text">
          <span class="issue-type-badge <%= issue.issueType %>"><%= issue.issueType %></span>
          <%= issue.summary %>
        </div>
        <div>
          <span class="assignee"><%= issue.assignee %></span>
        </div>
        <div>
          <span class="reporter"><%= issue.reporter %></span>
        </div>
        <div>
          <div class="duration"><%= issue.durationText %></div>
          <div class="completed-date">
            <%= issue.resolutionStatus === "Won't Do" ? "Won't Do" : 'Done' %> (<%= issue.completedDateFormatted %>)
          </div>
        </div>
      </div>
    <% }); %>
  </div>
</div>
```

## Step 10: Refactor Route Handlers

### 10.1 Add Helper Function to `server.js`
**Location**: After `renderPage()` function (around line 39)

**Add:**
```javascript
// Helper to detect htmx requests
function isHtmxRequest(req) {
  return req.headers['hx-request'] === 'true';
}

// Helper to render page (full or partial for htmx)
function renderRoute(req, res, template, data) {
  const isHtmx = isHtmxRequest(req);
  
  if (isHtmx) {
    // Return just the template content for htmx
    return res.render(template, data);
  } else {
    // Return full page with base template
    return res.render('base', {
      title: data.title || 'Jira Shame',
      content: '', // Will be rendered via include
      stylesheet: data.stylesheet,
      script: data.script,
      template: template,
      templateData: data
    });
  }
}
```

**Note**: We need to update base template to handle this pattern. See Step 10.2.

### 10.2 Update Base Template to Support Route Templates
**Update `templates/base.html` to include route template:**

```html
<!DOCTYPE html>
<html>
<head>
  <title><%= typeof title !== 'undefined' ? title : 'Jira Shame' %></title>
  <link rel="icon" type="image/png" href="/img/favico.png">
  <link rel="stylesheet" href="/css/common.css">
  <% if (typeof stylesheet !== 'undefined' && stylesheet) { %>
    <link rel="stylesheet" href="<%= stylesheet %>">
  <% } %>
</head>
<body>
  <%- include('nav') %>
  <div id="main-content" class="container">
    <% if (typeof template !== 'undefined' && template) { %>
      <%- include(template, typeof templateData !== 'undefined' ? templateData : {}) %>
    <% } else if (typeof content !== 'undefined') { %>
      <%- content %>
    <% } %>
  </div>
  
  <!-- htmx from CDN -->
  <script src="https://unpkg.com/htmx.org@1.9.10"></script>
  
  <!-- Route-specific scripts -->
  <% if (typeof script !== 'undefined' && script) { %>
    <script src="<%= script %>"></script>
  <% } %>
  <% if (typeof inlineScript !== 'undefined' && inlineScript) { %>
    <script><%- inlineScript %></script>
  <% } %>
</body>
</html>
```

### 10.3 Refactor `/slow` Route Handler
**Location**: `server.js` line 251

**Replace the entire `/slow` route handler (lines 251-748) with:**

```javascript
app.get('/slow', async (req, res) => {
  try {
    // [Keep all the data fetching logic from lines 253-575 - DO NOT CHANGE]
    // ... (all the Jira API calls and data processing remain the same)
    
    // 1-6. Keep all existing logic for fetching and processing issues
    // (Copy lines 253-575 exactly as-is)
    
    // 7. Render using EJS template
    const templateData = {
      TARGET_STATUSES: TARGET_STATUSES,
      grouped: grouped,
      allAssignees: allAssignees
    };
    
    if (isHtmxRequest(req)) {
      // Return partial HTML for htmx
      return res.render('slow', templateData);
    } else {
      // Return full page
      return res.render('base', {
        title: 'Stuck Tickets',
        template: 'slow',
        templateData: templateData,
        stylesheet: '/css/routes/slow.css',
        script: '/js/slow.js'
      });
    }
  } catch (error) {
    debugError(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});
```

**Important**: Keep ALL the data fetching and processing logic (lines 253-575). Only replace the rendering part (lines 588-742).

### 10.4 Refactor `/done` Route Handler
**Location**: `server.js` line 750

**Replace the rendering part of `/done` route (keep data fetching logic):**

**Find the section starting at line 1111 (where styles and content are generated) and replace with:**

```javascript
    // Generate HTML using EJS template
    const templateData = {
      period: period,
      periodLabel: periodLabel,
      processedIssues: processedIssues,
      allAssignees: allAssignees
    };
    
    if (isHtmxRequest(req)) {
      // Return partial HTML for htmx
      return res.render('done', templateData);
    } else {
      // Return full page
      return res.render('base', {
        title: `Completed Tickets - ${periodLabel}`,
        template: 'done',
        templateData: templateData,
        stylesheet: '/css/routes/done.css',
        script: '/js/done.js'
      });
    }
```

**Also update the empty state handlers (lines 870-876 and 890-896):**

```javascript
    if (issueKeys.length === 0) {
      const emptyData = {
        period: period,
        periodLabel: periodLabel,
        processedIssues: [],
        allAssignees: []
      };
      
      if (isHtmxRequest(req)) {
        return res.render('done', emptyData);
      } else {
        return res.render('base', {
          title: 'Completed Tickets',
          template: 'done',
          templateData: emptyData,
          stylesheet: '/css/routes/done.css',
          script: '/js/done.js'
        });
      }
    }
    
    // ... (keep all data fetching logic)
    
    if (issues.length === 0) {
      const emptyData = {
        period: period,
        periodLabel: periodLabel,
        processedIssues: [],
        allAssignees: []
      };
      
      if (isHtmxRequest(req)) {
        return res.render('done', emptyData);
      } else {
        return res.render('base', {
          title: 'Completed Tickets',
          template: 'done',
          templateData: emptyData,
          stylesheet: '/css/routes/done.css',
          script: '/js/done.js'
        });
      }
    }
```

**Update the done.ejs template to handle empty state:**

Add at the top of `templates/done.ejs`:
```html
<% if (processedIssues.length === 0) { %>
  <h1>Completed</h1>
  <%- include('partials/period-selector', { currentPeriod: period, basePath: '/done' }) %>
  <p style="color: #6B778C; margin-top: 40px;">No completed tickets found for <%= periodLabel %></p>
<% } else { %>
  <!-- existing template content -->
<% } %>
```

## Step 11: Remove Old Template Functions

### 11.1 Remove or Update `renderTemplate()` function
**Location**: `server.js` lines 16-27

**Option A**: Remove entirely (if not used elsewhere)
**Option B**: Keep for backward compatibility with other routes

### 11.2 Remove or Update `renderPage()` function
**Location**: `server.js` lines 33-39

**Keep for now** - other routes still use it. Will be removed in future refactoring.

### 11.3 Update `generatePeriodSelector()` function
**Location**: `server.js` lines 42-60

**Remove this function** - it's now handled by the EJS partial template.

**Search and replace all usages:**
- In `/done` route: Already handled by template
- In `/progress` route: Keep for now (not refactored yet)

## Step 12: Update package.json

### 12.1 Add EJS to dependencies
**File**: `package.json`

**Add to dependencies:**
```json
{
  "dependencies": {
    ...
    "ejs": "^3.1.9"
  }
}
```

## Step 13: Validation & Testing Strategy

### 13.0 Overview: Comparing Refactored Routes vs Main Branch

To ensure the refactored routes produce identical output to the main branch, we'll use a multi-layered validation approach:

1. **HTML Output Comparison** - Automated diff of rendered HTML
2. **Visual Comparison** - Side-by-side screenshots
3. **Functional Testing** - Behavior verification
4. **Network Request Comparison** - API calls should be identical
5. **Performance Comparison** - Load times and metrics

### 13.0.1 Setup for Comparison Testing

**Create a test script to compare outputs:**

Create `scripts/compare-routes.js`:
```javascript
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL_MAIN = process.env.MAIN_BRANCH_URL || 'http://localhost:3000';
const BASE_URL_REFACTORED = process.env.REFACTORED_URL || 'http://localhost:3001';
const OUTPUT_DIR = path.join(__dirname, '../test-outputs');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Normalize HTML for comparison (remove whitespace, normalize attributes)
function normalizeHTML(html) {
  return html
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/<!--.*?-->/g, '')
    .trim();
}

// Extract just the main content (for htmx comparison)
function extractMainContent(html) {
  const match = html.match(/<div[^>]*id=["']main-content["'][^>]*>(.*?)<\/div>/s);
  return match ? match[1] : html;
}

// Compare two HTML strings
function compareHTML(html1, html2, name) {
  const normalized1 = normalizeHTML(html1);
  const normalized2 = normalizeHTML(html2);
  
  if (normalized1 === normalized2) {
    console.log(`✅ ${name}: HTML matches`);
    return true;
  } else {
    console.log(`❌ ${name}: HTML differs`);
    
    // Save diffs
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${name}-main.html`),
      html1
    );
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${name}-refactored.html`),
      html2
    );
    
    // Save normalized versions for easier diff
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${name}-main-normalized.html`),
      normalized1
    );
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${name}-refactored-normalized.html`),
      normalized2
    );
    
    return false;
  }
}

// Test a route
async function testRoute(route, options = {}) {
  const { queryParams = '', extractContent = false } = options;
  const url = `${route}${queryParams}`;
  
  console.log(`\nTesting: ${url}`);
  
  try {
    const [mainResponse, refactoredResponse] = await Promise.all([
      axios.get(`${BASE_URL_MAIN}${url}`, { 
        headers: { 'User-Agent': 'Comparison-Test' },
        validateStatus: () => true 
      }),
      axios.get(`${BASE_URL_REFACTORED}${url}`, { 
        headers: { 'User-Agent': 'Comparison-Test' },
        validateStatus: () => true 
      })
    ]);
    
    if (mainResponse.status !== refactoredResponse.status) {
      console.log(`❌ Status codes differ: ${mainResponse.status} vs ${refactoredResponse.status}`);
      return false;
    }
    
    let mainHTML = mainResponse.data;
    let refactoredHTML = refactoredResponse.data;
    
    if (extractContent) {
      mainHTML = extractMainContent(mainHTML);
      refactoredHTML = extractMainContent(refactoredHTML);
    }
    
    const routeName = route.replace(/\//g, '_').replace(/^_/, '') || 'home';
    const testName = `${routeName}${queryParams.replace(/[?=&]/g, '_') || ''}`;
    
    return compareHTML(mainHTML, refactoredHTML, testName);
  } catch (error) {
    console.error(`Error testing ${url}:`, error.message);
    return false;
  }
}

// Run all tests
async function runTests() {
  console.log('Starting route comparison tests...');
  console.log(`Main branch: ${BASE_URL_MAIN}`);
  console.log(`Refactored: ${BASE_URL_REFACTORED}\n`);
  
  const results = [];
  
  // Test /slow route
  results.push(await testRoute('/slow'));
  
  // Test /done route with various periods
  results.push(await testRoute('/done'));
  results.push(await testRoute('/done', { queryParams: '?period=today' }));
  results.push(await testRoute('/done', { queryParams: '?period=yesterday' }));
  results.push(await testRoute('/done', { queryParams: '?period=this-week' }));
  results.push(await testRoute('/done', { queryParams: '?period=last-7-days' }));
  results.push(await testRoute('/done', { queryParams: '?period=this-month' }));
  results.push(await testRoute('/done', { queryParams: '?period=last-month' }));
  results.push(await testRoute('/done', { queryParams: '?period=this-sprint' }));
  
  // Test htmx requests (partial content)
  results.push(await testRoute('/slow', { 
    extractContent: true,
    headers: { 'HX-Request': 'true' }
  }));
  results.push(await testRoute('/done', { 
    extractContent: true,
    queryParams: '?period=today',
    headers: { 'HX-Request': 'true' }
  }));
  
  const passed = results.filter(r => r).length;
  const total = results.length;
  
  console.log(`\n\nResults: ${passed}/${total} tests passed`);
  
  if (passed === total) {
    console.log('✅ All tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Check test-outputs/ directory for diffs.');
    process.exit(1);
  }
}

runTests();
```

**Add to package.json scripts:**
```json
{
  "scripts": {
    "test:compare": "node scripts/compare-routes.js"
  }
}
```

### 13.0.2 Manual Side-by-Side Testing Setup

**Create a test guide document:**

Create `TESTING_GUIDE.md`:
```markdown
# Testing Guide: Refactored Routes vs Main Branch

## Setup

1. **Checkout main branch:**
   ```bash
   git checkout main
   npm install
   npm start
   # Runs on port 3000
   ```

2. **In another terminal, checkout refactored branch:**
   ```bash
   git checkout refactor/done-slow-htmx
   npm install
   PORT=3001 npm start
   # Runs on port 3001
   ```

3. **Open two browser windows side-by-side:**
   - Left: http://localhost:3000 (main branch)
   - Right: http://localhost:3001 (refactored branch)

## Visual Comparison Checklist

### /slow Route
- [ ] Same number of tickets displayed
- [ ] Same ticket order within each status group
- [ ] Same badge colors (grey/yellow/red)
- [ ] Same PR information displayed
- [ ] Filter bar shows same assignees
- [ ] Filtering by assignee works identically
- [ ] Status groups in same order
- [ ] Ticket counts match in headers

### /done Route
- [ ] Same number of tickets for each period
- [ ] Same ticket order (by ticket ID, descending)
- [ ] Period selector shows same active state
- [ ] Same duration text format
- [ ] Same completion dates
- [ ] Filter bar shows same assignees
- [ ] Filtering works identically
- [ ] Empty states match (when no tickets)

### Period Variations
Test each period option:
- [ ] `?period=today`
- [ ] `?period=yesterday`
- [ ] `?period=this-week`
- [ ] `?period=last-7-days`
- [ ] `?period=this-month`
- [ ] `?period=last-month`
- [ ] `?period=this-sprint`

### htmx Navigation
- [ ] Clicking nav links swaps content (no full reload)
- [ ] URL updates correctly
- [ ] Browser back button works
- [ ] Browser forward button works
- [ ] Direct URL access works (full page)
- [ ] Period selector links work with htmx
- [ ] Filtering still works after htmx swap
```

### 13.0.3 Automated HTML Comparison

**Run comparison script:**
```bash
# Set environment variables
export MAIN_BRANCH_URL=http://localhost:3000
export REFACTORED_URL=http://localhost:3001

# Run comparison
npm run test:compare
```

**What it does:**
- Fetches HTML from both versions
- Normalizes HTML (whitespace, attributes)
- Compares structure and content
- Saves diffs to `test-outputs/` if differences found
- Reports pass/fail for each route

### 13.0.4 Visual Regression Testing

**Take screenshots for comparison:**

Create `scripts/take-screenshots.js`:
```javascript
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function takeScreenshots() {
  const browser = await puppeteer.launch();
  const outputDir = path.join(__dirname, '../test-outputs/screenshots');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const routes = [
    '/slow',
    '/done',
    '/done?period=today',
    '/done?period=this-week',
    '/done?period=last-month'
  ];
  
  for (const route of routes) {
    // Main branch
    const page1 = await browser.newPage();
    await page1.goto(`http://localhost:3000${route}`, { waitUntil: 'networkidle0' });
    await page1.screenshot({ 
      path: path.join(outputDir, `main-${route.replace(/\//g, '_').replace(/\?/g, '_')}.png`),
      fullPage: true
    });
    await page1.close();
    
    // Refactored branch
    const page2 = await browser.newPage();
    await page2.goto(`http://localhost:3001${route}`, { waitUntil: 'networkidle0' });
    await page2.screenshot({ 
      path: path.join(outputDir, `refactored-${route.replace(/\//g, '_').replace(/\?/g, '_')}.png`),
      fullPage: true
    });
    await page2.close();
  }
  
  await browser.close();
  console.log('Screenshots saved to test-outputs/screenshots/');
}

takeScreenshots();
```

**Install puppeteer:**
```bash
npm install --save-dev puppeteer
```

**Add to package.json:**
```json
{
  "scripts": {
    "test:screenshots": "node scripts/take-screenshots.js"
  }
}
```

### 13.0.5 Network Request Comparison

**Verify API calls are identical:**

Use browser DevTools Network tab:
1. Open DevTools → Network tab
2. Load `/slow` on main branch
3. Note all API requests (Jira calls)
4. Load `/slow` on refactored branch
5. Compare:
   - Same number of requests
   - Same request URLs
   - Same response sizes (approximately)
   - Same timing (should be similar)

**Expected:** All API calls should be identical since we're only changing rendering, not data fetching.

### 13.0.6 Functional Testing Script

Create `scripts/functional-test.js`:
```javascript
const axios = require('axios');
const cheerio = require('cheerio');

async function functionalTest(route, options = {}) {
  const { queryParams = '' } = options;
  const url = `${route}${queryParams}`;
  
  try {
    const response = await axios.get(`http://localhost:3001${url}`);
    const $ = cheerio.load(response.data);
    
    const results = {
      route: url,
      hasHtmx: $('script[src*="htmx"]').length > 0,
      hasNav: $('.nav-links').length > 0,
      hasMainContent: $('#main-content').length > 0,
      stylesheetLoaded: $('link[href*="routes"]').length > 0,
      scriptLoaded: $('script[src*="js/"]').length > 0
    };
    
    // Route-specific checks
    if (route === '/slow') {
      results.hasFilterBar = $('.filter-bar').length > 0;
      results.hasStatusColumns = $('.status-columns').length > 0;
      results.ticketCount = $('.ticket').length;
    }
    
    if (route === '/done') {
      results.hasPeriodSelector = $('.period-selector').length > 0;
      results.hasFilterBar = $('.filter-bar').length > 0;
      results.hasTicketsList = $('.tickets-list').length > 0;
      results.ticketCount = $('.ticket').length;
    }
    
    return results;
  } catch (error) {
    return { route: url, error: error.message };
  }
}

async function runFunctionalTests() {
  const tests = [
    functionalTest('/slow'),
    functionalTest('/done'),
    functionalTest('/done', { queryParams: '?period=today' }),
    functionalTest('/done', { queryParams: '?period=this-week' })
  ];
  
  const results = await Promise.all(tests);
  console.log(JSON.stringify(results, null, 2));
}

runFunctionalTests();
```

**Install cheerio:**
```bash
npm install --save-dev cheerio
```

## Step 13: Testing Checklist

### 13.1 Functional Tests
- [ ] `/slow` route loads correctly (full page load)
- [ ] `/done` route loads correctly (full page load)
- [ ] Navigation from home to `/slow` works (htmx)
- [ ] Navigation from home to `/done` works (htmx)
- [ ] Navigation between `/slow` and `/done` works (htmx)
- [ ] Browser back button works correctly
- [ ] Browser forward button works correctly
- [ ] Direct URL access to `/slow` works (full page)
- [ ] Direct URL access to `/done` works (full page)
- [ ] Direct URL access to `/done?period=today` works
- [ ] Period selector links work (htmx swaps)
- [ ] Filter by assignee works on `/slow`
- [ ] Filter by assignee works on `/done`
- [ ] Filter persists after period change on `/done`
- [ ] No JavaScript console errors
- [ ] Styles load correctly for both routes
- [ ] PR information displays correctly on `/slow`

### 13.2 Edge Cases
- [ ] `/slow` with no tickets (empty state)
- [ ] `/done` with no tickets (empty state)
- [ ] `/done` with invalid period parameter
- [ ] Network error handling (if API fails)

### 13.3 Performance
- [ ] Initial page load time (should be similar)
- [ ] Navigation speed (should be faster with htmx)
- [ ] No full page reloads when navigating

## Step 14: Update Documentation

### 14.1 Update README.md
**Add section about new architecture:**

```markdown
## Architecture

The application uses:
- **EJS** for server-side templating
- **htmx** for SPA-like navigation without full page reloads
- **Express** for the web server

Routes are organized with:
- Templates in `templates/` directory
- Route-specific stylesheets in `public/css/routes/`
- Route-specific JavaScript in `public/js/`
```

## Step 15: PR Description Template

### 15.1 Create PR Description
```markdown
## Refactor: Convert /done and /slow Routes to EJS Templates + htmx

### Summary
This PR refactors the `/done` and `/slow` routes to use EJS templates and htmx for SPA-like navigation. This is a test implementation to validate the architecture before converting remaining routes.

### Changes
- ✅ Added EJS template engine
- ✅ Added htmx library (via CDN)
- ✅ Created EJS templates for `/slow` and `/done` routes
- ✅ Extracted route-specific CSS to separate files
- ✅ Extracted route-specific JavaScript to separate files
- ✅ Created reusable partial templates (period-selector, filter-bar)
- ✅ Updated navigation to use htmx attributes
- ✅ Updated base template to support EJS and htmx

### Files Changed
**New Files:**
- `templates/slow.ejs`
- `templates/done.ejs`
- `templates/partials/period-selector.ejs`
- `templates/partials/filter-bar.ejs`
- `public/css/routes/slow.css`
- `public/css/routes/done.css`
- `public/js/slow.js`
- `public/js/done.js`

**Modified Files:**
- `server.js` - Updated route handlers, added EJS config
- `templates/base.html` - Added htmx, EJS support
- `templates/nav.html` - Added htmx attributes
- `package.json` - Added ejs dependency

### Testing
- [x] All functional tests pass (see checklist in plan)
- [x] No JavaScript console errors
- [x] Styles load correctly
- [x] htmx navigation works
- [x] Browser history works
- [x] Direct URL access works

### Benefits
- Cleaner code organization (templates, styles, scripts separated)
- Faster navigation (no full page reloads)
- Better maintainability
- Foundation for refactoring remaining routes

### Next Steps
- Refactor remaining routes (`/progress`, `/backlog`, `/pr`, `/load`, `/`)
- Consider extracting more shared components
- Add loading indicators for htmx requests
```

## Implementation Notes

### Important Considerations

1. **Data Escaping**: EJS automatically escapes HTML by default when using `<%= %>`. Use `<%- %>` only when you need to output raw HTML (like the reviewText in slow.ejs).

2. **JavaScript Re-execution**: After htmx swaps, inline scripts in the swapped content are NOT re-executed. External scripts are. That's why we moved JS to external files and added htmx event listeners.

3. **Template Caching**: EJS caches templates in production by default. In development, you may want to disable caching:
   ```javascript
   if (process.env.NODE_ENV !== 'production') {
     app.set('view cache', false);
   }
   ```

4. **Error Handling**: Make sure error responses also work with htmx. Consider returning error templates instead of plain text.

5. **Loading States**: Consider adding htmx loading indicators:
   ```html
   <div id="htmx-indicator" class="htmx-indicator">Loading...</div>
   ```
   Then add `hx-indicator="#htmx-indicator"` to htmx links.

### Common Issues & Solutions

**Issue**: Templates not found
- **Solution**: Ensure `app.set('views', ...)` points to correct directory

**Issue**: Partials not found
- **Solution**: Partials should be in `templates/partials/` and referenced as `partials/filename`

**Issue**: JavaScript not working after htmx swap
- **Solution**: Ensure scripts are external files, not inline. Use htmx events to re-initialize if needed.

**Issue**: Styles not loading
- **Solution**: Check that stylesheet path is correct and file exists

**Issue**: htmx not working
- **Solution**: Check browser console for errors, verify htmx script loaded, check network tab for requests

## Completion Criteria

✅ All steps completed
✅ All tests passing
✅ No console errors
✅ Code follows existing patterns
✅ Documentation updated
✅ PR ready for review
