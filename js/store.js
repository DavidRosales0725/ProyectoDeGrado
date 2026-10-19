/* ===================================
   store.js — Datos simulados y lógica
   central del prototipo
   =================================== */

// ── Clave usada en localStorage ───────────────────────────────
const KEYS = {
  productos: 'sena_productos',
  ventas:    'sena_ventas',
  usuario:   'sena_usuario_actual',
  loggedIn:  'sena_logged_in'
};

// ── Usuarios permitidos (simulado) ────────────────────────────
const USUARIOS = [
  { id: 1, nombre: 'Administrador',  correo: 'admin@tienda.com',  password: '1234', rol: 'Administrador' },
  { id: 2, nombre: 'Vendedor Demo',  correo: 'vendedor@tienda.com', password: '1234', rol: 'Vendedor'      }
];

// ── Productos iniciales de demostración ───────────────────────
const PRODUCTOS_INICIALES = [
  { id: 1, nombre: 'Camisa Manga Corta',   categoria: 'Ropa',        precio: 35000,  stock: 48, stockMin: 10, descripcion: 'Camisa algodón tallas S-XL' },
  { id: 2, nombre: 'Pantalón Jean',         categoria: 'Ropa',        precio: 89000,  stock: 22, stockMin: 8,  descripcion: 'Jean clásico corte recto' },
  { id: 3, nombre: 'Zapatos Casuales',      categoria: 'Calzado',     precio: 145000, stock: 14, stockMin: 5,  descripcion: 'Cuero sintético unisex' },
  { id: 4, nombre: 'Bolso de Mano',         categoria: 'Accesorios',  precio: 68000,  stock: 7,  stockMin: 5,  descripcion: 'Diseño moderno varios colores' },
  { id: 5, nombre: 'Reloj Clásico',         categoria: 'Accesorios',  precio: 210000, stock: 3,  stockMin: 5,  descripcion: 'Correa de cuero café' },
  { id: 6, nombre: 'Bufanda Lana',          categoria: 'Ropa',        precio: 28000,  stock: 31, stockMin: 10, descripcion: 'Lana natural colores variados' },
  { id: 7, nombre: 'Tenis Deportivos',      categoria: 'Calzado',     precio: 178000, stock: 9,  stockMin: 5,  descripcion: 'Running y uso casual' },
  { id: 8, nombre: 'Gorra Bordada',         categoria: 'Accesorios',  precio: 22000,  stock: 45, stockMin: 10, descripcion: 'Ajuste universal visera curva' },
  { id: 9, nombre: 'Vestido Floral',        categoria: 'Ropa',        precio: 95000,  stock: 12, stockMin: 5,  descripcion: 'Tela liviana ideal verano' },
  { id: 10, nombre:'Sandalias de Playa',    categoria: 'Calzado',     precio: 42000,  stock: 19, stockMin: 8,  descripcion: 'Material EVA resistente' }
];

// ── Ventas iniciales de demostración ─────────────────────────
const VENTAS_INICIALES = [
  {
    id: 'VTA-001',
    fecha: new Date(Date.now() - 86400000 * 2).toISOString(),
    cliente: 'María García',
    items: [{ productoId: 1, nombre: 'Camisa Manga Corta', qty: 2, precioUnit: 35000 },
            { productoId: 8, nombre: 'Gorra Bordada',       qty: 1, precioUnit: 22000 }],
    total: 92000,
    estado: 'Completada'
  },
  {
    id: 'VTA-002',
    fecha: new Date(Date.now() - 86400000).toISOString(),
    cliente: 'Carlos Pérez',
    items: [{ productoId: 2, nombre: 'Pantalón Jean',       qty: 1, precioUnit: 89000 },
            { productoId: 3, nombre: 'Zapatos Casuales',    qty: 1, precioUnit: 145000 }],
    total: 234000,
    estado: 'Completada'
  },
  {
    id: 'VTA-003',
    fecha: new Date().toISOString(),
    cliente: 'Laura Sánchez',
    items: [{ productoId: 9, nombre: 'Vestido Floral',      qty: 1, precioUnit: 95000 }],
    total: 95000,
    estado: 'Completada'
  }
];

// ── STORE: Inicializar datos si no existen ─────────────────────
function initStore() {
  if (!localStorage.getItem(KEYS.productos)) {
    localStorage.setItem(KEYS.productos, JSON.stringify(PRODUCTOS_INICIALES));
  }
  if (!localStorage.getItem(KEYS.ventas)) {
    localStorage.setItem(KEYS.ventas, JSON.stringify(VENTAS_INICIALES));
  }
}

// ── PRODUCTOS ─────────────────────────────────────────────────
function getProductos() {
  return JSON.parse(localStorage.getItem(KEYS.productos) || '[]');
}

function setProductos(arr) {
  localStorage.setItem(KEYS.productos, JSON.stringify(arr));
}

function agregarProducto(prod) {
  const arr = getProductos();
  prod.id = Date.now();
  arr.push(prod);
  setProductos(arr);
  return prod;
}

function actualizarProducto(id, datos) {
  const arr = getProductos().map(p => p.id === id ? { ...p, ...datos } : p);
  setProductos(arr);
}

function eliminarProducto(id) {
  setProductos(getProductos().filter(p => p.id !== id));
}

function descontarStock(id, cantidad) {
  const arr = getProductos().map(p => {
    if (p.id === id) return { ...p, stock: Math.max(0, p.stock - cantidad) };
    return p;
  });
  setProductos(arr);
}

// ── VENTAS ───────────────────────────────────────────────────
function getVentas() {
  return JSON.parse(localStorage.getItem(KEYS.ventas) || '[]');
}

function registrarVenta(venta) {
  const arr = getVentas();
  const num  = String(arr.length + 1).padStart(3, '0');
  venta.id   = `VTA-${num}`;
  venta.fecha = new Date().toISOString();
  venta.estado = 'Completada';
  arr.push(venta);
  localStorage.setItem(KEYS.ventas, JSON.stringify(arr));
  // descontar stock
  venta.items.forEach(it => descontarStock(it.productoId, it.qty));
  return venta;
}

// ── AUTH ──────────────────────────────────────────────────────
function login(correo, password) {
  const u = USUARIOS.find(u => u.correo === correo && u.password === password);
  if (!u) return null;
  localStorage.setItem(KEYS.loggedIn, '1');
  localStorage.setItem(KEYS.usuario, JSON.stringify(u));
  return u;
}

function logout() {
  localStorage.removeItem(KEYS.loggedIn);
  localStorage.removeItem(KEYS.usuario);
}

function getUsuario() {
  return JSON.parse(localStorage.getItem(KEYS.usuario) || 'null');
}

function isLoggedIn() {
  return !!localStorage.getItem(KEYS.loggedIn);
}

// ── STATS para dashboard ──────────────────────────────────────
function getStats() {
  const prods  = getProductos();
  const ventas = getVentas();
  const hoy    = new Date().toDateString();
  const ventasHoy = ventas.filter(v => new Date(v.fecha).toDateString() === hoy);
  const totalHoy  = ventasHoy.reduce((s, v) => s + v.total, 0);
  const totalVentas = ventas.reduce((s, v) => s + v.total, 0);
  const stockBajo  = prods.filter(p => p.stock <= p.stockMin).length;
  return {
    totalProductos: prods.length,
    totalVentas: ventas.length,
    ventasHoy: ventasHoy.length,
    ingresoHoy: totalHoy,
    ingresoTotal: totalVentas,
    stockBajo
  };
}

// ── FORMATO ───────────────────────────────────────────────────
function formatPeso(n) {
  return '$ ' + n.toLocaleString('es-CO');
}

function formatFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// ── INICIALIZAR al cargar ─────────────────────────────────────
initStore();
