const express = require('express');
const config = require('../config');
const fs = require('fs');
const path = require('path');

const app = express();
const geoData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'geo.json'), 'utf8'));

// Helper for filtering
const getById = (list, id) => list.find(item => String(item.id) === String(id));
const getByParentId = (list, parentKey, parentId) => list.filter(item => String(item[parentKey]) === String(parentId));

// Endpoints
app.get('/departamentos', (req, res) => res.json(geoData.deps));

app.get('/departamentos/:id/distritos', (req, res) => res.json(getByParentId(geoData.dists, 'departamento_id', req.params.id)));
app.get('/distritos', (req, res) => req.query.departamento_id ? res.json(getByParentId(geoData.dists, 'departamento_id', req.query.departamento_id)) : res.status(400).json({ error: 'Falta departamento_id' }));

app.get('/distritos/:id/ciudades', (req, res) => res.json(getByParentId(geoData.ciud, 'distrito_id', req.params.id)));
app.get('/ciudades', (req, res) => req.query.distrito_id ? res.json(getByParentId(geoData.ciud, 'distrito_id', req.query.distrito_id)) : res.status(400).json({ error: 'Falta distrito_id' }));

app.get('/ciudades/:id/barrios', (req, res) => res.json(getByParentId(geoData.barrios, 'ciudad_id', req.params.id)));
app.get('/barrios', (req, res) => req.query.ciudad_id ? res.json(getByParentId(geoData.barrios, 'ciudad_id', req.query.ciudad_id)) : res.status(400).json({ error: 'Falta ciudad_id' }));

app.get('/health', (req, res) => res.json({ status: 'ok', deps: geoData.deps.length }));

app.listen(config.port, () => {
  console.log(`py-geo-service JSON MOCK API escuchando en http://localhost:${config.port}`);
});
