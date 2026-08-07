// Rauchtest: startet die App und klickt die wichtigsten Wege im echten Browser ab.
//
// Läuft ohne Schlüssel und ohne ffmpeg — geprüft wird die Oberfläche, nicht die
// Audioverarbeitung. Genau das ist der Bereich, in dem hier schon mehrfach
// Fehler durchgerutscht sind: kaputtes JavaScript, das erst im Browser auffällt.
//
// Aufruf:  node test/smoke.mjs
// Chromium: PLAYWRIGHT_CHROMIUM=/pfad/zu/chromium (sonst nimmt Playwright seinen eigenen)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.SMOKE_PORT || 3999);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORT = 'rauchtest';
const datenOrdner = fs.mkdtempSync(path.join(os.tmpdir(), 'podcast3r-smoke-'));

const pruefungen = [];
function pruefe(name, bedingung, zusatz = '') {
  pruefungen.push({ name, ok: Boolean(bedingung), zusatz });
  console.log(`${bedingung ? '  ok  ' : ' FEHL '} ${name}${zusatz ? ` — ${zusatz}` : ''}`);
}

// ---- App starten ----
const server = spawn(process.execPath, ['src/server.js'], {
  env: { ...process.env, APP_PASSWORD: PASSWORT, DATA_DIR: datenOrdner, PORT: String(PORT),
         GEMINI_API_KEY: '', R2_ACCOUNT_ID: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverAusgabe = '';
server.stdout.on('data', (d) => { serverAusgabe += d; });
server.stderr.on('data', (d) => { serverAusgabe += d; });

async function warteAufServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch { /* noch nicht da */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server kam nicht hoch:\n${serverAusgabe}`);
}

let browser;
try {
  await warteAufServer();

  // Eine Entwurfs-Folge hinterlegen, damit die Folgenseite etwas anzuzeigen hat.
  fs.writeFileSync(path.join(datenOrdner, 'store.json'), JSON.stringify({
    episodes: [{
      id: 'rauchtest', title: 'Rauchtest-Folge', description: 'Text.',
      descriptionSuggestion: 'Ein neuerer Vorschlag.', transcript: '', status: 'draft',
      parts: [{ id: 'p1', key: 'parts/rauchtest/p1.mp3', name: 'Teil 1', size: 10 }],
      audioUrl: '/media/x.mp3', audioKey: 'k', duration: 60, size: 1,
      enhance: { enabled: true, strength: 20 }, trimSilence: { enabled: true, seconds: 2 },
      createdAt: '2026-01-01T00:00:00.000Z', publishedAt: null,
    }],
  }, null, 2));

  browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {}
  );
  const page = await browser.newPage();
  const jsFehler = [];
  page.on('pageerror', (e) => jsFehler.push(String(e)));

  // ---- Anmelden ----
  await page.goto(`${BASE}/login`);
  await page.fill('input[type=password]', PASSWORT);
  await page.click('button[type=submit]');
  await page.waitForURL(`${BASE}/`);
  pruefe('Anmeldung führt zur Startseite', new URL(page.url()).pathname === '/');

  // ---- Startseite ----
  await page.waitForSelector('#strength');
  pruefe('Klangbereinigung steht auf 20 %', (await page.inputValue('#strength')) === '20',
    `ist ${await page.inputValue('#strength')}`);
  pruefe('Pausenkürzung steht auf 2,0 s', (await page.inputValue('#trimSec')) === '20');
  pruefe('Aufnahmeknopf vorhanden', (await page.locator('#recBtn').count()) === 1);

  // ---- Marke führt zurück ----
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('#s_title');
  await page.click('#homeBtn');
  await page.waitForTimeout(400);
  pruefe('Logo führt zur Startseite zurück', new URL(page.url()).pathname === '/');

  // ---- Folgenseite ----
  await page.goto(`${BASE}/episode/rauchtest`);
  await page.waitForSelector('#epDesc');
  const folgentext = await page.textContent('body');
  pruefe('Klang-Standanzeige vorhanden', folgentext.includes('Aktuelle Fassung:'));
  pruefe('Vorschlagskasten vorhanden', (await page.locator('#useSuggest').count()) === 1);
  pruefe('Transkript-Knopf vorhanden', (await page.locator('#sttBtn').count()) === 1);
  pruefe('Cover-Generator ist entfernt', !folgentext.includes('Cover generieren'));
  pruefe('Bild von Adresse übernehmen vorhanden', (await page.locator('#epImageUrlBtn').count()) === 1);
  pruefe('RNNoise-Schalter im Nachjustieren-Kasten', (await page.locator('#reRnn').count()) === 1);
  pruefe('Server-Knopf zum Neuberechnen vorhanden', (await page.locator('#reServerBtn').count()) === 1);

  // Das Modell muss ausgeliefert werden, sonst kann der Browser arnndn nicht
  // benutzen – und der Fehler fiele erst mitten in einer langen Bearbeitung auf.
  const modell = await page.request.get(`${BASE}/assets/rnnoise.rnn`);
  const modellBytes = modell.ok() ? (await modell.body()).length : 0;
  pruefe('RNNoise-Modell wird ausgeliefert', modell.ok() && modellBytes > 100000,
    `HTTP ${modell.status()}, ${modellBytes} Bytes`);

  // Speichern muss durchgehen.
  await page.fill('#epTitle', 'Rauchtest-Folge (geändert)');
  await page.click('#saveBtn');
  await page.waitForTimeout(800);
  pruefe('Speichern meldet Erfolg', (await page.textContent('#saveHint')).includes('gespeichert'));

  // ---- Einstellungen ----
  await page.goto(`${BASE}/settings`);
  await page.waitForSelector('#statusBox');
  await page.waitForTimeout(1200);
  const einstellungen = await page.textContent('body');
  pruefe('Systemstatus geladen', einstellungen.includes('Speicher:'));
  pruefe('Crew-Feld vorhanden', (await page.locator('#s_crew').count()) === 1);
  pruefe('Cover-Generator-Karte ist entfernt', !einstellungen.includes('Cover-Generator'));

  // ---- Feed ----
  const feed = await fetch(`${BASE}/feed.xml`);
  const feedText = await feed.text();
  pruefe('Feed antwortet mit XML', feed.ok && feedText.startsWith('<?xml'));

  pruefe('Keine JavaScript-Fehler im Browser', jsFehler.length === 0, jsFehler.join(' | '));
} catch (err) {
  pruefe('Durchlauf ohne Absturz', false, err.message);
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  fs.rmSync(datenOrdner, { recursive: true, force: true });
}

const gescheitert = pruefungen.filter((p) => !p.ok);
console.log(`\n${pruefungen.length - gescheitert.length} von ${pruefungen.length} Prüfungen bestanden.`);
if (gescheitert.length) {
  console.log('\nServer-Ausgabe:\n' + serverAusgabe.slice(-2000));
  process.exit(1);
}
