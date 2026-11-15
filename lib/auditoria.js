// Bitácora: registra QUIÉN hizo QUÉ y CUÁNDO en las acciones sensibles.
const { db } = require('./db');
const { ahora } = require('./util');

// actor = req.user (o null cuando lo hace un comando de soporte técnico)
function registrar(actor, accion, entidad, entidadId, resumen, detalle = null) {
  db.prepare(`INSERT INTO auditoria (fecha_hora, usuario_id, usuario, accion, entidad, entidad_id, resumen, detalle)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(ahora(), actor?.id ?? null, actor?.usuario ?? 'soporte técnico', accion, entidad, entidadId ?? null,
      resumen ?? null, detalle ? JSON.stringify(detalle) : null);
}

// Devuelve { antes, despues } solo con los campos que cambiaron (o null si no cambió nada).
// etiquetas = { campo: 'Texto legible' }
function diferencias(antes, despues, etiquetas) {
  const a = {}, d = {};
  for (const [campo, etiqueta] of Object.entries(etiquetas)) {
    const x = antes[campo] ?? '', y = despues[campo] ?? '';
    if (String(x) !== String(y)) { a[etiqueta] = x === '' ? '—' : x; d[etiqueta] = y === '' ? '—' : y; }
  }
  return Object.keys(a).length ? { antes: a, despues: d } : null;
}

module.exports = { registrar, diferencias };
