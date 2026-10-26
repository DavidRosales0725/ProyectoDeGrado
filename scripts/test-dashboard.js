const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { calcularResumen } = require('../dashboard');

function preparar() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      stock INTEGER NOT NULL,
      stock_min INTEGER NOT NULL,
      activo INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      fecha TEXT NOT NULL,
      cliente TEXT NOT NULL,
      total REAL NOT NULL,
      metodo_pago TEXT NOT NULL,
      estado TEXT NOT NULL
    );
  `);
  const producto = db.prepare('INSERT INTO productos (nombre, stock, stock_min, activo) VALUES (?, ?, ?, ?)');
  producto.run('Producto bajo', 2, 5, 1);
  producto.run('Producto agotado', 0, 0, 1);
  producto.run('Producto suficiente', 8, 5, 1);
  producto.run('Producto inactivo', 0, 10, 0);

  const venta = db.prepare(`
    INSERT INTO ventas (numero, fecha, cliente, total, metodo_pago, estado)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  // El 15 de enero a las 22:00 en Bogotá equivale al 16 de enero a las 03:00 UTC.
  venta.run('VTA-000001', '2026-01-16T03:00:00.000Z', 'Cliente noche', 20, 'efectivo', 'completada');
  // El 16 de enero a la 01:00 en Bogotá equivale al 16 de enero a las 06:00 UTC.
  venta.run('VTA-000002', '2026-01-16T06:00:00.000Z', 'Cliente madrugada', 30, 'tarjeta', 'completada');
  venta.run('VTA-000003', '2026-01-16T08:00:00.000Z', 'Venta anulada', 1000, 'transferencia', 'anulada');
  venta.run('VTA-000004', '2026-01-10T12:00:00.000Z', 'Cliente anterior', 100, 'efectivo', 'completada');
  return db;
}

function conBase(fn) {
  const db = preparar();
  try {
    fn(db);
  } finally {
    db.close();
  }
}

conBase(db => {
  const resumen = calcularResumen(db, new Date('2026-01-16T12:00:00.000Z'));
  assert.equal(resumen.totalProductos, 3);
  assert.equal(resumen.stockBajo, 2);
  assert.equal(resumen.totalVentas, 4);
  assert.equal(resumen.ingresoTotal, 150);
  assert.equal(resumen.ventasHoy, 2);
  assert.equal(resumen.ingresoHoy, 30);
  assert.equal(resumen.ultimasVentas.length, 4);
  assert.equal(resumen.ultimasVentas[0].metodoPago, 'transferencia');
  assert.deepEqual(resumen.productosStockBajo.map(p => p.nombre), ['Producto agotado', 'Producto bajo']);
  console.log('✅ totales, stock bajo, últimas ventas y productos inactivos');
});

conBase(db => {
  // A las 23:00 del 15 en Bogotá, la venta de las 22:00 pertenece a hoy.
  const resumenNoche = calcularResumen(db, new Date('2026-01-16T04:00:00.000Z'));
  assert.equal(resumenNoche.ventasHoy, 1);
  assert.equal(resumenNoche.ingresoHoy, 20);

  // A la 01:30 del 16 en Bogotá, la venta de la 01:00 pertenece a hoy,
  // mientras que la de las 22:00 del día anterior ya no.
  const resumenMadrugada = calcularResumen(db, new Date('2026-01-16T06:30:00.000Z'));
  assert.equal(resumenMadrugada.ventasHoy, 2);
  assert.equal(resumenMadrugada.ingresoHoy, 30);
  console.log('✅ límites del día local de Bogotá (22:00 y 01:00)');
});

conBase(db => {
  const resumen = calcularResumen(db, new Date('2026-01-16T12:00:00.000Z'));
  assert.equal(resumen.ingresoTotal, 150);
  assert.equal(resumen.ingresoHoy, 30);
  console.log('✅ ventas no completadas excluidas de los ingresos');
});

conBase(db => {
  const resumen = calcularResumen(db, new Date('2026-01-16T12:00:00.000Z'));
  assert.equal(resumen.totalProductos, 3);
  assert.equal(resumen.stockBajo, 2);
  assert.equal(resumen.productosStockBajo.some(p => p.nombre === 'Producto inactivo'), false);
  console.log('✅ productos inactivos excluidos de conteos y alertas');
});

console.log('Todas las pruebas del dashboard pasaron.');
