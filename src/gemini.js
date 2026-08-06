import { GoogleGenAI } from '@google/genai';
import { config } from './config.js';

// Zugang zu Gemini – mit selbst gewähltem Modell.
//
// Hintergrund: Ein fest im Code stehender Modellname geht irgendwann kaputt.
// Google hat „gemini-2.5-flash" für neue Konten abgeschaltet, und die App
// lieferte daraufhin weder Transkript noch Infotext. Deshalb fragt sie jetzt
// bei Google nach, welche Modelle das Konto tatsächlich nutzen darf, und
// nimmt davon das beste. Mit GEMINI_MODEL lässt sich eins fest vorgeben.

let client = null;
let kandidaten = null;   // gefundene Modelle, bestes zuerst
let suche = null;        // laufende Abfrage, damit sie nicht mehrfach startet

export function geminiClient() {
  if (!config.geminiKey) throw new Error('Kein Gemini-Schlüssel gesetzt (GEMINI_API_KEY).');
  if (!client) client = new GoogleGenAI({ apiKey: config.geminiKey });
  return client;
}

// Nicht für Text/Audio geeignet oder eigene Produktschiene.
const UNGEEIGNET = /embedding|imagen|image|veo|tts|aqa|gemma|learnlm|robotics|native-audio|live|realtime|computer-use/i;

function version(name) {
  return Number((name.match(/gemini-(\d+(?:\.\d+)?)/i) || [])[1] || 0);
}

// Je höher, desto lieber. Flash ist schnell und günstig und reicht für
// Transkript und Infotext; eine höhere Versionsnummer schlägt alles andere.
// „…-latest" trägt keine Nummer im Namen, zeigt aber auf den aktuellen Stand –
// deshalb wird es knapp unterhalb der höchsten gefundenen Version eingeordnet.
function punkte(name, hoechsteVersion) {
  if (!/^gemini/i.test(name) || UNGEEIGNET.test(name)) return 0;
  const v = version(name) || (/latest/i.test(name) ? hoechsteVersion - 0.1 : 0);
  let p = 1 + v * 20;
  if (/flash/i.test(name)) p += 60;
  else if (/pro/i.test(name)) p += 30;
  if (/lite/i.test(name)) p -= 25;
  if (/preview|exp\b|thinking/i.test(name)) p -= 15;
  return p;
}

// Aus einer Liste von Modellnamen die brauchbaren heraussuchen, bestes zuerst.
export function modelleSortieren(namen) {
  const hoechste = Math.max(0, ...namen.map(version));
  return namen
    .map((n) => ({ n, p: punkte(n, hoechste) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p)
    .map((x) => x.n);
}

async function modelleHolen() {
  const ai = geminiClient();
  const namen = [];
  for await (const m of await ai.models.list()) {
    if (!m.name) continue;
    // Manche Antworten führen supportedActions nicht – dann nicht aussortieren.
    const aktionen = m.supportedActions || [];
    if (aktionen.length && !aktionen.includes('generateContent')) continue;
    namen.push(m.name.replace(/^models\//, ''));
  }

  const brauchbar = modelleSortieren(namen);

  if (!brauchbar.length) {
    throw new Error(`Gemini bietet diesem Konto kein passendes Textmodell an. Gefunden: ${namen.join(', ') || 'nichts'}`);
  }
  console.log(`Gemini-Modelle nutzbar (bestes zuerst): ${brauchbar.slice(0, 5).join(', ')}`);
  return brauchbar;
}

async function modellListe() {
  // Feste Vorgabe hat Vorrang, die abgefragten Modelle bleiben als Rückfall.
  if (kandidaten) return kandidaten;
  if (!suche) {
    suche = modelleHolen()
      .then((liste) => {
        kandidaten = config.geminiModel ? [config.geminiModel, ...liste.filter((m) => m !== config.geminiModel)] : liste;
        return kandidaten;
      })
      .catch((err) => {
        // Abfrage nicht möglich: Wenigstens mit der Vorgabe weiterarbeiten.
        if (config.geminiModel) { kandidaten = [config.geminiModel]; return kandidaten; }
        throw err;
      })
      .finally(() => { suche = null; });
  }
  return suche;
}

// Fehler, die bedeuten „dieses Modell gibt es für dich nicht" – dann lohnt der
// Versuch mit dem nächsten. Alles andere (Kontingent, Schlüssel, Inhalt) nicht.
function modellUnbekannt(err) {
  const t = `${err?.message || err}`;
  return /NOT_FOUND|404|no longer available|is not found|not supported/i.test(t);
}

// generateContent mit automatischer Modellwahl. Fällt ein Modell weg, wird
// das nächstbeste genommen und für die weitere Laufzeit gemerkt.
export async function geminiGenerate(params) {
  const ai = geminiClient();
  const liste = [...(await modellListe())];
  const abgelehnt = [];

  for (const modell of liste) {
    try {
      const res = await ai.models.generateContent({ model: modell, ...params });
      // Dieses Modell trägt – ab jetzt zuerst versuchen.
      kandidaten = [modell, ...liste.filter((m) => m !== modell)];
      return res;
    } catch (err) {
      if (!modellUnbekannt(err)) throw err;
      abgelehnt.push(modell);
    }
  }
  throw new Error(`Kein nutzbares Gemini-Modell. Abgelehnt: ${abgelehnt.join(', ')}`);
}

// Nur für den Systemstatus: Welches Modell würde gerade verwendet?
export async function geminiModellName() {
  const liste = await modellListe();
  return liste[0];
}
