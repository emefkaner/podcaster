import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { getSettings } from './store.js';
import { geminiGenerate } from './gemini.js';

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
      const res = await geminiGenerate({
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
    `Du schreibst die Folgenbeschreibung für den deutschsprachigen Filmpodcast „${podcast}".`,
    'Sie ist bewusst SEHR KURZ – niemand liest lange Show Notes.',
    '',
    'DIE HOSTS:',
    crew,
    '',
    'FORM – halte dich exakt daran:',
    '- Genau EIN Satz je Person aus der Liste oben, jeder Satz beginnt mit dem Namen',
    '  (z. B. „Matthew: …"). Kein Satz länger als etwa 20 Wörter.',
    '- Danach eine Leerzeile und zum Schluss EINE offene, neckische Frage zum Film,',
    '  die Lust aufs Reinhören macht. Beispiel für den Ton:',
    '  „Wird es den Cinespasten gefallen, wenn Grogu wieder Frösche isst?"',
    '- Sonst NICHTS: keine Überschrift, keine Einleitung, keine Stichpunkte,',
    '  keine Hashtags, kein Fazit-Absatz.',
    '',
    'INHALT:',
    '- Deutsch, locker und witzig, wie die drei selbst reden. Kein Werbesprech.',
    '- Konkret am Film bleiben: Figuren, Effekte, Logiklücken, echte Szenen.',
    '- Nichts erfinden, was es im Film nicht gibt. Keine Spoiler auf Wendungen.',
    '',
    title ? `Film bzw. Serie dieser Folge: ${title}` : '',
    hinweise ? `Stichworte der Hosts zu dieser Folge (unbedingt berücksichtigen): ${hinweise}` : '',
    '',
    rechercheNoetig
      ? [
          'Für diese Folge liegt kein Transkript vor. Recherchiere den Film kurz',
          '(Handlung, Regie, Besetzung, Besonderheiten) und leite daraus ab, wie jede',
          'Person vermutlich reagiert – passend zu ihren Eigenheiten oben.',
        ].join('\n')
      : [
          'GRUNDLAGE IST DAS ECHTE GESPRÄCH (Transkript, ggf. automatisch erstellt und',
          'deshalb stellenweise fehlerhaft – lies sinngemäß).',
          'Der Satz je Person muss wiedergeben, wie sie den Film TATSÄCHLICH findet.',
          'Nichts unterstellen, was nicht gesagt wurde. Sind sie uneins, mach genau das',
          'in den Sätzen sichtbar.',
          '',
          'Transkript:',
          transcript.slice(0, 30000),
        ].join('\n'),
  ].filter(Boolean).join('\n');
}
