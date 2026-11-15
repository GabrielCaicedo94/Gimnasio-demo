const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const U = require('../lib/util');
const { soloAdmin } = require('../lib/permisos');
const A = require('../lib/auditoria');

const router = express.Router();
const validarUsuario = (u) => /^[a-z0-9._-]{3,30}$/i.test(u);

// ---------- Mi cuenta (cualquier rol): cambiar la propia contraseña ----------
router.get('/cuenta', (req, res) =>
  res.render('cuenta', { title: 'Mi cuenta', active: 'cuenta', obligatorio: !!req.user.cambiar_clave }));

router.post('/cuenta/clave', (req, res) => {
  const { actual = '', nueva = '', nueva2 = '' } = req.body;
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(actual, u.hash)) req.flash('error', 'La contraseña actual es incorrecta.');
  else if (nueva.length < 8) req.flash('error', 'La nueva contraseña debe tener al menos 8 caracteres.');
  else if (nueva !== nueva2) req.flash('error', 'Las contraseñas nuevas no coinciden.');
  else if (nueva === actual) req.flash('error', 'La nueva contraseña debe ser distinta a la actual.');
  else {
    db.prepare('UPDATE usuarios SET hash = ?, cambiar_clave = 0 WHERE id = ?').run(bcrypt.hashSync(nueva, 10), u.id);
    A.registrar(req.user, 'cambiar clave', 'usuario', u.id, `${u.usuario} cambió su propia contraseña`);
    req.flash('ok', 'Contraseña cambiada.');
    return res.redirect('/');
  }
  res.redirect('/cuenta');
});

// ---------- Gestión de recepcionistas (solo administrador) ----------
router.get('/usuarios', soloAdmin, (req, res) => {
  const usuarios = db.prepare('SELECT id, usuario, nombre, rol, activo, cambiar_clave, creado_en FROM usuarios ORDER BY rol, nombre').all();
  res.render('usuarios', { title: 'Usuarios', active: 'usuarios', usuarios, v: {} });
});

router.post('/usuarios', soloAdmin, (req, res) => {
  const nombre = String(req.body.nombre || '').trim().slice(0, 80);
  const usuario = String(req.body.usuario || '').trim().toLowerCase();
  const clave = String(req.body.clave || '');
  let error = null;
  if (!nombre) error = 'El nombre es obligatorio.';
  else if (!validarUsuario(usuario)) error = 'Usuario de 3 a 30 caracteres (letras, números, punto, guion).';
  else if (clave.length < 8) error = 'La clave temporal debe tener al menos 8 caracteres.';
  else if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(usuario)) error = 'Ese usuario ya existe.';
  if (error) {
    const usuarios = db.prepare('SELECT id, usuario, nombre, rol, activo, cambiar_clave, creado_en FROM usuarios ORDER BY rol, nombre').all();
    res.locals.flash = { tipo: 'error', texto: error };
    return res.status(400).render('usuarios', { title: 'Usuarios', active: 'usuarios', usuarios, v: { nombre, usuario } });
  }
  // El rol siempre es "recepcion": los administradores solo los crea soporte técnico.
  const info = db.prepare('INSERT INTO usuarios (usuario, nombre, hash, rol, creado_en, cambiar_clave, creado_por) VALUES (?,?,?,?,?,1,?)')
    .run(usuario, nombre, bcrypt.hashSync(clave, 10), 'recepcion', U.ahora(), req.user.id);
  A.registrar(req.user, 'crear', 'usuario', info.lastInsertRowid, `Recepcionista creado: ${nombre} (${usuario})`);
  req.flash('ok', `Recepcionista creado. Entregue a ${nombre} el usuario y la clave temporal; deberá cambiarla al entrar.`);
  res.redirect('/usuarios');
});

// Solo se pueden modificar usuarios con rol "recepcion"
const recepcionista = (id) => db.prepare("SELECT * FROM usuarios WHERE id = ? AND rol = 'recepcion'").get(id);

router.post('/usuarios/:id(\\d+)/clave', soloAdmin, (req, res) => {
  const u = recepcionista(req.params.id);
  const clave = String(req.body.clave || '');
  if (!u) req.flash('error', 'Solo puedes restablecer la clave de recepcionistas.');
  else if (clave.length < 8) req.flash('error', 'La clave temporal debe tener al menos 8 caracteres.');
  else {
    db.prepare('UPDATE usuarios SET hash = ?, cambiar_clave = 1 WHERE id = ?').run(bcrypt.hashSync(clave, 10), u.id);
    A.registrar(req.user, 'restablecer clave', 'usuario', u.id, `Clave restablecida a ${u.nombre} (${u.usuario})`);
    req.flash('ok', `Clave temporal asignada a ${u.nombre}. Deberá cambiarla al entrar.`);
  }
  res.redirect('/usuarios');
});

router.post('/usuarios/:id(\\d+)/activo', soloAdmin, (req, res) => {
  const u = recepcionista(req.params.id);
  if (!u) req.flash('error', 'Solo puedes activar o desactivar recepcionistas.');
  else {
    const nuevo = u.activo ? 0 : 1;
    db.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').run(nuevo, u.id);
    A.registrar(req.user, nuevo ? 'activar' : 'desactivar', 'usuario', u.id, `${nuevo ? 'Activado' : 'Desactivado'}: ${u.nombre} (${u.usuario})`);
    req.flash('ok', nuevo ? `${u.nombre} puede entrar de nuevo.` : `${u.nombre} ya no puede entrar. Su historial se conserva.`);
  }
  res.redirect('/usuarios');
});

module.exports = router;
