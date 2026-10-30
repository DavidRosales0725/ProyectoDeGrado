/* ===================================
   ui.js — Utilidades de interfaz
   compartidas entre todas las páginas
   =================================== */

// ── TOAST ─────────────────────────────────────────────────────
function showToast(msg, type = 'default', duration = 3000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', default: 'ℹ️' };
  const container = document.getElementById('toast-container');
  if (!container) return;

  const el = document.createElement('div');
  el.className = `toast ${type !== 'default' ? type : ''}`;

  const icono = document.createElement('span');
  icono.textContent = icons[type] ?? icons.default;
  const texto = document.createElement('span');
  texto.textContent = msg;

  el.append(icono, texto);
  container.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

function escapeHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ── MODAL ─────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id)?.classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

// Cierra modal al hacer clic fuera del contenido
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ── NAVEGACIÓN LATERAL ────────────────────────────────────────
async function buildSidebar(activeKey) {
  const usuario = getUsuario();
  if (!usuario) return;

  const initials = usuario.nombre.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  let stockBajo = 0;
  try {
    stockBajo = await window.api.contarStockBajo();
  } catch (e) {
    console.error('No se pudo consultar el stock bajo', e);
  }

  const navItems = [
    { key: 'dashboard',  href: '../pages/dashboard.html', icon: '📊', label: 'Dashboard'   },
    { key: 'productos',  href: '../pages/productos.html', icon: '📦', label: 'Productos'   },
    { key: 'inventario', href: '../pages/inventario.html',icon: '🗄️',  label: 'Inventario'  },
    { key: 'ventas',     href: '../pages/ventas.html',    icon: '🛒', label: 'Ventas'      },
    { key: 'reportes',   href: '../pages/reportes.html',  icon: '📈', label: 'Reportes'    },
  ];

  const navHTML = navItems.map(item => `
    <a class="nav-item ${activeKey === item.key ? 'active' : ''}" href="${item.href}">
      <span class="nav-icon">${item.icon}</span>
      ${item.label}
      ${item.key === 'inventario' && stockBajo > 0
        ? `<span class="nav-badge">${stockBajo}</span>` : ''}
    </a>
  `).join('');

  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  sidebar.innerHTML = `
    <div class="sidebar-brand">
      <a class="logo-badge" href="../pages/dashboard.html">
        <div class="logo-icon">🏪</div>
        <div class="logo-text">
          <strong>TiendaApp</strong>
          <span>SENA · Prototipo</span>
        </div>
      </a>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-label">Menú principal</div>
      ${navHTML}
    </nav>
    <div class="sidebar-footer">
      <div class="user-card">
        <div class="user-avatar">${escapeHtml(initials)}</div>
        <div class="user-info">
          <strong>${escapeHtml(usuario.nombre.split(' ')[0])}</strong>
          <span>${escapeHtml(usuario.rol)}</span>
        </div>
        <button class="btn-logout" onclick="doLogout()" title="Cerrar sesión">🚪</button>
      </div>
    </div>
  `;
}


function doLogout() {
  if (confirm('¿Cerrar sesión?')) {
    logout();
    window.location.href = '../index.html';
  }
}

// ── PROTEGER PÁGINAS ─────────────────────────────────────────
function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = '../index.html';
  }
}

// ── FECHA ACTUAL ─────────────────────────────────────────────
function setTopbarDate() {
  const el = document.getElementById('topbar-date');
  if (!el) return;
  const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
  el.textContent = new Date().toLocaleDateString('es-CO', opts);
}

// ── AUTO-INIT ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTopbarDate();
});
