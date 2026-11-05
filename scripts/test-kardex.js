const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const productos = require('../productos');
const inventario = require('../inventario');
const ventas = require('../ventas');
const registrarKardex = require('../kardex');
const registrarUsuarios = require('../usuarios');
const { crearTablasVentas } = ventas;
const { autenticarAdminPrueba } = require('./test-auth-helper');

function crearContexto() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  productos.crearTablasProductos(db);
  crearTablasVentas(db);
  const handlers = new Map();
  const ipc = { handle: (canal, fn) => {
    assert.equal(handlers.has(canal), false, `Handler duplicado: ${canal}`);
    handlers.set(canal, fn);
  } };
  autenticarAdminPrueba(ipc, handlers, db);
  productos(ipc, db); inventario(ipc, db); ventas(ipc, db); registrarKardex(ipc, db); registrarUsuarios(ipc, db);
  const invocar = (canal, ...args) => {
    const fn = handlers.get(canal);
    assert.ok(fn, `Canal inexistente: ${canal}`);
    return fn({}, ...args);
  };
  return { db, handlers, invocar };
}

function prueba(nombre, ejecutar) {
  const ctx = crearContexto();
  try { ejecutar(ctx); console.log(`✅ ${nombre}`); }
  finally { ctx.db.close(); }
}

prueba('crear producto registra saldo inicial', ({ db, invocar }) => {
  const p = invocar('productos:crear', { nombre:'Arroz', categoria:'Abarrotes', descripcion:'', precio:2000, stock:8, stockMin:1 });
  const movimiento = db.prepare('SELECT * FROM movimientos_inventario WHERE producto_id=?').get(p.id);
  assert.equal(movimiento.tipo, 'inicial');
  assert.equal(movimiento.stock_anterior, 0);
  assert.equal(movimiento.stock_nuevo, 8);
  assert.equal(movimiento.diferencia, 8);
});

prueba('movimiento de venta queda ligado a venta y sesión', ({ db, invocar }) => {
  const p = invocar('productos:crear', { nombre:'Leche', categoria:'Abarrotes', descripcion:'', precio:1000, stock:5, stockMin:1 });
  const sesion = require('../sesion').obtenerSesion();
  const v = invocar('ventas:registrar', { cliente:'Ana', metodoPago:'tarjeta', items:[{ productoId:p.id, cantidad:2 }] });
  const m = db.prepare("SELECT * FROM movimientos_inventario WHERE tipo='venta'").get();
  assert.equal(m.venta_id, v.id);
  assert.equal(m.usuario_id, sesion.id);
  assert.equal(m.diferencia, -2);
});

prueba('vendedor crea producto, registra entrada y salida, pero no ajuste manual', ({ db, invocar }) => {
  const vendedor = invocar('usuarios:crear', { nombre:'Vendedor', usuario:'vendedor', password:'clave-vendedor-123', rol:'vendedor' });
  invocar('auth:logout'); invocar('auth:login', { usuario:'vendedor', password:'clave-vendedor-123' });
  const p = invocar('productos:crear', { nombre:'Pan', categoria:'Abarrotes', descripcion:'', precio:500, stock:4, stockMin:1 });
  assert.throws(() => invocar('productos:actualizar', p.id, { nombre:'Pan editado', categoria:'Abarrotes', descripcion:'', precio:500, stock:4, stockMin:1 }), /No tienes permiso/);
  assert.throws(() => invocar('productos:eliminar', p.id), /No tienes permiso/);
  invocar('inventario:ajustar', { productoId:p.id, tipo:'entrada', cantidad:3, motivo:'Reposición' });
  invocar('inventario:ajustar', { productoId:p.id, tipo:'salida', cantidad:1, motivo:'Merma' });
  assert.throws(() => invocar('inventario:ajustar', { productoId:p.id, tipo:'manual', cantidad:4, motivo:'Corrección' }), /No tienes permiso/);
  assert.throws(() => invocar('inventario:ajustar', { productoId:p.id, tipo:'entrada', cantidad:1 }), /motivo/i);
  const movimientos = db.prepare('SELECT tipo, usuario_id FROM movimientos_inventario WHERE producto_id=? ORDER BY id').all(p.id);
  assert.deepEqual(movimientos.map(m => m.tipo), ['inicial','entrada','salida']);
  assert.ok(movimientos.every(m => m.usuario_id === vendedor.id));
});

prueba('editar stock como administrador registra ajuste manual', ({ db, invocar }) => {
  const p = invocar('productos:crear', { nombre:'Café', categoria:'Abarrotes', descripcion:'', precio:3000, stock:4, stockMin:1 });
  invocar('productos:actualizar', p.id, { nombre:'Café', categoria:'Abarrotes', descripcion:'', precio:3000, stock:9, stockMin:1 });
  const m = db.prepare('SELECT * FROM movimientos_inventario WHERE producto_id=? ORDER BY id DESC LIMIT 1').get(p.id);
  assert.equal(m.tipo, 'manual'); assert.equal(m.stock_anterior, 4); assert.equal(m.stock_nuevo, 9); assert.equal(m.diferencia, 5);
});

prueba('saldo y suma de movimientos concuerdan con el stock', ({ db, invocar }) => {
  const p = invocar('productos:crear', { nombre:'Huevos', categoria:'Abarrotes', descripcion:'', precio:800, stock:10, stockMin:1 });
  invocar('inventario:ajustar', { productoId:p.id, tipo:'entrada', cantidad:5, motivo:'Compra proveedor' });
  invocar('inventario:ajustar', { productoId:p.id, tipo:'salida', cantidad:2, motivo:'Producto dañado' });
  const movimientos = db.prepare('SELECT diferencia, stock_anterior, stock_nuevo FROM movimientos_inventario WHERE producto_id=? ORDER BY id').all(p.id);
  assert.equal(movimientos.reduce((n,m) => n + m.diferencia, 0), 13);
  for (let i=0; i<movimientos.length; i++) {
    assert.equal(movimientos[i].stock_nuevo - movimientos[i].stock_anterior, movimientos[i].diferencia);
    if (i) assert.equal(movimientos[i].stock_anterior, movimientos[i-1].stock_nuevo);
  }
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id=?').get(p.id).stock, 13);
});

{
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE productos(id INTEGER PRIMARY KEY, nombre TEXT, precio REAL, stock INTEGER NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1);
      INSERT INTO productos(id,nombre,precio,stock) VALUES(1,'Legado',1,7),(2,'Sin movimientos',1,3);
      CREATE TABLE usuarios(id INTEGER PRIMARY KEY, nombre TEXT);
      CREATE TABLE ventas(id INTEGER PRIMARY KEY, numero TEXT);
      CREATE TABLE movimientos_inventario(id INTEGER PRIMARY KEY AUTOINCREMENT, producto_id INTEGER NOT NULL REFERENCES productos(id), tipo TEXT NOT NULL CHECK(tipo IN ('entrada','salida','manual','venta')), diferencia INTEGER NOT NULL, stock_anterior INTEGER NOT NULL, stock_nuevo INTEGER NOT NULL, motivo TEXT NOT NULL DEFAULT '', fecha TEXT NOT NULL DEFAULT '2020-01-01T00:00:00.000Z');
      INSERT INTO movimientos_inventario(id,producto_id,tipo,diferencia,stock_anterior,stock_nuevo,motivo) VALUES(44,1,'entrada',5,0,5,'histórico');
    `);
    const kardex = require('../kardex');
    kardex.asegurarEsquemaMovimientos(db);
    assert.equal(db.prepare('SELECT id FROM movimientos_inventario WHERE id=44').get().id, 44);
    kardex.conciliarSaldosExistentes(db);
    const filas = db.prepare('SELECT producto_id, tipo, stock_anterior, stock_nuevo FROM movimientos_inventario ORDER BY producto_id, id').all();
    assert.deepEqual(filas.map(x => [x.producto_id,x.tipo,x.stock_anterior,x.stock_nuevo]), [[1,'entrada',0,5],[1,'manual',5,7],[2,'manual',0,3]]);
    const cantidad = filas.length;
    kardex.conciliarSaldosExistentes(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario').get().n, cantidad);
    db.prepare("INSERT INTO movimientos_inventario(producto_id,tipo,diferencia,stock_anterior,stock_nuevo,motivo) VALUES(1,'inicial',0,7,7,'test')").run();
    db.prepare("INSERT INTO movimientos_inventario(producto_id,tipo,diferencia,stock_anterior,stock_nuevo,motivo) VALUES(1,'anulacion',0,7,7,'test')").run();
    console.log('✅ migración conserva filas, conciliación registra diferencias una sola vez y CHECK admite inicial/anulación');
  } finally { db.close(); }
}

{
  const db = new DatabaseSync(':memory:');
  try {
    productos.crearTablasProductos(db);
    require('../sesion').crearTablaUsuarios(db);
    ventas.crearTablasVentas(db);
    const kardex = require('../kardex');
    kardex.asegurarEsquemaMovimientos(db);
    db.exec("INSERT INTO productos(id,nombre,precio,stock) VALUES(501,'Corrupto grande',1,444444444444444416),(502,'Fuera del tope',1,1000001),(503,'Válido',1,8)");
    db.exec("INSERT INTO movimientos_inventario(producto_id,tipo,diferencia,stock_anterior,stock_nuevo,motivo) VALUES(501,'manual',1,0,444444444444444416,'corrupto')");
    const avisos = [];
    const warnOriginal = console.warn;
    console.warn = (...args) => avisos.push(args.join(' '));
    try { kardex.conciliarSaldosExistentes(db); }
    finally { console.warn = warnOriginal; }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario WHERE producto_id=501').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario WHERE producto_id=502').get().n, 0);
    assert.equal(db.prepare('SELECT stock_nuevo FROM movimientos_inventario WHERE producto_id=503').get().stock_nuevo, 8);
    assert.ok(avisos.some(aviso => aviso.includes('501')));
    assert.ok(avisos.some(aviso => aviso.includes('502')));
    console.log('✅ conciliación omite stocks corruptos y fuera del tope sin impedir el arranque');
  } finally { db.close(); }
}

prueba('consulta rechaza rangos inválidos y mayores a 366 días', ({ invocar }) => {
  const p = invocar('productos:crear', { nombre:'Yuca', categoria:'Abarrotes', descripcion:'', precio:900, stock:2, stockMin:1 });
  assert.throws(() => invocar('kardex:consultar', { productoId:p.id, desde:'2026-02-30', hasta:'2026-03-01' }), /fecha/i);
  assert.throws(() => invocar('kardex:consultar', { productoId:p.id, desde:'2025-01-01', hasta:'2026-01-02' }), /366 días/);
  assert.throws(() => invocar('kardex:consultar', { productoId:p.id, desde:'2026-04-02', hasta:'2026-04-01' }), /posterior/);
});

console.log('Todas las pruebas de Kardex pasaron.');
