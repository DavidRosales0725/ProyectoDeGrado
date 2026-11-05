const fs = require('node:fs/promises');
const { handle } = require('./autorizacion');

const MAX_ENTRADA = 10 * 1024 * 1024;
const MAX_SALIDA = 300 * 1024;

function crearTablaProductoImagenes(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS producto_imagenes (
      producto_id INTEGER PRIMARY KEY REFERENCES productos(id) ON DELETE CASCADE,
      mime TEXT NOT NULL CHECK (mime = 'image/jpeg'),
      datos BLOB NOT NULL,
      actualizado TEXT NOT NULL
    )`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function crearProcesadorImagen(nativeImage) {
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
    throw new Error('No está disponible el procesador de imágenes de Electron');
  }
  return bufferEntrada => {
    const buffer = Buffer.from(bufferEntrada);
    if (buffer.length > MAX_ENTRADA) throw new Error('La imagen no puede superar 10 MB');
    let imagen;
    try { imagen = nativeImage.createFromBuffer(buffer); }
    catch { throw new Error('El archivo no contiene una imagen válida'); }
    if (imagen.isEmpty()) throw new Error('El archivo no contiene una imagen válida');
    const { width, height } = imagen.getSize();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new Error('La imagen tiene dimensiones inválidas');
    }
    const escala = Math.min(400 / width, 400 / height, 1);
    const redimensionada = imagen.resize({
      width: Math.max(1, Math.round(width * escala)),
      height: Math.max(1, Math.round(height * escala)),
      quality: 'best',
    });
    let datos = redimensionada.toJPEG(80);
    if (datos.length > MAX_SALIDA) datos = redimensionada.toJPEG(60);
    return { mime: 'image/jpeg', datos: Buffer.from(datos) };
  };
}

function decodificarDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw new Error('La imagen enviada no es válida');
  const coincidencia = /^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!coincidencia) throw new Error('La imagen debe ser PNG, JPG o WebP válida');
  const datos = Buffer.from(coincidencia[1], 'base64');
  if (!datos.length) throw new Error('La imagen enviada está vacía');
  if (datos.length > MAX_ENTRADA) throw new Error('La imagen no puede superar 10 MB');
  return datos;
}

function normalizarImagen(procesarImagen, dataUrl) {
  if (typeof procesarImagen !== 'function') throw new Error('El procesamiento de imágenes no está disponible');
  const salida = procesarImagen(decodificarDataUrl(dataUrl));
  if (!salida || salida.mime !== 'image/jpeg' || !Buffer.isBuffer(salida.datos) || !salida.datos.length) {
    throw new Error('No se pudo procesar la imagen del producto');
  }
  return salida;
}

function guardarImagen(db, productoId, imagen) {
  const anterior = db.prepare('SELECT actualizado FROM producto_imagenes WHERE producto_id = ?').get(productoId);
  const marca = Date.now();
  const ms = anterior ? Math.max(marca, Date.parse(anterior.actualizado) + 1) : marca;
  db.prepare(`INSERT INTO producto_imagenes (producto_id, mime, datos, actualizado)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(producto_id) DO UPDATE SET mime=excluded.mime, datos=excluded.datos, actualizado=excluded.actualizado`)
    .run(productoId, imagen.mime, imagen.datos, new Date(ms).toISOString());
}

function registrarSelectorImagen(ipcMain, { dialog, procesarImagen }) {
  handle(ipcMain, 'imagenes:seleccionar', ['administrador', 'vendedor'], async () => {
    const seleccion = await dialog.showOpenDialog({
      title: 'Seleccionar foto del producto',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (seleccion.canceled || !seleccion.filePaths?.[0]) return null;
    const estadisticas = await fs.stat(seleccion.filePaths[0]);
    if (estadisticas.size > MAX_ENTRADA) throw new Error('La imagen no puede superar 10 MB');
    const buffer = await fs.readFile(seleccion.filePaths[0]);
    if (buffer.length > MAX_ENTRADA) throw new Error('La imagen no puede superar 10 MB');
    const imagen = procesarImagen(buffer);
    if (!imagen || imagen.mime !== 'image/jpeg' || !Buffer.isBuffer(imagen.datos) || !imagen.datos.length) {
      throw new Error('No se pudo procesar la imagen seleccionada');
    }
    return `data:${imagen.mime};base64,${imagen.datos.toString('base64')}`;
  });
}

module.exports = {
  MAX_ENTRADA,
  MAX_SALIDA,
  crearTablaProductoImagenes,
  crearProcesadorImagen,
  decodificarDataUrl,
  normalizarImagen,
  guardarImagen,
  registrarSelectorImagen,
};
