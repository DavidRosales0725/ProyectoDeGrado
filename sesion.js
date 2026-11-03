const crypto = require('node:crypto');
const { MAX_NOMBRE, validarTextoUnaLinea } = require('./limites');
const autorizacion = require('./autorizacion');

const ROLES = ['administrador', 'vendedor'];
const LONGITUD_HASH = 64;
const SAL_FALSA = Buffer.from('9a41b8c64d20f731a5b09cd3e2f64810', 'hex');
const HASH_FALSO = crypto.scryptSync('credencial-falsa-no-utilizable', SAL_FALSA, LONGITUD_HASH);
const intentosFallidos = new Map();
let usuarioActual = null;
let dbSesion = null;

function crearTablaUsuarios(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      usuario TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('administrador','vendedor')),
      activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
      creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

function migrarVentasUsuario(db) {
  const existe = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='ventas'").get();
  if (!existe) return;
  const columnas = db.prepare('PRAGMA table_info(ventas)').all();
  if (!columnas.some(columna => columna.name === 'usuario_id')) {
    db.exec('ALTER TABLE ventas ADD COLUMN usuario_id INTEGER NULL REFERENCES usuarios(id)');
  }
}

function validarUsuario(valor) {
  const usuario = String(valor ?? '').toLowerCase();
  if (usuario.length < 3 || usuario.length > 30 || !/^[a-z0-9._-]+$/.test(usuario)) {
    throw new Error('El usuario debe tener entre 3 y 30 caracteres: letras minúsculas, números, punto, guion o guion bajo');
  }
  return usuario;
}

function validarNombre(valor) {
  const nombre = validarTextoUnaLinea(valor, 'El nombre', MAX_NOMBRE);
  if (!nombre) throw new Error('El nombre es obligatorio');
  return nombre;
}

function validarClave(clave, usuario) {
  if (typeof clave !== 'string' || clave.length < 8 || clave.length > 128) {
    throw new Error('La contraseña debe tener entre 8 y 128 caracteres');
  }
  if (clave.toLowerCase() === usuario.toLowerCase()) {
    throw new Error('La contraseña no puede ser igual al nombre de usuario');
  }
  return clave;
}

function crearHash(clave) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(clave, sal, LONGITUD_HASH);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

function verificarClave(clave, almacenado) {
  try {
    const [version, salHex, hashHex, sobrante] = String(almacenado ?? '').split('$');
    if (version !== 'scrypt' || !salHex || !hashHex || sobrante !== undefined) throw new Error('hash inválido');
    const sal = Buffer.from(salHex, 'hex');
    const hashEsperado = Buffer.from(hashHex, 'hex');
    if (sal.length !== 16 || hashEsperado.length !== LONGITUD_HASH || hashEsperado.toString('hex') !== hashHex) {
      throw new Error('hash inválido');
    }
    const calculado = crypto.scryptSync(String(clave), sal, LONGITUD_HASH);
    return crypto.timingSafeEqual(calculado, hashEsperado);
  } catch {
    const calculado = crypto.scryptSync(String(clave), SAL_FALSA, LONGITUD_HASH);
    crypto.timingSafeEqual(calculado, HASH_FALSO);
    return false;
  }
}

function obtenerSesion() {
  if (!usuarioActual) return null;
  const registro = dbSesion?.prepare(`
    SELECT id, nombre, usuario, rol, activo FROM usuarios WHERE id = ?
  `).get(usuarioActual.id);
  if (!registro || Number(registro.activo) !== 1) {
    usuarioActual = null;
    return null;
  }
  usuarioActual = { id: Number(registro.id), nombre: registro.nombre, usuario: registro.usuario, rol: registro.rol };
  return { ...usuarioActual };
}

function insertarUsuario(db, datos) {
  const nombre = validarNombre(datos?.nombre);
  const usuario = validarUsuario(datos?.usuario);
  const password = validarClave(datos?.password, usuario);
  const rol = datos?.rol;
  if (!ROLES.includes(rol)) throw new Error('Selecciona un rol válido');
  try {
    const resultado = db.prepare(`
      INSERT INTO usuarios (nombre, usuario, password_hash, rol, activo)
      VALUES (?, ?, ?, ?, 1)
    `).run(nombre, usuario, crearHash(password), rol);
    return { id: Number(resultado.lastInsertRowid), nombre, usuario, rol };
  } catch (error) {
    if (/UNIQUE constraint failed: usuarios\.usuario/i.test(String(error?.message ?? error))) {
      throw new Error('Ese nombre de usuario ya está registrado');
    }
    throw error;
  }
}

function registrarSesion(ipcMain, db) {
  dbSesion = db;
  usuarioActual = null;
  intentosFallidos.clear();
  crearTablaUsuarios(db);
  migrarVentasUsuario(db);

  autorizacion.handlePublic(ipcMain, 'auth:hayUsuarios', () =>
    Number(db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n) > 0);

  autorizacion.handlePublic(ipcMain, 'auth:crearPrimerAdmin', (_, datos) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (Number(db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n) !== 0) {
        throw new Error('El administrador inicial ya fue creado');
      }
      const admin = insertarUsuario(db, { ...datos, rol: 'administrador' });
      db.exec('COMMIT');
      return admin;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });

  autorizacion.handlePublic(ipcMain, 'auth:login', (_, datos) => {
    let usuario;
    try { usuario = validarUsuario(datos?.usuario); }
    catch { usuario = String(datos?.usuario ?? '').toLowerCase(); }
    const ahora = Date.now();
    const bloqueo = intentosFallidos.get(usuario);
    if (bloqueo?.hasta > ahora) {
      const segundos = Math.ceil((bloqueo.hasta - ahora) / 1000);
      throw new Error(`Demasiados intentos fallidos. Intenta de nuevo en ${segundos} segundos`);
    }
    if (bloqueo?.hasta && bloqueo.hasta <= ahora) intentosFallidos.delete(usuario);

    const clave = typeof datos?.password === 'string' ? datos.password : '';
    const registro = db.prepare(`
      SELECT id, nombre, usuario, password_hash AS passwordHash, rol, activo
      FROM usuarios WHERE usuario = ? COLLATE NOCASE
    `).get(usuario);
    const coincide = verificarClave(clave, registro?.passwordHash ?? null);
    if (!registro || !coincide || Number(registro.activo) !== 1) {
      const nuevo = (intentosFallidos.get(usuario)?.cantidad ?? 0) + 1;
      intentosFallidos.set(usuario, { cantidad: nuevo, hasta: nuevo >= 5 ? ahora + 60000 : 0 });
      throw new Error('Usuario o contraseña incorrectos');
    }
    intentosFallidos.delete(usuario);
    usuarioActual = { id: Number(registro.id), nombre: registro.nombre, usuario: registro.usuario, rol: registro.rol };
    return obtenerSesion();
  });

  autorizacion.handle(ipcMain, 'auth:actual', ['administrador', 'vendedor'], () => obtenerSesion());
  autorizacion.handle(ipcMain, 'auth:logout', ['administrador', 'vendedor'], () => {
    usuarioActual = null;
    return true;
  });
  autorizacion.handle(ipcMain, 'auth:cambiarMiClave', ['administrador', 'vendedor'], (_, sesion, datos) => {
    const actual = db.prepare('SELECT password_hash AS passwordHash FROM usuarios WHERE id = ? AND activo = 1').get(sesion.id);
    if (!actual || !verificarClave(String(datos?.claveActual ?? ''), actual.passwordHash)) {
      throw new Error('La contraseña actual es incorrecta');
    }
    const nueva = validarClave(datos?.nuevaClave, sesion.usuario);
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(crearHash(nueva), sesion.id);
    return true;
  });
}

module.exports = {
  registrarSesion,
  crearTablaUsuarios,
  migrarVentasUsuario,
  crearHash,
  verificarClave,
  validarUsuario,
  validarNombre,
  validarClave,
  obtenerSesion,
};
