const { getConnection } = require('../db/connection');

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row[key])) map.set(row[key], []);
    map.get(row[key]).push(row);
  }
  return map;
}

function indexById(rows) {
  const map = new Map();
  for (const row of rows) map.set(row.id, row);
  return map;
}

function loadFromDb() {
  const db = getConnection({ readonly: true });
  try {
    const departamentos = db
      .prepare('SELECT id, codigo, nombre FROM departamentos WHERE is_active = 1 ORDER BY codigo')
      .all();
    const distritos = db
      .prepare('SELECT id, departamento_id, codigo, nombre FROM distritos WHERE is_active = 1 ORDER BY codigo')
      .all();
    const ciudades = db
      .prepare('SELECT id, distrito_id, codigo, nombre FROM ciudades WHERE is_active = 1 ORDER BY codigo')
      .all();
    const barrios = db
      .prepare('SELECT id, ciudad_id, codigo, nombre FROM barrios WHERE is_active = 1 ORDER BY codigo')
      .all();

    db.close();

    return {
      departamentos,
      distritosByDep: groupBy(distritos, 'departamento_id'),
      ciudadesByDist: groupBy(ciudades, 'distrito_id'),
      barriosByCiudad: groupBy(barrios, 'ciudad_id'),
      byId: {
        departamentos: indexById(departamentos),
        distritos: indexById(distritos),
        ciudades: indexById(ciudades),
      },
      loadedAt: new Date().toISOString(),
      counts: {
        departamentos: departamentos.length,
        distritos: distritos.length,
        ciudades: ciudades.length,
        barrios: barrios.length,
      },
    };
  } finally {
    db.close();
  }
}

/**
 * Cache en memoria del arbol geografico completo. Se carga al iniciar el
 * servidor y se recarga cada vez que geo.db cambia (ver watcher.js).
 */
class GeoCache {
  constructor() {
    this.data = loadFromDb();
  }

  reload() {
    try {
      this.data = loadFromDb();
      const c = this.data.counts;
      console.log(
        `[cache] recargado (${this.data.loadedAt}) — departamentos:${c.departamentos} distritos:${c.distritos} ciudades:${c.ciudades} barrios:${c.barrios}`
      );
    } catch (err) {
      console.error('[cache] error al recargar, se mantiene el cache anterior:', err.message);
    }
  }

  getPaises() {
    return [
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
  }

  getDepartamentos() {
    return this.data.departamentos;
  }

  getDistritosByDepartamento(depId) {
    if (!this.data.byId.departamentos.has(depId)) return null;
    return this.data.distritosByDep.get(depId) || [];
  }

  getCiudadesByDistrito(distId) {
    if (!this.data.byId.distritos.has(distId)) return null;
    return this.data.ciudadesByDist.get(distId) || [];
  }

  getBarriosByCiudad(ciudadId) {
    if (!this.data.byId.ciudades.has(ciudadId)) return null;
    return this.data.barriosByCiudad.get(ciudadId) || [];
  }
}

module.exports = { GeoCache };
