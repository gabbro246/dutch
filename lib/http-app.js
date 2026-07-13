const express = require('express');
const fs = require('fs');

function createHttpApp({ indexPath, publicDir, appVersion }) {
  const app = express();

  app.get('/', (req, res) => {
    fs.readFile(indexPath, 'utf8', (error, html) => {
      if (error) {
        res.status(500).send('Could not load app.');
        return;
      }
      const versionedHtml = html
        .replace('href="styles.css"', 'href="styles.css?v=' + appVersion + '"')
        .replace('src="shared.js"', 'src="shared.js?v=' + appVersion + '"')
        .replace('src="client-actions.js"', 'src="client-actions.js?v=' + appVersion + '"')
        .replace('src="client.js"', 'src="client.js?v=' + appVersion + '"');
      res.set('Cache-Control', 'no-cache');
      res.type('html').send(versionedHtml);
    });
  });

  app.use(express.static(publicDir));

  return app;
}

module.exports = { createHttpApp };
