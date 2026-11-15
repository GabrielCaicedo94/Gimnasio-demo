// Restablece la contraseña de CUALQUIER usuario (útil cuando el dueño olvida la suya).
//   npm run reset-clave
//   npm run reset-clave -- --usuario dueno
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const A = require('../lib/auditoria');
const { crearInterfaz, preguntar, argumentos } = require('./_util');

(async () => {
  const rl = crearInterfaz();
  const args = argumentos();
  try {
    console.log('\n=== Restablecer contraseña ===');
    const lista = db.prepare('SELECT usuario, nombre, rol, activo FROM usuarios ORDER BY rol, usuario').all();
    if (!lista.length) throw new Error('No hay usuarios. Crea el primer administrador con: npm run crear-admin');
    if (!args.usuario) for (const u of lista) console.log(`  - ${u.usuario}  (${u.nombre}, ${u.rol}${u.activo ? '' : ', DESACTIVADO'})`);
    const usuario = String(args.usuario || await preguntar(rl, '\nUsuario: ')).trim().toLowerCase();
    const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario);
    if (!u) throw new Error(`No existe el usuario "${usuario}".`);
    const clave = process.env.GYM_CLAVE || await preguntar(rl, 'Nueva contraseña (mín. 8, no se muestra): ', true);
    if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (!process.env.GYM_CLAVE) {
      const repite = await preguntar(rl, 'Repite la contraseña: ', true);
      if (repite !== clave) throw new Error('Las contraseñas no coinciden.');
    }
    db.prepare('UPDATE usuarios SET hash = ?, cambiar_clave = 0 WHERE id = ?').run(bcrypt.hashSync(clave, 10), u.id);
    A.registrar(null, 'restablecer clave', 'usuario', u.id, `Clave restablecida por soporte técnico: ${u.nombre} (${u.usuario})`);
    console.log(`\n✔ Contraseña de "${usuario}" actualizada.${u.activo ? '' : '\n  Atención: el usuario está desactivado; el dueño debe activarlo desde Usuarios.'}\n`);
  } catch (e) {
    console.error(`\n✘ ${e.message}\n`);
    process.exitCode = 1;
  } finally { rl.close(); }
})();
