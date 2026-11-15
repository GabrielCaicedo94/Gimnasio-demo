// Utilidades puras (fechas, validaciones, formato). Sin dependencias.
const pad = (n) => String(n).padStart(2, '0');

// IMPORTANTE: nunca usar toISOString() para "hoy": devuelve fecha UTC y en
// Ecuador (UTC-5) después de las 19:00 ya sería "mañana".
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hoy = () => fmt(new Date());
const ahora = () => {
  const d = new Date();
  return `${fmt(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function esFecha(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
const parse = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const sumarDias = (s, n) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
};
const diasEntre = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const inicioMes = (s = hoy()) => s.slice(0, 8) + '01';

// dd/mm/aaaa para mostrar
const verFecha = (s) => (s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—');

// Dinero: se guarda en centavos (entero). Nunca float.
function aCentavos(txt) {
  const t = String(txt ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}
const dinero = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dineroInput = (c) => (c / 100).toFixed(2);

// Cédula ecuatoriana (módulo 10)
function cedulaValida(c) {
  if (!/^\d{10}$/.test(c)) return false;
  const prov = +c.slice(0, 2);
  if (prov < 1 || (prov > 24 && prov !== 30)) return false;
  if (+c[2] > 5) return false;
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let v = +c[i] * (i % 2 === 0 ? 2 : 1);
    if (v > 9) v -= 9;
    suma += v;
  }
  return (10 - (suma % 10)) % 10 === +c[9];
}

// Texto normalizado para búsqueda: minúsculas, sin tildes ("José" = "jose")
const normalizar = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// 0991234567 -> 593991234567 (formato wa.me). null si no parece válido.
function telefonoWA(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (/^0\d{9}$/.test(d)) return '593' + d.slice(1);
  if (/^593\d{9}$/.test(d)) return d;
  return null;
}

const plural = (n) => (n === 1 ? '1 día' : `${n} días`);

// Estado de una membresía según su fecha de fin
function estado(fin, hoyStr, diasAlerta) {
  if (!fin) return { k: 'sin', texto: 'Sin membresía', color: 'secondary' };
  const d = diasEntre(hoyStr, fin);
  if (d < 0) return { k: 'vencido', texto: `Vencida hace ${plural(-d)}`, color: 'danger' };
  if (d === 0) return { k: 'hoy', texto: 'Vence hoy', color: 'warning' };
  if (d <= diasAlerta) return { k: 'por_vencer', texto: `Vence en ${plural(d)}`, color: 'warning' };
  return { k: 'vigente', texto: 'Vigente', color: 'success' };
}

module.exports = {
  hoy, ahora, esFecha, sumarDias, diasEntre, inicioMes, verFecha,
  aCentavos, dinero, dineroInput, cedulaValida, normalizar, telefonoWA, estado, plural,
};
