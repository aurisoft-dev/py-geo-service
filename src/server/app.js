const fs = require('fs');
const path = require('path');
const express = require('express');
const yaml = require('js-yaml');
const swaggerUi = require('swagger-ui-express');
const { buildGeoRouter } = require('../routes/geo');

function loadOpenApiDoc() {
  const specPath = path.join(__dirname, '..', '..', 'openapi.yaml');
  return yaml.load(fs.readFileSync(specPath, 'utf8'));
}

function createApp(cache) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', cache: cache.data.counts, loadedAt: cache.data.loadedAt });
  });

  // Documentacion interactiva: http://localhost:<puerto>/docs
  const openApiDoc = loadOpenApiDoc();
  app.get('/openapi.json', (req, res) => res.json(openApiDoc));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

  app.use('/', buildGeoRouter(cache));

  app.use((req, res) => {
    res.status(404).json({ error: 'no encontrado' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[server] error:', err);
    res.status(500).json({ error: 'error interno' });
  });

  return app;
}

module.exports = { createApp };
