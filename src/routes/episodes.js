import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../config.js';
import { requireAuth } from '../auth.js';
import { listEpisodes, getEpisode, saveEpisode, deleteEpisode, getSettings } from '../store.js';
import { buildEpisode, probeDuration } from '../audio.js';
import { transcribeAll } from '../transcribe.js';
import { generateDescription } from '../describe.js';
import { uploadFile, downloadToFile, deleteKey } from '../storage.js';
import { config } from '../config.js';
import { publishToAnchor } from '../anchorPublisher.js';
import { generateCandidates } from '../artwork.js';
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
      strength: Math.min(100, Math.max(0, Number(req.body.strength) || 50)),
    },
    // Lange Sprechpausen automatisch kürzen.
    trimSilence: {
      enabled: req.body.trimSilence === 'true' || req.body.trimSilence === '1',
      seconds: Math.min(10, Math.max(0.5, Number(req.body.trimSeconds) || 2)),
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
  const grundlage = [ep.transcript, hinweise].filter(Boolean).join('\n\n');

  if (!grundlage) {
    return res.status(400).json({
      error: 'Für diese Folge gibt es kein Transkript. Bitte ein paar Stichworte zum Inhalt angeben.',
    });
  }

  try {
    const text = await generateDescription({ transcript: grundlage, title: ep.title });
    const cur = getEpisode(ep.id);
    cur.descriptionSuggestion = text;
    saveEpisode(cur);
    res.json({ vorschlag: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Cover-Vorschläge erzeugen: Ausgangsbild(er) passend zum Folgenthema abwandeln.
router.post('/:id/artwork', async (req, res) => {
  const ep = getEpisode(req.params.id);
  if (!ep) return res.status(404).json({ error: 'Nicht gefunden' });

  const settings = getSettings();
  const wish = (req.body?.prompt || '').trim();
  const count = Math.min(4, Math.max(1, Number(req.body?.count) || 3));
  // Titelzeile aufs Cover: was eingegeben wurde, sonst der zuletzt verwendete,
  // sonst der Standardtitel der Reihe aus den Einstellungen.
  const headline = (req.body?.headline ?? ep.artworkHeadline ?? settings.coverHeadline ?? '').trim();
  const subtitle = (req.body?.subtitle ?? ep.artworkSubtitle ?? '').trim();

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
      headline,
      subtitle,
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
    cur.artworkHeadline = headline;
    cur.artworkSubtitle = subtitle;
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
  // Klangbearbeitung anpassen – wirkt beim nächsten Zusammenbauen.
  if (req.body.enhance && typeof req.body.enhance === 'object') {
    ep.enhance = {
      enabled: Boolean(req.body.enhance.enabled),
      strength: Math.min(100, Math.max(0, Number(req.body.enhance.strength) || 60)),
    };
    ep.needsRebuild = true;
  }
  if (req.body.trimSilence && typeof req.body.trimSilence === 'object') {
    ep.trimSilence = {
      enabled: Boolean(req.body.trimSilence.enabled),
      seconds: Math.min(10, Math.max(0.5, Number(req.body.trimSilence.seconds) || 2)),
    };
    ep.needsRebuild = true;
  }
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
  for (const part of ep.parts || []) await deleteKey(part.key);
  for (const c of ep.artworkCandidates || []) await deleteKey(c.key);
  deleteEpisode(ep.id);
  res.json({ ok: true });
});

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

    // Wurde die Folge im Browser schon fertig zusammengebaut, wird sie direkt
    // übernommen – der Server startet dann gar kein ffmpeg.
    let duration, size;
    if (fertigDatei) {
      melde('Fertige Folge wird übernommen …');
      fs.renameSync(fertigDatei.path, outPath);
      duration = await probeDuration(outPath).catch(() => 0);
      size = fs.statSync(outPath).size;
    } else {
      melde('Audio wird zusammengebaut …', 0);
      ({ duration, size } = await buildEpisode({
        intro: introPath, main: partPaths, outro: outroPath, outFile: outPath,
        // Wurde bereits auf dem Gerät bearbeitet, hier nicht noch einmal filtern –
        // das würde nur Rechenzeit kosten und den Klang unnötig zweimal anfassen.
        enhance: ep.lokalBearbeitet ? null : ep.enhance,
        trimSilence: ep.lokalBearbeitet ? null : ep.trimSilence,
        onProgress: ({ prozent }) => melde('Audio wird zusammengebaut …', prozent),
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
      const description = await generateDescription({ transcript, title: getEpisode(id).title });
      ep = getEpisode(id);
      ep.transcript = transcript;
      // Einen bereits überarbeiteten Text nicht überschreiben.
      if (!ep.description?.trim()) ep.description = description;
      else ep.descriptionSuggestion = description;
      saveEpisode(ep);
    }

    ep = getEpisode(id);
    ep.status = 'draft';
    ep.fortschritt = null;
    saveEpisode(ep);
  } finally {
    for (const f of tmpFiles) fs.rmSync(f, { force: true });
  }
}

export default router;
