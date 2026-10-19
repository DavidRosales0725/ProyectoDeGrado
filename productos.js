// productos.js
function validar(p) {
  const nombre = String(p?.nombre ?? '').trim();
  const categoria = String(p?.categoria ?? '').trim();
  const descripcion = String(p?.descripcion ?? '').trim();
  const precio = Number(p?.precio);
  const stock = Number(p?.stock);
  const stockMin = Number(p?.stockMin ?? 0);

  if (!nombre) throw new Error('El nombre es obligatorio');
  if (!Number.isFinite(precio) || precio < 0) throw new Error('Precio inválido');
  if (!Number.isInteger(stock) || stock < 0) throw new Error('El stock debe ser un entero mayor o igual a 0');
  if (!Number.isInteger(stockMin) || stockMin < 0) throw new Error('El stock mínimo debe ser un entero mayor o igual a 0');

  return { nombre, categoria, descripcion, precio, stock, stockMin };
}

const SELECT = `SELECT id, nombre, categoria, precio, stock, stock_min AS stockMin, descripcion
                FROM productos`;

module.exports = function registrarProductos(ipcMain, db) {
  ipcMain.handle('productos:listar', () =>
    db.prepare(`${SELECT} WHERE activo = 1 ORDER BY nombre`).all());

  ipcMain.handle('productos:crear', (_, datos) => {
    const p = validar(datos);
    const r = db.prepare(
      'INSERT INTO productos (nombre, categoria, precio, stock, stock_min, descripcion) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(p.nombre, p.categoria, p.precio, p.stock, p.stockMin, p.descripcion);
    return db.prepare(`${SELECT} WHERE id = ?`).get(r.lastInsertRowid);
  });

  ipcMain.handle('productos:actualizar', (_, id, datos) => {
    const p = validar(datos);
    db.prepare(
      'UPDATE productos SET nombre=?, categoria=?, precio=?, stock=?, stock_min=?, descripcion=? WHERE id=? AND activo=1'
    ).run(p.nombre, p.categoria, p.precio, p.stock, p.stockMin, p.descripcion, id);
    return db.prepare(`${SELECT} WHERE id = ?`).get(id);
  });

  ipcMain.handle('productos:eliminar', (_, id) => {
    db.prepare('UPDATE productos SET activo = 0 WHERE id = ?').run(id);
    return true;
  });
};