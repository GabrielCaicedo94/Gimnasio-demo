// Utilidades para los comandos de soporte técnico (no se usan desde la web).
const readline = require('readline');

function crearInterfaz() { return readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY }); }

// Pregunta; si oculto=true no muestra lo que se escribe (contraseñas).
function preguntar(rl, texto, oculto = false) {
  return new Promise((resolve) => {
    if (!oculto) return rl.question(texto, resolve);
    process.stdout.write(texto);
    const original = rl._writeToOutput;
    rl._writeToOutput = (s) => { if (/[\r\n]/.test(s)) process.stdout.write('\n'); };
    rl.question('', (r) => { rl._writeToOutput = original; resolve(r); });
  });
}

// --usuario dueno --nombre "Nombre Apellido"
function argumentos() {
  const out = {}; const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) out[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  return out;
}
module.exports = { crearInterfaz, preguntar, argumentos };
