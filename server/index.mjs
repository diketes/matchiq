// MatchIQ – serwer API + hosting frontu (wersja desktop/web). Aplikacja mobilna nie potrzebuje tego serwera –
// ten sam silnik (server/*.mjs) działa w niej lokalnie.
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { handleApi } from './api.mjs';
import { configureBetsStorage, startScheduler } from './bets.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4400);
const DATA_DIR = path.join(__dirname, '..', 'data');
const BETS_FILE = path.join(DATA_DIR, 'bets.json');

configureBetsStorage({
  read: () => (fs.existsSync(BETS_FILE) ? fs.readFileSync(BETS_FILE, 'utf8') : null),
  write: (json) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(BETS_FILE, json); },
});

const app = express();
app.use(compression());
app.use(express.json());
app.disable('x-powered-by');

app.all('/api/*', async (req, res) => {
  try {
    const data = await handleApi(req.method, req.path, req.query, req.body);
    res.setHeader('cache-control', 'no-store');
    res.json(data);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    console.error(`[api] ${req.path} -> ${status}: ${e.message}`);
    res.status(status).json({ error: e.message || 'Błąd serwera' });
  }
});

startScheduler();

// produkcja: serwuj zbudowany front
const dist = path.join(__dirname, '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(dist, 'index.html'));
  });
}

const openBrowser = (url) => {
  if (!process.argv.includes('--open')) return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
  exec(cmd);
};

function listen(port, attempt = 0) {
  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`MatchIQ działa na ${url}${fs.existsSync(dist) ? '' : ' (front: uruchom vite)'}`);
    openBrowser(url);
  });
  server.on('error', async (err) => {
    if (err.code !== 'EADDRINUSE') { console.error(err); process.exit(1); }
    // port zajęty – jeśli to już działający MatchIQ, po prostu go otwórz; inaczej weź kolejny port
    const url = `http://localhost:${port}`;
    try {
      const r = await fetch(`${url}/api/health`);
      if (r.ok) {
        console.log(`MatchIQ już działa na ${url} – otwieram istniejącą instancję.`);
        openBrowser(url);
        process.exit(0);
      }
    } catch { /* to nie MatchIQ */ }
    if (attempt < 10) {
      console.log(`Port ${port} zajęty, próbuję ${port + 1}…`);
      listen(port + 1, attempt + 1);
    } else {
      console.error('Nie znalazłem wolnego portu (4400–4410). Zamknij inne programy albo ustaw PORT=xxxx.');
      process.exit(1);
    }
  });
}

listen(PORT);
