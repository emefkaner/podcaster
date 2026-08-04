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
  // Bildmodell für den Cover-Generator. Achtung: Bilder sind NICHT im kostenlosen
  // Kontingent enthalten. "gemini-3.1-flash-image" ist die günstige Variante,
  // "gemini-3-pro-image" liefert bessere Gesichts-Konsistenz, kostet aber mehr.
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
  // Optionale Alternativen.
  openaiKey: process.env.OPENAI_API_KEY || '',
  anthropicKey: process.env.ANTHROPIC_API_KEY || '',
  // Higgsfield – bevorzugte Quelle für Cover, sofern eingerichtet.
  // Beide gängigen Schreibweisen zulassen – die Doku nennt mal die eine, mal die andere.
  higgsfield: {
    apiKey: process.env.HIGGSFIELD_API_KEY || process.env.HIGGSFIELD_KEY || '',
    apiSecret: process.env.HIGGSFIELD_API_SECRET || process.env.HIGGSFIELD_SECRET || '',
    // Modell und Endpunkt umstellbar, ohne den Code zu ändern.
    modell: process.env.HIGGSFIELD_MODEL || 'nano_banana_2',
    endpunkt: process.env.HIGGSFIELD_ENDPOINT || '',
    aufloesung: process.env.HIGGSFIELD_RESOLUTION || '1k',
  },
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
  // Cover-Generator: Ausgangsbilder, Stilvorgabe und der Schriftzug, der auf
  // jedem Cover oben stehen bleibt.
  baseImages: [],
  imageStyle: '',
  coverHeadline: 'DIE CINESPASTEN',
};
