require('dotenv').config();
const express = require('express');
const axios = require('axios');
const moment = require('moment');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.get('/', async (req, res) => {
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
      fields: ['summary', 'status', 'assignee', 'created']
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
      
      // LOGIC CHANGE: Find the EARLIEST time it entered the current status
      // and assume it has been "stuck" there effectively since then.
      
      // 1. Default to creation date (in case it was created directly in this status)
      let firstEnteredTime = moment(issue.fields.created);

      // 2. Scan history to find transitions TO the current status
      // We look at ALL history items.
      const transitionsToCurrent = [];

      if (history && Array.isArray(history)) {
        history.forEach(record => {
          if (record.items && Array.isArray(record.items)) {
            record.items.forEach(item => {
              if (item.field === 'status' && item.toString === currentStatus) {
                transitionsToCurrent.push(moment(record.created));
              }
            });
          }
        });
      }

      // 3. If we found transitions, pick the earliest one (Minimum Date)
      if (transitionsToCurrent.length > 0) {
        // Sort ascending to get the oldest date first
        transitionsToCurrent.sort((a, b) => a - b);
        firstEnteredTime = transitionsToCurrent[0];
      }

      const daysStuck = moment().diff(firstEnteredTime, 'days');

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

      return {
        key: issue.key,
        summary: issue.fields.summary,
        status: currentStatus,
        assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
        days: daysStuck,
        link: `https://${JIRA_HOST}/browse/${issue.key}`,
        prs: prs
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

    // 7. Render HTML
    let html = `
      <html>
      <head>
        <title>Stuck Tickets</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 40px; background: #f4f5f7; color: #172B4D;}
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
          
          @media (max-width: 1400px) {
            .status-columns { grid-template-columns: repeat(2, 1fr); }
          }
          @media (max-width: 800px) {
            .status-columns { grid-template-columns: 1fr; }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>SLOW MOTION</h1>
          <p style="text-align: center; color: #6B778C; margin-bottom: 30px; font-size: 14px;">
            Tickets which have been in the same status for over 7 days
          </p>
          
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
                        <div class="ticket">
                          <div class="days-badge ${i.badgeClass || ''}">
                            <span class="days-count">${i.days}</span>
                            <span class="days-label">days</span>
                          </div>
                          <div class="details">
                            <div>
                              <a href="${i.link}" class="key" target="_blank">${i.key}</a>
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

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
