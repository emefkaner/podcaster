import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

// Erzeugt Folgen-Cover, indem ein festes Ausgangsbild (ihr als Team) passend zum
// Thema der Folge abgewandelt wird – z. B. mit Spinnenmasken oder Spartanerhelmen.
// Genutzt wird Geminis Bildmodell, das mehrere Referenzbilder auswerten kann und
// dabei die Gesichter wiedererkennbar hält.

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function mimeFor(file) {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] || 'image/jpeg';
}

// Setzt aus Stilvorgabe und Kurzbeschreibung den vollständigen Auftrag zusammen.
// Der unveränderliche Teil (Gesichter, Anordnung, Schriftzug) steht bewusst hier
// und nicht in den Einstellungen, damit die Reihe verlässlich einheitlich bleibt.
function buildPrompt({ style, wish, title, headline }) {
  const head = (headline || 'DIE CINESPASTEN').trim();
  return [
    style?.trim() || DEFAULT_STYLE,
    '',
    'UNVERÄNDERLICH – halte dich strikt daran:',
    `1. Die Gesichter der Personen aus dem Referenzbild bleiben exakt gleich:`,
    '   gleiche Züge, Frisuren, Bärte, Brillen, Hautton und Mimik. Es sind dieselben',
    '   Personen, in derselben Anzahl, Reihenfolge und Anordnung wie im Referenzbild.',
    '2. Gleicher Bildaufbau: Brustbild der Gruppe in der unteren Bildhälfte, quadratisch.',
    `3. Oben im Bild steht groß der Schriftzug „${head}" – gleiche Schriftart,`,
    '   gleiche cremeweiße Farbe, gleiche Platzierung wie im Referenzbild.',
    '   Der Text muss korrekt geschrieben und gut lesbar sein.',
    '',
    'VERÄNDERE NUR: die Kleidung der Personen und den Hintergrund,',
    'passend zum Thema der Folge.',
    '',
    title ? `Thema der Folge: ${title}` : '',
    `Gewünschte Abwandlung: ${wish}`,
  ].filter(Boolean).join('\n');
}

export const DEFAULT_STYLE = [
  'Erzeuge ein quadratisches Podcast-Cover als kräftige Comic-Illustration:',
  'satte Farben, klare dunkle Konturen, Cel-Shading, leicht cartoonhafte Gesichter,',
  'stimmungsvolle Beleuchtung im Hintergrund – im Stil eines modernen Zeichentrick-Filmplakats.',
].join(' ');

/**
 * Erzeugt mehrere Cover-Vorschläge.
 * @param {string[]} basePaths lokale Pfade der Referenzbilder (mindestens eines)
 * @param {string} wish Kurzbeschreibung der gewünschten Abwandlung
 * @param {string} style Stilvorgabe aus den Einstellungen
 * @param {string} title Titel der Folge (als zusätzlicher Kontext)
 * @param {number} count Anzahl der Vorschläge
 * @returns {Promise<{data: Buffer, mimeType: string}[]>}
 */
export async function generateCandidates({ basePaths, wish, style, title, headline, count = 3 }) {
  if (!config.geminiKey) throw new Error('GEMINI_API_KEY ist nicht gesetzt.');
  const bases = (basePaths || []).filter((p) => p && fs.existsSync(p));
  if (!bases.length) throw new Error('Kein Ausgangsbild hinterlegt (in den Einstellungen festlegen).');
  if (!wish?.trim()) throw new Error('Bitte kurz beschreiben, was verändert werden soll.');

  const ai = new GoogleGenAI({ apiKey: config.geminiKey });
  const prompt = buildPrompt({ style, wish, title, headline });

  const parts = bases.map((file) => ({
    inlineData: { mimeType: mimeFor(file), data: fs.readFileSync(file).toString('base64') },
  }));
  parts.push({ text: prompt });

  // Die Vorschläge parallel anfordern – jeder Aufruf liefert ein Bild.
  const jobs = Array.from({ length: count }, () =>
    ai.models.generateContent({
      model: config.geminiImageModel,
      contents: [{ role: 'user', parts }],
      config: { responseModalities: ['IMAGE'] },
    })
  );

  const settled = await Promise.allSettled(jobs);
  const images = [];
  const errors = [];

  for (const r of settled) {
    if (r.status === 'rejected') { errors.push(r.reason?.message || String(r.reason)); continue; }
    const img = extractImage(r.value);
    if (img) images.push(img);
    else errors.push('Antwort enthielt kein Bild.');
  }

  if (!images.length) throw new Error(`Keine Vorschläge erzeugt. ${errors[0] || ''}`.trim());
  return images;
}

// Holt das erste Bild aus einer Modellantwort.
function extractImage(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    if (p.inlineData?.data) {
      return {
        data: Buffer.from(p.inlineData.data, 'base64'),
        mimeType: p.inlineData.mimeType || 'image/png',
      };
    }
  }
  return null;
}
