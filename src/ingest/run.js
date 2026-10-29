const fs = require('fs');
const path = require('path');
const config = require('../config');
const { readGeoRows } = require('./excelReader');
const { hashRow } = require('./hash');

/**
 * Motor de sincronización incremental puro en JavaScript.
 * Calcula altas, bajas y modificaciones manteniendo IDs estables y campos de auditoría.
 */
function syncLevelJson(existingList, parentKey, sourceRows) {
  const existingMap = new Map();
  let maxId = 0;
  for (const item of existingList) {
    const id = Number(item.id) || 0;
    if (id > maxId) maxId = id;
    const key = parentKey ? `${item[parentKey]}|${item.codigo}` : String(item.codigo);
    existingMap.set(key, item);
  }

  const stats = { altas: 0, bajas: 0, modificaciones: 0 };
  const idMap = new Map();
  const seenKeys = new Set();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  for (const row of sourceRows) {
    const key = parentKey ? `${row.parentId}|${row.codigo}` : String(row.codigo);
    seenKeys.add(key);
    const hash = hashRow(row.codigo, row.nombre);
    const existing = existingMap.get(key);

    if (!existing) {
      maxId += 1;
      const newItem = {
        id: maxId,
        codigo: String(row.codigo),
        nombre: String(row.nombre),
        row_hash: hash,
        is_active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null
      };
      if (parentKey) {
        newItem[parentKey] = row.parentId;
      }
      existingList.push(newItem);
      existingMap.set(key, newItem);
      idMap.set(key, newItem.id);
      stats.altas += 1;
    } else {
      idMap.set(key, existing.id);
      if (existing.row_hash !== hash) {
        existing.nombre = String(row.nombre);
        existing.row_hash = hash;
        existing.is_active = 1;
        existing.updated_at = now;
        existing.deleted_at = null;
        stats.modificaciones += 1;
      } else if (!existing.is_active) {
        existing.is_active = 1;
        existing.updated_at = now;
        existing.deleted_at = null;
        stats.altas += 1;
      }
    }
  }

  // Soft-delete: detectar bajas (elementos que ya no están en el Excel)
  for (const item of existingList) {
    const key = parentKey ? `${item[parentKey]}|${item.codigo}` : String(item.codigo);
    if (!seenKeys.has(key) && item.is_active) {
      item.is_active = 0;
      item.updated_at = now;
      item.deleted_at = now;
      stats.bajas += 1;
    }
  }

  return { idMap, stats };
}

/**
 * Registra la corrida en el archivo de historial data/ingest_history.json
 */
function recordHistoryRun(runData) {
  try {
    const histPath = path.join(config.dataDir, 'ingest_history.json');
    let history = [];
    if (fs.existsSync(histPath)) {
      try {
        history = JSON.parse(fs.readFileSync(histPath, 'utf8'));
      } catch (_) {}
    }
    const nextId = (history[0]?.id || 0) + 1;
    const entry = { id: nextId, ...runData };
    history.unshift(entry);
    if (history.length > 50) history = history.slice(0, 50);
    fs.writeFileSync(histPath, JSON.stringify(history, null, 2), 'utf8');
    return entry;
  } catch (err) {
    console.warn('[ingest] aviso: no se pudo guardar historial JSON:', err.message);
    return null;
  }
}

/**
 * Intento opcional de sincronización con SQLite si better-sqlite3 está compilado.
 */
function trySyncSqlite(excelPath, depSource, distSource, ciudadSource, barrioSource, startedAt, finishedAt) {
  try {
    const { getConnection, ensureSchema } = require('../db/connection');
    const { syncLevel } = require('./diff');
    const db = getConnection();
    ensureSchema(db);

    const txn = db.transaction(() => {
      const dep = syncLevel(db, 'departamentos', null, depSource);
      const dist = syncLevel(db, 'distritos', 'departamento_id', distSource);
      const ciudad = syncLevel(db, 'ciudades', 'distrito_id', ciudadSource);
      const barrio = syncLevel(db, 'barrios', 'ciudad_id', barrioSource);

      db.prepare(
        `INSERT INTO ingest_runs (
           started_at, finished_at, source_file,
           departamentos_altas, departamentos_bajas, departamentos_mod,
           distritos_altas, distritos_bajas, distritos_mod,
           ciudades_altas, ciudades_bajas, ciudades_mod,
           barrios_altas, barrios_bajas, barrios_mod
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        startedAt, finishedAt, excelPath,
        dep.stats.altas, dep.stats.bajas, dep.stats.modificaciones,
        dist.stats.altas, dist.stats.bajas, dist.stats.modificaciones,
        ciudad.stats.altas, ciudad.stats.bajas, ciudad.stats.modificaciones,
        barrio.stats.altas, barrio.stats.bajas, barrio.stats.modificaciones
      );
    });

    txn();
    db.close();
    console.log('[ingest] Sincronización SQLite (geo.db) completada.');
  } catch (err) {
    // Si better-sqlite3 no está disponible en este runtime, no pasa nada:
    // los datos ya están 100% seguros y actualizados en data/geo.json
    console.log(`[ingest] SQLite nativo omitido (${err.message}). Datos persistidos en data/geo.json`);
  }
}

/**
 * Corre el ingest completo: lee el excel, y aplica altas/bajas/modificaciones
 * de forma incremental y segura.
 */
async function runIngest(excelPath) {
  if (!excelPath) {
    throw new Error('Debe indicarse la ruta al archivo excel de origen.');
  }

  console.log(`[ingest] leyendo excel: ${excelPath}`);
  const startedAt = new Date().toISOString();
  const flatRows = await readGeoRows(excelPath);
  console.log(`[ingest] filas leidas del excel: ${flatRows.length}`);

  // Cargar datos actuales de data/geo.json
  const geoJsonPath = path.join(config.dataDir, 'geo.json');
  let currentGeo = { deps: [], dists: [], ciud: [], barrios: [] };
  if (fs.existsSync(geoJsonPath)) {
    try {
      currentGeo = JSON.parse(fs.readFileSync(geoJsonPath, 'utf8'));
      if (!Array.isArray(currentGeo.deps)) currentGeo.deps = [];
      if (!Array.isArray(currentGeo.dists)) currentGeo.dists = [];
      if (!Array.isArray(currentGeo.ciud)) currentGeo.ciud = [];
      if (!Array.isArray(currentGeo.barrios)) currentGeo.barrios = [];
    } catch (e) {
      console.warn('[ingest] aviso leyendo geo.json previo:', e.message);
    }
  }

  // Nivel 1: departamentos (deduplicados por codigo)
  const depSource = dedupe(flatRows, (r) => r.depCodigo, (r) => ({
    codigo: r.depCodigo,
    nombre: r.depNombre,
  }));
  const dep = syncLevelJson(currentGeo.deps, null, depSource);

  // Nivel 2: distritos (deduplicados por departamento_id + codigo)
  const distSource = dedupe(
    flatRows,
    (r) => {
      const depId = dep.idMap.get(r.depCodigo);
      return depId && r.distCodigo ? `${depId}|${r.distCodigo}` : null;
    },
    (r) => ({ parentId: dep.idMap.get(r.depCodigo), codigo: r.distCodigo, nombre: r.distNombre })
  );
  const dist = syncLevelJson(currentGeo.dists, 'departamento_id', distSource);

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
  const ciudad = syncLevelJson(currentGeo.ciud, 'distrito_id', ciudadSource);

  // Nivel 4: barrios
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
      const ciudadId = distId && r.ciudadCodigo ? ciudad.idMap.get(`${distId}|${r.ciudadCodigo}`) : null;
      const barrioCodigo = r.barrioCodigo || r.ciudadCodigo;
      const barrioNombre = r.barrioNombre || r.ciudadNombre;
      return { parentId: ciudadId, codigo: barrioCodigo, nombre: barrioNombre };
    }
  );
  const barrio = syncLevelJson(currentGeo.barrios, 'ciudad_id', barrioSource);

  // Guardar en data/geo.json
  fs.writeFileSync(geoJsonPath, JSON.stringify(currentGeo), 'utf8');
  console.log(`[ingest] data/geo.json guardado: ${currentGeo.deps.length} deps, ${currentGeo.dists.length} dists, ${currentGeo.ciud.length} ciud, ${currentGeo.barrios.length} barrios.`);

  const finishedAt = new Date().toISOString();

  // Guardar historial de corrida
  recordHistoryRun({
    started_at: startedAt,
    finished_at: finishedAt,
    source_file: excelPath,
    departamentos_altas: dep.stats.altas,
    departamentos_bajas: dep.stats.bajas,
    departamentos_mod: dep.stats.modificaciones,
    distritos_altas: dist.stats.altas,
    distritos_bajas: dist.stats.bajas,
    distritos_mod: dist.stats.modificaciones,
    ciudades_altas: ciudad.stats.altas,
    ciudades_bajas: ciudad.stats.bajas,
    ciudades_mod: ciudad.stats.modificaciones,
    barrios_altas: barrio.stats.altas,
    barrios_bajas: barrio.stats.bajas,
    barrios_mod: barrio.stats.modificaciones,
  });

  // Intentar sincronizar en SQLite opcionalmente sin interrumpir
  trySyncSqlite(excelPath, depSource, distSource, ciudadSource, barrioSource, startedAt, finishedAt);

  const result = { dep, dist, ciudad, barrio };

  console.log('\n[ingest] resumen:');
  console.table({
    departamentos: result.dep.stats,
    distritos: result.dist.stats,
    ciudades: result.ciudad.stats,
    barrios: result.barrio.stats,
  });

  return result;
}

// Deduplica filas planas del excel por una clave
function dedupe(rows, keyFn, mapFn) {
  const seen = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (key === null || key === undefined) continue;
    if (!seen.has(key)) seen.set(key, mapFn(row));
  }
  return [...seen.values()];
}

module.exports = { runIngest, syncLevelJson };
