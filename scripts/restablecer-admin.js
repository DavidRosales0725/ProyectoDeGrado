#!/usr/bin/env node
// Esta herramienta funciona con la app cerrada: quien puede leer/escribir la base de datos ya tiene control del equipo.
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { crearHash, validarUsuario, validarClave } = require('../sesion');
const paquete = require('../package.json');

function obtenerRutaDb() {
  if (process.env.TIENDA_DB_PATH) return path.resolve(process.env.TIENDA_DB_PATH);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), paquete.name, 'tienda.db');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', paquete.name, 'tienda.db');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), paquete.name, 'tienda.db');
}

const [usuarioEntrada, claveEntrada, ...resto] = process.argv.slice(2);
if (!usuarioEntrada || !claveEntrada || resto.length) {
  console.error('Uso: node scripts/restablecer-admin.js <usuario> <nuevaClave>');
  process.exit(1);
}

let db;
try {
  const usuario = validarUsuario(usuarioEntrada);
  const password = validarClave(claveEntrada, usuario);
  db = new DatabaseSync(obtenerRutaDb());
  const cuenta = db.prepare("SELECT id, rol FROM usuarios WHERE usuario = ? COLLATE NOCASE AND activo = 1").get(usuario);
  if (!cuenta || cuenta.rol !== 'administrador') {
    throw new Error('No se encontró un administrador activo con ese usuario');
  }
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(crearHash(password), cuenta.id);
  console.log(`Contraseña restablecida para el administrador "${usuario}".`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db?.close();
}
