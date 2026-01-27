const express = require('express');
const moment = require('moment-timezone');
const router = express.Router();
const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config, getTz } = require('./_helpers');

router.get('/done', async (req, res) => {
  try {
    const period = req.query.period || 'this-sprint';
    
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
    
    switch (period) {
      case 'this-sprint':
        useSprintFilter = true;
        periodLabel = 'This Sprint';
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
        startDate = moment.tz(tz).startOf('month');
        endDate = moment.tz(tz).endOf('month');
        periodLabel = 'This Month';
    }
    
    // Build JQL query for completed tickets
    const startDateStr = startDate.clone().subtract(1, 'day').format('YYYY-MM-DD');
    const endDateStr = endDate.clone().add(1, 'day').format('YYYY-MM-DD');
    let jqlQuery = `status in (Done, "Won't Do") AND resolutiondate >= "${startDateStr}" AND resolutiondate <= "${endDateStr}" AND sprint IS NOT EMPTY`;
    
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
      const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
        jql: jqlQuery,
        maxResults: 200,
        fields: ['key']
      });
      issueKeys = (searchResponse.data.issues || []).map(i => i.key);
    }
    
    debugLog(`Found ${issueKeys.length} completed issues for ${periodLabel}`);
    
    if (issueKeys.length === 0) {
      const emptyData = {
        period: period,
        periodLabel: periodLabel,
        processedIssues: [],
        allAssignees: []
      };
      
      if (isHtmxRequest(req)) {
        return res.render('done', emptyData, (err, html) => {
          if (err) {
            debugError('Error rendering done template:', err);
            return res.status(500).send('Error rendering page');
          }
          const response = `<title hx-swap-oob="true">Completed Tickets - ${periodLabel}</title>
<script src="/js/done.js" data-route-script></script>
${html}`;
          res.send(response);
        });
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
    
    // Bulk fetch details
    const searchResponse = await jiraClient.post(`/rest/api/3/search/jql`, {
      jql: `key in (${issueKeys.join(',')})`,
      maxResults: 200,
      fields: ['summary', 'status', 'assignee', 'reporter', 'created', 'resolutiondate', 'issuetype', 'sprint', 'resolution']
    });
    
    const issues = searchResponse.data.issues || [];
    debugLog(`Found ${issues.length} completed issues for ${periodLabel}`);
    
    if (issues.length === 0) {
      const emptyData = {
        period: period,
        periodLabel: periodLabel,
        processedIssues: [],
        allAssignees: []
      };
      
      if (isHtmxRequest(req)) {
        return res.render('done', emptyData, (err, html) => {
          if (err) {
            debugError('Error rendering done template:', err);
            return res.status(500).send('Error rendering page');
          }
          const response = `<title hx-swap-oob="true">Completed Tickets - ${periodLabel}</title>
<script src="/js/done.js" data-route-script></script>
${html}`;
          res.send(response);
        });
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
    
    // Fetch changelog for each issue
    const issuesWithChangelog = await Promise.all(
      issues.map(async (issue) => {
        try {
          const changelogResponse = await jiraClient.get(`/rest/api/3/issue/${issue.key}/changelog`).catch(() => ({ data: { values: [] } }));
          const histories = changelogResponse.data.values || [];
          
          let doneDate = null;
          let resolutionStatus = null;
          
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
            for (const history of histories) {
              if (history.items && Array.isArray(history.items)) {
                for (const item of history.items) {
                  if (item.field === 'status') {
                    const toStatus = item.toString;
                    const toStatusLower = toStatus ? toStatus.toLowerCase() : '';
                    if (toStatusLower === 'done' || toStatusLower === "won't do" || toStatusLower === "wont do") {
                      doneDate = moment(history.created);
                      if (!resolutionStatus) {
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
          if (!resolutionStatus) {
            resolutionStatus = 'Done';
          }
          
          // Find latest sprint
          let latestSprintId = null;
          let latestSprintName = null;
          let latestSprintEndDate = null;
          
          if (issue.fields.sprint) {
            let sprintIds = [];
            
            if (Array.isArray(issue.fields.sprint)) {
              sprintIds = issue.fields.sprint.map(sprint => {
                if (typeof sprint === 'object' && sprint !== null) {
                  return sprint.id || sprint;
                }
                return sprint;
              }).filter(id => id != null);
            } else if (typeof issue.fields.sprint === 'object' && issue.fields.sprint !== null) {
              sprintIds = [issue.fields.sprint.id || issue.fields.sprint].filter(id => id != null);
            }
            
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
    
    // Process issues
    const processedIssues = issuesWithChangelog
      .map(issue => {
        const createdDate = moment(issue.fields.created);
        const doneDate = issue.doneDate;
        const daysToComplete = doneDate.diff(createdDate, 'days');
        const hoursToComplete = doneDate.diff(createdDate, 'hours');
        
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
        
        const completedDateFormatted = doneDate.format('MM/DD/YY');
        const issueType = issue.fields.issuetype?.name || 'Task';
        const issueTypeLower = issueType.toLowerCase();
        
        return {
          key: issue.key,
          summary: issue.fields.summary,
          assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
          reporter: issue.fields.reporter ? issue.fields.reporter.displayName : 'Unknown',
          created: createdDate.format('YYYY-MM-DD'),
          completed: doneDate.format('YYYY-MM-DD HH:mm'),
          completedDate: doneDate.format('YYYY-MM-DD'),
          completedDateFormatted: completedDateFormatted,
          resolutionStatus: issue.resolutionStatus || 'Done',
          daysToComplete: daysToComplete,
          durationText: durationText,
          link: `https://${config.jira.host}/browse/${issue.key}`,
          latestSprintName: issue.latestSprintName || 'Backlog',
          latestSprintEndDate: issue.latestSprintEndDate,
          issueType: issueTypeLower
        };
      })
      .filter(issue => {
        const issueCompletedDate = moment(issue.completedDate);
        return issueCompletedDate.isSameOrAfter(startDate, 'day') && issueCompletedDate.isSameOrBefore(endDate, 'day');
      });
    
    // Sort by ticket ID
    processedIssues.sort((a, b) => {
      const extractTicketNumber = (key) => {
        const match = key.match(/-(\d+)$/);
        return match ? parseInt(match[1], 10) : 0;
      };
      
      const aNum = extractTicketNumber(a.key);
      const bNum = extractTicketNumber(b.key);
      return bNum - aNum;
    });
    
    const allAssignees = [...new Set(processedIssues.map(issue => issue.assignee))].sort();
    
    const templateData = {
      period: period,
      periodLabel: periodLabel,
      processedIssues: processedIssues,
      allAssignees: allAssignees
    };
    
    if (isHtmxRequest(req)) {
      return res.render('done', templateData, (err, html) => {
        if (err) {
          debugError('Error rendering done template:', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<title hx-swap-oob="true">Completed Tickets - ${periodLabel}</title>
<script src="/js/done.js" data-route-script></script>
${html}`;
        res.send(response);
      });
    } else {
      return res.render('base', {
        title: `Completed Tickets - ${periodLabel}`,
        template: 'done',
        templateData: templateData,
        stylesheet: '/css/routes/done.css',
        script: '/js/done.js'
      });
    }

  } catch (error) {
    debugError(error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

module.exports = router;
