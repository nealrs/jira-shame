const express = require('express');
const moment = require('moment-timezone');
const router = express.Router();
const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config, getTz } = require('./_helpers');

router.get('/progress', async (req, res) => {
  try {
    const period = req.query.period || 'this-sprint'; // today, yesterday, this-week, last-7-days, this-month, last-month, this-sprint
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
    const tz = getTz();
    const now = moment().tz(tz);
      
    if (days && days > 0) {
      startDate = moment.tz(tz).subtract(days - 1, 'days').startOf('day');
      endDate = moment.tz(tz).endOf('day');
      periodLabel = `Last ${days} Days`;
    } else {
      switch (period) {
        case 'this-sprint':
          // For "this sprint", we'll use sprint filter instead of date range
          useSprintFilter = true;
          periodLabel = 'This Sprint';
          // Still set dates to a wide range for the updated filter
          startDate = moment.tz(tz).subtract(1, 'year').startOf('day');
          endDate = moment.tz(tz).endOf('day');
          break;
        case 'today':
          startDate = moment.tz(tz).startOf('day');
          endDate = moment.tz(tz).endOf('day');
          periodLabel = 'Today';
          break;
        case 'yesterday':
          startDate = moment.tz(tz).subtract(1, 'day').startOf('day');
          endDate = moment.tz(tz).subtract(1, 'day').endOf('day');
          periodLabel = 'Yesterday';
          break;
        case 'this-week':
          startDate = moment.tz(tz).startOf('week');
          endDate = moment.tz(tz).endOf('week');
          periodLabel = 'This Week';
          break;
        case 'last-7-days':
          startDate = moment.tz(tz).subtract(6, 'days').startOf('day');
          endDate = moment.tz(tz).endOf('day');
          periodLabel = 'Last 7 Days';
          break;
        case 'this-month':
          startDate = moment.tz(tz).startOf('month');
          endDate = moment.tz(tz).endOf('month');
          periodLabel = 'This Month';
          break;
        case 'last-month':
          startDate = moment.tz(tz).subtract(1, 'month').startOf('month');
          endDate = moment.tz(tz).subtract(1, 'month').endOf('month');
          periodLabel = 'Last Month';
          break;
        default:
          startDate = moment.tz(tz).subtract(6, 'days').startOf('day');
          endDate = moment.tz(tz).endOf('day');
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
      if (isHtmxRequest(req)) {
        return res.render('progress', {
          processedIssues: [],
          period: period,
          periodLabel: periodLabel
        }, (err, html) => {
          if (err) {
            debugError('Error rendering progress template:', err);
            return res.status(500).send('Error rendering page');
          }
          res.send(html);
        });
      } else {
        return res.render('base', {
          title: 'Progress Report',
          template: 'progress',
          templateData: {
            processedIssues: [],
            period: period,
            periodLabel: periodLabel
          },
          stylesheet: '/css/routes/progress.css'
        });
      }
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
          link: `https://${config.jira.host}/browse/${issue.key}`,
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
    
    // Format dates in processedIssues for template
    const formattedIssues = processedIssues.map(issue => {
      const formatted = { ...issue };
      
      // Format status transition dates
      if (formatted.statusTransitions && formatted.statusTransitions.length > 0) {
        formatted.statusTransitions = formatted.statusTransitions.map(t => ({
          ...t,
          dateFormatted: moment(t.date).format('MMM D, h:mm A')
        }));
      }
      
      return formatted;
    });
    
    if (isHtmxRequest(req)) {
      return res.render('progress', {
        processedIssues: formattedIssues,
        period: period,
        periodLabel: periodLabel
      }, (err, html) => {
        if (err) {
          debugError('Error rendering progress template:', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<title hx-swap-oob="true">Progress Report - ${periodLabel}</title>
<link rel="stylesheet" href="/css/routes/progress.css" hx-swap-oob="true" id="route-stylesheet">
${html}`;
        res.send(response);
      });
    } else {
      return res.render('base', {
        title: `Progress Report - ${periodLabel}`,
        template: 'progress',
        templateData: {
          processedIssues: formattedIssues,
          period: period,
          periodLabel: periodLabel
        },
        stylesheet: '/css/routes/progress.css'
      });
    }
  } catch (error) {
    debugError(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

module.exports = router;
