const express = require('express');

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Lee un id requerido desde req.query[name]. Si falta o es invalido, ya
// responde el error correspondiente y devuelve null (el caller solo debe
// chequear `if (id === null) return;`).
function getRequiredQueryId(req, res, name) {
  const raw = req.query[name];
  if (raw === undefined || raw === '') {
    res.status(400).json({ error: `falta el parametro de query "${name}"` });
    return null;
  }
  const id = parseId(raw);
  if (!id) {
    res.status(400).json({ error: `"${name}" invalido` });
    return null;
  }
  return id;
}

function buildGeoRouter(cache) {
  const router = express.Router();

  router.get('/departamentos', (req, res) => {
    res.json(cache.getDepartamentos());
  });

  // Ruta anidada por path (original).
  router.get('/departamentos/:id/distritos', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const distritos = cache.getDistritosByDepartamento(id);
    if (distritos === null) return res.status(404).json({ error: 'departamento no encontrado' });
    res.json(distritos);
  });

  // Misma consulta, via query param: /distritos?departamento_id=1
  router.get('/distritos', (req, res) => {
    const depId = getRequiredQueryId(req, res, 'departamento_id');
    if (depId === null) return;
    const distritos = cache.getDistritosByDepartamento(depId);
    if (distritos === null) return res.status(404).json({ error: 'departamento no encontrado' });
    res.json(distritos);
  });

  // Ruta anidada por path (original).
  router.get('/distritos/:id/ciudades', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const ciudades = cache.getCiudadesByDistrito(id);
    if (ciudades === null) return res.status(404).json({ error: 'distrito no encontrado' });
    res.json(ciudades);
  });

  // Misma consulta, via query param: /ciudades?distrito_id=236
  router.get('/ciudades', (req, res) => {
    const distId = getRequiredQueryId(req, res, 'distrito_id');
    if (distId === null) return;
    const ciudades = cache.getCiudadesByDistrito(distId);
    if (ciudades === null) return res.status(404).json({ error: 'distrito no encontrado' });
    res.json(ciudades);
  });

  // Ruta anidada por path (original).
  router.get('/ciudades/:id/barrios', (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'id invalido' });
    const barrios = cache.getBarriosByCiudad(id);
    if (barrios === null) return res.status(404).json({ error: 'ciudad no encontrada' });
    res.json(barrios);
  });

  // Misma consulta, via query param: /barrios?ciudad_id=1
  router.get('/barrios', (req, res) => {
    const ciudadId = getRequiredQueryId(req, res, 'ciudad_id');
    if (ciudadId === null) return;
    const barrios = cache.getBarriosByCiudad(ciudadId);
    if (barrios === null) return res.status(404).json({ error: 'ciudad no encontrada' });
    res.json(barrios);
  });

  return router;
}

module.exports = { buildGeoRouter };
