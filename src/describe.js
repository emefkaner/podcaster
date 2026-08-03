import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

// Erzeugt aus dem Transkript (+ Titel) einen Vorschlag für die Folgenbeschreibung.
// Reihenfolge: Gemini (kostenlos) -> Claude (falls Schlüssel gesetzt) -> einfacher Fallback.
export async function generateDescription({ transcript, title }) {
  const clean = (transcript || '').trim();
  const prompt = buildPrompt({ transcript: clean, title });

  if (config.geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: config.geminiKey });
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      const text = (res.text || '').trim();
      if (text) return text;
    } catch (err) {
      console.error('Gemini-Beschreibung fehlgeschlagen:', err.message);
    }
  }

  if (config.anthropicKey) {
    try {
      const client = new Anthropic({ apiKey: config.anthropicKey });
      const msg = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 700,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = msg.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (text) return text;
    } catch (err) {
      console.error('Claude-Beschreibung fehlgeschlagen:', err.message);
    }
  }

  return fallbackDescription(clean);
}

function buildPrompt({ transcript, title }) {
  return [
    'Du schreibst die Beschreibung (Show Notes) für eine Folge eines deutschsprachigen Filmpodcasts.',
    'Schreibe auf Deutsch, ansprechend und natürlich, im Ton des Podcasts.',
    'Ziel: neugierig machen, ohne zu übertreiben und ohne die Pointen zu verraten.',
    'Keine Emoji-Flut, keine Hashtags, keine Marketing-Floskeln.',
    'Struktur: 2–4 Sätze Fließtext, danach optional 3–5 Stichpunkte mit den Kernthemen.',
    'Schreibe Eigennamen (Filmtitel, Regie, Cast) korrekt.',
    'Gib NUR den Beschreibungstext zurück, keine Vorrede und keine Überschrift.',
    '',
    title ? `Titel der Folge: ${title}` : '',
    '',
    'Transkript der Folge:',
    transcript.slice(0, 30000) || '(kein Transkript verfügbar)',
  ].join('\n');
}

// Ohne KI: die ersten Sätze des Transkripts als Notlösung.
function fallbackDescription(transcript) {
  if (!transcript) return 'In dieser Folge geht es um …';
  const firstPart = transcript.split(/(?<=[.!?])\s+/).slice(0, 3).join(' ');
  return firstPart.length > 400 ? `${firstPart.slice(0, 397)}…` : firstPart;
}
