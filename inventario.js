// inventario.js
module.exports = function registrarInventario(ipcMain, db) {
    ipcMain.handle('inventario:ajustar', (_, datos) => {
        const productoId = Number(datos?.productoId);
        const tipo = String(datos?.tipo ?? '');
        const cantidad = Number(datos?.cantidad);
        const motivo = String(datos?.motivo ?? '').trim().slice(0, 200);

        if (!Number.isInteger(productoId)) throw new Error('Producto inválido');
        if (!['entrada', 'salida', 'manual'].includes(tipo)) throw new Error('Tipo de ajuste inválido');
        if (!Number.isInteger(cantidad) || cantidad < 0) throw new Error('La cantidad debe ser un entero mayor o igual a 0');
        if (tipo !== 'manual' && cantidad === 0) throw new Error('La cantidad debe ser mayor a 0');

        // Todo o nada: si algo falla, no se guarda nada
        db.exec('BEGIN IMMEDIATE');
        try {
            const p = db.prepare('SELECT id, stock FROM productos WHERE id = ? AND activo = 1').get(productoId);
            if (!p) throw new Error('El producto no existe');

            let nuevo = p.stock;
            if (tipo === 'entrada') nuevo = p.stock + cantidad;
            if (tipo === 'salida') nuevo = p.stock - cantidad;
            if (tipo === 'manual') nuevo = cantidad;

            if (nuevo < 0) throw new Error(`No hay suficiente stock: solo hay ${p.stock} unidades`);

            db.prepare('UPDATE productos SET stock = ? WHERE id = ?').run(nuevo, productoId);
            db.prepare(
                `INSERT INTO movimientos_inventario
         (producto_id, tipo, diferencia, stock_anterior, stock_nuevo, motivo)
         VALUES (?, ?, ?, ?, ?, ?)`
            ).run(productoId, tipo, nuevo - p.stock, p.stock, nuevo, motivo);

            db.exec('COMMIT');
            return { stockAnterior: p.stock, stockNuevo: nuevo };
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    });
};