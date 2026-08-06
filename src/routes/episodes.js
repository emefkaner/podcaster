import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';
import { requireAuth } from '../auth.js';
import { listEpisodes, getEpisode, saveEpisode, deleteEpisode, getSettings } from '../store.js';
import { buildEpisode, buildEpisodeCopy, probeDuration } from '../audio.js';
import { transcribeAll } from '../transcribe.js';
import { generateDescription } from '../describe.js';
import { uploadFile, downloadToFile, deleteKey } from '../storage.js';
import { config } from '../config.js';
import { publishToAnchor } from '../anchorPublisher.js';
import { generatePeaks, cutRegions } from '../waveform.js';

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

// Standard-Rauschunterdrückung. 20 % hat sich als guter Ausgangswert erwiesen:
// hörbar sauberer, ohne dass die Stimmen dumpf werden.
const STANDARD_STAERKE = 20;
const STANDARD_PAUSE = 2;

// Zahl aus einer Formular-/JSON-Angabe lesen. Anders als `Number(x) || standard`
// bleibt hier eine echte 0 erhalten.
function zahl(wert, standard, min, max) {
  const n = Number(wert);
  if (!Number.isFinite(n)) return standard;
  return Math.min(max, Math.max(min, n));
}

// Fortlaufende Nummer für veröffentlichte Folgen – älteste ist Nummer 1.
// Dient nur der eigenen Übersicht und taucht bewusst nicht im RSS-Feed auf.
function folgennummern(eps) {
  const nummern = new Map();
  eps
    .filter((e) => e.status === 'published')
    .sort((a, b) => new Date(a.publishedAt || a.createdAt) - new Date(b.publishedAt || b.createdAt))
    .forEach((e, i) => nummern.set(e.id, i + 1));
  return nummern;
}

router.get('/', (req, res) => {
  const eps = listEpisodes();
  const nummern = folgennummern(eps);
  res.json(eps.map((e) => ({ ...e, nummer: nummern.get(e.id) || null })));
});

router.get('/:id', (req, res) => {
  const eps = listEpisodes();
  const ep = eps.find((e) => e.id === req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  res.json({ ...ep, nummer: folgennummern(eps).get(ep.id) || null });
});

// Neue Folge anlegen. Es dürfen gleich mehrere Aufnahme-Teile mitkommen –
// eine Folge besteht oft aus Vorgespräch und Spoilerteil.
// „audio" sind die einzelnen Teile, „fertig" die im Browser bereits
// zusammengebaute Folge – letztere spart dem Server die gesamte Audioarbeit.
const uploadFelder = upload.fields([
  { name: 'audio', maxCount: 12 },
  { name: 'fertig', maxCount: 1 },
]);

router.post('/', uploadFelder, async (req, res) => {
  const files = req.files?.audio || [];
  const fertigDatei = req.files?.fertig?.[0] || null;
  if (!files.length) return res.status(400).json({ error: 'Keine Audiodatei erhalten' });

  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const episode = {
    id,
    title: (req.body.title || '').trim() || 'Neue Folge',
    description: '',
    transcript: '',
    status: 'processing', // processing -> draft -> published
    parts: [],            // Aufnahme-Teile in Abspielreihenfolge
    audioKey: '',         // fertige MP3 (Intro + Teile + Outro)
    audioUrl: '',
    duration: 0,
    size: 0,
    needsRebuild: false,  // true, sobald sich die Teile nach dem Bau ändern
    enhance: {
      enabled: req.body.enhance === 'true' || req.body.enhance === '1',
      strength: zahl(req.body.strength, STANDARD_STAERKE, 0, 100),
    },
    // Lange Sprechpausen automatisch kürzen.
    trimSilence: {
      enabled: req.body.trimSilence === 'true' || req.body.trimSilence === '1',
      seconds: zahl(req.body.trimSeconds, STANDARD_PAUSE, 0.5, 10),
    },
    // Wurde schon auf dem Gerät des Nutzers bearbeitet? Dann hier nicht nochmal.
    lokalBearbeitet: req.body.lokalBearbeitet === 'true' || req.body.lokalBearbeitet === '1',
    error: '',
    createdAt: new Date().toISOString(),
    publishedAt: null,
  };
  saveEpisode(episode);

  try {
    await storeParts(id, files);
  } catch (e) {
    saveEpisode({ ...getEpisode(id), status: 'error', error: e.message });
    return res.status(500).json({ error: e.message });
  }

  buildAndAnalyse(id, { fertigDatei }).catch((err) => {
    console.error('Verarbeitung fehlgeschlagen:', err);
    const ep = getEpisode(id);
    if (ep) saveEpisode({ ...ep, status: 'error', error: err.message });
  });

  res.status(202).json(getEpisode(id));
});

// Weitere Aufnahme-Teile zu einer bestehenden Folge hinzufügen.
router.post('/:id/parts', upload.array('audio', 12), async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Keine Audiodatei erhalten' });

  try {
    await storeParts(ep.id, files);
    const cur = getEpisode(ep.id);
    cur.needsRebuild = true;
    saveEpisode(cur);
    res.json(cur);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Einen Aufnahme-Teil über die App ausliefern. Nötig, damit der Browser die
// Originale erneut bearbeiten kann – aus dem Speicher direkt darf er nicht.
router.get('/:id/parts/:partId/file', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  const part = (ep.parts || []).find((p) => p.id === req.params.partId);
  if (!part) return res.status(404).json({ error: 'Teil nicht gefunden' });

  const lokal = path.join(paths.tmp, `teil-${ep.id}-${part.id}${path.extname(part.key)}`);
  try {
    let datei = lokal;
    if (!fs.existsSync(lokal)) {
      const geholt = await downloadToFile(part.key, lokal);
      if (!geholt || !fs.existsSync(geholt)) {
        return res.status(404).json({ error: 'Aufnahme nicht im Speicher gefunden' });
      }
      datei = geholt;
    }
    res.sendFile(path.resolve(datei));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Neu berechnete Folge übernehmen (im Browser aus den Originalen erzeugt).
const fertigUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, paths.tmp),
    filename: (req, file, cb) => cb(null, `neu-${Date.now()}.mp3`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

router.post('/:id/fertig', fertigUpload.single('fertig'), async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten' });

  try {
    const audioKey = `episodes/${ep.id}.mp3`;
    const url = await uploadFile(req.file.path, audioKey, 'audio/mpeg');
    const dauer = await probeDuration(req.file.path).catch(() => ep.duration || 0);

    const cur = getEpisode(ep.id);
    cur.audioKey = audioKey;
    // Anhängsel erzwingt, dass Abspieler die neue Fassung laden.
    cur.audioUrl = `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
    cur.duration = dauer;
    cur.size = fs.statSync(req.file.path).size;
    cur.needsRebuild = false;
    // Eingestellte Werte mitschreiben, damit die Regler den Stand zeigen.
    if (req.body?.strength !== undefined) {
      cur.enhance = {
        enabled: req.body.enhance !== 'false',
        strength: zahl(req.body.strength, STANDARD_STAERKE, 0, 100),
      };
    }
    if (req.body?.trimSeconds !== undefined) {
      cur.trimSilence = {
        enabled: req.body.trimSilence !== 'false',
        seconds: zahl(req.body.trimSeconds, STANDARD_PAUSE, 0.5, 10),
      };
    }
    // Wann zuletzt neu berechnet wurde – die App zeigt es unter „Klang nachjustieren".
    cur.klangStand = new Date().toISOString();
    saveEpisode(cur);
    res.json(cur);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    fs.rmSync(req.file.path, { force: true });
  }
});

// Wellenform eines Teils liefern (wird zwischengespeichert, da die Berechnung dauert).
router.get('/:id/parts/:partId/peaks', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  const part = (ep.parts || []).find((p) => p.id === req.params.partId);
  if (!part) return res.status(404).json({ error: 'Teil nicht gefunden' });

  if (part.peaks?.length) return res.json({ peaks: part.peaks, duration: part.duration || 0 });

  const local = path.join(paths.tmp, `wf-${ep.id}-${part.id}${path.extname(part.key)}`);
  try {
    const got = await downloadToFile(part.key, local);
    if (!got) throw new Error('Aufnahme nicht abrufbar.');
    const { peaks, duration } = await generatePeaks(got);

    const cur = getEpisode(ep.id);
    const target = (cur.parts || []).find((p) => p.id === part.id);
    if (target) { target.peaks = peaks; target.duration = duration; saveEpisode(cur); }

    res.json({ peaks, duration });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    fs.rmSync(local, { force: true });
  }
});

// Bereiche aus einem Teil herausschneiden.
router.post('/:id/parts/:partId/cut', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  const part = (ep.parts || []).find((p) => p.id === req.params.partId);
  if (!part) return res.status(404).json({ error: 'Teil nicht gefunden' });
  const cuts = req.body?.cuts;
  if (!Array.isArray(cuts) || !cuts.length) return res.status(400).json({ error: 'Keine Bereiche angegeben' });

  const local = path.join(paths.tmp, `cut-in-${ep.id}-${part.id}${path.extname(part.key)}`);
  const outFile = path.join(paths.tmp, `cut-out-${ep.id}-${part.id}.mp3`);
  try {
    const got = await downloadToFile(part.key, local);
    if (!got) throw new Error('Aufnahme nicht abrufbar.');
    await cutRegions(got, outFile, cuts);

    // Geschnittene Fassung als neuen Teil ablegen (alte Datei ersetzen).
    const newKey = `parts/${ep.id}/${part.id}-${Date.now()}.mp3`;
    await uploadFile(outFile, newKey, 'audio/mpeg');
    await deleteKey(part.key);

    const cur = getEpisode(ep.id);
    const target = (cur.parts || []).find((p) => p.id === part.id);
    if (target) {
      target.key = newKey;
      target.peaks = null;      // Kurve neu berechnen lassen
      target.duration = 0;
      target.size = fs.statSync(outFile).size;
    }
    cur.needsRebuild = true;
    saveEpisode(cur);
    res.json(cur);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    fs.rmSync(local, { force: true });
    fs.rmSync(outFile, { force: true });
  }
});

// Reihenfolge der Teile ändern (Liste von Teil-IDs in gewünschter Reihenfolge).
router.put('/:id/parts/order', (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  const order = req.body?.order;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'Reihenfolge fehlt' });

  const byId = new Map((ep.parts || []).map((p) => [p.id, p]));
  const next = order.map((pid) => byId.get(pid)).filter(Boolean);
  if (next.length !== (ep.parts || []).length) return res.status(400).json({ error: 'Reihenfolge unvollständig' });

  ep.parts = next;
  ep.needsRebuild = true;
  saveEpisode(ep);
  res.json(ep);
});

// Einen Teil entfernen.
router.delete('/:id/parts/:partId', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  const part = (ep.parts || []).find((p) => p.id === req.params.partId);
  if (!part) return res.status(404).json({ error: 'Teil nicht gefunden' });

  await deleteKey(part.key);
  ep.parts = ep.parts.filter((p) => p.id !== part.id);
  ep.needsRebuild = true;
  saveEpisode(ep);
  res.json(ep);
});

// Festhängende Verarbeitung freigeben. Nötig, wenn ein Vorgang durch einen
// Neustart verloren ging und die Folge sonst dauerhaft „in Arbeit" bliebe.
router.post('/:id/abbrechen', (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  ep.status = 'error';
  ep.error = 'Verarbeitung wurde abgebrochen. Du kannst sie erneut starten oder die Folge löschen.';
  ep.fortschritt = null;
  saveEpisode(ep);
  res.json(ep);
});

// Folge (neu) zusammenbauen – nach Änderungen an den Teilen.
router.post('/:id/build', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  if (!(ep.parts || []).length) return res.status(400).json({ error: 'Keine Aufnahme-Teile vorhanden' });
  if (ep.status === 'processing') return res.status(409).json({ error: 'Wird bereits verarbeitet' });

  // Text nur neu erzeugen, wenn ausdrücklich gewünscht (spart Zeit und Kosten).
  const withText = req.body?.withText !== false;
  ep.status = 'processing';
  ep.error = '';
  saveEpisode(ep);

  buildAndAnalyse(ep.id, { withText }).catch((err) => {
    console.error('Zusammenbau fehlgeschlagen:', err);
    const cur = getEpisode(ep.id);
    if (cur) saveEpisode({ ...cur, status: 'error', error: err.message });
  });

  res.status(202).json(getEpisode(ep.id));
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

// Infotext neu vorschlagen lassen. Nutzt das Transkript, falls vorhanden;
// sonst den Titel und optional ein paar Stichworte.
router.post('/:id/describe', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });

  const hinweise = (req.body?.hinweise || '').trim();

  // Ohne Transkript und ohne Stichworte wird der Film anhand des Titels
  // recherchiert – dafür braucht es lediglich einen Titel.
  if (!ep.transcript?.trim() && !hinweise && !ep.title?.trim()) {
    return res.status(400).json({
      error: 'Ohne Titel lässt sich nichts recherchieren. Bitte zuerst einen Titel eintragen.',
    });
  }

  try {
    const text = await generateDescription({ transcript: ep.transcript, title: ep.title, hinweise });
    const cur = getEpisode(ep.id);
    cur.descriptionSuggestion = text;
    saveEpisode(cur);
    res.json({ vorschlag: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Folgen-Cover von einer Adresse übernehmen. Praktisch, wenn das Bild anderswo
// erzeugt wurde: Adresse einfügen genügt, die App lädt es selbst herunter.
router.post('/:id/image-from-url', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  const url = (req.body?.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Bitte eine gültige Adresse angeben.' });

  const tmpFile = path.join(paths.tmp, `von-url-${ep.id}-${Date.now()}`);
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) throw new Error(`Bild nicht abrufbar (HTTP ${r.status}).`);
    const typ = r.headers.get('content-type') || '';
    if (!typ.startsWith('image/')) throw new Error(`Dort liegt kein Bild (${typ || 'unbekannt'}).`);

    const daten = Buffer.from(await r.arrayBuffer());
    if (!daten.length) throw new Error('Das Bild kam leer zurück.');
    fs.writeFileSync(tmpFile, daten);

    const ext = typ.includes('png') ? '.png' : typ.includes('webp') ? '.webp' : '.jpg';
    const key = `episode-images/${ep.id}${ext}`;
    if (ep.imageKey && ep.imageKey !== key) await deleteKey(ep.imageKey);

    const cur = getEpisode(ep.id);
    cur.imageUrl = await uploadFile(tmpFile, key, typ);
    cur.imageKey = key;
    saveEpisode(cur);
    res.json(cur);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
});

// Titel/Beschreibung bearbeiten (Freigabe/Änderung durch den Nutzer).
router.put('/:id', (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  if (typeof req.body.title === 'string') ep.title = req.body.title.trim();
  if (typeof req.body.description === 'string') ep.description = req.body.description;
  // Klangbearbeitung anpassen – wirkt beim nächsten Zusammenbauen.
  if (req.body.enhance && typeof req.body.enhance === 'object') {
    ep.enhance = {
      enabled: Boolean(req.body.enhance.enabled),
      strength: zahl(req.body.enhance.strength, STANDARD_STAERKE, 0, 100),
    };
    ep.needsRebuild = true;
  }
  if (req.body.trimSilence && typeof req.body.trimSilence === 'object') {
    ep.trimSilence = {
      enabled: Boolean(req.body.trimSilence.enabled),
      seconds: zahl(req.body.trimSilence.seconds, STANDARD_PAUSE, 0.5, 10),
    };
    ep.needsRebuild = true;
  }
  saveEpisode(ep);
  res.json(ep);
});

// Veröffentlichen – nur nach ausdrücklicher Bestätigung im Frontend.
// Mit „zeitpunkt" in der Zukunft wird die Folge lediglich eingeplant: Sie steht
// dann erst ab diesem Moment im RSS-Feed.
router.post('/:id/publish', (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });
  if (ep.status === 'processing') return res.status(409).json({ error: 'Wird noch verarbeitet' });
  if (!ep.audioUrl) return res.status(409).json({ error: 'Keine fertige Audiodatei' });

  const zeitpunkt = req.body?.zeitpunkt ? new Date(req.body.zeitpunkt) : null;
  if (req.body?.zeitpunkt && isNaN(zeitpunkt)) {
    return res.status(400).json({ error: 'Ungültiger Zeitpunkt' });
  }

  ep.status = 'published';
  ep.publishedAt = (zeitpunkt || new Date()).toISOString();
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
  for (const part of ep.parts || []) await deleteKey(part.key);
  // Altlast: Folgen aus der Zeit des Cover-Generators können noch Vorschläge
  // im Speicher haben. Die werden hier mit entfernt.
  for (const c of ep.artworkCandidates || []) await deleteKey(c.key);
  deleteEpisode(ep.id);
  res.json({ ok: true });
});

// Löscht eine Datei nur, wenn sie im Arbeitsordner liegt. Schützt davor, aus
// Versehen die dauerhaft gespeicherten Aufnahmen zu entfernen.
function nurArbeitsdateiLoeschen(datei) {
  if (!datei) return;
  const voll = path.resolve(datei);
  if (voll.startsWith(path.resolve(paths.tmp) + path.sep)) {
    fs.rmSync(voll, { force: true });
  }
}

// ---- Aufnahme-Teile dauerhaft ablegen ----
// Die Rohaufnahmen bleiben erhalten, damit die Folge nach Umsortieren oder
// Nachreichen weiterer Teile jederzeit neu zusammengebaut werden kann.
async function storeParts(episodeId, files) {
  for (const f of files) {
    const partId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const ext = path.extname(f.originalname) || path.extname(f.filename) || '.webm';
    const key = `parts/${episodeId}/${partId}${ext}`;
    try {
      await uploadFile(f.path, key, f.mimetype || 'application/octet-stream');
      const ep = getEpisode(episodeId);
      ep.parts = [...(ep.parts || []), {
        id: partId,
        key,
        name: f.originalname || `Teil ${(ep.parts || []).length + 1}`,
        size: f.size || 0,
      }];
      saveEpisode(ep);
    } finally {
      fs.rmSync(f.path, { force: true });
    }
  }
}

// ---- Zusammenbauen, transkribieren, Text vorschlagen ----
async function buildAndAnalyse(id, { withText = true, fertigDatei = null } = {}) {
  const settings = getSettings();
  let ep = getEpisode(id);
  if (!ep) return;

  // Zwischenstände festhalten, damit die App den Fortschritt zeigen kann.
  const melde = (phase, prozent = null) => {
    const cur = getEpisode(id);
    if (!cur) return;
    cur.fortschritt = { phase, prozent, stand: new Date().toISOString() };
    saveEpisode(cur);
  };

  // Wächter: Bleibt ein Schritt ungewöhnlich lange stehen, wird die Folge
  // freigegeben statt endlos „in Arbeit" zu bleiben. Auf sehr kleinen Servern
  // kann das Zusammenbauen einer langen Folge sonst stundenlang blockieren.
  const WAECHTER_MINUTEN = 45;
  const waechter = setTimeout(() => {
    const cur = getEpisode(id);
    if (cur?.status !== 'processing') return;
    saveEpisode({
      ...cur,
      status: 'error',
      error: `Die Verarbeitung lief länger als ${WAECHTER_MINUTEN} Minuten und wurde abgebrochen. `
           + 'Tipp: Beim Hochladen „Auf diesem Gerät bearbeiten" ankreuzen — dann rechnet dein '
           + 'Rechner statt des Servers.',
      fortschritt: null,
    });
  }, WAECHTER_MINUTEN * 60 * 1000);

  const tmpFiles = [];
  try {
    melde('Aufnahmen werden geladen …');
    // Aufnahme-Teile in ihrer Reihenfolge in den Arbeitsordner holen.
    const partPaths = [];
    for (const part of ep.parts || []) {
      const local = path.join(paths.tmp, `part-${id}-${part.id}${path.extname(part.key)}`);
      const got = await downloadToFile(part.key, local);
      if (got) { partPaths.push(got); tmpFiles.push(got); }
    }
    if (!partPaths.length) throw new Error('Keine Aufnahme-Teile gefunden.');

    // Intro/Outro bei Bedarf holen.
    let introPath = null, outroPath = null;
    if (settings.intro) {
      introPath = await downloadToFile(`assets/${settings.intro}`, path.join(paths.tmp, `intro-${id}${path.extname(settings.intro)}`));
      if (introPath) tmpFiles.push(introPath);
    }
    if (settings.outro) {
      outroPath = await downloadToFile(`assets/${settings.outro}`, path.join(paths.tmp, `outro-${id}${path.extname(settings.outro)}`));
      if (outroPath) tmpFiles.push(outroPath);
    }

    const outPath = path.join(paths.tmp, `${id}.mp3`);
    tmpFiles.push(outPath);

    const filterNoetig = !ep.lokalBearbeitet && (ep.enhance?.enabled || ep.trimSilence?.enabled);

    let duration, size;
    if (fertigDatei) {
      // Im Browser schon fertig zusammengebaut – der Server fasst nichts an.
      melde('Fertige Folge wird übernommen …');
      fs.renameSync(fertigDatei.path, outPath);
      duration = await probeDuration(outPath).catch(() => 0);
      size = fs.statSync(outPath).size;
    } else if (!filterNoetig) {
      // Kein Filter nötig: nur zusammenkleben, ohne die Aufnahme neu zu kodieren.
      // Das geht auch bei zweistündigen Folgen in Sekunden.
      melde('Folge wird zusammengefügt …');
      ({ duration, size } = await buildEpisodeCopy({
        intro: introPath, mains: partPaths, outro: outroPath, outFile: outPath,
      }));
    } else {
      // Nur wenn ausdrücklich Optimierung gewünscht ist: der aufwendige Weg mit
      // Neukodierung. Für lange Folgen auf kleinen Servern nicht zu empfehlen.
      melde('Audio wird optimiert und zusammengebaut …', 0);
      ({ duration, size } = await buildEpisode({
        intro: introPath, main: partPaths, outro: outroPath, outFile: outPath,
        enhance: ep.enhance,
        trimSilence: ep.trimSilence,
        onProgress: ({ prozent }) => melde('Audio wird optimiert und zusammengebaut …', prozent),
      }));
    }

    // 2) Fertige MP3 in den dauerhaften Speicher legen.
    melde('Fertige Folge wird gespeichert …');
    const audioKey = `episodes/${id}.mp3`;
    const audioUrl = await uploadFile(outPath, audioKey, 'audio/mpeg');

    ep = getEpisode(id);
    ep.audioKey = audioKey;
    ep.audioUrl = `${audioUrl}${audioUrl.includes('?') ? '&' : '?'}v=${Date.now()}`; // Zwischenspeicher umgehen
    ep.duration = duration;
    ep.size = size;
    ep.needsRebuild = false;
    saveEpisode(ep);

    // 3) Transkript und Textvorschlag – nur wenn gewünscht.
    if (withText) {
      let transcript = '';
      try {
        melde('Aufnahme wird transkribiert … (dauert bei langen Folgen)');
        transcript = await transcribeAll(partPaths);
      } catch (err) {
        console.error('Transkription fehlgeschlagen:', err.message);
      }
      melde('Infotext wird geschrieben …');
      // Scheitert der Text, bleibt die fertige Folge trotzdem erhalten – der
      // Grund wird notiert und in der App angezeigt.
      let description = '', textFehler = '';
      try {
        description = await generateDescription({ transcript, title: getEpisode(id).title });
      } catch (err) {
        console.error('Infotext fehlgeschlagen:', err.message);
        textFehler = err.message;
      }
      ep = getEpisode(id);
      ep.transcript = transcript;
      ep.descriptionError = textFehler;
      if (description) {
        // Einen bereits überarbeiteten Text nicht überschreiben.
        if (!ep.description?.trim()) ep.description = description;
        else ep.descriptionSuggestion = description;
      }
      saveEpisode(ep);
    }

    ep = getEpisode(id);
    ep.status = 'draft';
    ep.fortschritt = null;
    saveEpisode(ep);
  } finally {
    clearTimeout(waechter);
    // NUR Arbeitsdateien löschen. Ohne R2 liefert downloadToFile den Pfad der
    // gespeicherten Originaldatei zurück – die darf keinesfalls gelöscht werden.
    for (const f of tmpFiles) nurArbeitsdateiLoeschen(f);
  }
}

export default router;
