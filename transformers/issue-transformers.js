const moment = require('moment');
const { formatDuration, formatCompletionDuration, formatAge } = require('./duration-formatters');
const { formatShortDate, formatISODate, formatISODateTime } = require('./date-formatters');

/**
 * Extract status transitions from changelog
 */
function extractStatusTransitions(changelog) {
  const transitions = [];
  const history = changelog?.histories || [];
  
  if (history && Array.isArray(history)) {
    history.forEach(record => {
      if (record.items && Array.isArray(record.items)) {
        record.items.forEach(item => {
          if (item.field === 'status') {
            transitions.push({
              date: moment(record.created),
              fromStatus: item.fromString,
              toStatus: item.toString
            });
          }
        });
      }
    });
  }
  
  // Sort by date (oldest first)
  transitions.sort((a, b) => a.date.valueOf() - b.date.valueOf());
  
  return transitions;
}

/**
 * Calculate days in current status from changelog
 */
function calculateDaysInStatus(issue, currentStatus) {
  const transitions = extractStatusTransitions(issue.changelog);
  const now = moment();
  let totalDays = 0;
  let enteredAt = null;
  
  // Check if created in current status
  if (transitions.length === 0) {
    enteredAt = moment(issue.fields.created);
  } else {
    const firstTransition = transitions[0];
    if (firstTransition.fromStatus === currentStatus) {
      enteredAt = moment(issue.fields.created);
    }
  }
  
  // Walk through transitions
  for (const transition of transitions) {
    const { fromStatus, toStatus, date } = transition;
    
    if (toStatus === currentStatus && fromStatus !== currentStatus) {
      enteredAt = date;
    } else if (fromStatus === currentStatus && toStatus !== currentStatus) {
      if (enteredAt !== null) {
        totalDays += date.diff(enteredAt, 'days');
        enteredAt = null;
      }
    }
  }
  
  // If still in current status, add time from last entry to now
  if (enteredAt !== null) {
    totalDays += now.diff(enteredAt, 'days');
  }
  
  return totalDays;
}

/**
 * Transform issue for done/completed route
 */
function transformCompletedIssue(issue, doneDate, resolutionStatus) {
  const createdDate = moment(issue.fields.created);
  const daysToComplete = doneDate.diff(createdDate, 'days');
  const durationText = formatCompletionDuration(createdDate, doneDate);
  
  return {
    key: issue.key,
    summary: issue.fields.summary,
    assignee: issue.fields.assignee ? issue.fields.assignee.displayName : 'Unassigned',
    reporter: issue.fields.reporter ? issue.fields.reporter.displayName : 'Unknown',
    created: formatISODate(createdDate),
    completed: formatISODateTime(doneDate),
    completedDate: formatISODate(doneDate),
    completedDateFormatted: formatShortDate(doneDate),
    resolutionStatus: resolutionStatus || 'Done',
    daysToComplete: daysToComplete,
    durationText: durationText,
    link: `https://${process.env.JIRA_HOST || ''}/browse/${issue.key}`,
    latestSprintName: issue.latestSprintName || 'Backlog',
    latestSprintEndDate: issue.latestSprintEndDate,
    issueType: (issue.fields.issuetype?.name || 'Task').toLowerCase()
  };
}

/**
 * Transform issue for backlog route
 */
function transformBacklogIssue(issue) {
  const createdDate = moment(issue.fields.created);
  const now = moment();
  const daysOld = now.diff(createdDate, 'days', true);
  const ageText = formatAge(daysOld);
  
  const keyMatch = issue.key.match(/-(\d+)$/);
  const keyNumber = keyMatch ? parseInt(keyMatch[1], 10) : 0;
  
  return {
    key: issue.key,
    keyNumber: keyNumber,
    summary: issue.fields.summary,
    status: issue.fields.status.name,
    created: formatISODate(createdDate),
    createdTimestamp: createdDate.valueOf(),
    createdFormatted: formatShortDate(createdDate),
    ageDays: daysOld,
    ageText: ageText,
    link: `https://${process.env.JIRA_HOST || ''}/browse/${issue.key}`,
    issueType: (issue.fields.issuetype?.name || 'Task').toLowerCase(),
    reporter: issue.fields.reporter ? issue.fields.reporter.displayName : 'Unknown'
  };
}

/**
 * Extract PR information from issue remote links and dev info
 */
function extractPRInfo(issue) {
  const prs = [];
  const remotelinks = issue.remotelinks || [];
  const devInfo = issue.devInfo || [];
  
  // First try dev info (more detailed)
  devInfo.forEach(detail => {
    if (detail.pullRequests && Array.isArray(detail.pullRequests)) {
      detail.pullRequests.forEach(pr => {
        if (pr.url && pr.url.includes('/pull/')) {
          const prMatch = pr.url.match(/\/pull\/(\d+)/);
          const prNumber = prMatch ? prMatch[1] : null;
          
          if (prNumber) {
            const reviewers = pr.reviewers || [];
            const reviewerCount = reviewers.length;
            const approvedReviews = reviewers.filter(r => r.status === 'APPROVED') || [];
            const completedReviews = reviewers.filter(r => r.status && r.status !== 'PENDING' && r.status !== 'REQUESTED');
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
  
  // Fallback to remote links
  if (prs.length === 0) {
    remotelinks.forEach(link => {
      const relationship = (link.relationship || '').toLowerCase();
      const url = link.object?.url || '';
      
      if ((relationship.includes('pull') || relationship.includes('pr')) && 
          (url.includes('/pull/') || url.includes('/pulls/'))) {
        const prMatch = url.match(/\/pull\/(\d+)/);
        const prNumber = prMatch ? prMatch[1] : null;
        
        if (prNumber) {
          prs.push({
            url: url,
            number: prNumber,
            title: link.object?.title || `PR #${prNumber}`,
            status: link.status?.resolved ? 'merged' : 'open',
            needsReview: false,
            approvedCount: 0,
            reviewerCount: 0,
            completedReviewCount: 0
          });
        }
      }
    });
  }
  
  return prs;
}

module.exports = {
  extractStatusTransitions,
  calculateDaysInStatus,
  transformCompletedIssue,
  transformBacklogIssue,
  extractPRInfo
};
