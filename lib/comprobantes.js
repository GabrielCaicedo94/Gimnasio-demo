const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { STORAGE_DIR, FOTOS_DIR } = require('./db');
const { hoy } = require('./util');

const MAX_BYTES = 10 * 1024 * 1024; // fotos de celular pueden pesar 3-8 MB

// Detecta el tipo REAL por los primeros bytes ("magic numbers").
// El mimetype que envía el navegador se puede falsificar; el contenido no.
function detectarTipo(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (buf.slice(0, 4).toString('latin1') === '%PDF') return { mime: 'application/pdf', ext: '.pdf' };
  return null;
}

// Valida y guarda. Devuelve { archivo, mime, bytes } o lanza Error con mensaje para el usuario.
// opciones.base: carpeta destino (comprobantes por defecto). opciones.soloImagenes: rechaza PDF (fotos de cliente).
function guardar(file, { base = STORAGE_DIR, soloImagenes = false } = {}) {
  if (file.size > MAX_BYTES) throw new Error('El archivo supera los 10 MB.');
  const tipo = detectarTipo(file.buffer);
  if (!tipo || (soloImagenes && tipo.mime === 'application/pdf')) {
    throw new Error(soloImagenes ? 'Formato no permitido. Sube una foto (JPG, PNG o WEBP).' : 'Formato no permitido. Sube una foto (JPG, PNG, WEBP) o un PDF.');
  }
  const sub = path.join(hoy().slice(0, 4), hoy().slice(5, 7));
  fs.mkdirSync(path.join(base, sub), { recursive: true });
  // Nombre aleatorio: evita colisiones y nombres maliciosos tipo "../../x"
  const archivo = path.join(sub, crypto.randomUUID() + tipo.ext);
  fs.writeFileSync(path.join(base, archivo), file.buffer, { flag: 'wx' });
  return { archivo, mime: tipo.mime, bytes: file.size };
}

function borrar(archivo, base = STORAGE_DIR) {
  try { fs.unlinkSync(path.join(base, archivo)); } catch { /* ya no existe */ }
}

// Ruta absoluta segura (impide salir de la carpeta indicada)
function rutaAbsoluta(archivo, base = STORAGE_DIR) {
  const abs = path.resolve(base, archivo);
  if (!abs.startsWith(path.resolve(base) + path.sep)) return null;
  return abs;
}

module.exports = { guardar, borrar, rutaAbsoluta, MAX_BYTES, FOTOS_DIR };
