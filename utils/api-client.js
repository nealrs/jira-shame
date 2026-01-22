const axios = require('axios');
const config = require('../config');

/**
 * Create an axios instance with retry logic and timeout
 */
function createApiClient(baseConfig, retryConfig = {}) {
  const {
    maxRetries = config.api.retries,
    retryDelay = config.api.retryDelay,
    timeout = config.api.timeout,
  } = retryConfig;

  const client = axios.create({
    ...baseConfig,
    timeout: timeout,
  });

  // Add retry interceptor
  client.interceptors.response.use(
    (response) => response,
    async (error) => {
      const config = error.config;
      
      // Don't retry if already retried max times
      if (!config || config.__retryCount >= maxRetries) {
        return Promise.reject(error);
      }

      // Only retry on network errors or 5xx errors
      const shouldRetry = 
        !error.response || // Network error
        (error.response.status >= 500 && error.response.status < 600); // Server error

      if (!shouldRetry) {
        return Promise.reject(error);
      }

      // Increment retry count
      config.__retryCount = config.__retryCount || 0;
      config.__retryCount += 1;

      // Calculate exponential backoff delay
      const delay = retryDelay * Math.pow(2, config.__retryCount - 1);

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));

      // Retry the request
      return client(config);
    }
  );

  return client;
}

/**
 * Handle rate limiting (429 errors)
 */
function handleRateLimit(error, retryAfter = null) {
  if (error.response && error.response.status === 429) {
    const retryAfterHeader = error.response.headers['retry-after'] || 
                            error.response.headers['x-ratelimit-reset'];
    
    if (retryAfterHeader) {
      const retryAfterSeconds = parseInt(retryAfterHeader, 10);
      const retryAfterDate = new Date(retryAfterSeconds * 1000);
      return {
        isRateLimited: true,
        retryAfter: retryAfterDate,
        retryAfterSeconds: retryAfterSeconds,
        message: `Rate limit exceeded. Retry after ${retryAfterDate.toLocaleTimeString()}`,
      };
    }
    
    return {
      isRateLimited: true,
      retryAfter: null,
      message: 'Rate limit exceeded. Please try again later.',
    };
  }
  
  return { isRateLimited: false };
}

module.exports = {
  createApiClient,
  handleRateLimit,
};
