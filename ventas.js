const {
  LIMITE_STOCK,
  LIMITE_PRECIO,
  LIMITE_MONTO,
  MAX_CLIENTE,
  MAX_NOMBRE,
  validarTextoUnaLinea,
} = require('./limites');
const { handle } = require('./autorizacion');
const { fechaLocalBogota } = require('./fechas');

const MAX_LINEAS_VENTA = 100;

function crearTablasVentas(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      cliente TEXT NOT NULL,
      total REAL NOT NULL CHECK (total >= 0),
      metodo_pago TEXT NOT NULL CHECK (metodo_pago IN ('efectivo','tarjeta','transferencia')),
      monto_recibido REAL NOT NULL CHECK (monto_recibido >= 0),
      cambio REAL NOT NULL CHECK (cambio >= 0),
      estado TEXT NOT NULL DEFAULT 'completada' CHECK (estado IN ('completada','anulada'))
    );
  `);

  asegurarEsquemaAnulaciones(db);

  const tabla = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'venta_items'").get();
  if (!tabla) {
    crearTablaItemsVentas(db, 'venta_items');
    return;
  }

  const columnas = db.prepare('PRAGMA table_info(venta_items)').all();
  const esLibre = columnas.find(columna => columna.name === 'es_libre');
  const productoId = columnas.find(columna => columna.name === 'producto_id');
  if (esLibre && productoId && Number(productoId.notnull) === 0) return;

  const tieneEsLibre = Boolean(esLibre);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('DROP TABLE IF EXISTS venta_items_nueva');
    crearTablaItemsVentas(db, 'venta_items_nueva');
    const expresionEsLibre = tieneEsLibre ? 'COALESCE(es_libre, 0)' : '0';
    db.exec(`
      INSERT INTO venta_items_nueva
        (id, venta_id, producto_id, nombre, precio_unit, cantidad, subtotal, es_libre)
      SELECT id, venta_id, producto_id, nombre, precio_unit, cantidad, subtotal, ${expresionEsLibre}
      FROM venta_items;
      DROP TABLE venta_items;
      ALTER TABLE venta_items_nueva RENAME TO venta_items;
    `);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function asegurarEsquemaAnulaciones(db) {
  const columnas = new Set(db.prepare('PRAGMA table_info(ventas)').all().map(columna => columna.name));
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!columnas.has('anulada_por')) db.exec('ALTER TABLE ventas ADD COLUMN anulada_por INTEGER NULL REFERENCES usuarios(id)');
    if (!columnas.has('anulada_en')) db.exec('ALTER TABLE ventas ADD COLUMN anulada_en TEXT NULL');
    if (!columnas.has('motivo_anulacion')) db.exec('ALTER TABLE ventas ADD COLUMN motivo_anulacion TEXT NULL');
    if (!columnas.has('corrige_a_id')) db.exec('ALTER TABLE ventas ADD COLUMN corrige_a_id INTEGER NULL REFERENCES ventas(id)');
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS ventas_estado_insert_check
      BEFORE INSERT ON ventas WHEN NEW.estado NOT IN ('completada','anulada')
      BEGIN SELECT RAISE(ABORT, 'Estado de venta inválido'); END;
      CREATE TRIGGER IF NOT EXISTS ventas_estado_update_check
      BEFORE UPDATE OF estado ON ventas WHEN NEW.estado NOT IN ('completada','anulada')
      BEGIN SELECT RAISE(ABORT, 'Estado de venta inválido'); END;
      COMMIT;
    `);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function crearTablaItemsVentas(db, tabla) {
  if (!['venta_items', 'venta_items_nueva'].includes(tabla)) {
    throw new Error('Nombre de tabla de detalle inválido');
  }
  db.exec(`
    CREATE TABLE ${tabla} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venta_id INTEGER NOT NULL REFERENCES ventas(id),
      producto_id INTEGER REFERENCES productos(id),
      nombre TEXT NOT NULL,
      precio_unit REAL NOT NULL CHECK (precio_unit >= 0),
      cantidad INTEGER NOT NULL CHECK (cantidad > 0),
      subtotal REAL NOT NULL CHECK (subtotal >= 0),
      es_libre INTEGER NOT NULL DEFAULT 0 CHECK (es_libre IN (0, 1)),
      CHECK (
        (es_libre = 1 AND producto_id IS NULL) OR
        (es_libre = 0 AND producto_id IS NOT NULL)
      )
    );
  `);
}

const METODOS_PAGO = new Set(['efectivo', 'tarjeta', 'transferencia']);

function obtenerVenta(db, id) {
  const venta = db.prepare(`
    SELECT v.id, v.numero, v.fecha, v.cliente, v.total, v.metodo_pago AS metodoPago,
           v.monto_recibido AS montoRecibido, v.cambio, v.estado,
           v.usuario_id AS usuarioId, u.nombre AS usuario,
           anulador.nombre AS anuladaPorNombre, v.anulada_en AS anuladaEn,
           v.motivo_anulacion AS motivoAnulacion, original.numero AS corrigeA,
           (SELECT nueva.numero FROM ventas nueva WHERE nueva.corrige_a_id = v.id ORDER BY nueva.id DESC LIMIT 1) AS corregidaPor
    FROM ventas v LEFT JOIN usuarios u ON u.id = v.usuario_id
    LEFT JOIN usuarios anulador ON anulador.id = v.anulada_por
    LEFT JOIN ventas original ON original.id = v.corrige_a_id WHERE v.id = ?
  `).get(id);
  if (!venta) return null;
  venta.items = db.prepare(`
    SELECT producto_id AS productoId, nombre, precio_unit AS precioUnit,
           cantidad, subtotal, es_libre AS esLibre
    FROM venta_items WHERE venta_id = ? ORDER BY id
  `).all(id).map(item => ({ ...item, esLibre: Boolean(item.esLibre) }));
  return venta;
}

function validarMotivo(motivoEntrada) {
  const motivo = validarTextoUnaLinea(motivoEntrada, 'El motivo de anulación', 200);
  if (motivo.length < 3) throw new Error('El motivo de anulación debe tener entre 3 y 200 caracteres');
  return motivo;
}

function validarPermisoVenta(db, sesion, ventaId) {
  if (!Number.isSafeInteger(ventaId) || ventaId <= 0) throw new Error('La venta indicada no es válida');
  const venta = db.prepare('SELECT id, numero, fecha, estado FROM ventas WHERE id = ?').get(ventaId);
  if (!venta) throw new Error('La venta no existe');
  if (venta.estado !== 'completada') throw new Error('Solo se pueden anular ventas completadas');
  if (sesion.rol === 'vendedor') {
    const propia = db.prepare('SELECT 1 AS ok FROM ventas WHERE id = ? AND usuario_id = ?').get(ventaId, sesion.id);
    if (!propia) throw new Error('El vendedor solo puede anular sus propias ventas');
    if (fechaLocalBogota(venta.fecha) !== fechaLocalBogota(new Date())) {
      throw new Error('El vendedor solo puede anular ventas del día local actual');
    }
  }
  return venta;
}

function devolverStockVenta(db, venta, sesion, motivo) {
  const items = db.prepare(`
    SELECT producto_id AS productoId, cantidad FROM venta_items
    WHERE venta_id = ? AND es_libre = 0 ORDER BY id
  `).all(venta.id);
  const buscar = db.prepare('SELECT stock FROM productos WHERE id = ?');
  const actualizar = db.prepare('UPDATE productos SET stock = ? WHERE id = ?');
  const movimiento = db.prepare(`
    INSERT INTO movimientos_inventario
      (producto_id, usuario_id, venta_id, tipo, diferencia, stock_anterior, stock_nuevo, motivo)
    VALUES (?, ?, ?, 'anulacion', ?, ?, ?, ?)
  `);
  for (const item of items) {
    const producto = buscar.get(item.productoId);
    if (!producto) throw new Error(`No se encontró el producto ${item.productoId} para devolver el stock`);
    const anterior = Number(producto.stock);
    const nuevo = anterior + Number(item.cantidad);
    if (!Number.isSafeInteger(nuevo) || nuevo > LIMITE_STOCK) {
      throw new Error(`No se puede anular: el stock de un producto superaría 1.000.000 de unidades`);
    }
    actualizar.run(nuevo, item.productoId);
    movimiento.run(item.productoId, sesion.id, venta.id, Number(item.cantidad), anterior, nuevo, `Anulación ${venta.numero}: ${motivo}`);
  }
}

function registrarVentaEnTransaccion(db, sesion, datos, opciones = {}) {
  const items = normalizarItems(datos?.items);
  const cliente = validarTextoUnaLinea(datos?.cliente, 'El cliente', MAX_CLIENTE) || 'Cliente general';
  const metodoPago = String(datos?.metodoPago ?? '');
  if (!METODOS_PAGO.has(metodoPago)) throw new Error('Selecciona un método de pago válido');
  const montoSolicitado = Number(datos?.montoRecibido);
  if (metodoPago === 'efectivo' && (!Number.isFinite(montoSolicitado) || montoSolicitado < 0)) {
    throw new Error('Ingresa un monto recibido finito y mayor o igual a 0');
  }
  if (metodoPago === 'efectivo' && montoSolicitado > LIMITE_MONTO) {
    throw new Error('El monto recibido no puede superar $1.000.000.000.000');
  }

  const lineas = items.map(item => {
    if (item.libre) return item;
    const producto = db.prepare(`SELECT id, nombre, precio, stock FROM productos WHERE id = ? AND activo = 1`).get(item.productoId);
    if (!producto) throw new Error(`El producto con código ${item.productoId} no existe o está inactivo`);
    if (producto.stock < item.cantidad) {
      throw new Error(`Stock insuficiente para "${producto.nombre}": disponible ${producto.stock}, solicitado ${item.cantidad}`);
    }
    return { ...item, producto };
  });
  const total = lineas.reduce((suma, item) => suma + (item.libre ? item.subtotal : item.producto.precio * item.cantidad), 0);
  if (!Number.isFinite(total) || total < 0) throw new Error('No se pudo calcular el total de la venta');
  const montoRecibido = metodoPago === 'efectivo' ? montoSolicitado : total;
  if (metodoPago === 'efectivo' && montoRecibido < total) {
    throw new Error(`El monto recibido es insuficiente. Total: ${total}; recibido: ${montoRecibido}`);
  }
  const cambio = metodoPago === 'efectivo' ? montoRecibido - total : 0;
  const creada = db.prepare(`
    INSERT INTO ventas (numero, fecha, cliente, total, metodo_pago, monto_recibido, cambio, usuario_id, corrige_a_id)
    VALUES ('PENDIENTE', COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')), ?, ?, ?, ?, ?, ?, ?)
  `).run(opciones.fecha ?? null, cliente, total, metodoPago, montoRecibido, cambio, sesion.id, opciones.corrigeA ?? null);
  const id = Number(creada.lastInsertRowid);
  const numero = `VTA-${String(id).padStart(6, '0')}`;
  db.prepare('UPDATE ventas SET numero = ? WHERE id = ?').run(numero, id);
  const insertarItem = db.prepare(`INSERT INTO venta_items (venta_id, producto_id, nombre, precio_unit, cantidad, subtotal, es_libre) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const actualizarStock = db.prepare('UPDATE productos SET stock = stock - ? WHERE id = ? AND stock >= ? AND activo = 1');
  const insertarMovimiento = db.prepare(`
    INSERT INTO movimientos_inventario (producto_id, usuario_id, venta_id, tipo, diferencia, stock_anterior, stock_nuevo, motivo)
    VALUES (?, ?, ?, 'venta', ?, ?, ?, ?)
  `);
  for (const item of lineas) {
    if (item.libre) {
      insertarItem.run(id, null, item.nombre, item.precio, item.cantidad, item.subtotal, 1);
      continue;
    }
    const subtotal = item.producto.precio * item.cantidad;
    insertarItem.run(id, item.productoId, item.producto.nombre, item.producto.precio, item.cantidad, subtotal, 0);
    const actualizado = actualizarStock.run(item.cantidad, item.productoId, item.cantidad);
    if (Number(actualizado.changes) !== 1) {
      const actual = db.prepare('SELECT nombre, stock FROM productos WHERE id = ?').get(item.productoId);
      throw new Error(`Stock insuficiente para "${actual?.nombre ?? item.producto.nombre}": disponible ${actual?.stock ?? 0}, solicitado ${item.cantidad}`);
    }
    insertarMovimiento.run(item.productoId, sesion.id, id, -item.cantidad, item.producto.stock, item.producto.stock - item.cantidad, `Venta ${numero}`);
  }
  return obtenerVenta(db, id);
}

function normalizarItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Agrega al menos un producto a la venta');
  }
  if (items.length > MAX_LINEAS_VENTA) {
    throw new Error(`Una venta no puede tener más de ${MAX_LINEAS_VENTA} líneas`);
  }

  const lineas = [];
  const productosCatalogo = new Map();
  for (const item of items) {
    if (item?.libre === true) {
      const nombre = validarTextoUnaLinea(String(item?.nombre ?? '').trim(), 'El nombre del producto libre', MAX_NOMBRE);
      if (!nombre) throw new Error('El nombre del producto libre es obligatorio');
      const precio = Number(item?.precio);
      if (!Number.isFinite(precio) || precio <= 0) {
        throw new Error('El precio del producto libre debe ser finito y mayor a 0');
      }
      if (precio > LIMITE_PRECIO) {
        throw new Error('El precio del producto libre no puede superar $100.000.000');
      }
      const cantidad = Number(item?.cantidad);
      if (!Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > LIMITE_STOCK) {
        throw new Error('La cantidad del producto libre debe ser un entero entre 1 y 1.000.000');
      }
      const subtotal = precio * cantidad;
      if (!Number.isFinite(subtotal) || subtotal > LIMITE_MONTO) {
        throw new Error('El subtotal del producto libre no puede superar $1.000.000.000.000');
      }
      lineas.push({ libre: true, productoId: null, nombre, precio, cantidad, subtotal });
      continue;
    }

    const productoId = Number(item?.productoId);
    const cantidad = Number(item?.cantidad);
    if (!Number.isInteger(productoId) || productoId <= 0) {
      throw new Error('Hay un producto inválido en la venta');
    }
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      throw new Error('La cantidad de cada producto debe ser un entero mayor a 0');
    }
    if (cantidad > LIMITE_STOCK) {
      throw new Error('La cantidad por producto no puede superar 1.000.000 de unidades');
    }
    const existente = productosCatalogo.get(productoId);
    const acumulada = (existente?.cantidad ?? 0) + cantidad;
    if (!Number.isSafeInteger(acumulada) || acumulada > LIMITE_STOCK) {
      throw new Error('La cantidad acumulada por producto no puede superar 1.000.000 de unidades');
    }
    if (existente) {
      existente.cantidad = acumulada;
    } else {
      const linea = { libre: false, productoId, cantidad };
      productosCatalogo.set(productoId, linea);
      lineas.push(linea);
    }
  }
  return lineas;
}

module.exports = function registrarVentas(ipcMain, db) {
  handle(ipcMain, 'ventas:registrar', ['administrador', 'vendedor'], (_, sesion, datos) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const venta = registrarVentaEnTransaccion(db, sesion, datos);
      db.exec('COMMIT');
      return venta;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });

  handle(ipcMain, 'ventas:anular', ['administrador', 'vendedor'], (_, sesion, solicitud) => {
    const motivo = validarMotivo(solicitud?.motivo);
    const ventaId = Number(solicitud?.ventaId);
    db.exec('BEGIN IMMEDIATE');
    try {
      const original = validarPermisoVenta(db, sesion, ventaId);
      devolverStockVenta(db, original, sesion, motivo);
      db.prepare(`UPDATE ventas SET estado='anulada', anulada_por=?, anulada_en=strftime('%Y-%m-%dT%H:%M:%fZ','now'), motivo_anulacion=? WHERE id=?`)
        .run(sesion.id, motivo, original.id);
      db.exec('COMMIT');
      return obtenerVenta(db, original.id);
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });

  handle(ipcMain, 'ventas:corregir', ['administrador', 'vendedor'], (_, sesion, solicitud) => {
    const motivo = validarMotivo(solicitud?.motivo);
    const ventaId = Number(solicitud?.ventaId);
    db.exec('BEGIN IMMEDIATE');
    try {
      const original = validarPermisoVenta(db, sesion, ventaId);
      devolverStockVenta(db, original, sesion, `Corregida por una nueva venta: ${motivo}`);
      const nueva = registrarVentaEnTransaccion(db, sesion, solicitud, { fecha: original.fecha, corrigeA: original.id });
      db.prepare(`UPDATE ventas SET estado='anulada', anulada_por=?, anulada_en=strftime('%Y-%m-%dT%H:%M:%fZ','now'), motivo_anulacion=? WHERE id=?`)
        .run(sesion.id, `Corregida por ${nueva.numero}: ${motivo}`, original.id);
      db.exec('COMMIT');
      return { original: obtenerVenta(db, original.id), nueva: obtenerVenta(db, nueva.id) };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  });

  handle(ipcMain, 'ventas:listar', ['administrador', 'vendedor'], (_, sesion) => {
    const ventas = sesion.rol === 'administrador'
      ? db.prepare('SELECT id FROM ventas ORDER BY id DESC').all()
      : db.prepare('SELECT id FROM ventas WHERE usuario_id = ? ORDER BY id DESC').all(sesion.id);
    return ventas.map(({ id }) => obtenerVenta(db, id));
  });
};

module.exports.crearTablasVentas = crearTablasVentas;
module.exports.asegurarEsquemaAnulaciones = asegurarEsquemaAnulaciones;
module.exports.normalizarItems = normalizarItems;
