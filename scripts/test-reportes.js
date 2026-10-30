const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const registrarVentas = require('../ventas');
const registrarReportes = require('../reportes');
const { crearTablasVentas } = registrarVentas;

const db = new DatabaseSync(':memory:');
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, precio REAL NOT NULL,
    stock INTEGER NOT NULL DEFAULT 0, activo INTEGER NOT NULL DEFAULT 1
  );
`);
crearTablasVentas(db);
const productoId = Number(db.prepare('INSERT INTO productos (nombre, precio) VALUES (?, ?)').run('Arroz', 2000).lastInsertRowid);

const handlers = new Map();
registrarReportes({ handle: (canal, fn) => {
  assert.equal(handlers.has(canal), false, `Handler duplicado: ${canal}`);
  handlers.set(canal, fn);
} }, db);
const invocar = (canal, datos) => handlers.get(canal)({}, datos);

const insertarVenta = db.prepare(`
  INSERT INTO ventas (numero, fecha, cliente, total, metodo_pago, monto_recibido, cambio, estado)
  VALUES (?, ?, ?, ?, ?, ?, 0, ?)
`);
const ventasIds = {};
function venta(clave, fecha, total, metodoPago = 'efectivo', estado = 'completada') {
  const id = Number(insertarVenta.run(`VTA-${clave}`, fecha, `Cliente ${clave}`, total, metodoPago, total, estado).lastInsertRowid);
  ventasIds[clave] = id;
  db.prepare(`INSERT INTO venta_items (venta_id, producto_id, nombre, precio_unit, cantidad, subtotal, es_libre)
    VALUES (?, ?, ?, ?, 1, ?, 0)`).run(id, productoId, 'Arroz', total, total);
  return id;
}

function prueba(nombre, fn) {
  try { fn(); console.log(`✅ ${nombre}`); }
  catch (error) { console.error(`❌ ${nombre}`); throw error; }
}

venta('22', '2025-05-01T03:00:00.000Z', 100, 'efectivo'); // 30 abril, 22:00 Bogotá
venta('01', '2025-05-01T06:00:00.000Z', 200, 'tarjeta'); // 1 mayo, 01:00 Bogotá
venta('antes', '2025-05-01T04:59:59.000Z', 300, 'transferencia'); // último segundo de abril 30
venta('limite', '2025-05-01T05:00:00.000Z', 400, 'efectivo'); // primer instante de mayo 1
venta('pendiente', '2025-05-01T08:00:00.000Z', 500, 'tarjeta', 'anulada');

prueba('agrupa por día de Bogotá y respeta límites UTC 04:59:59 / 05:00:00', () => {
  const { dias } = invocar('reportes:porDia', { desde: '2025-04-30', hasta: '2025-05-02' });
  assert.deepEqual(dias.map(d => [d.fecha, d.cantidadVentas, d.ingresoTotal]), [
    ['2025-04-30', 2, 400], ['2025-05-01', 2, 600], ['2025-05-02', 0, 0],
  ]);
});

prueba('incluye días sin ventas con todas las sumas en cero', () => {
  const { dias } = invocar('reportes:porDia', { desde: '2025-05-02', hasta: '2025-05-03' });
  assert.equal(dias.length, 2);
  for (const dia of dias) assert.deepEqual([dia.cantidadVentas, dia.ingresoTotal, dia.efectivo, dia.tarjeta, dia.transferencia], [0, 0, 0, 0, 0]);
});

prueba('los métodos de pago suman el ingreso de cada día', () => {
  const { dias } = invocar('reportes:porDia', { desde: '2025-04-30', hasta: '2025-05-01' });
  for (const dia of dias) assert.equal(dia.efectivo + dia.tarjeta + dia.transferencia, dia.ingresoTotal);
  assert.equal(dias[0].transferencia, 300);
  assert.equal(dias[1].efectivo, 400);
});

prueba('ventas con estado distinto de completada se excluyen', () => {
  const dia = invocar('reportes:porDia', { desde: '2025-05-01', hasta: '2025-05-01' }).dias[0];
  assert.equal(dia.cantidadVentas, 2);
  assert.equal(dia.ingresoTotal, 600);
  assert.equal(dia.tarjeta, 200);
});

prueba('rechaza fechas inválidas, orden inverso y rangos mayores a 366 días', () => {
  assert.throws(() => invocar('reportes:porDia', { desde: '2025-02-30', hasta: '2025-03-01' }), /fecha/i);
  assert.throws(() => invocar('reportes:porDia', { desde: '2025-05-02', hasta: '2025-05-01' }), /posterior/);
  assert.throws(() => invocar('reportes:porDia', { desde: '2024-01-01', hasta: '2025-01-01' }), /366 días/);
  assert.throws(() => invocar('reportes:porDia', { desde: '2025/05/01', hasta: '2025-05-01' }), /AAAA-MM-DD/);
});

prueba('ventasDelDia devuelve solo ventas completadas del día local con hora e items', () => {
  const ventas = invocar('reportes:ventasDelDia', '2025-04-30');
  assert.deepEqual(ventas.map(v => v.numero), ['VTA-22', 'VTA-antes']);
  assert.deepEqual(ventas.map(v => v.hora), ['22:00', '23:59']);
  assert.equal(ventas[0].items.length, 1);
  assert.equal(ventas[0].items[0].nombre, 'Arroz');
  assert.equal(invocar('reportes:ventasDelDia', '2025-05-01').length, 2);
});

db.close();
console.log('Todas las pruebas de reportes pasaron.');
