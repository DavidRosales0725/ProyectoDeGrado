const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const registrarVentas = require('../ventas');
const { crearTablasVentas } = registrarVentas;

function preparar() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      precio REAL NOT NULL CHECK (precio >= 0),
      stock INTEGER NOT NULL CHECK (stock >= 0),
      activo INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE movimientos_inventario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      tipo TEXT NOT NULL CHECK (tipo IN ('entrada','salida','manual','venta')),
      diferencia INTEGER NOT NULL,
      stock_anterior INTEGER NOT NULL CHECK (stock_anterior >= 0),
      stock_nuevo INTEGER NOT NULL CHECK (stock_nuevo >= 0),
      motivo TEXT NOT NULL DEFAULT '',
      fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  crearTablasVentas(db);
  const insertar = db.prepare('INSERT INTO productos (nombre, precio, stock, activo) VALUES (?, ?, ?, ?)');
  const ids = {
    camisa: Number(insertar.run('Camisa', 10000, 5, 1).lastInsertRowid),
    gorra: Number(insertar.run('Gorra', 5000, 1, 1).lastInsertRowid),
    inactivo: Number(insertar.run('Producto inactivo', 7000, 10, 0).lastInsertRowid),
  };
  const handlers = new Map();
  registrarVentas({ handle: (nombre, fn) => {
    assert.equal(handlers.has(nombre), false, `Handler duplicado: ${nombre}`);
    handlers.set(nombre, fn);
  } }, db);
  return { db, ids, invocar: (nombre, datos) => handlers.get(nombre)({}, datos) };
}

function probar(nombre, fn) {
  const ctx = preparar();
  try {
    fn(ctx);
    console.log(`✅ ${nombre}`);
  } finally {
    ctx.db.close();
  }
}

probar('venta correcta descuenta stock y registra movimiento', ({ db, ids, invocar }) => {
  const venta = invocar('ventas:registrar', {
    cliente: 'Ana', metodoPago: 'tarjeta', items: [{ productoId: ids.camisa, cantidad: 2 }],
  });
  assert.equal(venta.numero, 'VTA-000001');
  assert.equal(venta.total, 20000);
  assert.equal(venta.metodoPago, 'tarjeta');
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(ids.camisa).stock, 3);
  const mov = db.prepare('SELECT * FROM movimientos_inventario WHERE producto_id = ?').get(ids.camisa);
  assert.equal(mov.tipo, 'venta');
  assert.equal(mov.diferencia, -2);
  assert.equal(mov.stock_anterior, 5);
  assert.equal(mov.stock_nuevo, 3);
  assert.match(mov.motivo, /VTA-000001/);
  assert.equal(invocar('ventas:listar').length, 1);
});

probar('stock insuficiente rechaza toda la venta y revierte cambios', ({ db, ids, invocar }) => {
  assert.throws(() => invocar('ventas:registrar', {
    cliente: 'Ana', metodoPago: 'tarjeta', items: [
      { productoId: ids.camisa, cantidad: 2 },
      { productoId: ids.gorra, cantidad: 2 },
    ],
  }), /Gorra.*disponible 1.*solicitado 2/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM venta_items').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario').get().n, 0);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(ids.camisa).stock, 5);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(ids.gorra).stock, 1);
});

probar('el total se calcula desde SQLite e ignora el total del cliente', ({ invocar, ids }) => {
  const venta = invocar('ventas:registrar', {
    cliente: 'Ana', metodoPago: 'tarjeta', total: 0.01,
    items: [{ productoId: ids.camisa, cantidad: 2 }],
  });
  assert.equal(venta.total, 20000);
});

probar('efectivo con monto menor al total se rechaza', ({ db, ids, invocar }) => {
  assert.throws(() => invocar('ventas:registrar', {
    cliente: 'Ana', metodoPago: 'efectivo', montoRecibido: 9999,
    items: [{ productoId: ids.camisa, cantidad: 1 }],
  }), /monto recibido es insuficiente/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n, 0);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(ids.camisa).stock, 5);
});

probar('efectivo con monto mayor calcula correctamente el cambio', ({ ids, invocar }) => {
  const venta = invocar('ventas:registrar', {
    cliente: 'Ana', metodoPago: 'efectivo', montoRecibido: 15000,
    items: [{ productoId: ids.camisa, cantidad: 1 }],
  });
  assert.equal(venta.total, 10000);
  assert.equal(venta.montoRecibido, 15000);
  assert.equal(venta.cambio, 5000);
});

probar('producto inactivo se rechaza', ({ db, ids, invocar }) => {
  assert.throws(() => invocar('ventas:registrar', {
    cliente: 'Ana', metodoPago: 'tarjeta',
    items: [{ productoId: ids.inactivo, cantidad: 1 }],
  }), /no existe o está inactivo/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n, 0);
});

console.log('Todas las pruebas de ventas pasaron.');
