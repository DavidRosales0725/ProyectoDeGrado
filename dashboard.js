const { limitesDiaBogota } = require('./fechas');

function calcularResumen(db, ahora = new Date()) {
  const { inicio, fin } = limitesDiaBogota(
    ahora instanceof Date ? ahora : new Date(ahora),
  );
  const productos = db
    .prepare(
      `
    SELECT COUNT(*) AS totalProductos,
           COALESCE(SUM(CASE WHEN stock <= stock_min THEN 1 ELSE 0 END), 0) AS stockBajo
    FROM productos
    WHERE activo = 1
  `,
    )
    .get();

  const ventas = db
    .prepare(
      `
    SELECT COUNT(*) AS totalVentas,
           COALESCE(SUM(total), 0) AS ingresoTotal
    FROM ventas
    WHERE estado = 'completada'
  `,
    )
    .get();

  const ventasHoy = db
    .prepare(
      `
    SELECT COUNT(*) AS ventasHoy,
           COALESCE(SUM(total), 0) AS ingresoHoy
    FROM ventas
    WHERE estado = 'completada' AND fecha >= ? AND fecha < ?
  `,
    )
    .get(inicio, fin);

  const ultimasVentas = db
    .prepare(
      `
    SELECT numero, cliente, fecha, total, estado, metodo_pago AS metodoPago
    FROM ventas
    ORDER BY fecha DESC, id DESC
    LIMIT 5
  `,
    )
    .all();

  const productosStockBajo = db
    .prepare(
      `
    SELECT nombre, stock, stock_min AS stockMin
    FROM productos
    WHERE activo = 1 AND stock <= stock_min
    ORDER BY stock ASC, nombre COLLATE NOCASE ASC
    LIMIT 8
  `,
    )
    .all();

  return {
    totalProductos: Number(productos.totalProductos),
    stockBajo: Number(productos.stockBajo),
    totalVentas: Number(ventas.totalVentas),
    ingresoTotal: Number(ventas.ingresoTotal),
    ventasHoy: Number(ventasHoy.ventasHoy),
    ingresoHoy: Number(ventasHoy.ingresoHoy),
    ultimasVentas,
    productosStockBajo,
  };
}

module.exports = function registrarDashboard(ipcMain, db) {
  ipcMain.handle("dashboard:resumen", () => calcularResumen(db));
};

module.exports.calcularResumen = calcularResumen;
module.exports.limitesDiaBogota = limitesDiaBogota;
