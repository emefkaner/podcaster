import express from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { paths } from '../config.js';
import { requireAuth } from '../auth.js';
import { getSettings, saveSettings } from '../store.js';
import { uploadFile, deleteKey, publicUrl } from '../storage.js';

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

router.get('/', (req, res) => res.json({ ...getSettings(), coverUrl: coverUrlOf(getSettings()) }));

// Textfelder speichern.
router.put('/', (req, res) => {
  const allowed = ['title', 'description', 'author', 'ownerName', 'ownerEmail', 'language', 'category', 'explicit', 'sourceFeedUrl'];
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

export default router;
