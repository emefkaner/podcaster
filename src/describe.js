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

  // Der Aufhänger kommt IMMER aus einer Recherche zum Film, nicht aus dem
  // Gespräch – so bleibt er spoilerfrei. Das Transkript liefert nur, was die
  // drei tatsächlich vom Film halten.
  const mitTranskript = Boolean(clean);
  const prompt = buildPrompt({
    transcript: clean, title, crew, podcast, mitTranskript, hinweise: hinweise.trim(),
  });

  const gruende = [];

  if (config.geminiKey) {
    try {
      const res = await geminiGenerate({
        contents: prompt,
        // Immer im Netz nachschlagen: Der Aufhänger soll aus einer echten,
        // spoilerfreien Inhaltsangabe stammen statt aus dem Gedächtnis.
        config: { tools: [{ googleSearch: {} }] },
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

// Exportiert, damit sich die Form ohne Netzaufruf nachprüfen lässt.
export function buildPrompt({ transcript, title, crew, podcast, mitTranskript, hinweise }) {
  const namen = crew.split('\n').map((z) => z.split(':')[0].trim()).filter(Boolean);

  return [
    `Du schreibst die Folgenbeschreibung für den deutschsprachigen Filmpodcast „${podcast}".`,
    'Sie ist bewusst SEHR KURZ – niemand liest lange Show Notes.',
    '',
    'DIE HOSTS:',
    crew,
    '',
    'ZUERST RECHERCHIEREN: Schlag den Film im Netz nach und nimm dir eine',
    'SPOILERFREIE Inhaltsangabe – also nur die Ausgangslage, mit der der Film',
    'startet. Alles, was danach passiert, bleibt draußen: keine Wendungen, keine',
    'Auflösung, kein Ende, keine Überraschungsauftritte, kein Tod einer Figur.',
    '',
    `FORM – genau ${namen.length + 2} Sätze, nicht mehr:`,
    '1. EIN Satz zur Ausgangslage des Films aus der Recherche. Reine Prämisse.',
    `2. Dann je EIN Satz zu jeder Person (${namen.join(', ')}) – insgesamt ${namen.length}.`,
    '   Fließtext, in dem der Name vorkommt, etwa „Maurice fragt sich, warum …".',
    '   KEINE Aufzählung, KEIN Doppelpunkt-Muster wie „Name: Urteil".',
    '3. Zum Schluss EIN Satz: eine offene, neckische Frage zum Film, die Lust',
    '   aufs Reinhören macht. Beispiel für den Ton:',
    '   „Wird es den Cinespasten gefallen, wenn Grogu wieder Frösche isst?"',
    '',
    'Sonst NICHTS: keine Überschrift, keine Einleitung, keine Stichpunkte,',
    'keine Hashtags, kein Fazit-Absatz, keine Hinweise auf deine Quellen.',
    '',
    'TON: Deutsch, locker und witzig, wie die drei selbst reden. Kein Werbesprech.',
    'Kein Satz länger als etwa 25 Wörter. Nichts erfinden, was es im Film nicht gibt.',
    '',
    title ? `Film bzw. Serie dieser Folge: ${title}` : null,
    hinweise ? `Stichworte der Hosts zu dieser Folge (unbedingt berücksichtigen): ${hinweise}` : null,
    '',
    mitTranskript
      ? [
          'WAS DIE DREI VOM FILM HALTEN, steht im Transkript unten (automatisch',
          'erstellt, stellenweise fehlerhaft – lies sinngemäß). Der Satz zu jeder',
          'Person muss wiedergeben, wie sie den Film TATSÄCHLICH findet. Nichts',
          'unterstellen, was nicht gesagt wurde. Sind sie uneins, mach das sichtbar.',
          'Auch hier gilt: nichts verraten, was den Film spoilert.',
          '',
          'Transkript:',
          transcript.slice(0, 30000),
        ].join('\n')
      : [
          'Für diese Folge liegt kein Transkript vor. Leite aus dem recherchierten',
          'Film ab, wie jede Person vermutlich reagiert – passend zu ihren',
          'Eigenheiten oben.',
        ].join('\n'),
  ].filter((zeile) => zeile !== null && zeile !== undefined).join('\n');
}
