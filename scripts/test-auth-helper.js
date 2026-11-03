const registrarSesion = require('../sesion').registrarSesion;

function autenticarAdminPrueba(ipcMain, handlers, db) {
  registrarSesion(ipcMain, db);
  const invocar = (canal, ...args) => {
    const handler = handlers.get(canal);
    if (!handler) throw new Error(`No se registró el canal ${canal}`);
    return handler({}, ...args);
  };
  if (!invocar('auth:hayUsuarios')) {
    invocar('auth:crearPrimerAdmin', {
      nombre: 'Admin de pruebas', usuario: 'admin.test', password: 'clave-segura-123',
    });
  }
  invocar('auth:login', { usuario: 'admin.test', password: 'clave-segura-123' });
  return invocar;
}

module.exports = { autenticarAdminPrueba };
