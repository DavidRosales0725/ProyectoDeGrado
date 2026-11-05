#!/usr/bin/env node
// Ejecutar con la aplicación cerrada. Este script solo inspecciona la base de datos.
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const paquete = require('../package.json');

function rutaBaseDatos() {
  if (process.env.TIENDA_DB_PATH) return path.resolve(process.env.TIENDA_DB_PATH);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), paquete.name, 'tienda.db');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', paquete.name, 'tienda.db');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), paquete.name, 'tienda.db');
}

let db;
try {
  const archivo = rutaBaseDatos();
  db = new DatabaseSync(archivo, { readOnly: true });
  const problemas = [];
  const productos = db.prepare(`
    SELECT p.id, p.nombre, p.stock,
      (SELECT m.stock_nuevo FROM movimientos_inventario m WHERE m.producto_id=p.id ORDER BY m.fecha DESC, m.id DESC LIMIT 1) AS ultimo_saldo
    FROM productos p ORDER BY p.id
  `).all();
  for (const p of productos) {
    if (p.ultimo_saldo == null) problemas.push(`Producto ${p.id} (${p.nombre}): no tiene movimientos`);
    else if (Number(p.stock) !== Number(p.ultimo_saldo)) problemas.push(`Producto ${p.id} (${p.nombre}): stock ${p.stock}, último saldo ${p.ultimo_saldo}`);
  }
  const movimientos = db.prepare(`
    SELECT m.id, m.producto_id, m.diferencia, m.stock_anterior, m.stock_nuevo,
      (SELECT anterior.stock_nuevo FROM movimientos_inventario anterior
       WHERE anterior.producto_id=m.producto_id AND (anterior.fecha<m.fecha OR (anterior.fecha=m.fecha AND anterior.id<m.id))
       ORDER BY anterior.fecha DESC, anterior.id DESC LIMIT 1) AS saldo_previo
    FROM movimientos_inventario m ORDER BY m.producto_id, m.fecha, m.id
  `).all();
  for (const m of movimientos) {
    const esperado = m.saldo_previo == null ? null : Number(m.saldo_previo);
    if (esperado != null && Number(m.stock_anterior) !== esperado) problemas.push(`Movimiento ${m.id}: stock_anterior ${m.stock_anterior}, saldo previo ${esperado}`);
    if (Number(m.stock_nuevo) - Number(m.stock_anterior) !== Number(m.diferencia)) problemas.push(`Movimiento ${m.id}: diferencia no coincide con los saldos`);
  }
  if (problemas.length) {
    console.error(`Se encontraron ${problemas.length} inconsistencias en ${archivo}:`);
    problemas.forEach(problema => console.error(`- ${problema}`));
    process.exitCode = 1;
  } else {
    console.log(`Kardex consistente: ${productos.length} productos y ${movimientos.length} movimientos revisados.`);
  }
} catch (error) {
  console.error(`No se pudo verificar el Kardex: ${error.message}`);
  process.exitCode = 1;
} finally {
  db?.close();
}
