#!/usr/bin/env node
const path = require('path');
const config = require('../src/config');
const { runIngest } = require('../src/ingest/run');

(async () => {
  try {
    const excelPath = process.argv[2] ? path.resolve(process.argv[2]) : config.excelPath;
    if (!excelPath) {
      throw new Error(
        `No se encontro ningun .xlsx en ${config.dataDir}. Pasalo como argumento: node scripts/ingest.js ruta/al/archivo.xlsx`
      );
    }
    await runIngest(excelPath);
    process.exit(0);
  } catch (err) {
    console.error('[ingest] error:', err.message);
    process.exit(1);
  }
})();
