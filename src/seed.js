import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings, saveSettings } from './store.js';
import { uploadFile } from './storage.js';

const seedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed');

// Mitgelieferte Startdateien (Intro/Outro/Cover) beim ersten Start übernehmen.
// Läuft nur, wenn in den Einstellungen noch nichts hinterlegt ist – selbst
// hochgeladene Dateien werden also nie überschrieben.
const SEEDS = [
  { key: 'intro', files: ['intro.wav', 'intro.mp3'], type: 'audio' },
  { key: 'outro', files: ['outro.wav', 'outro.mp3'], type: 'audio' },
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
    if (settings[seed.key]) continue; // schon gesetzt – nichts tun
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

  // Ausgangsbilder für den Cover-Generator: alles aus seed/base-images/.
  if (!(settings.baseImages || []).length) {
    const dir = path.join(seedDir, 'base-images');
    if (fs.existsSync(dir)) {
      const names = [];
      for (const filename of fs.readdirSync(dir).sort()) {
        const ext = path.extname(filename).toLowerCase();
        if (!MIME[ext]?.startsWith('image/')) continue;
        try {
          await uploadFile(path.join(dir, filename), `base-images/${filename}`, MIME[ext]);
          names.push(filename);
        } catch (err) {
          console.error(`Ausgangsbild ${filename} konnte nicht übernommen werden:`, err.message);
        }
      }
      if (names.length) {
        patch.baseImages = names;
        console.log(`Ausgangsbilder übernommen: ${names.join(', ')}`);
      }
    }
  }

  if (Object.keys(patch).length) saveSettings(patch);
}
