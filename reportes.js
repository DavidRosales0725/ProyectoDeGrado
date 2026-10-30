const {
  validarFechaBogota,
  sumarDias,
  limitesFechaBogota,
  horaLocalBogota,
} = require('./fechas');

const MAX_DIAS_REPORTE = 366;

function validarRango(desde, hasta) {
  validarFechaBogota(desde);
  validarFechaBogota(hasta);
  if (desde > hasta) throw new Error('La fecha inicial no puede ser posterior a la fecha final');
  const dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) + 1;
  if (dias > MAX_DIAS_REPORTE) throw new Error(`El rango no puede superar ${MAX_DIAS_REPORTE} días`);
  return dias;
}

function obtenerReportePorDia(db, rango) {
  const desde = rango?.desde;
  const hasta = rango?.hasta;
  const cantidadDias = validarRango(desde, hasta);
  const { inicio } = limitesFechaBogota(desde);
  const { fin } = limitesFechaBogota(sumarDias(hasta, 1));

  const filas = db.prepare(`
    SELECT date(fecha, '-5 hours') AS fecha,
           COUNT(*) AS cantidadVentas,
           COALESCE(SUM(total), 0) AS ingresoTotal,
           COALESCE(SUM(CASE WHEN metodo_pago = 'efectivo' THEN total ELSE 0 END), 0) AS efectivo,
           COALESCE(SUM(CASE WHEN metodo_pago = 'tarjeta' THEN total ELSE 0 END), 0) AS tarjeta,
           COALESCE(SUM(CASE WHEN metodo_pago = 'transferencia' THEN total ELSE 0 END), 0) AS transferencia
    FROM ventas
    WHERE estado = 'completada' AND fecha >= ? AND fecha < ?
    GROUP BY date(fecha, '-5 hours')
  `).all(inicio, fin);
  const porFecha = new Map(filas.map(fila => [fila.fecha, fila]));
  const dias = [];
  for (let offset = 0; offset < cantidadDias; offset += 1) {
    const fecha = sumarDias(desde, offset);
    const fila = porFecha.get(fecha);
    dias.push({
      fecha,
      cantidadVentas: Number(fila?.cantidadVentas ?? 0),
      ingresoTotal: Number(fila?.ingresoTotal ?? 0),
      efectivo: Number(fila?.efectivo ?? 0),
      tarjeta: Number(fila?.tarjeta ?? 0),
      transferencia: Number(fila?.transferencia ?? 0),
    });
  }

  const resumen = dias.reduce((acum, dia) => ({
    cantidadVentas: acum.cantidadVentas + dia.cantidadVentas,
    ingresoTotal: acum.ingresoTotal + dia.ingresoTotal,
    efectivo: acum.efectivo + dia.efectivo,
    tarjeta: acum.tarjeta + dia.tarjeta,
    transferencia: acum.transferencia + dia.transferencia,
  }), { cantidadVentas: 0, ingresoTotal: 0, efectivo: 0, tarjeta: 0, transferencia: 0 });
  resumen.promedioPorDia = resumen.ingresoTotal / cantidadDias;
  const mejorDia = dias.reduce((mejor, dia) =>
    !mejor || dia.ingresoTotal > mejor.ingresoTotal ? dia : mejor, null);
  resumen.mejorDia = mejorDia ? { fecha: mejorDia.fecha, ingresoTotal: mejorDia.ingresoTotal } : null;

  return { dias, resumen };
}

function obtenerVentasDelDia(db, fecha) {
  validarFechaBogota(fecha);
  const { inicio, fin } = limitesFechaBogota(fecha);
  return db.prepare(`
    SELECT id, numero, fecha, cliente, total, metodo_pago AS metodoPago
    FROM ventas
    WHERE estado = 'completada' AND fecha >= ? AND fecha < ?
    ORDER BY fecha ASC, id ASC
  `).all(inicio, fin).map(venta => ({
    ...venta,
    hora: horaLocalBogota(venta.fecha),
    items: db.prepare(`
      SELECT nombre, precio_unit AS precioUnit, cantidad, subtotal,
             producto_id AS productoId, es_libre AS esLibre
      FROM venta_items WHERE venta_id = ? ORDER BY id
    `).all(venta.id).map(item => ({ ...item, esLibre: Boolean(item.esLibre) })),
  }));
}

module.exports = function registrarReportes(ipcMain, db) {
  ipcMain.handle('reportes:porDia', (_, rango) => obtenerReportePorDia(db, rango));
  ipcMain.handle('reportes:ventasDelDia', (_, fecha) => obtenerVentasDelDia(db, fecha));
};

module.exports.obtenerReportePorDia = obtenerReportePorDia;
module.exports.obtenerVentasDelDia = obtenerVentasDelDia;
module.exports.validarRango = validarRango;
