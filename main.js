const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let db;

function crearVentana() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile('index.html'); // tu línea actual
}

app.whenReady().then(() => {
  db = require('./database');
  require('./productos')(ipcMain, db);
  crearVentana();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});