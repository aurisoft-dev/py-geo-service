const { hashRow } = require('./hash');

/**
 * Sincroniza un nivel de la jerarquia (departamentos/distritos/ciudades/barrios)
 * contra el estado actual en geo.db, calculando altas/bajas/modificaciones.
 *
 * - Alta: existe en el excel pero no en la DB (o estaba dada de baja y reaparece).
 * - Baja: existe en la DB (activa) pero no aparece en el excel -> soft delete (is_active=0).
 * - Modificacion: existe en ambos pero el nombre cambio (row_hash distinto).
 *
 * Los ids son autoincrement y estables entre corridas: se reutiliza el mismo
 * id de fila mientras la clave natural (parent_id + codigo) siga existiendo,
 * asi las referencias (departamento_id, distrito_id, ciudad_id) no se rompen.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @param {string|null} parentColumn  ej. 'departamento_id', o null para el nivel raiz
 * @param {Array<{parentId?: number, codigo: string, nombre: string}>} sourceRows
 * @returns {{ idMap: Map<string, number>, stats: {altas:number, bajas:number, modificaciones:number} }}
 */
function syncLevel(db, tableName, parentColumn, sourceRows) {
  const selectExisting = parentColumn
    ? db.prepare(`SELECT id, ${parentColumn} AS parent_id, codigo, nombre, row_hash, is_active FROM ${tableName}`)
    : db.prepare(`SELECT id, codigo, nombre, row_hash, is_active FROM ${tableName}`);
  const existing = selectExisting.all();

  const existingMap = new Map();
  for (const row of existing) {
    const key = parentColumn ? `${row.parent_id}|${row.codigo}` : row.codigo;
    existingMap.set(key, row);
  }

  const insert = parentColumn
    ? db.prepare(
        `INSERT INTO ${tableName} (${parentColumn}, codigo, nombre, row_hash, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))`
      )
    : db.prepare(
        `INSERT INTO ${tableName} (codigo, nombre, row_hash, is_active, created_at, updated_at)
         VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))`
      );

  const update = db.prepare(
    `UPDATE ${tableName} SET nombre = ?, row_hash = ?, is_active = 1, updated_at = datetime('now'), deleted_at = NULL WHERE id = ?`
  );
  const reactivate = db.prepare(
    `UPDATE ${tableName} SET is_active = 1, updated_at = datetime('now'), deleted_at = NULL WHERE id = ?`
  );
  const deactivate = db.prepare(
    `UPDATE ${tableName} SET is_active = 0, updated_at = datetime('now'), deleted_at = datetime('now') WHERE id = ?`
  );

  const stats = { altas: 0, bajas: 0, modificaciones: 0 };
  const idMap = new Map();
  const seenKeys = new Set();

  for (const row of sourceRows) {
    const key = parentColumn ? `${row.parentId}|${row.codigo}` : row.codigo;
    seenKeys.add(key);
    const hash = hashRow(row.codigo, row.nombre);
    const existingRow = existingMap.get(key);

    if (!existingRow) {
      const info = parentColumn
        ? insert.run(row.parentId, row.codigo, row.nombre, hash)
        : insert.run(row.codigo, row.nombre, hash);
      idMap.set(key, info.lastInsertRowid);
      stats.altas += 1;
    } else {
      idMap.set(key, existingRow.id);
      if (existingRow.row_hash !== hash) {
        update.run(row.nombre, hash, existingRow.id);
        stats.modificaciones += 1;
      } else if (!existingRow.is_active) {
        reactivate.run(existingRow.id);
        stats.altas += 1; // reaparece: se cuenta como alta
      }
    }
  }

  for (const row of existing) {
    const key = parentColumn ? `${row.parent_id}|${row.codigo}` : row.codigo;
    if (!seenKeys.has(key) && row.is_active) {
      deactivate.run(row.id);
      stats.bajas += 1;
    }
  }

  return { idMap, stats };
}

module.exports = { syncLevel };
