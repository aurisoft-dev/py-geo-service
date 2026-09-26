const { getConnection, ensureSchema } = require('../db/connection');
const { readGeoRows } = require('./excelReader');
const { syncLevel } = require('./diff');

/**
 * Corre el ingest completo: lee el excel, y aplica altas/bajas/modificaciones
 * a geo.db nivel por nivel (departamentos -> distritos -> ciudades -> barrios)
 * dentro de una unica transaccion.
 */
async function runIngest(excelPath) {
  if (!excelPath) {
    throw new Error('Debe indicarse la ruta al archivo excel de origen.');
  }

  console.log(`[ingest] leyendo excel: ${excelPath}`);
  const startedAt = new Date().toISOString();
  const flatRows = await readGeoRows(excelPath);
  console.log(`[ingest] filas leidas: ${flatRows.length}`);

  const db = getConnection();
  ensureSchema(db);

  const txn = db.transaction(() => {
    // Nivel 1: departamentos (deduplicados por codigo)
    const depSource = dedupe(flatRows, (r) => r.depCodigo, (r) => ({
      codigo: r.depCodigo,
      nombre: r.depNombre,
    }));
    const dep = syncLevel(db, 'departamentos', null, depSource);

    // Nivel 2: distritos (deduplicados por departamento_id + codigo)
    const distSource = dedupe(
      flatRows,
      (r) => {
        const depId = dep.idMap.get(r.depCodigo);
        return depId && r.distCodigo ? `${depId}|${r.distCodigo}` : null;
      },
      (r) => ({ parentId: dep.idMap.get(r.depCodigo), codigo: r.distCodigo, nombre: r.distNombre })
    );
    const dist = syncLevel(db, 'distritos', 'departamento_id', distSource);

    // Nivel 3: ciudades/localidades
    const ciudadSource = dedupe(
      flatRows,
      (r) => {
        const depId = dep.idMap.get(r.depCodigo);
        const distId = depId && r.distCodigo ? dist.idMap.get(`${depId}|${r.distCodigo}`) : null;
        return distId && r.ciudadCodigo ? `${distId}|${r.ciudadCodigo}` : null;
      },
      (r) => {
        const depId = dep.idMap.get(r.depCodigo);
        const distId = dist.idMap.get(`${depId}|${r.distCodigo}`);
        return { parentId: distId, codigo: r.ciudadCodigo, nombre: r.ciudadNombre };
      }
    );
    const ciudad = syncLevel(db, 'ciudades', 'distrito_id', ciudadSource);

    // Nivel 4: barrios.
    // Algunas ciudades/localidades no tienen barrios formalmente codificados
    // en el excel (codigo/nombre de barrio en blanco). En ese caso se crea
    // un unico "barrio" que representa a la localidad completa, usando el
    // propio codigo/nombre de la ciudad, en vez de descartar la fila.
    const barrioSource = dedupe(
      flatRows,
      (r) => {
        const depId = dep.idMap.get(r.depCodigo);
        const distId = depId && r.distCodigo ? dist.idMap.get(`${depId}|${r.distCodigo}`) : null;
        const ciudadId = distId && r.ciudadCodigo ? ciudad.idMap.get(`${distId}|${r.ciudadCodigo}`) : null;
        if (!ciudadId) return null;
        const barrioCodigo = r.barrioCodigo || r.ciudadCodigo;
        return `${ciudadId}|${barrioCodigo}`;
      },
      (r) => {
        const depId = dep.idMap.get(r.depCodigo);
        const distId = dist.idMap.get(`${depId}|${r.distCodigo}`);
        const ciudadId = ciudad.idMap.get(`${distId}|${r.ciudadCodigo}`);
        const barrioCodigo = r.barrioCodigo || r.ciudadCodigo;
        const barrioNombre = r.barrioNombre || r.ciudadNombre;
        return { parentId: ciudadId, codigo: barrioCodigo, nombre: barrioNombre };
      }
    );
    const barrio = syncLevel(db, 'barrios', 'ciudad_id', barrioSource);

    const finishedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO ingest_runs (
         started_at, finished_at, source_file,
         departamentos_altas, departamentos_bajas, departamentos_mod,
         distritos_altas, distritos_bajas, distritos_mod,
         ciudades_altas, ciudades_bajas, ciudades_mod,
         barrios_altas, barrios_bajas, barrios_mod
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      startedAt,
      finishedAt,
      excelPath,
      dep.stats.altas,
      dep.stats.bajas,
      dep.stats.modificaciones,
      dist.stats.altas,
      dist.stats.bajas,
      dist.stats.modificaciones,
      ciudad.stats.altas,
      ciudad.stats.bajas,
      ciudad.stats.modificaciones,
      barrio.stats.altas,
      barrio.stats.bajas,
      barrio.stats.modificaciones
    );

    return { dep, dist, ciudad, barrio };
  });

  const result = txn();
  db.close();

  console.log('\n[ingest] resumen:');
  console.table({
    departamentos: result.dep.stats,
    distritos: result.dist.stats,
    ciudades: result.ciudad.stats,
    barrios: result.barrio.stats,
  });

  return result;
}

// Deduplica filas planas del excel por una clave, devolviendo la primera
// ocurrencia mapeada. keyFn puede devolver null para descartar la fila
// (por ejemplo si el padre no se pudo resolver).
function dedupe(rows, keyFn, mapFn) {
  const seen = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key === null || key === undefined) continue;
    if (!seen.has(key)) seen.set(key, mapFn(row));
  }
  return [...seen.values()];
}

module.exports = { runIngest };
