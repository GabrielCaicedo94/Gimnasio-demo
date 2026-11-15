// Permisos por rol. Se aplican en el SERVIDOR: ocultar un menú no es seguridad.
const soloAdmin = (req, res, next) => {
  if (req.user && req.user.rol === 'admin') return next();
  res.status(403).render('error', { titulo: 'Sin permiso', mensaje: 'Esta acción es solo para el administrador.' });
};
module.exports = { soloAdmin };
