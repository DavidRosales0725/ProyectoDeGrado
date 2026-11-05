// Pruebas manuales de Electron: diálogo de guardar y confirmar sobrescritura; diálogo de abrir;
// restaurar y relanzar la aplicación; iniciar sesión de nuevo; abrir la carpeta en el explorador.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const productos=require('../productos');
const ventas=require('../ventas');
const sesion=require('../sesion');
const kardex=require('../kardex');
const respaldos=require('../respaldos');

function crearBase(db,conAdmin=true){
  db.exec('PRAGMA foreign_keys=ON');
  productos.crearTablasProductos(db);sesion.crearTablaUsuarios(db);ventas.crearTablasVentas(db);kardex.asegurarEsquemaMovimientos(db);
  if(conAdmin)db.prepare("INSERT INTO usuarios(nombre,usuario,password_hash,rol,activo) VALUES('Admin','admin','hash','administrador',1)").run();
  db.prepare("INSERT INTO productos(nombre,categoria,precio,stock,stock_min,descripcion) VALUES('Arroz','Abarrotes',1500,4,1,'Paquete')").run();
  db.prepare("INSERT INTO producto_imagenes(producto_id,mime,datos,actualizado) VALUES(1,'image/jpeg',X'FFD8FFE0','2026-01-01T00:00:00.000Z')").run();
  return db;
}
function directorioTemporal(){return fs.mkdtempSync(path.join(os.tmpdir(),'tienda-respaldos-'));}
function conBaseTemporal(conAdmin,fn){const dir=directorioTemporal();const db=crearBase(new DatabaseSync(':memory:'),conAdmin);try{fn(dir,db)}finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}}

conBaseTemporal(true,(dir,db)=>{
  const destino=path.join(dir,'copia.db');
  const resultado=respaldos.vacuumInto(db,destino);
  assert.equal(resultado.ruta,destino);assert.ok(resultado.tamano>0);
  assert.equal(respaldos.validarArchivoRespaldo(destino).valido,true);
  const copia=new DatabaseSync(destino,{readOnly:true});
  try{assert.equal(copia.prepare('SELECT nombre FROM productos').get().nombre,'Arroz');assert.equal(copia.prepare("SELECT usuario FROM usuarios WHERE rol='administrador'").get().usuario,'admin');assert.deepEqual(Buffer.from(copia.prepare('SELECT datos FROM producto_imagenes WHERE producto_id=1').get().datos),Buffer.from('FFD8FFE0','hex'));}
  finally{copia.close()}
  console.log('✅ VACUUM INTO crea una copia íntegra, completa y validable');
});

conBaseTemporal(true,(dir,db)=>{
  db.exec('DROP TABLE producto_imagenes');
  const archivo=path.join(dir,'respaldo-antiguo.db');respaldos.vacuumInto(db,archivo);
  assert.equal(respaldos.validarArchivoRespaldo(archivo).valido,true);
  console.log('✅ acepta respaldos antiguos sin la tabla opcional de imágenes');
});

conBaseTemporal(false,(dir)=>{
  const archivo=path.join(dir,'no-sqlite.db');fs.writeFileSync(archivo,'esto no es una base SQLite');
  assert.throws(()=>respaldos.validarArchivoRespaldo(archivo),/base SQLite válida o está dañado/);
  console.log('✅ rechaza un archivo que no es SQLite');
});

conBaseTemporal(false,(dir)=>{
  const archivo=path.join(dir,'sin-tablas.db');const db=new DatabaseSync(archivo);db.exec('CREATE TABLE cualquiera(id INTEGER)');db.close();
  assert.throws(()=>respaldos.validarArchivoRespaldo(archivo),/tablas requeridas/);
  console.log('✅ rechaza SQLite sin las tablas requeridas');
});

conBaseTemporal(false,(dir)=>{
  const archivo=path.join(dir,'integridad.db');const db=crearBase(new DatabaseSync(archivo),true);
  db.exec("CREATE TABLE prueba(valor INTEGER CHECK(valor>0)); PRAGMA ignore_check_constraints=ON; INSERT INTO prueba VALUES(-1);");db.close();
  class DatabaseConIntegridadFallida extends DatabaseSync {
    prepare(sql){return /^PRAGMA integrity_check$/i.test(sql.trim())?{all:()=>[{integrity_check:'falló'}]}:super.prepare(sql)}
  }
  assert.throws(()=>respaldos.validarArchivoRespaldo(archivo,DatabaseConIntegridadFallida),/integridad/);
  console.log('✅ rechaza una base SQLite cuyo integrity_check falla');
});

conBaseTemporal(false,(dir,db)=>{
  const archivo=path.join(dir,'sin-admin.db');respaldos.vacuumInto(db,archivo);
  assert.throws(()=>respaldos.validarArchivoRespaldo(archivo),/administrador activo/);
  console.log('✅ rechaza una base sin administrador activo');
});

{
  const dir=directorioTemporal();
  try{
    for(let dia=1;dia<=10;dia++)fs.writeFileSync(path.join(dir,`auto-2026-01-${String(dia).padStart(2,'0')}.db`),'db');
    fs.writeFileSync(path.join(dir,'tienda-respaldo-20260110-1000.db'),'guardar');
    const conservados=respaldos.rotarAutomaticos(dir);
    assert.equal(conservados.length,7);assert.equal(conservados[0].fecha,'2026-01-10');
    assert.equal(fs.existsSync(path.join(dir,'auto-2026-01-03.db')),false);
    assert.equal(fs.existsSync(path.join(dir,'tienda-respaldo-20260110-1000.db')),true);
    console.log('✅ rotación conserva los siete automáticos más recientes y no borra respaldos manuales');
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
}

{
  const ahora=new Date('2026-11-05T04:30:00.000Z');
  assert.equal(respaldos.nombreRespaldoManual(ahora),'tienda-respaldo-20261104-2330.db');
  console.log('✅ el nombre de respaldo manual usa la fecha y hora local de Bogotá');
}

console.log('Todas las pruebas de respaldos pasaron.');
