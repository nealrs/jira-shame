const express = require('express');
const moment = require('moment-timezone');
const router = express.Router();
const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config, getTz } = require('./_helpers');

router.get('/backlog', async (req, res) => {
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
      if (isHtmxRequest(req)) {
        return res.render('backlog', {
          processedIssues: [],
          stats: null,
          distributionBuckets: []
        }, (err, html) => {
          if (err) {
            debugError('Error rendering backlog template:', err);
            return res.status(500).send('Error rendering page');
          }
          const response = `<title hx-swap-oob="true">Backlog Report</title>
<script src="/js/backlog.js" data-route-script></script>
${html}`;
          res.send(response);
        });
      } else {
        return res.render('base', {
          title: 'Backlog Report',
          template: 'backlog',
          templateData: {
            processedIssues: [],
            stats: null,
            distributionBuckets: []
          },
          stylesheet: '/css/routes/backlog.css',
          script: '/js/backlog.js'
        });
      }
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
    const now = moment().tz(tz);
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
        link: `https://${config.jira.host}/browse/${issue.key}`,
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

    // Format data for template
    const stats = {
      totalIssues,
      minAge: formatAge(minAge),
      maxAge: formatAge(maxAge),
      medianAge: formatAge(medianAge),
      avgAge: formatAge(avgAge)
    };
    
    if (isHtmxRequest(req)) {
      return res.render('backlog', {
        processedIssues,
        stats,
        distributionBuckets: distributionBuckets.map(b => ({
          ...b,
          height: maxCount > 0 ? (b.count / maxCount) * 100 : 0,
          isEmpty: b.count === 0
        }))
      }, (err, html) => {
        if (err) {
          debugError('Error rendering backlog template:', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<title hx-swap-oob="true">Backlog Report</title>
<link rel="stylesheet" href="/css/routes/backlog.css" hx-swap-oob="true" id="route-stylesheet">
<script src="/js/backlog.js" hx-swap-oob="true" id="route-script"></script>
${html}`;
        res.send(response);
      });
    } else {
      return res.render('base', {
        title: 'Backlog Report',
        template: 'backlog',
        templateData: {
          processedIssues,
          stats,
          distributionBuckets: distributionBuckets.map(b => ({
            ...b,
            height: maxCount > 0 ? (b.count / maxCount) * 100 : 0,
            isEmpty: b.count === 0
          }))
        },
        stylesheet: '/css/routes/backlog.css',
        script: '/js/backlog.js'
      });
    }

  } catch (error) {
    debugError('Error in /backlog route:', error);
    if (error.response) {
      debugError('Response status:', error.response.status);
      debugError('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(error.response?.status || 500).send(`Error: ${error.message}${error.response ? ` (Status: ${error.response.status})` : ''}`);
  }
});

module.exports = router;
