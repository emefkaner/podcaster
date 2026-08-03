import express from 'express';
import { requireAuth } from '../auth.js';
import { importFeed } from '../importer.js';
import { saveSettings } from '../store.js';

const router = express.Router();
router.use(requireAuth);

// Der Import kann bei vielen Folgen etliche Minuten dauern – deutlich länger,
// als eine HTTP-Anfrage offen bleiben darf. Er läuft deshalb im Hintergrund;
// der Browser fragt den Fortschritt regelmäßig ab.
let job = null;

router.get('/status', (req, res) => {
  res.json(job || { running: false, phase: 'Kein Import gestartet.' });
});

router.post('/', async (req, res) => {
  if (job?.running) return res.status(409).json({ error: 'Es läuft bereits ein Import.' });

  const feedUrl = (req.body?.feedUrl || '').trim();
  if (!/^https?:\/\//.test(feedUrl)) return res.status(400).json({ error: 'Bitte eine gültige Feed-URL angeben.' });

  job = {
    running: true,
    phase: 'Feed wird geladen …',
    total: 0, imported: 0, skipped: 0, errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: '',
  };

  // Nicht auf das Ende warten – sofort antworten, Fortschritt kommt über /status.
  importFeed(feedUrl, {
    rehost: req.body.rehost !== false,
    importMeta: req.body.importMeta !== false,
    onProgress: (p) => { job = { ...job, ...p, running: true }; },
  })
    .then((result) => {
      job = { ...job, ...result, running: false, phase: 'Fertig.', finishedAt: new Date().toISOString() };
      saveSettings({ sourceFeedUrl: feedUrl });
    })
    .catch((err) => {
      job = { ...job, running: false, phase: 'Abgebrochen.', error: err.message, finishedAt: new Date().toISOString() };
    });

  res.status(202).json(job);
});

export default router;
