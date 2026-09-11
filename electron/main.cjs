// Okno desktopowe MatchIQ (Electron). Uruchamia lokalny serwer API i otwiera front.
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const { fork } = require('node:child_process');

const PORT = process.env.PORT || '4400';
let server = null;

function startServer() {
  server = fork(path.join(__dirname, '..', 'server', 'index.mjs'), [], { env: { ...process.env, PORT, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#070a10',
    title: 'MatchIQ',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  await waitForServer(`http://localhost:${PORT}/api/health`);
  win.loadURL(`http://localhost:${PORT}/`);
}

app.whenReady().then(() => {
  startServer();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (server) server.kill(); app.quit(); });
app.on('before-quit', () => { if (server) server.kill(); });
