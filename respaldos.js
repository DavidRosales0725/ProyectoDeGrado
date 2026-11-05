const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { handle } = require('./autorizacion');
const { fechaLocalBogota } = require('./fechas');

const MAX_AUTOMATICOS = 7;
const TABLAS_REQUERIDAS = ['productos', 'ventas', 'venta_items', 'movimientos_inventario', 'usuarios'];

function partesBogota(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone:'America/Bogota', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(ahora);
  return Object.fromEntries(partes.map(({type,value})=>[type,value]));
}

function nombreRespaldoManual(ahora = new Date()) {
  const p=partesBogota(ahora);
  return `tienda-respaldo-${fechaLocalBogota(ahora).replaceAll('-', '')}-${p.hour}${p.minute}.db`;
}

function nombreRespaldoAntes(ahora = new Date()) {
  const p=partesBogota(ahora);
  return `antes-de-restaurar-${fechaLocalBogota(ahora)}-${p.hour}${p.minute}${String(ahora.getSeconds()).padStart(2,'0')}.db`;
}

function vacuumInto(db,destino) {
  const absoluto=path.resolve(destino);
  if (fs.existsSync(absoluto)) throw new Error('El archivo de respaldo de destino ya existe');
  fs.mkdirSync(path.dirname(absoluto),{recursive:true});
  const literal=absoluto.replace(/'/g,"''");
  db.exec(`VACUUM INTO '${literal}'`);
  return {ruta:absoluto,tamano:fs.statSync(absoluto).size};
}

function validarArchivoRespaldo(archivo,ClaseDatabase=DatabaseSync) {
  let db;
  try {
    if (!fs.statSync(archivo).isFile()) throw new Error('El respaldo seleccionado no es un archivo');
    db=new ClaseDatabase(archivo,{readOnly:true});
    const integridad=db.prepare('PRAGMA integrity_check').all();
    if (integridad.length !== 1 || Object.values(integridad[0])[0] !== 'ok') {
      throw new Error('La base de datos del respaldo no pasó la comprobación de integridad');
    }
    const tablas=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(fila=>fila.name));
    const faltantes=TABLAS_REQUERIDAS.filter(tabla=>!tablas.has(tabla));
    if (faltantes.length) throw new Error(`El respaldo no contiene las tablas requeridas: ${faltantes.join(', ')}`);
    const admin=db.prepare("SELECT 1 AS ok FROM usuarios WHERE rol='administrador' AND activo=1 LIMIT 1").get();
    if (!admin) throw new Error('El respaldo no contiene un administrador activo');
    return {valido:true,tamano:fs.statSync(archivo).size};
  } catch (error) {
    if (/no pasó|no contiene|no es un archivo/.test(error.message)) throw error;
    throw new Error('El archivo seleccionado no es una base SQLite válida o está dañado');
  } finally { db?.close(); }
}

function listarAutomaticos(directorio) {
  if (!fs.existsSync(directorio)) return [];
  return fs.readdirSync(directorio)
    .filter(nombre=>/^auto-\d{4}-\d{2}-\d{2}\.db$/.test(nombre))
    .map(nombre=>({nombre,fecha:nombre.slice(5,15),ruta:path.join(directorio,nombre),tamano:fs.statSync(path.join(directorio,nombre)).size}))
    .sort((a,b)=>b.fecha.localeCompare(a.fecha));
}

function rotarAutomaticos(directorio,maximo=MAX_AUTOMATICOS) {
  const archivos=listarAutomaticos(directorio);
  for(const viejo of archivos.slice(maximo)) fs.unlinkSync(viejo.ruta);
  return archivos.slice(0,maximo);
}

function crearRespaldoAutomatico(db,userData,ahora=new Date()) {
  const directorio=path.join(userData,'respaldos');
  fs.mkdirSync(directorio,{recursive:true});
  const fecha=fechaLocalBogota(ahora);
  const ruta=path.join(directorio,`auto-${fecha}.db`);
  if(!fs.existsSync(ruta)) vacuumInto(db,ruta);
  return {ruta,fecha,tamano:fs.statSync(ruta).size};
}

function registrarRespaldos(ipcMain,opciones) {
  const {db,app,dialog,shell,userData=app.getPath('userData'),ClaseDatabase=DatabaseSync}=opciones;
  const directorio=path.join(userData,'respaldos');
  const dbPath=path.join(userData,'tienda.db');

  handle(ipcMain,'respaldos:crear',['administrador'],async()=>{
    fs.mkdirSync(directorio,{recursive:true});
    const defaultPath=path.join(directorio,nombreRespaldoManual());
    const eleccion=await dialog.showSaveDialog({title:'Guardar respaldo de la tienda',defaultPath,filters:[{name:'Base de datos SQLite',extensions:['db']}]});
    if(eleccion.canceled||!eleccion.filePath) return null;
    const destino=path.resolve(eleccion.filePath);
    if(destino===path.resolve(dbPath)) throw new Error('No puedes reemplazar la base de datos activa con un respaldo');
    if(fs.existsSync(destino)) fs.unlinkSync(destino); // Electron ya pidió confirmación de sobrescritura.
    return vacuumInto(db,destino);
  });

  handle(ipcMain,'respaldos:restaurar',['administrador'],async()=>{
    const eleccion=await dialog.showOpenDialog({title:'Seleccionar respaldo para restaurar',properties:['openFile'],filters:[{name:'Base de datos SQLite',extensions:['db','sqlite','sqlite3']}]});
    if(eleccion.canceled||!eleccion.filePaths?.[0]) return null;
    const origen=path.resolve(eleccion.filePaths[0]);
    if(origen===path.resolve(dbPath)) throw new Error('El archivo seleccionado es la base de datos que ya está abierta');
    validarArchivoRespaldo(origen,ClaseDatabase);
    fs.mkdirSync(directorio,{recursive:true});
    let respaldoActual;
    let temporal;
    let cerrada=false;
    try {
      const respaldoNombre=nombreRespaldoAntes();
      respaldoActual=path.join(directorio,respaldoNombre);
      if(fs.existsSync(respaldoActual)) respaldoActual=path.join(directorio,`antes-de-restaurar-${Date.now()}.db`);
      vacuumInto(db,respaldoActual);
      db.close(); cerrada=true;
      temporal=path.join(userData,`.tienda-restaurar-${process.pid}-${Date.now()}.tmp`);
      fs.copyFileSync(origen,temporal,fs.constants.COPYFILE_EXCL);
      for(const sufijo of ['-wal','-shm']) { try { fs.unlinkSync(`${dbPath}${sufijo}`); } catch(error) { if(error.code!=='ENOENT') throw error; } }
      fs.renameSync(temporal,dbPath); temporal=null;
    } catch(error) {
      if(temporal) { try { fs.unlinkSync(temporal); } catch {} }
      if(cerrada&&respaldoActual&&fs.existsSync(respaldoActual)) {
        try { fs.copyFileSync(respaldoActual,dbPath); }
        catch(rollbackError) { throw new Error(`Falló la restauración y también la recuperación automática: ${rollbackError.message}. Respaldo disponible en ${respaldoActual}`); }
      }
      throw new Error(`No se pudo restaurar el respaldo: ${error.message}${respaldoActual?` Se conservó una copia en ${respaldoActual}`:''}`);
    }
    setTimeout(()=>{app.relaunch();app.exit(0);},100);
    return {restaurado:true};
  });

  handle(ipcMain,'respaldos:listarAutomaticos',['administrador'],()=>listarAutomaticos(directorio));
  handle(ipcMain,'respaldos:abrirCarpeta',['administrador'],async()=>{
    fs.mkdirSync(directorio,{recursive:true});
    const resultado=await shell.openPath(directorio);
    if(resultado) throw new Error(`No se pudo abrir la carpeta de respaldos: ${resultado}`);
    return true;
  });
}

function programarRespaldosAutomaticos({db,app}) {
  const userData=app.getPath('userData');
  const intentar=()=>{
    try { const r=crearRespaldoAutomatico(db,userData);rotarAutomaticos(path.join(userData,'respaldos'));return r; }
    catch(error) { console.warn('No se pudo crear el respaldo automático:',error.message);return null; }
  };
  intentar();
  return setInterval(intentar,24*60*60*1000);
}

module.exports={
  MAX_AUTOMATICOS,TABLAS_REQUERIDAS,nombreRespaldoManual,nombreRespaldoAntes,vacuumInto,
  validarArchivoRespaldo,listarAutomaticos,rotarAutomaticos,crearRespaldoAutomatico,
  registrarRespaldos,programarRespaldosAutomaticos,
};
