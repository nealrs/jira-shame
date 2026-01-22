/**
 * HTMX Error Handling Utilities
 */

/**
 * Handle HTMX response errors
 */
function handleHtmxError(error, req, res, template, templateData = {}) {
  const errorData = {
    error: true,
    errorMessage: error.message || 'An error occurred',
    errorStatus: error.response?.status,
    ...templateData,
  };

  if (req.headers['hx-request'] === 'true') {
    // Return error as HTMX response
    return res.render(template, errorData, (err, html) => {
      if (err) {
        return res.status(500).send(`
          <div class="error-message" style="padding: 20px; background: #FFEBE6; border-radius: 8px; margin: 20px;">
            <h2>Error</h2>
            <p>Failed to render error page: ${err.message}</p>
          </div>
        `);
      }
      res.status(error.response?.status || 500).send(html);
    });
  } else {
    // Return full page error
    return res.render('base', {
      title: 'Error',
      template: template,
      templateData: errorData,
    });
  }
}

/**
 * Create error boundary handler for HTMX
 */
function createErrorBoundary() {
  return (err, req, res, next) => {
    // Log the error
    const logger = require('./logger');
    logger.error('HTMX Error Boundary', err, {
      url: req.url,
      method: req.method,
      isHtmx: req.headers['hx-request'] === 'true',
    });

    // Handle HTMX requests differently
    if (req.headers['hx-request'] === 'true') {
      return res.status(err.status || 500).send(`
        <div class="error-message" style="padding: 20px; background: #FFEBE6; border-radius: 8px; margin: 20px;">
          <h2>⚠️ Error</h2>
          <p>${err.message || 'An unexpected error occurred'}</p>
          <button onclick="window.location.reload()" style="margin-top: 10px; padding: 8px 16px; background: #0052CC; color: white; border: none; border-radius: 4px; cursor: pointer;">
            Reload Page
          </button>
        </div>
      `);
    }

    // For non-HTMX requests, use default error handler
    next(err);
  };
}

module.exports = {
  handleHtmxError,
  createErrorBoundary,
};
