const fs = require('node:fs');
const zlib = require('node:zlib');

const TAMANO = 512;
const pixeles = Buffer.alloc(TAMANO * TAMANO * 4);

function color(hex) {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function rectangulo(x1, y1, x2, y2, tono) {
  const rgba = color(tono);
  const izquierda = Math.max(0, Math.floor(x1));
  const arriba = Math.max(0, Math.floor(y1));
  const derecha = Math.min(TAMANO, Math.ceil(x2));
  const abajo = Math.min(TAMANO, Math.ceil(y2));
  for (let y = arriba; y < abajo; y += 1) {
    for (let x = izquierda; x < derecha; x += 1) {
      const indice = (y * TAMANO + x) * 4;
      pixeles.set(rgba, indice);
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bloque(tipo, datos) {
  const nombre = Buffer.from(tipo, 'ascii');
  const longitud = Buffer.alloc(4);
  longitud.writeUInt32BE(datos.length);
  const contenido = Buffer.concat([nombre, datos]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(contenido));
  return Buffer.concat([longitud, contenido, checksum]);
}

// Fondo azul con una tienda de barrio de fachada clara y toldo rojo.
rectangulo(0, 0, TAMANO, TAMANO, '#2563eb');
rectangulo(80, 205, 432, 432, '#eff6ff');
rectangulo(64, 176, 448, 218, '#ffffff');
rectangulo(72, 136, 440, 184, '#dc2626');
for (let x = 72; x < 440; x += 92) {
  rectangulo(x, 136, Math.min(x + 46, 440), 184, '#ffffff');
}
rectangulo(72, 174, 440, 200, '#ffffff');
rectangulo(96, 200, 416, 216, '#1d4ed8');
rectangulo(112, 254, 250, 356, '#93c5fd');
rectangulo(100, 242, 262, 258, '#1d4ed8');
rectangulo(100, 242, 116, 366, '#1d4ed8');
rectangulo(246, 242, 262, 366, '#1d4ed8');
rectangulo(100, 350, 262, 366, '#1d4ed8');
rectangulo(176, 254, 190, 356, '#1d4ed8');
rectangulo(116, 300, 246, 314, '#1d4ed8');
rectangulo(294, 242, 392, 432, '#1d4ed8');
rectangulo(310, 258, 376, 432, '#bfdbfe');
rectangulo(346, 328, 358, 340, '#1d4ed8');
rectangulo(64, 432, 448, 456, '#ffffff');

const filaBytes = TAMANO * 4;
const filas = Buffer.alloc((filaBytes + 1) * TAMANO);
for (let y = 0; y < TAMANO; y += 1) {
  const inicio = y * (filaBytes + 1);
  filas[inicio] = 0;
  pixeles.copy(filas, inicio + 1, y * filaBytes, (y + 1) * filaBytes);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(TAMANO, 0);
ihdr.writeUInt32BE(TAMANO, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  bloque('IHDR', ihdr),
  bloque('IDAT', zlib.deflateSync(filas)),
  bloque('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(`${__dirname}/icon.png`, png);
console.log('Ícono de TiendaApp generado en build/icon.png (512×512).');
