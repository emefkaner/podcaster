import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { paths } from '../config.js';
import { requireAuth } from '../auth.js';
import { getSettings, saveSettings } from '../store.js';
import { uploadFile, deleteKey, publicUrl } from '../storage.js';
import { DEFAULT_STYLE } from '../artwork.js';

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
    imageStyle: s.imageStyle || DEFAULT_STYLE,
    coverUrl: coverUrlOf(s),
    baseImageUrls: baseUrls(s),
  });
});

// Textfelder speichern.
router.put('/', (req, res) => {
  const allowed = ['title', 'description', 'author', 'ownerName', 'ownerEmail', 'language',
                   'category', 'explicit', 'sourceFeedUrl', 'imageStyle', 'coverHeadline'];
  const patch = {};
  for (const key of allowed) {
    if (key in req.body) patch[key] = key === 'explicit' ? Boolean(req.body[key]) : req.body[key];
  }
  res.json(saveSettings(patch));
});

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
    for (const kind of ['intro', 'outro', 'cover']) {
      const f = req.files?.[kind]?.[0];
      if (!f) continue;
      const ext = path.extname(f.originalname) || (kind === 'cover' ? '.jpg' : '.mp3');
      const filename = `${kind}${ext}`;
      const key = `assets/${filename}`;
      const contentType = kind === 'cover' ? (f.mimetype || 'image/jpeg') : (f.mimetype || 'audio/mpeg');

      // Alte Datei mit abweichender Endung aufräumen.
      if (current[kind] && current[kind] !== filename) await deleteKey(`assets/${current[kind]}`);

      await uploadFile(f.path, key, contentType);
      fs.rmSync(f.path, { force: true }); // tmp aufräumen
      patch[kind] = filename;
    }
    const next = saveSettings(patch);
    res.json({ ...next, coverUrl: coverUrlOf(next) });
  }
);

function coverUrlOf(s) {
  return s.cover ? publicUrl(`assets/${s.cover}`) : '';
}

// ---- Ausgangsbilder für den Cover-Generator ----
// Mehrere erlaubt: je mehr Ansichten der Personen, desto besser bleiben die
// Gesichter über die Folgen hinweg wiedererkennbar.
const baseUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, paths.tmp),
    filename: (req, file, cb) => cb(null, `base-${Date.now()}-${crypto.randomBytes(3).toString('hex')}${path.extname(file.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post('/base-images', baseUpload.array('images', 6), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Keine Bilder erhalten' });
  const current = getSettings();
  const names = [...(current.baseImages || [])];
  try {
    for (const f of files) {
      const ext = (path.extname(f.originalname) || '.jpg').toLowerCase();
      const name = `${path.basename(f.filename, path.extname(f.filename))}${ext}`;
      await uploadFile(f.path, `base-images/${name}`, ext === '.png' ? 'image/png' : 'image/jpeg');
      names.push(name);
    }
    const next = saveSettings({ baseImages: names });
    res.json({ ...next, baseImageUrls: baseUrls(next) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    for (const f of files) fs.rmSync(f.path, { force: true });
  }
});

router.delete('/base-images/:name', async (req, res) => {
  const current = getSettings();
  const name = req.params.name;
  if (!(current.baseImages || []).includes(name)) return res.status(404).json({ error: 'Nicht gefunden' });
  await deleteKey(`base-images/${name}`);
  const next = saveSettings({ baseImages: current.baseImages.filter((n) => n !== name) });
  res.json({ ...next, baseImageUrls: baseUrls(next) });
});

function baseUrls(s) {
  return (s.baseImages || []).map((n) => ({ name: n, url: publicUrl(`base-images/${n}`) }));
}

export default router;
