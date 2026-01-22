/**
 * Format duration in days as human-readable text
 * Examples: "5 days", "2 weeks", "1 week, 3 days", "3 months"
 */
function formatDuration(days) {
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
}

/**
 * Format duration with hours for very short durations
 * Examples: "3 hours", "5 days", "2 weeks"
 */
function formatDurationWithHours(hours) {
  const days = hours / 24;
  if (days < 1) {
    return `${Math.round(hours)} hour${Math.round(hours) !== 1 ? 's' : ''}`;
  }
  return formatDuration(days);
}

/**
 * Format completion duration (days to complete)
 * Handles hours for same-day completions
 */
function formatCompletionDuration(createdDate, completedDate) {
  const moment = require('moment');
  const created = moment(createdDate);
  const completed = moment(completedDate);
  const daysToComplete = completed.diff(created, 'days');
  const hoursToComplete = completed.diff(created, 'hours');
  
  if (daysToComplete === 0) {
    return `${hoursToComplete} hour${hoursToComplete !== 1 ? 's' : ''}`;
  } else if (daysToComplete < 7) {
    return `${daysToComplete} day${daysToComplete !== 1 ? 's' : ''}`;
  } else {
    const weeks = Math.floor(daysToComplete / 7);
    const remainingDays = daysToComplete % 7;
    if (remainingDays === 0) {
      return `${weeks} week${weeks !== 1 ? 's' : ''}`;
    } else {
      return `${weeks} week${weeks !== 1 ? 's' : ''}, ${remainingDays} day${remainingDays !== 1 ? 's' : ''}`;
    }
  }
}

/**
 * Format age in days as human-readable text (for backlog)
 * Same as formatDuration but with specific rounding for backlog display
 */
function formatAge(days) {
  return formatDuration(days);
}

/**
 * Format PR age in compact format
 * Examples: "5d", "2.5w", "3mo", "1.2y"
 */
function formatPRAge(days) {
  if (days < 7) {
    return `${Math.max(0, Math.round(days))}d`;
  } else if (days < 30) {
    return `${(days / 7).toFixed(1)}w`;
  } else if (days < 365) {
    return `${(days / 30).toFixed(1)}mo`;
  } else {
    return `${(days / 365).toFixed(1)}y`;
  }
}

module.exports = {
  formatDuration,
  formatDurationWithHours,
  formatCompletionDuration,
  formatAge,
  formatPRAge
};
