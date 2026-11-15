const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');

const { db, getConfig, DATA_DIR } = require('./lib/db');
const U = require('./lib/util');
const respaldo = require('./lib/respaldo');
const { ULTIMA } = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

// Secreto de sesión: se genera una vez y se guarda (no va en el código).
const secretFile = path.join(DATA_DIR, 'session.key');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8');

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');
app.use(expressLayouts);

app.use(express.static(path.join(__dirname, 'public'))); // Bootstrap, iconos, estilos y scripts
app.use(express.urlencoded({ extended: false, limit: '100kb' }));

app.use(session({
  name: 'gym.sid',
  secret: SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 }, // 12 h
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// CSRF: token por sesión. Se acepta en body (_csrf), query o cabecera.
// Los formularios con archivos lo envían en la URL porque el body multipart
// aún no está procesado cuando se verifica.
app.use((req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const t = req.body?._csrf || req.query._csrf || req.get('x-csrf-token');
  if (t && t.length === req.session.csrf.length &&
      crypto.timingSafeEqual(Buffer.from(t), Buffer.from(req.session.csrf))) return next();
  res.status(403).send('<meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;padding:3rem"><h3>Sesión expirada</h3><p>Recarga la página e inténtalo de nuevo.</p><a href="/">Volver al inicio</a>');
});

// Variables disponibles en todas las vistas
app.use((req, res, next) => {
  const cfg = getConfig();
  const diasAlerta = parseInt(cfg.dias_alerta, 10) || 3;
  res.locals.cfg = cfg;
  res.locals.diasAlerta = diasAlerta;
  res.locals.U = U;
  res.locals.user = null;
  res.locals.esAdmin = false;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.title = '';
  res.locals.active = '';
  res.locals.badgeAlertas = 0;
  if (req.session.user) {
    const h = U.hoy();
    res.locals.badgeAlertas = db.prepare(`
      SELECT COUNT(*) n FROM clientes c JOIN membresias m ON ${ULTIMA}
      WHERE c.activo=1 AND m.fecha_fin BETWEEN ? AND ?`).get(h, U.sumarDias(h, diasAlerta)).n;
  }
  req.flash = (tipo, texto) => { req.session.flash = { tipo, texto }; };
  next();
});

app.use(require('./routes/auth'));

// Puerta de entrada: en CADA petición se vuelve a leer el usuario de la base de datos.
// Así, si el dueño desactiva a un recepcionista o cambia un rol, el cambio rige de inmediato.
app.use((req, res, next) => {
  const id = req.session.user?.id;
  if (!id) return res.redirect('/login');
  const u = db.prepare('SELECT id, usuario, nombre, rol, activo, cambiar_clave FROM usuarios WHERE id = ?').get(id);
  if (!u || !u.activo) return req.session.destroy(() => res.redirect('/login'));
  req.user = { ...u };
  res.locals.user = req.user;
  res.locals.esAdmin = u.rol === 'admin';
  // Clave temporal: hasta que la cambie solo puede usar "Mi cuenta"
  if (u.cambiar_clave && !['/cuenta', '/cuenta/clave', '/logout'].includes(req.path)) return res.redirect('/cuenta');
  next();
});

app.use(require('./routes/dashboard'));
app.use(require('./routes/clientes'));
app.use(require('./routes/pagos'));
app.use(require('./routes/alertas'));
app.use(require('./routes/usuarios'));
app.use(require('./routes/admin'));

app.use((req, res) => res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'La página que buscas no existe.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  res.status(500).render('error', { layout: 'layout-auth', titulo: 'Error', mensaje: 'Ocurrió un error inesperado. Revisa la consola del servidor.' });
});

respaldo.programar();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nSistema de gimnasio activo`);
  console.log(`  En esta laptop:  http://localhost:${PORT}`);
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) if (i.family === 'IPv4' && !i.internal) console.log(`  Desde el celular (misma WiFi): http://${i.address}:${PORT}`);
  }
});
