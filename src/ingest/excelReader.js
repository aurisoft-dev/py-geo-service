const ExcelJS = require('exceljs');

const DIACRITICS_RE = new RegExp('[' + String.fromCharCode(0x0300) + '-' + String.fromCharCode(0x036f) + ']', 'g');

function normalize(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '') // quita acentos (a base combinada)
    .trim();
}

// Palabras clave para reconocer las columnas de cada nivel de la jerarquia,
// sin depender de los nombres exactos de encabezado del excel de origen.
const LEVELS = [
  { key: 'departamento', keywords: ['departamento'] },
  { key: 'distrito', keywords: ['distrito'] },
  { key: 'ciudad', keywords: ['ciudad', 'localidad'] },
  { key: 'barrio', keywords: ['barrio'] },
];

function findHeaderRow(worksheet, maxScan = 15) {
  const rowCount = Math.min(maxScan, worksheet.rowCount || maxScan);
  for (let r = 1; r <= rowCount; r++) {
    const row = worksheet.getRow(r);
    const texts = [];
    row.eachCell({ includeEmpty: false }, (cell) => texts.push(normalize(cell.value)));
    const hasDep = texts.some((t) => t.includes('departamento'));
    const hasDist = texts.some((t) => t.includes('distrito'));
    if (hasDep && hasDist) return r;
  }
  return null;
}

function detectColumns(worksheet, headerRowNumber) {
  const row = worksheet.getRow(headerRowNumber);
  const cells = [];
  row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    cells.push({ col: colNumber, text: normalize(cell.value) });
  });

  const byCol = new Map(cells.map((c) => [c.col, c]));

  const mapping = {};
  for (const level of LEVELS) {
    const candidates = cells.filter((c) => level.keywords.some((k) => c.text.includes(k)));
    const nameCell = candidates.find((c) => !c.text.includes('cod'));
    // Caso 1: la propia columna de codigo menciona el nivel (ej. "codigo departamento").
    let codeCell = candidates.find((c) => c.text.includes('cod'));
    // Caso 2: columna generica "codigo" ubicada justo antes de la columna de nombre
    // (ej. "Codigo" | "Departamento" | "Codigo" | "Distritos" | ...).
    if (!codeCell && nameCell) {
      const prev = byCol.get(nameCell.col - 1);
      if (prev && prev.text.includes('cod')) codeCell = prev;
    }
    if (!codeCell || !nameCell) {
      const found = cells.map((c) => `col${c.col}:"${c.text}"`).join(', ');
      throw new Error(
        `No se pudo detectar la columna de codigo/nombre para el nivel "${level.key}". ` +
          `Encabezados en la fila ${headerRowNumber}: ${found}`
      );
    }
    mapping[level.key] = { codeCol: codeCell.col, nameCol: nameCell.col };
  }
  return mapping;
}

function cellText(row, colNumber) {
  const cell = row.getCell(colNumber);
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v !== null) {
    if ('result' in v) return String(v.result ?? '').trim(); // formula
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('text' in v) return String(v.text).trim();
  }
  return String(v).trim();
}

/**
 * Lee el excel de referencia geografica y devuelve un array de filas planas:
 * { depCodigo, depNombre, distCodigo, distNombre, ciudadCodigo, ciudadNombre, barrioCodigo, barrioNombre }
 * Se asume una hoja "desnormalizada" con una fila por barrio (el nivel mas
 * granular) y las columnas de los niveles padres repetidas en cada fila.
 */
async function readGeoRows(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  let target = null;
  for (const worksheet of workbook.worksheets) {
    const headerRow = findHeaderRow(worksheet);
    if (headerRow) {
      target = { worksheet, headerRow };
      break;
    }
  }

  if (!target) {
    const sheetNames = workbook.worksheets.map((w) => w.name).join(', ');
    throw new Error(
      `No se encontro ninguna hoja con columnas "Departamento" y "Distrito" reconocibles. Hojas: ${sheetNames}`
    );
  }

  const { worksheet, headerRow } = target;
  const mapping = detectColumns(worksheet, headerRow);

  console.log(`[excel] hoja usada: "${worksheet.name}" -- fila de encabezado: ${headerRow}`);
  console.log('[excel] columnas detectadas:', JSON.stringify(mapping));

  const rows = [];
  for (let r = headerRow + 1; r <= worksheet.rowCount; r++) {
    const row = worksheet.getRow(r);
    if (!row || row.cellCount === 0) continue;

    const depCodigo = cellText(row, mapping.departamento.codeCol);
    const depNombre = cellText(row, mapping.departamento.nameCol);
    if (!depCodigo && !depNombre) continue; // fila vacia / separadora

    rows.push({
      depCodigo,
      depNombre,
      distCodigo: cellText(row, mapping.distrito.codeCol),
      distNombre: cellText(row, mapping.distrito.nameCol),
      ciudadCodigo: cellText(row, mapping.ciudad.codeCol),
      ciudadNombre: cellText(row, mapping.ciudad.nameCol),
      barrioCodigo: cellText(row, mapping.barrio.codeCol),
      barrioNombre: cellText(row, mapping.barrio.nameCol),
    });
  }

  return rows;
}

module.exports = { readGeoRows, normalize };
