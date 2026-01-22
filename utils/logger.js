const config = require('../config');

/**
 * Structured logging utility
 */
class Logger {
  constructor() {
    this.enabled = config.server.debug;
  }

  log(level, message, data = {}) {
    if (!this.enabled && level !== 'error') {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
    };

    if (level === 'error') {
      console.error(JSON.stringify(logEntry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(logEntry));
    } else {
      console.log(JSON.stringify(logEntry));
    }
  }

  debug(message, data = {}) {
    this.log('debug', message, data);
  }

  info(message, data = {}) {
    this.log('info', message, data);
  }

  warn(message, data = {}) {
    this.log('warn', message, data);
  }

  error(message, error = null, data = {}) {
    const errorData = error ? {
      error: {
        message: error.message,
        stack: error.stack,
        ...(error.response && {
          status: error.response.status,
          statusText: error.response.statusText,
        }),
      },
    } : {};
    
    this.log('error', message, { ...errorData, ...data });
  }
}

module.exports = new Logger();
