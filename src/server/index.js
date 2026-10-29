const express = require('express');
const config = require('../config');
const fs = require('fs');
const path = require('path');

const app = express();
const { createAdminRouter } = require('../routes/admin');

const geoPath = path.join(__dirname, '..', '..', 'data', 'geo.json');
let geoData = fs.existsSync(geoPath)
  ? JSON.parse(fs.readFileSync(geoPath, 'utf8'))
  : { deps: [], dists: [], ciud: [], barrios: [] };

function reloadGeoData() {
  try {
    if (fs.existsSync(geoPath)) {
      geoData = JSON.parse(fs.readFileSync(geoPath, 'utf8'));
      console.log(`[server] geoData recargado en memoria: ${geoData.deps?.length || 0} deps, ${geoData.dists?.length || 0} dists, ${geoData.ciud?.length || 0} ciud, ${geoData.barrios?.length || 0} barrios`);
    }
  } catch (err) {
    console.error('[server] error al recargar geoData:', err.message);
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Panel web administrativo para carga de Excel
const publicDir = path.join(__dirname, '..', '..', 'public');
app.use('/admin', express.static(publicDir));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/favicon.ico', (req, res) => res.status(204).end());

// API administrativa (upload Excel, status, historial)
app.use('/api/admin', createAdminRouter({ onReload: reloadGeoData }));

// Helper for filtering
const getById = (list, id) => list.find(item => String(item.id) === String(id));
const getByParentId = (list, parentKey, parentId) => list.filter(item => String(item[parentKey]) === String(parentId));

// Endpoints
const PAISES = [
  { code: 'ARG', name: 'Argentina' }, { code: 'BOL', name: 'Bolivia' },
  { code: 'BRA', name: 'Brasil' }, { code: 'CHL', name: 'Chile' },
  { code: 'COL', name: 'Colombia' }, { code: 'CRI', name: 'Costa Rica' },
  { code: 'CUB', name: 'Cuba' }, { code: 'ECU', name: 'Ecuador' },
  { code: 'SLV', name: 'El Salvador' }, { code: 'GTM', name: 'Guatemala' },
  { code: 'HND', name: 'Honduras' }, { code: 'MEX', name: 'México' },
  { code: 'NIC', name: 'Nicaragua' }, { code: 'PAN', name: 'Panamá' },
  { code: 'PRY', name: 'Paraguay' }, { code: 'PER', name: 'Perú' },
  { code: 'DOM', name: 'República Dominicana' }, { code: 'URY', name: 'Uruguay' },
  { code: 'VEN', name: 'Venezuela' }, { code: 'USA', name: 'Estados Unidos' },
  { code: 'ESP', name: 'España' }, { code: 'CAN', name: 'Canadá' },
  { code: 'DEU', name: 'Alemania' }, { code: 'FRA', name: 'Francia' },
  { code: 'GBR', name: 'Reino Unido' }, { code: 'ITA', name: 'Italia' },
  { code: 'CHN', name: 'China' }, { code: 'JPN', name: 'Japón' }
];

app.get('/paises', (req, res) => res.json(geoData.paises || PAISES));

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
