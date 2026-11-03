function handle(ipcMain, canal, roles = [], fn = () => {
  throw new Error('No hay una función registrada para este canal');
}) {
  ipcMain.handle(canal, (event, ...args) => {
    const sesion = require('./sesion').obtenerSesion();
    if (!sesion) throw new Error('Debes iniciar sesión');
    if (!Array.isArray(roles) || !roles.includes(sesion.rol)) {
      throw new Error('No tienes permiso para esta acción');
    }
    return fn(event, sesion, ...args);
  });
}

function handlePublic(ipcMain, canal, fn) {
  ipcMain.handle(canal, fn);
}

module.exports = { handle, handlePublic };
