const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const registrarProductos = require('../productos');
const registrarVentas = require('../ventas');
const registrarDashboard = require('../dashboard');
const registrarReportes = require('../reportes');
const registrarUsuarios = require('../usuarios');
const { autenticarAdminPrueba } = require('./test-auth-helper');
const { fechaLocalBogota, limitesFechaBogota, sumarDias } = require('../fechas');

function contexto() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  registrarProductos.crearTablasProductos(db);
  registrarVentas.crearTablasVentas(db);
  const handlers = new Map();
  const ipc = { handle: (canal, fn) => { assert.equal(handlers.has(canal), false, `Canal duplicado ${canal}`); handlers.set(canal, fn); } };
  autenticarAdminPrueba(ipc, handlers, db);
  registrarProductos(ipc, db); registrarVentas(ipc, db); registrarDashboard(ipc, db); registrarReportes(ipc, db);
  registrarUsuarios(ipc, db);
  const invocar = (canal, ...args) => {
    const fn = handlers.get(canal);
    if (!fn) throw new Error(`Canal no registrado: ${canal}`);
    return fn({}, ...args);
  };
  const crear = (nombre='Arroz', stock=10) => invocar('productos:crear', { nombre, categoria:'Abarrotes', descripcion:'', precio:1000, stock, stockMin:1 });
  const venta = (productoId, cantidad=2, extras={}) => invocar('ventas:registrar', { cliente:'Cliente', metodoPago:'tarjeta', items:[{ productoId, cantidad }], ...extras });
  return { db, handlers, invocar, crear, venta };
}

function prueba(nombre, ejecutar) {
  const ctx = contexto();
  try { ejecutar(ctx); console.log(`✅ ${nombre}`); }
  finally { ctx.db.close(); }
}

prueba('anular devuelve stock y registra movimiento con usuario y venta', ({ db, crear, venta, invocar }) => {
  const p = crear(); const original = venta(p.id);
  const anulada = invocar('ventas:anular', { ventaId:original.id, motivo:'Cobro equivocado' });
  assert.equal(anulada.estado, 'anulada');
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id=?').get(p.id).stock, 10);
  const movimiento = db.prepare("SELECT * FROM movimientos_inventario WHERE tipo='anulacion'").get();
  assert.equal(movimiento.diferencia, 2); assert.equal(movimiento.venta_id, original.id);
  assert.equal(movimiento.usuario_id, require('../sesion').obtenerSesion().id);
  assert.match(movimiento.motivo, /Anulación .*Cobro equivocado/);
});

prueba('vendedor solo puede anular sus ventas del día; administrador puede anular cualquier día', ({ db, invocar, crear, venta }) => {
  const p = crear();
  const adminSale = venta(p.id, 1);
  const vendor = invocar('usuarios:crear', { nombre:'Vendedor', usuario:'vendedor', password:'clave-vendedor-123', rol:'vendedor' });
  invocar('auth:logout'); invocar('auth:login', { usuario:'vendedor', password:'clave-vendedor-123' });
  assert.throws(() => invocar('ventas:anular', { ventaId:adminSale.id, motivo:'Venta ajena' }), /propias ventas/);
  const propia = invocar('ventas:registrar', { cliente:'Propia', metodoPago:'tarjeta', items:[{ productoId:p.id, cantidad:1 }] });
  assert.equal(invocar('ventas:anular', { ventaId:propia.id, motivo:'Error del cajero' }).estado, 'anulada');
  const otra = invocar('ventas:registrar', { cliente:'Ayer', metodoPago:'tarjeta', items:[{ productoId:p.id, cantidad:1 }] });
  const ayer = sumarDias(fechaLocalBogota(new Date()), -1);
  db.prepare('UPDATE ventas SET fecha=? WHERE id=?').run(limitesFechaBogota(ayer).inicio, otra.id);
  assert.throws(() => invocar('ventas:anular', { ventaId:otra.id, motivo:'Venta de ayer' }), /día local actual/);
  invocar('auth:logout'); invocar('auth:login', { usuario:'admin.test', password:'clave-segura-123' });
  assert.equal(invocar('ventas:anular', { ventaId:otra.id, motivo:'Revisión administrativa' }).estado, 'anulada');
  assert.ok(vendor.id);
});

prueba('motivo obligatorio, longitud/control y doble anulación se rechazan', ({ crear, venta, invocar }) => {
  const p=crear(); const v=venta(p.id);
  for (const motivo of ['', 'ab', 'x'.repeat(201), 'mal\nmotivo']) {
    assert.throws(() => invocar('ventas:anular', { ventaId:v.id, motivo }), /motivo|control|caracteres/i);
  }
  invocar('ventas:anular', { ventaId:v.id, motivo:'Motivo válido' });
  assert.throws(() => invocar('ventas:anular', { ventaId:v.id, motivo:'Segundo intento' }), /completadas/);
});

prueba('corregir reemplaza líneas y total y deja el stock correcto', ({ db, crear, venta, invocar }) => {
  const p=crear('Leche', 10); const original=venta(p.id,2);
  const resultado=invocar('ventas:corregir', { ventaId:original.id, motivo:'Cantidad corregida', cliente:'Ana', metodoPago:'tarjeta', items:[{ productoId:p.id, cantidad:3 }] });
  assert.equal(resultado.original.estado,'anulada'); assert.equal(resultado.nueva.total,3000);
  assert.equal(resultado.nueva.items[0].cantidad,3);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id=?').get(p.id).stock,7);
});

prueba('corrección sin stock revierte todo y conserva original completada', ({ db, crear, venta, invocar }) => {
  const p=crear('Atún',2); const original=venta(p.id,2);
  const antesMov=db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario').get().n;
  assert.throws(() => invocar('ventas:corregir', { ventaId:original.id, motivo:'Aumentar cantidad', metodoPago:'tarjeta', items:[{ productoId:p.id, cantidad:3 }] }), /Stock insuficiente/);
  assert.equal(db.prepare('SELECT estado FROM ventas WHERE id=?').get(original.id).estado,'completada');
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id=?').get(p.id).stock,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario').get().n,antesMov);
});

prueba('corrección rechaza precio libre inválido y revierte la devolución', ({ db, crear, venta, invocar }) => {
  const p=crear('Papa',4); const original=venta(p.id,1);
  assert.throws(() => invocar('ventas:corregir', { ventaId:original.id, motivo:'Cambiar precio', metodoPago:'tarjeta', items:[{ libre:true, nombre:'Yuca', precio:0, cantidad:1 }] }), /precio del producto libre/);
  assert.equal(db.prepare('SELECT estado FROM ventas WHERE id=?').get(original.id).estado,'completada');
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id=?').get(p.id).stock,3);
});

prueba('corrección hereda fecha y enlaza referencias', ({ db, crear, venta, invocar }) => {
  const p=crear(); const original=venta(p.id,1);
  db.prepare('UPDATE ventas SET fecha=? WHERE id=?').run('2025-03-04T05:10:00.000Z',original.id);
  const resultado=invocar('ventas:corregir',{ ventaId:original.id,motivo:'Dato corregido',metodoPago:'tarjeta',items:[{productoId:p.id,cantidad:1}] });
  assert.equal(resultado.nueva.fecha,'2025-03-04T05:10:00.000Z');
  assert.equal(db.prepare('SELECT corrige_a_id FROM ventas WHERE id=?').get(resultado.nueva.id).corrige_a_id,original.id);
  assert.equal(invocar('ventas:listar').find(v=>v.id===resultado.nueva.id).corrigeA,original.numero);
  assert.equal(invocar('ventas:listar').find(v=>v.id===original.id).corregidaPor,resultado.nueva.numero);
});

prueba('dashboard y reportes excluyen ventas anuladas', ({ db, crear, venta, invocar }) => {
  const p=crear(); const v=venta(p.id); invocar('ventas:anular',{ventaId:v.id,motivo:'Prueba de reporte'});
  assert.equal(invocar('dashboard:resumen').totalVentas,0);
  const hoy=fechaLocalBogota(new Date());
  assert.equal(invocar('reportes:porDia',{desde:hoy,hasta:hoy}).resumen.cantidadVentas,0);
});

prueba('anulación que supera el límite de stock se rechaza sin cambios', ({ db, crear, venta, invocar }) => {
  const p=crear('Stock alto',999999); const v=venta(p.id,1);
  db.prepare('UPDATE productos SET stock=1000000 WHERE id=?').run(p.id);
  assert.throws(() => invocar('ventas:anular',{ventaId:v.id,motivo:'Restituir compra'}), /superaría 1\.000\.000/);
  assert.equal(db.prepare('SELECT estado FROM ventas WHERE id=?').get(v.id).estado,'completada');
});

{
  const db=new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  try {
    registrarProductos.crearTablasProductos(db);
    require('../sesion').crearTablaUsuarios(db);
    db.exec(`CREATE TABLE ventas(id INTEGER PRIMARY KEY, numero TEXT NOT NULL UNIQUE, fecha TEXT NOT NULL DEFAULT '', cliente TEXT NOT NULL, total REAL NOT NULL, metodo_pago TEXT NOT NULL, monto_recibido REAL NOT NULL DEFAULT 0, cambio REAL NOT NULL DEFAULT 0, estado TEXT NOT NULL DEFAULT 'completada');
      INSERT INTO ventas(id,numero,fecha,cliente,total,metodo_pago,monto_recibido,cambio) VALUES(41,'LEGACY-41','2025-01-01T12:00:00.000Z','Legado',10,'efectivo',10,0);`);
    registrarVentas.crearTablasVentas(db);
    const row=db.prepare('SELECT id,numero,anulada_por,anulada_en,motivo_anulacion,corrige_a_id FROM ventas').get();
    assert.deepEqual({ ...row },{id:41,numero:'LEGACY-41',anulada_por:null,anulada_en:null,motivo_anulacion:null,corrige_a_id:null});
    registrarVentas.crearTablasVentas(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n,1);
    assert.throws(() => db.prepare("UPDATE ventas SET estado='pendiente' WHERE id=41").run(), /Estado de venta inválido/);
    console.log('✅ migración de ventas conserva filas y es idempotente');
  } finally { db.close(); }
}

console.log('Todas las pruebas de anulaciones pasaron.');
