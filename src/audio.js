import path from 'node:path';
import fs from 'node:fs';
import ffmpeg from 'fluent-ffmpeg';
import { paths } from './config.js';

// System-ffmpeg verwenden (im Docker-Image per apt installiert). Optional lassen
// sich die Pfade über Umgebungsvariablen überschreiben. Fällt sonst auf das
// ffmpeg/ffprobe im PATH zurück – so wie fluent-ffmpeg es standardmäßig sucht.
if (process.env.FFMPEG_PATH) ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
if (process.env.FFPROBE_PATH) ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);

// Einheitliches Zielformat, damit Intro/Aufnahme/Outro sauber aneinanderpassen,
// egal in welchem Format das Handy aufgenommen hat (webm/opus, mp4/aac, ...).
const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITRATE = '128k';

// Liest die Dauer (in Sekunden) einer Audiodatei aus.
export function probeDuration(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
      if (err) return reject(err);
      resolve(Math.round(meta.format?.duration || 0));
    });
  });
}

// Baut die Filter-Kette für die KI-/DSP-Sprachoptimierung der Hauptaufnahme.
// strength: 0..100 (Regler in der App). "Dezent" bei niedrigen Werten,
// aggressiver bei hohen. Läuft komplett lokal über ffmpeg – kostet nichts.
function enhanceChain(strength) {
  const s = Math.min(100, Math.max(0, Number(strength) || 0)) / 100;

  const parts = [];
  // 1) Tiefes Rumpeln entfernen (Motor, Klimaanlage, Wind).
  parts.push('highpass=f=90');

  // 2) Optional: RNNoise-Modell, falls vorhanden (deutlich stärker gegen
  //    Umgebungsgeräusche wie Restaurant/Auto). Datei einfach nach
  //    data/assets/rnnoise.rnn legen – ansonsten wird es übersprungen.
  const rnn = path.join(paths.media, 'assets', 'rnnoise.rnn');
  if (fs.existsSync(rnn)) {
    parts.push(`arnndn=m='${rnn.replace(/\\/g, '/')}'`);
  }

  // 3) FFT-Rauschunterdrückung, Stärke skaliert mit dem Regler (ca. 6–28 dB).
  const nr = (6 + s * 22).toFixed(0);
  parts.push(`afftdn=nr=${nr}:nf=-25:tn=1`);

  // 4) Zischlaute etwas zähmen und Höhen-Rauschen begrenzen.
  parts.push('lowpass=f=14000');

  // 5) Lautstärke gleichmäßiger machen (leicht komprimieren).
  parts.push('acompressor=threshold=-18dB:ratio=3:attack=20:release=250');

  // 6) Auf Podcast-Standard-Lautheit normalisieren (-16 LUFS).
  parts.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  return parts.join(',');
}

// Fügt (optional) Intro + Hauptaufnahme + (optional) Outro zu einer MP3 zusammen.
// Alle Segmente werden neu kodiert und normalisiert. Auf die Hauptaufnahme wird
// – falls gewünscht – die KI-/DSP-Sprachoptimierung angewendet.
export function buildEpisode({ intro, main, outro, outFile, enhance }) {
  const ordered = [
    { file: intro, isMain: false },
    { file: main, isMain: true },
    { file: outro, isMain: false },
  ].filter((seg) => seg.file && fs.existsSync(seg.file));

  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    ordered.forEach((seg) => command.input(seg.file));

    const filterParts = [];
    ordered.forEach((seg, i) => {
      const base = `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,aresample=${SAMPLE_RATE}`;
      // Optimierung nur auf die eigentliche Aufnahme, nicht auf Intro/Outro.
      const chain = seg.isMain && enhance?.enabled
        ? `${enhanceChain(enhance.strength)},${base}`
        : base;
      filterParts.push(`[${i}:a]${chain}[a${i}]`);
    });
    const concatInputs = ordered.map((_, i) => `[a${i}]`).join('');
    filterParts.push(`${concatInputs}concat=n=${ordered.length}:v=0:a=1[out]`);

    command
      .complexFilter(filterParts, 'out')
      .audioCodec('libmp3lame')
      .audioBitrate(BITRATE)
      .audioChannels(CHANNELS)
      .audioFrequency(SAMPLE_RATE)
      .format('mp3')
      .on('error', reject)
      .on('end', async () => {
        try {
          const duration = await probeDuration(outFile);
          const size = fs.statSync(outFile).size;
          resolve({ duration, size });
        } catch (e) {
          reject(e);
        }
      })
      .save(outFile);
  });
}

// Erzeugt eine schlanke MP3-Fassung für die Transkription: mono, 16 kHz, 32 kbit/s.
// Gründe: Sprache braucht nicht mehr, die Datei wird dadurch ~10x kleiner (schnellerer
// Upload) und liegt in einem Format vor, das die KI-Dienste sicher verstehen –
// anders als das webm/opus, das Handy-Browser aufnehmen.
export function toTranscriptionAudio(input, outFile) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioCodec('libmp3lame')
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('32k')
      .format('mp3')
      .on('error', reject)
      .on('end', () => resolve(outFile))
      .save(outFile);
  });
}

// Formatiert Sekunden als HH:MM:SS (für den <itunes:duration>-Tag).
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export { path };
