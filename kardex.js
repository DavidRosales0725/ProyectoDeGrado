const { handle } = require('./autorizacion');
const { fechaLocalBogota, validarFechaBogota, sumarDias, limitesFechaBogota } = require('./fechas');

const MAX_FILAS = 2000;
const MAX_DIAS = 366;

function crearTablaMovimientos(db, nombre = 'movimientos_inventario') {
  if (!['movimientos_inventario', 'movimientos_inventario_nueva'].includes(nombre)) {
    throw new Error('Nombre de tabla inválido');
  }
  db.exec(`
    CREATE TABLE ${nombre} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id INTEGER NOT NULL REFERENCES productos(id),
      usuario_id INTEGER NULL REFERENCES usuarios(id),
      venta_id INTEGER NULL REFERENCES ventas(id),
      tipo TEXT NOT NULL CHECK (tipo IN ('inicial','entrada','salida','manual','venta','anulacion')),
      diferencia INTEGER NOT NULL,
      stock_anterior INTEGER NOT NULL CHECK (stock_anterior >= 0),
      stock_nuevo INTEGER NOT NULL CHECK (stock_nuevo >= 0),
      motivo TEXT NOT NULL DEFAULT '',
      fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

function asegurarEsquemaMovimientos(db) {
  const existe = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='movimientos_inventario'").get();
  if (!existe) {
    crearTablaMovimientos(db);
    return;
  }

  const columnas = db.prepare('PRAGMA table_info(movimientos_inventario)').all();
  const nombres = new Set(columnas.map(columna => columna.name));
  const sql = String(existe.sql ?? '').toLowerCase();
  const migrada = nombres.has('usuario_id') && nombres.has('venta_id')
    && sql.includes("'inicial'") && sql.includes("'anulacion'");
  if (migrada) return;

  const usuarioId = nombres.has('usuario_id') ? 'usuario_id' : 'NULL';
  const ventaId = nombres.has('venta_id') ? 'venta_id' : 'NULL';
  const motivo = nombres.has('motivo') ? 'motivo' : "''";
  const fecha = nombres.has('fecha') ? 'fecha' : "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DROP TABLE IF EXISTS movimientos_inventario_nueva');
    crearTablaMovimientos(db, 'movimientos_inventario_nueva');
    db.exec(`
      INSERT INTO movimientos_inventario_nueva
        (id, producto_id, usuario_id, venta_id, tipo, diferencia, stock_anterior, stock_nuevo, motivo, fecha)
      SELECT id, producto_id, ${usuarioId}, ${ventaId}, tipo, diferencia, stock_anterior, stock_nuevo, ${motivo}, ${fecha}
      FROM movimientos_inventario;
      DROP TABLE movimientos_inventario;
      ALTER TABLE movimientos_inventario_nueva RENAME TO movimientos_inventario;
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function fechaPosterior(fechaAnterior) {
  const ahora = new Date();
  const anterior = Date.parse(fechaAnterior);
  const fecha = Number.isFinite(anterior) && anterior >= ahora.getTime()
    ? new Date(anterior + 1)
    : ahora;
  return fecha.toISOString();
}

function conciliarSaldosExistentes(db) {
  const existe = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='movimientos_inventario'").get();
  if (!existe) throw new Error('La tabla de movimientos no existe');
  db.exec('BEGIN IMMEDIATE');
  try {
    const productos = db.prepare('SELECT id, stock FROM productos ORDER BY id').all();
    const ultimoMovimiento = db.prepare(`
      SELECT fecha, stock_nuevo FROM movimientos_inventario
      WHERE producto_id = ? ORDER BY fecha DESC, id DESC LIMIT 1
    `);
    const insertar = db.prepare(`
      INSERT INTO movimientos_inventario
        (producto_id, usuario_id, venta_id, tipo, diferencia, stock_anterior, stock_nuevo, motivo, fecha)
      VALUES (?, NULL, NULL, 'manual', ?, ?, ?, 'Saldo inicial al activar el kardex', ?)
    `);

    for (const producto of productos) {
      const ultimo = ultimoMovimiento.get(producto.id);
      const stockActual = Number(producto.stock);
      if (ultimo && Number(ultimo.stock_nuevo) === stockActual) continue;
      const stockAnterior = ultimo ? Number(ultimo.stock_nuevo) : 0;
      const fecha = fechaPosterior(ultimo?.fecha);
      insertar.run(producto.id, stockActual - stockAnterior, stockAnterior, stockActual, fecha);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function normalizarRango(filtros = {}, ahora = new Date()) {
  let desde = filtros.desde;
  let hasta = filtros.hasta;
  if (desde == null && hasta == null) {
    hasta = fechaLocalBogota(ahora);
    desde = sumarDias(hasta, -29);
  }
  validarFechaBogota(desde);
  validarFechaBogota(hasta);
  if (desde > hasta) throw new Error('La fecha inicial no puede ser posterior a la fecha final');
  const dias = Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000) + 1;
  if (dias > MAX_DIAS) throw new Error(`El rango no puede superar ${MAX_DIAS} días`);
  return { desde, hasta };
}

function consultar(db, filtros = {}, ahora = new Date()) {
  const productoId = Number(filtros?.productoId);
  if (!Number.isSafeInteger(productoId) || productoId <= 0) throw new Error('Selecciona un producto válido');
  if (!db.prepare('SELECT 1 AS ok FROM productos WHERE id = ?').get(productoId)) {
    throw new Error('El producto no existe');
  }

  const { desde, hasta } = normalizarRango(filtros, ahora);
  const { inicio } = limitesFechaBogota(desde);
  const { fin } = limitesFechaBogota(hasta);

  const saldoAnterior = db.prepare(`
    SELECT stock_nuevo FROM movimientos_inventario
    WHERE producto_id = ? AND fecha < ? ORDER BY fecha DESC, id DESC LIMIT 1
  `).get(productoId, inicio);
  const saldoInicial = Number(saldoAnterior?.stock_nuevo ?? 0);
  const agregado = db.prepare(`
    SELECT COUNT(*) AS cantidad,
      COALESCE(SUM(CASE WHEN diferencia > 0 THEN diferencia ELSE 0 END), 0) AS totalEntradas,
      COALESCE(SUM(CASE WHEN diferencia < 0 THEN -diferencia ELSE 0 END), 0) AS totalSalidas
    FROM movimientos_inventario
    WHERE producto_id = ? AND fecha >= ? AND fecha < ?
  `).get(productoId, inicio, fin);
  const saldoFinalFila = db.prepare(`
    SELECT stock_nuevo FROM movimientos_inventario
    WHERE producto_id = ? AND fecha < ? ORDER BY fecha DESC, id DESC LIMIT 1
  `).get(productoId, fin);
  const filas = db.prepare(`
    SELECT m.id, m.fecha, m.tipo, m.diferencia, m.stock_anterior AS stockAnterior,
           m.stock_nuevo AS saldo, m.motivo, u.nombre AS usuario, v.numero AS ventaNumero
    FROM movimientos_inventario m
    LEFT JOIN usuarios u ON u.id = m.usuario_id
    LEFT JOIN ventas v ON v.id = m.venta_id
    WHERE m.producto_id = ? AND m.fecha >= ? AND m.fecha < ?
    ORDER BY m.fecha ASC, m.id ASC
    LIMIT ?
  `).all(productoId, inicio, fin, MAX_FILAS + 1);
  const truncado = Number(agregado.cantidad) > MAX_FILAS;

  return {
    productoId,
    desde,
    hasta,
    filas: filas.slice(0, MAX_FILAS).map(fila => ({
      id: Number(fila.id),
      fecha: fila.fecha,
      tipo: fila.tipo,
      entrada: Number(fila.diferencia) > 0 ? Number(fila.diferencia) : 0,
      salida: Number(fila.diferencia) < 0 ? Math.abs(Number(fila.diferencia)) : 0,
      stockAnterior: Number(fila.stockAnterior),
      saldo: Number(fila.saldo),
      motivo: fila.motivo,
      usuario: fila.usuario ?? null,
      ventaNumero: fila.ventaNumero ?? null,
    })),
    resumen: {
      saldoInicial,
      totalEntradas: Number(agregado.totalEntradas),
      totalSalidas: Number(agregado.totalSalidas),
      saldoFinal: Number(saldoFinalFila?.stock_nuevo ?? saldoInicial),
    },
    truncado,
  };
}

function registrarKardex(ipcMain, db) {
  handle(ipcMain, 'kardex:consultar', ['administrador', 'vendedor'], (_, sesion, filtros) => consultar(db, filtros));
}

module.exports = registrarKardex;
module.exports.crearTablaMovimientos = crearTablaMovimientos;
module.exports.asegurarEsquemaMovimientos = asegurarEsquemaMovimientos;
module.exports.conciliarSaldosExistentes = conciliarSaldosExistentes;
module.exports.normalizarRango = normalizarRango;
module.exports.consultar = consultar;
