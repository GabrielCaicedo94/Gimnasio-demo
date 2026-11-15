const fs = require('fs');
const path = require('path');
const { hoy } = require('./util');
// SQLite integrado en Node.js (módulo "node:sqlite", Node 22.16+): no hay que compilar
// nada ni instalar Visual Studio. Antes se usaba better-sqlite3, que en Windows exige
// compilador C++ cuando no existe binario para la versión de Node instalada.
let sqlite;
try { sqlite = require('node:sqlite'); } catch {
  console.error('\nEste sistema necesita Node.js 22.16 o superior (tienes ' + process.version + ').\nDescarga la versión LTS desde https://nodejs.org\n');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const STORAGE_DIR = path.join(DATA_DIR, 'comprobantes'); // fuera de /public: solo se sirve con login
const BACKUP_DIR = path.join(DATA_DIR, 'respaldos');
const FOTOS_DIR = path.join(DATA_DIR, 'fotos');           // fotos de clientes (también solo con login)
for (const d of [DATA_DIR, STORAGE_DIR, BACKUP_DIR, FOTOS_DIR]) fs.mkdirSync(d, { recursive: true });

const DB_FILE = path.join(DATA_DIR, 'gimnasio.db');
const raw = new sqlite.DatabaseSync(DB_FILE);
raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Envoltorio con la misma interfaz que usa el resto del código: prepare / exec / transaction / backup
const db = {
  prepare: (sql) => raw.prepare(sql),
  exec: (sql) => raw.exec(sql),
  // Todo o nada: si algo falla dentro, se deshace todo (ROLLBACK)
  transaction: (fn) => (...args) => {
    raw.exec('BEGIN IMMEDIATE');
    try { const r = fn(...args); raw.exec('COMMIT'); return r; }
    catch (e) { raw.exec('ROLLBACK'); throw e; }
  },
  backup: (destino) => sqlite.backup(raw, destino),
};

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'admin',
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo_documento TEXT NOT NULL DEFAULT 'cedula' CHECK (tipo_documento IN ('cedula','pasaporte')),
  documento TEXT NOT NULL UNIQUE,
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  telefono TEXT,
  email TEXT,
  fecha_nacimiento TEXT,
  genero TEXT,
  contacto_emergencia TEXT,
  telefono_emergencia TEXT,
  condiciones_medicas TEXT,
  notas TEXT,
  busqueda TEXT NOT NULL,            -- texto normalizado (sin tildes) para buscar rápido
  fecha_registro TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS planes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  duracion_dias INTEGER NOT NULL CHECK (duracion_dias > 0),
  precio_centavos INTEGER NOT NULL CHECK (precio_centavos >= 0),
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS membresias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  plan_id INTEGER NOT NULL REFERENCES planes(id),
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT NOT NULL,           -- último día válido (inclusive)
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  membresia_id INTEGER NOT NULL REFERENCES membresias(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  monto_centavos INTEGER NOT NULL CHECK (monto_centavos >= 0),
  metodo TEXT NOT NULL CHECK (metodo IN ('efectivo','transferencia','datafast','otro')),
  referencia TEXT,                   -- nro. de transferencia / voucher
  notas TEXT,
  fecha_pago TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id),
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comprobantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pago_id INTEGER NOT NULL REFERENCES pagos(id),
  archivo TEXT NOT NULL,             -- ruta relativa dentro de data/comprobantes
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  creado_en TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS avisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  membresia_id INTEGER NOT NULL REFERENCES membresias(id),
  canal TEXT NOT NULL DEFAULT 'whatsapp',
  fecha TEXT NOT NULL,
  usuario_id INTEGER REFERENCES usuarios(id)
);

CREATE INDEX IF NOT EXISTS idx_clientes_busqueda ON clientes(busqueda);
CREATE INDEX IF NOT EXISTS idx_memb_cliente_fin ON membresias(cliente_id, fecha_fin);
CREATE INDEX IF NOT EXISTS idx_memb_fin ON membresias(fecha_fin);
CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos(fecha_pago);
CREATE INDEX IF NOT EXISTS idx_pagos_cliente ON pagos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_comp_pago ON comprobantes(pago_id);
CREATE INDEX IF NOT EXISTS idx_avisos_memb ON avisos(membresia_id);
`);

// ---------- Migraciones ----------
// El esquema base de arriba es la "versión 1". Cada cambio posterior se agrega aquí como un
// número nuevo y se aplica UNA sola vez en cada instalación (se anota con PRAGMA user_version).
// Así se puede actualizar un gimnasio que ya tiene datos sin perder nada.
const VERSION_ACTUAL = 2;
const tieneColumna = (tabla, col) => raw.prepare(`PRAGMA table_info(${tabla})`).all().some((c) => c.name === col);
const addCol = (tabla, col, def) => { if (!tieneColumna(tabla, col)) raw.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${def}`); };

const MIGRACIONES = {
  1: () => {}, // esquema base (creado arriba con CREATE TABLE IF NOT EXISTS)
  2: () => { // roles, anulación de pagos, foto de cliente y bitácora
    addCol('usuarios', 'activo', 'INTEGER NOT NULL DEFAULT 1');
    addCol('usuarios', 'cambiar_clave', 'INTEGER NOT NULL DEFAULT 0');
    addCol('usuarios', 'creado_por', 'INTEGER');
    addCol('clientes', 'foto', 'TEXT');
    addCol('pagos', 'estado', "TEXT NOT NULL DEFAULT 'valido'");   // 'valido' | 'anulado'
    addCol('pagos', 'anulado_por', 'INTEGER');
    addCol('pagos', 'anulado_en', 'TEXT');
    addCol('pagos', 'motivo_anulacion', 'TEXT');
    raw.exec(`
      CREATE TABLE IF NOT EXISTS auditoria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha_hora TEXT NOT NULL,
        usuario_id INTEGER,
        usuario TEXT NOT NULL,               -- se guarda el texto: la bitácora no cambia aunque borren al usuario
        accion TEXT NOT NULL,
        entidad TEXT NOT NULL,               -- cliente | pago | usuario | plan | config
        entidad_id INTEGER,
        resumen TEXT,
        detalle TEXT                         -- JSON: { antes, despues, motivo }
      );
      CREATE INDEX IF NOT EXISTS idx_aud_entidad ON auditoria(entidad, entidad_id);
      CREATE INDEX IF NOT EXISTS idx_aud_fecha ON auditoria(fecha_hora);
      CREATE INDEX IF NOT EXISTS idx_pagos_estado ON pagos(estado);
    `);
  },
};

function migrar() {
  const actual = raw.prepare('PRAGMA user_version').get().user_version;
  if (actual >= VERSION_ACTUAL) return;
  // Si ya hay datos, se hace una copia de seguridad ANTES de cambiar nada.
  if (raw.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0) {
    raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const copia = path.join(BACKUP_DIR, `gimnasio-${hoy()}-premigracion-v${actual}.db`);
    fs.copyFileSync(DB_FILE, copia);
    console.log(`Respaldo previo a la actualización: ${copia}`);
  }
  for (let v = actual + 1; v <= VERSION_ACTUAL; v++) {
    raw.exec('BEGIN IMMEDIATE');
    try { MIGRACIONES[v](); raw.exec(`PRAGMA user_version = ${v}`); raw.exec('COMMIT'); console.log(`Base de datos actualizada a la versión ${v}`); }
    catch (e) { raw.exec('ROLLBACK'); throw e; }
  }
}
migrar();

// Valores por defecto (solo si no existen)
const setDef = db.prepare('INSERT OR IGNORE INTO config (clave, valor) VALUES (?, ?)');
setDef.run('nombre_gimnasio', 'Gym Demo');
setDef.run('dias_alerta', '3');

if (db.prepare('SELECT COUNT(*) n FROM planes').get().n === 0) {
  const ins = db.prepare('INSERT INTO planes (nombre, duracion_dias, precio_centavos) VALUES (?,?,?)');
  ins.run('Pase diario', 1, 300);
  ins.run('Mensual', 30, 3000);
  ins.run('Trimestral', 90, 8000);
}

const getConfig = () =>
  Object.fromEntries(db.prepare('SELECT clave, valor FROM config').all().map((r) => [r.clave, r.valor]));
const setConfig = (clave, valor) =>
  db.prepare('INSERT INTO config (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor').run(clave, String(valor));

module.exports = { db, getConfig, setConfig, DATA_DIR, STORAGE_DIR, FOTOS_DIR, BACKUP_DIR, ROOT };
