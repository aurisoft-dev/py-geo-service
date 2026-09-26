PRAGMA foreign_keys = ON;

-- Nivel 1: Departamento
CREATE TABLE IF NOT EXISTS departamentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo      TEXT NOT NULL UNIQUE,
  nombre      TEXT NOT NULL,
  row_hash    TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

-- Nivel 2: Distrito (dentro de un Departamento)
CREATE TABLE IF NOT EXISTS distritos (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  departamento_id   INTEGER NOT NULL REFERENCES departamentos(id),
  codigo            TEXT NOT NULL,
  nombre            TEXT NOT NULL,
  row_hash          TEXT NOT NULL,
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at        TEXT,
  UNIQUE (departamento_id, codigo)
);

-- Nivel 3: Ciudad/Localidad (dentro de un Distrito)
CREATE TABLE IF NOT EXISTS ciudades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  distrito_id   INTEGER NOT NULL REFERENCES distritos(id),
  codigo        TEXT NOT NULL,
  nombre        TEXT NOT NULL,
  row_hash      TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT,
  UNIQUE (distrito_id, codigo)
);

-- Nivel 4: Barrio (dentro de una Ciudad/Localidad)
CREATE TABLE IF NOT EXISTS barrios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ciudad_id   INTEGER NOT NULL REFERENCES ciudades(id),
  codigo      TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  row_hash    TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT,
  UNIQUE (ciudad_id, codigo)
);

CREATE INDEX IF NOT EXISTS idx_distritos_departamento ON distritos(departamento_id);
CREATE INDEX IF NOT EXISTS idx_ciudades_distrito       ON ciudades(distrito_id);
CREATE INDEX IF NOT EXISTS idx_barrios_ciudad          ON barrios(ciudad_id);

CREATE INDEX IF NOT EXISTS idx_departamentos_active ON departamentos(is_active);
CREATE INDEX IF NOT EXISTS idx_distritos_active      ON distritos(is_active);
CREATE INDEX IF NOT EXISTS idx_ciudades_active       ON ciudades(is_active);
CREATE INDEX IF NOT EXISTS idx_barrios_active        ON barrios(is_active);

-- Historial de corridas de ingest (auditoria de altas/bajas/modificaciones)
CREATE TABLE IF NOT EXISTS ingest_runs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at            TEXT NOT NULL,
  finished_at           TEXT NOT NULL,
  source_file           TEXT NOT NULL,
  departamentos_altas   INTEGER NOT NULL DEFAULT 0,
  departamentos_bajas   INTEGER NOT NULL DEFAULT 0,
  departamentos_mod     INTEGER NOT NULL DEFAULT 0,
  distritos_altas       INTEGER NOT NULL DEFAULT 0,
  distritos_bajas       INTEGER NOT NULL DEFAULT 0,
  distritos_mod         INTEGER NOT NULL DEFAULT 0,
  ciudades_altas        INTEGER NOT NULL DEFAULT 0,
  ciudades_bajas        INTEGER NOT NULL DEFAULT 0,
  ciudades_mod          INTEGER NOT NULL DEFAULT 0,
  barrios_altas         INTEGER NOT NULL DEFAULT 0,
  barrios_bajas         INTEGER NOT NULL DEFAULT 0,
  barrios_mod           INTEGER NOT NULL DEFAULT 0
);
