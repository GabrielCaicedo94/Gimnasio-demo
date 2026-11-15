// Crea un ADMINISTRADOR. Solo soporte técnico, ejecutando en la laptop del gimnasio:
//   npm run crear-admin
//   npm run crear-admin -- --usuario dueno --nombre "María Pérez"
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const A = require('../lib/auditoria');
const { ahora } = require('../lib/util');
const { crearInterfaz, preguntar, argumentos } = require('./_util');

(async () => {
  const rl = crearInterfaz();
  const args = argumentos();
  try {
    console.log('\n=== Crear administrador ===');
    const usuario = String(args.usuario || await preguntar(rl, 'Usuario (3-30 letras/números . _ -): ')).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) throw new Error('Usuario inválido.');
    if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(usuario)) throw new Error(`El usuario "${usuario}" ya existe. Para cambiar su clave usa: npm run reset-clave`);
    const nombre = String(args.nombre || await preguntar(rl, 'Nombre completo: ')).trim().slice(0, 80);
    if (!nombre) throw new Error('El nombre es obligatorio.');
    const clave = process.env.GYM_CLAVE || await preguntar(rl, 'Contraseña (mín. 8, no se muestra): ', true);
    if (clave.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
    if (!process.env.GYM_CLAVE) {
      const repite = await preguntar(rl, 'Repite la contraseña: ', true);
      if (repite !== clave) throw new Error('Las contraseñas no coinciden.');
    }
    const info = db.prepare('INSERT INTO usuarios (usuario, nombre, hash, rol, creado_en) VALUES (?,?,?,?,?)')
      .run(usuario, nombre, bcrypt.hashSync(clave, 10), 'admin', ahora());
    A.registrar(null, 'crear', 'usuario', info.lastInsertRowid, `Administrador creado por soporte técnico: ${nombre} (${usuario})`);
    console.log(`\n✔ Administrador "${usuario}" creado. Ya puede entrar en el sistema.\n`);
  } catch (e) {
    console.error(`\n✘ ${e.message}\n`);
    process.exitCode = 1;
  } finally { rl.close(); }
})();
