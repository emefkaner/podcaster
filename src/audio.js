import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'fluent-ffmpeg';
import { paths } from './config.js';

const repoWurzel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

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

// Liest Codec, Abtastrate und Kanäle einer Audiodatei aus.
function probe(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, meta) => {
      if (err) return reject(err);
      const a = (meta.streams || []).find((s) => s.codec_type === 'audio') || {};
      resolve({
        codec: a.codec_name || '',
        sampleRate: Number(a.sample_rate) || 0,
        channels: Number(a.channels) || 0,
        duration: Number(meta.format?.duration) || 0,
      });
    });
  });
}

// Wandelt eine Datei in eine MP3 mit vorgegebener Abtastrate/Kanalzahl um.
function transcodeMp3(input, outFile, sampleRate, channels) {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .audioCodec('libmp3lame')
      .audioBitrate(BITRATE)
      .audioFrequency(sampleRate)
      .audioChannels(channels)
      .format('mp3')
      .on('error', reject)
      .on('end', () => resolve(outFile))
      .save(outFile);
  });
}

// Schnelles Zusammenfügen OHNE Neukodierung der (langen) Hauptaufnahme.
//
// Der Trick: Die Hauptaufnahme wird gar nicht angefasst. Nur Intro und Outro –
// jeweils wenige Sekunden – werden an ihr Format angepasst. Danach werden alle
// Teile per Stream-Copy aneinandergehängt. Dadurch dauert das Zusammenfügen auch
// bei einer zweistündigen Folge nur Sekunden, unabhängig von der Server-CPU.
//
// Voraussetzung fürs Kopieren: gleiche Codec-Familie. Die Hauptaufnahme sollte
// als MP3 vorliegen (z. B. MP3-Export aus Riverside). Ist sie es nicht, wird sie
// als einziger Ausweg doch umgewandelt – dann greift wieder die CPU-Grenze.
export async function buildEpisodeCopy({ intro, mains, outro, outFile }) {
  const mainList = (Array.isArray(mains) ? mains : [mains]).filter((f) => f && fs.existsSync(f));
  if (!mainList.length) throw new Error('Keine Aufnahme vorhanden.');

  // Referenzformat von der ersten Hauptaufnahme übernehmen.
  const ref = await probe(mainList[0]);
  const rate = ref.sampleRate || SAMPLE_RATE;
  const ch = ref.channels || CHANNELS;

  const reihenfolge = [intro, ...mainList, outro].filter((f) => f && fs.existsSync(f));
  const tmpFiles = [];
  const vorbereitet = [];

  for (const seg of reihenfolge) {
    const p = await probe(seg).catch(() => ({}));
    const passt = p.codec === 'mp3' && p.sampleRate === rate && p.channels === ch;
    if (passt) {
      vorbereitet.push(seg); // unverändert übernehmen (kein Neukodieren!)
    } else {
      const t = path.join(paths.tmp, `norm-${path.basename(seg)}-${Date.now()}.mp3`);
      await transcodeMp3(seg, t, rate, ch);
      vorbereitet.push(t);
      tmpFiles.push(t);
    }
  }

  // Concat-Liste schreiben und per Stream-Copy zusammenfügen.
  const listFile = path.join(paths.tmp, `list-${Date.now()}.txt`);
  fs.writeFileSync(listFile, vorbereitet.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
  tmpFiles.push(listFile);

  try {
    await new Promise((resolve, reject) => {
      ffmpeg(listFile)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .on('error', reject)
        .on('end', resolve)
        .save(outFile);
    });
    const duration = await probeDuration(outFile);
    const size = fs.statSync(outFile).size;
    return { duration, size };
  } finally {
    for (const f of tmpFiles) fs.rmSync(f, { force: true });
  }
}

// Sucht das RNNoise-Modell. Eigene Datei im Datenordner hat Vorrang, sonst die
// mitgelieferte. Die liegt bewusst unter public/, damit sie DIESELBE Datei ist,
// die der Browser über /assets/rnnoise.rnn holt – ein Modell, zwei Rechenwege.
function rnnoiseModell() {
  const kandidaten = [
    path.join(paths.media, 'assets', 'rnnoise.rnn'),
    path.join(repoWurzel, 'public', 'assets', 'rnnoise.rnn'),
  ];
  return kandidaten.find((p) => fs.existsSync(p)) || null;
}

// Prüft EINMAL, ob das vorhandene ffmpeg den Filter arnndn überhaupt kennt.
// Ohne diese Prüfung würde ein ffmpeg ohne den Filter die komplette Folge mit
// „No such filter" abbrechen – statt einfach etwas schlechter zu klingen.
let arnndnBekannt = null;
function kannArnndn() {
  if (arnndnBekannt !== null) return arnndnBekannt;
  try {
    const bin = process.env.FFMPEG_PATH || 'ffmpeg';
    const liste = execFileSync(bin, ['-hide_banner', '-filters'], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    });
    arnndnBekannt = /\barnndn\b/.test(liste);
  } catch {
    arnndnBekannt = false;
  }
  if (!arnndnBekannt) {
    console.warn('ffmpeg kennt den Filter arnndn nicht – RNNoise wird übersprungen.');
  }
  return arnndnBekannt;
}

// Baut die Filter-Kette für die Klangbereinigung der Hauptaufnahme.
//
// Zwei Dinge, die sich EINZELN zuschalten lassen:
//   enhance.enabled  – die klassischen Filter, Stärke über enhance.strength
//   enhance.rnnoise  – RNNoise, ein neuronales Netz gegen Umgebungsgeräusche
// Beides zusammen ist der Normalfall, aber RNNoise allein ist eine gute Wahl,
// wenn die klassischen Filter die Stimme schon dumpf machen.
function enhanceChain(enhance) {
  const klassisch = Boolean(enhance?.enabled);
  const rnn = Boolean(enhance?.rnnoise);
  const s = Math.min(100, Math.max(0, Number(enhance?.strength) || 0)) / 100;

  const parts = [];
  // 1) Tiefes Rumpeln entfernen (Motor, Klimaanlage, Wind). Hilft beiden Wegen.
  parts.push('highpass=f=90');

  // 2) RNNoise. Das Modell liegt unter public/assets/rnnoise.rnn – dieselbe
  //    Datei, die der Browser holt. Eine eigene unter data/media/assets/
  //    sticht sie, falls jemand ein anderes Modell ausprobieren will.
  if (rnn) {
    const datei = rnnoiseModell();
    if (datei && kannArnndn()) parts.push(`arnndn=m='${datei.replace(/\\/g, '/')}'`);
    else console.warn('RNNoise gewünscht, aber Modell oder Filter fehlt – übersprungen.');
  }

  if (klassisch) {
    // 3) FFT-Rauschunterdrückung, Stärke skaliert mit dem Regler (ca. 6–28 dB).
    parts.push(`afftdn=nr=${(6 + s * 22).toFixed(0)}:nf=-25:tn=1`);
    // 4) Zischlaute etwas zähmen und Höhen-Rauschen begrenzen.
    parts.push('lowpass=f=14000');
    // 5) Lautstärke gleichmäßiger machen (leicht komprimieren).
    parts.push('acompressor=threshold=-18dB:ratio=3:attack=20:release=250');
  }

  return parts.join(',');
}

// Ist an dieser Folge überhaupt etwas zu bereinigen?
export function bereinigungNoetig(enhance) {
  return Boolean(enhance?.enabled || enhance?.rnnoise);
}

// Kürzt lange Sprechpausen automatisch. Kurze Atempausen bleiben erhalten –
// gekappt wird erst ab der eingestellten Länge, und es bleibt bewusst ein Rest
// stehen, damit die Folge nicht gehetzt klingt.
function silenceChain(seconds) {
  const stop = Math.max(0.5, Number(seconds) || 2);
  const keep = 0.4; // so viel Stille bleibt stehen
  return [
    `silenceremove=stop_periods=-1:stop_duration=${stop}:stop_threshold=-38dB:stop_silence=${keep}`,
  ].join(',');
}

// Baut die vollständige Filterkette für eine Aufnahme.
function mainChain({ enhance, trimSilence }) {
  const parts = [];
  if (bereinigungNoetig(enhance)) parts.push(enhanceChain(enhance));
  if (trimSilence?.enabled) parts.push(silenceChain(trimSilence.seconds));

  // 6) Auf Podcast-Standard-Lautheit normalisieren (-16 LUFS).
  parts.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  return parts.join(',');
}

// Fügt (optional) Intro + alle Aufnahme-Teile in ihrer Reihenfolge + (optional)
// Outro zu einer MP3 zusammen. Eine Folge besteht oft aus mehreren Aufnahmen –
// etwa Vorgespräch und Spoilerteil, manchmal zusätzlich Wiederholungen.
// Alle Segmente werden neu kodiert und normalisiert. Auf die Aufnahmen wird
// – falls gewünscht – die KI-/DSP-Sprachoptimierung angewendet.
export function buildEpisode({ intro, main, outro, outFile, enhance, trimSilence, onProgress }) {
  const mains = (Array.isArray(main) ? main : [main]).filter(Boolean);
  const ordered = [
    { file: intro, isMain: false },
    ...mains.map((file) => ({ file, isMain: true })),
    { file: outro, isMain: false },
  ].filter((seg) => seg.file && fs.existsSync(seg.file));

  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    ordered.forEach((seg) => command.input(seg.file));

    const filterParts = [];
    ordered.forEach((seg, i) => {
      const base = `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,aresample=${SAMPLE_RATE}`;
      // Optimierung und Pausenkürzung nur auf die Aufnahmen, nicht auf Intro/Outro.
      const processing = seg.isMain ? mainChain({ enhance, trimSilence }) : '';
      const chain = processing ? `${processing},${base}` : base;
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
      // Fortschritt weitermelden, damit die App einen Balken zeigen kann.
      .on('progress', (p) => {
        if (typeof onProgress === 'function') {
          onProgress({ prozent: Math.min(99, Math.round(p.percent || 0)), stand: p.timemark });
        }
      })
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
