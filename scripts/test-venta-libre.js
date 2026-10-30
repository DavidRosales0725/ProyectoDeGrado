const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const registrarVentas = require('../ventas');
const { crearTablasVentas } = registrarVentas;

function base({ migracionAntigua = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      precio REAL NOT NULL,
      stock INTEGER NOT NULL CHECK (stock >= 0),
      activo INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE movimientos_inventario (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      tipo TEXT NOT NULL,
      diferencia INTEGER NOT NULL,
      stock_anterior INTEGER NOT NULL,
      stock_nuevo INTEGER NOT NULL,
      motivo TEXT NOT NULL DEFAULT ''
    );
  `);
  if (migracionAntigua) {
    db.exec(`
      CREATE TABLE ventas (
        id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT NOT NULL UNIQUE,
        fecha TEXT NOT NULL DEFAULT '', cliente TEXT NOT NULL, total REAL NOT NULL,
        metodo_pago TEXT NOT NULL, monto_recibido REAL NOT NULL, cambio REAL NOT NULL,
        estado TEXT NOT NULL DEFAULT 'completada'
      );
      CREATE TABLE venta_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venta_id INTEGER NOT NULL REFERENCES ventas(id),
        producto_id INTEGER NOT NULL REFERENCES productos(id),
        nombre TEXT NOT NULL, precio_unit REAL NOT NULL CHECK (precio_unit >= 0),
        cantidad INTEGER NOT NULL CHECK (cantidad > 0), subtotal REAL NOT NULL CHECK (subtotal >= 0)
      );
      INSERT INTO productos (id, nombre, precio, stock) VALUES (7, 'Legado', 2500, 4);
      INSERT INTO ventas (id, numero, fecha, cliente, total, metodo_pago, monto_recibido, cambio)
      VALUES (12, 'VTA-000012', '', 'Ana', 5000, 'efectivo', 5000, 0);
      INSERT INTO venta_items (id, venta_id, producto_id, nombre, precio_unit, cantidad, subtotal)
      VALUES (31, 12, 7, 'Legado', 2500, 2, 5000);
    `);
  }
  crearTablasVentas(db);
  const producto = db.prepare('INSERT INTO productos (nombre, precio, stock) VALUES (?, ?, ?)').run('Arroz', 2000, 5);
  const handlers = new Map();
  registrarVentas({ handle: (nombre, fn) => handlers.set(nombre, fn) }, db);
  return { db, productoId: Number(producto.lastInsertRowid), invocar: (nombre, datos) => handlers.get(nombre)({}, datos) };
}

function venta(items, extras = {}) {
  return { cliente: 'Cliente general', metodoPago: 'tarjeta', items, ...extras };
}

function prueba(nombre, fn) {
  const ctx = base();
  try { fn(ctx); console.log(`✅ ${nombre}`); }
  finally { ctx.db.close(); }
}

prueba('línea libre cobra sin modificar stock ni crear movimientos', ({ db, invocar, productoId }) => {
  const result = invocar('ventas:registrar', venta([{ libre: true, nombre: 'Plátano', precio: 1500, cantidad: 2 }]));
  assert.equal(result.total, 3000);
  assert.equal(result.items[0].esLibre, true);
  assert.equal(result.items[0].productoId, null);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(productoId).stock, 5);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario').get().n, 0);
});

prueba('venta mezclada suma catálogo y línea libre', ({ invocar, productoId }) => {
  const result = invocar('ventas:registrar', venta([
    { productoId, cantidad: 2 }, { libre: true, nombre: 'Tomate', precio: 1500, cantidad: 3 },
  ]));
  assert.equal(result.total, 8500);
  assert.deepEqual(result.items.map(item => item.esLibre), [false, true]);
});

prueba('precios inválidos de productos libres se rechazan', ({ invocar }) => {
  for (const precio of [0, -1, NaN, 100000001]) {
    assert.throws(() => invocar('ventas:registrar', venta([{ libre: true, nombre: 'Yuca', precio, cantidad: 1 }])), /precio del producto libre/);
  }
});

prueba('nombres vacíos o demasiado largos se rechazan', ({ invocar }) => {
  for (const nombre of ['', ' '.repeat(3), 'x'.repeat(101)]) {
    assert.throws(() => invocar('ventas:registrar', venta([{ libre: true, nombre, precio: 10, cantidad: 1 }])), /nombre/);
  }
});

prueba('nombre libre con caracteres de control se rechaza', ({ invocar }) => {
  assert.throws(() => invocar('ventas:registrar', venta([
    { libre: true, nombre: 'Plátano\nverde', precio: 10, cantidad: 1 },
  ])), /caracteres de control/);
});

prueba('falta de stock revierte la venta completa aunque incluya línea libre', ({ db, invocar, productoId }) => {
  assert.throws(() => invocar('ventas:registrar', venta([
    { libre: true, nombre: 'Papa', precio: 1000, cantidad: 1 }, { productoId, cantidad: 6 },
  ])), /Stock insuficiente/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM venta_items').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario').get().n, 0);
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(productoId).stock, 5);
});

{
  const ctx = base({ migracionAntigua: true });
  try {
    const columnas = ctx.db.prepare('PRAGMA table_info(venta_items)').all();
    assert.equal(Number(columnas.find(col => col.name === 'producto_id').notnull), 0);
    assert.equal(Number(columnas.find(col => col.name === 'es_libre').dflt_value), 0);
    assert.deepEqual({ ...ctx.db.prepare('SELECT id, venta_id, producto_id, nombre, subtotal, es_libre FROM venta_items').get() }, {
      id: 31, venta_id: 12, producto_id: 7, nombre: 'Legado', subtotal: 5000, es_libre: 0,
    });
    console.log('✅ migración conserva filas e ids del esquema antiguo');
  } finally { ctx.db.close(); }
}

prueba('más de 100 líneas se rechazan', ({ invocar }) => {
  const items = Array.from({ length: 101 }, (_, index) => ({ libre: true, nombre: `L${index}`, precio: 1, cantidad: 1 }));
  assert.throws(() => invocar('ventas:registrar', venta(items)), /más de 100 líneas/);
});

prueba('líneas libres repetidas no se fusionan', ({ invocar }) => {
  const result = invocar('ventas:registrar', venta([
    { libre: true, nombre: 'Plátano', precio: 100, cantidad: 1 },
    { libre: true, nombre: 'Plátano', precio: 100, cantidad: 1 },
  ]));
  assert.equal(result.items.length, 2);
  assert.equal(result.total, 200);
});

prueba('una línea libre con productoId se procesa como libre sin consultar catálogo', ({ db, invocar }) => {
  const result = invocar('ventas:registrar', venta([
    { libre: true, productoId: 999999, nombre: 'Aguacate', precio: 2500, cantidad: 1 },
  ]));
  assert.equal(result.items[0].esLibre, true);
  assert.equal(result.items[0].productoId, null);
  assert.equal(result.total, 2500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario').get().n, 0);
});

console.log('Todas las pruebas de venta libre pasaron.');
