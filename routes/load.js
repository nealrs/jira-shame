const express = require('express');
const moment = require('moment');
const router = express.Router();
const { isHtmxRequest, debugLog, debugError, BOARD_ID, jiraClient, config } = require('./_helpers');

router.get('/load', async (req, res) => {
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
      if (isHtmxRequest(req)) {
        return res.render('load', {
          error: true,
          errorMessage: 'Could not determine project key. Please check board configuration.'
        }, (err, html) => {
          if (err) {
            debugError('Error rendering load template:', err);
            return res.status(500).send('Error rendering page');
          }
          const response = `<title hx-swap-oob="true">Load Report</title>
<script src="/js/load.js" data-route-script></script>
${html}`;
          res.send(response);
        });
      } else {
        return res.render('base', {
          title: 'Load Report',
          template: 'load',
          templateData: {
            error: true,
            errorMessage: 'Could not determine project key. Please check board configuration.'
          },
          stylesheet: '/css/routes/load.css',
          script: '/js/load.js'
        });
      }
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
      if (isHtmxRequest(req)) {
        return res.render('load', {
          error: true,
          errorMessage: `Error fetching current sprint issues: ${error.message}`
        }, (err, html) => {
          if (err) {
            debugError('Error rendering load template:', err);
            return res.status(500).send('Error rendering page');
          }
          const response = `<title hx-swap-oob="true">Load Report</title>
<script src="/js/load.js" data-route-script></script>
${html}`;
          res.send(response);
        });
      } else {
        return res.render('base', {
          title: 'Load Report',
          template: 'load',
          templateData: {
            error: true,
            errorMessage: `Error fetching current sprint issues: ${error.message}`
          },
          stylesheet: '/css/routes/load.css',
          script: '/js/load.js'
        });
      }
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

    // Format data for template
    const currentSprintData = currentSprint ? {
      name: currentSprint.name,
      startDate: currentSprint.startDate ? moment(currentSprint.startDate).format('MMM D, YYYY') : null,
      endDate: currentSprint.endDate ? moment(currentSprint.endDate).format('MMM D, YYYY') : null,
      assignees: Array.from(currentSprintAssignees).sort((a, b) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return a.localeCompare(b);
      }).map(assignee => ({
        name: assignee,
        avatarUrl: assigneeAvatars.get(assignee),
        load: Array.from(boardColumns).map(col => ({
          columnName: col.name,
          count: (currentSprintLoadByAssignee.get(assignee) || new Map()).get(col.name) || 0
        })),
        total: Array.from((currentSprintLoadByAssignee.get(assignee) || new Map()).values()).reduce((sum, val) => sum + val, 0)
      })),
      columnTotals: Array.from(boardColumns).map(col => {
        const total = Array.from(currentSprintLoadByAssignee.values())
          .reduce((sum, load) => sum + ((load.get(col.name) || 0)), 0);
        return { columnName: col.name, total };
      }),
      grandTotal: Array.from(currentSprintLoadByAssignee.values())
        .reduce((sum, load) => sum + Array.from(load.values()).reduce((s, v) => s + v, 0), 0)
    } : null;
    
    const upcomingSprintsData = upcomingSprints.map(sprint => ({
      name: sprint.name,
      startDate: sprint.startDate ? moment(sprint.startDate).format('MMM D, YYYY') : null,
      endDate: sprint.endDate ? moment(sprint.endDate).format('MMM D, YYYY') : null
    }));
    
    const upcomingLoadData = Array.from(currentSprintAssignees).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    }).map(assignee => ({
      name: assignee,
      avatarUrl: assigneeAvatars.get(assignee),
      sprintLoads: upcomingSprints.map(sprint => ({
        sprintName: sprint.name,
        count: (upcomingLoadByAssignee.get(assignee) || new Map()).get(sprint.name) || 0
      })),
      total: Array.from((upcomingLoadByAssignee.get(assignee) || new Map()).values()).reduce((sum, val) => sum + val, 0)
    }));
    
    if (isHtmxRequest(req)) {
      return res.render('load', {
        error: false,
        currentSprint: currentSprintData,
        upcomingSprints: upcomingSprintsData,
        upcomingLoad: upcomingLoadData,
        boardColumns: boardColumns
      }, (err, html) => {
        if (err) {
          debugError('Error rendering load template:', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<title hx-swap-oob="true">Load Report</title>
<link rel="stylesheet" href="/css/routes/load.css" hx-swap-oob="true" id="route-stylesheet">
<script src="/js/load.js" hx-swap-oob="true" id="route-script"></script>
${html}`;
        res.send(response);
      });
    } else {
      return res.render('base', {
        title: 'Load Report',
        template: 'load',
        templateData: {
          error: false,
          currentSprint: currentSprintData,
          upcomingSprints: upcomingSprintsData,
          upcomingLoad: upcomingLoadData,
          boardColumns: boardColumns
        },
        stylesheet: '/css/routes/load.css',
        script: '/js/load.js'
      });
    }
  } catch (error) {
    debugError('Error in /load route:', error);
    if (isHtmxRequest(req)) {
      return res.render('load', {
        error: true,
        errorMessage: error.message,
        errorStatus: error.response?.status
      }, (err, html) => {
        if (err) {
          debugError('Error rendering load template:', err);
          return res.status(500).send('Error rendering page');
        }
        const response = `<title hx-swap-oob="true">Load Report</title>
<link rel="stylesheet" href="/css/routes/load.css" hx-swap-oob="true" id="route-stylesheet">
<script src="/js/load.js" hx-swap-oob="true" id="route-script"></script>
${html}`;
        res.send(response);
      });
    } else {
      return res.render('base', {
        title: 'Load Report',
        template: 'load',
        templateData: {
          error: true,
          errorMessage: error.message,
          errorStatus: error.response?.status
        },
        stylesheet: '/css/routes/load.css',
        script: '/js/load.js'
      });
    }
  }
});

module.exports = router;
