// Schneidet die drei Gesichter aus einer Vorlage aus.
//
// Wozu: Als Referenz fürs Bildmodell taugt ein ganzes Gruppenbild schlecht —
// darin ist jedes Gesicht nur rund 150 Pixel groß, und entsprechend ungenau
// kommen die Figuren zurück. Einzelne Kopf-Ausschnitte liefern dem Modell ein
// Vielfaches an Bildpunkten pro Gesicht.
//
// WICHTIG — welche Vorlage wofür:
//   „foto"  = das Originalfoto der drei. Liefert die GESICHTER. Das ist die
//             richtige Quelle. Das Foto liegt bewusst nicht im Repo, weil
//             `podcaster` öffentlich ist; der Nutzer schickt es in den Chat.
//   „cover" = ein bestehendes Folgen-Cover. Taugt nur als STIL-Vorlage.
//             Als Gesichtsquelle ist es eine Kopie der Kopie und liefert
//             generische Figuren — daran sind die ersten Versuche gescheitert.
//             Die Ausschnitte hier gibt es nur noch für Notfälle.
//
// Aufruf:
//   node cover-vorlagen/gesichter-ausschneiden.mjs <quelle> [zielordner] [gruppe|cover]
//
// Ohne Angaben: 03-hail-mary.jpg aus diesem Ordner, Aufteilung „cover",
// Ziel ./gesichter/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const hier = path.dirname(fileURLToPath(import.meta.url));
const quelle = process.argv[2] || path.join(hier, '03-hail-mary.jpg');
const ziel = process.argv[3] || path.join(process.cwd(), 'gesichter');
const aufteilung = process.argv[4] || (process.argv[2] ? 'gruppe' : 'cover');

// Kopf plus Schultern, als Anteil von Breite/Höhe — gilt damit für jede
// Auflösung derselben Vorlage. Beide Aufteilungen von Hand geprüft.
const AUFTEILUNGEN = {
  // Reihenfolge wie auf dem Cover, von links nach rechts.
  cover: [
    { name: 'matthias', x: 0.02, y: 0.34, w: 0.33, h: 0.36 },
    { name: 'maurice',  x: 0.36, y: 0.28, w: 0.30, h: 0.34 },
    { name: 'emefka',   x: 0.62, y: 0.28, w: 0.34, h: 0.34 },
  ],
  // Gruppenfoto mit ALLEN VIER (Messe, rote Wand mit leuchtender „1",
  // 4032x3024). Reihenfolge vom Nutzer bestätigt, von links nach rechts:
  // Andreas, Matthias, Maurice, emefka. Das ist die beste Quelle — hier ist
  // die Zuordnung belegt statt erschlossen.
  gruppe: [
    { name: 'andreas',  x: 0.03, y: 0.16, w: 0.26, h: 0.62 },
    { name: 'matthias', x: 0.28, y: 0.10, w: 0.20, h: 0.50 },
    { name: 'maurice',  x: 0.46, y: 0.08, w: 0.24, h: 0.62 },
    { name: 'emefka',   x: 0.66, y: 0.06, w: 0.30, h: 0.62 },
  ],
  // Älteres Selfie vom Kinobesuch (IMG_2691, 4032x3024), nur drei Personen.
  // ACHTUNG: Diese Namen sind von mir erschlossen und vermutlich FALSCH —
  // der Abgleich mit dem Gruppenfoto legt nahe, dass links Andreas steht,
  // nicht Maurice. Nicht verwenden, solange das nicht geklärt ist.
  'foto-ungeprueft': [
    { name: 'maurice',  x: 0.00, y: 0.13, w: 0.31, h: 0.62 },
    { name: 'emefka',   x: 0.28, y: 0.00, w: 0.37, h: 0.80 },
    { name: 'matthias', x: 0.62, y: 0.13, w: 0.36, h: 0.62 },
  ],
};

const AUSSCHNITTE = AUFTEILUNGEN[aufteilung];
if (!AUSSCHNITTE) {
  console.error(`Unbekannte Aufteilung: ${aufteilung} (erlaubt: ${Object.keys(AUFTEILUNGEN).join(', ')})`);
  process.exit(1);
}

// Referenzbilder brauchen keine Kameraauflösung; das begrenzt die Dateigröße.
const MAX_KANTE = 1024;

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
    const erg = await page.evaluate(async ({ daten, x, y, w, h, max }) => {
      const img = new Image();
      await new Promise((ok, fehler) => { img.onload = ok; img.onerror = fehler; img.src = daten; });
      const sx = Math.round(img.naturalWidth * x);
      const sy = Math.round(img.naturalHeight * y);
      const sw = Math.round(img.naturalWidth * w);
      const sh = Math.round(img.naturalHeight * h);
      const s = Math.min(max / sw, max / sh, 1);
      const cv = document.createElement('canvas');
      cv.width = Math.round(sw * s); cv.height = Math.round(sh * s);
      cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
      return { masse: `${cv.width}x${cv.height}`, jpeg: cv.toDataURL('image/jpeg', 0.95) };
    }, { daten, x, y, w, h, max: MAX_KANTE });

    const datei = path.join(ziel, `gesicht-${name}.jpg`);
    const buf = Buffer.from(erg.jpeg.split(',')[1], 'base64');
    fs.writeFileSync(datei, buf);
    console.log(`${path.basename(datei).padEnd(24)} ${erg.masse}  ${Math.round(buf.length / 1024)} KB`);
  }
} finally {
  await browser.close();
}

console.log(`\nFertig. Ausschnitte liegen in: ${ziel}`);
