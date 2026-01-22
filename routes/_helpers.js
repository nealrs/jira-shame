const logger = require('../utils/logger');
const config = require('../config');

// Helper to detect htmx requests
function isHtmxRequest(req) {
  return req.headers['hx-request'] === 'true';
}

// Backward compatibility: Keep debug functions that use logger
function debugLog(...args) {
  logger.debug(args.join(' '));
}

function debugWarn(...args) {
  logger.warn(args.join(' '));
}

function debugError(...args) {
  if (args[0] instanceof Error) {
    logger.error(args[0].message, args[0]);
  } else {
    logger.error(args.join(' '));
  }
}

// Backward compatibility: Keep TARGET_STATUSES reference
const TARGET_STATUSES = config.jira.targetStatuses;

// Backward compatibility: Keep BOARD_ID reference
const BOARD_ID = config.jira.boardId;

// Backward compatibility: Keep old client references
const axios = require('axios');
const jiraClient = axios.create({
  baseURL: `https://${config.jira.host}`,
  headers: {
    'Authorization': `Basic ${Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString('base64')}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
  timeout: config.api.timeout,
});

const githubClient = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': config.github.token ? `token ${config.github.token}` : '',
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'jira-shame',
  },
  timeout: config.api.timeout,
});

module.exports = {
  isHtmxRequest,
  debugLog,
  debugWarn,
  debugError,
  TARGET_STATUSES,
  BOARD_ID,
  jiraClient,
  githubClient,
  config,
  logger
};
