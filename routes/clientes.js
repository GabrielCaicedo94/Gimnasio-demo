const express = require('express');
const { db } = require('../lib/db');
const U = require('../lib/util');
const { ULTIMA } = require('./dashboard');
const A = require('../lib/auditoria');
const comp = require('../lib/comprobantes');
const { soloAdmin } = require('../lib/permisos');
const multer = require('multer');

const router = express.Router();
const POR_PAGINA = 25;

// ---------- Listado + búsqueda ----------
router.get('/clientes', (req, res) => {
  const q = U.normalizar(req.query.q || '');
  const filtro = ['activo', 'por_vencer', 'hoy', 'vencido', 'sin'].includes(req.query.estado) ? req.query.estado : '';
  const pagina = Math.max(1, parseInt(req.query.p, 10) || 1);
  const h = U.hoy();
  const limite = U.sumarDias(h, res.locals.diasAlerta);

  const where = ['c.activo = 1'];
  const params = [];
  // Cada palabra debe aparecer en nombre, apellido, documento o teléfono (en cualquier orden)
  for (const palabra of q.split(/\s+/).filter(Boolean)) {
    where.push(`c.busqueda LIKE ? ESCAPE '\\'`);
    params.push('%' + palabra.replace(/[\\%_]/g, '\\$&') + '%');
  }
  const cond = {
    activo: ['m.fecha_fin >= ?', h],   // membresía al día (incluye por vencer y los que vencen hoy)
    por_vencer: ['m.fecha_fin > ? AND m.fecha_fin <= ?', h, limite],
    hoy: ['m.fecha_fin = ?', h],
    vencido: ['m.fecha_fin < ?', h],
    sin: ['m.id IS NULL'],
  }[filtro];
  if (cond) { where.push(cond[0]); params.push(...cond.slice(1)); }

  const from = `FROM clientes c
    LEFT JOIN membresias m ON ${ULTIMA}
    LEFT JOIN planes pl ON pl.id = m.plan_id
    WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) n ${from}`).get(...params).n;
  const filas = db.prepare(`
    SELECT c.id, c.documento, c.nombres, c.apellidos, c.telefono, m.fecha_fin, pl.nombre AS plan,
           (c.foto IS NOT NULL) AS tiene_foto, c.foto AS foto_v,
           (SELECT MAX(m3.fecha_inicio) FROM membresias m3 JOIN planes p3 ON p3.id = m3.plan_id
             WHERE m3.cliente_id = c.id AND p3.duracion_dias = 1
               AND NOT EXISTS (SELECT 1 FROM pagos pg WHERE pg.membresia_id = m3.id AND pg.estado = 'anulado')) AS ultimo_pase ${from}
    ORDER BY c.apellidos COLLATE NOCASE, c.nombres COLLATE NOCASE
    LIMIT ? OFFSET ?`).all(...params, POR_PAGINA, (pagina - 1) * POR_PAGINA);

  const clientes = filas.map((f) => ({ ...f, est: U.estado(f.fecha_fin, h, res.locals.diasAlerta) }));
  res.render('clientes', {
    title: 'Clientes', active: 'clientes', clientes, total, pagina,
    paginas: Math.max(1, Math.ceil(total / POR_PAGINA)),
    q: req.query.q || '', filtro,
  });
});

// ---------- Validación compartida ----------
function leerCliente(b) {
  const v = {};
  for (const k of ['tipo_documento', 'documento', 'nombres', 'apellidos', 'telefono', 'email', 'fecha_nacimiento',
    'genero', 'contacto_emergencia', 'telefono_emergencia', 'condiciones_medicas', 'notas']) {
    v[k] = String(b[k] ?? '').trim();
  }
  if (v.tipo_documento !== 'pasaporte') v.tipo_documento = 'cedula';
  v.documento = v.documento.replace(/\s+/g, '').toUpperCase();
  return v;
}
function validarCliente(v) {
  const e = [];
  if (!v.nombres) e.push('Los nombres son obligatorios.');
  if (!v.apellidos) e.push('Los apellidos son obligatorios.');
  if (v.tipo_documento === 'cedula' && !U.cedulaValida(v.documento)) e.push('La cédula no es válida (10 dígitos, verificada).');
  if (v.tipo_documento === 'pasaporte' && !/^[A-Z0-9]{5,20}$/.test(v.documento)) e.push('Pasaporte inválido (5-20 letras/números).');
  if (v.telefono && !/^[\d\s+()-]{7,20}$/.test(v.telefono)) e.push('Teléfono inválido.');
  if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) e.push('Correo inválido.');
  if (v.fecha_nacimiento && (!U.esFecha(v.fecha_nacimiento) || v.fecha_nacimiento > U.hoy())) e.push('Fecha de nacimiento inválida.');
  return e;
}
const ETIQUETAS_CLIENTE = {
  tipo_documento: 'Tipo de documento', documento: 'Documento', nombres: 'Nombres', apellidos: 'Apellidos', telefono: 'Teléfono',
  email: 'Correo', fecha_nacimiento: 'Nacimiento', genero: 'Género', contacto_emergencia: 'Contacto de emergencia',
  telefono_emergencia: 'Teléfono de emergencia', condiciones_medicas: 'Condiciones médicas', notas: 'Notas',
};
const textoBusqueda = (v) => U.normalizar([v.nombres, v.apellidos, v.documento, v.telefono].join(' '));

// ---------- Crear ----------
router.get('/clientes/nuevo', (req, res) =>
  res.render('cliente-form', { title: 'Nuevo cliente', active: 'clientes', c: { tipo_documento: 'cedula' }, errores: [], modo: 'nuevo' }));

router.post('/clientes', (req, res) => {
  const v = leerCliente(req.body);
  const errores = validarCliente(v);
  if (!errores.length) {
    const dup = db.prepare('SELECT id, nombres, apellidos FROM clientes WHERE documento = ?').get(v.documento);
    if (dup) errores.push(`Ya existe un cliente con ese documento: <a href="/clientes/${dup.id}">${esc(dup.nombres)} ${esc(dup.apellidos)}</a>.`);
  }
  if (errores.length) return res.status(400).render('cliente-form', { title: 'Nuevo cliente', active: 'clientes', c: v, errores, modo: 'nuevo' });

  const info = db.prepare(`INSERT INTO clientes
    (tipo_documento, documento, nombres, apellidos, telefono, email, fecha_nacimiento, genero, contacto_emergencia,
     telefono_emergencia, condiciones_medicas, notas, busqueda, fecha_registro, creado_en)
    VALUES (@tipo_documento,@documento,@nombres,@apellidos,@telefono,@email,@fecha_nacimiento,@genero,@contacto_emergencia,
            @telefono_emergencia,@condiciones_medicas,@notas,@busqueda,@fecha_registro,@creado_en)`)
    .run({ ...v, busqueda: textoBusqueda(v), fecha_registro: U.hoy(), creado_en: U.ahora() });
  A.registrar(req.user, 'crear', 'cliente', info.lastInsertRowid, `Cliente registrado: ${v.apellidos} ${v.nombres} (${v.documento})`);
  req.flash('ok', 'Cliente registrado. Ahora registra su primer pago de membresía.');
  res.redirect(`/clientes/${info.lastInsertRowid}#renovar`);
});

// ---------- Perfil ----------
router.get('/clientes/:id(\\d+)', (req, res) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El cliente no existe.' });
  const h = U.hoy();
  const membresias = db.prepare(`
    SELECT m.*, pl.nombre AS plan, pl.duracion_dias,
           (SELECT estado FROM pagos WHERE membresia_id = m.id) AS pago_estado
    FROM membresias m JOIN planes pl ON pl.id = m.plan_id
    WHERE m.cliente_id = ? ORDER BY m.fecha_fin DESC, m.id DESC`).all(c.id);
  const pagos = db.prepare(`
    SELECT p.*, pl.nombre AS plan, m.fecha_inicio, m.fecha_fin, u.nombre AS registrado_por
    FROM pagos p JOIN membresias m ON m.id = p.membresia_id JOIN planes pl ON pl.id = m.plan_id
    LEFT JOIN usuarios u ON u.id = p.usuario_id
    WHERE p.cliente_id = ? ORDER BY p.id DESC`).all(c.id);
  const comps = db.prepare(`SELECT id, pago_id, mime FROM comprobantes WHERE pago_id IN (SELECT id FROM pagos WHERE cliente_id = ?)`).all(c.id);
  for (const p of pagos) p.comprobantes = comps.filter((x) => x.pago_id === p.id);

  // La membresía "actual" ignora los pases de 1 día
  // (y las de pagos anulados: un pago anulado no cuenta)
  const validas = membresias.filter((m) => m.pago_estado !== 'anulado');
  const actual = validas.find((m) => m.duracion_dias > 1) || null;
  const ultimoPase = validas.find((m) => m.duracion_dias === 1)?.fecha_inicio || null;
  const puedeEliminar = res.locals.esAdmin && pagos.length === 0;
  const planes = db.prepare('SELECT * FROM planes WHERE activo = 1 ORDER BY duracion_dias').all();
  // Si aún está vigente, la renovación empieza el día siguiente al vencimiento (no se pierden días).
  const inicioSugerido = actual && actual.fecha_fin >= h ? U.sumarDias(actual.fecha_fin, 1) : h;
  res.render('cliente', {
    title: `${c.nombres} ${c.apellidos}`, active: 'clientes', c, membresias, pagos, planes,
    est: U.estado(actual?.fecha_fin, h, res.locals.diasAlerta), actual, ultimoPase, puedeEliminar, inicioSugerido, hoy: h,
    wa: U.telefonoWA(c.telefono), errores: [], form: {},
  });
});

// ---------- Editar ----------
router.get('/clientes/:id(\\d+)/editar', (req, res) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!c) return res.redirect('/clientes');
  res.render('cliente-form', { title: 'Editar cliente', active: 'clientes', c, errores: [], modo: 'editar' });
});

router.post('/clientes/:id(\\d+)', (req, res) => {
  const actual = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!actual) return res.redirect('/clientes');
  const v = leerCliente(req.body);
  // El recepcionista NO puede cambiar la identidad (tipo de documento, cédula, nombres, apellidos):
  // se ignoran esos campos aunque alguien los envíe a mano.
  if (!res.locals.esAdmin) for (const k of ['tipo_documento', 'documento', 'nombres', 'apellidos']) v[k] = actual[k];
  const errores = validarCliente(v);
  if (!errores.length) {
    const dup = db.prepare('SELECT id FROM clientes WHERE documento = ? AND id != ?').get(v.documento, actual.id);
    if (dup) errores.push('Otro cliente ya usa ese documento.');
  }
  if (errores.length) return res.status(400).render('cliente-form', { title: 'Editar cliente', active: 'clientes', c: { ...v, id: actual.id }, errores, modo: 'editar' });

  db.prepare(`UPDATE clientes SET tipo_documento=@tipo_documento, documento=@documento, nombres=@nombres, apellidos=@apellidos,
    telefono=@telefono, email=@email, fecha_nacimiento=@fecha_nacimiento, genero=@genero, contacto_emergencia=@contacto_emergencia,
    telefono_emergencia=@telefono_emergencia, condiciones_medicas=@condiciones_medicas, notas=@notas, busqueda=@busqueda
    WHERE id=@id`).run({ ...v, busqueda: textoBusqueda(v), id: actual.id });
  const cambios = A.diferencias(actual, v, ETIQUETAS_CLIENTE);
  if (cambios) A.registrar(req.user, 'editar', 'cliente', actual.id, `Cliente editado: ${actual.apellidos} ${actual.nombres} (${Object.keys(cambios.antes).join(', ')})`, cambios);
  req.flash('ok', 'Datos actualizados.');
  res.redirect(`/clientes/${actual.id}`);
});

// Desactivar (no se borra: se conserva el historial de pagos)
router.post('/clientes/:id(\\d+)/desactivar', soloAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (c) {
    db.prepare('UPDATE clientes SET activo = 0 WHERE id = ?').run(c.id);
    A.registrar(req.user, 'desactivar', 'cliente', c.id, `Cliente desactivado: ${c.apellidos} ${c.nombres} (${c.documento})`);
  }
  req.flash('ok', 'Cliente desactivado. Su historial se conserva.');
  res.redirect('/clientes');
});

// Eliminar de verdad: SOLO administrador y SOLO si nunca tuvo pagos (p. ej. un duplicado por error).
router.post('/clientes/:id(\\d+)/eliminar', soloAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!c) return res.redirect('/clientes');
  const tienePagos = db.prepare('SELECT COUNT(*) n FROM pagos WHERE cliente_id = ?').get(c.id).n > 0;
  if (tienePagos) { req.flash('error', 'Este cliente tiene pagos registrados: solo se puede desactivar, no eliminar.'); return res.redirect(`/clientes/${c.id}`); }
  db.transaction(() => {
    db.prepare('DELETE FROM avisos WHERE cliente_id = ?').run(c.id);
    db.prepare('DELETE FROM membresias WHERE cliente_id = ?').run(c.id);
    db.prepare('DELETE FROM clientes WHERE id = ?').run(c.id);
    A.registrar(req.user, 'eliminar', 'cliente', c.id, `Cliente eliminado (sin pagos): ${c.apellidos} ${c.nombres} (${c.documento})`,
      { antes: { Documento: c.documento, Nombres: c.nombres, Apellidos: c.apellidos, 'Teléfono': c.telefono || '—' } });
  })();
  if (c.foto) comp.borrar(c.foto, comp.FOTOS_DIR);
  req.flash('ok', 'Cliente eliminado.');
  res.redirect('/clientes');
});

// ---------- Foto del cliente (cualquier rol) ----------
const subirFoto = multer({ storage: multer.memoryStorage(), limits: { fileSize: comp.MAX_BYTES, files: 1 } }).single('foto');
router.post('/clientes/:id(\\d+)/foto', (req, res, next) => subirFoto(req, res, (err) => { req.errorSubida = err ? 'No se pudo recibir la foto (máx. 10 MB).' : null; next(); }), (req, res) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!c) return res.redirect('/clientes');
  if (req.errorSubida || !req.file) { req.flash('error', req.errorSubida || 'Selecciona o toma una foto.'); return res.redirect(`/clientes/${c.id}`); }
  let g;
  try { g = comp.guardar(req.file, { base: comp.FOTOS_DIR, soloImagenes: true }); } catch (e) { req.flash('error', e.message); return res.redirect(`/clientes/${c.id}`); }
  try { db.prepare('UPDATE clientes SET foto = ? WHERE id = ?').run(g.archivo, c.id); } catch (e) { comp.borrar(g.archivo, comp.FOTOS_DIR); throw e; }
  if (c.foto) comp.borrar(c.foto, comp.FOTOS_DIR);
  A.registrar(req.user, 'foto', 'cliente', c.id, `Foto ${c.foto ? 'cambiada' : 'agregada'}: ${c.apellidos} ${c.nombres}`);
  req.flash('ok', 'Foto guardada.');
  res.redirect(`/clientes/${c.id}`);
});
router.post('/clientes/:id(\\d+)/foto/eliminar', (req, res) => {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!c) return res.redirect('/clientes');
  if (c.foto) {
    db.prepare('UPDATE clientes SET foto = NULL WHERE id = ?').run(c.id);
    comp.borrar(c.foto, comp.FOTOS_DIR);
    A.registrar(req.user, 'foto', 'cliente', c.id, `Foto eliminada: ${c.apellidos} ${c.nombres}`);
    req.flash('ok', 'Foto eliminada.');
  }
  res.redirect(`/clientes/${c.id}`);
});
router.get('/fotos/:id(\\d+)', (req, res) => {
  const c = db.prepare('SELECT foto FROM clientes WHERE id = ?').get(req.params.id);
  const abs = c && c.foto && comp.rutaAbsoluta(c.foto, comp.FOTOS_DIR);
  if (!abs) return res.status(404).send('Sin foto');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.sendFile(abs, (err) => { if (err && !res.headersSent) res.status(404).send('Sin foto'); });
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

module.exports = router;
