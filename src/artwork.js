import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';
import { higgsfieldVerfuegbar, higgsfieldVorschlaege } from './artworkHiggsfield.js';

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

// Setzt den Auftrag fürs Bildmodell zusammen.
// Fix bleiben nur die Personen – Titel, Untertitel, Kleidung, Kulisse und die
// Stimmung richten sich nach dem Film der jeweiligen Folge.
function buildPrompt({ style, wish, title, headline, subtitle }) {
  const head = (headline || title || '').trim();
  return [
    style?.trim() || DEFAULT_STYLE,
    '',
    'UNVERÄNDERLICH – halte dich strikt daran:',
    '1. Übernimm die Personen aus den Referenzbildern unverändert: gleiche Gesichtszüge,',
    '   Frisuren, Bärte, Brillen und Hauttöne. Es sind dieselben Personen in derselben',
    '   Anzahl und derselben Reihenfolge von links nach rechts.',
    '2. Quadratisches Bild. Die Gruppe füllt die untere Bildhälfte als Brustbild,',
    '   oben bleibt Platz für den Titel.',
    head
      ? `3. Setze oben in großer, gut lesbarer Versalschrift den Titel: „${head}".\n` +
        '   Schreibe ihn exakt so, ohne Tippfehler, mit klarem Kontrast zum Hintergrund.'
      : '3. Lasse den oberen Bildbereich frei für eine spätere Titelzeile.',
    subtitle
      ? `4. Setze unten mittig die kleinere Unterzeile: „${subtitle}".`
      : '',
    '',
    'PASSE AN DEN FILM AN: Kleidung und Ausrüstung der Personen, die Kulisse im',
    'Hintergrund sowie Farbstimmung und Lichtsetzung. Das Cover soll das Genre des',
    'Films sofort erkennen lassen – eine Weltraumfolge wirkt anders als ein Krimi.',
    '',
    title ? `Film / Thema der Folge: ${title}` : '',
    `Gewünschte Umsetzung: ${wish}`,
  ].filter(Boolean).join('\n');
}

export const DEFAULT_STYLE = [
  'Erzeuge ein quadratisches Podcast-Cover im Stil eines gezeichneten Filmplakats:',
  'detaillierte Illustration mit klaren Konturen, kräftigen Farben und filmischer',
  'Beleuchtung. Die Gesichter bleiben erkennbar porträthaft, leicht stilisiert.',
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
export async function generateCandidates({ basePaths, wish, style, title, headline, subtitle, count = 3 }) {
  const bases = (basePaths || []).filter((p) => p && fs.existsSync(p));
  if (!bases.length) throw new Error('Kein Ausgangsbild hinterlegt (in den Einstellungen festlegen).');
  if (!wish?.trim()) throw new Error('Bitte kurz beschreiben, was verändert werden soll.');

  const prompt = buildPrompt({ style, wish, title, headline, subtitle });

  // Higgsfield zuerst, wenn eingerichtet: dort liegen meist Guthaben, und der
  // Soul-Modus hält Gesichter über mehrere Bilder hinweg zuverlässig konstant.
  let higgsfieldFehler = '';
  if (higgsfieldVerfuegbar()) {
    try {
      return await higgsfieldVorschlaege({ basePaths: bases, prompt, count });
    } catch (err) {
      higgsfieldFehler = err.message;
      console.error('Higgsfield fehlgeschlagen:', err.message);
      if (!config.geminiKey) throw new Error(`Higgsfield: ${err.message}`);
    }
  } else {
    higgsfieldFehler = 'Higgsfield ist nicht eingerichtet (HIGGSFIELD_API_KEY/SECRET fehlen).';
  }

  if (!config.geminiKey) throw new Error('Weder Higgsfield- noch Gemini-Zugang eingerichtet.');
  const ai = new GoogleGenAI({ apiKey: config.geminiKey });

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

  if (!images.length) {
    // Beide Wege benennen, sonst bleibt unklar, woran es tatsächlich lag.
    const geminiGrund = kurzfassen(errors[0] || 'unbekannter Fehler');
    throw new Error(
      `Kein Cover erzeugt.\n\n` +
      `• Higgsfield: ${higgsfieldFehler || 'nicht versucht'}\n` +
      `• Gemini: ${geminiGrund}`
    );
  }
  return images;
}

// Lange Anbieter-Meldungen auf das Wesentliche eindampfen.
function kurzfassen(text) {
  const t = String(text);
  if (/RESOURCE_EXHAUSTED|429/.test(t) && /free_tier/.test(t)) {
    return 'Kein Freikontingent für Bildmodelle — dort ist eine Zahlungsmethode nötig.';
  }
  try {
    const j = JSON.parse(t.slice(t.indexOf('{')));
    if (j?.error?.message) return j.error.message.split('\n')[0];
  } catch {}
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
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
