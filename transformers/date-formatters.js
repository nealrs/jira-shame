const moment = require('moment');

/**
 * Format a date as MM/DD/YY
 */
function formatShortDate(date) {
  return moment(date).format('MM/DD/YY');
}

/**
 * Format a date as MMM D, YYYY
 */
function formatLongDate(date) {
  return moment(date).format('MMM D, YYYY');
}

/**
 * Format a date as MMM D, h:mm A
 */
function formatDateTime(date) {
  return moment(date).format('MMM D, h:mm A');
}

/**
 * Format a date as YYYY-MM-DD
 */
function formatISODate(date) {
  return moment(date).format('YYYY-MM-DD');
}

/**
 * Format a date as YYYY-MM-DD HH:mm
 */
function formatISODateTime(date) {
  return moment(date).format('YYYY-MM-DD HH:mm');
}

module.exports = {
  formatShortDate,
  formatLongDate,
  formatDateTime,
  formatISODate,
  formatISODateTime
};
