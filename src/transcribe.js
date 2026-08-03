import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { config, paths } from './config.js';
import { toTranscriptionAudio } from './audio.js';

// Wandelt eine Aufnahme in Text um.
// Bevorzugt Google Gemini (kostenloser Kontingentbereich, gut bei Deutsch und
// Eigennamen). Fällt auf OpenAI Whisper zurück, wenn nur dieser Schlüssel gesetzt ist.
// Ohne Schlüssel wird "" zurückgegeben – die App funktioniert dann ohne Transkript.
export async function transcribe(file) {
  if (!config.geminiKey && !config.openaiKey) return '';

  // Für die Übertragung eine schlanke Mono-MP3 erzeugen (klein und überall lesbar).
  const slim = path.join(paths.tmp, `stt-${path.basename(file)}.mp3`);
  let source = file;
  try {
    await toTranscriptionAudio(file, slim);
    source = slim;
  } catch (err) {
    console.error('Konvertierung für Transkription fehlgeschlagen, nutze Originaldatei:', err.message);
  }

  try {
    if (config.geminiKey) return await transcribeWithGemini(source);
    return await transcribeWithWhisper(source);
  } finally {
    if (source === slim) fs.rmSync(slim, { force: true });
  }
}

async function transcribeWithGemini(file) {
  const ai = new GoogleGenAI({ apiKey: config.geminiKey });

  // Datei hochladen (funktioniert auch für lange Folgen, anders als Inline-Daten).
  const uploaded = await ai.files.upload({ file, config: { mimeType: 'audio/mpeg' } });

  // Warten, bis die Datei serverseitig verarbeitet ist (max. ~2 Minuten).
  let info = uploaded;
  for (let i = 0; i < 60 && info.state === 'PROCESSING'; i++) {
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
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
