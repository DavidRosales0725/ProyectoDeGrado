const { crearHash, validarNombre, validarUsuario, validarClave } = require('./sesion');
const { handle } = require('./autorizacion');

const SELECT_USUARIOS = `
  SELECT id, nombre, usuario, rol, activo, creado
  FROM usuarios
`;

function validarCambioRol(rol) {
  if (!['administrador', 'vendedor'].includes(rol)) throw new Error('Selecciona un rol válido');
  return rol;
}

function protegerUltimoAdmin(db, objetivo, rolNuevo, activoNuevo) {
  const registro = db.prepare('SELECT rol, activo FROM usuarios WHERE id = ?').get(objetivo);
  if (!registro) throw new Error('El usuario no existe');
  const pierdeAdmin = Number(registro.activo) === 1 && registro.rol === 'administrador'
    && (rolNuevo !== 'administrador' || activoNuevo !== 1);
  if (!pierdeAdmin) return;
  const activos = Number(db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE activo = 1 AND rol = 'administrador'").get().n);
  if (activos <= 1) throw new Error('Debe permanecer al menos un administrador activo');
}

function registrarUsuarios(ipcMain, db) {
  handle(ipcMain, 'usuarios:listar', ['administrador'], () =>
    db.prepare(`${SELECT_USUARIOS} ORDER BY nombre COLLATE NOCASE`).all());

  handle(ipcMain, 'usuarios:crear', ['administrador'], (_, sesion, datos) => {
    const nombre = validarNombre(datos?.nombre);
    const usuario = validarUsuario(datos?.usuario);
    const password = validarClave(datos?.password, usuario);
    const rol = validarCambioRol(datos?.rol);
    try {
      const creado = db.prepare(`
        INSERT INTO usuarios (nombre, usuario, password_hash, rol, activo)
        VALUES (?, ?, ?, ?, 1)
      `).run(nombre, usuario, crearHash(password), rol);
      return db.prepare(`${SELECT_USUARIOS} WHERE id = ?`).get(Number(creado.lastInsertRowid));
    } catch (error) {
      if (/UNIQUE constraint failed: usuarios\.usuario/i.test(String(error?.message ?? error))) {
        throw new Error('Ese nombre de usuario ya está registrado');
      }
      throw error;
    }
  });

  handle(ipcMain, 'usuarios:cambiarRol', ['administrador'], (_, sesion, id, rol) => {
    const usuarioId = Number(id);
    const nuevoRol = validarCambioRol(rol);
    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) throw new Error('Usuario inválido');
    if (usuarioId === sesion.id && nuevoRol !== 'administrador') {
      throw new Error('No puedes quitarte el rol de administrador');
    }
    protegerUltimoAdmin(db, usuarioId, nuevoRol, 1);
    db.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').run(nuevoRol, usuarioId);
    return db.prepare(`${SELECT_USUARIOS} WHERE id = ?`).get(usuarioId);
  });

  handle(ipcMain, 'usuarios:activar', ['administrador'], (_, sesion, id) => {
    const usuarioId = Number(id);
    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) throw new Error('Usuario inválido');
    const resultado = db.prepare('UPDATE usuarios SET activo = 1 WHERE id = ?').run(usuarioId);
    if (Number(resultado.changes) !== 1) throw new Error('El usuario no existe');
    return db.prepare(`${SELECT_USUARIOS} WHERE id = ?`).get(usuarioId);
  });

  handle(ipcMain, 'usuarios:desactivar', ['administrador'], (_, sesion, id) => {
    const usuarioId = Number(id);
    if (!Number.isSafeInteger(usuarioId) || usuarioId <= 0) throw new Error('Usuario inválido');
    if (usuarioId === sesion.id) throw new Error('No puedes desactivar tu propio usuario');
    protegerUltimoAdmin(db, usuarioId, 'vendedor', 0);
    const resultado = db.prepare('UPDATE usuarios SET activo = 0 WHERE id = ?').run(usuarioId);
    if (Number(resultado.changes) !== 1) throw new Error('El usuario no existe');
    return db.prepare(`${SELECT_USUARIOS} WHERE id = ?`).get(usuarioId);
  });

  handle(ipcMain, 'usuarios:restablecerClave', ['administrador'], (_, sesion, id, password) => {
    const usuarioId = Number(id);
    const usuario = db.prepare('SELECT usuario FROM usuarios WHERE id = ?').get(usuarioId);
    if (!usuario) throw new Error('El usuario no existe');
    const clave = validarClave(password, usuario.usuario);
    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(crearHash(clave), usuarioId);
    return true;
  });
}

module.exports = registrarUsuarios;
module.exports.protegerUltimoAdmin = protegerUltimoAdmin;
