const express = require('express');
const router = express.Router();
const { isHtmxRequest, logger } = require('./_helpers');

router.get('/', (req, res) => {
  if (isHtmxRequest(req)) {
    return res.render('home', {}, (err, html) => {
      if (err) {
        logger.error('Error rendering home template', err);
        return res.status(500).send('Error rendering page');
      }
      const response = `<title hx-swap-oob="true">Jira Shame - Dashboard</title>
${html}`;
      res.send(response);
    });
  } else {
    return res.render('base', {
      title: 'Jira Shame - Dashboard',
      template: 'home',
      templateData: {},
      stylesheet: '/css/routes/home.css'
    });
  }
});

module.exports = router;
