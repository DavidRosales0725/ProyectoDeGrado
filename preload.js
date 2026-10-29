const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listarProductos: () => ipcRenderer.invoke('productos:listar'),
  buscarProductoPorCodigo: (codigo) => ipcRenderer.invoke('productos:buscarPorCodigo', codigo),
  crearProducto: (p) => ipcRenderer.invoke('productos:crear', p),
  actualizarProducto: (id, p) => ipcRenderer.invoke('productos:actualizar', id, p),
  eliminarProducto: (id) => ipcRenderer.invoke('productos:eliminar', id),
  contarStockBajo: () => ipcRenderer.invoke('productos:stockBajo'),
  ajustarStock: (d) => ipcRenderer.invoke('inventario:ajustar', d),
  registrarVenta: (datos) => ipcRenderer.invoke('ventas:registrar', datos),
  listarVentas: () => ipcRenderer.invoke('ventas:listar'),
  obtenerResumen: () => ipcRenderer.invoke('dashboard:resumen'),
});
