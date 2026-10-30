const ZONA_BOGOTA = 'America/Bogota';
const MILISEGUNDOS_DIA = 24 * 60 * 60 * 1000;

function fechaLocalBogota(ahora = new Date()) {
  const instante = ahora instanceof Date ? ahora : new Date(ahora);
  if (Number.isNaN(instante.getTime())) throw new Error('La fecha proporcionada no es válida');
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_BOGOTA,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instante);
  const valores = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function validarFechaBogota(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error('La fecha debe tener el formato AAAA-MM-DD');
  }
  const instante = new Date(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(instante.getTime()) || instante.toISOString().slice(0, 10) !== fecha) {
    throw new Error('La fecha indicada no existe');
  }
  return fecha;
}

function sumarDias(fecha, cantidad) {
  validarFechaBogota(fecha);
  const instante = new Date(`${fecha}T00:00:00.000Z`);
  instante.setUTCDate(instante.getUTCDate() + cantidad);
  return instante.toISOString().slice(0, 10);
}

function limitesDiaBogota(ahora = new Date()) {
  const instante = ahora instanceof Date ? ahora : new Date(ahora);
  if (Number.isNaN(instante.getTime())) throw new Error('La fecha proporcionada no es válida');
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_BOGOTA,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instante);
  const fecha = Object.fromEntries(partes.map(({ type, value }) => [type, value]));
  // Conserva el cálculo usado antes por el dashboard: medianoche de Bogotá = 05:00 UTC.
  const inicio = new Date(Date.UTC(
    Number(fecha.year), Number(fecha.month) - 1, Number(fecha.day), 5,
  ));
  const fin = new Date(inicio.getTime() + MILISEGUNDOS_DIA);
  return { inicio: inicio.toISOString(), fin: fin.toISOString() };
}

function limitesFechaBogota(fecha) {
  validarFechaBogota(fecha);
  const inicio = new Date(`${fecha}T05:00:00.000Z`);
  const fin = new Date(inicio.getTime() + MILISEGUNDOS_DIA);
  return { inicio: inicio.toISOString(), fin: fin.toISOString() };
}

function horaLocalBogota(fechaUtc) {
  const instante = new Date(fechaUtc);
  if (Number.isNaN(instante.getTime())) throw new Error('La fecha de venta almacenada no es válida');
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: ZONA_BOGOTA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(instante);
}

module.exports = {
  ZONA_BOGOTA,
  MILISEGUNDOS_DIA,
  fechaLocalBogota,
  validarFechaBogota,
  sumarDias,
  limitesDiaBogota,
  limitesFechaBogota,
  horaLocalBogota,
};
