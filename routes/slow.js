const express = require('express');
const moment = require('moment-timezone');
const router = express.Router();
const { isHtmxRequest, debugLog, debugError, TARGET_STATUSES, BOARD_ID, jiraClient, config, getTz } = require('./_helpers');

router.get('/slow', async (req, res) => {
  try {
    const tz = getTz();
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
      const emptyData = {
        TARGET_STATUSES: TARGET_STATUSES,
        grouped: {},
        allAssignees: []
      };
      
      if (isHtmxRequest(req)) {
        return res.render('slow', emptyData, (err, html) => {
          if (err) {
            debugError('Error rendering slow template:', err);
            return res.status(500).send('Error rendering page');
          }
          const response = `<script src="/js/slow.js" data-route-script></script>
${html}`;
          res.send(response);
        });
      } else {
        return res.render('base', {
          title: 'Stuck Tickets',
          template: 'slow',
          templateData: emptyData,
          stylesheet: '/css/routes/slow.css',
          script: '/js/slow.js'
        });
      }
    }

    // 4. Resolve Sprint field id (changelog uses fieldId, often customfield_10020)
    let sprintFieldId = null;
    try {
      const fieldsResponse = await jiraClient.get('/rest/api/3/field');
      const fields = Array.isArray(fieldsResponse.data) ? fieldsResponse.data : (fieldsResponse.data?.values || []);
      const sprintField = fields.find(f => (f.name || '').toLowerCase() === 'sprint');
      if (sprintField && sprintField.id) sprintFieldId = sprintField.id;
    } catch (e) {
      debugLog('Could not resolve Sprint field id, changelog sprint detection may miss customfield id');
    }

    // 5. Bulk fetch details (include sprint for current-sprint count)
    const issueKeys = issues.map(i => i.key);
    const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
      jql: `key in (${issueKeys.join(',')})`,
      maxResults: 100,
      fields: ['summary', 'status', 'assignee', 'created', 'issuetype', 'sprint']
    });

    // 6. Fetch full changelog (paginate), remote links, and dev info per issue
    const issuesWithChangelog = await Promise.all(
      searchResponse.data.issues.map(async (issue) => {
        try {
          const changelogValues = [];
          let startAt = 0;
          const pageSize = 100;
          let total = 0;
          let page = [];
          do {
            const changelogResponse = await jiraClient.get(`/rest/api/3/issue/${issue.key}/changelog`, {
              params: { startAt, maxResults: pageSize }
            }).catch(() => ({ data: { values: [], total: 0 } }));
            page = changelogResponse.data.values || [];
            total = changelogResponse.data.total != null ? changelogResponse.data.total : (changelogValues.length + page.length);
            changelogValues.push(...page);
            startAt += page.length;
          } while (startAt < total && page.length > 0);

          const [remotelinksResponse, devInfoResponse] = await Promise.all([
            jiraClient.get(`/rest/api/3/issue/${issue.key}/remotelink`).catch(() => ({ data: [] })),
            jiraClient.get(`/rest/dev-status/latest/issue/detail`, {
              params: { issueId: issue.id || issue.key, applicationType: 'GitHub', dataType: 'pullrequest' }
            }).catch(() => ({ data: { detail: [] } }))
          ]);

          return {
            ...issue,
            changelog: { histories: changelogValues },
            remotelinks: remotelinksResponse.data || [],
            devInfo: devInfoResponse.data?.detail || []
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

    // 7. Process Issues
    const processedIssues = searchResponse.data.issues.map(issue => {
      const currentStatus = issue.fields.status.name;
      const history = issue.changelog?.histories || [];
      const statusTransitions = [];

      // Distinct sprint count: current sprint + every sprint ever in changelog
      const sprintIdsSeen = new Set();
      const isSprintItem = (item) => {
        if (!item || !item.field) return false;
        const f = String(item.field).toLowerCase();
        const fid = (item.fieldId && String(item.fieldId)) || '';
        return f === 'sprint' || (sprintFieldId && fid === sprintFieldId);
      };
      const addSprintValue = (v) => {
        if (v == null) return;
        const s = String(v).trim();
        if (s !== '') sprintIdsSeen.add(s);
      };

      // Include current sprint(s) from issue fields
      const sprintField = issue.fields?.sprint;
      if (sprintField) {
        if (Array.isArray(sprintField)) {
          sprintField.forEach(s => {
            if (s && (s.id != null || s.name != null)) {
              addSprintValue(s.id != null ? String(s.id) : s.name);
            }
          });
        } else if (typeof sprintField === 'object' && sprintField !== null) {
          addSprintValue(sprintField.id != null ? String(sprintField.id) : sprintField.name);
        } else {
          addSprintValue(sprintField);
        }
      }

      // From changelog: every sprint ever added/removed (prefer id over name to avoid double-count)
      if (Array.isArray(history)) {
        history.forEach(record => {
          if (!record.items || !Array.isArray(record.items)) return;
          record.items.forEach(item => {
            if (item.field === 'status') {
              statusTransitions.push({
                date: moment(record.created),
                fromStatus: item.fromString,
                toStatus: item.toString
              });
            }
            if (!isSprintItem(item)) return;
            const to = item.to; const from = item.from;
            const toString = item.toString; const fromString = item.fromString;
            const looksLikeId = (v) => v != null && /^\d+$/.test(String(v).trim());
            if (looksLikeId(to)) addSprintValue(String(to).trim());
            if (looksLikeId(from)) addSprintValue(String(from).trim());
            if (!looksLikeId(to) && toString) addSprintValue(toString);
            if (!looksLikeId(from) && fromString) addSprintValue(fromString);
          });
        });
      }

      const sprintCount = sprintIdsSeen.size;

      
      // Sort transitions by date (oldest first)
      statusTransitions.sort((a, b) => a.date.valueOf() - b.date.valueOf());
      
      // Calculate total days in current status
      let totalDaysInCurrentStatus = 0;
      const now = moment().tz(tz);
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
        sprintCount,
        link: `https://${config.jira.host}/browse/${issue.key}`,
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
          const start = moment.tz(currentSprint.startDate, tz);
          const end = moment.tz(currentSprint.endDate, tz);
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

    // 7. Render using EJS template
    const templateData = {
      TARGET_STATUSES: TARGET_STATUSES,
      grouped: grouped,
      allAssignees: allAssignees
    };
    
    if (isHtmxRequest(req)) {
      // Return partial HTML for htmx
      return res.render('slow', templateData, (err, html) => {
        if (err) {
          debugError('Error rendering slow template:', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<title hx-swap-oob="true">Stuck Tickets</title>
<script src="/js/slow.js" data-route-script></script>
${html}`;
        res.send(response);
      });
    } else {
      // Return full page
      return res.render('base', {
        title: 'Stuck Tickets',
        template: 'slow',
        templateData: templateData,
        script: '/js/slow.js',
        routeClass: 'slow-page'
      });
    }

  } catch (error) {
    debugError(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

module.exports = router;
