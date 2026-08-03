import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';
import { requireAuth } from '../auth.js';
import { listEpisodes, getEpisode, saveEpisode, deleteEpisode, getSettings } from '../store.js';
import { buildEpisode } from '../audio.js';
import { transcribe } from '../transcribe.js';
import { generateDescription } from '../describe.js';
import { uploadFile, downloadToFile, deleteKey } from '../storage.js';
import { config } from '../config.js';
import { publishToAnchor } from '../anchorPublisher.js';
import { generateCandidates } from '../artwork.js';

const router = express.Router();
router.use(requireAuth);

// Uploads landen zunächst als Rohdatei im ephemeren tmp-Ordner.
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, paths.tmp),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.webm';
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB – reicht für lange Folgen
});

router.get('/', (req, res) => res.json(listEpisodes()));

router.get('/:id', (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json(ep);
});

// Neue Aufnahme/Upload entgegennehmen und Verarbeitung im Hintergrund starten.
router.post('/', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Audiodatei erhalten' });

  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const episode = {
    id,
    title: (req.body.title || '').trim() || 'Neue Folge',
    description: '',
    transcript: '',
    status: 'processing', // processing -> draft -> published
    rawTmp: req.file.filename,   // ephemerer Roh-Upload (nur während Verarbeitung)
    audioKey: '',                // R2-/Medien-Key der fertigen MP3
    audioUrl: '',                // öffentliche URL der fertigen MP3
    duration: 0,
    size: 0,
    enhance: {
      enabled: req.body.enhance === 'true' || req.body.enhance === '1',
      strength: Math.min(100, Math.max(0, Number(req.body.strength) || 60)),
    },
    error: '',
    createdAt: new Date().toISOString(),
    publishedAt: null,
  };
  saveEpisode(episode);

  processEpisode(id).catch((err) => {
    console.error('Verarbeitung fehlgeschlagen:', err);
    const ep = getEpisode(id);
    if (ep) saveEpisode({ ...ep, status: 'error', error: err.message });
  });

  res.status(202).json(episode);
});

// Eigenes Bild für eine Folge hochladen (überschreibt das Podcast-Cover in den Apps).
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, paths.tmp),
    filename: (req, file, cb) => cb(null, `epimg-${Date.now()}${path.extname(file.originalname) || '.jpg'}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
});

router.post('/:id/image', imageUpload.single('image'), async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!req.file) return res.status(400).json({ error: 'Kein Bild erhalten' });

  const ext = (path.extname(req.file.originalname) || '.jpg').toLowerCase();
  const key = `episode-images/${ep.id}${ext}`;
  try {
    if (ep.imageKey && ep.imageKey !== key) await deleteKey(ep.imageKey);
    ep.imageUrl = await uploadFile(req.file.path, key, ext === '.png' ? 'image/png' : 'image/jpeg');
    ep.imageKey = key;
    saveEpisode(ep);
    res.json(ep);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

// Cover-Vorschläge erzeugen: Ausgangsbild(er) passend zum Folgenthema abwandeln.
router.post('/:id/artwork', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });

  const settings = getSettings();
  const wish = (req.body?.prompt || '').trim();
  const count = Math.min(4, Math.max(1, Number(req.body?.count) || 3));

  // Ausgangsbilder in den Arbeitsordner holen.
  const localBases = [];
  for (const name of settings.baseImages || []) {
    const local = await downloadToFile(`base-images/${name}`, path.join(paths.tmp, `base-${name}`));
    if (local) localBases.push(local);
  }

  try {
    const images = await generateCandidates({
      basePaths: localBases,
      wish,
      style: settings.imageStyle,
      title: ep.title,
      count,
    });

    // Vorschläge ablegen, damit sie im Browser angezeigt werden können.
    const candidates = [];
    for (let i = 0; i < images.length; i++) {
      const ext = images[i].mimeType === 'image/jpeg' ? '.jpg' : '.png';
      const key = `artwork-candidates/${ep.id}-${Date.now()}-${i}${ext}`;
      const tmpFile = path.join(paths.tmp, path.basename(key));
      fs.writeFileSync(tmpFile, images[i].data);
      const url = await uploadFile(tmpFile, key, images[i].mimeType);
      fs.rmSync(tmpFile, { force: true });
      candidates.push({ key, url });
    }

    const cur = getEpisode(ep.id);
    // Vorherige, nicht gewählte Vorschläge aufräumen.
    for (const old of cur.artworkCandidates || []) {
      if (old.key !== cur.imageKey) await deleteKey(old.key);
    }
    cur.artworkCandidates = candidates;
    cur.artworkPrompt = wish;
    saveEpisode(cur);

    res.json({ candidates });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    for (const f of localBases) fs.rmSync(f, { force: true });
  }
});

// Einen Vorschlag als Folgen-Cover übernehmen (die anderen werden gelöscht).
router.post('/:id/artwork/select', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  const chosen = (ep.artworkCandidates || []).find((c) => c.key === req.body?.key);
  if (!chosen) return res.status(400).json({ error: 'Vorschlag nicht gefunden' });

  if (ep.imageKey && ep.imageKey !== chosen.key) await deleteKey(ep.imageKey);
  for (const c of ep.artworkCandidates) {
    if (c.key !== chosen.key) await deleteKey(c.key);
  }
  ep.imageKey = chosen.key;
  ep.imageUrl = chosen.url;
  ep.artworkCandidates = [];
  saveEpisode(ep);
  res.json(ep);
});

// Titel/Beschreibung bearbeiten (Freigabe/Änderung durch den Nutzer).
router.put('/:id', (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  if (typeof req.body.title === 'string') ep.title = req.body.title.trim();
  if (typeof req.body.description === 'string') ep.description = req.body.description;
  saveEpisode(ep);
  res.json(ep);
});

// Veröffentlichen – nur nach ausdrücklicher Bestätigung im Frontend.
router.post('/:id/publish', (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  if (ep.status === 'processing') return res.status(409).json({ error: 'Wird noch verarbeitet' });
  if (!ep.audioUrl) return res.status(409).json({ error: 'Keine fertige Audiodatei' });
  ep.status = 'published';
  ep.publishedAt = ep.publishedAt || new Date().toISOString();
  saveEpisode(ep);
  res.json(ep);
});

// Direkt in Spotify for Podcasters (Anchor) pushen – per Browser-Automation.
router.post('/:id/push-anchor', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!ep.audioKey && !ep.audioUrl) return res.status(409).json({ error: 'Keine fertige Audiodatei' });
  if (!config.anchor.email || !config.anchor.password) {
    return res.status(400).json({ error: 'ANCHOR_EMAIL/ANCHOR_PASSWORD sind nicht gesetzt.' });
  }

  // Fertige MP3 lokal bereitstellen (aus dem Speicher laden, falls nötig).
  const localPath = path.join(paths.tmp, `push-${ep.id}.mp3`);
  try {
    if (ep.audioKey) {
      await downloadToFile(ep.audioKey, localPath);
    } else {
      const r = await fetch(ep.audioUrl);
      if (!r.ok) throw new Error(`Download fehlgeschlagen (HTTP ${r.status})`);
      fs.writeFileSync(localPath, Buffer.from(await r.arrayBuffer()));
    }
  } catch (e) {
    return res.status(500).json({ error: `Audio konnte nicht geladen werden: ${e.message}` });
  }

  const result = await publishToAnchor({
    email: config.anchor.email,
    password: config.anchor.password,
    audioPath: localPath,
    title: ep.title,
    description: ep.description,
  });
  fs.rmSync(localPath, { force: true });

  const cur = getEpisode(ep.id);
  cur.anchorStatus = result.ok ? 'pushed' : 'failed';
  cur.anchorError = result.ok ? '' : (result.error || '');
  cur.anchorPushedAt = result.ok ? new Date().toISOString() : cur.anchorPushedAt || null;
  saveEpisode(cur);

  if (!result.ok) return res.status(502).json(result);
  res.json({ ok: true, episode: cur });
});

router.post('/:id/unpublish', (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  ep.status = 'draft';
  saveEpisode(ep);
  res.json(ep);
});

// Episode löschen (inkl. Mediendatei).
router.delete('/:id', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  if (ep.audioKey) await deleteKey(ep.audioKey);
  if (ep.imageKey) await deleteKey(ep.imageKey);
  if (ep.rawTmp) fs.rmSync(path.join(paths.tmp, ep.rawTmp), { force: true });
  deleteEpisode(ep.id);
  res.json({ ok: true });
});

// ---- Die eigentliche Pipeline ----
async function processEpisode(id) {
  const settings = getSettings();
  let ep = getEpisode(id);
  if (!ep) return;

  const rawPath = path.join(paths.tmp, ep.rawTmp);

  // Intro/Outro bei Bedarf aus dem Speicher in den tmp-Ordner holen.
  let introPath = null, outroPath = null;
  if (settings.intro) {
    introPath = await downloadToFile(`assets/${settings.intro}`, path.join(paths.tmp, `intro-${id}${path.extname(settings.intro)}`));
  }
  if (settings.outro) {
    outroPath = await downloadToFile(`assets/${settings.outro}`, path.join(paths.tmp, `outro-${id}${path.extname(settings.outro)}`));
  }

  const outPath = path.join(paths.tmp, `${id}.mp3`);

  // 1) Intro + Aufnahme + Outro zusammenfügen (inkl. optionaler KI-Optimierung).
  const { duration, size } = await buildEpisode({
    intro: introPath, main: rawPath, outro: outroPath, outFile: outPath, enhance: ep.enhance,
  });

  // 2) Fertige MP3 in den persistenten Speicher (R2 oder lokal) hochladen.
  const audioKey = `episodes/${id}.mp3`;
  const audioUrl = await uploadFile(outPath, audioKey, 'audio/mpeg');

  ep = getEpisode(id);
  ep.audioKey = audioKey;
  ep.audioUrl = audioUrl;
  ep.duration = duration;
  ep.size = size;
  saveEpisode(ep);

  // 3) Transkribieren (nur die Rohaufnahme, ohne Intro/Outro).
  let transcript = '';
  try {
    transcript = await transcribe(rawPath);
  } catch (err) {
    console.error('Transkription fehlgeschlagen:', err.message);
  }

  // 4) Infotext-Vorschlag generieren.
  const description = await generateDescription({ transcript, title: ep.title });

  ep = getEpisode(id);
  ep.transcript = transcript;
  ep.description = description;
  ep.status = 'draft';
  saveEpisode(ep);

  // Aufräumen: ephemere Arbeitsdateien entfernen.
  for (const f of [rawPath, outPath, introPath, outroPath]) {
    if (f) fs.rmSync(f, { force: true });
  }
  ep = getEpisode(id);
  ep.rawTmp = '';
  saveEpisode(ep);
}

export default router;
