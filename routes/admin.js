const os = require('os');
const path = require('path');
const express = require('express');
const { db, setConfig, BACKUP_DIR } = require('../lib/db');
const U = require('../lib/util');
const respaldo = require('../lib/respaldo');
const A = require('../lib/auditoria');
const { soloAdmin } = require('../lib/permisos');

const router = express.Router();
// Todo lo de este archivo es solo para el administrador
router.use(['/planes', '/configuracion', '/respaldos', '/bitacora'], soloAdmin);

// ---------- Planes ----------
router.get('/planes', (req, res) => {
  const planes = db.prepare('SELECT * FROM planes ORDER BY activo DESC, duracion_dias').all();
  res.render('planes', { title: 'Planes', active: 'planes', planes });
});
router.post('/planes', (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const dias = parseInt(req.body.duracion_dias, 10);
  const precio = U.aCentavos(req.body.precio);
  if (!nombre || !(dias > 0 && dias <= 1000) || precio === null) {
    req.flash('error', 'Completa nombre, duración (1-1000 días) y precio válido.');
  } else if (req.body.id) {
    const id = parseInt(req.body.id, 10);
    const antes = db.prepare('SELECT * FROM planes WHERE id = ?').get(id);
    db.prepare('UPDATE planes SET nombre=?, duracion_dias=?, precio_centavos=? WHERE id=?').run(nombre, dias, precio, id);
    const cambios = antes && A.diferencias(
      { Nombre: antes.nombre, 'Duración': antes.duracion_dias + ' días', Precio: U.dinero(antes.precio_centavos) },
      { Nombre: nombre, 'Duración': dias + ' días', Precio: U.dinero(precio) },
      { Nombre: 'Nombre', 'Duración': 'Duración', Precio: 'Precio' });
    if (cambios) A.registrar(req.user, 'editar', 'plan', id, `Plan editado: ${antes.nombre}`, cambios);
    req.flash('ok', 'Plan actualizado. Los pagos anteriores no cambian.');
  } else {
    const info = db.prepare('INSERT INTO planes (nombre, duracion_dias, precio_centavos) VALUES (?,?,?)').run(nombre, dias, precio);
    A.registrar(req.user, 'crear', 'plan', info.lastInsertRowid, `Plan creado: ${nombre} (${dias} días, ${U.dinero(precio)})`);
    req.flash('ok', 'Plan creado.');
  }
  res.redirect('/planes');
});
router.post('/planes/:id(\\d+)/activo', (req, res) => {
  const pl = db.prepare('SELECT * FROM planes WHERE id = ?').get(req.params.id);
  if (pl) {
    db.prepare('UPDATE planes SET activo = 1 - activo WHERE id = ?').run(pl.id);
    A.registrar(req.user, pl.activo ? 'ocultar' : 'activar', 'plan', pl.id, `Plan ${pl.activo ? 'ocultado' : 'activado'}: ${pl.nombre}`);
  }
  res.redirect('/planes');
});

// ---------- Configuración ----------
router.get('/configuracion', (req, res) => {
  const redes = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) redes.push(`http://${i.address}:${process.env.PORT || 3000}`);
  }
  res.render('configuracion', { title: 'Configuración', active: 'config', redes, respaldos: respaldo.listar() });
});
router.post('/configuracion', (req, res) => {
  const nombre = String(req.body.nombre_gimnasio || '').trim().slice(0, 80);
  const dias = parseInt(req.body.dias_alerta, 10);
  if (!nombre || !(dias >= 1 && dias <= 15)) req.flash('error', 'Nombre requerido y días de alerta entre 1 y 15.');
  else {
    const antes = { 'Nombre del gimnasio': res.locals.cfg.nombre_gimnasio, 'Días de alerta': res.locals.cfg.dias_alerta };
    setConfig('nombre_gimnasio', nombre); setConfig('dias_alerta', dias);
    const cambios = A.diferencias(antes, { 'Nombre del gimnasio': nombre, 'Días de alerta': String(dias) }, { 'Nombre del gimnasio': 'Nombre del gimnasio', 'Días de alerta': 'Días de alerta' });
    if (cambios) A.registrar(req.user, 'editar', 'config', null, 'Configuración modificada', cambios);
    req.flash('ok', 'Configuración guardada.');
  }
  res.redirect('/configuracion');
});
// ---------- Respaldos ----------
router.post('/respaldos', async (req, res, next) => {
  try { await respaldo.respaldar('manual'); req.flash('ok', 'Respaldo creado.'); res.redirect('/configuracion'); } catch (e) { next(e); }
});
router.get('/respaldos/:nombre', (req, res) => {
  const nombre = path.basename(req.params.nombre);
  if (!/^gimnasio-[\d-]+-(auto|manual|premigracion-v\d+)\.db$/.test(nombre)) return res.status(404).send('No encontrado');
  res.download(path.join(BACKUP_DIR, nombre));
});

// ---------- Bitácora ----------
router.get('/bitacora', (req, res) => {
  const entidades = ['cliente', 'pago', 'usuario', 'plan', 'config'];
  const entidad = entidades.includes(req.query.entidad) ? req.query.entidad : '';
  const q = String(req.query.q || '').trim();
  const pagina = Math.max(1, parseInt(req.query.p, 10) || 1);
  const POR = 40;
  const where = []; const params = [];
  if (entidad) { where.push('entidad = ?'); params.push(entidad); }
  if (q) { where.push('(usuario LIKE ? OR resumen LIKE ? OR accion LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM auditoria ${w}`).get(...params).n;
  const filas = db.prepare(`SELECT * FROM auditoria ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, POR, (pagina - 1) * POR)
    .map((f) => ({ ...f, detalle: f.detalle ? JSON.parse(f.detalle) : null }));
  res.render('bitacora', { title: 'Bitácora', active: 'bitacora', filas, total, pagina, paginas: Math.max(1, Math.ceil(total / POR)), entidad, q });
});

module.exports = router;
