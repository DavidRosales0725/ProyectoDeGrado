const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const productos = require('../productos');
const inventario = require('../inventario');
const ventas = require('../ventas');
const dashboard = require('../dashboard');
const reportes = require('../reportes');
const kardex = require('../kardex');
const imagenes = require('../imagenes-productos');
const respaldos = require('../respaldos');
const registrarSesion = require('../sesion').registrarSesion;
const registrarUsuarios = require('../usuarios');
const { crearTablasProductos } = productos;
const { crearTablasVentas } = ventas;
const { protegerUltimoAdmin } = registrarUsuarios;

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
crearTablasProductos(db);
db.exec(`
  CREATE TABLE movimientos_inventario (
    id INTEGER PRIMARY KEY AUTOINCREMENT, producto_id INTEGER NOT NULL REFERENCES productos(id),
    tipo TEXT NOT NULL, diferencia INTEGER NOT NULL, stock_anterior INTEGER NOT NULL,
    stock_nuevo INTEGER NOT NULL, motivo TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE ventas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT NOT NULL UNIQUE, fecha TEXT NOT NULL DEFAULT '',
    cliente TEXT NOT NULL, total REAL NOT NULL, metodo_pago TEXT NOT NULL, monto_recibido REAL NOT NULL DEFAULT 0,
    cambio REAL NOT NULL DEFAULT 0, estado TEXT NOT NULL DEFAULT 'completada'
  );
  INSERT INTO ventas (numero, fecha, cliente, total, metodo_pago, monto_recibido, cambio)
  VALUES ('LEGACY-1', '2026-01-01T12:00:00.000Z', 'Cliente legado', 500, 'efectivo', 500, 0);
`);

const handlers = new Map();
const ipcFalso = { handle(canal, fn) {
  assert.equal(handlers.has(canal), false, `Handler duplicado: ${canal}`);
  handlers.set(canal, fn);
} };

try {
  registrarSesion(ipcFalso, db);
  crearTablasVentas(db);
  kardex.asegurarEsquemaMovimientos(db);
  kardex.conciliarSaldosExistentes(db);
  productos(ipcFalso, db);
  inventario(ipcFalso, db);
  ventas(ipcFalso, db);
  dashboard(ipcFalso, db);
  reportes(ipcFalso, db);
  kardex(ipcFalso, db);
  imagenes.registrarSelectorImagen(ipcFalso, {
    dialog: { showOpenDialog: async () => ({ canceled:true, filePaths:[] }) },
    procesarImagen: buffer => ({ mime:'image/jpeg', datos:Buffer.from(buffer) }),
  });
  respaldos.registrarRespaldos(ipcFalso, {
    db, app:{getPath:()=>require('node:os').tmpdir(),relaunch(){},exit(){}},
    dialog:{showSaveDialog:async()=>({canceled:true}),showOpenDialog:async()=>({canceled:true})},
    shell:{openPath:async()=>''},
  });
  registrarUsuarios(ipcFalso, db);
  const invocar = (canal, ...args) => {
    const fn = handlers.get(canal);
    if (!fn) throw new Error(`Canal inexistente: ${canal}`);
    return fn({}, ...args);
  };

  assert.equal(invocar('auth:hayUsuarios'), false);
  const admin = invocar('auth:crearPrimerAdmin', { nombre: 'Administradora', usuario: 'ADMIN', password: 'clave-admin-123' });
  assert.equal(admin.usuario, 'admin');
  assert.throws(() => invocar('auth:crearPrimerAdmin', { nombre: 'Otro', usuario: 'otro.admin', password: 'clave-admin-456' }), /ya fue creado/);
  const hash = db.prepare('SELECT password_hash FROM usuarios WHERE id = ?').get(admin.id).password_hash;
  assert.match(hash, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(hash.includes('clave-admin-123'), false);
  assert.equal(require('../sesion').verificarClave('clave-admin-123', hash), true);
  assert.throws(() => invocar('auth:login', { usuario: 'admin', password: 'clave-equivocada' }), /Usuario o contraseña incorrectos/);
  invocar('auth:login', { usuario: 'admin', password: 'clave-admin-123' });
  console.log('✅ hash scrypt, comparación de clave, login genérico y primer administrador único');

  const antesMigracion = db.prepare('SELECT numero, usuario_id FROM ventas WHERE numero = ?').get('LEGACY-1');
  assert.equal(antesMigracion.usuario_id, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n, 1);
  assert.equal(db.prepare('PRAGMA table_info(ventas)').all().some(col => col.name === 'usuario_id'), true);
  console.log('✅ migración de usuario_id conserva ventas anteriores con usuario_id NULL');

  assert.throws(() => invocar('usuarios:crear', { nombre:'Admin', usuario:'a1', password:'password-123', rol:'vendedor' }), /3 y 30/);
  assert.throws(() => invocar('usuarios:crear', { nombre:'Admin', usuario:' usuario ', password:'password-123', rol:'vendedor' }), /3 y 30/);
  assert.throws(() => invocar('usuarios:crear', { nombre:'Admin', usuario:'admin2', password:'short', rol:'vendedor' }), /8 y 128/);
  assert.throws(() => invocar('usuarios:crear', { nombre:'Admin', usuario:'samepass', password:'samepass', rol:'vendedor' }), /igual al nombre/);
  assert.throws(() => invocar('usuarios:crear', { nombre:'A\nB', usuario:'admin2', password:'password-123', rol:'vendedor' }), /control/);
  const vendedor = invocar('usuarios:crear', { nombre:'Vendedora de prueba', usuario:'vendedora', password:'clave-vendedora-123', rol:'vendedor' });
  assert.equal('password_hash' in vendedor, false);
  assert.equal('passwordHash' in vendedor, false);
  assert.throws(() => invocar('usuarios:cambiarRol', admin.id, 'vendedor'), /quitarte/);
  assert.throws(() => invocar('usuarios:cambiarRol', admin.id, 'vendedor', { id:999, rol:'administrador' }), /quitarte/);
  assert.throws(() => invocar('usuarios:desactivar', admin.id), /desactivar tu propio usuario/);
  assert.throws(() => protegerUltimoAdmin(db, admin.id, 'vendedor', 1), /al menos un administrador activo/);
  console.log('✅ reglas de nombre, usuario, contraseña y protección del último administrador/autoedición');

  const producto = invocar('productos:crear', { nombre:'Producto de prueba', categoria:'Prueba', descripcion:'', precio:1000, stock:10, stockMin:1 });
  const ventaAdmin = invocar('ventas:registrar', {
    cliente:'Compra admin', metodoPago:'tarjeta', items:[{ productoId: producto.id, cantidad:1 }], usuarioId:vendedor.id,
  }, { id:vendedor.id, nombre:vendedor.nombre, usuario:vendedor.usuario, rol:'administrador' });
  assert.equal(ventaAdmin.usuarioId, admin.id);
  assert.equal(ventaAdmin.usuario, 'Administradora');
  assert.equal(db.prepare('SELECT usuario_id FROM ventas WHERE id = ?').get(ventaAdmin.id).usuario_id, admin.id);
  console.log('✅ ventas.usuario_id se toma de la sesión y no del dato enviado por el renderer');

  invocar('auth:logout');
  invocar('auth:login', { usuario:'vendedora', password:'clave-vendedora-123' });
  const ventaVendedor = invocar('ventas:registrar', {
    cliente:'Compra vendedor', metodoPago:'efectivo', montoRecibido:1000,
    items:[{ productoId:producto.id, cantidad:1 }], usuarioId:admin.id,
  });
  assert.equal(invocar('productos:listar').length, 1);
  assert.equal(invocar('ventas:listar').length, 1);
  assert.equal(invocar('ventas:listar')[0].numero, ventaVendedor.numero);
  assert.equal(invocar('ventas:listar', { rol:'administrador' }).length, 1);
  const canalesAdmin = [
    'productos:actualizar', 'productos:eliminar',
    'dashboard:resumen', 'reportes:porDia', 'reportes:ventasDelDia',
    'usuarios:listar', 'usuarios:crear', 'usuarios:cambiarRol', 'usuarios:activar',
    'usuarios:desactivar', 'usuarios:restablecerClave',
    'respaldos:crear', 'respaldos:restaurar', 'respaldos:listarAutomaticos', 'respaldos:abrirCarpeta',
  ];
  for (const canal of canalesAdmin) assert.throws(() => invocar(canal), /No tienes permiso/);
  const productoVendedor = invocar('productos:crear', { nombre:'Producto vendedor', categoria:'Prueba', descripcion:'', precio:500, stock:4, stockMin:1 });
  invocar('inventario:ajustar', { productoId:productoVendedor.id, tipo:'entrada', cantidad:1, motivo:'Reposición' });
  invocar('inventario:ajustar', { productoId:productoVendedor.id, tipo:'salida', cantidad:1, motivo:'Merma' });
  assert.throws(() => invocar('inventario:ajustar', { productoId:productoVendedor.id, tipo:'manual', cantidad:2, motivo:'Corrección' }), /No tienes permiso/);
  assert.throws(() => invocar('inventario:ajustar', { productoId:productoVendedor.id, tipo:'entrada', cantidad:1 }), /motivo/i);
  assert.equal(invocar('kardex:consultar', { productoId:productoVendedor.id }).productoId, productoVendedor.id);
  assert.throws(() => invocar('auth:login', { usuario:'vendedora', password:'incorrecta' }), /Usuario o contraseña incorrectos/);
  console.log('✅ vendedor puede vender/listar catálogo, ve solo sus ventas y no accede a canales administrativos');

  invocar('auth:logout');
  invocar('auth:login', { usuario:'admin', password:'clave-admin-123' });
  const inactivo = invocar('usuarios:crear', { nombre:'Cuenta inactiva', usuario:'inactiva', password:'clave-inactiva-123', rol:'vendedor' });
  invocar('usuarios:desactivar', inactivo.id);
  invocar('auth:logout');
  assert.throws(() => invocar('auth:login', { usuario:'inactiva', password:'clave-inactiva-123' }), /Usuario o contraseña incorrectos/);
  invocar('auth:login', { usuario:'admin', password:'clave-admin-123' });
  const bloqueado = invocar('usuarios:crear', { nombre:'Cuenta bloqueada', usuario:'bloqueada', password:'clave-bloqueo-123', rol:'vendedor' });
  assert.ok(bloqueado.id);
  invocar('auth:logout');
  for (let intento = 0; intento < 5; intento++) {
    assert.throws(() => invocar('auth:login', { usuario:'bloqueada', password:'no-es-la-clave' }), /Usuario o contraseña incorrectos/);
  }
  assert.throws(() => invocar('auth:login', { usuario:'bloqueada', password:'clave-bloqueo-123' }), /Demasiados intentos/);
  invocar('auth:login', { usuario:'admin', password:'clave-admin-123' });
  console.log('✅ login rechaza usuarios inactivos y bloquea tras cinco intentos fallidos');

  invocar('auth:logout');
  const publicos = new Set(['auth:hayUsuarios', 'auth:crearPrimerAdmin', 'auth:login']);
  for (const canal of handlers.keys()) {
    if (publicos.has(canal)) continue;
    assert.throws(() => invocar(canal), /Debes iniciar sesión/, `Canal sin protección: ${canal}`);
  }
  console.log(`✅ todos los ${handlers.size} canales registrados exigen sesión salvo los tres canales públicos de auth`);
} finally {
  db.close();
}

console.log('Todas las pruebas de autenticación pasaron.');
