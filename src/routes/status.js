import express from 'express';
import { requireAuth } from '../auth.js';
import { config } from '../config.js';
import { getSettings, listEpisodes } from '../store.js';
import { storageEnabled } from '../storage.js';

const router = express.Router();
router.use(requireAuth);

// Kurzer Selbsttest der Einrichtung. Zeigt nur an, OB Schlüssel gesetzt sind –
// niemals deren Werte.
router.get('/', (req, res) => {
  const s = getSettings();
  const eps = listEpisodes();

  res.json({
    speicher: storageEnabled() ? 'Cloudflare R2' : 'lokal (geht bei Neustart verloren)',
    oeffentlicheAdresse: config.publicUrl,
    feed: `${config.publicUrl}/feed.xml`,
    schluessel: {
      gemini: Boolean(config.geminiKey),
      anchor: Boolean(config.anchor.email && config.anchor.password),
    },
    bildmodell: config.geminiImageModel,
    dateien: {
      intro: s.intro || null,
      outro: s.outro || null,
      cover: s.cover || null,
      ausgangsbilder: (s.baseImages || []).length,
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
  });
});

export default router;
