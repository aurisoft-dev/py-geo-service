const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Observa la carpeta de geo.db y dispara onChange (debounced) cuando el
 * archivo principal o sus sidecars de WAL cambian. Se usa fs.watch a nivel
 * de directorio porque en modo WAL las escrituras suelen ir a geo.db-wal,
 * no directamente a geo.db.
 */
function watchDb(onChange, { debounceMs = 400 } = {}) {
  const dir = path.dirname(config.dbPath);
  const base = path.basename(config.dbPath);
  const relevant = new Set([base, `${base}-wal`, `${base}-shm`, `${base}-journal`]);

  fs.mkdirSync(dir, { recursive: true });

  let timer = null;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };

  const watcher = fs.watch(dir, (eventType, filename) => {
    if (filename && relevant.has(filename)) trigger();
  });

  console.log(`[watcher] observando cambios en ${dir} (${base})`);
  return watcher;
}

module.exports = { watchDb };
