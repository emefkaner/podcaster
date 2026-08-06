// Schneidet die drei Gesichter aus einer Cover-Vorlage aus.
//
// Wozu: Als Referenz fürs Bildmodell taugt ein ganzes Cover schlecht — darin
// ist jedes Gesicht nur rund 150 Pixel groß, und entsprechend ungenau kommen
// die Figuren zurück. Einzelne Kopf-Ausschnitte liefern dem Modell ein
// Vielfaches an Bildpunkten pro Gesicht.
//
// Am besten gegen die 2048er-Originale aus dem R2-Speicher laufen lassen
// (`base-images/`), nicht gegen die 1024er-Kopien hier im Ordner — dann sind
// die Ausschnitte etwa 700 statt 350 Pixel groß.
//
// Aufruf:
//   node cover-vorlagen/gesichter-ausschneiden.mjs [quelle.jpg] [zielordner]
//
// Ohne Angaben: nimmt 03-hail-mary.jpg aus diesem Ordner und schreibt nach ./gesichter/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const hier = path.dirname(fileURLToPath(import.meta.url));
const quelle = process.argv[2] || path.join(hier, '03-hail-mary.jpg');
const ziel = process.argv[3] || path.join(process.cwd(), 'gesichter');

// Kopf plus Schultern, als Anteil von Breite/Höhe — gilt damit für jede
// Auflösung derselben Vorlage. Von Hand geprüft an 03-hail-mary.
// Reihenfolge wie auf dem Cover, von links nach rechts.
const AUSSCHNITTE = [
  { name: 'matthias', x: 0.02, y: 0.34, w: 0.33, h: 0.36 },
  { name: 'maurice',  x: 0.36, y: 0.28, w: 0.30, h: 0.34 },
  { name: 'emefka',   x: 0.62, y: 0.28, w: 0.34, h: 0.34 },
];

// Chromium bringt den Bild-Decoder und Canvas mit; sonst bräuchte es eine
// zusätzliche Bibliothek nur fürs Zuschneiden.
const browserPfad = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';

if (!fs.existsSync(quelle)) {
  console.error(`Quelle nicht gefunden: ${quelle}`);
  process.exit(1);
}
fs.mkdirSync(ziel, { recursive: true });

const endung = path.extname(quelle).toLowerCase();
const mime = endung === '.png' ? 'image/png' : 'image/jpeg';
const daten = `data:${mime};base64,${fs.readFileSync(quelle).toString('base64')}`;

const browser = await chromium.launch(
  fs.existsSync(browserPfad) ? { executablePath: browserPfad } : {}
);
const page = await browser.newPage();

try {
  for (const { name, x, y, w, h } of AUSSCHNITTE) {
    const erg = await page.evaluate(async ({ daten, x, y, w, h }) => {
      const img = new Image();
      await new Promise((ok, fehler) => { img.onload = ok; img.onerror = fehler; img.src = daten; });
      const sx = Math.round(img.naturalWidth * x);
      const sy = Math.round(img.naturalHeight * y);
      const sw = Math.round(img.naturalWidth * w);
      const sh = Math.round(img.naturalHeight * h);
      const cv = document.createElement('canvas');
      cv.width = sw; cv.height = sh;
      cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      return { masse: `${sw}x${sh}`, jpeg: cv.toDataURL('image/jpeg', 0.95) };
    }, { daten, x, y, w, h });

    const datei = path.join(ziel, `gesicht-${name}.jpg`);
    const buf = Buffer.from(erg.jpeg.split(',')[1], 'base64');
    fs.writeFileSync(datei, buf);
    console.log(`${path.basename(datei).padEnd(24)} ${erg.masse}  ${Math.round(buf.length / 1024)} KB`);
  }
} finally {
  await browser.close();
}

console.log(`\nFertig. Ausschnitte liegen in: ${ziel}`);
