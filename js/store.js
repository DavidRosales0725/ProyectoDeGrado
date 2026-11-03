/* Utilidades de formato compartidas por las páginas. */
function formatPeso(valor) {
  const numero = Number(valor);
  return '$ ' + (Number.isFinite(numero) ? numero : 0).toLocaleString('es-CO');
}

function formatFecha(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es-CO', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
