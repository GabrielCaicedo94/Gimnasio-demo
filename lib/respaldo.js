const fs = require('fs');
const path = require('path');
const { db, BACKUP_DIR } = require('./db');
const { hoy } = require('./util');

const MANTENER = 30; // días de respaldos que se conservan

// Copia consistente de la BD (segura aunque la app esté en uso).
async function respaldar(etiqueta = 'auto') {
  const destino = path.join(BACKUP_DIR, `gimnasio-${hoy()}-${etiqueta}.db`);
  await db.backup(destino);
  limpiar();
  return destino;
}

function limpiar() {
  const archivos = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
  for (const f of archivos.slice(0, Math.max(0, archivos.length - MANTENER))) {
    fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
}

function listar() {
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort().reverse()
    .map((f) => ({ nombre: f, kb: Math.round(fs.statSync(path.join(BACKUP_DIR, f)).size / 1024) }));
}

// Respaldo al iniciar (si hoy no hay uno) y cada 6 horas mientras esté abierta.
function programar() {
  const hacerSiFalta = () => {
    const ya = fs.readdirSync(BACKUP_DIR).some((f) => f.startsWith(`gimnasio-${hoy()}-auto`));
    if (!ya) respaldar('auto').catch((e) => console.error('Error en respaldo:', e.message));
  };
  hacerSiFalta();
  setInterval(hacerSiFalta, 6 * 3600 * 1000).unref();
}

module.exports = { respaldar, listar, programar };
