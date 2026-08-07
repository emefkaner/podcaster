import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings, saveSettings } from './store.js';
import { uploadFile } from './storage.js';

const seedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed');

// Mitgelieferte Startdateien (Intro/Outro/Cover) beim ersten Start übernehmen.
// Läuft, wenn in den Einstellungen noch nichts hinterlegt ist ODER dort noch
// eine ältere mitgelieferte Datei steht (Liste `ersetzt`). Selbst hochgeladene
// Dateien haben andere Namen und werden deshalb nie überschrieben.
const SEEDS = [
  // Cold-Open-Intro (seit 08/2026). Ersetzt das alte intro.wav automatisch,
  // damit der Wechsel ohne Handgriff in der laufenden App ankommt.
  { key: 'intro', files: ['intro-coldopen.mp3'], ersetzt: ['intro.wav', 'intro.mp3'], type: 'audio' },
  // Outro „Last Take" (seit 08/2026). Ersetzt das alte outro.wav automatisch.
  { key: 'outro', files: ['outro-lasttake.mp3'], ersetzt: ['outro.wav', 'outro.mp3'], type: 'audio' },
  { key: 'cover', files: ['cover.jpg', 'cover.png'], type: 'image' },
];

const MIME = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

export async function seedAssets() {
  if (!fs.existsSync(seedDir)) return;
  const settings = getSettings();
  const patch = {};

  for (const seed of SEEDS) {
    const aktuell = settings[seed.key];
    const veraltet = (seed.ersetzt || []).includes(aktuell);
    if (aktuell && !veraltet) continue; // eigene oder aktuelle Datei – nie anfassen
    const found = seed.files.map((f) => path.join(seedDir, f)).find((p) => fs.existsSync(p));
    if (!found) continue;

    const filename = path.basename(found);
    try {
      await uploadFile(found, `assets/${filename}`, MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream');
      patch[seed.key] = filename;
      console.log(`Startdatei übernommen: ${seed.key} (${filename})`);
    } catch (err) {
      console.error(`Startdatei ${seed.key} konnte nicht übernommen werden:`, err.message);
    }
  }

  if (Object.keys(patch).length) saveSettings(patch);
}
