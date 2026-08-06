import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { getSettings } from './store.js';

// Erzeugt aus dem Transkript (+ Titel) einen Vorschlag für die Folgenbeschreibung.
// Reihenfolge: Gemini (kostenlos) -> Claude (falls Schlüssel gesetzt).
//
// Wichtig: Klappt beides nicht, wird ein Fehler geworfen. Früher kam hier ein
// Platzhalter zurück („In dieser Folge geht es um …") – der sah aus wie ein
// Ergebnis, war aber keins, und der Nutzer sah nur einen unveränderten Text.

// Wie die drei im Podcast auftreten. Steht in den Einstellungen und kann dort
// angepasst werden; das hier ist die Vorgabe.
export const DEFAULT_CREW = [
  'emefka: analytisch, liebt Science-Fiction und Effekte. Zerlegt gern, wie etwas gemacht wurde.',
  'Maurice: der Kritische. Hinterfragt Logiklücken und Drehbuchschwächen, lässt nichts durchgehen.',
  'Matthew: geht kalt und uninformiert rein. Wenn ihn ein Film packt, reißt es ihn völlig mit — '
  + 'sagt aber genauso deutlich, wenn er ihn für Müll hält, auch wenn die anderen beiden begeistert sind.',
].join('\n');

export async function generateDescription({ transcript, title, hinweise = '' }) {
  const clean = (transcript || '').trim();
  const settings = getSettings();
  const crew = (settings.crew || DEFAULT_CREW).trim();
  const podcast = settings.title || 'Cinespasten';

  // Ohne Transkript darf recherchiert werden – dann entsteht der Text aus dem
  // Filmwissen statt aus dem Gespräch.
  const rechercheNoetig = !clean;
  const prompt = buildPrompt({
    transcript: clean, title, crew, podcast, rechercheNoetig, hinweise: hinweise.trim(),
  });

  const gruende = [];

  if (config.geminiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey: config.geminiKey });
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        // Bei fehlendem Transkript im Netz nachschlagen, damit die Anspielungen
        // zum echten Film passen und nicht erfunden sind.
        ...(rechercheNoetig ? { config: { tools: [{ googleSearch: {} }] } } : {}),
      });
      const text = (res.text || '').trim();
      if (text) return text;
      gruende.push('Gemini: leere Antwort');
    } catch (err) {
      console.error('Gemini-Beschreibung fehlgeschlagen:', err.message);
      gruende.push(`Gemini: ${err.message}`);
    }
  } else {
    gruende.push('Gemini: kein Schlüssel gesetzt (GEMINI_API_KEY)');
  }

  if (config.anthropicKey) {
    try {
      const client = new Anthropic({ apiKey: config.anthropicKey });
      const msg = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = msg.content
        ?.filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      if (text) return text;
      gruende.push('Claude: leere Antwort');
    } catch (err) {
      console.error('Claude-Beschreibung fehlgeschlagen:', err.message);
      gruende.push(`Claude: ${err.message}`);
    }
  }

  throw new Error(`Kein Infotext erzeugt. ${gruende.join(' · ')}`);
}

function buildPrompt({ transcript, title, crew, podcast, rechercheNoetig, hinweise }) {
  return [
    `Du schreibst die Folgenbeschreibung (Show Notes) für den deutschsprachigen Filmpodcast „${podcast}".`,
    '',
    'DIE DREI HOSTS – ihre Eigenheiten müssen im Text erkennbar sein:',
    crew,
    '',
    'SO SOLL DER TEXT SEIN:',
    '- Deutsch, locker und witzig, wie die drei selbst reden. Kein Werbesprech.',
    '- Nimm konkret Bezug auf den Film und spiele mit dem, was dort wirklich passiert:',
    '  Figuren, Effekte, Logiklücken, typische Szenen.',
    '- Nichts erfinden, was es im Film nicht gibt. Keine Spoiler auf Wendungen.',
    '- Struktur: 3–5 Sätze Fließtext, danach 3–5 Stichpunkte mit den Themen der Folge.',
    '- Gib NUR den Beschreibungstext zurück, ohne Vorrede und ohne Überschrift.',
    '',
    title ? `Film bzw. Serie dieser Folge: ${title}` : '',
    hinweise ? `Stichworte der Hosts zu dieser Folge (unbedingt berücksichtigen): ${hinweise}` : '',
    '',
    rechercheNoetig
      ? [
          'Für diese Folge liegt kein Transkript vor. Recherchiere den Film kurz',
          '(Handlung, Regie, Besetzung, Besonderheiten) und schreibe daraus.',
          'Baue ein bis zwei Anspielungen darauf ein, wie die drei vermutlich reagieren –',
          'etwa emefka schwärmt von einem Effekt, Maurice stolpert über ein Drehbuchloch,',
          'Matthew ist entweder hin und weg oder komplett raus.',
        ].join('\n')
      : [
          'GRUNDLAGE IST DAS ECHTE GESPRÄCH DER DREI (Transkript, ggf. automatisch erstellt',
          'und deshalb stellenweise fehlerhaft – lies sinngemäß).',
          '',
          'Zusätzlich zu den Regeln oben:',
          '- Höre aus dem Gespräch heraus, wie die drei den Film TATSÄCHLICH finden, und',
          '  schreibe daraus einen kurzen Ausblick. Nichts unterstellen, was nicht gesagt wurde.',
          '- Wenn sie uneins sind, ist genau das der Aufhänger.',
          '- Greife ein bis zwei Momente auf, über die im Gespräch wirklich geredet wurde',
          '  (eine Szene, ein Effekt, eine Logiklücke, ein Streitpunkt).',
          '- Schließe mit einer eigenen Zeile ab, die genau so beginnt:',
          '  „Kurzfazit ohne Spoiler:" – danach ein Satz je Person in der Form',
          '  „Name: Urteil" (z. B. „emefka: Effekte top, Story dünn"). Verrate dabei',
          '  keine Wendung des Films.',
          '',
          'Transkript:',
          transcript.slice(0, 30000),
        ].join('\n'),
  ].filter(Boolean).join('\n');
}
