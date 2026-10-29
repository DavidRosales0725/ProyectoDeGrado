const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const registrarProductos = require('../productos');
const { crearTablasProductos } = registrarProductos;

function registrar(db) {
  crearTablasProductos(db);
  const handlers = new Map();
  registrarProductos({
    handle(nombre, handler) {
      assert.equal(handlers.has(nombre), false, `Handler repetido: ${nombre}`);
      handlers.set(nombre, handler);
    },
  }, db);
  return {
    invocar: (canal, ...args) => handlers.get(canal)({}, ...args),
  };
}

function producto(nombre, codigoBarras = '') {
  return {
    nombre,
    categoria: 'Prueba',
    precio: 1200,
    stock: 10,
    stockMin: 2,
    descripcion: '',
    codigoBarras,
  };
}

function prueba(nombre, ejecutar) {
  const db = new DatabaseSync(':memory:');
  try {
    ejecutar(registrar(db), db);
    console.log(`✅ ${nombre}`);
  } finally {
    db.close();
  }
}

prueba('crear producto con código y encontrarlo', ({ invocar }) => {
  const creado = invocar('productos:crear', producto('Leche', '7701234567890'));
  assert.equal(creado.codigoBarras, '7701234567890');
  assert.equal(invocar('productos:buscarPorCodigo', ' 7701234567890 ' ).nombre, 'Leche');
});

prueba('código activo duplicado se rechaza indicando el producto dueño', ({ invocar }) => {
  invocar('productos:crear', producto('Arroz', 'ABC-123'));
  assert.throws(
    () => invocar('productos:crear', producto('Frijol', 'ABC-123')),
    /código de barras.*producto "Arroz"/i,
  );
});

prueba('varios productos pueden tener código vacío o nulo', ({ invocar }) => {
  const uno = invocar('productos:crear', producto('Producto uno', ''));
  const dos = invocar('productos:crear', producto('Producto dos', '   '));
  const tres = invocar('productos:crear', producto('Producto tres', null));
  assert.equal(uno.codigoBarras, null);
  assert.equal(dos.codigoBarras, null);
  assert.equal(tres.codigoBarras, null);
});

prueba('formato inválido se rechaza', ({ invocar }) => {
  assert.throws(
    () => invocar('productos:crear', producto('Producto inválido', 'AB 123')),
    /formato|código de barras/i,
  );
});

prueba('eliminar libera el código para otro producto', ({ invocar }) => {
  const primero = invocar('productos:crear', producto('Producto anterior', 'REUSABLE-1'));
  invocar('productos:eliminar', primero.id);
  const nuevo = invocar('productos:crear', producto('Producto nuevo', 'REUSABLE-1'));
  assert.equal(nuevo.codigoBarras, 'REUSABLE-1');
  assert.equal(invocar('productos:buscarPorCodigo', 'REUSABLE-1').nombre, 'Producto nuevo');
});

prueba('productos inactivos no se encuentran por código', ({ invocar }, db) => {
  const creado = invocar('productos:crear', producto('Producto inactivo', 'INACTIVO-1'));
  db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(creado.id);
  assert.equal(invocar('productos:buscarPorCodigo', 'INACTIVO-1'), null);
});

(() => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE productos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        categoria TEXT NOT NULL DEFAULT '',
        precio REAL NOT NULL CHECK (precio >= 0),
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        stock_min INTEGER NOT NULL DEFAULT 0 CHECK (stock_min >= 0),
        descripcion TEXT NOT NULL DEFAULT '',
        activo INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO productos (nombre, precio, stock) VALUES ('Producto legado', 500, 4);
    `);
    crearTablasProductos(db);
    const columnas = db.prepare('PRAGMA table_info(productos)').all();
    assert.equal(columnas.some(columna => columna.name === 'codigo_barras'), true);
    assert.equal(db.prepare('SELECT nombre, stock FROM productos WHERE id = 1').get().nombre, 'Producto legado');
    assert.equal(db.prepare('SELECT stock FROM productos WHERE id = 1').get().stock, 4);
    crearTablasProductos(db); // La migración puede ejecutarse otra vez sin alterar filas.
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM productos').get().n, 1);
    console.log('✅ migrar tabla antigua sin perder filas');
  } finally {
    db.close();
  }
})();

console.log('Todas las pruebas de códigos de barras pasaron.');
