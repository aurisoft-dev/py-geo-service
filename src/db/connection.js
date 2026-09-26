const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config');

/**
 * Abre una conexion a geo.db. readonly=true se usa desde el query service
 * (no necesita escribir); readonly=false se usa desde el ingest.
 */
function getConnection({ readonly = false } = {}) {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new Database(config.dbPath, { readonly, fileMustExist: false });
  if (!readonly) {
    db.pragma('journal_mode = WAL');
  }
  db.pragma('foreign_keys = ON');
  return db;
}

function ensureSchema(db) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
}

module.exports = { getConnection, ensureSchema };
