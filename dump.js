const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'geo.db');
const db = new Database(dbPath, { readonly: true });

const deps = db.prepare('SELECT * FROM departamentos WHERE is_active = 1').all();
const dists = db.prepare('SELECT * FROM distritos WHERE is_active = 1').all();
const ciud = db.prepare('SELECT * FROM ciudades WHERE is_active = 1').all();
const barrios = db.prepare('SELECT * FROM barrios WHERE is_active = 1').all();

fs.writeFileSync(path.join(__dirname, 'data', 'geo.json'), JSON.stringify({ deps, dists, ciud, barrios }));
console.log('JSON dumped successfully!');
process.exit(0);
