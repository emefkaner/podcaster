import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

// Unterordner für die verschiedenen Datei-Arten.
export const paths = {
  data: DATA_DIR,
  tmp: path.join(DATA_DIR, 'tmp'),     // ephemere Arbeitsdateien (Uploads, ffmpeg-Output)
  media: path.join(DATA_DIR, 'media'), // persistente Medien im lokalen Fallback (wird unter /media ausgeliefert)
  store: path.join(DATA_DIR, 'store.json'),       // Episoden-Metadaten
  settings: path.join(DATA_DIR, 'settings.json'), // Podcast-Einstellungen
};

// Ordner beim Start anlegen.
for (const dir of [paths.data, paths.tmp, paths.media,
                   path.join(paths.media, 'episodes'), path.join(paths.media, 'assets')]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const config = {
  port: Number(process.env.PORT || 3000),
  password: process.env.APP_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || 'unsicheres-standard-secret-bitte-aendern',
  // Öffentliche Adresse der App. Auf Render steht sie automatisch in
  // RENDER_EXTERNAL_URL – dann muss PUBLIC_URL gar nicht gesetzt werden.
  publicUrl: (
    process.env.PUBLIC_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${process.env.PORT || 3000}`
  ).replace(/\/$/, ''),
  // Gemini: Standard für Transkription + Infotext (kostenloser Kontingentbereich).
  geminiKey: process.env.GEMINI_API_KEY || '',
  // Modell fest vorgeben. Leer lassen: Die App fragt bei Google nach, welche
  // Modelle das Konto nutzen darf, und nimmt davon das beste. So geht nichts
  // kaputt, wenn Google ein Modell abschaltet.
  geminiModel: process.env.GEMINI_MODEL || '',
  // Optionale Alternativen.
  openaiKey: process.env.OPENAI_API_KEY || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  // Spotify for Podcasters (Anchor) – für den direkten Push per Browser-Automation.
  anchor: {
    email: process.env.ANCHOR_EMAIL || '',
    password: process.env.ANCHOR_PASSWORD || '',
  },
  // Cloudflare R2 (S3-kompatibel). Alle Felder nötig, sonst lokaler Fallback.
  r2: {
    accountId: process.env.R2_ACCOUNT_ID || '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.R2_BUCKET || '',
    publicUrl: process.env.R2_PUBLIC_URL || '', // z. B. https://pub-xxxx.r2.dev
  },
};

// Standard-Podcast-Einstellungen (können in der App überschrieben werden).
export const defaultSettings = {
  title: 'Mein Podcast',
  description: 'Beschreibung meines Podcasts.',
  author: 'Ich',
  ownerName: 'Ich',
  ownerEmail: process.env.OWNER_EMAIL || '',
  language: 'de',
  category: 'Society & Culture',
  explicit: false,
  // Dateinamen der hochgeladenen Assets (im assets-Ordner). Leer = noch nicht gesetzt.
  intro: '',
  outro: '',
  cover: '',
  // Quell-Feed für den Import (dein bisheriger Anchor-Feed).
  sourceFeedUrl: process.env.SOURCE_FEED_URL || '',
  // Wer im Podcast spricht und wie – fließt in jeden Infotext ein.
  crew: '',
};
