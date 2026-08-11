import fs from 'node:fs';
import path from 'node:path';
import ffmpeg from 'fluent-ffmpeg';
import { paths } from './config.js';
import { probeDuration } from './audio.js';

// Wellenform-Daten und Schnitte für einzelne Aufnahme-Teile.
// Die Kurve wird serverseitig aus dem Ton berechnet, damit das Handy nicht
// eine stundenlange Aufnahme dekodieren muss.

const PEAK_RATE = 8000; // Abtastrate für die Analyse – für eine Kurve völlig ausreichend

// Auflösung der Hüllkurve.
//
// Früher waren es pauschal 1200 Werte. Bei einer 40-Minuten-Aufnahme sind das
// 2 Sekunden je Strich – ein 10-Sekunden-Bereich wäre fünf Striche breit und
// mit der Maus nicht zu treffen. Mit 8 Werten je Sekunde sind es 0,125 s je
// Strich; damit lässt sich hineinzoomen, ohne dass die Kurve zu Klötzen wird.
// Die Obergrenze hält die Antwort bei sehr langen Aufnahmen im Rahmen
// (12 000 Werte ≈ 70 KB JSON, komprimiert deutlich weniger).
const WERTE_PRO_SEKUNDE = 8;
const WERTE_MIN = 1200;
const WERTE_MAX = 12000;

// Version der Kurven-Berechnung. Steigt sie, werden zwischengespeicherte
// Kurven aus älteren Läufen verworfen und neu gerechnet.
export const PEAKS_VERSION = 2;

/**
 * Berechnet die Hüllkurve einer Audiodatei.
 * @returns {Promise<{peaks:number[], duration:number}>} Werte zwischen 0 und 1
 */
export async function generatePeaks(file, buckets = null) {
  const raw = path.join(paths.tmp, `peaks-${path.basename(file)}.pcm`);
  try {
    await new Promise((resolve, reject) => {
      ffmpeg(file)
        .audioChannels(1)
        .audioFrequency(PEAK_RATE)
        .audioCodec('pcm_s16le')
        .format('s16le')
        .on('error', reject)
        .on('end', resolve)
        .save(raw);
    });

    const buf = fs.readFileSync(raw);
    const total = Math.floor(buf.length / 2);
    if (!total) return { peaks: [], duration: 0 };

    // Anzahl der Werte aus der tatsächlichen Länge ableiten – erst hier ist
    // sie ohne zusätzlichen ffprobe-Aufruf bekannt.
    const dauer = total / PEAK_RATE;
    const anzahl = buckets
      || Math.min(WERTE_MAX, Math.max(WERTE_MIN, Math.round(dauer * WERTE_PRO_SEKUNDE)));

    const per = Math.max(1, Math.floor(total / anzahl));
    const peaks = [];
    for (let b = 0; b < anzahl; b++) {
      const start = b * per;
      if (start >= total) break;
      let max = 0;
      for (let i = start; i < Math.min(start + per, total); i++) {
        const v = Math.abs(buf.readInt16LE(i * 2));
        if (v > max) max = v;
      }
      peaks.push(Number((max / 32768).toFixed(3)));
    }

    return { peaks, duration: total / PEAK_RATE };
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

/**
 * Schneidet Bereiche aus einer Audiodatei heraus.
 * @param {{start:number,end:number}[]} cuts zu entfernende Bereiche in Sekunden
 */
export async function cutRegions(inFile, outFile, cuts) {
  const duration = await probeDuration(inFile);

  // Aus den zu entfernenden Bereichen die zu behaltenden Abschnitte ableiten.
  const sorted = [...cuts]
    .map((c) => ({ start: Math.max(0, Number(c.start) || 0), end: Math.min(duration, Number(c.end) || 0) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);

  const keep = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.start > cursor) keep.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration });

  if (!keep.length) throw new Error('Es würde nichts übrig bleiben.');

  return new Promise((resolve, reject) => {
    const filters = keep.map((k, i) =>
      `[0:a]atrim=start=${k.start.toFixed(3)}:end=${k.end.toFixed(3)},asetpts=PTS-STARTPTS[k${i}]`
    );
    filters.push(`${keep.map((_, i) => `[k${i}]`).join('')}concat=n=${keep.length}:v=0:a=1[out]`);

    ffmpeg(inFile)
      .complexFilter(filters, 'out')
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .format('mp3')
      .on('error', reject)
      .on('end', () => resolve(outFile))
      .save(outFile);
  });
}
