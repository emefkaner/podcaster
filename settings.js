import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { paths } from '../config.js';
import { requireAuth } from '../auth.js';
import { getSettings, saveSettings, coverUrlOf } from '../store.js';
import { uploadFile, deleteKey, downloadToFile } from '../storage.js';
import { DEFAULT_CREW } from '../describe.js';

const router = express.Router();
router.use(requireAuth);

// Assets landen zuerst ephemer im tmp-Ordner, werden dann in den Speicher gelegt.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, paths.tmp),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

router.get('/', (req, res) => {
  const s = getSettings();
  res.json({
    ...s,
    crew: s.crew || DEFAULT_CREW,
    coverUrl: coverUrlOf(s),
    // Adressen für die Aufbereitung im Browser. Bewusst über die eigene App
    // statt direkt aus dem Speicher: Der Browser darf fremde Adressen nur mit
    // ausdrücklicher Freigabe abrufen, und die schickt R2 nicht mit.
    introUrl: s.intro ? `/api/settings/asset/intro` : '',
    outroUrl: s.outro ? `/api/settings/asset/outro` : '',
  });
});

// Textfelder speichern.
router.put('/', (req, res) => {
  const allowed = ['title', 'description', 'author', 'ownerName', 'ownerEmail', 'language',
                   'category', 'explicit', 'sourceFeedUrl', 'crew'];
  const patch = {};
  for (const key of allowed) {
    if (key in req.body) patch[key] = key === 'explicit' ? Boolean(req.body[key]) : req.body[key];
  }
  res.json(saveSettings(patch));
});

// Dateiname mit Zeitstempel.
//
// Früher hieß jedes Cover schlicht `cover.png`. Ein neues Bild landete damit
// unter DERSELBEN Adresse – und Browser, CDN und vor allem Podcast-Apps zeigten
// weiter ihr zwischengespeichertes altes Bild. Ein Anhängsel wie `?v=123` hilft
// im Browser, aber Apples Cover-Abruf ignoriert Fragezeichen-Anhängsel gern.
// Deshalb ändert sich der Dateiname selbst; die alte Datei wird gelöscht.
function assetName(kind, ext) {
  return `${kind}-${Date.now()}${ext}`;
}

// Intro/Outro/Cover hochladen.
router.post(
  '/assets',
  upload.fields([
    { name: 'intro', maxCount: 1 },
    { name: 'outro', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
  async (req, res) => {
    const current = getSettings();
    const patch = {};
    const hochgeladen = ['intro', 'outro', 'cover'].filter((k) => req.files?.[k]?.[0]);
    if (!hochgeladen.length) {
      return res.status(400).json({ error: 'Keine Datei ausgewählt.' });
    }

    // Jede Datei einzeln absichern: Geht das Cover schief, sollen Intro und
    // Outro trotzdem ankommen – und der Grund muss beim Nutzer landen, nicht
    // nur im Serverprotokoll. Vorher endete jeder Fehler hier als nacktes
    // „Fehler", weil Express eine HTML-Seite zurückgab.
    const fehler = [];
    for (const kind of hochgeladen) {
      const f = req.files[kind][0];
      const ext = path.extname(f.originalname) || (kind === 'cover' ? '.jpg' : '.mp3');
      const filename = assetName(kind, ext);
      const contentType = kind === 'cover' ? (f.mimetype || 'image/jpeg') : (f.mimetype || 'audio/mpeg');
      try {
        // Alte Datei mit abweichender Endung aufräumen.
        if (current[kind] && current[kind] !== filename) await deleteKey(`assets/${current[kind]}`);
        await uploadFile(f.path, `assets/${filename}`, contentType);
        patch[kind] = filename;
        if (kind === 'cover') patch.coverStand = new Date().toISOString();
      } catch (e) {
        console.error(`Hochladen von ${kind} fehlgeschlagen:`, e);
        fehler.push(`${kind}: ${e.message}`);
      } finally {
        fs.rmSync(f.path, { force: true }); // tmp aufräumen
      }
    }

    const next = Object.keys(patch).length ? saveSettings(patch) : current;
    if (fehler.length) {
      return res.status(500).json({
        error: fehler.join(' · '),
        gespeichert: Object.keys(patch),
        ...next, coverUrl: coverUrlOf(next),
      });
    }
    res.json({ ...next, coverUrl: coverUrlOf(next) });
  }
);

// Podcast-Cover von einer Adresse übernehmen – so wie in der Folge auch.
// Spart den Umweg über „herunterladen, dann wieder hochladen", wenn das Bild
// ohnehin schon irgendwo im Netz liegt.
router.post('/cover-from-url', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Bitte eine vollständige Adresse angeben (http:// oder https://).' });
  }

  const tmp = path.join(paths.tmp, `cover-url-${Date.now()}`);
  try {
    const antwort = await fetch(url);
    if (!antwort.ok) throw new Error(`Bild nicht abrufbar (HTTP ${antwort.status}).`);
    const typ = (antwort.headers.get('content-type') || '').split(';')[0].trim();
    if (!typ.startsWith('image/')) throw new Error(`Das ist kein Bild, sondern „${typ || 'unbekannt'}".`);

    const daten = Buffer.from(await antwort.arrayBuffer());
    if (!daten.length) throw new Error('Das Bild kam leer zurück.');
    fs.writeFileSync(tmp, daten);

    const ext = typ === 'image/png' ? '.png' : typ === 'image/webp' ? '.webp' : '.jpg';
    const filename = assetName('cover', ext);
    const current = getSettings();
    if (current.cover && current.cover !== filename) await deleteKey(`assets/${current.cover}`);

    await uploadFile(tmp, `assets/${filename}`, typ);
    const next = saveSettings({ cover: filename, coverStand: new Date().toISOString() });
    res.json({ ...next, coverUrl: coverUrlOf(next) });
  } catch (e) {
    console.error('Cover von Adresse übernehmen fehlgeschlagen:', e);
    res.status(500).json({ error: e.message });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

// Intro/Outro/Cover über die eigene App ausliefern.
// Nötig, weil der Browser Dateien von fremden Adressen (dem R2-Speicher) nur mit
// CORS-Freigabe abrufen darf – die R2 standardmäßig nicht mitschickt.
const ASSET_MIME = {
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
};

router.get('/asset/:kind', async (req, res) => {
  const kind = req.params.kind;
  if (!['intro', 'outro', 'cover'].includes(kind)) {
    return res.status(400).json({ error: 'Unbekannte Art' });
  }
  const name = getSettings()[kind];
  if (!name) return res.status(404).json({ error: `${kind} ist nicht hinterlegt` });

  // Einmal geholte Dateien im Arbeitsordner behalten, damit nicht bei jedem
  // Aufruf erneut aus dem Speicher geladen wird.
  const lokal = path.join(paths.tmp, `asset-${kind}-${name}`);
  try {
    let datei = lokal;
    if (!fs.existsSync(lokal)) {
      // Ohne R2 liegt die Datei schon auf der Platte; downloadToFile gibt dann
      // deren Pfad zurück, statt sie zu kopieren. Diesen Pfad verwenden.
      const geholt = await downloadToFile(`assets/${name}`, lokal);
      if (!geholt || !fs.existsSync(geholt)) {
        return res.status(404).json({ error: 'Datei nicht im Speicher gefunden' });
      }
      datei = geholt;
    }
    res.type(ASSET_MIME[path.extname(name).toLowerCase()] || 'application/octet-stream');
    res.sendFile(path.resolve(datei));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
