import express from 'express';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { getSettings, listEpisodes } from '../store.js';
import { storageEnabled } from '../storage.js';
import { geminiModellName } from '../gemini.js';
import { dolbyAktiv } from '../dolby.js';

const router = express.Router();
router.use(requireAuth);

// Kurzer Selbsttest der Einrichtung. Zeigt nur an, OB Schlüssel gesetzt sind –
// niemals deren Werte.
router.get('/', async (req, res) => {
  const s = getSettings();
  const eps = listEpisodes();

  // Welches Gemini-Modell würde gerade verwendet? Wird bei Google erfragt und
  // danach gemerkt – so fällt sofort auf, wenn dort keins mehr nutzbar ist.
  let geminiModell = 'kein Schlüssel gesetzt';
  if (config.geminiKey) {
    try { geminiModell = await geminiModellName(); }
    catch (e) { geminiModell = `Fehler: ${e.message}`; }
  }

  res.json({
    speicher: storageEnabled() ? 'Cloudflare R2' : 'lokal (geht bei Neustart verloren)',
    oeffentlicheAdresse: config.publicUrl,
    feed: `${config.publicUrl}/feed.xml`,
    schluessel: {
      gemini: Boolean(config.geminiKey),
      anchor: Boolean(config.anchor.email && config.anchor.password),
      dolby: dolbyAktiv(),
    },
    geminiModell,
    sprachverbesserung: dolbyAktiv()
      ? 'Dolby.io (KI, 200 Minuten je Monat frei)'
      : 'nur lokal (RNNoise + ffmpeg) – für Dolby fehlt DOLBY_API_KEY',
    dateien: {
      intro: s.intro || null,
      outro: s.outro || null,
      cover: s.cover || null,
    },
    podcast: {
      titel: s.title,
      kontaktEmail: s.ownerEmail || null,
      quellFeed: s.sourceFeedUrl || null,
    },
    folgen: {
      gesamt: eps.length,
      veroeffentlicht: eps.filter((e) => e.status === 'published').length,
      entwuerfe: eps.filter((e) => e.status === 'draft').length,
      inArbeit: eps.filter((e) => e.status === 'processing').length,
      fehler: eps.filter((e) => e.status === 'error').length,
    },
    pruefung: pruefeFolgen(eps),
  });
});

// Selbsttest über alle Folgen: Was fehlt, und liegen die Dateien wirklich bei uns?
function pruefeFolgen(eps) {
  const mitAudio = eps.filter((e) => e.audioUrl);
  const eigenerSpeicher = mitAudio.filter((e) => Boolean(e.audioKey));
  const fremdgehostet = mitAudio.filter((e) => !e.audioKey);
  const daten = eps.map((e) => new Date(e.publishedAt || e.createdAt)).filter((d) => !isNaN(d));
  daten.sort((a, b) => a - b);
  const fmt = (d) => (d ? d.toISOString().slice(0, 10) : null);

  return {
    aeltesteFolge: fmt(daten[0]),
    neuesteFolge: fmt(daten[daten.length - 1]),
    audioImEigenenSpeicher: `${eigenerSpeicher.length} von ${eps.length}`,
    nochBeimAltenAnbieter: fremdgehostet.length,
    // Beispiele nennen, damit man gezielt nachschauen kann.
    beispieleFremd: fremdgehostet.slice(0, 3).map((e) => e.title),
    ohneAudio: eps.filter((e) => !e.audioUrl).length,
    mitFolgenbild: eps.filter((e) => e.imageUrl).length,
    ohneText: eps.filter((e) => !e.description?.trim()).length,
    gesamtgroesseMB: Math.round(eps.reduce((sum, e) => sum + (e.size || 0), 0) / 1048576),
  };
}

export default router;
