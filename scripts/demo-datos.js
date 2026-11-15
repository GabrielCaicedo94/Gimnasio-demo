// Carga DATOS FICTICIOS para mostrar el sistema (demo / portafolio).
//   npm run demo            -> crea usuarios de prueba y ~32 clientes inventados
//   npm run demo -- --forzar -> lo hace aunque ya existan clientes
// Todo lo que se genera es inventado: nombres, cédulas (válidas pero aleatorias), teléfonos y pagos.
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const A = require('../lib/auditoria');
const U = require('../lib/util');

if (db.prepare('SELECT COUNT(*) n FROM clientes').get().n > 0 && !process.argv.includes('--forzar')) {
  console.error('\n✘ La base ya tiene clientes. Usa una carpeta data vacía, o añade --forzar.\n');
  process.exit(1);
}

// Generador pseudoaleatorio con semilla fija: la demo sale igual cada vez.
let semilla = 20261115;
const rnd = (n) => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla % n; };
const elegir = (arr) => arr[rnd(arr.length)];

const cedula = () => {
  const prov = elegir(['17', '09', '01', '11', '18']);
  const base = prov + String(rnd(6)) + String(rnd(1e6)).padStart(6, '0');
  let s = 0;
  for (let i = 0; i < 9; i++) { let d = +base[i] * (i % 2 === 0 ? 2 : 1); if (d > 9) d -= 9; s += d; }
  return base + ((10 - (s % 10)) % 10);
};

const NOMBRES = ['Carlos', 'María', 'Luis', 'Andrea', 'Jorge', 'Daniela', 'Pedro', 'Valeria', 'Diego', 'Camila', 'Mateo', 'Sofía',
  'Andrés', 'Paola', 'Fernando', 'Gabriela', 'Ricardo', 'Lucía', 'Santiago', 'Carolina', 'Esteban', 'Mónica', 'Javier', 'Natalia'];
const APELLIDOS = ['Mora', 'Vera', 'Castillo', 'Ortiz', 'Salazar', 'Paredes', 'Cedeño', 'Zambrano', 'Loor', 'Intriago', 'Barrera',
  'Cevallos', 'Maldonado', 'Pacheco', 'Villamar', 'Burgos', 'Andrade', 'Quinde', 'Torres', 'Delgado', 'Reyes', 'Macías'];

// ---- usuarios de prueba ----
const hash = bcrypt.hashSync('Demo12345', 10);
const ins = db.prepare('INSERT OR IGNORE INTO usuarios (usuario, nombre, hash, rol, creado_en, activo, cambiar_clave) VALUES (?,?,?,?,?,1,0)');
ins.run('admin', 'Administrador Demo', hash, 'admin', U.ahora());
ins.run('recepcion', 'Recepción Demo', hash, 'recepcion', U.ahora());
const admin = db.prepare("SELECT * FROM usuarios WHERE usuario = 'admin'").get();
const recep = db.prepare("SELECT * FROM usuarios WHERE usuario = 'recepcion'").get();

const plan = (dias) => db.prepare('SELECT * FROM planes WHERE duracion_dias = ? AND activo = 1').get(dias);
const PASE = plan(1), MENSUAL = plan(30), TRIM = plan(90);
const hoy = U.hoy();

const insCli = db.prepare(`INSERT INTO clientes (tipo_documento, documento, nombres, apellidos, telefono, email, fecha_nacimiento, genero,
  contacto_emergencia, telefono_emergencia, condiciones_medicas, notas, busqueda, fecha_registro, activo, creado_en)
  VALUES ('cedula',?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`);
const insMem = db.prepare('INSERT INTO membresias (cliente_id, plan_id, fecha_inicio, fecha_fin, creado_en) VALUES (?,?,?,?,?)');
const insPago = db.prepare(`INSERT INTO pagos (membresia_id, cliente_id, monto_centavos, metodo, referencia, notas, fecha_pago, usuario_id, creado_en)
  VALUES (?,?,?,?,?,?,?,?,?)`);

function pagar(clienteId, pl, inicio, metodo = 'efectivo', extra = {}) {
  const fin = U.sumarDias(inicio, pl.duracion_dias - 1);
  const m = insMem.run(clienteId, pl.id, inicio, fin, U.ahora());
  const ref = metodo === 'efectivo' ? null : String(100000 + rnd(900000));
  const p = insPago.run(m.lastInsertRowid, clienteId, extra.monto ?? pl.precio_centavos, metodo, ref, extra.notas || null,
    inicio, elegir([admin.id, recep.id]), U.ahora());
  return { memId: m.lastInsertRowid, pagoId: p.lastInsertRowid, fin };
}

// Escenarios: [descripción, función(cliente) que crea sus pagos]
const escenarios = [];
const add = (n, f) => { for (let i = 0; i < n; i++) escenarios.push(f); };
// vigentes (con historial previo)
add(10, (c) => { const ini = U.sumarDias(hoy, -(3 + rnd(22))); pagar(c, MENSUAL, U.sumarDias(ini, -30), elegir(['efectivo', 'transferencia'])); pagar(c, MENSUAL, ini, elegir(['efectivo', 'transferencia', 'datafast'])); });
add(4, (c) => { pagar(c, TRIM, U.sumarDias(hoy, -(5 + rnd(60))), elegir(['transferencia', 'datafast'])); });
// por vencer: hoy, mañana, +2, +3
[0, 1, 2, 3].forEach((d) => add(1, (c) => pagar(c, MENSUAL, U.sumarDias(hoy, d - 29), elegir(['efectivo', 'transferencia']))));
// vencidos
[3, 8, 15, 24].forEach((d) => add(1, (c) => pagar(c, MENSUAL, U.sumarDias(hoy, -d - 29), 'efectivo')));
// pase diario (sin membresía)
add(3, (c) => pagar(c, PASE, U.sumarDias(hoy, -rnd(2)), 'efectivo'));
// sin ningún pago todavía
add(4, () => {});

const clientes = [];
escenarios.forEach((f, i) => {
  const n = NOMBRES[i % NOMBRES.length], a = `${elegir(APELLIDOS)} ${elegir(APELLIDOS)}`;
  const doc = cedula();
  const nac = `${1975 + rnd(32)}-${String(1 + rnd(12)).padStart(2, '0')}-${String(1 + rnd(28)).padStart(2, '0')}`;
  const reg = U.sumarDias(hoy, -(rnd(120)));
  const c = insCli.run(doc, n, a, '09' + String(10000000 + rnd(89999999)),
    `${U.normalizar(n)}.${U.normalizar(a.split(' ')[0])}${rnd(99)}@ejemplo.com`.replace(/\s/g, ''), nac, i % 2 ? 'Femenino' : 'Masculino',
    `Contacto de ${n}`, '09' + String(10000000 + rnd(89999999)), i % 9 === 0 ? 'Lesión leve de rodilla' : null,
    i % 11 === 0 ? 'Prefiere horario de la tarde' : null, U.normalizar(`${n} ${a} ${doc}`), reg, U.ahora());
  clientes.push({ id: Number(c.lastInsertRowid), nombre: `${a} ${n}` });
  f(Number(c.lastInsertRowid));
});

// ---- un pago duplicado ANULADO, para mostrar la función ----
const victima = clientes[2];
const dup = pagar(victima.id, MENSUAL, hoy, 'efectivo', { notas: 'Registrado dos veces por error' });
db.prepare(`UPDATE pagos SET estado = 'anulado', anulado_por = ?, anulado_en = ?, motivo_anulacion = ? WHERE id = ?`)
  .run(admin.id, U.ahora(), 'Pago duplicado', dup.pagoId);
A.registrar(admin, 'anular', 'pago', dup.pagoId, `Pago #${dup.pagoId} anulado (${victima.nombre})`, { motivo: 'Pago duplicado' });
A.registrar(null, 'crear', 'usuario', recep.id, 'Usuario de recepción creado (datos de demostración)');

const total = db.prepare('SELECT COUNT(*) n FROM clientes').get().n;
console.log(`\n✔ Demo lista: ${total} clientes ficticios.\n   Administrador: admin / Demo12345\n   Recepción:     recepcion / Demo12345\n`);
