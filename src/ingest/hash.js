const crypto = require('crypto');

/**
 * Hash estable de una fila para detectar modificaciones entre corridas de ingest.
 * Recibe los campos relevantes (codigo, nombre, ...) y devuelve un sha1 hex.
 */
function hashRow(...parts) {
  const normalized = parts.map((p) => String(p ?? '').trim()).join('|');
  return crypto.createHash('sha1').update(normalized, 'utf8').digest('hex');
}

module.exports = { hashRow };
