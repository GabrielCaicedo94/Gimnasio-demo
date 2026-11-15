const express = require('express');
const multer = require('multer');
const { db } = require('../lib/db');
const U = require('../lib/util');
const comp = require('../lib/comprobantes');
const A = require('../lib/auditoria');
const { soloAdmin } = require('../lib/permisos');

const router = express.Router();

// Memoria (no disco): validamos el contenido ANTES de escribir nada.
// Dos campos: "foto" (cámara del celular) y "archivo" (galería/PDF). Se acepta cualquiera.
const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: comp.MAX_BYTES, files: 2 } })
  .fields([{ name: 'foto', maxCount: 1 }, { name: 'archivo', maxCount: 1 }]);

// Envoltorio: errores de multer (archivo muy grande, etc.) se vuelven mensajes amigables
const conArchivo = (req, res, next) => subir(req, res, (err) => {
  if (!err) return next();
  req.errorSubida = err.code === 'LIMIT_FILE_SIZE' ? 'El comprobante supera los 10 MB.' : 'No se pudo recibir el archivo.';
  next();
});
const archivoDe = (req) => req.files?.foto?.[0] || req.files?.archivo?.[0] || null;

// ---------- Registrar pago / renovar membresía ----------
router.post('/clientes/:id(\\d+)/renovar', conArchivo, (req, res) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ? AND activo = 1').get(req.params.id);
  if (!c) return res.redirect('/clientes');
  const b = req.body;
  const plan = db.prepare('SELECT * FROM planes WHERE id = ? AND activo = 1').get(parseInt(b.plan_id, 10) || 0);
  const monto = U.aCentavos(b.monto);
  const metodo = ['efectivo', 'transferencia', 'datafast', 'otro'].includes(b.metodo) ? b.metodo : null;
  const file = archivoDe(req);

  const errores = [];
  if (req.errorSubida) errores.push(req.errorSubida);
  if (!plan) errores.push('Selecciona un plan.');
  if (!U.esFecha(b.fecha_inicio)) errores.push('Fecha de inicio inválida.');
  if (monto === null) errores.push('Monto inválido (ej. 30 o 30.50).');
  if (!metodo) errores.push('Selecciona el método de pago.');
  // Regla de negocio: pagos que no son en efectivo DEBEN traer comprobante (constancia).
  if (metodo && metodo !== 'efectivo' && !file && !req.errorSubida) errores.push('Adjunta el comprobante (captura de la transferencia o foto del voucher).');

  let guardado = null;
  if (!errores.length && file) {
    try { guardado = comp.guardar(file); } catch (e) { errores.push(e.message); }
  }
  if (errores.length) return volverConErrores(req, res, c, errores);

  const fin = U.sumarDias(b.fecha_inicio, plan.duracion_dias - 1);
  try {
    // Todo o nada: membresía + pago + comprobante en una sola transacción
    const tx = db.transaction(() => {
      const m = db.prepare('INSERT INTO membresias (cliente_id, plan_id, fecha_inicio, fecha_fin, creado_en) VALUES (?,?,?,?,?)')
        .run(c.id, plan.id, b.fecha_inicio, fin, U.ahora());
      const p = db.prepare(`INSERT INTO pagos (membresia_id, cliente_id, monto_centavos, metodo, referencia, notas, fecha_pago, usuario_id, creado_en)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(m.lastInsertRowid, c.id, monto, metodo, (b.referencia || '').trim().slice(0, 60) || null,
          (b.notas || '').trim().slice(0, 300) || null, U.hoy(), req.session.user.id, U.ahora());
      if (guardado) {
        db.prepare('INSERT INTO comprobantes (pago_id, archivo, mime, bytes, creado_en) VALUES (?,?,?,?,?)')
          .run(p.lastInsertRowid, guardado.archivo, guardado.mime, guardado.bytes, U.ahora());
      }
    });
    tx();
  } catch (e) {
    if (guardado) comp.borrar(guardado.archivo); // no dejar archivos huérfanos
    console.error(e);
    return volverConErrores(req, res, c, ['No se pudo guardar el pago. Intenta de nuevo.']);
  }
  req.flash('ok', `Pago registrado. Membresía ${plan.nombre} válida hasta ${U.verFecha(fin)}.`);
  res.redirect(`/clientes/${c.id}`);
});

function volverConErrores(req, res, c, errores) {
  req.flash('error', errores.join(' '));
  res.redirect(`/clientes/${c.id}#renovar`);
}

// ---------- Adjuntar comprobante a un pago existente ----------
router.post('/pagos/:id(\\d+)/comprobante', conArchivo, (req, res) => {
  const p = db.prepare('SELECT * FROM pagos WHERE id = ?').get(req.params.id);
  if (!p) return res.redirect('/pagos');
  const volver = req.get('referer') && req.get('referer').includes('/pagos') ? `/pagos/${p.id}` : `/clientes/${p.cliente_id}`;
  if (p.estado === 'anulado') { req.flash('error', 'No se puede adjuntar a un pago anulado.'); return res.redirect(volver); }
  const file = archivoDe(req);
  if (req.errorSubida || !file) { req.flash('error', req.errorSubida || 'Selecciona una foto o PDF.'); return res.redirect(volver); }
  let g;
  try { g = comp.guardar(file); } catch (e) { req.flash('error', e.message); return res.redirect(volver); }
  try {
    db.prepare('INSERT INTO comprobantes (pago_id, archivo, mime, bytes, creado_en) VALUES (?,?,?,?,?)')
      .run(p.id, g.archivo, g.mime, g.bytes, U.ahora());
  } catch (e) { comp.borrar(g.archivo); throw e; }
  req.flash('ok', 'Comprobante adjuntado.');
  res.redirect(volver);
});

// ---------- Ver comprobante (solo con sesión iniciada) ----------
router.get('/comprobantes/:id(\\d+)', (req, res) => {
  const r = db.prepare('SELECT * FROM comprobantes WHERE id = ?').get(req.params.id);
  const abs = r && comp.rutaAbsoluta(r.archivo);
  if (!abs) return res.status(404).send('No encontrado');
  res.setHeader('Content-Type', r.mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(abs, (err) => { if (err && !res.headersSent) res.status(404).send('Archivo no encontrado'); });
});

// ---------- Listado de pagos (historial completo; el total solo lo ve el administrador) ----------
router.get('/pagos', (req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : U.hoy().slice(0, 7);
  const metodo = ['efectivo', 'transferencia', 'datafast', 'otro'].includes(req.query.metodo) ? req.query.metodo : '';
  const sinComp = req.query.sin === '1';
  const where = ['p.fecha_pago >= ?', 'p.fecha_pago <= ?'];
  const params = [mes + '-01', mes + '-31'];
  if (metodo) { where.push('p.metodo = ?'); params.push(metodo); }
  if (sinComp) where.push(`p.estado = 'valido' AND p.metodo != 'efectivo' AND NOT EXISTS (SELECT 1 FROM comprobantes WHERE pago_id = p.id)`);

  const pagos = db.prepare(`
    SELECT p.*, c.nombres, c.apellidos, c.documento, pl.nombre AS plan, m.fecha_fin
    FROM pagos p JOIN clientes c ON c.id = p.cliente_id
    JOIN membresias m ON m.id = p.membresia_id JOIN planes pl ON pl.id = m.plan_id
    WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT 500`).all(...params);
  const comps = pagos.length
    ? db.prepare(`SELECT id, pago_id, mime FROM comprobantes WHERE pago_id IN (${pagos.map(() => '?').join(',')})`).all(...pagos.map((p) => p.id))
    : [];
  for (const p of pagos) p.comprobantes = comps.filter((x) => x.pago_id === p.id);
  // El recepcionista ve cada pago, pero NO la suma: ni siquiera se calcula para él.
  const total = res.locals.esAdmin
    ? pagos.filter((p) => p.estado === 'valido').reduce((s, p) => s + p.monto_centavos, 0)
    : null;
  res.render('pagos', { title: 'Pagos', active: 'pagos', pagos, total, mes, metodo, sinComp });
});

// ---------- Detalle de un pago (todos lo ven; solo el administrador puede anular/corregir) ----------
function cargarPago(id) {
  return db.prepare(`
    SELECT p.*, c.nombres, c.apellidos, c.documento, m.plan_id, m.fecha_inicio, m.fecha_fin,
           pl.nombre AS plan, pl.duracion_dias, u.nombre AS registrado_por, ua.nombre AS anulado_por_nombre
    FROM pagos p JOIN clientes c ON c.id = p.cliente_id
    JOIN membresias m ON m.id = p.membresia_id JOIN planes pl ON pl.id = m.plan_id
    LEFT JOIN usuarios u ON u.id = p.usuario_id LEFT JOIN usuarios ua ON ua.id = p.anulado_por
    WHERE p.id = ?`).get(id);
}

router.get('/pagos/:id(\\d+)', (req, res) => {
  const p = cargarPago(req.params.id);
  if (!p) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El pago no existe.' });
  p.comprobantes = db.prepare('SELECT id, mime FROM comprobantes WHERE pago_id = ?').all(p.id);
  const historial = db.prepare("SELECT * FROM auditoria WHERE entidad = 'pago' AND entidad_id = ? ORDER BY id DESC").all(p.id)
    .map((h) => ({ ...h, detalle: h.detalle ? JSON.parse(h.detalle) : null }));
  const planes = db.prepare('SELECT * FROM planes WHERE activo = 1 OR id = ? ORDER BY duracion_dias').all(p.plan_id);
  res.render('pago', { title: `Pago #${p.id}`, active: 'pagos', p, historial, planes });
});

const etiquetaPago = (p) => ({
  Plan: p.plan, 'Inicio de membresía': U.verFecha(p.fecha_inicio), 'Vence': U.verFecha(p.fecha_fin),
  Monto: U.dinero(p.monto_centavos), 'Método': p.metodo, Referencia: p.referencia || '—', 'Fecha de pago': U.verFecha(p.fecha_pago),
});

router.post('/pagos/:id(\\d+)/anular', soloAdmin, (req, res) => {
  const p = cargarPago(req.params.id);
  if (!p) return res.redirect('/pagos');
  const motivo = String(req.body.motivo || '').trim().slice(0, 300);
  if (p.estado === 'anulado') req.flash('error', 'Este pago ya está anulado.');
  else if (motivo.length < 5) req.flash('error', 'Escribe el motivo de la anulación (mínimo 5 caracteres).');
  else {
    db.transaction(() => {
      db.prepare("UPDATE pagos SET estado = 'anulado', anulado_por = ?, anulado_en = ?, motivo_anulacion = ? WHERE id = ?")
        .run(req.user.id, U.ahora(), motivo, p.id);
      A.registrar(req.user, 'anular', 'pago', p.id, `Pago anulado: ${p.apellidos} ${p.nombres} · ${U.dinero(p.monto_centavos)} · ${p.plan}`,
        { antes: etiquetaPago(p), motivo });
    })();
    req.flash('ok', 'Pago anulado. Ya no cuenta en ingresos ni en la membresía del cliente.');
  }
  res.redirect(`/pagos/${p.id}`);
});

router.post('/pagos/:id(\\d+)/corregir', soloAdmin, (req, res) => {
  const p = cargarPago(req.params.id);
  if (!p) return res.redirect('/pagos');
  const b = req.body;
  const volver = `/pagos/${p.id}`;
  const motivo = String(b.motivo || '').trim().slice(0, 300);
  const plan = db.prepare('SELECT * FROM planes WHERE id = ?').get(parseInt(b.plan_id, 10) || 0);
  const monto = U.aCentavos(b.monto);
  const metodo = ['efectivo', 'transferencia', 'datafast', 'otro'].includes(b.metodo) ? b.metodo : null;
  const errores = [];
  if (p.estado === 'anulado') errores.push('No se puede corregir un pago anulado.');
  if (!plan) errores.push('Selecciona un plan.');
  if (!U.esFecha(b.fecha_inicio)) errores.push('Fecha de inicio inválida.');
  if (!U.esFecha(b.fecha_pago) || b.fecha_pago > U.hoy()) errores.push('Fecha de pago inválida (no puede ser futura).');
  if (monto === null) errores.push('Monto inválido.');
  if (!metodo) errores.push('Método inválido.');
  if (motivo.length < 5) errores.push('Escribe el motivo de la corrección (mínimo 5 caracteres).');
  if (errores.length) { req.flash('error', errores.join(' ')); return res.redirect(volver); }

  const referencia = String(b.referencia || '').trim().slice(0, 60) || null;
  const fin = U.sumarDias(b.fecha_inicio, plan.duracion_dias - 1);
  const despues = {
    plan: plan.nombre, fecha_inicio: b.fecha_inicio, fecha_fin: fin, monto_centavos: monto, metodo, referencia, fecha_pago: b.fecha_pago,
  };
  const legible = (x) => ({
    Plan: x.plan, 'Inicio de membresía': U.verFecha(x.fecha_inicio), 'Vence': U.verFecha(x.fecha_fin),
    Monto: U.dinero(x.monto_centavos), 'Método': x.metodo, Referencia: x.referencia || '—', 'Fecha de pago': U.verFecha(x.fecha_pago),
  });
  const a = legible(p), d = legible({ ...despues });
  const cambios = {};
  for (const k of Object.keys(a)) if (a[k] !== d[k]) cambios[k] = [a[k], d[k]];
  if (!Object.keys(cambios).length) { req.flash('error', 'No hay cambios que guardar.'); return res.redirect(volver); }

  db.transaction(() => {
    db.prepare('UPDATE membresias SET plan_id = ?, fecha_inicio = ?, fecha_fin = ? WHERE id = ?').run(plan.id, b.fecha_inicio, fin, p.membresia_id);
    db.prepare('UPDATE pagos SET monto_centavos = ?, metodo = ?, referencia = ?, fecha_pago = ? WHERE id = ?').run(monto, metodo, referencia, b.fecha_pago, p.id);
    A.registrar(req.user, 'corregir', 'pago', p.id, `Pago corregido: ${p.apellidos} ${p.nombres} (${Object.keys(cambios).join(', ')})`,
      { antes: Object.fromEntries(Object.entries(cambios).map(([k, v]) => [k, v[0]])), despues: Object.fromEntries(Object.entries(cambios).map(([k, v]) => [k, v[1]])), motivo });
  })();
  req.flash('ok', `Pago corregido. Nuevo vencimiento: ${U.verFecha(fin)}.`);
  res.redirect(volver);
});

module.exports = router;
