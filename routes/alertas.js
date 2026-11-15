const express = require('express');
const { db } = require('../lib/db');
const U = require('../lib/util');
const { ULTIMA } = require('./dashboard');

const router = express.Router();

router.get('/alertas', (req, res) => {
  const h = U.hoy();
  const dias = res.locals.diasAlerta;
  const nombreGym = res.locals.cfg.nombre_gimnasio;

  const consulta = (desde, hasta, orden) => db.prepare(`
    SELECT c.id, c.nombres, c.apellidos, c.telefono, m.id AS membresia_id, m.fecha_fin, pl.nombre AS plan,
           (SELECT MAX(fecha) FROM avisos WHERE membresia_id = m.id) AS avisado
    FROM clientes c JOIN membresias m ON ${ULTIMA} JOIN planes pl ON pl.id = m.plan_id
    WHERE c.activo = 1 AND m.fecha_fin BETWEEN ? AND ?
    ORDER BY m.fecha_fin ${orden}, c.apellidos`).all(desde, hasta);

  const enriquecer = (lista) => lista.map((f) => {
    const d = U.diasEntre(h, f.fecha_fin);
    const cuando = d === 0 ? 'vence hoy' : d > 0 ? `vence el ${U.verFecha(f.fecha_fin)}` : `venció el ${U.verFecha(f.fecha_fin)}`;
    const msg = `Hola ${f.nombres}, te escribimos de ${nombreGym}. Tu membresía ${f.plan} ${cuando}. ¡Te esperamos para renovar! 💪`;
    const wa = U.telefonoWA(f.telefono);
    return { ...f, dias: d, wa: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` : null };
  });

  res.render('alertas', {
    title: 'Alertas', active: 'alertas',
    hoyLista: enriquecer(consulta(h, h, 'ASC')),
    proximos: enriquecer(consulta(U.sumarDias(h, 1), U.sumarDias(h, dias), 'ASC')),
    vencidos: enriquecer(consulta(U.sumarDias(h, -30), U.sumarDias(h, -1), 'DESC')),
    hoy: h,
  });
});

router.post('/alertas/avisar', (req, res) => {
  const m = db.prepare('SELECT id, cliente_id FROM membresias WHERE id = ?').get(parseInt(req.body.membresia_id, 10) || 0);
  if (m) {
    db.prepare('INSERT INTO avisos (cliente_id, membresia_id, canal, fecha, usuario_id) VALUES (?,?,?,?,?)')
      .run(m.cliente_id, m.id, 'whatsapp', U.hoy(), req.session.user.id);
  }
  res.redirect('/alertas');
});

module.exports = router;
