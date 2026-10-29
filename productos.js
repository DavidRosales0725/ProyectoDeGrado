const { LIMITE_STOCK, LIMITE_PRECIO } = require('./limites');

function crearTablasProductos(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS productos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      categoria TEXT NOT NULL DEFAULT '',
      precio REAL NOT NULL CHECK (precio >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      stock_min INTEGER NOT NULL DEFAULT 0 CHECK (stock_min >= 0),
      descripcion TEXT NOT NULL DEFAULT '',
      activo INTEGER NOT NULL DEFAULT 1,
      codigo_barras TEXT
    );
  `);

  const columnas = db.prepare('PRAGMA table_info(productos)').all();
  if (!columnas.some(columna => columna.name === 'codigo_barras')) {
    db.exec('ALTER TABLE productos ADD COLUMN codigo_barras TEXT');
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_productos_codigo_barras
    ON productos(codigo_barras)
    WHERE codigo_barras IS NOT NULL;
  `);
}

function validar(p) {
  const nombre = String(p?.nombre ?? '').trim();
  const categoria = String(p?.categoria ?? '').trim();
  const descripcion = String(p?.descripcion ?? '').trim();
  const precio = Number(p?.precio);
  const stock = Number(p?.stock);
  const stockMin = Number(p?.stockMin ?? 0);
  const codigoEntrada = p?.codigoBarras == null ? '' : String(p.codigoBarras).trim();
  const codigoBarras = codigoEntrada || null;

  if (!nombre) throw new Error('El nombre es obligatorio');
  if (!Number.isFinite(precio) || precio < 0) throw new Error('El precio debe ser un número finito mayor o igual a 0');
  if (precio > LIMITE_PRECIO) throw new Error('El precio no puede superar $100.000.000');
  if (!Number.isSafeInteger(stock) || stock < 0) throw new Error('El stock debe ser un entero seguro mayor o igual a 0');
  if (stock > LIMITE_STOCK) throw new Error('El stock no puede superar 1.000.000 de unidades');
  if (!Number.isSafeInteger(stockMin) || stockMin < 0) throw new Error('El stock mínimo debe ser un entero seguro mayor o igual a 0');
  if (stockMin > LIMITE_STOCK) throw new Error('El stock mínimo no puede superar 1.000.000 de unidades');
  if (codigoBarras && !/^[A-Za-z0-9._-]{3,48}$/.test(codigoBarras)) {
    throw new Error('El código de barras debe tener entre 3 y 48 caracteres: letras, números, punto, guion o guion bajo');
  }

  return { nombre, categoria, descripcion, precio, stock, stockMin, codigoBarras };
}

const SELECT = `SELECT id, nombre, categoria, precio, stock,
                       stock_min AS stockMin, descripcion,
                       codigo_barras AS codigoBarras
                FROM productos`;

function validarCodigoDisponible(db, codigoBarras, idActual = null) {
  if (!codigoBarras) return;
  const existente = idActual == null
    ? db.prepare('SELECT nombre FROM productos WHERE codigo_barras = ? AND activo = 1').get(codigoBarras)
    : db.prepare('SELECT nombre FROM productos WHERE codigo_barras = ? AND activo = 1 AND id <> ?').get(codigoBarras, idActual);
  if (existente) {
    throw new Error(`El código de barras "${codigoBarras}" ya está registrado para el producto "${existente.nombre}"`);
  }
}

function ejecutarConErrorCodigo(db, codigoBarras, accion) {
  try {
    return accion();
  } catch (error) {
    if (/UNIQUE constraint failed: productos\.codigo_barras|idx_productos_codigo_barras/i.test(String(error?.message ?? error))) {
      const existente = codigoBarras
        ? db.prepare('SELECT nombre FROM productos WHERE codigo_barras = ? AND activo = 1').get(codigoBarras)
        : null;
      const dueño = existente ? ` para el producto "${existente.nombre}"` : ' para otro producto';
      throw new Error(`El código de barras "${codigoBarras}" ya está registrado${dueño}`);
    }
    throw error;
  }
}

module.exports = function registrarProductos(ipcMain, db) {
  ipcMain.handle('productos:listar', () =>
    db.prepare(`${SELECT} WHERE activo = 1 ORDER BY nombre`).all());

  ipcMain.handle('productos:crear', (_, datos) => {
    const p = validar(datos);
    validarCodigoDisponible(db, p.codigoBarras);
    const r = ejecutarConErrorCodigo(db, p.codigoBarras, () => db.prepare(
      'INSERT INTO productos (nombre, categoria, precio, stock, stock_min, descripcion, codigo_barras) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(p.nombre, p.categoria, p.precio, p.stock, p.stockMin, p.descripcion, p.codigoBarras));
    return db.prepare(`${SELECT} WHERE id = ?`).get(Number(r.lastInsertRowid));
  });

  ipcMain.handle('productos:actualizar', (_, id, datos) => {
    const p = validar(datos);
    validarCodigoDisponible(db, p.codigoBarras, id);
    ejecutarConErrorCodigo(db, p.codigoBarras, () => db.prepare(
      'UPDATE productos SET nombre=?, categoria=?, precio=?, stock=?, stock_min=?, descripcion=?, codigo_barras=? WHERE id=? AND activo=1'
    ).run(p.nombre, p.categoria, p.precio, p.stock, p.stockMin, p.descripcion, p.codigoBarras, id));
    return db.prepare(`${SELECT} WHERE id = ?`).get(id);
  });

  ipcMain.handle('productos:stockBajo', () =>
    db.prepare('SELECT COUNT(*) AS n FROM productos WHERE activo = 1 AND stock <= stock_min').get().n);

  ipcMain.handle('productos:buscarPorCodigo', (_, codigo) => {
    const codigoBarras = String(codigo ?? '').trim();
    if (!codigoBarras) return null;
    return db.prepare(`${SELECT} WHERE codigo_barras = ? AND activo = 1`).get(codigoBarras) ?? null;
  });

  ipcMain.handle('productos:eliminar', (_, id) => {
    db.prepare('UPDATE productos SET activo = 0, codigo_barras = NULL WHERE id = ?').run(id);
    return true;
  });
};

module.exports.crearTablasProductos = crearTablasProductos;
