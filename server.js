require('dotenv').config();
const express = require('express');
const axios = require('axios');
const moment = require('moment');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from img folder
app.use('/img', express.static('img'));

// Config
const JIRA_HOST = process.env.JIRA_HOST; 
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const BOARD_ID = process.env.BOARD_ID || 7;

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

app.get('/', (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Jira Shame - Dashboard</title>
      <link rel="icon" type="image/png" href="/img/favico.png">
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
          padding: 0; 
          background: #f4f5f7; 
          color: #172B4D;
          margin: 0;
        }
        .container { 
          max-width: 1200px; 
          margin: 0 auto; 
          padding: 60px 40px;
        }
        h1 { 
          text-align: center; 
          font-size: 48px;
          margin-bottom: 10px;
          color: #172B4D;
        }
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
    </head>
    <body>
      <div class="container">
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
        </div>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

app.get('/slow', async (req, res) => {
  try {
    // 1. Get the current/latest sprint for the board using dates
    let currentSprintId = null;
    let currentSprintName = null;
    try {
      // Fetch all sprints (active, future, and closed) to find the current one by date
      const sprintsResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/sprint`, {
        params: {
          maxResults: 50  // Get enough sprints to find the current one
        }
      });
      
      const allSprints = sprintsResponse.data.values || [];
      
      const now = moment();
      let currentSprint = null;
      
      // Find the sprint that is currently active based on dates
      // A sprint is "current" if now is between its startDate and endDate
      for (const sprint of allSprints) {
        if (sprint.startDate && sprint.endDate) {
          const startDate = moment(sprint.startDate);
          const endDate = moment(sprint.endDate);
          
          if (now.isBetween(startDate, endDate, null, '[]')) {
            // This sprint is currently active
            currentSprint = sprint;
            break;
          }
        }
      }
      
      // If no active sprint found by date, get the most recent sprint (by start date)
      if (!currentSprint && allSprints.length > 0) {
        // Sort by start date (most recent first)
        const sprintsWithDates = allSprints
          .filter(s => s.startDate)
          .sort((a, b) => moment(b.startDate).valueOf() - moment(a.startDate).valueOf());
        
        if (sprintsWithDates.length > 0) {
          currentSprint = sprintsWithDates[0];
        }
      }
      
      if (currentSprint) {
        currentSprintId = currentSprint.id;
        currentSprintName = currentSprint.name;
      }
    } catch (error) {
      // Continue without sprint filter if sprint fetch fails
    }
    
    // 2. Construct JQL for multiple statuses
    const statusString = TARGET_STATUSES.map(s => `'${s}'`).join(',');
    
    // Build JQL query with sprint filter if we have a sprint
    let jqlQuery = `status in (${statusString})`;
    if (currentSprintId) {
      jqlQuery += ` AND sprint = ${currentSprintId}`;
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
    console.log(`Found ${issues.length} issues from board query`);

    if (issues.length === 0) {
      return res.send('<h1>No stagnant tickets found! 🎉</h1>');
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

    console.log(`After filtering out issues < 7 days: ${processedIssues.length} issues remaining`);

    // 5. Calculate sprint duration (in days) for badge styling
    // Try to get sprint duration from current sprint, otherwise default to 14 days
    let sprintDurationDays = 14; // Default to 2 weeks
    if (currentSprintId && currentSprintName) {
      try {
        const sprintDetails = await jiraClient.get(`/rest/agile/1.0/sprint/${currentSprintId}`);
        if (sprintDetails.data.startDate && sprintDetails.data.endDate) {
          const start = moment(sprintDetails.data.startDate);
          const end = moment(sprintDetails.data.endDate);
          sprintDurationDays = end.diff(start, 'days');
        }
      } catch (error) {
        // Use default 14 days if sprint details can't be fetched
      }
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
    let html = `
      <html>
      <head>
        <title>Stuck Tickets</title>
        <link rel="icon" type="image/png" href="/img/favico.png">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 0 40px; background: #f4f5f7; color: #172B4D;}
          .container { max-width: 1600px; margin: 0 auto; }
          h1 { text-align: center;}
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
          .days-badge.warning { background: #FFFAE6; color: #BF2600; } /* Moderate wait */
          .days-badge.danger { background: #DE350B; color: white; } /* Long wait */
          
          .days-count { font-size: 18px; line-height: 1; }
          .days-label { font-size: 9px; text-transform: uppercase; margin-top: 2px; }
          
          .details { flex-grow: 1; }
          .key { font-weight: bold; color: #0052CC; text-decoration: none; margin-right: 10px;}
          .summary { color: #172B4D; }
          .meta { font-size: 12px; color: #6B778C; margin-top: 4px; }
          .assignee { display: inline-block; background: #EBECF0; padding: 2px 6px; border-radius: 4px; margin-right: 8px;}
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
          .issue-type-icon { display: inline-block; margin-right: 8px; font-size: 16px; vertical-align: middle; }
          .issue-type-icon.bug { color: #E53E3E; }
          .issue-type-icon.story { color: #38A169; }
          .issue-type-icon.task { color: #3182CE; }
          .issue-type-icon.spike { color: #805AD5; }
          .issue-type-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 500; text-transform: uppercase; margin-right: 8px; }
          .issue-type-badge.bug { background: #FFEBE6; color: #BF2600; }
          .issue-type-badge.story { background: #E3FCEF; color: #006644; }
          .issue-type-badge.task { background: #DEEBFF; color: #0052CC; }
          .issue-type-badge.epic { background: #EAE6FF; color: #403294; }
          .issue-type-badge.subtask { background: #F4F5F7; color: #42526E; }
          .issue-type-badge.spike { background: #FFF4E6; color: #974F00; }
          .issue-type-badge.idea { background: #FFF4E6; color: #974F00; }
          .nav-links { text-align: center; margin-bottom: 20px; font-size: 14px; color: #6B778C; }
          .nav-links a { color: #0052CC; text-decoration: none; margin: 0 8px; }
          .nav-links a:hover { text-decoration: underline; }
          .filter-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; padding: 15px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .filter-label { display: inline-block; padding: 6px 12px; background: #EBECF0; color: #172B4D; border-radius: 4px; cursor: pointer; font-size: 13px; transition: all 0.2s; }
          .filter-label:hover { background: #DFE1E6; }
          .filter-label.active { background: #0052CC; color: white; }
          .filter-label.all { background: #DFE1E6; font-weight: 500; }
          .filter-label.all.active { background: #172B4D; color: white; }
          .ticket { display: flex; align-items: center; padding: 12px 0; border-bottom: 1px solid #EBECF0; }
          .ticket.hidden { display: none; }
          
          @media (max-width: 1400px) {
            .status-columns { grid-template-columns: repeat(2, 1fr); }
          }
          @media (max-width: 800px) {
            .status-columns { grid-template-columns: 1fr; }
          }
        </style>
        <script>
          function filterByAssignee(assignee, event) {
            // Update active state
            document.querySelectorAll('.filter-label').forEach(label => {
              label.classList.remove('active');
            });
            if (event && event.target) {
              event.target.classList.add('active');
            } else {
              // Fallback: find label by data-filter attribute
              const filterValue = assignee === 'all' ? 'all' : assignee.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
              const label = document.querySelector('.filter-label[data-filter="' + filterValue + '"]');
              if (label) label.classList.add('active');
            }
            
            // Filter tickets
            const tickets = document.querySelectorAll('.ticket');
            tickets.forEach(ticket => {
              if (assignee === 'all') {
                ticket.classList.remove('hidden');
              } else {
                const ticketAssignee = ticket.getAttribute('data-assignee');
                // Compare decoded values
                const decodedAssignee = assignee.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
                const decodedTicketAssignee = ticketAssignee.replace(/&quot;/g, '"');
                if (decodedTicketAssignee === decodedAssignee) {
                  ticket.classList.remove('hidden');
                } else {
                  ticket.classList.add('hidden');
                }
              }
            });
            
            // Update ticket counts in headers
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
      </head>
      <body>
        <div class="container">
          <div class="nav-links">
            <a href="/">Home</a> | <a href="/slow">Slow Motion</a> | <a href="/done">Completed</a> | <a href="/backlog">Backlog</a> | <a href="/progress">Progress</a>
          </div>
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
        </div>
      </body>
      </html>
    `;

    res.send(html);

  } catch (error) {
    console.error(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/done', async (req, res) => {
  try {
    const period = req.query.period || 'this-week'; // today, yesterday, this-week, last-7-days, this-month, last-month
    
    // Calculate date ranges based on period
    let startDate, endDate, periodLabel;
    const now = moment();
    
    switch (period) {
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
    const startDateStr = startDate.clone().subtract(1, 'day').format('YYYY-MM-DD');
    const endDateStr = endDate.clone().add(1, 'day').format('YYYY-MM-DD');
    const jqlQuery = `status in (Done, "Won't Do") AND resolutiondate >= "${startDateStr}" AND resolutiondate <= "${endDateStr}"`;
    
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
      console.error('Error fetching from board, trying direct search:', error.message);
      // Fallback: try direct search
      const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
        jql: jqlQuery,
        maxResults: 200,
        fields: ['key']
      });
      issueKeys = (searchResponse.data.issues || []).map(i => i.key);
    }
    
    console.log(`Found ${issueKeys.length} completed issues for ${periodLabel}`);
    
    if (issueKeys.length === 0) {
      return res.send(`
        <html>
          <head>
            <title>Completed Tickets</title>
            <link rel="icon" type="image/png" href="/img/favico.png">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; background: #f4f5f7; text-align: center; }
              h1 { color: #172B4D; }
              .period-selector { margin: 20px 0; }
              .period-selector a { display: inline-block; padding: 8px 16px; margin: 0 4px; background: #EBECF0; color: #172B4D; text-decoration: none; border-radius: 4px; }
              .period-selector a.active { background: #0052CC; color: white; }
            </style>
          </head>
          <body>
            <h1>Completed</h1>
            <div class="period-selector">
              <a href="/done?period=today" class="${period === 'today' ? 'active' : ''}">Today</a>
              <a href="/done?period=yesterday" class="${period === 'yesterday' ? 'active' : ''}">Yesterday</a>
              <a href="/done?period=this-week" class="${period === 'this-week' ? 'active' : ''}">This Week</a>
              <a href="/done?period=last-7-days" class="${period === 'last-7-days' ? 'active' : ''}">Last 7 Days</a>
              <a href="/done?period=this-month" class="${period === 'this-month' ? 'active' : ''}">This Month</a>
              <a href="/done?period=last-month" class="${period === 'last-month' ? 'active' : ''}">Last Month</a>
            </div>
            <p style="color: #6B778C; margin-top: 40px;">No completed tickets found for ${periodLabel}</p>
          </body>
        </html>
      `);
    }
    
    // Bulk fetch details using new /rest/api/3/search/jql endpoint
    // Note: sprint field might need to be expanded, but let's try without expand first
    const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
      jql: `key in (${issueKeys.join(',')})`,
      maxResults: 200,
      fields: ['summary', 'status', 'assignee', 'reporter', 'created', 'resolutiondate', 'issuetype', 'sprint', 'resolution']
    });
    
    const issues = searchResponse.data.issues || [];
    console.log(`Found ${issues.length} completed issues for ${periodLabel}`);
    
    if (issues.length === 0) {
      return res.send(`
        <html>
          <head>
            <title>Completed Tickets</title>
            <link rel="icon" type="image/png" href="/img/favico.png">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; background: #f4f5f7; text-align: center; }
              h1 { color: #172B4D; }
              .period-selector { margin: 20px 0; }
              .period-selector a { display: inline-block; padding: 8px 16px; margin: 0 4px; background: #EBECF0; color: #172B4D; text-decoration: none; border-radius: 4px; }
              .period-selector a.active { background: #0052CC; color: white; }
            </style>
          </head>
          <body>
            <h1>Completed</h1>
            <div class="period-selector">
              <a href="/done?period=today" class="${period === 'today' ? 'active' : ''}">Today</a>
              <a href="/done?period=yesterday" class="${period === 'yesterday' ? 'active' : ''}">Yesterday</a>
              <a href="/done?period=this-week" class="${period === 'this-week' ? 'active' : ''}">This Week</a>
              <a href="/done?period=last-7-days" class="${period === 'last-7-days' ? 'active' : ''}">Last 7 Days</a>
              <a href="/done?period=this-month" class="${period === 'this-month' ? 'active' : ''}">This Month</a>
              <a href="/done?period=last-month" class="${period === 'last-month' ? 'active' : ''}">Last Month</a>
            </div>
            <p style="color: #6B778C; margin-top: 40px;">No completed tickets found for ${periodLabel}</p>
          </body>
        </html>
      `);
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
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Completed Tickets - ${periodLabel}</title>
        <link rel="icon" type="image/png" href="/img/favico.png">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 0 40px; background: #f4f5f7; color: #172B4D;}
          .container { max-width: 1400px; margin: 0 auto; }
          h1 { text-align: center; margin-bottom: 10px; }
          .period-selector { display: flex; justify-content: center; gap: 8px; margin: 20px 0 30px; flex-wrap: wrap; }
          .period-selector a { display: inline-block; padding: 8px 16px; background: #EBECF0; color: #172B4D; text-decoration: none; border-radius: 4px; font-size: 14px; transition: all 0.2s; }
          .period-selector a:hover { background: #DFE1E6; }
          .period-selector a.active { background: #0052CC; color: white; }
          .summary { text-align: center; color: #6B778C; margin-bottom: 30px; font-size: 14px; }
          .tickets-list { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 20px; }
          .ticket { padding: 16px; border-bottom: 1px solid #EBECF0; display: grid; grid-template-columns: 120px 1fr 150px 150px 140px; gap: 20px; align-items: center; }
          .ticket:last-child { border-bottom: none; }
          .ticket:hover { background: #F4F5F7; }
          .key { font-weight: bold; color: #0052CC; text-decoration: none; white-space: nowrap; }
          .key:hover { text-decoration: underline; }
          .summary-text { color: #172B4D; }
          .meta { font-size: 13px; color: #6B778C; }
          .assignee, .reporter { display: inline-block; background: #EBECF0; padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
          .duration { font-weight: 600; color: #172B4D; }
          .completed-date { font-size: 12px; color: #6B778C; }
          .header-row { padding: 12px 16px; background: #F4F5F7; border-bottom: 2px solid #DFE1E6; font-weight: 600; font-size: 13px; color: #6B778C; text-transform: uppercase; display: grid; grid-template-columns: 120px 1fr 150px 150px 140px; gap: 20px; }
          .sprint-name { display: inline-block; background: #E3FCEF; color: #006644; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
          .sprint-name.backlog { background: #EBECF0; color: #6B778C; }
          .issue-type-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 500; text-transform: uppercase; margin-right: 8px; }
          .issue-type-badge.bug { background: #FFEBE6; color: #BF2600; }
          .issue-type-badge.story { background: #E3FCEF; color: #006644; }
          .issue-type-badge.task { background: #DEEBFF; color: #0052CC; }
          .issue-type-badge.epic { background: #EAE6FF; color: #403294; }
          .issue-type-badge.subtask { background: #F4F5F7; color: #42526E; }
          .issue-type-badge.spike { background: #FFF4E6; color: #974F00; }
          .issue-type-badge.idea { background: #FFF4E6; color: #974F00; }
          .nav-links { text-align: center; margin-bottom: 20px; font-size: 14px; color: #6B778C; }
          .nav-links a { color: #0052CC; text-decoration: none; margin: 0 8px; }
          .nav-links a:hover { text-decoration: underline; }
          .filter-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; padding: 15px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
          .filter-label { display: inline-block; padding: 6px 12px; background: #EBECF0; color: #172B4D; border-radius: 4px; cursor: pointer; font-size: 13px; transition: all 0.2s; }
          .filter-label:hover { background: #DFE1E6; }
          .filter-label.active { background: #0052CC; color: white; }
          .filter-label.all { background: #DFE1E6; font-weight: 500; }
          .filter-label.all.active { background: #172B4D; color: white; }
          .ticket.hidden { display: none; }
        </style>
        <script>
          function filterByAssignee(assignee, event) {
            // Update active state
            document.querySelectorAll('.filter-label').forEach(label => {
              label.classList.remove('active');
            });
            if (event && event.target) {
              event.target.classList.add('active');
            } else {
              // Fallback: find label by data-filter attribute
              const filterValue = assignee === 'all' ? 'all' : assignee.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
              const label = document.querySelector('.filter-label[data-filter="' + filterValue + '"]');
              if (label) label.classList.add('active');
            }
            
            // Filter tickets
            const tickets = document.querySelectorAll('.ticket');
            tickets.forEach(ticket => {
              if (assignee === 'all') {
                ticket.classList.remove('hidden');
              } else {
                const ticketAssignee = ticket.getAttribute('data-assignee');
                // Compare decoded values
                const decodedAssignee = assignee.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
                const decodedTicketAssignee = ticketAssignee.replace(/&quot;/g, '"');
                if (decodedTicketAssignee === decodedAssignee) {
                  ticket.classList.remove('hidden');
                } else {
                  ticket.classList.add('hidden');
                }
              }
            });
            
            // Update ticket count in summary
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
      </head>
      <body>
        <div class="container">
          <div class="nav-links">
            <a href="/">Home</a> | <a href="/slow">Slow Motion</a> | <a href="/done">Completed</a> | <a href="/backlog">Backlog</a> | <a href="/progress">Progress</a>
          </div>
          <h1>COMPLETED TICKETS</h1>
          <div class="period-selector">
            <a href="/done?period=today" class="${period === 'today' ? 'active' : ''}">Today</a>
            <a href="/done?period=yesterday" class="${period === 'yesterday' ? 'active' : ''}">Yesterday</a>
            <a href="/done?period=this-week" class="${period === 'this-week' ? 'active' : ''}">This Week</a>
            <a href="/done?period=last-7-days" class="${period === 'last-7-days' ? 'active' : ''}">Last 7 Days</a>
            <a href="/done?period=this-month" class="${period === 'this-month' ? 'active' : ''}">This Month</a>
            <a href="/done?period=last-month" class="${period === 'last-month' ? 'active' : ''}">Last Month</a>
          </div>
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
        </div>
      </body>
      </html>
    `;

    res.send(html);

  } catch (error) {
    console.error(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/progress', async (req, res) => {
  try {
    const period = req.query.period || 'last-7-days'; // today, yesterday, this-week, last-7-days, this-month, last-month
    const days = req.query.days ? parseInt(req.query.days) : null; // Optional: custom number of days
    
    // Calculate date ranges based on period
    let startDate, endDate, periodLabel;
    const now = moment();
    
    if (days && days > 0) {
      startDate = moment().subtract(days - 1, 'days').startOf('day');
      endDate = moment().endOf('day');
      periodLabel = `Last ${days} Days`;
    } else {
      switch (period) {
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
    const jqlQuery = `updated >= "${startDateStr}" AND updated < "${endDateNextDay}"`;
    
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
      console.error('Error fetching from board, trying direct search:', error.message);
      // Fallback: try direct search
      const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
        jql: jqlQuery,
        maxResults: 200,
        fields: ['key']
      });
      issueKeys = (searchResponse.data.issues || []).map(i => i.key);
    }
    
    console.log(`Found ${issueKeys.length} updated issues for ${periodLabel}`);
    
    if (issueKeys.length === 0) {
      return res.send(`
        <html>
          <head>
            <title>Progress Report</title>
            <link rel="icon" type="image/png" href="/img/favico.png">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; background: #f4f5f7; text-align: center; }
              h1 { color: #172B4D; }
              .nav-links { text-align: center; margin-bottom: 20px; font-size: 14px; color: #6B778C; }
              .nav-links a { color: #0052CC; text-decoration: none; margin: 0 8px; }
              .nav-links a:hover { text-decoration: underline; }
              .period-selector { margin: 20px 0; }
              .period-selector a { display: inline-block; padding: 8px 16px; margin: 0 4px; background: #EBECF0; color: #172B4D; text-decoration: none; border-radius: 4px; }
              .period-selector a.active { background: #0052CC; color: white; }
            </style>
          </head>
          <body>
            <div class="nav-links">
              <a href="/">Home</a> | <a href="/slow">Slow Motion</a> | <a href="/done">Completed</a> | <a href="/backlog">Backlog</a> | <a href="/progress">Progress</a>
            </div>
            <h1>Progress</h1>
            <div class="period-selector">
              <a href="/progress?period=today" class="${period === 'today' ? 'active' : ''}">Today</a>
              <a href="/progress?period=yesterday" class="${period === 'yesterday' ? 'active' : ''}">Yesterday</a>
              <a href="/progress?period=this-week" class="${period === 'this-week' ? 'active' : ''}">This Week</a>
              <a href="/progress?period=last-7-days" class="${period === 'last-7-days' ? 'active' : ''}">Last 7 Days</a>
              <a href="/progress?period=this-month" class="${period === 'this-month' ? 'active' : ''}">This Month</a>
              <a href="/progress?period=last-month" class="${period === 'last-month' ? 'active' : ''}">Last Month</a>
            </div>
            <p style="color: #6B778C; margin-top: 40px;">No issues with changes found for ${periodLabel}</p>
          </body>
        </html>
      `);
    }
    
    // Bulk fetch details with changelog
    const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
      jql: `key in (${issueKeys.join(',')})`,
      maxResults: 200,
      fields: ['summary', 'status', 'assignee', 'priority', 'created', 'updated', 'issuetype', 'reporter']
    });
    
    const issues = searchResponse.data.issues || [];
    console.log(`Fetched ${issues.length} issues for ${periodLabel}`);
    
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
    
    console.log(`Found ${processedIssues.length} issues with status changes for ${periodLabel}`);
    
    // Generate HTML
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Progress Report - ${periodLabel}</title>
        <link rel="icon" type="image/png" href="/img/favico.png">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 0 40px; background: #f4f5f7; color: #172B4D;}
          .container { max-width: 1600px; margin: 0 auto; }
          h1 { text-align: center; margin-bottom: 10px; }
          .period-selector { display: flex; justify-content: center; gap: 8px; margin: 20px 0 30px; flex-wrap: wrap; }
          .period-selector a { display: inline-block; padding: 8px 16px; background: #EBECF0; color: #172B4D; text-decoration: none; border-radius: 4px; font-size: 14px; transition: all 0.2s; }
          .period-selector a:hover { background: #DFE1E6; }
          .period-selector a.active { background: #0052CC; color: white; }
          .summary { text-align: center; color: #6B778C; margin-bottom: 30px; font-size: 14px; }
          .tickets-list { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 20px; }
          .ticket { padding: 16px; border-bottom: 1px solid #EBECF0; display: grid; grid-template-columns: 120px minmax(200px, 1fr) 150px 150px minmax(250px, 1fr); gap: 20px; align-items: start; }
          .ticket:last-child { border-bottom: none; }
          .ticket:hover { background: #F4F5F7; }
          .key { font-weight: bold; color: #0052CC; text-decoration: none; white-space: nowrap; }
          .key:hover { text-decoration: underline; }
          .summary-text { color: #172B4D; font-size: 15px; max-width: 100%; word-wrap: break-word; overflow-wrap: break-word; }
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
          .assignee, .reporter { display: inline-block; background: #EBECF0; padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
          .header-row { padding: 12px 16px; background: #F4F5F7; border-bottom: 2px solid #DFE1E6; font-weight: 600; font-size: 13px; color: #6B778C; text-transform: uppercase; display: grid; grid-template-columns: 120px minmax(200px, 1fr) 150px 150px minmax(250px, 1fr); gap: 20px; }
          .issue-type-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 500; text-transform: uppercase; margin-right: 8px; }
          .issue-type-badge.bug { background: #FFEBE6; color: #BF2600; }
          .issue-type-badge.story { background: #E3FCEF; color: #006644; }
          .issue-type-badge.task { background: #DEEBFF; color: #0052CC; }
          .issue-type-badge.epic { background: #EAE6FF; color: #403294; }
          .issue-type-badge.subtask { background: #F4F5F7; color: #42526E; }
          .issue-type-badge.spike { background: #FFF4E6; color: #974F00; }
          .issue-type-badge.idea { background: #FFF4E6; color: #974F00; }
          .nav-links { text-align: center; margin-bottom: 20px; font-size: 14px; color: #6B778C; }
          .nav-links a { color: #0052CC; text-decoration: none; margin: 0 8px; }
          .nav-links a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="nav-links">
            <a href="/">Home</a> | <a href="/slow">Slow Motion</a> | <a href="/done">Completed</a> | <a href="/backlog">Backlog</a> | <a href="/progress">Progress</a>
          </div>
          <h1>PROGRESS REPORT</h1>
          <div class="period-selector">
            <a href="/progress?period=today" class="${period === 'today' ? 'active' : ''}">Today</a>
            <a href="/progress?period=yesterday" class="${period === 'yesterday' ? 'active' : ''}">Yesterday</a>
            <a href="/progress?period=this-week" class="${period === 'this-week' ? 'active' : ''}">This Week</a>
            <a href="/progress?period=last-7-days" class="${period === 'last-7-days' ? 'active' : ''}">Last 7 Days</a>
            <a href="/progress?period=this-month" class="${period === 'this-month' ? 'active' : ''}">This Month</a>
            <a href="/progress?period=last-month" class="${period === 'last-month' ? 'active' : ''}">Last Month</a>
          </div>
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
              
              // Format status change - show start → end (overall change)
              if (issue.hasStatusChange) {
                allChanges.push(`<div class="change-item"><strong>Status:</strong> <span class="status-badge from">${issue.startStatus}</span><span class="status-arrow">→</span><span class="status-badge to">${issue.endStatus}</span></div>`);
              }
              
              // Format assignee changes - show ALL changes that happened during the period
              if (issue.assigneeChanges.length > 0) {
                // Show all assignee changes
                issue.assigneeChanges.forEach(change => {
                  allChanges.push(`<div class="change-item"><strong>Assignee:</strong> <span class="assignee-change">${change.from || 'Unassigned'}</span> → <span class="assignee-change">${change.to || 'Unassigned'}</span></div>`);
                });
              } else if (issue.initialAssignee !== issue.currentAssignee) {
                // No changes in period but initial != current (change happened before period)
                allChanges.push(`<div class="change-item"><strong>Assignee:</strong> <span class="assignee-change">${issue.initialAssignee}</span> → <span class="assignee-change">${issue.currentAssignee}</span></div>`);
              }
              
              // Format priority changes - show ALL changes that happened during the period
              if (issue.priorityChanges.length > 0) {
                // Show all priority changes
                issue.priorityChanges.forEach(change => {
                  allChanges.push(`<div class="change-item"><strong>Priority:</strong> <span class="priority-change">${change.from || 'Unset'}</span> → <span class="priority-change">${change.to || 'Unset'}</span></div>`);
                });
              } else if (issue.initialPriority !== issue.currentPriority) {
                // No changes in period but initial != current (change happened before period)
                allChanges.push(`<div class="change-item"><strong>Priority:</strong> <span class="priority-change">${issue.initialPriority}</span> → <span class="priority-change">${issue.currentPriority}</span></div>`);
              }
              
              // Format issue type changes - show ALL changes that happened during the period
              if (issue.issueTypeChanges.length > 0) {
                // Show all type changes
                issue.issueTypeChanges.forEach(change => {
                  allChanges.push(`<div class="change-item"><strong>Type:</strong> <span class="type-change">${change.from || 'Task'}</span> → <span class="type-change">${change.to || 'Task'}</span></div>`);
                });
              } else if (issue.hasIssueTypeChange) {
                // No changes in period but initial != current (change happened before period)
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
        </div>
      </body>
      </html>
    `;

    res.send(html);

  } catch (error) {
    console.error(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.get('/backlog', async (req, res) => {
  try {
    // 1. Get all sprints to identify current/active and upcoming sprints
    let currentSprintIds = new Set();
    let upcomingSprintIds = new Set();
    const sprintMap = new Map(); // Map sprint ID to sprint object
    
    try {
      const sprintsResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/sprint`, {
        params: {
          maxResults: 50
        }
      });
      
      const allSprints = sprintsResponse.data.values || [];
      const now = moment();
      
      // Find current/active sprints and upcoming sprints
      for (const sprint of allSprints) {
        sprintMap.set(sprint.id, sprint);
        
        if (sprint.startDate && sprint.endDate) {
          const startDate = moment(sprint.startDate);
          const endDate = moment(sprint.endDate);
          
          // Current/active sprint: now is between start and end
          if (now.isBetween(startDate, endDate, null, '[]')) {
            currentSprintIds.add(sprint.id);
          }
          // Upcoming sprint: start date is in the future
          else if (startDate.isAfter(now)) {
            upcomingSprintIds.add(sprint.id);
          }
        }
      }
      
      // If no active sprint found by date, get the most recent sprint
      if (currentSprintIds.size === 0 && allSprints.length > 0) {
        const sprintsWithDates = allSprints
          .filter(s => s.startDate)
          .sort((a, b) => moment(b.startDate).valueOf() - moment(a.startDate).valueOf());
        
        if (sprintsWithDates.length > 0) {
          currentSprintIds.add(sprintsWithDates[0].id);
        }
      }
      
    } catch (error) {
      console.error('Error fetching sprints:', error.message);
    }
    
    // 2. Query for ALL open issues (we'll filter by sprint in code)
    const jqlQuery = `status not in (Done, "Won't Do") ORDER BY created ASC`;
    
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
      console.error('Error fetching from board, trying direct search:', error.message);
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
    
    console.log(`Found ${issueKeys.length} total open issues`);
    
    if (issueKeys.length === 0) {
      return res.send(`
        <html>
          <head>
            <title>Backlog Report</title>
            <link rel="icon" type="image/png" href="/img/favico.png">
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; background: #f4f5f7; text-align: center; }
              h1 { color: #172B4D; }
              .nav-links { text-align: center; margin-bottom: 20px; font-size: 14px; color: #6B778C; }
              .nav-links a { color: #0052CC; text-decoration: none; margin: 0 8px; }
              .nav-links a:hover { text-decoration: underline; }
            </style>
          </head>
          <body>
            <div class="nav-links">
              <a href="/">Home</a> | <a href="/slow">Slow Motion</a> | <a href="/done">Completed</a> | <a href="/backlog">Backlog</a> | <a href="/progress">Progress</a>
            </div>
            <h1>Backlog</h1>
            <p style="color: #6B778C; margin-top: 40px;">No backlog issues found</p>
          </body>
        </html>
      `);
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
        console.error(`Error fetching batch ${Math.floor(i/batchSize) + 1}:`, error.message);
        // Continue with other batches even if one fails
      }
    }
    
    console.log(`Fetched ${allIssues.length} total open issues (out of ${issueKeys.length} keys)`);
    
    // 4. Get all issues in current AND upcoming sprints using board API (more reliable)
    const issuesInCurrentOrUpcomingSprints = new Set();
    const allSprintIdsToExclude = new Set([...currentSprintIds, ...upcomingSprintIds]);
    
    if (allSprintIdsToExclude.size > 0) {
      for (const sprintId of allSprintIdsToExclude) {
        try {
          const sprintIssuesResponse = await jiraClient.get(`/rest/agile/1.0/board/${BOARD_ID}/issue`, {
            params: {
              jql: `sprint = ${sprintId}`,
              fields: 'key',
              maxResults: 500
            }
          });
          const sprintIssueKeys = (sprintIssuesResponse.data.issues || []).map(i => i.key);
          sprintIssueKeys.forEach(key => issuesInCurrentOrUpcomingSprints.add(key));
          const sprintName = sprintMap.get(sprintId)?.name || sprintId;
        } catch (error) {
          console.error(`Error fetching issues in sprint ${sprintId}:`, error.message);
        }
      }
    }
    
    // 5. Filter out epics, subtasks, and issues in current/upcoming sprints
    let epicsExcluded = 0;
    let subtasksExcluded = 0;
    let inSprintExcluded = 0;
    
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
      
      // Filter out issues in current or upcoming sprints (using board API check)
      // Note: Issues in PAST sprints are kept (they're now in backlog)
      if (issuesInCurrentOrUpcomingSprints.has(issue.key)) {
        inSprintExcluded++;
        return false;
      }
      
      return true;
    });
    
    
    // 6. For each issue, find the most recent sprint it's in (for display purposes)
    const issuesWithSprints = await Promise.all(
      filteredIssues.map(async (issue) => {
        let latestSprintName = null;
        let latestSprintId = null;
        let isInUpcomingSprint = false;
        
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
          
          // Check if any sprint ID is in upcoming sprints
          for (const sprintId of sprintIds) {
            if (upcomingSprintIds.has(sprintId)) {
              isInUpcomingSprint = true;
            }
          }
          
          // Fetch sprint details to find the most recent one (for display)
          if (sprintIds.length > 0) {
            const sprintDetails = await Promise.all(
              sprintIds.map(async (sprintId) => {
                // Use cached sprint if available, otherwise fetch
                if (sprintMap.has(sprintId)) {
                  return sprintMap.get(sprintId);
                }
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
          latestSprintId: latestSprintId,
          isInUpcomingSprint: isInUpcomingSprint
        };
      })
    );
    
    // 7. Process issues to calculate age with humanized format
    const now = moment();
    const processedIssues = issuesWithSprints.map(issue => {
      const createdDate = moment(issue.fields.created);
      const daysOld = now.diff(createdDate, 'days', true); // Use true for decimal precision
      
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
        summary: issue.fields.summary,
        status: issue.fields.status.name,
        created: createdDate.format('YYYY-MM-DD'),
        createdFormatted: createdDate.format('MM/DD/YY'),
        ageDays: daysOld,
        ageText: ageText,
        link: `https://${JIRA_HOST}/browse/${issue.key}`,
        issueType: (issue.fields.issuetype?.name || 'Task').toLowerCase(),
        reporter: issue.fields.reporter ? issue.fields.reporter.displayName : 'Unknown'
      };
    });
    
    // 8. Sort by creation date ascending (oldest first)
    processedIssues.sort((a, b) => moment(a.created).valueOf() - moment(b.created).valueOf());
    
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
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Backlog Report</title>
        <link rel="icon" type="image/png" href="/img/favico.png">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 0 40px; background: #f4f5f7; color: #172B4D;}
          .container { max-width: 1400px; margin: 0 auto; }
          h1 { text-align: center; margin-bottom: 10px; }
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
          .issues-list { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 20px; }
          .issue { padding: 16px; border-bottom: 1px solid #EBECF0; display: grid; grid-template-columns: 120px 1fr 150px 120px 120px 180px; gap: 20px; align-items: center; }
          .issue:last-child { border-bottom: none; }
          .issue:hover { background: #F4F5F7; }
          .key { font-weight: bold; color: #0052CC; text-decoration: none; white-space: nowrap; }
          .key:hover { text-decoration: underline; }
          .summary-text { color: #172B4D; }
          .status { display: inline-block; background: #EBECF0; padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
          .reporter { display: inline-block; background: #EBECF0; padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
          .age { font-weight: 600; color: #172B4D; }
          .created-date { font-size: 12px; color: #6B778C; }
          .header-row { padding: 12px 16px; background: #F4F5F7; border-bottom: 2px solid #DFE1E6; font-weight: 600; font-size: 13px; color: #6B778C; text-transform: uppercase; display: grid; grid-template-columns: 120px 1fr 150px 120px 120px 180px; gap: 20px; }
          .sprint-badge { display: inline-block; background: #E3FCEF; color: #006644; padding: 4px 8px; border-radius: 4px; font-size: 12px; white-space: nowrap; }
          .sprint-badge.backlog { background: #EBECF0; color: #6B778C; }
          .sprint-badge.upcoming { background: #FFF4E6; color: #974F00; }
          .sprint-badge.current { background: #FFEBE6; color: #BF2600; }
          .issue-type-badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 500; text-transform: uppercase; margin-right: 8px; }
          .issue-type-badge.bug { background: #FFEBE6; color: #BF2600; }
          .issue-type-badge.story { background: #E3FCEF; color: #006644; }
          .issue-type-badge.task { background: #DEEBFF; color: #0052CC; }
          .issue-type-badge.epic { background: #EAE6FF; color: #403294; }
          .issue-type-badge.subtask { background: #F4F5F7; color: #42526E; }
          .issue-type-badge.spike { background: #FFF4E6; color: #974F00; }
          .issue-type-badge.idea { background: #FFF4E6; color: #974F00; }
          .nav-links { text-align: center; margin-bottom: 20px; font-size: 14px; color: #6B778C; }
          .nav-links a { color: #0052CC; text-decoration: none; margin: 0 8px; }
          .nav-links a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="nav-links">
            <a href="/">Home</a> | <a href="/slow">Slow Motion</a> | <a href="/done">Completed</a> | <a href="/backlog">Backlog</a> | <a href="/progress">Progress</a>
          </div>
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
              <div>Key</div>
              <div>Summary</div>
              <div>Status</div>
              <div>Created</div>
              <div>Reporter</div>
              <div>Age</div>
            </div>
            <div class="issues-container">
            ${processedIssues.map(issue => `
              <div class="issue">
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
        </div>
      </body>
      </html>
    `;

    res.send(html);

  } catch (error) {
    console.error('Error in /backlog route:', error);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).send(`Error: ${error.message}${error.response ? ` (Status: ${error.response.status})` : ''}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
