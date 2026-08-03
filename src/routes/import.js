import express from 'express';
import { requireAuth } from '../auth.js';
import { importFeed } from '../importer.js';
import { saveSettings } from '../store.js';

const router = express.Router();
router.use(requireAuth);

// Importiert bestehende Folgen aus einem RSS-Feed (für den Umzug von cinespasten).
router.post('/', async (req, res) => {
  const feedUrl = (req.body?.feedUrl || '').trim();
  if (!/^https?:\/\//.test(feedUrl)) return res.status(400).json({ error: 'Bitte eine gültige Feed-URL angeben.' });
  try {
    const result = await importFeed(feedUrl, {
      rehost: req.body.rehost !== false,
      importMeta: req.body.importMeta !== false,
    });
    saveSettings({ sourceFeedUrl: feedUrl }); // für nächste Läufe merken
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
