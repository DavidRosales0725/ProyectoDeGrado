const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listarProductos: () => ipcRenderer.invoke('productos:listar'),
  crearProducto: (p) => ipcRenderer.invoke('productos:crear', p),
  actualizarProducto: (id, p) => ipcRenderer.invoke('productos:actualizar', id, p),
  eliminarProducto: (id) => ipcRenderer.invoke('productos:eliminar', id),
});