const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');

const router = express.Router();
const AUTH = { layout: 'layout-auth' };

// Freno simple a fuerza bruta: 5 intentos fallidos por IP cada 15 min.
const intentos = new Map();
function bloqueado(ip) {
  const r = intentos.get(ip);
  return r && r.n >= 5 && Date.now() - r.t < 15 * 60 * 1000;
}
function fallo(ip) {
  const r = intentos.get(ip);
  if (!r || Date.now() - r.t > 15 * 60 * 1000) intentos.set(ip, { n: 1, t: Date.now() });
  else r.n++;
}

const hayUsuarios = () => db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0;

// Los administradores NO se crean desde la web: los crea soporte técnico con `npm run crear-admin`.
router.get('/setup', (req, res) => res.redirect('/login'));

router.get('/login', (req, res) => {
  if (!hayUsuarios()) return res.render('sin-admin', AUTH);
  if (req.session.user) return res.redirect('/');
  res.render('login', { ...AUTH, error: null });
});
router.post('/login', (req, res) => {
  if (!hayUsuarios()) return res.redirect('/login');
  const ip = req.ip;
  if (bloqueado(ip)) return res.status(429).render('login', { ...AUTH, error: 'Demasiados intentos. Espera 15 minutos.' });
  const { usuario = '', clave = '' } = req.body;
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND activo = 1').get(usuario.toLowerCase().trim());
  // compareSync siempre se ejecuta para no revelar por tiempo si el usuario existe
  const ok = bcrypt.compareSync(clave, u ? u.hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!u || !ok) {
    fallo(ip);
    return res.status(401).render('login', { ...AUTH, error: 'Usuario o contraseña incorrectos.' });
  }
  intentos.delete(ip);
  req.session.regenerate(() => { // nueva sesión al entrar (evita fijación de sesión)
    req.session.user = { id: u.id };
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

module.exports = router;
