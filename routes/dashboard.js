const express = require('express');
const { db } = require('../lib/db');
const U = require('../lib/util');

const router = express.Router();

// Última membresía de cada cliente (la de fecha_fin más lejana)
// Los planes de 1 día ("pase diario") no cuentan como membresía: quien solo paga por día
// aparece como "sin membresía" y no genera alertas de vencimiento.
const ULTIMA = `m.id = (
  SELECT m2.id FROM membresias m2 JOIN planes p2 ON p2.id = m2.plan_id
  WHERE m2.cliente_id = c.id AND p2.duracion_dias > 1
    AND NOT EXISTS (SELECT 1 FROM pagos pg WHERE pg.membresia_id = m2.id AND pg.estado = 'anulado')  -- pago anulado = no cuenta
  ORDER BY m2.fecha_fin DESC, m2.id DESC LIMIT 1)`;

router.get('/', (req, res) => {
  const h = U.hoy();
  const limite = U.sumarDias(h, res.locals.diasAlerta);
  const conteo = (cond, ...p) =>
    db.prepare(`SELECT COUNT(*) n FROM clientes c LEFT JOIN membresias m ON ${ULTIMA} WHERE c.activo=1 AND ${cond}`).get(...p).n;

  const stats = {
    total: db.prepare('SELECT COUNT(*) n FROM clientes WHERE activo=1').get().n,
    activos: conteo('m.fecha_fin >= ?', h),   // membresía al día (incluye los que vencen pronto)
    hoy: conteo('m.fecha_fin = ?', h),
    porVencer: conteo('m.fecha_fin > ? AND m.fecha_fin <= ?', h, limite),
    vencidos: conteo('m.fecha_fin < ?', h),
    sin: conteo('m.id IS NULL'),
    pasesHoy: db.prepare(`
      SELECT COUNT(*) n FROM pagos p JOIN membresias m ON m.id = p.membresia_id JOIN planes pl ON pl.id = m.plan_id
      WHERE p.estado = 'valido' AND pl.duracion_dias = 1 AND p.fecha_pago = ?`).get(h).n,
    nuevosMes: db.prepare('SELECT COUNT(*) n FROM clientes WHERE activo=1 AND fecha_registro >= ?').get(U.inicioMes(h)).n,
    // Los ingresos solo se calculan para el administrador (el recepcionista no los ve).
    ingresosMes: res.locals.esAdmin
      ? db.prepare("SELECT COALESCE(SUM(monto_centavos),0) n FROM pagos WHERE estado = 'valido' AND fecha_pago >= ?").get(U.inicioMes(h)).n
      : null,
    sinComprobante: db.prepare(`
      SELECT COUNT(*) n FROM pagos p
      WHERE p.estado = 'valido' AND p.metodo != 'efectivo' AND p.fecha_pago >= ?
        AND NOT EXISTS (SELECT 1 FROM comprobantes WHERE pago_id = p.id)`).get(U.inicioMes(h)).n,
  };

  const proximos = db.prepare(`
    SELECT c.id, c.nombres, c.apellidos, c.telefono, m.fecha_fin, pl.nombre AS plan
    FROM clientes c JOIN membresias m ON ${ULTIMA} JOIN planes pl ON pl.id = m.plan_id
    WHERE c.activo=1 AND m.fecha_fin BETWEEN ? AND ?
    ORDER BY m.fecha_fin, c.apellidos LIMIT 8`).all(h, limite);

  const ultimosPagos = db.prepare(`
    SELECT p.*, c.nombres, c.apellidos,
           (SELECT COUNT(*) FROM comprobantes WHERE pago_id = p.id) AS n_comp
    FROM pagos p JOIN clientes c ON c.id = p.cliente_id
    WHERE p.estado = 'valido'
    ORDER BY p.id DESC LIMIT 6`).all();

  res.render('dashboard', { title: 'Inicio', active: 'inicio', stats, proximos, ultimosPagos, hoy: h });
});

module.exports = router;
module.exports.ULTIMA = ULTIMA;
