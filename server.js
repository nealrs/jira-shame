const express = require('express');
const moment = require('moment');
const path = require('path');
const config = require('./config');
const logger = require('./utils/logger');

const app = express();
const PORT = config.server.port;

// Configure EJS as template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'templates'));
app.engine('html', require('ejs').renderFile); // Allow .html files to be rendered as EJS

// Disable view cache in development
if (process.env.NODE_ENV !== 'production') {
  app.set('view cache', false);
}

// Serve static files
app.use('/img', express.static('img'));
app.use('/css', express.static('public/css'));
app.use('/js', express.static('public/js'));

// Import routes
const homeRoutes = require('./routes/home');
const slowRoutes = require('./routes/slow');
const doneRoutes = require('./routes/done');
const progressRoutes = require('./routes/progress');
const backlogRoutes = require('./routes/backlog');
const prRoutes = require('./routes/pr');
const loadRoutes = require('./routes/load');

// Mount routes
app.use('/', homeRoutes);
app.use('/', slowRoutes);
app.use('/', doneRoutes);
app.use('/', progressRoutes);
app.use('/', backlogRoutes);
app.use('/', prRoutes);
app.use('/', loadRoutes);

// Start server
// Bind to 0.0.0.0 to allow connections from outside the container (Docker)
app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Server running on http://0.0.0.0:${PORT}`);
  if (config.server.debug) {
    logger.info('Debug logging enabled');
  }
});

