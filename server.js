require('dotenv').config();
const express = require('express');
const axios = require('axios');
const moment = require('moment');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use('/img', express.static('img'));
app.use('/css', express.static('public/css'));

// Template helper function
function renderTemplate(templateName, data = {}) {
  const templatePath = path.join(__dirname, 'templates', templateName);
  let html = fs.readFileSync(templatePath, 'utf8');
  
  // Replace placeholders
  Object.keys(data).forEach(key => {
    const regex = new RegExp(`{{${key}}}`, 'g');
    html = html.replace(regex, data[key] || '');
  });
  
  return html;
}

// Load common templates
const navTemplate = fs.readFileSync(path.join(__dirname, 'templates', 'nav.html'), 'utf8');
const baseTemplate = fs.readFileSync(path.join(__dirname, 'templates', 'base.html'), 'utf8');

function renderPage(title, content, additionalStyles = '') {
  return baseTemplate
    .replace('{{TITLE}}', title)
    .replace('{{NAV}}', navTemplate)
    .replace('{{STYLES}}', additionalStyles)
    .replace('{{CONTENT}}', content);
}

// Helper function to generate period selector
function generatePeriodSelector(currentPeriod, basePath) {
  const periods = [
    { key: 'this-sprint', label: 'This Sprint' },
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'this-week', label: 'This Week' },
    { key: 'last-7-days', label: 'Last 7 Days' },
    { key: 'this-month', label: 'This Month' },
    { key: 'last-month', label: 'Last Month' }
  ];
  
  return `
    <div class="period-selector">
      ${periods.map(p => 
        `<a href="${basePath}?period=${p.key}" class="${currentPeriod === p.key ? 'active' : ''}">${p.label}</a>`
      ).join('')}
    </div>
  `;
}

// Config
const JIRA_HOST = process.env.JIRA_HOST; 
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const BOARD_ID = process.env.BOARD_ID || 7;

// GitHub Config
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_ORG = process.env.GITHUB_ORG;

// The statuses you want to track
const TARGET_STATUSES = ['To Do', 'Ready for Development', 'In Progress', 'In Review'];

const jiraClient = axios.create({
  baseURL: `https://${JIRA_HOST}`,
  headers: {
    'Authorization': `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

const githubClient = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'jira-shame'
  }
});

const DEBUG = process.env.DEBUG ? process.env.DEBUG === 'true' : process.env.NODE_ENV !== 'production';
function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

function debugWarn(...args) {
  if (DEBUG) {
    console.warn(...args);
  }
}

function debugError(...args) {
  if (DEBUG) {
    console.error(...args);
  }
}

app.get('/', (req, res) => {
  const styles = `
    <style>
        .subtitle {
          text-align: center;
          color: #6B778C;
          font-size: 18px;
          margin-bottom: 60px;
        }
        .routes {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 30px;
          margin-top: 40px;
        }
        .route-card {
          background: white;
          border-radius: 8px;
          padding: 30px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .route-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .route-card h2 {
          margin-top: 0;
          margin-bottom: 15px;
          color: #172B4D;
          font-size: 24px;
        }
        .route-card p {
          color: #6B778C;
          line-height: 1.6;
          margin-bottom: 20px;
        }
        .route-link {
          display: inline-block;
          padding: 12px 24px;
          background: #0052CC;
          color: white;
          text-decoration: none;
          border-radius: 4px;
          font-weight: 500;
          transition: background 0.2s;
        }
        .route-link:hover {
          background: #0065FF;
        }
        .route-link.slow {
          background: #DE350B;
        }
        .route-link.slow:hover {
          background: #FF5630;
        }
        .icon {
          font-size: 32px;
          margin-bottom: 15px;
        }
      </style>
  `;
  
  const content = `
        <h1>The Blame Game</h1>
        <p class="subtitle"><em>It was the best of times. It was the worst of times.</em></p>
        
        <div class="routes">
          <div class="route-card">
            <div class="icon">🐌</div>
            <h2>SLOW MOTION</h2>
            <p>
              View tickets that have been stuck in the same status for 7+ days. 
              Filter by assignee to see who's responsible for stagnant work. 
              Tickets are grouped by status (To Do, Ready for Development, In Progress, In Review) 
              and color-coded based on how long they've been stuck.
            </p>
            <a href="/slow" class="route-link slow">View Stagnant Tickets</a>
          </div>
          
          <div class="route-card">
            <div class="icon">✅</div>
            <h2>COMPLETED TICKETS</h2>
            <p>
              See all tickets that were completed (Done or Won't Do) in a selected time period. 
              View completion times, assignees, and reporters. Filter by today, yesterday, 
              this week, this month, or last month. Tickets are grouped by assignee and 
              sorted by completion time.
            </p>
        <a href="/done" class="route-link">View Completed</a>
          </div>
          
          <div class="route-card">
            <div class="icon">⏰</div>
            <h2>BACKLOG</h2>
            <p>
              View all issues currently in the backlog (not in active sprint). See when each ticket was created, 
              its current status, and how long it's been open. Age is displayed in a human-readable format. 
              Includes statistics showing total issues, median age, and average age.
            </p>
        <a href="/backlog" class="route-link">View Backlog</a>
          </div>
      
      <div class="route-card">
        <div class="icon">📊</div>
        <h2>PROGRESS</h2>
        <p>
          Track recent progress by viewing issues that have changed status in a selected time period. 
          See where issues started and where they are now, along with assignee and priority changes. 
          Filter by today, yesterday, this week, this month, or last month.
        </p>
        <a href="/progress" class="route-link">View Progress</a>
        </div>
      
      <div class="route-card">
        <div class="icon">⚖️</div>
        <h2>LOAD</h2>
        <p>
          View ticket load distribution across team members. See how many tickets each team member 
          has in each board column, and upcoming sprint assignments to help balance sprint loads.
        </p>
        <a href="/load" class="route-link">View Load</a>
      </div>

      <div class="route-card">
        <div class="icon">🔀</div>
        <h2>PULL REQUESTS</h2>
        <p>
          View open pull requests across your GitHub org, including review status. If GitHub env vars
          aren’t configured, the page will show a helpful setup message.
        </p>
        <a href="/pr" class="route-link">View Pull Requests</a>
      </div>
    </div>
  `;
  
  res.send(renderPage('Jira Shame - Dashboard', content, styles));
});

app.get('/slow', async (req, res) => {
  try {
    // 1. Get project key from board configuration
    let projectKey = null;
    try {
      const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}`);
      if (boardResponse.data && boardResponse.data.location) {
        projectKey = boardResponse.data.location.projectKey;
      }
    } catch (error) {
      debugError('Error fetching board configuration:', error.message);
    }

    // If we couldn't get project key from board, try to get it from a sample issue
    if (!projectKey) {
      try {
        const sampleIssueResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
          params: {
            fields: 'key',
            maxResults: 1
          }
        });
        if (sampleIssueResponse.data.issues && sampleIssueResponse.data.issues.length > 0) {
          const issueKey = sampleIssueResponse.data.issues[0].key;
          projectKey = issueKey.split('-')[0]; // Extract project key from issue key (e.g., "ENG-123" -> "ENG")
      }
    } catch (error) {
        debugError('Error getting project key from sample issue:', error.message);
      }
    }
    
    // 2. Construct JQL for multiple statuses with current sprint filter
    const statusString = TARGET_STATUSES.map(s => `'${s}'`).join(',');
    
    // Build JQL query with current sprint filter using openSprints() JQL function
    let jqlQuery = `status in (${statusString})`;
    if (projectKey) {
      jqlQuery += ` AND project = "${projectKey}" AND sprint in openSprints()`;
    }
    
    // 3. Fetch Issues from Board
    const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
      params: {
        jql: jqlQuery,
        fields: 'key',
        maxResults: 100
      }
    });

    const issues = boardResponse.data.issues || [];
    debugLog(`Found ${issues.length} issues from board query`);

    if (issues.length === 0) {
      const content = '<h1>SLOW MOTION</h1><p style="text-align: center; color: #6B778C; margin-top: 40px;">No stagnant tickets found! 🎉</p>';
      return res.send(renderPage('Stuck Tickets', content));
    }

    // 4. Bulk fetch details using new /rest/api/3/search/jql endpoint
    const issueKeys = issues.map(i => i.key);
    
    // First, get basic issue data with the new endpoint
    const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
        jql: `key in (${issueKeys.join(',')})`,
      maxResults: 100,
      fields: ['summary', 'status', 'assignee', 'created', 'issuetype']
    });
    
    // Then fetch changelog, remote links (for PR info), and development info for each issue
    const issuesWithChangelog = await Promise.all(
      searchResponse.data.issues.map(async (issue) => {
        try {
          const [changelogResponse, remotelinksResponse, devInfoResponse] = await Promise.all([
            jiraClient.get(`/rest/api/3/issue/${issue.key}/changelog`).catch(() => ({ data: { values: [] } })),
            jiraClient.get(`/rest/api/3/issue/${issue.key}/remotelink`).catch(() => ({ data: [] })),
            // Try development info endpoint - may not be available in all Jira instances
            jiraClient.get(`/rest/dev-status/latest/issue/detail`, {
              params: { 
                issueId: issue.id || issue.key, 
                applicationType: 'GitHub', 
                dataType: 'pullrequest' 
              }
            }).catch(() => ({ data: { detail: [] } }))
          ]);
          
          // The changelog endpoint returns { values: [...] } not { histories: [...] }
          const histories = changelogResponse.data.values || [];
          const remotelinks = remotelinksResponse.data || [];
          const devInfo = devInfoResponse.data?.detail || [];
          
          return {
            ...issue,
            changelog: { histories: histories },
            remotelinks: remotelinks,
            devInfo: devInfo
          };
        } catch (error) {
          return {
            ...issue,
            changelog: { histories: [] },
            remotelinks: [],
            devInfo: []
          };
        }
      })
    );
    
    // Replace the issues array with the one that includes changelog and remotelinks
    searchResponse.data.issues = issuesWithChangelog;

    // 5. Process Issues
    const processedIssues = searchResponse.data.issues.map(issue => {
      const currentStatus = issue.fields.status.name;
      // Safely access changelog.histories with a fallback
      const history = issue.changelog?.histories || [];
      
      // Calculate TOTAL time spent in current status by summing all periods
      // Only count time when ticket was actually in the current status, not from ticket creation
      
      // Build a timeline of all status transitions from changelog
      const statusTransitions = [];

      if (history && Array.isArray(history)) {
      history.forEach(record => {
          if (record.items && Array.isArray(record.items)) {
        record.items.forEach(item => {
              if (item.field === 'status') {
                statusTransitions.push({
                  date: moment(record.created),
                  fromStatus: item.fromString,
                  toStatus: item.toString
                });
              }
            });
          }
        });
      }
      
      // Sort transitions by date (oldest first)
      statusTransitions.sort((a, b) => a.date.valueOf() - b.date.valueOf());
      
      // Calculate total days in current status
      let totalDaysInCurrentStatus = 0;
      const now = moment();
      let enteredCurrentStatusAt = null;
      
      // Check if ticket was created in current status (no transitions, or first transition is away from current)
      // We'll determine this by checking if there are no transitions, or if the first transition shows leaving current status
      let wasCreatedInCurrentStatus = false;
      if (statusTransitions.length === 0) {
        // No transitions means it's been in current status since creation
        wasCreatedInCurrentStatus = true;
        enteredCurrentStatusAt = moment(issue.fields.created);
      } else {
        // Check if first transition is away from current status (meaning it started in current)
        const firstTransition = statusTransitions[0];
        if (firstTransition.fromStatus === currentStatus) {
          wasCreatedInCurrentStatus = true;
          enteredCurrentStatusAt = moment(issue.fields.created);
        }
      }
      
      // Walk through all transitions
      for (const transition of statusTransitions) {
        const { fromStatus, toStatus, date } = transition;
        
        // If transitioning TO current status, start counting
        if (toStatus === currentStatus && fromStatus !== currentStatus) {
          enteredCurrentStatusAt = date;
        }
        // If transitioning AWAY FROM current status, add the period and stop counting
        else if (fromStatus === currentStatus && toStatus !== currentStatus) {
          if (enteredCurrentStatusAt !== null) {
            const daysInStatus = date.diff(enteredCurrentStatusAt, 'days');
            totalDaysInCurrentStatus += daysInStatus;
            enteredCurrentStatusAt = null;
          }
        }
      }
      
      // If still in current status (enteredCurrentStatusAt is not null), add time from last entry to now
      if (enteredCurrentStatusAt !== null) {
        const daysInStatus = now.diff(enteredCurrentStatusAt, 'days');
        totalDaysInCurrentStatus += daysInStatus;
      }
      
      const daysStuck = totalDaysInCurrentStatus;

      // Extract PR information from remote links and development info
      const prs = [];
      const remotelinks = issue.remotelinks || [];
      const devInfo = issue.devInfo || [];
      
      // First, try to get PR info from development info (more detailed)
      devInfo.forEach(detail => {
        if (detail.pullRequests && Array.isArray(detail.pullRequests)) {
          detail.pullRequests.forEach(pr => {
            if (pr.url && pr.url.includes('/pull/')) {
              const prMatch = pr.url.match(/\/pull\/(\d+)/);
              const prNumber = prMatch ? prMatch[1] : null;
              
              if (prNumber) {
                // Check review status from dev info
                const reviewers = pr.reviewers || [];
                const reviewerCount = reviewers.length;
                const approvedReviews = reviewers.filter(r => r.status === 'APPROVED') || [];
                const completedReviews = reviewers.filter(r => r.status && r.status !== 'PENDING' && r.status !== 'REQUESTED');
                
                // Only show "needs review" if there are assigned reviewers AND some haven't completed reviews
                const needsReview = reviewerCount > 0 && completedReviews.length < reviewerCount;
                
                prs.push({
                  url: pr.url,
                  number: prNumber,
                  title: pr.title || `PR #${prNumber}`,
                  status: pr.status?.toLowerCase() || 'open',
                  needsReview: needsReview,
                  approvedCount: approvedReviews.length,
                  reviewerCount: reviewerCount,
                  completedReviewCount: completedReviews.length
                });
              }
            }
          });
        }
      });
      
      // Fallback to remote links if dev info doesn't have PRs
      if (prs.length === 0) {
        remotelinks.forEach(link => {
          // Check if this is a GitHub PR link
          const relationship = (link.relationship || '').toLowerCase();
          const url = link.object?.url || '';
          const title = link.object?.title || '';
          
          if ((relationship.includes('pull') || relationship.includes('pr')) && 
              (url.includes('/pull/') || url.includes('/pulls/'))) {
            // Extract PR number from URL
            const prMatch = url.match(/\/pull\/(\d+)/);
            const prNumber = prMatch ? prMatch[1] : null;
            
            if (prNumber) {
              prs.push({
                url: url,
                number: prNumber,
                title: title || `PR #${prNumber}`,
                status: link.status?.resolved ? 'merged' : 'open',
                needsReview: false, // Unknown from remote links, don't show needs review
                approvedCount: 0,
                reviewerCount: 0,
                completedReviewCount: 0
              });
            }
          }
        });
      }

      // Get issue type
      const issueType = issue.fields.issuetype?.name || 'Task';
      const issueTypeLower = issueType.toLowerCase();

      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: currentStatus,
        assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
        days: daysStuck,
        link: `https://${JIRA_HOST}/browse/${issue.key}`,
        prs: prs,
        issueType: issueTypeLower
      };
    })
    .filter(issue => issue.days >= 7); // Only show issues that have been in status for at least 7 days

    debugLog(`After filtering out issues < 7 days: ${processedIssues.length} issues remaining`);

    // 5. Calculate sprint duration (in days) for badge styling
    // Try to get sprint duration from current sprint, otherwise default to 14 days
    let sprintDurationDays = 14; // Default to 2 weeks
    try {
      // Fetch current sprint from board to get duration
      const sprintsResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/sprint`, {
        params: {
          state: 'active',
          maxResults: 1
        }
      });
      if (sprintsResponse.data.values && sprintsResponse.data.values.length > 0) {
        const currentSprint = sprintsResponse.data.values[0];
        if (currentSprint.startDate && currentSprint.endDate) {
          const start = moment(currentSprint.startDate);
          const end = moment(currentSprint.endDate);
          sprintDurationDays = end.diff(start, 'days');
        }
        }
      } catch (error) {
        // Use default 14 days if sprint details can't be fetched
    }

    // Calculate badge thresholds and add badge class to each issue
    const twoSprintsDays = sprintDurationDays * 2;
    
    processedIssues.forEach(issue => {
      if (issue.days >= twoSprintsDays) {
        issue.badgeClass = 'danger'; // Red for 2+ sprints
      } else if (issue.days >= sprintDurationDays) {
        issue.badgeClass = 'warning'; // Yellow for 1+ sprint
      } else {
        issue.badgeClass = ''; // Grey (default) for less than 1 sprint
      }
    });

    // 6. Group by Status for the UI
    const grouped = processedIssues.reduce((acc, issue) => {
      if (!acc[issue.status]) acc[issue.status] = [];
      acc[issue.status].push(issue);
      return acc;
    }, {});

    // Sort each group by days (descending)
    Object.keys(grouped).forEach(key => {
      grouped[key].sort((a, b) => b.days - a.days);
    });

    // Get all unique assignees for the filter
    const allAssignees = [...new Set(processedIssues.map(issue => issue.assignee))].sort();

    // Helper function to get issue type icon
    const getIssueTypeIcon = (issueType) => {
      const icons = {
        'bug': '🐞',
        'story': '🔖',
        'task': '✓',
        'spike': '🧠'
      };
      return icons[issueType] || '✓';
    };

    // 7. Render HTML
    const styles = `
        <style>
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
        </style>
        <script>
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
        </script>
    `;
    
    const content = `
          <h1>SLOW MOTION</h1>
          <p style="text-align: center; color: #6B778C; margin-bottom: 30px; font-size: 14px;">
            Tickets which have been in the same status for over 7 days
          </p>
          
          <div class="filter-bar">
            <span class="filter-label all active" data-filter="all" onclick="filterByAssignee('all', event)">All</span>
            ${allAssignees.map(assignee => {
              const escapedAssignee = assignee.replace(/'/g, "&#39;").replace(/"/g, '&quot;');
              const jsSafeAssignee = assignee.replace(/'/g, "\\'").replace(/"/g, '\\"');
              return `<span class="filter-label" data-filter="${escapedAssignee}" onclick="filterByAssignee('${jsSafeAssignee}', event)">${assignee}</span>`;
            }).join('')}
          </div>
          
          <div class="status-columns">
          ${TARGET_STATUSES.map(status => {
            const list = grouped[status] || [];
            
            return `
              <div class="status-group">
                <div class="status-header">
                  <span>${status}</span>
                  <span>${list.length} tickets</span>
                </div>
                  <div class="status-content">
                    ${list.length === 0 ? '<p style="color: #6B778C; text-align: center; padding: 20px;">No tickets</p>' : list.map(i => {
                  return `
                    <div class="ticket" data-assignee="${i.assignee.replace(/"/g, '&quot;')}">
                          <div class="days-badge ${i.badgeClass || ''}">
                        <span class="days-count">${i.days}</span>
                        <span class="days-label">days</span>
                      </div>
                      <div class="details">
                        <div>
                          <a href="${i.link}" class="key" target="_blank">${i.key}</a>
                          <span class="issue-type-badge ${i.issueType}">${i.issueType}</span>
                          <span class="summary">${i.summary}</span>
                        </div>
                        <div class="meta">
                          <span class="assignee">${i.assignee}</span>
                        </div>
                            ${i.prs && i.prs.length > 0 ? `
                              <div class="pr-info">
                                ${i.prs.map(pr => {
                                  let reviewText = '';
                                  if (pr.needsReview) {
                                    reviewText = `<span class="pr-review-status needs-review">⚠ Needs review (${pr.completedReviewCount || 0}/${pr.reviewerCount} completed)</span>`;
                                  } else if (pr.approvedCount > 0) {
                                    reviewText = `<span class="pr-review-status approved">✓ ${pr.approvedCount} approved</span>`;
                                  } else if (pr.reviewerCount > 0 && pr.completedReviewCount === pr.reviewerCount) {
                                    reviewText = `<span class="pr-review-status approved">✓ All reviews complete</span>`;
                                  }
                                  return `
                                    <a href="${pr.url}" class="pr-link" target="_blank">PR #${pr.number}</a>
                                    <span class="pr-status ${pr.status}">${pr.status}</span>
                                    ${reviewText}
                                  `;
                                }).join('')}
                              </div>
                            ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
                      </div>
              </div>
            `;
          }).join('')}
              </div>
    `;

    res.send(renderPage('Stuck Tickets', content, styles));

  } catch (error) {
    debugError(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/done', async (req, res) => {
  try {
    const period = req.query.period || 'this-week'; // today, yesterday, this-week, last-7-days, this-month, last-month, this-sprint
    
    // Get project key for sprint filtering
    let projectKey = null;
    try {
      const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}`);
      if (boardResponse.data && boardResponse.data.location) {
        projectKey = boardResponse.data.location.projectKey;
      }
    } catch (error) {
      debugError('Error fetching board configuration:', error.message);
    }

    if (!projectKey) {
      try {
        const sampleIssueResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
          params: {
            fields: 'key',
            maxResults: 1
          }
        });
        if (sampleIssueResponse.data.issues && sampleIssueResponse.data.issues.length > 0) {
          const issueKey = sampleIssueResponse.data.issues[0].key;
          projectKey = issueKey.split('-')[0];
        }
      } catch (error) {
        debugError('Error getting project key from sample issue:', error.message);
      }
    }
    
    // Calculate date ranges based on period
    let startDate, endDate, periodLabel;
    let useSprintFilter = false;
    const now = moment();
    
    switch (period) {
      case 'this-sprint':
        // For "this sprint", we'll use sprint filter instead of date range
        useSprintFilter = true;
        periodLabel = 'This Sprint';
        // Still set dates to a wide range for the resolutiondate filter
        startDate = moment().subtract(1, 'year').startOf('day');
        endDate = moment().endOf('day');
        break;
      case 'today':
        startDate = moment().startOf('day');
        endDate = moment().endOf('day');
        periodLabel = 'Today';
        break;
      case 'yesterday':
        startDate = moment().subtract(1, 'day').startOf('day');
        endDate = moment().subtract(1, 'day').endOf('day');
        periodLabel = 'Yesterday';
        break;
      case 'this-week':
        startDate = moment().startOf('week');
        endDate = moment().endOf('week');
        periodLabel = 'This Week';
        break;
      case 'last-7-days':
        startDate = moment().subtract(6, 'days').startOf('day');
        endDate = moment().endOf('day');
        periodLabel = 'Last 7 Days';
        break;
      case 'this-month':
        startDate = moment().startOf('month');
        endDate = moment().endOf('month');
        periodLabel = 'This Month';
        break;
      case 'last-month':
        startDate = moment().subtract(1, 'month').startOf('month');
        endDate = moment().subtract(1, 'month').endOf('month');
        periodLabel = 'Last Month';
        break;
      default:
        startDate = moment().startOf('month');
        endDate = moment().endOf('month');
        periodLabel = 'This Month';
    }
    
    // Build JQL query for completed tickets
    // We'll query for tickets resolved in a slightly wider range to catch any edge cases
    // Both "Done" and "Won't Do" are considered completed states
    // We'll filter more precisely after getting the actual completion date from changelog
    // Exclude backlog items (only show tickets that are in sprints - closed, open, or future)
    const startDateStr = startDate.clone().subtract(1, 'day').format('YYYY-MM-DD');
    const endDateStr = endDate.clone().add(1, 'day').format('YYYY-MM-DD');
    let jqlQuery = `status in (Done, "Won't Do") AND resolutiondate >= "${startDateStr}" AND resolutiondate <= "${endDateStr}" AND sprint IS NOT EMPTY`;
    
    // Add sprint filter for "this sprint" period
    if (useSprintFilter && projectKey) {
      jqlQuery += ` AND project = "${projectKey}" AND sprint in openSprints()`;
    }
    
    // Fetch completed issues from board
    let issueKeys = [];
    try {
      const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
        params: {
          jql: jqlQuery,
          fields: 'key',
          maxResults: 200
        }
      });
      issueKeys = (boardResponse.data.issues || []).map(i => i.key);
    } catch (error) {
      debugError('Error fetching from board, trying direct search:', error.message);
      // Fallback: try direct search
      const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
        jql: jqlQuery,
        maxResults: 200,
        fields: ['key']
      });
      issueKeys = (searchResponse.data.issues || []).map(i => i.key);
    }
    
    debugLog(`Found ${issueKeys.length} completed issues for ${periodLabel}`);
    
    if (issueKeys.length === 0) {
      const content = `
        <h1>Completed</h1>
        ${generatePeriodSelector(period, '/done')}
            <p style="color: #6B778C; margin-top: 40px;">No completed tickets found for ${periodLabel}</p>
      `;
      return res.send(renderPage('Completed Tickets', content));
    }
    
    // Bulk fetch details using new /rest/api/3/search/jql endpoint
    // Note: sprint field might need to be expanded, but let's try without expand first
    const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
      jql: `key in (${issueKeys.join(',')})`,
      maxResults: 200,
      fields: ['summary', 'status', 'assignee', 'reporter', 'created', 'resolutiondate', 'issuetype', 'sprint', 'resolution']
    });
    
    const issues = searchResponse.data.issues || [];
    debugLog(`Found ${issues.length} completed issues for ${periodLabel}`);
    
    if (issues.length === 0) {
      const content = `
        <h1>Completed</h1>
        ${generatePeriodSelector(period, '/done')}
            <p style="color: #6B778C; margin-top: 40px;">No completed tickets found for ${periodLabel}</p>
      `;
      return res.send(renderPage('Completed Tickets', content));
    }
    
    // Fetch changelog for each issue to get exact completion time and check if it was in a sprint
    const issuesWithChangelog = await Promise.all(
      issues.map(async (issue) => {
        try {
          const changelogResponse = await jiraClient.get(`/rest/api/3/issue/${issue.key}/changelog`).catch(() => ({ data: { values: [] } }));
          const histories = changelogResponse.data.values || [];
          
          // Find when ticket was moved to Done or Won't Do, and track which status
          let doneDate = null;
          let resolutionStatus = null;
          
          // First, try to get resolution from resolution field (most reliable)
          if (issue.fields.resolution) {
            const resolutionName = issue.fields.resolution.name;
          }
          
          // Check current status - this is the most reliable
          if (issue.fields.status) {
            const currentStatus = issue.fields.status.name;
            const statusLower = currentStatus.toLowerCase();
            if (statusLower === 'done') {
              resolutionStatus = 'Done';
            } else if (statusLower === "won't do" || statusLower === "wont do") {
              resolutionStatus = "Won't Do";
            }
          }
          
          if (issue.fields.resolutiondate) {
            doneDate = moment(issue.fields.resolutiondate);
          } else {
            // Fallback: find in changelog
            for (const history of histories) {
              if (history.items && Array.isArray(history.items)) {
                for (const item of history.items) {
                  if (item.field === 'status') {
                    const toStatus = item.toString;
                    const toStatusLower = toStatus ? toStatus.toLowerCase() : '';
                    if (toStatusLower === 'done' || toStatusLower === "won't do" || toStatusLower === "wont do") {
                      doneDate = moment(history.created);
                      // Only set resolutionStatus from changelog if we don't already have it
                      if (!resolutionStatus) {
                        // Normalize to proper case
                        if (toStatusLower === 'done') {
                          resolutionStatus = 'Done';
                        } else {
                          resolutionStatus = "Won't Do";
                        }
                      }
                      break;
                    }
                  }
                }
              }
              if (doneDate) break;
            }
          }
          
          const finalDoneDate = doneDate || moment(issue.fields.resolutiondate || issue.fields.updated);
          // Default to Done if we couldn't determine
          if (!resolutionStatus) {
            resolutionStatus = 'Done';
          }
          
          // Find the latest sprint this ticket was in
          let latestSprintId = null;
          let latestSprintName = null;
          let latestSprintEndDate = null;
          
          if (issue.fields.sprint) {
            let sprintIds = [];
            
            // Handle different sprint field formats
            if (Array.isArray(issue.fields.sprint)) {
              sprintIds = issue.fields.sprint.map(sprint => {
                // Sprint can be an object with id property or just an id
                if (typeof sprint === 'object' && sprint !== null) {
                  return sprint.id || sprint;
                }
                return sprint;
              }).filter(id => id != null);
            } else if (typeof issue.fields.sprint === 'object' && issue.fields.sprint !== null) {
              // Single sprint object
              sprintIds = [issue.fields.sprint.id || issue.fields.sprint].filter(id => id != null);
            }
            
            if (sprintIds.length > 0) {
              // Fetch sprint details to find the latest one by end date
              const sprintDetails = await Promise.all(
                sprintIds.map(async (sprintId) => {
                  try {
                    const sprintResponse = await jiraClient.get(`/rest/agile/1.0/sprint/${sprintId}`);
                    return sprintResponse.data;
                  } catch (error) {
                    return null;
                  }
                })
              );
              
              // Filter out nulls and find the sprint with the latest end date
              const validSprints = sprintDetails.filter(s => s && s.endDate);
              if (validSprints.length > 0) {
                const latestSprint = validSprints.sort((a, b) => moment(b.endDate).valueOf() - moment(a.endDate).valueOf())[0];
                latestSprintId = latestSprint.id;
                latestSprintName = latestSprint.name;
                latestSprintEndDate = moment(latestSprint.endDate);
              }
            }
          }
          
          return {
            ...issue,
            changelog: { histories: histories },
            doneDate: finalDoneDate,
            resolutionStatus: resolutionStatus,
            latestSprintId: latestSprintId,
            latestSprintName: latestSprintName || 'Backlog',
            latestSprintEndDate: latestSprintEndDate
          };
        } catch (error) {
          // Try to get resolution status from current status
          let resolutionStatus = 'Done';
          if (issue.fields.status && issue.fields.status.name === "Won't Do") {
            resolutionStatus = "Won't Do";
          }
          
          return {
            ...issue,
            changelog: { histories: [] },
            doneDate: moment(issue.fields.resolutiondate || issue.fields.updated),
            resolutionStatus: resolutionStatus,
            latestSprintId: null,
            latestSprintName: 'Backlog',
            latestSprintEndDate: null
          };
        }
      })
    );
    
    // Process issues to calculate completion time and filter by actual completion date
    const processedIssues = issuesWithChangelog
      .map(issue => {
        const createdDate = moment(issue.fields.created);
        const doneDate = issue.doneDate;
        const daysToComplete = doneDate.diff(createdDate, 'days');
        const hoursToComplete = doneDate.diff(createdDate, 'hours');
        
        // Format duration
        let durationText;
        if (daysToComplete === 0) {
          durationText = `${hoursToComplete} hour${hoursToComplete !== 1 ? 's' : ''}`;
        } else if (daysToComplete < 7) {
          durationText = `${daysToComplete} day${daysToComplete !== 1 ? 's' : ''}`;
        } else {
          const weeks = Math.floor(daysToComplete / 7);
          const remainingDays = daysToComplete % 7;
          if (remainingDays === 0) {
            durationText = `${weeks} week${weeks !== 1 ? 's' : ''}`;
          } else {
            durationText = `${weeks} week${weeks !== 1 ? 's' : ''}, ${remainingDays} day${remainingDays !== 1 ? 's' : ''}`;
          }
        }
        
      // Format completion date as MM/DD/YY
      const completedDateFormatted = doneDate.format('MM/DD/YY');
      
      // Get issue type
      const issueType = issue.fields.issuetype?.name || 'Task';
      const issueTypeLower = issueType.toLowerCase();
      
      return {
        key: issue.key,
        summary: issue.fields.summary,
        assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
        reporter: issue.fields.reporter ? issue.fields.reporter.displayName : 'Unknown',
        created: createdDate.format('YYYY-MM-DD'),
        completed: doneDate.format('YYYY-MM-DD HH:mm'),
        completedDate: doneDate.format('YYYY-MM-DD'), // Just the date part for filtering
        completedDateFormatted: completedDateFormatted,
        resolutionStatus: issue.resolutionStatus || 'Done',
        daysToComplete: daysToComplete,
        durationText: durationText,
        link: `https://${JIRA_HOST}/browse/${issue.key}`,
        latestSprintName: issue.latestSprintName || 'Backlog',
        latestSprintEndDate: issue.latestSprintEndDate,
        issueType: issueTypeLower
      };
      })
      // Filter by actual completion date (not resolutiondate from JQL)
      .filter(issue => {
        const issueCompletedDate = moment(issue.completedDate);
        // Check if the completion date falls within the selected period
        return issueCompletedDate.isSameOrAfter(startDate, 'day') && issueCompletedDate.isSameOrBefore(endDate, 'day');
      });
    
    // Sort by ticket ID (extract numeric part, higher numbers = more recent = first)
    processedIssues.sort((a, b) => {
      // Extract numeric part from ticket key (e.g., "ENG-2256" -> 2256)
      const extractTicketNumber = (key) => {
        const match = key.match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      };
      
      const aNum = extractTicketNumber(a.key);
      const bNum = extractTicketNumber(b.key);
      
      // Sort descending (higher ticket numbers first)
      return bNum - aNum;
    });
    
    // Get all unique assignees for the filter
    const allAssignees = [...new Set(processedIssues.map(issue => issue.assignee))].sort();
    
    // Generate HTML
    const styles = `
        <style>
          .container { max-width: 1400px; margin: 0 auto; }
        .ticket { display: grid; grid-template-columns: 120px 1fr 150px 150px 140px; gap: 20px; align-items: center; }
        .header-row { display: grid; grid-template-columns: 120px 1fr 150px 150px 140px; gap: 20px; }
          .duration { font-weight: 600; color: #172B4D; }
          .completed-date { font-size: 12px; color: #6B778C; }
        </style>
        <script>
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
              const periodLabel = '${periodLabel}';
              summaryElement.textContent = visibleTickets + ' ticket' + (visibleTickets !== 1 ? 's' : '') + ' completed in ' + periodLabel;
            }
          }
        </script>
    `;
    
    const content = `
          <h1>COMPLETED TICKETS</h1>
      ${generatePeriodSelector(period, '/done')}
          <p class="summary">${processedIssues.length} ticket${processedIssues.length !== 1 ? 's' : ''} completed in ${periodLabel}</p>
          
          <div class="filter-bar">
            <span class="filter-label all active" data-filter="all" onclick="filterByAssignee('all', event)">All</span>
            ${allAssignees.map(assignee => {
              const escapedAssignee = assignee.replace(/'/g, "&#39;").replace(/"/g, '&quot;');
              const jsSafeAssignee = assignee.replace(/'/g, "\\'").replace(/"/g, '\\"');
              return `<span class="filter-label" data-filter="${escapedAssignee}" onclick="filterByAssignee('${jsSafeAssignee}', event)">${assignee}</span>`;
            }).join('')}
          </div>
          
          <div class="tickets-list">
            <div class="header-row">
              <div>Key</div>
              <div>Summary</div>
              <div>Assignee</div>
              <div>Reporter</div>
              <div>Duration</div>
            </div>
            <div class="tickets-container">
            ${processedIssues.map(issue => `
              <div class="ticket" data-assignee="${issue.assignee.replace(/"/g, '&quot;')}">
                <div>
                  <a href="${issue.link}" class="key" target="_blank">${issue.key}</a>
                </div>
                <div class="summary-text">
                  <span class="issue-type-badge ${issue.issueType}">${issue.issueType}</span>
                  ${issue.summary}
                </div>
                <div>
                  <span class="assignee">${issue.assignee}</span>
                </div>
                <div>
                  <span class="reporter">${issue.reporter}</span>
                </div>
                <div>
                  <div class="duration">${issue.durationText}</div>
                  <div class="completed-date">${issue.resolutionStatus === "Won't Do" ? "Won't Do" : 'Done'} (${issue.completedDateFormatted})</div>
                </div>
              </div>
            `).join('')}
            </div>
          </div>
    `;

    res.send(renderPage(`Completed Tickets - ${periodLabel}`, content, styles));

  } catch (error) {
    debugError(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/progress', async (req, res) => {
  try {
    const period = req.query.period || 'last-7-days'; // today, yesterday, this-week, last-7-days, this-month, last-month, this-sprint
    const days = req.query.days ? parseInt(req.query.days) : null; // Optional: custom number of days
    
    // Get project key for sprint filtering
    let projectKey = null;
    try {
      const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}`);
      if (boardResponse.data && boardResponse.data.location) {
        projectKey = boardResponse.data.location.projectKey;
      }
    } catch (error) {
      debugError('Error fetching board configuration:', error.message);
    }

    if (!projectKey) {
      try {
        const sampleIssueResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
        params: {
            fields: 'key',
            maxResults: 1
          }
        });
        if (sampleIssueResponse.data.issues && sampleIssueResponse.data.issues.length > 0) {
          const issueKey = sampleIssueResponse.data.issues[0].key;
          projectKey = issueKey.split('-')[0];
        }
      } catch (error) {
        debugError('Error getting project key from sample issue:', error.message);
      }
    }
    
    // Calculate date ranges based on period
    let startDate, endDate, periodLabel;
    let useSprintFilter = false;
      const now = moment();
      
    if (days && days > 0) {
      startDate = moment().subtract(days - 1, 'days').startOf('day');
      endDate = moment().endOf('day');
      periodLabel = `Last ${days} Days`;
    } else {
      switch (period) {
        case 'this-sprint':
          // For "this sprint", we'll use sprint filter instead of date range
          useSprintFilter = true;
          periodLabel = 'This Sprint';
          // Still set dates to a wide range for the updated filter
          startDate = moment().subtract(1, 'year').startOf('day');
          endDate = moment().endOf('day');
          break;
        case 'today':
          startDate = moment().startOf('day');
          endDate = moment().endOf('day');
          periodLabel = 'Today';
          break;
        case 'yesterday':
          startDate = moment().subtract(1, 'day').startOf('day');
          endDate = moment().subtract(1, 'day').endOf('day');
          periodLabel = 'Yesterday';
          break;
        case 'this-week':
          startDate = moment().startOf('week');
          endDate = moment().endOf('week');
          periodLabel = 'This Week';
          break;
        case 'last-7-days':
          startDate = moment().subtract(6, 'days').startOf('day');
          endDate = moment().endOf('day');
          periodLabel = 'Last 7 Days';
          break;
        case 'this-month':
          startDate = moment().startOf('month');
          endDate = moment().endOf('month');
          periodLabel = 'This Month';
          break;
        case 'last-month':
          startDate = moment().subtract(1, 'month').startOf('month');
          endDate = moment().subtract(1, 'month').endOf('month');
          periodLabel = 'Last Month';
          break;
        default:
          startDate = moment().subtract(6, 'days').startOf('day');
          endDate = moment().endOf('day');
          periodLabel = 'Last 7 Days';
      }
    }
    
    // Build JQL query for issues updated in the time period (include all statuses)
    // Use start of day for start date and start of next day for end date to capture full day range
    // Jira's updated field is datetime, so we need to ensure we get the full day
    const startDateStr = startDate.format('YYYY-MM-DD');
    const endDateNextDay = endDate.clone().add(1, 'day').format('YYYY-MM-DD');
    let jqlQuery = `updated >= "${startDateStr}" AND updated < "${endDateNextDay}"`;
    
    // Add sprint filter for "this sprint" period
    if (useSprintFilter && projectKey) {
      jqlQuery += ` AND project = "${projectKey}" AND sprint in openSprints()`;
    }
    
    // Fetch issues from board
    let issueKeys = [];
    try {
      const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
        params: {
          jql: jqlQuery,
          fields: 'key',
          maxResults: 200
        }
      });
      issueKeys = (boardResponse.data.issues || []).map(i => i.key);
    } catch (error) {
      debugError('Error fetching from board, trying direct search:', error.message);
      // Fallback: try direct search
      const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
        jql: jqlQuery,
        maxResults: 200,
        fields: ['key']
      });
      issueKeys = (searchResponse.data.issues || []).map(i => i.key);
    }
    
    debugLog(`Found ${issueKeys.length} updated issues for ${periodLabel}`);
    
    if (issueKeys.length === 0) {
      const content = `
        <h1>Progress</h1>
        ${generatePeriodSelector(period, '/progress')}
        <p style="color: #6B778C; margin-top: 40px;">No issues with changes found for ${periodLabel}</p>
      `;
      return res.send(renderPage('Progress Report', content));
    }
    
    // Bulk fetch details with changelog
    const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
      jql: `key in (${issueKeys.join(',')})`,
      maxResults: 200,
      fields: ['summary', 'status', 'assignee', 'priority', 'created', 'updated', 'issuetype', 'reporter']
    });
    
    const issues = searchResponse.data.issues || [];
    debugLog(`Fetched ${issues.length} issues for ${periodLabel}`);
    
    // Fetch changelog for each issue to analyze transitions
    const issuesWithChangelog = await Promise.all(
      issues.map(async (issue) => {
        try {
          const changelogResponse = await jiraClient.get(`/rest/api/3/issue/${issue.key}/changelog`).catch(() => ({ data: { values: [] } }));
          const histories = changelogResponse.data.values || [];
          
          return {
            ...issue,
            changelog: { histories: histories }
          };
        } catch (error) {
          return {
            ...issue,
            changelog: { histories: [] }
          };
        }
      })
    );
    
    // Process issues to find status transitions, assignee changes, and priority changes
    const processedIssues = issuesWithChangelog
      .map(issue => {
        const histories = issue.changelog?.histories || [];
        const currentStatus = issue.fields.status.name;
        const currentAssignee = issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned';
        const currentPriority = issue.fields.priority ? issue.fields.priority.name : 'Unset';
        const currentIssueType = issue.fields.issuetype?.name || 'Task';
        const reporter = issue.fields.reporter ? issue.fields.reporter.displayName : 'Unknown';
        
        // Find all status transitions within the time period
        const statusTransitions = [];
        const assigneeChanges = [];
        const priorityChanges = [];
        const issueTypeChanges = [];
        
        // Track initial values (before the period)
        let initialStatus = currentStatus;
        let initialAssignee = currentAssignee;
        let initialPriority = currentPriority;
        let initialIssueType = currentIssueType;
        
        // Sort histories by date (oldest first)
        const sortedHistories = [...histories].sort((a, b) => moment(a.created).valueOf() - moment(b.created).valueOf());
        
        // Find the status/assignee/priority/issuetype at the start of the period
        // Walk through all histories before the period to find the state at period start
        for (const history of sortedHistories) {
          const historyDate = moment(history.created);
          if (historyDate.isBefore(startDate)) {
            // This change happened before our period, update initial values
            if (history.items && Array.isArray(history.items)) {
              history.items.forEach(item => {
                if (item.field === 'status') {
                  initialStatus = item.toString || initialStatus;
                } else if (item.field === 'assignee') {
                  initialAssignee = item.toString || initialAssignee;
                } else if (item.field === 'priority') {
                  initialPriority = item.toString || initialPriority;
                } else if (item.field === 'issuetype') {
                  initialIssueType = item.toString || initialIssueType;
                }
              });
            }
          }
        }
        
        // If issue was created during the period, use the first transition's "from" status as initial
        const createdDate = moment(issue.fields.created);
        if (createdDate.isSameOrAfter(startDate) && statusTransitions.length > 0) {
          initialStatus = statusTransitions[0].fromStatus || initialStatus;
        }
        
        // Now find changes within the period
        for (const history of sortedHistories) {
          const historyDate = moment(history.created);
          
          // Only process changes within our time period
          if (historyDate.isSameOrAfter(startDate) && historyDate.isSameOrBefore(endDate)) {
            if (history.items && Array.isArray(history.items)) {
              history.items.forEach(item => {
                if (item.field === 'status') {
                  const fromStatus = item.fromString || 'Unknown';
                  const toStatus = item.toString || 'Unknown';
                  // Only track if status actually changed
                  if (fromStatus !== toStatus) {
                    statusTransitions.push({
                      date: historyDate,
                      fromStatus: fromStatus,
                      toStatus: toStatus
                    });
                  }
                } else if (item.field === 'assignee') {
                  assigneeChanges.push({
                    date: historyDate,
                    from: item.fromString || 'Unassigned',
                    to: item.toString || 'Unassigned'
                  });
                } else if (item.field === 'priority') {
                  priorityChanges.push({
                    date: historyDate,
                    from: item.fromString || 'Unset',
                    to: item.toString || 'Unset'
                  });
                } else if (item.field === 'issuetype') {
                  issueTypeChanges.push({
                    date: historyDate,
                    from: item.fromString || 'Task',
                    to: item.toString || 'Task'
                  });
                }
              });
            }
          }
        }
        
        // Check for any changes (status, assignee, priority, or type)
        const hasStatusChange = statusTransitions.length > 0 && initialStatus !== currentStatus;
        const hasAssigneeChange = assigneeChanges.length > 0 || initialAssignee !== currentAssignee;
        const hasPriorityChange = priorityChanges.length > 0 || initialPriority !== currentPriority;
        const hasIssueTypeChange = issueTypeChanges.length > 0 || initialIssueType !== currentIssueType;
        
        // Include issue if ANY change occurred
        const hasAnyChange = hasStatusChange || hasAssigneeChange || hasPriorityChange || hasIssueTypeChange;
        
        // Determine start and end status
        // Start status: what it was at the beginning of the period
        // End status: what it is now (current status)
        // This way, if an issue went through multiple transitions, we show the overall change
        const startStatus = initialStatus;
        const endStatus = currentStatus;
        const transitionDate = statusTransitions.length > 0 
          ? statusTransitions[statusTransitions.length - 1].date 
          : null;
        
        // Get issue type
        const issueType = issue.fields.issuetype?.name || 'Task';
        const issueTypeLower = issueType.toLowerCase();
        const initialIssueTypeLower = initialIssueType.toLowerCase();
        
        return {
          key: issue.key,
          summary: issue.fields.summary,
          startStatus: startStatus,
          endStatus: endStatus,
          hasStatusChange: hasStatusChange,
          hasAssigneeChange: hasAssigneeChange,
          hasPriorityChange: hasPriorityChange,
          hasIssueTypeChange: hasIssueTypeChange,
          hasAnyChange: hasAnyChange,
          statusTransitions: statusTransitions,
          assigneeChanges: assigneeChanges,
          priorityChanges: priorityChanges,
          issueTypeChanges: issueTypeChanges,
          initialAssignee: initialAssignee,
          currentAssignee: currentAssignee,
          initialPriority: initialPriority,
          currentPriority: currentPriority,
          initialIssueType: initialIssueTypeLower,
          currentIssueType: issueTypeLower,
          reporter: reporter,
          transitionDate: transitionDate,
          updated: moment(issue.fields.updated),
          link: `https://${JIRA_HOST}/browse/${issue.key}`,
          issueType: issueTypeLower
        };
      })
      // Filter to include issues with ANY change (status, assignee, priority, or type)
      .filter(issue => issue.hasAnyChange)
      // Sort by transition date (most recent first)
      .sort((a, b) => {
        const aDate = a.transitionDate || a.updated;
        const bDate = b.transitionDate || b.updated;
        return bDate.valueOf() - aDate.valueOf();
      });
    
    debugLog(`Found ${processedIssues.length} issues with status changes for ${periodLabel}`);
    
    // Generate HTML
    const styles = `
      <style>
        .container { max-width: 1600px; margin: 0 auto; }
        .ticket { display: grid; grid-template-columns: 120px minmax(200px, 1fr) 150px 150px minmax(250px, 1fr); gap: 20px; align-items: start; }
        .header-row { display: grid; grid-template-columns: 120px minmax(200px, 1fr) 150px 150px minmax(250px, 1fr); gap: 20px; }
        .changes-column { font-size: 13px; line-height: 1.6; }
        .change-item { margin-bottom: 6px; }
        .change-item:last-child { margin-bottom: 0; }
        .change-item strong { color: #172B4D; font-weight: 600; margin-right: 4px; }
        .status-badge { display: inline-block; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; white-space: nowrap; }
        .status-badge.from { background: #FFEBE6; color: #BF2600; }
        .status-badge.to { background: #E3FCEF; color: #006644; }
        .status-arrow { color: #6B778C; font-size: 14px; margin: 0 4px; }
        .assignee-change, .priority-change, .type-change { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; white-space: nowrap; }
        .assignee-change { background: #DEEBFF; color: #0052CC; }
        .priority-change { background: #FFF4E6; color: #974F00; }
        .type-change { background: #EAE6FF; color: #403294; }
      </style>
    `;
    
    const content = `
      <h1>PROGRESS REPORT</h1>
      ${generatePeriodSelector(period, '/progress')}
      <p class="summary">${processedIssues.length} issue${processedIssues.length !== 1 ? 's' : ''} with changes in ${periodLabel}</p>
      
      <div class="tickets-list">
        <div class="header-row">
          <div>Key</div>
          <div>Summary</div>
          <div>Assignee</div>
          <div>Reporter</div>
          <div>Changes</div>
        </div>
        <div class="tickets-container">
        ${processedIssues.map(issue => {
          // Build all changes in order: Status, Assignee, Priority, Type
          const allChanges = [];
          
          // Format status changes - show ALL status transitions that happened during the period (newest first)
          if (issue.statusTransitions.length > 0) {
            // Sort transitions in reverse chronological order (newest first)
            const sortedTransitions = [...issue.statusTransitions].sort((a, b) => b.date.valueOf() - a.date.valueOf());
            sortedTransitions.forEach(transition => {
              const dateStr = transition.date.format('MMM D, h:mm A');
              allChanges.push(`<div class="change-item"><strong>Status:</strong> <span class="status-badge from">${transition.fromStatus}</span><span class="status-arrow">→</span><span class="status-badge to">${transition.toStatus}</span> <span style="color: #6B778C; font-size: 11px;">(${dateStr})</span></div>`);
            });
          } else if (issue.hasStatusChange) {
            // Fallback: show overall change if no transitions tracked but status changed
            allChanges.push(`<div class="change-item"><strong>Status:</strong> <span class="status-badge from">${issue.startStatus}</span><span class="status-arrow">→</span><span class="status-badge to">${issue.endStatus}</span></div>`);
          }
          
          // Format assignee changes - show ALL changes that happened during the period (newest first)
          if (issue.assigneeChanges.length > 0) {
            const sortedAssigneeChanges = [...issue.assigneeChanges].sort((a, b) => b.date.valueOf() - a.date.valueOf());
            sortedAssigneeChanges.forEach(change => {
              allChanges.push(`<div class="change-item"><strong>Assignee:</strong> <span class="assignee-change">${change.from || 'Unassigned'}</span> → <span class="assignee-change">${change.to || 'Unassigned'}</span></div>`);
            });
          } else if (issue.initialAssignee !== issue.currentAssignee) {
            allChanges.push(`<div class="change-item"><strong>Assignee:</strong> <span class="assignee-change">${issue.initialAssignee}</span> → <span class="assignee-change">${issue.currentAssignee}</span></div>`);
          }
          
          // Format priority changes - show ALL changes that happened during the period (newest first)
          if (issue.priorityChanges.length > 0) {
            const sortedPriorityChanges = [...issue.priorityChanges].sort((a, b) => b.date.valueOf() - a.date.valueOf());
            sortedPriorityChanges.forEach(change => {
              allChanges.push(`<div class="change-item"><strong>Priority:</strong> <span class="priority-change">${change.from || 'Unset'}</span> → <span class="priority-change">${change.to || 'Unset'}</span></div>`);
            });
          } else if (issue.initialPriority !== issue.currentPriority) {
            allChanges.push(`<div class="change-item"><strong>Priority:</strong> <span class="priority-change">${issue.initialPriority}</span> → <span class="priority-change">${issue.currentPriority}</span></div>`);
          }
          
          // Format issue type changes - show ALL changes that happened during the period (newest first)
          if (issue.issueTypeChanges.length > 0) {
            const sortedTypeChanges = [...issue.issueTypeChanges].sort((a, b) => b.date.valueOf() - a.date.valueOf());
            sortedTypeChanges.forEach(change => {
              allChanges.push(`<div class="change-item"><strong>Type:</strong> <span class="type-change">${change.from || 'Task'}</span> → <span class="type-change">${change.to || 'Task'}</span></div>`);
            });
          } else if (issue.hasIssueTypeChange) {
            allChanges.push(`<div class="change-item"><strong>Type:</strong> <span class="type-change">${issue.initialIssueType}</span> → <span class="type-change">${issue.currentIssueType}</span></div>`);
          }
          
          return `
            <div class="ticket">
              <div>
                <a href="${issue.link}" class="key" target="_blank">${issue.key}</a>
              </div>
              <div class="summary-text">
                <span class="issue-type-badge ${issue.issueType}">${issue.issueType}</span>
                ${issue.summary}
              </div>
              <div>
                <span class="assignee">${issue.currentAssignee}</span>
              </div>
              <div>
                <span class="reporter">${issue.reporter}</span>
              </div>
              <div class="changes-column">
                ${allChanges.length > 0 ? allChanges.join('') : '<span style="color: #6B778C;">No changes</span>'}
              </div>
            </div>
          `;
        }).join('')}
        </div>
      </div>
    `;

    res.send(renderPage(`Progress Report - ${periodLabel}`, content, styles));
      
    } catch (error) {
    debugError(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/backlog', async (req, res) => {
  try {
    // 1. Get project key from board configuration
    let projectKey = null;
    try {
      const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}`);
      if (boardResponse.data && boardResponse.data.location) {
        projectKey = boardResponse.data.location.projectKey;
      }
    } catch (error) {
      debugError('Error fetching board configuration:', error.message);
    }

    // If we couldn't get project key from board, try to get it from a sample issue
    if (!projectKey) {
      try {
        const sampleIssueResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
          params: {
            fields: 'key',
            maxResults: 1
          }
        });
        if (sampleIssueResponse.data.issues && sampleIssueResponse.data.issues.length > 0) {
          const issueKey = sampleIssueResponse.data.issues[0].key;
          projectKey = issueKey.split('-')[0]; // Extract project key from issue key (e.g., "ENG-123" -> "ENG")
        }
      } catch (error) {
        debugError('Error getting project key from sample issue:', error.message);
      }
    }
    
    // 2. Query for open issues NOT in current or future sprints using JQL sprint functions
    // Include issues with no sprint (backlog items) OR issues in closed sprints
    let jqlQuery = `status not in (Done, "Won't Do")`;
    if (projectKey) {
      jqlQuery += ` AND project = "${projectKey}" AND (sprint IS EMPTY OR (sprint NOT in openSprints() AND sprint NOT in futureSprints()))`;
    } else {
      // If no project key, still include issues with no sprint
      jqlQuery += ` AND (sprint IS EMPTY OR (sprint NOT in openSprints() AND sprint NOT in futureSprints()))`;
    }
    jqlQuery += ` ORDER BY created ASC`;
    
    // Fetch all open issues from board with pagination
    let issueKeys = [];
    try {
      let startAt = 0;
      const maxResults = 100; // Fetch in smaller batches
      let hasMore = true;
      
      while (hasMore) {
        const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
          params: {
            jql: jqlQuery,
            fields: 'key',
            startAt: startAt,
            maxResults: maxResults
          }
        });
        
        const issues = boardResponse.data.issues || [];
        issueKeys = issueKeys.concat(issues.map(i => i.key));
        
        const total = boardResponse.data.total || 0;
        startAt += issues.length;
        hasMore = startAt < total && issues.length > 0;
        
      }
    } catch (error) {
      debugError('Error fetching from board, trying direct search:', error.message);
      // Fallback: try direct search with pagination
      let startAt = 0;
      const maxResults = 100;
      let hasMore = true;
      
      while (hasMore) {
        const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
          jql: jqlQuery,
          startAt: startAt,
          maxResults: maxResults,
          fields: ['key']
        });
        
        const issues = searchResponse.data.issues || [];
        issueKeys = issueKeys.concat(issues.map(i => i.key));
        
        const total = searchResponse.data.total || 0;
        startAt += issues.length;
        hasMore = startAt < total && issues.length > 0;
        
      }
    }
    
    debugLog(`Found ${issueKeys.length} total open issues`);
    
    if (issueKeys.length === 0) {
      const content = `
        <h1>Backlog</h1>
            <p style="color: #6B778C; margin-top: 40px;">No backlog issues found</p>
      `;
      return res.send(renderPage('Backlog Report', content));
    }
    
    // 3. Bulk fetch details with sprint information (handle pagination if needed)
    let allIssues = [];
    const batchSize = 100; // Jira API limit for key in () queries
    
    // Fetch in batches if we have more than batchSize keys
    for (let i = 0; i < issueKeys.length; i += batchSize) {
      const batchKeys = issueKeys.slice(i, i + batchSize);
      try {
        const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
          jql: `key in (${batchKeys.join(',')})`,
          maxResults: batchSize,
          fields: ['summary', 'status', 'created', 'issuetype', 'reporter']
        });
        
        const batchIssues = searchResponse.data.issues || [];
        allIssues = allIssues.concat(batchIssues);
      } catch (error) {
        debugError(`Error fetching batch ${Math.floor(i/batchSize) + 1}:`, error.message);
        // Continue with other batches even if one fails
      }
    }
    
    debugLog(`Fetched ${allIssues.length} total open issues (out of ${issueKeys.length} keys)`);
    
    // 4. Filter out epics and subtasks
    let epicsExcluded = 0;
    let subtasksExcluded = 0;
    
    const filteredIssues = allIssues.filter(issue => {
      // Filter out epics and subtasks
      const issueType = (issue.fields.issuetype?.name || '').toLowerCase();
      if (issueType === 'epic') {
        epicsExcluded++;
        return false;
      }
      if (issueType === 'subtask') {
        subtasksExcluded++;
        return false;
      }
      
      return true;
    });
    
    
    // 5. For each issue, find the most recent sprint it's in (for display purposes)
    const issuesWithSprints = await Promise.all(
      filteredIssues.map(async (issue) => {
        let latestSprintName = null;
        let latestSprintId = null;
        
        if (issue.fields.sprint) {
          let sprintIds = [];
          
          // Handle different sprint field formats
          if (Array.isArray(issue.fields.sprint)) {
            sprintIds = issue.fields.sprint.map(s => {
              if (typeof s === 'object' && s !== null) {
                return s.id ? Number(s.id) : null;
              } else if (typeof s === 'string' || typeof s === 'number') {
                return Number(s);
              }
              return null;
            }).filter(id => id != null);
          } else if (typeof issue.fields.sprint === 'object' && issue.fields.sprint !== null) {
            const sprintId = issue.fields.sprint.id ? Number(issue.fields.sprint.id) : null;
            if (sprintId) {
              sprintIds = [sprintId];
            }
          } else if (typeof issue.fields.sprint === 'string' || typeof issue.fields.sprint === 'number') {
            sprintIds = [Number(issue.fields.sprint)];
          }
          
          // Fetch sprint details to find the most recent one (for display)
          if (sprintIds.length > 0) {
            const sprintDetails = await Promise.all(
              sprintIds.map(async (sprintId) => {
                try {
                  const sprintResponse = await jiraClient.get(`/rest/agile/1.0/sprint/${sprintId}`);
                  return sprintResponse.data;
                } catch (error) {
                  return null;
                }
              })
            );
            
            // Filter out nulls and find the sprint with the latest end date (or start date if no end date)
            const validSprints = sprintDetails.filter(s => s);
            if (validSprints.length > 0) {
              const latestSprint = validSprints.sort((a, b) => {
                const aDate = a.endDate ? moment(a.endDate) : (a.startDate ? moment(a.startDate) : moment(0));
                const bDate = b.endDate ? moment(b.endDate) : (b.startDate ? moment(b.startDate) : moment(0));
                return bDate.valueOf() - aDate.valueOf();
              })[0];
              
              latestSprintName = latestSprint.name;
              latestSprintId = latestSprint.id;
            }
          }
        }
        
        return {
          ...issue,
          latestSprintName: latestSprintName,
          latestSprintId: latestSprintId
        };
      })
    );
    
    // 7. Process issues to calculate age with humanized format
    const now = moment();
    const processedIssues = issuesWithSprints.map(issue => {
      const createdDate = moment(issue.fields.created);
      const daysOld = now.diff(createdDate, 'days', true); // Use true for decimal precision
      const keyMatch = issue.key.match(/-(\d+)$/);
      const keyNumber = keyMatch ? parseInt(keyMatch[1], 10) : 0;
      
      // Humanize age format
      let ageText;
      if (daysOld < 7) {
        ageText = `${Math.round(daysOld)} day${Math.round(daysOld) !== 1 ? 's' : ''}`;
      } else if (daysOld < 30) {
        const weeks = daysOld / 7;
        const weeksRounded = parseFloat(weeks.toFixed(1));
        if (weeksRounded === 1.0) {
          ageText = '1 week';
        } else {
          ageText = `${weeks.toFixed(1)} week${weeksRounded !== 1 ? 's' : ''}`;
        }
      } else if (daysOld < 365) {
        const months = daysOld / 30;
        const monthsRounded = parseFloat(months.toFixed(1));
        if (monthsRounded === 1.0) {
          ageText = '1 month';
        } else {
          ageText = `${months.toFixed(1)} month${monthsRounded !== 1 ? 's' : ''}`;
        }
      } else {
        const years = daysOld / 365;
        const yearsRounded = parseFloat(years.toFixed(1));
        if (yearsRounded === 1.0) {
          ageText = '1 year';
        } else {
          ageText = `${years.toFixed(1)} year${yearsRounded !== 1 ? 's' : ''}`;
        }
      }
      
      return {
        key: issue.key,
        keyNumber: keyNumber,
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        created: createdDate.format('YYYY-MM-DD'),
        createdTimestamp: createdDate.valueOf(),
        createdFormatted: createdDate.format('MM/DD/YY'),
        ageDays: daysOld,
        ageText: ageText,
        link: `https://${JIRA_HOST}/browse/${issue.key}`,
        issueType: (issue.fields.issuetype?.name || 'Task').toLowerCase(),
        reporter: issue.fields.reporter ? issue.fields.reporter.displayName : 'Unknown'
      };
    });
    
    // 8. Sort by creation date descending (newest first)
    processedIssues.sort((a, b) => moment(b.created).valueOf() - moment(a.created).valueOf());
    
    // 9. Calculate stats
    const totalIssues = processedIssues.length;
    const ages = processedIssues.map(i => i.ageDays).sort((a, b) => a - b);
    const minAge = ages.length > 0 ? ages[0] : 0;
    const maxAge = ages.length > 0 ? ages[ages.length - 1] : 0;
    const avgAge = ages.length > 0 ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 0;
    const medianAge = ages.length > 0 
      ? (ages.length % 2 === 0 
          ? (ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2 
          : ages[Math.floor(ages.length / 2)])
      : 0;
    
    // Format stats
    const formatAge = (days) => {
      if (days < 7) {
        return `${Math.round(days)} day${Math.round(days) !== 1 ? 's' : ''}`;
      } else if (days < 30) {
        const weeks = days / 7;
        const weeksRounded = parseFloat(weeks.toFixed(1));
        if (weeksRounded === 1.0) {
          return '1 week';
        }
        return `${weeks.toFixed(1)} week${weeksRounded !== 1 ? 's' : ''}`;
      } else if (days < 365) {
        const months = days / 30;
        const monthsRounded = parseFloat(months.toFixed(1));
        if (monthsRounded === 1.0) {
          return '1 month';
        }
        return `${months.toFixed(1)} month${monthsRounded !== 1 ? 's' : ''}`;
      } else {
        const years = days / 365;
        const yearsRounded = parseFloat(years.toFixed(1));
        if (yearsRounded === 1.0) {
          return '1 year';
        }
        return `${years.toFixed(1)} year${yearsRounded !== 1 ? 's' : ''}`;
      }
    };
    
    // Calculate age distribution
    const distributionBuckets = [
      { label: '0-7 days', min: 0, max: 7, count: 0 },
      { label: '1-2 weeks', min: 7, max: 14, count: 0 },
      { label: '2-4 weeks', min: 14, max: 30, count: 0 },
      { label: '1-3 months', min: 30, max: 90, count: 0 },
      { label: '3-6 months', min: 90, max: 180, count: 0 },
      { label: '6-12 months', min: 180, max: 365, count: 0 },
      { label: '1-2 years', min: 365, max: 730, count: 0 },
      { label: '2+ years', min: 730, max: Infinity, count: 0 }
    ];
    
    ages.forEach(age => {
      for (const bucket of distributionBuckets) {
        if (age >= bucket.min && age < bucket.max) {
          bucket.count++;
          break;
        }
      }
    });
    
    const maxCount = Math.max(...distributionBuckets.map(b => b.count), 1);
    
    // 8. Generate HTML
    const styles = `
        <style>
          .container { max-width: 1400px; margin: 0 auto; }
          .stats-section { background: white; padding: 15px 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin: 20px 0 30px; }
          .stats-toggle { cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 14px; color: #172B4D; font-weight: 600; margin-bottom: 15px; user-select: none; }
          .stats-toggle:hover { color: #0052CC; }
          .stats-toggle-icon { transition: transform 0.2s; }
          .stats-toggle-icon.collapsed { transform: rotate(-90deg); }
          .stats-content { display: none; }
          .stats-content.expanded { display: flex; gap: 30px; align-items: flex-start; }
          .stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; flex: 1; }
          .stat-item { background: #F4F5F7; padding: 12px 16px; border-radius: 6px; text-align: center; }
          .stat-label { font-size: 11px; color: #6B778C; text-transform: uppercase; margin-bottom: 6px; }
          .stat-value { font-size: 20px; font-weight: 600; color: #172B4D; }
          .distribution { flex: 1; }
          .distribution-title { font-size: 12px; color: #6B778C; text-transform: uppercase; margin-bottom: 12px; font-weight: 600; }
          .distribution-chart { display: flex; align-items: flex-end; gap: 6px; height: 180px; padding: 10px 0; }
          .distribution-bar-container { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
          .distribution-bar { width: 100%; background: #0052CC; border-radius: 4px 4px 0 0; min-height: 4px; position: relative; display: flex; flex-direction: column; justify-content: flex-end; transition: background 0.2s; }
          .distribution-bar.empty { background: #EBECF0; }
          .distribution-bar-value { font-size: 10px; color: #172B4D; font-weight: 600; text-align: center; margin-bottom: 4px; padding: 2px 0; }
          .distribution-bar-label { font-size: 8px; color: #6B778C; margin-top: 6px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
        .issue { display: grid; grid-template-columns: 120px 1fr 150px 120px 120px 180px; gap: 20px; align-items: center; }
        .header-row { display: grid; grid-template-columns: 120px 1fr 150px 120px 120px 180px; gap: 20px; }
          .age { font-weight: 600; color: #172B4D; }
          .created-date { font-size: 12px; color: #6B778C; }
        .header-row .sortable {
          cursor: pointer;
          user-select: none;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .header-row .sortable:hover {
          color: #0052CC;
        }
        .header-row .sort-indicator {
          font-size: 11px;
          color: #6B778C;
        }
        .header-row .sort-asc .sort-indicator::after {
          content: '▲';
          color: #0052CC;
        }
        .header-row .sort-desc .sort-indicator::after {
          content: '▼';
          color: #0052CC;
        }
        </style>
      <script>
        function sortBacklogColumn(sortKey, sortType, headerEl) {
          const container = document.querySelector('.issues-container');
          if (!container) return;
          
          const items = Array.from(container.querySelectorAll('.issue'));
          const headers = document.querySelectorAll('.header-row .sortable');
          
          headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
          
          const isCurrentlyDesc = headerEl.classList.contains('sort-desc');
          const isDesc = !isCurrentlyDesc;
          headerEl.classList.add(isDesc ? 'sort-desc' : 'sort-asc');
          
          items.sort((a, b) => {
            let aValue = a.dataset[sortKey] || '';
            let bValue = b.dataset[sortKey] || '';
            
            if (sortType === 'number') {
              aValue = parseFloat(aValue) || 0;
              bValue = parseFloat(bValue) || 0;
            } else {
              aValue = aValue.toString().toLowerCase();
              bValue = bValue.toString().toLowerCase();
            }
            
            if (aValue < bValue) return isDesc ? 1 : -1;
            if (aValue > bValue) return isDesc ? -1 : 1;
            return 0;
          });
          
          items.forEach(item => container.appendChild(item));
        }
        
        function initBacklogSorting() {
          document.querySelectorAll('.header-row .sortable').forEach(header => {
            header.addEventListener('click', () => {
              const sortKey = header.getAttribute('data-sort-key');
              const sortType = header.getAttribute('data-sort-type') || 'text';
              sortBacklogColumn(sortKey, sortType, header);
            });
          });
        }
        
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initBacklogSorting);
        } else {
          initBacklogSorting();
        }
      </script>
    `;
    
    const toAttr = (value) => {
      return String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    };
    
    const content = `
          <h1>BACKLOG REPORT</h1>
          
          <div class="stats-section">
            <div class="stats-toggle" onclick="this.nextElementSibling.classList.toggle('expanded'); this.querySelector('.stats-toggle-icon').classList.toggle('collapsed');">
              <span class="stats-toggle-icon collapsed">▼</span>
              <span>Statistics & Distribution</span>
            </div>
            <div class="stats-content">
              <div class="distribution">
                <div class="distribution-title">Age Distribution</div>
                <div class="distribution-chart">
                  ${distributionBuckets.map(bucket => {
                    const height = maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;
                    const isEmpty = bucket.count === 0;
                    return `
                      <div class="distribution-bar-container">
                        <div class="distribution-bar ${isEmpty ? 'empty' : ''}" style="height: ${height}%;">
                          ${!isEmpty ? `<div class="distribution-bar-value">${bucket.count}</div>` : ''}
                        </div>
                        <div class="distribution-bar-label">${bucket.label}</div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
              <div class="stats">
                <div class="stat-item">
                  <div class="stat-label">Total Issues</div>
                  <div class="stat-value">${totalIssues}</div>
                </div>
                <div class="stat-item">
                  <div class="stat-label">Min Age</div>
                  <div class="stat-value">${formatAge(minAge)}</div>
                </div>
                <div class="stat-item">
                  <div class="stat-label">Max Age</div>
                  <div class="stat-value">${formatAge(maxAge)}</div>
                </div>
                <div class="stat-item">
                  <div class="stat-label">Median Age</div>
                  <div class="stat-value">${formatAge(medianAge)}</div>
                </div>
                <div class="stat-item">
                  <div class="stat-label">Average Age</div>
                  <div class="stat-value">${formatAge(avgAge)}</div>
                </div>
              </div>
            </div>
          </div>
          
          <div class="issues-list">
            <div class="header-row">
          <div class="sortable" data-sort-key="keyNumber" data-sort-type="number">Key <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="summary" data-sort-type="text">Summary <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="status" data-sort-type="text">Status <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="createdTimestamp" data-sort-type="number">Created <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="reporter" data-sort-type="text">Reporter <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="ageDays" data-sort-type="number">Age <span class="sort-indicator"></span></div>
            </div>
            <div class="issues-container">
            ${processedIssues.map(issue => `
          <div class="issue"
            data-key-number="${issue.keyNumber}"
            data-summary="${toAttr(issue.summary)}"
            data-status="${toAttr(issue.status)}"
            data-created-timestamp="${issue.createdTimestamp}"
            data-reporter="${toAttr(issue.reporter)}"
            data-age-days="${issue.ageDays}">
                <div>
                  <a href="${issue.link}" class="key" target="_blank">${issue.key}</a>
                </div>
                <div class="summary-text">
                  <span class="issue-type-badge ${issue.issueType}">${issue.issueType}</span>
                  ${issue.summary}
                </div>
                <div>
                  <span class="status">${issue.status}</span>
                </div>
                <div>
                  <div class="created-date">${issue.createdFormatted}</div>
                </div>
                <div>
              <span class="reporter">${issue.reporter}</span>
                </div>
                <div>
                  <div class="age">${issue.ageText}</div>
                </div>
              </div>
            `).join('')}
            </div>
          </div>
    `;

    res.send(renderPage('Backlog Report', content, styles));

  } catch (error) {
    debugError('Error in /backlog route:', error);
    if (error.response) {
      debugError('Response status:', error.response.status);
      debugError('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).send(`Error: ${error.message}${error.response ? ` (Status: ${error.response.status})` : ''}`);
  }
});

app.get('/pr', async (req, res) => {
  try {
    debugLog(`[pr] Starting PR report fetch for org: ${GITHUB_ORG || 'missing'}`);
    if (!GITHUB_TOKEN || !GITHUB_ORG) {
      debugWarn('[pr] Missing GitHub configuration', {
        hasToken: Boolean(GITHUB_TOKEN),
        hasOrg: Boolean(GITHUB_ORG)
      });
      const styles = `
        <style>
          .error-message {
            background: white;
            border-radius: 8px;
            padding: 40px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 600px;
            margin: 40px auto;
          }
          .error-message h2 {
            color: #DE350B;
            margin-bottom: 20px;
          }
          .error-message p {
            color: #6B778C;
            line-height: 1.6;
            margin-bottom: 15px;
          }
          .error-message code {
            background: #F4F5F7;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
            color: #172B4D;
          }
          .error-message ul {
            text-align: left;
            display: inline-block;
            margin: 20px 0;
          }
          .error-message li {
            margin: 10px 0;
            color: #6B778C;
          }
        </style>
      `;
      
      const missingVars = [];
      if (!GITHUB_TOKEN) missingVars.push('GITHUB_TOKEN');
      if (!GITHUB_ORG) missingVars.push('GITHUB_ORG');
      
      const content = `
        <h1>Pull Requests</h1>
        <div class="error-message">
          <h2>⚠️ GitHub Configuration Required</h2>
          <p>
            The Pull Requests report requires GitHub API access, but the following environment variables are not configured:
          </p>
          <ul>
            ${missingVars.map(v => `<li><code>${v}</code></li>`).join('')}
          </ul>
          <p>
            To use this feature, please add these variables to your <code>.env</code> file and restart the server.
          </p>
          <p style="margin-top: 30px; font-size: 14px; color: #6B778C;">
            See the README for instructions on creating a GitHub personal access token.
          </p>
        </div>
      `;
      
      return res.status(200).send(renderPage('Pull Requests', content, styles));
    }

    // Fetch all repositories in the org
    let allRepos = [];
    let page = 1;
    let hasMore = true;
    let repoPages = 0;
    
    while (hasMore) {
      try {
        const reposResponse = await githubClient.get(`/orgs/${GITHUB_ORG}/repos`, {
          params: {
            type: 'all',
            per_page: 100,
            page: page,
            sort: 'updated'
          }
        });
        repoPages += 1;
        const remaining = reposResponse.headers?.['x-ratelimit-remaining'];
        const reset = reposResponse.headers?.['x-ratelimit-reset'];
        debugLog(`[pr] Repos page ${page}: ${reposResponse.data.length} repos (rate remaining: ${remaining || 'n/a'}, reset: ${reset || 'n/a'})`);
        
        if (reposResponse.data.length === 0) {
          hasMore = false;
        } else {
          allRepos = allRepos.concat(reposResponse.data);
          page++;
          if (reposResponse.data.length < 100) {
            hasMore = false;
          }
        }
      } catch (error) {
        debugError(`[pr] Error fetching repos page ${page}:`, error.message, {
          status: error.response?.status,
          data: error.response?.data
        });
        hasMore = false;
      }
    }

    debugLog(`[pr] Found ${allRepos.length} repositories in org ${GITHUB_ORG} across ${repoPages} page(s)`);

    // Fetch all open PRs from all repos
    const allPRs = [];
    
    for (const repo of allRepos) {
      try {
        let prPage = 1;
        let hasMorePRs = true;
        let repoPRCount = 0;
        
        while (hasMorePRs) {
          const prsResponse = await githubClient.get(`/repos/${repo.full_name}/pulls`, {
            params: {
              state: 'open',
              per_page: 100,
              page: prPage,
              sort: 'updated',
              direction: 'desc'
            }
          });
          const remaining = prsResponse.headers?.['x-ratelimit-remaining'];
          const reset = prsResponse.headers?.['x-ratelimit-reset'];
          debugLog(`[pr] ${repo.full_name} PR page ${prPage}: ${prsResponse.data.length} PRs (rate remaining: ${remaining || 'n/a'}, reset: ${reset || 'n/a'})`);
          
          if (prsResponse.data.length === 0) {
            hasMorePRs = false;
          } else {
            for (const pr of prsResponse.data) {
              repoPRCount += 1;
              // Get reviews for this PR
              let reviews = [];
              try {
                const reviewsResponse = await githubClient.get(`/repos/${repo.full_name}/pulls/${pr.number}/reviews`);
                reviews = reviewsResponse.data;
                debugLog(`[pr] ${repo.full_name}#${pr.number} reviews: ${reviews.length}`);
              } catch (error) {
                debugError(`[pr] Error fetching reviews for ${repo.full_name}#${pr.number}:`, error.message, {
                  status: error.response?.status,
                  data: error.response?.data
                });
              }
              
              // Get review requests
              let reviewRequests = [];
              try {
                const reviewRequestsResponse = await githubClient.get(`/repos/${repo.full_name}/pulls/${pr.number}/requested_reviewers`);
                reviewRequests = [
                  ...(reviewRequestsResponse.data.users || []),
                  ...(reviewRequestsResponse.data.teams || [])
                ];
                debugLog(`[pr] ${repo.full_name}#${pr.number} requested reviewers: ${reviewRequests.length}`);
              } catch (error) {
                debugError(`[pr] Error fetching review requests for ${repo.full_name}#${pr.number}:`, error.message, {
                  status: error.response?.status,
                  data: error.response?.data
                });
              }
              
              // Extract ticket number from PR title or branch name
              // Common patterns: ENG-1234, ENG-1234, ENG_1234, ENG1234
              const ticketPattern = /([A-Z]+)[-_]?(\d+)/i;
              const titleMatch = pr.title.match(ticketPattern);
              const branchMatch = pr.head.ref.match(ticketPattern);
              const ticketNumber = titleMatch ? `${titleMatch[1].toUpperCase()}-${titleMatch[2]}` : 
                                  (branchMatch ? `${branchMatch[1].toUpperCase()}-${branchMatch[2]}` : null);
              
              // Process reviews to get reviewer status
              const reviewerStatuses = {};
              const reviewerAvatars = {};
              
              // Add requested reviewers who haven't reviewed yet
              reviewRequests.forEach(req => {
                const reviewerName = req.login || req.slug || (req.name || 'Unknown');
                if (!reviewerStatuses[reviewerName]) {
                  reviewerStatuses[reviewerName] = { status: 'requested', state: null };
                }
                // Capture avatar URLs for users (teams won't have avatar_url)
                if (req && req.login && req.avatar_url) {
                  reviewerAvatars[req.login] = req.avatar_url;
                }
              });
              
              // Process actual reviews
              reviews.forEach(review => {
                const reviewerName = review.user.login;
                const state = review.state.toLowerCase(); // APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED
                
                if (!reviewerStatuses[reviewerName] || reviewerStatuses[reviewerName].state === null) {
                  reviewerStatuses[reviewerName] = { status: state, state: state };
                } else if (state === 'approved' || state === 'changes_requested') {
                  // Override with more definitive status
                  reviewerStatuses[reviewerName] = { status: state, state: state };
                }

                if (review.user && review.user.login && review.user.avatar_url) {
                  reviewerAvatars[review.user.login] = review.user.avatar_url;
                }
              });
              
              allPRs.push({
                number: pr.number,
                title: pr.title,
                author: pr.user.login,
                authorAvatarUrl: pr.user.avatar_url,
                repo: repo.name,
                repoFullName: repo.full_name,
                url: pr.html_url,
                ticketNumber: ticketNumber,
                isDraft: pr.draft,
                createdAt: moment(pr.created_at),
                updatedAt: moment(pr.updated_at),
                reviewerStatuses: reviewerStatuses,
                reviewerAvatars: reviewerAvatars,
                reviewRequests: reviewRequests,
                reviews: reviews
              });
            }
            
            prPage++;
            if (prsResponse.data.length < 100) {
              hasMorePRs = false;
            }
          }
        }
        debugLog(`[pr] ${repo.full_name}: total open PRs collected: ${repoPRCount}`);
      } catch (error) {
        debugError(`[pr] Error fetching PRs from ${repo.full_name}:`, error.message, {
          status: error.response?.status,
          data: error.response?.data
        });
      }
    }

    // Sort by updated date (most recent first)
    allPRs.sort((a, b) => b.updatedAt.valueOf() - a.updatedAt.valueOf());
    debugLog(`[pr] Total open PRs collected: ${allPRs.length}`);

    const styles = `
      <style>
        .prs-list {
          background: white;
          border-radius: 8px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .pr {
          display: grid;
          grid-template-columns: 220px 1fr 150px 200px 1fr;
          gap: 15px;
          padding: 15px 0;
          border-bottom: 1px solid #e0e0e0;
          font-size: 13px;
          font-weight: 400;
          color: #172B4D;
          align-items: start;
        }
        .pr:last-child {
          border-bottom: none;
        }
        .pr-header {
          display: grid;
          grid-template-columns: 220px 1fr 150px 200px 1fr;
          gap: 15px;
          padding: 10px 0;
          border-bottom: 2px solid #172B4D;
          font-weight: bold;
          color: #172B4D;
          margin-bottom: 10px;
        }
        .pr-header .sortable {
          cursor: pointer;
          user-select: none;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .pr-header .sortable:hover {
          color: #0052CC;
        }
        .pr-header .sort-indicator {
          font-size: 11px;
          color: #6B778C;
        }
        .pr-header .sort-asc .sort-indicator::after {
          content: '▲';
          color: #0052CC;
        }
        .pr-header .sort-desc .sort-indicator::after {
          content: '▼';
          color: #0052CC;
        }
        .pr-number {
          font-weight: 500;
        }
        .pr-number a {
          color: #0052CC;
          text-decoration: none;
        }
        .pr-number a:hover {
          text-decoration: underline;
        }
        .pr-number .repo-link {
          color: #6B778C;
          text-decoration: none;
          margin-left: 6px;
          font-weight: 500;
        }
        .pr-number .repo-link:hover {
          color: #0052CC;
          text-decoration: underline;
        }
        .gh-avatar {
          width: 32px;
          height: 32px;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .pr-title {
          font-weight: 400;
          font-size: 13px;
        }
        .pr-title a {
          color: inherit;
          text-decoration: none;
        }
        .pr-title a:hover {
          color: #0052CC;
          text-decoration: underline;
        }
        .pr-repo {
          font-size: 12px;
          color: #6B778C;
          word-break: break-word;
        }
        .pr-branch {
          font-family: monospace;
          font-size: 12px;
          color: #6B778C;
        }
        .pr-author {
          color: #172B4D;
          display: flex;
          align-items: flex-start;
          gap: 10px;
        }
        .pr-dates {
          font-size: 12px;
          color: #6B778C;
        }
        .pr-reviewers {
          display: flex;
          flex-direction: column;
          gap: 5px;
          align-items: flex-start;
        }
        .reviewer-item {
          display: flex;
          align-items: flex-start;
          gap: 5px;
          font-size: 12px;
        }
        .review-status {
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 500;
        }
        .review-status.approved {
          background: #E3FCEF;
          color: #006644;
        }
        .review-status.changes_requested {
          background: #FFEBE6;
          color: #BF2600;
        }
        .review-status.commented {
          background: #DEEBFF;
          color: #0052CC;
        }
        .review-status.requested {
          background: #F4F5F7;
          color: #6B778C;
        }
        .review-status.dismissed {
          background: #F4F5F7;
          color: #6B778C;
          text-decoration: line-through;
        }
        .no-reviewers {
          color: #FF5630;
          font-weight: 500;
          font-size: 12px;
        }
        .draft-badge {
          background: #F4F5F7;
          color: #6B778C;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 500;
          display: inline-block;
          margin-left: 5px;
        }
        .ticket-number {
          background: #0052CC;
          color: white;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: 500;
          display: inline-block;
          margin-right: 5px;
        }
        .ticket-number-link {
          color: inherit;
          text-decoration: none;
        }
        .ticket-number-link:hover .ticket-number {
          filter: brightness(1.1);
          text-decoration: underline;
        }
      </style>
      <script>
        function sortPrColumn(sortKey, sortType, headerEl) {
          const container = document.querySelector('.prs-container');
          if (!container) return;
          
          const items = Array.from(container.querySelectorAll('.pr'));
          const headers = document.querySelectorAll('.pr-header .sortable');
          
          headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
          
          const isCurrentlyDesc = headerEl.classList.contains('sort-desc');
          const isDesc = !isCurrentlyDesc; // toggle
          headerEl.classList.add(isDesc ? 'sort-desc' : 'sort-asc');
          
          items.sort((a, b) => {
            let aValue = a.dataset[sortKey] ?? '';
            let bValue = b.dataset[sortKey] ?? '';
            
            if (sortType === 'number') {
              aValue = parseFloat(aValue) || 0;
              bValue = parseFloat(bValue) || 0;
            } else {
              aValue = aValue.toString().toLowerCase();
              bValue = bValue.toString().toLowerCase();
            }
            
            if (aValue < bValue) return isDesc ? 1 : -1;
            if (aValue > bValue) return isDesc ? -1 : 1;
            return 0;
          });
          
          items.forEach(item => container.appendChild(item));
        }
        
        function initPrSorting() {
          document.querySelectorAll('.pr-header .sortable').forEach(header => {
            header.addEventListener('click', () => {
              const sortKey = header.getAttribute('data-sort-key');
              const sortType = header.getAttribute('data-sort-type') || 'text';
              sortPrColumn(sortKey, sortType, header);
            });
          });
        }
        
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initPrSorting);
        } else {
          initPrSorting();
        }
      </script>
    `;

    const now = moment();
    const content = `
      <h1>Pull Requests</h1>
      <p class="summary">Open Pull Requests in ${GITHUB_ORG}</p>
      
      <div class="prs-list">
        <div class="pr-header">
          <div class="sortable" data-sort-key="number" data-sort-type="number">PR, Repo <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="title" data-sort-type="text">Title <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="author" data-sort-type="text">Author <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="ageDays" data-sort-type="number">Age <span class="sort-indicator"></span></div>
          <div class="sortable" data-sort-key="reviewerCount" data-sort-type="number">Reviewers <span class="sort-indicator"></span></div>
        </div>
        <div class="prs-container">
        ${allPRs.length === 0 ? '<p>No open pull requests found.</p>' : allPRs.map(pr => {
          const reviewersHtml = Object.keys(pr.reviewerStatuses).length === 0 && !pr.isDraft
            ? '<span class="no-reviewers">⚠️ No reviewers assigned</span>'
            : Object.entries(pr.reviewerStatuses).map(([reviewer, status]) => {
                const avatarUrl = pr.reviewerAvatars && pr.reviewerAvatars[reviewer] ? pr.reviewerAvatars[reviewer] : null;
                const statusClass = status.status === 'approved' ? 'approved' :
                                  status.status === 'changes_requested' ? 'changes_requested' :
                                  status.status === 'commented' ? 'commented' :
                                  status.status === 'requested' ? 'requested' :
                                  status.status === 'dismissed' ? 'dismissed' : 'requested';
                const statusLabel = status.status === 'approved' ? '✓ Approved' :
                                  status.status === 'changes_requested' ? '✗ Changes Requested' :
                                  status.status === 'commented' ? '💬 Commented' :
                                  status.status === 'requested' ? '⏳ Requested' :
                                  status.status === 'dismissed' ? 'Dismissed' : 'Pending';
                return `
                  <div class="reviewer-item">
                    ${avatarUrl ? `<img class="gh-avatar" src="${avatarUrl}" alt="${reviewer}"/>` : ''}
                    <span>${reviewer}</span>
                    <span class="review-status ${statusClass}">${statusLabel}</span>
                  </div>
                `;
              }).join('');
          
          const repoDisplay = pr.repo || (pr.repoFullName ? pr.repoFullName.split('/').pop() : '');
          const repoUrl = pr.repoFullName ? `https://github.com/${pr.repoFullName}` : (pr.repo ? `https://github.com/${GITHUB_ORG}/${pr.repo}` : '');
          const reviewerCount = Object.keys(pr.reviewerStatuses || {}).length;
          const ageDays = now.diff(pr.createdAt, 'days', true);
          
          let ageText = '';
          if (ageDays < 7) {
            ageText = `${Math.max(0, Math.round(ageDays))}d`;
          } else if (ageDays < 30) {
            ageText = `${(ageDays / 7).toFixed(1)}w`;
          } else if (ageDays < 365) {
            ageText = `${(ageDays / 30).toFixed(1)}mo`;
          } else {
            ageText = `${(ageDays / 365).toFixed(1)}y`;
          }
          
          return `
            <div class="pr"
              data-number="${pr.number}"
              data-repo="${repoDisplay.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"
              data-title="${String(pr.title || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"
              data-author="${String(pr.author || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"
              data-age-days="${ageDays}"
              data-reviewer-count="${reviewerCount}">
              <div class="pr-number">
                <a href="${pr.url}" target="_blank">#${pr.number}</a>
                ${pr.isDraft ? '<span class="draft-badge">Draft</span>' : ''}
                ${repoUrl ? `, <a class="repo-link" href="${repoUrl}" target="_blank" rel="noreferrer">${repoDisplay}</a>` : (repoDisplay ? `, <span class="pr-repo">${repoDisplay}</span>` : '')}
              </div>
              <div class="pr-title">
                ${pr.ticketNumber ? `<a class="ticket-number-link" href="https://${JIRA_HOST}/browse/${pr.ticketNumber}" target="_blank" rel="noreferrer"><span class="ticket-number">${pr.ticketNumber}</span></a>` : ''}
                <a href="${pr.url}" target="_blank" rel="noreferrer">${pr.title}</a>
              </div>
              <div class="pr-author">
                ${pr.authorAvatarUrl ? `<img class="gh-avatar" src="${pr.authorAvatarUrl}" alt="${pr.author}"/>` : ''}
                <span>${pr.author}</span>
              </div>
              <div class="pr-dates">
                <div><strong>${ageText}</strong></div>
                <div>Opened: ${pr.createdAt.format('MM/DD/YY')}</div>
              </div>
              <div class="pr-reviewers">
                ${reviewersHtml}
              </div>
            </div>
          `;
        }).join('')}
        </div>
      </div>
    `;

    res.send(renderPage('Pull Requests', content, styles));

  } catch (error) {
    debugError('Error in /pr route:', error);
    if (error.response) {
      debugError('Response status:', error.response.status);
      debugError('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).send(renderPage('Pull Requests', `
      <h1>Pull Requests</h1>
      <p>Error: ${error.message}${error.response ? ` (Status: ${error.response.status})` : ''}</p>
    `, ''));
  }
});

app.get('/load', async (req, res) => {
  try {
    // 1. Get board configuration to get columns (statuses) and project key
    let boardColumns = [];
    let projectKey = null;
    try {
      const configResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/configuration`);
      const columnConfig = configResponse.data.columnConfig;
      if (columnConfig && columnConfig.columns) {
        boardColumns = columnConfig.columns.map(col => {
          // Extract status names - handle different possible structures
          let statusNames = [];
          if (col.statuses && Array.isArray(col.statuses) && col.statuses.length > 0) {
            statusNames = col.statuses.map(s => {
              // Status can be an object with 'name' property or just a string
              if (typeof s === 'object' && s !== null) {
                return s.name || s.id || String(s);
              }
              return String(s);
            });
          }
          // If statuses array is empty, try to map column name to common status names
          if (statusNames.length === 0 && col.name) {
            // Try to map common column names to status names
            const columnName = col.name.toLowerCase();
            if (columnName.includes('to do') || columnName.includes('todo')) {
              statusNames = ['To Do'];
            } else if (columnName.includes('ready') || columnName.includes('development')) {
              statusNames = ['Ready for Development'];
            } else if (columnName.includes('progress')) {
              statusNames = ['In Progress'];
            } else if (columnName.includes('review')) {
              statusNames = ['In Review'];
            } else if (columnName.includes('done')) {
              statusNames = ['Done', "Won't Do", "Wont Do"];
            }
          }
          return {
            name: col.name,
            statuses: statusNames
          };
        });
      }
      
      // Log board columns for debugging
      debugLog('Board columns parsed:', boardColumns.map(col => `${col.name}: [${col.statuses.join(', ')}]`).join(' | '));
      
      // Get project key from board location
      const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}`);
      if (boardResponse.data && boardResponse.data.location) {
        projectKey = boardResponse.data.location.projectKey;
      }
    } catch (error) {
      debugError('Error fetching board configuration:', error.message);
      // Fallback: use common statuses if config fetch fails
      boardColumns = [
        { name: 'To Do', statuses: ['To Do'] },
        { name: 'In Progress', statuses: ['In Progress', 'Ready for Development'] },
        { name: 'In Review', statuses: ['In Review'] },
        { name: 'Done', statuses: ['Done', "Won't Do", "Wont Do"] }
      ];
    }

    // If we couldn't get project key from board, try to get it from a sample issue
    if (!projectKey) {
      try {
        const sampleIssueResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
          params: {
            fields: 'key',
            maxResults: 1
          }
        });
        if (sampleIssueResponse.data.issues && sampleIssueResponse.data.issues.length > 0) {
          const issueKey = sampleIssueResponse.data.issues[0].key;
          projectKey = issueKey.split('-')[0]; // Extract project key from issue key (e.g., "ENG-123" -> "ENG")
        }
      } catch (error) {
        debugError('Error getting project key from sample issue:', error.message);
      }
    }

    if (!projectKey) {
      return res.status(500).send(renderPage('Load Report', `
        <h1>Sprint Load</h1>
        <p>Error: Could not determine project key. Please check board configuration.</p>
      `, ''));
    }

    // 2. Get issues from current sprint using openSprints() JQL function
    const currentSprintAssignees = new Set();
    const currentSprintLoadByAssignee = new Map(); // Map<assigneeName, Map<columnName, count>>
    const assigneeAvatars = new Map(); // Map<assigneeName, avatarUrl>
    let currentSprint = null;
    let currentSprintIssues = [];
    
    try {
      const jqlQuery = `project = "${projectKey}" AND sprint in openSprints() ORDER BY created DESC`;
      let startAt = 0;
      const maxResults = 100;
      let hasMore = true;
      
      while (hasMore) {
        const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
          params: {
            jql: jqlQuery,
            fields: 'key,status,assignee,sprint',
            startAt: startAt,
            maxResults: maxResults
          }
        });
        
        const issues = boardResponse.data.issues || [];
        currentSprintIssues = currentSprintIssues.concat(issues);
        
        const total = boardResponse.data.total || 0;
        startAt += issues.length;
        hasMore = startAt < total && issues.length > 0;
      }
      
      // Get sprint info - collect all unique sprint IDs from issues
      const currentSprintIds = new Set();
      currentSprintIssues.forEach(issue => {
        if (issue.fields.sprint) {
          if (Array.isArray(issue.fields.sprint)) {
            issue.fields.sprint.forEach(sprint => {
              if (sprint && sprint.id) {
                currentSprintIds.add(sprint.id);
              }
            });
          } else if (issue.fields.sprint.id) {
            currentSprintIds.add(issue.fields.sprint.id);
          }
        }
      });
      
      // Get sprint details - use the first one (should only be one open sprint)
      if (currentSprintIds.size > 0) {
        const sprintId = Array.from(currentSprintIds)[0];
        try {
          const sprintResponse = await jiraClient.get(`/rest/agile/1.0/sprint/${sprintId}`);
          currentSprint = sprintResponse.data;
          debugLog(`Current sprint detected: ${currentSprint.name} (ID: ${sprintId})`);
        } catch (error) {
          debugError('Error fetching sprint details:', error.message);
        }
      } else {
        debugLog('No sprint IDs found in current sprint issues');
      }
      
      // Process current sprint issues - count ALL issues including unassigned
      const statusCounts = new Map();
      const unmappedStatuses = new Set();
      let assignedCount = 0;
      let unassignedCount = 0;
      const unassignedLoad = new Map(); // Map<columnName, count> for unassigned issues
      
      currentSprintIssues.forEach(issue => {
        const statusName = issue.fields.status ? issue.fields.status.name : 'Unknown';
        const assigneeName = issue.fields.assignee ? issue.fields.assignee.displayName : null;
        
        // Track status counts for debugging
        statusCounts.set(statusName, (statusCounts.get(statusName) || 0) + 1);
        
        // Find which column this status belongs to
        // Normalize status name for comparison (lowercase, trim)
        const normalizedStatusName = statusName.toLowerCase().trim();
        let columnName = 'Other';
        let statusMapped = false;
        
        // Special handling: "Won't Do" should map to "Done" column
        const isWontDo = normalizedStatusName === "won't do" || normalizedStatusName === "wont do";
        
        for (const column of boardColumns) {
          // Check if status is in column's statuses list
          if (column.statuses && column.statuses.length > 0) {
            const normalizedColumnStatuses = column.statuses.map(s => s.toLowerCase().trim());
            if (normalizedColumnStatuses.includes(normalizedStatusName) || 
                (isWontDo && normalizedColumnStatuses.some(s => s === 'done'))) {
              columnName = column.name;
              statusMapped = true;
              break;
            }
          }
          
          // Fallback: Compare normalized status name to normalized column name
          if (column.name && !statusMapped) {
            const normalizedColumnName = column.name.toLowerCase().trim();
            if (normalizedColumnName === normalizedStatusName || 
                (isWontDo && normalizedColumnName.includes('done'))) {
              columnName = column.name;
              statusMapped = true;
              break;
            }
          }
        }
        
        if (!statusMapped && statusName !== 'Unknown') {
          unmappedStatuses.add(statusName);
        }
        
        // Count all issues, assigned or unassigned
        if (assigneeName) {
          assignedCount++;
          // Collect assignee
          currentSprintAssignees.add(assigneeName);
          
          // Collect avatar URL if available
          if (issue.fields.assignee && issue.fields.assignee.avatarUrls) {
            const avatarUrl = issue.fields.assignee.avatarUrls['48x48'] || 
                             issue.fields.assignee.avatarUrls['32x32'] ||
                             issue.fields.assignee.avatarUrls['24x24'];
            if (avatarUrl && !assigneeAvatars.has(assigneeName)) {
              assigneeAvatars.set(assigneeName, avatarUrl);
            }
          }
          
          if (!currentSprintLoadByAssignee.has(assigneeName)) {
            currentSprintLoadByAssignee.set(assigneeName, new Map());
          }
          
          const assigneeLoad = currentSprintLoadByAssignee.get(assigneeName);
          const currentCount = assigneeLoad.get(columnName) || 0;
          assigneeLoad.set(columnName, currentCount + 1);
        } else {
          unassignedCount++;
          // Track unassigned issues by column
          const currentUnassignedCount = unassignedLoad.get(columnName) || 0;
          unassignedLoad.set(columnName, currentUnassignedCount + 1);
        }
      });
      
      // Add "Unassigned" to the assignees set if there are unassigned issues
      if (unassignedCount > 0) {
        currentSprintAssignees.add('Unassigned');
        currentSprintLoadByAssignee.set('Unassigned', unassignedLoad);
        // Add default avatar for unassigned (gray placeholder)
        if (!assigneeAvatars.has('Unassigned')) {
          // Use a simple data URI for a gray placeholder avatar
          assigneeAvatars.set('Unassigned', 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNCIgZmlsbD0iI0Q0RTVGNyIvPgo8cGF0aCBkPSJNMTYgMTBDMTguMjA5MSAxMCAyMCAxMS43OTA5IDIwIDE0QzIwIDE2LjIwOTEgMTguMjA5MSAxOCAxNiAxOEMxMy43OTA5IDE4IDEyIDE2LjIwOTEgMTIgMTRDMTIgMTEuNzkwOSAxMy43OTA5IDEwIDE2IDEwWk0xNiAyMEMxOC42NzYxIDIwIDIwLjg4ODkgMjEuMjY3OCAyMiAyMy4zMzMzQzIyIDE5LjU1NzkgMTkuMzEzNyAxNyAxNiAxN0MxMi42ODYzIDE3IDEwIDE5LjU1NzkgMTAgMjMuMzMzM0MxMS4xMTExIDIxLjI2NzggMTMuMzIzOSAyMCAxNiAyMFoiIGZpbGw9IiM2Qjc4OEMiLz4KPC9zdmc+');
        }
      }
      
      debugLog(`Assigned issues: ${assignedCount}, Unassigned: ${unassignedCount}`);
      debugLog(`Found ${currentSprintIssues.length} issues in current sprint`);
      debugLog(`Status breakdown:`, Array.from(statusCounts.entries()).map(([status, count]) => `${status}: ${count}`).join(', '));
      debugLog(`Board columns:`, boardColumns.map(col => `${col.name}: [${col.statuses.join(', ')}]`).join(' | '));
      
      if (unmappedStatuses.size > 0) {
        debugLog(`WARNING: Unmapped statuses found: ${Array.from(unmappedStatuses).join(', ')}`);
        debugLog(`These statuses are not matching any board column. Check status name casing/spelling.`);
      }
      
      debugLog(`Current sprint assignees: ${Array.from(currentSprintAssignees).join(', ')}`);
      
      // Log detailed sample of what we're counting
      const sampleAssignees = Array.from(currentSprintLoadByAssignee.entries()).slice(0, 5);
      if (sampleAssignees.length > 0) {
        debugLog(`Load by assignee (first 5):`, sampleAssignees.map(([name, load]) => `${name}: ${JSON.stringify(Object.fromEntries(load))}`).join(', '));
      } else {
        debugLog(`ERROR: No assignee load data found! This means no issues were counted.`);
        // Log first few issues to debug
        debugLog(`Sample issues (first 5):`, currentSprintIssues.slice(0, 5).map(issue => ({
          key: issue.key,
          status: issue.fields.status?.name,
          assignee: issue.fields.assignee?.displayName || 'UNASSIGNED',
          hasStatus: !!issue.fields.status,
          hasAssignee: !!issue.fields.assignee,
          fieldsKeys: Object.keys(issue.fields || {})
        })));
      }
      
      // Verify total counts
      let totalCounted = 0;
      currentSprintLoadByAssignee.forEach((load) => {
        load.forEach((count) => {
          totalCounted += count;
        });
      });
      debugLog(`Total issues counted in load map: ${totalCounted} (should be ${currentSprintIssues.length})`);
    } catch (error) {
      debugError('Error fetching current sprint issues:', error.message);
      return res.status(500).send(renderPage('Load Report', `
        <h1>Sprint Load</h1>
        <p>Error fetching current sprint issues: ${error.message}</p>
      `, ''));
    }

    // 3. Get ALL future sprints from the board API, then get their issues
    const upcomingLoadByAssignee = new Map(); // Map<assigneeName, Map<sprintName, count>>
    const upcomingSprintsMap = new Map(); // Map<sprintId, sprintObject>
    let upcomingSprints = [];
    
    try {
      // First, get all sprints from the board to find future ones
      const sprintsResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/sprint`, {
        params: {
          maxResults: 50
        }
      });
      
      const allSprints = sprintsResponse.data.values || [];
      const now = moment();
      
      // Identify future sprints (not active, start date in future or no start date)
      const futureSprintIds = new Set();
      allSprints.forEach(sprint => {
        let isActive = false;
        if (sprint.startDate && sprint.endDate) {
          const startDate = moment(sprint.startDate);
          const endDate = moment(sprint.endDate);
          isActive = now.isBetween(startDate, endDate, null, '[]');
        }
        
        // Future sprint: not active and (no start date OR start date in future)
        if (!isActive) {
          if (!sprint.startDate || moment(sprint.startDate).isAfter(now)) {
            futureSprintIds.add(sprint.id);
            upcomingSprintsMap.set(sprint.id, sprint);
          }
        }
      });
      
      // Get all future sprint issues using futureSprints() JQL
      const jqlQuery = `project = "${projectKey}" AND sprint in futureSprints() ORDER BY created DESC`;
      let startAt = 0;
      const maxResults = 100;
      let hasMore = true;
      const futureSprintIssues = [];
      
      while (hasMore) {
        const boardResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
          params: {
            jql: jqlQuery,
            fields: 'key,assignee,sprint',
            startAt: startAt,
            maxResults: maxResults
          }
        });
        
        const issues = boardResponse.data.issues || [];
        futureSprintIssues.push(...issues);
        
        const total = boardResponse.data.total || 0;
        startAt += issues.length;
        hasMore = startAt < total && issues.length > 0;
      }
      
      // Build list of all future sprints (including ones with no tickets)
      upcomingSprints = Array.from(futureSprintIds)
        .map(id => upcomingSprintsMap.get(id))
        .filter(s => s !== undefined);
      
      // Sort upcoming sprints by end date (sprints with no dates go at the end)
      upcomingSprints.sort((a, b) => {
        if (a.endDate && b.endDate) {
          return moment(a.endDate).valueOf() - moment(b.endDate).valueOf();
        }
        if (a.endDate && !b.endDate) {
          return -1;
        }
        if (!a.endDate && b.endDate) {
          return 1;
        }
        return 0;
      });
      
      // Process future sprint issues - include unassigned
      const upcomingUnassignedBySprint = new Map(); // Map<sprintName, count>
      
      futureSprintIssues.forEach(issue => {
        const assigneeName = issue.fields.assignee ? issue.fields.assignee.displayName : null;
        
        if (issue.fields.sprint) {
          const sprintId = Array.isArray(issue.fields.sprint) 
            ? issue.fields.sprint[0].id 
            : issue.fields.sprint.id;
          
          const sprint = upcomingSprintsMap.get(sprintId);
          if (sprint) {
            const sprintName = sprint.name;
            
            if (assigneeName && currentSprintAssignees.has(assigneeName)) {
              // Assigned to current sprint team member
              if (!upcomingLoadByAssignee.has(assigneeName)) {
                upcomingLoadByAssignee.set(assigneeName, new Map());
              }
              
              // Collect avatar URL if available
              if (issue.fields.assignee && issue.fields.assignee.avatarUrls) {
                const avatarUrl = issue.fields.assignee.avatarUrls['48x48'] || 
                                 issue.fields.assignee.avatarUrls['32x32'] ||
                                 issue.fields.assignee.avatarUrls['24x24'];
                if (avatarUrl && !assigneeAvatars.has(assigneeName)) {
                  assigneeAvatars.set(assigneeName, avatarUrl);
                }
              }
              
              const assigneeUpcomingLoad = upcomingLoadByAssignee.get(assigneeName);
              const currentCount = assigneeUpcomingLoad.get(sprintName) || 0;
              assigneeUpcomingLoad.set(sprintName, currentCount + 1);
            } else if (!assigneeName) {
              // Unassigned issue
              const currentUnassignedCount = upcomingUnassignedBySprint.get(sprintName) || 0;
              upcomingUnassignedBySprint.set(sprintName, currentUnassignedCount + 1);
            }
          }
        }
      });
      
      // Add unassigned to the assignees set if there are unassigned issues
      if (upcomingUnassignedBySprint.size > 0) {
        currentSprintAssignees.add('Unassigned');
        upcomingLoadByAssignee.set('Unassigned', upcomingUnassignedBySprint);
        // Add default avatar for unassigned (gray placeholder) if not already set
        if (!assigneeAvatars.has('Unassigned')) {
          // Use a simple data URI for a gray placeholder avatar
          assigneeAvatars.set('Unassigned', 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNCIgZmlsbD0iI0Q0RTVGNyIvPgo8cGF0aCBkPSJNMTYgMTBDMTguMjA5MSAxMCAyMCAxMS43OTA5IDIwIDE0QzIwIDE2LjIwOTEgMTguMjA5MSAxOCAxNiAxOEMxMy43OTA5IDE4IDEyIDE2LjIwOTEgMTIgMTRDMTIgMTEuNzkwOSAxMy43OTA5IDEwIDE2IDEwWk0xNiAyMEMxOC42NzYxIDIwIDIwLjg4ODkgMjEuMjY3OCAyMiAyMy4zMzMzQzIyIDE5LjU1NzkgMTkuMzEzNyAxNyAxNiAxN0MxMi42ODYzIDE3IDEwIDE5LjU1NzkgMTAgMjMuMzMzM0MxMS4xMTExIDIxLjI2NzggMTMuMzIzOSAyMCAxNiAyMFoiIGZpbGw9IiM2Qjc4OEMiLz4KPC9zdmc+');
        }
      }
      
      debugLog(`Found ${futureSprintIssues.length} issues in future sprints`);
      debugLog(`Future sprints: ${upcomingSprints.map(s => s.name).join(', ')}`);
    } catch (error) {
      debugError('Error fetching future sprint issues:', error.message);
    }

    // 8. Build HTML content
    const styles = `
      <style>
        .load-section {
          margin-bottom: 40px;
        }
        .load-section h2 {
          color: #172B4D;
          margin-bottom: 20px;
          border-bottom: 2px solid #DFE1E6;
          padding-bottom: 10px;
        }
        .load-table {
          width: 100%;
          border-collapse: collapse;
          background: white;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .load-table th {
          background: #DFE1E6;
          padding: 12px 16px;
          text-align: left;
          font-weight: 600;
          color: #172B4D;
          border-bottom: 2px solid #C1C7D0;
          position: relative;
        }
        .load-table th.sortable {
          cursor: pointer;
          user-select: none;
        }
        .load-table th.sortable:hover {
          background: #C1C7D0;
        }
        .load-table th .sort-indicator {
          display: inline-block;
          margin-left: 6px;
          color: #6B778C;
          font-size: 12px;
        }
        .load-table th.sort-asc .sort-indicator::after {
          content: '▲';
          color: #0052CC;
        }
        .load-table th.sort-desc .sort-indicator::after {
          content: '▼';
          color: #0052CC;
        }
        .load-table td {
          padding: 12px 16px;
          border-bottom: 1px solid #DFE1E6;
        }
        .load-table tr:last-child td {
          border-bottom: none;
        }
        .load-table tbody tr:nth-child(even) {
          background: #FAFBFC;
        }
        .load-table tbody tr:nth-child(odd) {
          background: white;
        }
        .load-table tr:hover {
          background: #F4F5F7 !important;
        }
        .assignee-name {
          font-weight: 600;
          color: #172B4D;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .assignee-avatar {
          width: 32px;
          height: 32px;
          border-radius: 4px;
          flex-shrink: 0;
        }
        .count {
          text-align: center;
          font-weight: 500;
        }
        .count.zero {
          color: #6B778C;
        }
        .total-row {
          background: #F4F5F7;
          font-weight: 600;
        }
        .total-row td {
          border-top: 2px solid #DFE1E6;
        }
        .total-row .percentage {
          color: #6B778C;
          font-size: 0.85em;
          font-weight: 400;
        }
        .summary {
          color: #6B778C;
          margin-bottom: 30px;
        }
        .sprint-info {
          background: #F4F5F7;
          padding: 12px 16px;
          border-radius: 4px;
          margin-bottom: 20px;
          color: #172B4D;
        }
        .sprint-info strong {
          color: #0052CC;
        }
      </style>
      <script>
        function sortTable(tableId, columnIndex, isNumeric = false) {
          const table = document.getElementById(tableId);
          if (!table) return;
          
          const tbody = table.querySelector('tbody');
          const rows = Array.from(tbody.querySelectorAll('tr:not(.total-row)'));
          const header = table.querySelectorAll('thead th')[columnIndex];
          
          // Remove sort classes from all headers
          table.querySelectorAll('thead th').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
          });
          
          // Determine sort direction (toggle: no sort -> asc -> desc -> asc)
          const isCurrentlyDesc = header.classList.contains('sort-desc');
          const isCurrentlyAsc = header.classList.contains('sort-asc');
          header.classList.remove('sort-asc', 'sort-desc');
          
          // If currently descending, switch to ascending; if ascending, switch to descending; if no sort, start ascending
          const isAsc = isCurrentlyDesc || (!isCurrentlyAsc && !isCurrentlyDesc);
          header.classList.add(isAsc ? 'sort-asc' : 'sort-desc');
          
          // Sort rows
          rows.sort((a, b) => {
            const aCell = a.cells[columnIndex];
            const bCell = b.cells[columnIndex];
            
            let aValue, bValue;
            
            if (isNumeric) {
              // Extract numeric value (handle strong tags, etc.)
              aValue = parseFloat(aCell.textContent.trim()) || 0;
              bValue = parseFloat(bCell.textContent.trim()) || 0;
            } else {
              // Text comparison
              aValue = aCell.textContent.trim().toLowerCase();
              bValue = bCell.textContent.trim().toLowerCase();
            }
            
            if (aValue < bValue) return isAsc ? 1 : -1;
            if (aValue > bValue) return isAsc ? -1 : 1;
            return 0;
          });
          
          // Re-append sorted rows (excluding total row)
          const totalRow = tbody.querySelector('.total-row');
          rows.forEach(row => tbody.appendChild(row));
          if (totalRow) {
            tbody.appendChild(totalRow);
          }
        }
        
        // Initialize sortable headers on page load
        function initTableSorting() {
          document.querySelectorAll('.load-table').forEach((table) => {
            const headers = Array.from(table.querySelectorAll('thead th.sortable'));
            headers.forEach((th, index) => {
              th.addEventListener('click', function() {
                const tableId = table.id;
                const isNumeric = this.classList.contains('sort-numeric');
                sortTable(tableId, index, isNumeric);
              });
            });
          });
        }
        
        // Run on DOMContentLoaded and also immediately (in case DOM is already loaded)
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initTableSorting);
        } else {
          initTableSorting();
        }
      </script>
    `;

    // Build current sprint load table
    let currentSprintHTML = '';
    if (currentSprint) {
      const startDate = currentSprint.startDate ? moment(currentSprint.startDate).format('MMM D, YYYY') : 'Not set';
      const endDate = currentSprint.endDate ? moment(currentSprint.endDate).format('MMM D, YYYY') : 'Not set';
      
      // Sort assignees with "Unassigned" at the end
      const currentSprintAssigneesList = Array.from(currentSprintAssignees).sort((a, b) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return a.localeCompare(b);
      });
      
      currentSprintHTML = `
        <div class="load-section">
          <h2>Current Sprint: ${currentSprint.name}${currentSprint.startDate && currentSprint.endDate ? ` (${startDate} - ${endDate})` : ''}</h2>
          <p class="summary">Ticket count per team member by board column for the current sprint</p>
          <table class="load-table" id="current-sprint-table">
            <thead>
              <tr>
                <th class="sortable">Team Member<span class="sort-indicator"></span></th>
                ${boardColumns.map(col => `<th class="sortable sort-numeric">${col.name}<span class="sort-indicator"></span></th>`).join('')}
                <th class="sortable sort-numeric">Total<span class="sort-indicator"></span></th>
              </tr>
            </thead>
            <tbody>
      `;

      // Calculate totals per column for current sprint
      const currentSprintColumnTotals = new Map();
      boardColumns.forEach(col => currentSprintColumnTotals.set(col.name, 0));

      currentSprintAssigneesList.forEach(assignee => {
        const assigneeLoad = currentSprintLoadByAssignee.get(assignee) || new Map();
        let rowTotal = 0;
        
        const cells = boardColumns.map(col => {
          const count = assigneeLoad.get(col.name) || 0;
          rowTotal += count;
          currentSprintColumnTotals.set(col.name, currentSprintColumnTotals.get(col.name) + count);
          return `<td class="count ${count === 0 ? 'zero' : ''}">${count}</td>`;
        }).join('');
        
        // Get avatar URL for this assignee
        const avatarUrl = assigneeAvatars.get(assignee);
        const avatarHTML = avatarUrl ? `<img src="${avatarUrl}" alt="${assignee}" class="assignee-avatar">` : '';
        
        currentSprintHTML += `
          <tr>
            <td class="assignee-name">${avatarHTML}${assignee}</td>
            ${cells}
            <td class="count"><strong>${rowTotal}</strong></td>
          </tr>
        `;
      });

      // Add totals row for current sprint
      const currentSprintGrandTotal = Array.from(currentSprintColumnTotals.values()).reduce((sum, val) => sum + val, 0);
      currentSprintHTML += `
        <tr class="total-row">
          <td><strong>Total</strong></td>
          ${boardColumns.map(col => {
            const colTotal = currentSprintColumnTotals.get(col.name);
            const percentage = currentSprintGrandTotal > 0 ? ((colTotal / currentSprintGrandTotal) * 100).toFixed(1) : '0.0';
            return `<td class="count"><strong>${colTotal}</strong> <span class="percentage">(${percentage}%)</span></td>`;
          }).join('')}
          <td class="count"><strong>${currentSprintGrandTotal}</strong></td>
        </tr>
      `;

      currentSprintHTML += `
            </tbody>
          </table>
        </div>
      `;
    }

    // Build upcoming sprints load table
    let upcomingSprintsHTML = '';
    if (upcomingSprints.length > 0) {
      // Show all current sprint assignees, even if they have 0 tickets in upcoming sprints
      // Sort with "Unassigned" at the end
      const upcomingAssignees = Array.from(currentSprintAssignees).sort((a, b) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return a.localeCompare(b);
      });
      
      upcomingSprintsHTML = `
        <div class="load-section">
          <h2>Upcoming Sprints</h2>
          <p class="summary">Ticket count per team member for upcoming sprints (not yet started/active)</p>
          <table class="load-table" id="upcoming-sprints-table">
            <thead>
              <tr>
                <th class="sortable">Team Member<span class="sort-indicator"></span></th>
                ${upcomingSprints.map(sprint => `<th class="sortable sort-numeric">${sprint.name}<span class="sort-indicator"></span></th>`).join('')}
                <th class="sortable sort-numeric">Total<span class="sort-indicator"></span></th>
              </tr>
            </thead>
            <tbody>
      `;

      // Calculate totals per sprint
      const sprintTotals = new Map();
      upcomingSprints.forEach(sprint => sprintTotals.set(sprint.name, 0));

      upcomingAssignees.forEach(assignee => {
        const assigneeUpcomingLoad = upcomingLoadByAssignee.get(assignee) || new Map();
        let rowTotal = 0;
        
        const cells = upcomingSprints.map(sprint => {
          const count = assigneeUpcomingLoad.get(sprint.name) || 0;
          rowTotal += count;
          sprintTotals.set(sprint.name, sprintTotals.get(sprint.name) + count);
          return `<td class="count ${count === 0 ? 'zero' : ''}">${count}</td>`;
        }).join('');
        
        // Get avatar URL for this assignee
        const avatarUrl = assigneeAvatars.get(assignee);
        const avatarHTML = avatarUrl ? `<img src="${avatarUrl}" alt="${assignee}" class="assignee-avatar">` : '';
        
        upcomingSprintsHTML += `
          <tr>
            <td class="assignee-name">${avatarHTML}${assignee}</td>
            ${cells}
            <td class="count"><strong>${rowTotal}</strong></td>
          </tr>
        `;
      });

      // Add totals row
      const upcomingGrandTotal = Array.from(sprintTotals.values()).reduce((sum, val) => sum + val, 0);
      upcomingSprintsHTML += `
        <tr class="total-row">
          <td><strong>Total</strong></td>
          ${upcomingSprints.map(sprint => `<td class="count"><strong>${sprintTotals.get(sprint.name)}</strong></td>`).join('')}
          <td class="count"><strong>${upcomingGrandTotal}</strong></td>
        </tr>
      `;

      upcomingSprintsHTML += `
            </tbody>
          </table>
        </div>
      `;
    } else {
      upcomingSprintsHTML = `
        <div class="load-section">
          <h2>Upcoming Sprints</h2>
          <p class="summary">No upcoming sprints found.</p>
        </div>
      `;
    }

    const content = `
      <h1>Sprint Load</h1>
      ${currentSprintHTML}
      ${upcomingSprintsHTML}
    `;

    res.send(renderPage('Load Report', content, styles));
  } catch (error) {
    debugError('Error in /load route:', error);
    res.status(error.response?.status || 500).send(renderPage('Load Report', `
      <h1>Sprint Load</h1>
      <p>Error: ${error.message}${error.response ? ` (Status: ${error.response.status})` : ''}</p>
    `, ''));
  }
});

app.listen(PORT, () => {
  debugLog(`Server running on http://localhost:${PORT}`);
});
