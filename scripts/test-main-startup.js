const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const mainPath = require.resolve('../main');

async function probarFalloInicio(escenario, detalleEsperado) {
  const erroresMostrados = [];
  const salidas = [];
  const app = {
    whenReady: () => escenario.falloReady
      ? Promise.reject(new Error(escenario.falloReady))
      : Promise.resolve(),
    exit: codigo => salidas.push(codigo),
    on() {},
  };
  const electron = {
    app,
    BrowserWindow: class {
      constructor() {}
      loadFile() {
        return escenario.falloCarga
          ? Promise.reject(new Error(escenario.falloCarga))
          : Promise.resolve();
      }
    },
    ipcMain: {},
    dialog: { showErrorBox: (titulo, mensaje) => erroresMostrados.push({ titulo, mensaje }) },
    nativeImage: {},
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    shell: {},
  };

  const cargarOriginal = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === mainPath) {
      if (request === 'electron') return electron;
      if (request === './database') {
        if (escenario.falloDatabase) throw new Error(escenario.falloDatabase);
        return {};
      }
      if (request === './imagenes-productos') {
        return { crearProcesadorImagen: () => () => {}, registrarSelectorImagen() {} };
      }
      if (request === './sesion') return { registrarSesion() {}, obtenerSesion: () => null };
      if (request === './respaldos') return { registrarRespaldos() {}, programarRespaldosAutomaticos() {} };
      if (['./productos', './inventario', './ventas', './dashboard', './reportes', './usuarios', './kardex'].includes(request)) {
        return () => {};
      }
    }
    return cargarOriginal.call(this, request, parent, isMain);
  };

  delete require.cache[mainPath];
  try {
    require(mainPath);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(erroresMostrados.length, 1);
    assert.match(erroresMostrados[0].mensaje, new RegExp(`^No se pudo iniciar la aplicación: ${detalleEsperado}$`));
    assert.deepEqual(salidas, [1]);
  } finally {
    Module._load = cargarOriginal;
    delete require.cache[mainPath];
  }
}

(async () => {
  await probarFalloInicio({ falloDatabase:'falló la migración' }, 'falló la migración');
  console.log('✅ fallo de base de datos/migración muestra diálogo en español y cierra con código 1');
  await probarFalloInicio({ falloReady:'falló whenReady' }, 'falló whenReady');
  console.log('✅ rechazo de app.whenReady muestra diálogo y cierra con código 1');
  await probarFalloInicio({ falloCarga:'falló index.html' }, 'falló index.html');
  console.log('✅ rechazo de BrowserWindow.loadFile muestra diálogo y cierra con código 1');
  console.log('Todas las pruebas de arranque pasaron.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
