const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getConnection } = require('../db/connection');

const PAISES_DEFAULT = [
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

/**
 * Exporta el contenido activo de geo.db hacia data/geo.json
 * para mantener la sincronización con el servidor Express en memoria.
 */
function exportDbToJson() {
  const db = getConnection({ readonly: true });
  try {
    const deps = db.prepare('SELECT * FROM departamentos WHERE is_active = 1 ORDER BY id').all();
    const dists = db.prepare('SELECT * FROM distritos WHERE is_active = 1 ORDER BY id').all();
    const ciud = db.prepare('SELECT * FROM ciudades WHERE is_active = 1 ORDER BY id').all();
    const barrios = db.prepare('SELECT * FROM barrios WHERE is_active = 1 ORDER BY id').all();

    const geoJsonPath = path.join(config.dataDir, 'geo.json');
    let paises = PAISES_DEFAULT;
    if (fs.existsSync(geoJsonPath)) {
      try {
        const current = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));
        if (current.paises && Array.isArray(current.paises)) {
          paises = current.paises;
        }
      } catch (err) {
        // fallback a PAISES_DEFAULT
      }
    }

    const payload = {
      deps,
      dists,
      ciud,
      barrios,
      paises
    };

    fs.writeFileSync(geoJsonPath, JSON.stringify(payload), 'utf8');
    console.log(`[export] data/geo.json actualizado: ${deps.length} deps, ${dists.length} dists, ${ciud.length} ciud, ${barrios.length} barrios.`);
    return {
      departamentos: deps.length,
      distritos: dists.length,
      ciudades: ciud.length,
      barrios: barrios.length
    };
  } finally {
    db.close();
  }
}

module.exports = { exportDbToJson, PAISES_DEFAULT };

