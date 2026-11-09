const { app, BrowserWindow, ipcMain, Menu, dialog, nativeImage, protocol, shell } = require("electron");
const path = require("path");
app.setPath('userData', path.join(app.getPath('appData'), 'proyecto'));
const imagenes = require('./imagenes-productos');

protocol.registerSchemesAsPrivileged([{
  scheme: 'producto-img',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
}]);

let db;

function crearVentana() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'TiendaApp',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile("index.html").catch(manejarErrorInicio);
}

function manejarErrorInicio(error) {
  const detalle = String(error?.message ?? error);
  try {
    dialog.showErrorBox('Error al iniciar TiendaApp', `No se pudo iniciar la aplicación: ${detalle}`);
  } catch (errorDialogo) {
    console.error('No se pudo mostrar el error de inicio:', errorDialogo);
  }
  app.exit(1);
}

app.whenReady().then(() => {
  db = require("./database");
  require("./sesion").registrarSesion(ipcMain, db);
  const procesarImagen = imagenes.crearProcesadorImagen(nativeImage);
  imagenes.registrarSelectorImagen(ipcMain, { dialog, procesarImagen });
  require("./productos")(ipcMain, db, { procesarImagen });
  protocol.handle('producto-img', request => {
    if (!require('./sesion').obtenerSesion()) return new Response('No autorizado', { status: 403 });
    let url;
    try { url = new URL(request.url); } catch { return new Response('Solicitud inválida', { status: 400 }); }
    const match = url.hostname === 'p' && /^\/([1-9]\d*)$/.exec(url.pathname);
    const id = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(id) || id <= 0) return new Response('No encontrado', { status: 404 });
    const imagen = db.prepare('SELECT mime, datos FROM producto_imagenes WHERE producto_id = ?').get(id);
    if (!imagen) return new Response('No encontrado', { status: 404 });
    return new Response(imagen.datos, { status: 200, headers: {
      'Content-Type': imagen.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    } });
  });
  require("./inventario")(ipcMain, db);
  require("./ventas")(ipcMain, db);
  require("./dashboard")(ipcMain, db);
  require("./reportes")(ipcMain, db);
  require("./usuarios")(ipcMain, db);
  require("./kardex")(ipcMain, db);
  const respaldos = require('./respaldos');
  respaldos.registrarRespaldos(ipcMain, { db, app, dialog, shell });
  respaldos.programarRespaldosAutomaticos({ db, app });
  app.setAppUserModelId('co.sena.tiendaapp');
  if (app.isPackaged) Menu.setApplicationMenu(null);
  crearVentana();
}).catch(manejarErrorInicio);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
