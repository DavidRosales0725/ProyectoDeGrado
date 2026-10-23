// database.js
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { app } = require('electron');

const db = new DatabaseSync(path.join(app.getPath('userData'), 'tienda.db'));

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS productos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    categoria TEXT NOT NULL DEFAULT '',
    precio REAL NOT NULL CHECK (precio >= 0),
    stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
    stock_min INTEGER NOT NULL DEFAULT 0 CHECK (stock_min >= 0),
    descripcion TEXT NOT NULL DEFAULT '',
    activo INTEGER NOT NULL DEFAULT 1
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS movimientos_inventario (
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

require('./ventas').crearTablasVentas(db);

// SOLO DESARROLLO: datos de demostración si la tabla está vacía (luego lo quitamos)
const { n } = db.prepare('SELECT COUNT(*) AS n FROM productos').get();
if (n === 0) {
  const demo = [
    ['Camisa Manga Corta', 'Ropa', 35000, 48, 10, 'Camisa algodón tallas S-XL'],
    ['Pantalón Jean', 'Ropa', 89000, 22, 8, 'Jean clásico corte recto'],
    ['Zapatos Casuales', 'Calzado', 145000, 14, 5, 'Cuero sintético unisex'],
    ['Bolso de Mano', 'Accesorios', 68000, 7, 5, 'Diseño moderno varios colores'],
    ['Reloj Clásico', 'Accesorios', 210000, 3, 5, 'Correa de cuero café'],
    ['Bufanda Lana', 'Ropa', 28000, 31, 10, 'Lana natural colores variados'],
    ['Tenis Deportivos', 'Calzado', 178000, 9, 5, 'Running y uso casual'],
    ['Gorra Bordada', 'Accesorios', 22000, 45, 10, 'Ajuste universal visera curva'],
    ['Vestido Floral', 'Ropa', 95000, 12, 5, 'Tela liviana ideal verano'],
    ['Sandalias de Playa', 'Calzado', 42000, 19, 8, 'Material EVA resistente']
  ];
  const ins = db.prepare(
    'INSERT INTO productos (nombre, categoria, precio, stock, stock_min, descripcion) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  try {
    demo.forEach(d => ins.run(...d));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = db;
