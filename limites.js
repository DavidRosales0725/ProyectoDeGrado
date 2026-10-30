const LIMITES = {
  LIMITE_STOCK: 1_000_000,
  LIMITE_PRECIO: 100_000_000,
  LIMITE_MONTO: 1_000_000_000_000,
  MAX_NOMBRE: 100,
  MAX_CATEGORIA: 50,
  MAX_DESCRIPCION: 200,
  MAX_CLIENTE: 100,
  MAX_MOTIVO: 200,
};

function validarTextoUnaLinea(valor, campo, maximo) {
  const texto = String(valor ?? '');
  if (texto.length > maximo) {
    throw new Error(`${campo} no puede superar ${maximo} caracteres`);
  }
  if (/[\u0000-\u001F\u007F]/.test(texto)) {
    throw new Error(`${campo} no puede contener saltos de línea ni caracteres de control`);
  }
  return texto.trim();
}

module.exports = { ...LIMITES, validarTextoUnaLinea };
