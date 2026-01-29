require('dotenv').config();

/**
 * Centralized configuration management with validation
 */

// Required environment variables
const requiredVars = {
  JIRA_HOST: process.env.JIRA_HOST,
  JIRA_EMAIL: process.env.JIRA_EMAIL,
  JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
};

// Optional environment variables with defaults
const optionalVars = {
  JIRA_BOARD_ID: process.env.JIRA_BOARD_ID || 7,
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEBUG: process.env.DEBUG ? process.env.DEBUG === 'true' : process.env.NODE_ENV !== 'production',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GITHUB_ORG: process.env.GITHUB_ORG,
  TZ: process.env.TZ || 'America/New_York',
};

// Validate required variables
const missingVars = [];
for (const [key, value] of Object.entries(requiredVars)) {
  if (!value) {
    missingVars.push(key);
  }
}

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(v => console.error(`   - ${v}`));
  console.error('\nPlease set these in your .env file. See README.md for setup instructions.');
  process.exit(1);
}

// Configuration object
const config = {
  jira: {
    host: requiredVars.JIRA_HOST,
    email: requiredVars.JIRA_EMAIL,
    apiToken: requiredVars.JIRA_API_TOKEN,
    boardId: parseInt(optionalVars.JIRA_BOARD_ID, 10),
    // Target statuses for tracking
    targetStatuses: ['To Do', 'Ready for Development', 'In Progress', 'In Review'],
  },
  github: {
    token: optionalVars.GITHUB_TOKEN,
    org: optionalVars.GITHUB_ORG,
  },
  server: {
    port: parseInt(optionalVars.PORT, 10),
    nodeEnv: optionalVars.NODE_ENV,
    debug: optionalVars.DEBUG,
  },
  timezone: optionalVars.TZ,
  // API request configuration
  api: {
    timeout: 60000, // 60 seconds
    retries: 3,
    retryDelay: 1000, // Initial delay in ms
  },
  // Digest / coaching (optional)
  digest: {
    highPriorityNames: ['Highest', 'High'],
    coachingBacklogAgeWeeksThreshold: 12,
    coachingSweatGapPercent: 40,
    coachingLoadImbalanceRatio: 2,
    coachingPROpenDaysThreshold: 5,
  },
};

// Validate GitHub config if PR route might be used
if (!config.github.token || !config.github.org) {
  if (config.server.debug) {
    console.warn('⚠️  GitHub configuration missing - /pr route will not work');
  }
}

// Validate board ID
if (isNaN(config.jira.boardId) || config.jira.boardId <= 0) {
  console.error('❌ Invalid JIRA_BOARD_ID. Must be a positive number.');
  process.exit(1);
}

// Validate port
if (isNaN(config.server.port) || config.server.port <= 0 || config.server.port > 65535) {
  console.error('❌ Invalid PORT. Must be between 1 and 65535.');
  process.exit(1);
}

module.exports = config;
