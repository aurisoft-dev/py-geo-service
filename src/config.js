const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

// El excel de origen tiene un nombre largo con espacios/acentos/parentesis.
// En vez de fijar el nombre exacto, se toma el primer .xlsx que haya en data/
// (se puede sobreescribir pasando una ruta como argumento a scripts/ingest.js).
function findDefaultExcel() {
  if (!fs.existsSync(dataDir)) return null;
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => f.toLowerCase().endsWith('.xlsx'));
  return files[0] ? path.join(dataDir, files[0]) : null;
}

module.exports = {
  rootDir,
  dataDir,
  dbPath: path.join(dataDir, 'geo.db'),
  excelPath: findDefaultExcel(),
  port: process.env.PORT ? Number(process.env.PORT) : 3001,
};
