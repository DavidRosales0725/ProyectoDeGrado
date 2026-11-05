const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const productos = require('../productos');
const imagenes = require('../imagenes-productos');
const { autenticarAdminPrueba } = require('./test-auth-helper');

// Pruebas manuales que dependen de Electron: abrir el selector de archivos; comprobar que
// producto-img://p/<id> responde 403 sin sesión y 404 sin imagen; revisar miniaturas en productos,
// inventario, ventas y carrito; seleccionar PNG/JPG/WebP real y comprobar orientación/transparencia.
function preparar() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  productos.crearTablasProductos(db);
  db.exec(`CREATE TABLE movimientos_inventario(
    id INTEGER PRIMARY KEY AUTOINCREMENT, producto_id INTEGER NOT NULL REFERENCES productos(id),
    usuario_id INTEGER REFERENCES usuarios(id), venta_id INTEGER REFERENCES ventas(id),
    tipo TEXT NOT NULL CHECK(tipo IN ('inicial','entrada','salida','manual','venta','anulacion')),
    diferencia INTEGER NOT NULL, stock_anterior INTEGER NOT NULL, stock_nuevo INTEGER NOT NULL,
    motivo TEXT NOT NULL DEFAULT '', fecha TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z');`);
  const handlers = new Map(); const ipc={handle:(canal,fn)=>{assert.equal(handlers.has(canal),false,canal);handlers.set(canal,fn);}};
  autenticarAdminPrueba(ipc,handlers,db);
  const procesarImagen = buffer => ({ mime:'image/jpeg', datos:Buffer.concat([Buffer.from('JPG:'),Buffer.from(buffer).subarray(0,128)]) });
  productos(ipc,db,{procesarImagen});
  const invocar=(canal,...args)=>handlers.get(canal)({},...args);
  const crear=datos=>invocar('productos:crear',{nombre:'Producto foto',categoria:'Prueba',descripcion:'',precio:1000,stock:4,stockMin:1,...datos});
  return {db,ipc,handlers,invocar,crear};
}
const DATA='data:image/png;base64,aGVsbG8=';
function prueba(nombre,fn){const ctx=preparar();try{fn(ctx);console.log(`✅ ${nombre}`)}finally{ctx.db.close()}}

prueba('guarda una imagen al crear y listar nunca devuelve el BLOB',({db,crear,invocar})=>{
  const p=crear({imagen:DATA});
  const imagen=db.prepare('SELECT mime,datos FROM producto_imagenes WHERE producto_id=?').get(p.id);
  assert.equal(imagen.mime,'image/jpeg'); assert.equal(Buffer.from(imagen.datos).toString().startsWith('JPG:'),true);
  const listado=invocar('productos:listar').find(row=>row.id===p.id);
  assert.equal(listado.tieneImagen,1); assert.ok(listado.imagenVersion); assert.equal('datos' in listado,false); assert.equal('blob' in listado,false);
});

prueba('reemplaza y quita la imagen junto al producto',({db,crear,invocar})=>{
  const p=crear({imagen:DATA});
  invocar('productos:actualizar',p.id,{nombre:'Producto foto editado',categoria:'Prueba',descripcion:'',precio:1200,stock:4,stockMin:1,imagen:'data:image/jpeg;base64,d29ybGQ='});
  assert.equal(Buffer.from(db.prepare('SELECT datos FROM producto_imagenes WHERE producto_id=?').get(p.id).datos).toString(),'JPG:world');
  invocar('productos:actualizar',p.id,{nombre:'Producto foto editado',categoria:'Prueba',descripcion:'',precio:1200,stock:4,stockMin:1,quitarImagen:true});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM producto_imagenes WHERE producto_id=?').get(p.id).n,0);
  assert.equal(invocar('productos:listar').find(row=>row.id===p.id).tieneImagen,0);
});

prueba('un fallo al guardar la foto revierte producto, stock inicial e imagen',({db,crear})=>{
  db.exec(`CREATE TRIGGER fallar_imagen BEFORE INSERT ON producto_imagenes BEGIN SELECT RAISE(ABORT,'fallo simulado'); END`);
  assert.throws(()=>crear({imagen:DATA}),/fallo simulado/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM productos').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM producto_imagenes').get().n,0);
});

prueba('vendedor puede guardar imagen al crear y no editar ni quitar',({db,ipc,handlers,crear,invocar})=>{
  const registrarUsuarios=require('../usuarios'); registrarUsuarios(ipc,db);
  const vendedor=invocar('usuarios:crear',{nombre:'Vendedor',usuario:'vendedor',password:'clave-vendedor-123',rol:'vendedor'});
  invocar('auth:logout');invocar('auth:login',{usuario:'vendedor',password:'clave-vendedor-123'});
  const p=crear({nombre:'Creado por vendedor',imagen:DATA});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM producto_imagenes WHERE producto_id=?').get(p.id).n,1);
  assert.throws(()=>invocar('productos:actualizar',p.id,{nombre:p.nombre,categoria:p.categoria,descripcion:p.descripcion,precio:p.precio,stock:p.stock,stockMin:p.stockMin,quitarImagen:true}),/No tienes permiso/);
  assert.throws(()=>invocar('productos:eliminar',p.id),/No tienes permiso/);
  assert.equal(vendedor.rol,'vendedor');
});

prueba('rechaza data URL de más de 10 MB antes de procesarla',({crear})=>{
  const enorme=`data:image/jpeg;base64,${Buffer.alloc(imagenes.MAX_ENTRADA+1).toString('base64')}`;
  assert.throws(()=>crear({imagen:enorme}),/no puede superar 10 MB/);
});

prueba('migración crea la tabla de imágenes de forma idempotente',({db,crear})=>{
  const p=crear({imagen:DATA});
  const antes=Buffer.from(db.prepare('SELECT datos FROM producto_imagenes WHERE producto_id=?').get(p.id).datos).toString();
  imagenes.crearTablaProductoImagenes(db);imagenes.crearTablaProductoImagenes(db);
  assert.equal(Buffer.from(db.prepare('SELECT datos FROM producto_imagenes WHERE producto_id=?').get(p.id).datos).toString(),antes);
  assert.equal(db.prepare('PRAGMA table_info(producto_imagenes)').all().length,4);
});

console.log('Todas las pruebas de imágenes pasaron.');
