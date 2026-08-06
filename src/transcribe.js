import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { config, paths } from './config.js';
import { toTranscriptionAudio } from './audio.js';
import { geminiClient, geminiGenerate } from './gemini.js';

// Wandelt eine Aufnahme in Text um.
// Bevorzugt Google Gemini (kostenloser Kontingentbereich, gut bei Deutsch und
// Eigennamen). Fällt auf OpenAI Whisper zurück, wenn nur dieser Schlüssel gesetzt ist.
// Ohne Schlüssel wird "" zurückgegeben – die App funktioniert dann ohne Transkript.
// Mehrere Aufnahme-Teile nacheinander transkribieren und zusammenfügen.
// Gibt Text UND Fehlergründe zurück: Ein leises Scheitern hat schon dazu
// geführt, dass am Ende gar kein Infotext entstand, ohne dass jemand wusste warum.
// „melde" bekommt kurze Sätze über den aktuellen Schritt. Ohne das sitzt der
// Nutzer minutenlang vor einer Anzeige, die nichts sagt.
export async function transcribeAll(files, melde = () => {}) {
  const parts = [];
  const fehler = [];
  for (let i = 0; i < files.length; i++) {
    const teil = (text) => melde({ teil: i + 1, gesamt: files.length, phase: text });
    try {
      const text = await transcribe(files[i], teil);
      if (text) parts.push(text);
    } catch (err) {
      console.error('Transkription eines Teils fehlgeschlagen:', err.message);
      fehler.push(err.message);
    }
  }
  return { text: parts.join('\n\n'), fehler };
}

export async function transcribe(file, melde = () => {}) {
  if (!config.geminiKey && !config.openaiKey) return '';

  // Für die Übertragung eine schlanke Mono-MP3 erzeugen (klein und überall lesbar).
  const slim = path.join(paths.tmp, `stt-${path.basename(file)}.mp3`);
  let source = file;
  try {
    melde('Aufnahme wird für die Übertragung verkleinert');
    await toTranscriptionAudio(file, slim);
    source = slim;
  } catch (err) {
    console.error('Konvertierung für Transkription fehlgeschlagen, nutze Originaldatei:', err.message);
  }

  try {
    if (config.geminiKey) return await transcribeWithGemini(source, melde);
    melde('Aufnahme wird mitgeschrieben');
    return await transcribeWithWhisper(source);
  } finally {
    if (source === slim) fs.rmSync(slim, { force: true });
  }
}

async function transcribeWithGemini(file, melde = () => {}) {
  const ai = geminiClient();

  // Datei hochladen (funktioniert auch für lange Folgen, anders als Inline-Daten).
  melde('Aufnahme wird zu Google übertragen');
  const uploaded = await ai.files.upload({ file, config: { mimeType: 'audio/mpeg' } });

  // Warten, bis die Datei serverseitig verarbeitet ist (max. ~2 Minuten).
  let info = uploaded;
  for (let i = 0; i < 60 && info.state === 'PROCESSING'; i++) {
    melde('Google bereitet die Aufnahme vor');
    await new Promise((r) => setTimeout(r, 2000));
    info = await ai.files.get({ name: uploaded.name });
  }
  if (info.state === 'FAILED') throw new Error('Gemini konnte die Audiodatei nicht verarbeiten.');
  if (info.state === 'PROCESSING') throw new Error('Gemini brauchte zu lange für die Audiodatei (Zeitüberschreitung).');

  const prompt = [
    'Transkribiere diese Audioaufnahme vollständig und wortgetreu.',
    'Die Sprache ist überwiegend Deutsch.',
    'Achte besonders auf korrekte Schreibweise von Eigennamen',
    '(Filmtitel, Regisseure, Schauspielerinnen und Schauspieler).',
    'Gib ausschließlich den Transkripttext zurück – keine Zeitstempel, keine Vorrede,',
    'keine Sprecher-Labels, keine Kommentare.',
  ].join(' ');

  try {
    melde('Aufnahme wird mitgeschrieben (der längste Schritt)');
    const res = await geminiGenerate({
      contents: [
        { role: 'user', parts: [
          { fileData: { fileUri: info.uri, mimeType: info.mimeType } },
          { text: prompt },
        ] },
      ],
    });
    return (res.text || '').trim();
  } finally {
    // Hochgeladene Datei wieder entfernen (Speicher im Konto freigeben).
    ai.files.delete({ name: uploaded.name }).catch(() => {});
  }
}

async function transcribeWithWhisper(file) {
  const client = new OpenAI({ apiKey: config.openaiKey });
  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream(file),
    model: 'whisper-1',
    language: 'de',
    response_format: 'text',
  });
  return typeof result === 'string' ? result.trim() : (result.text || '').trim();
}
