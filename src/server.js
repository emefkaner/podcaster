import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, paths } from './config.js';
import { issueCookie, clearCookie, isLoggedIn, checkPassword } from './auth.js';
import { buildFeed } from './rss.js';
import { initStore } from './store.js';
import { seedAssets } from './seed.js';
import { haengendeFolgenFreigeben } from './recover.js';
import { storageEnabled } from './storage.js';
import episodesRouter from './routes/episodes.js';
import settingsRouter from './routes/settings.js';
import importRouter from './routes/import.js';
import statusRouter from './routes/status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

const app = express();
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.disable('x-powered-by');

// ---- Öffentliche Endpunkte (kein Login nötig) ----

// Health-Check (für Render/Railway).
app.get('/healthz', (req, res) => res.json({ ok: true }));

// RSS-Feed – DAS ist die URL, die du bei Spotify for Podcasters einträgst.
app.get('/feed.xml', (req, res) => {
  res.type('application/rss+xml; charset=utf-8').send(buildFeed());
});

// Lokaler Fallback ohne R2: fertige Audiodateien und Cover öffentlich ausliefern,
// damit Spotify sie laden kann. Mit R2 zeigen die Feed-URLs direkt auf R2.
app.use('/media', express.static(paths.media, { maxAge: '1h' }));

// ---- Login ----
app.post('/login', (req, res) => {
  if (checkPassword(req.body?.password)) {
    issueCookie(res);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Falsches Passwort' });
});

app.post('/logout', (req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ loggedIn: isLoggedIn(req) });
});

// ---- Geschützte API ----
app.use('/api/episodes', episodesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/import', importRouter);
app.use('/api/status', statusRouter);

// ---- Frontend ----
// Login-Seite immer erreichbar; die App-Seite erfordert Login (sonst Redirect).
app.get('/login', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));

app.get(['/', '/settings', '/episode/:id'], (req, res) => {
  if (!isLoggedIn(req)) return res.redirect('/login');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Die ffmpeg-WebAssembly-Bausteine (31 MB) lange zwischenspeichern lassen:
// Ohne Cache-Header holt jeder Browser sie immer wieder neu — auf dem
// Hobby-Plan mit 5 GB Bandbreite je Monat war das ein spürbarer Posten.
// Achtung bei einem ffmpeg-Update: Dateinamen ändern (z. B. Unterordner mit
// Versionsnummer), sonst hängen Browser bis zu 30 Tage auf dem alten Stand.
app.use('/vendor', express.static(path.join(publicDir, 'vendor'), { maxAge: '30d', immutable: true }));
// Auch das RNNoise-Modell (300 KB) ändert sich praktisch nie.
app.use('/assets', express.static(path.join(publicDir, 'assets'), { maxAge: '30d' }));

// Übrige statische Dateien (JS/CSS/Manifest/Service-Worker).
app.use(express.static(publicDir));

// Letzte Instanz: JEDEN durchgereichten Fehler als JSON beantworten.
//
// Ohne das schickt Express eine HTML-Fehlerseite. Die App sucht darin ein
// `error`-Feld, findet keins und zeigt „Fehler: Fehler" – womit niemand etwas
// anfangen kann. Genau daran war beim Cover-Upload nicht zu erkennen, was
// eigentlich schiefging. Multer meldet sich hier ebenfalls (z. B. „Datei zu
// groß"), deshalb der Sonderfall.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(`Fehler bei ${req.method} ${req.path}:`, err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Die Datei ist zu groß.' });
  }
  res.status(err?.status || 500).json({ error: err?.message || 'Unbekannter Serverfehler' });
});

// Beim Start Metadaten aus dem R2-Backup wiederherstellen, mitgelieferte
// Startdateien (Intro/Outro) übernehmen, dann lauschen.
initStore()
  .then(() => seedAssets())
  .then(() => haengendeFolgenFreigeben())
  .catch((e) => console.error('Start-Initialisierung fehlgeschlagen:', e.message))
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`podcast3r läuft auf Port ${config.port}`);
      console.log(`Öffentliche URL:  ${config.publicUrl}`);
      console.log(`RSS-Feed:         ${config.publicUrl}/feed.xml`);
      console.log(`Speicher:         ${storageEnabled() ? 'Cloudflare R2' : 'lokal (DATA_DIR)'}`);
      if (!config.password) console.warn('WARNUNG: APP_PASSWORD ist nicht gesetzt – Login nicht möglich.');
    });
  });
