const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const registrarProductos = require('../productos');
const registrarInventario = require('../inventario');
const registrarVentas = require('../ventas');
const { crearTablasProductos } = registrarProductos;
const { crearTablasVentas } = registrarVentas;

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
crearTablasProductos(db);
db.exec(`
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

const handlers = new Map();
const ipcFalso = {
  handle(nombre, fn) {
    assert.equal(handlers.has(nombre), false, `Handler duplicado: ${nombre}`);
    handlers.set(nombre, fn);
  },
};
registrarProductos(ipcFalso, db);
registrarInventario(ipcFalso, db);
registrarVentas(ipcFalso, db);
const invocar = (canal, ...args) => handlers.get(canal)({}, ...args);

function datosProducto(nombre, { stock = 5, precio = 1200 } = {}) {
  return { nombre, categoria: 'Prueba', descripcion: '', stock, stockMin: 1, precio };
}

try {
  assert.throws(
    () => invocar('productos:crear', datosProducto('Stock absurdo', { stock: 444444444444444444 })),
    /stock/i,
  );
  console.log('✅ rechaza un stock mayor a Number.MAX_SAFE_INTEGER');

  assert.throws(
    () => invocar('productos:crear', datosProducto('Stock excedido', { stock: 1000001 })),
    /1\.000\.000/,
  );
  const maximo = invocar('productos:crear', datosProducto('Stock máximo', { stock: 1000000 }));
  assert.equal(maximo.stock, 1000000);
  console.log('✅ rechaza stock 1.000.001 y acepta 1.000.000');

  assert.throws(
    () => invocar('productos:crear', datosProducto('Precio excedido', { precio: 1000000000 })),
    /100\.000\.000/,
  );
  console.log('✅ rechaza precio superior al límite');

  const productoInventario = invocar('productos:crear', datosProducto('Inventario al borde', { stock: 999999 }));
  assert.throws(
    () => invocar('inventario:ajustar', {
      productoId: productoInventario.id,
      tipo: 'entrada',
      cantidad: 2,
      motivo: 'Prueba del límite',
    }),
    /stock resultante.*1\.000\.000/i,
  );
  assert.equal(db.prepare('SELECT stock FROM productos WHERE id = ?').get(productoInventario.id).stock, 999999);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM movimientos_inventario').get().n, 0);
  console.log('✅ rechaza una entrada que excede el máximo y conserva el stock');

  const listado = invocar('productos:listar');
  assert.equal(listado.length, 2);
  assert.equal(listado.find(p => p.nombre === 'Stock máximo').stock, 1000000);
  console.log('✅ productos:listar sigue funcionando después de los rechazos');

  assert.throws(
    () => invocar('ventas:registrar', {
      cliente: 'Prueba',
      metodoPago: 'efectivo',
      montoRecibido: 1e15,
      items: [{ productoId: maximo.id, cantidad: 1 }],
    }),
    /monto recibido.*1\.000\.000\.000\.000/i,
  );
  console.log('✅ rechaza un monto recibido en efectivo superior al límite');

  console.log('Todas las pruebas de límites pasaron.');
} finally {
  db.close();
}
