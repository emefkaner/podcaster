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

// Das Cold-Open-Intro klingt aus, während die Aufnahme schon läuft: die
// letzten Sekunden des Intros liegen ÜBER dem Anfang des ersten Teils
// (acrossfade, Sprache sofort in voller Lautstärke, Musik blendet aus).
const INTRO_UEBERBLENDUNG = 5; // Sekunden

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

  // Cold Open: die letzten Sekunden des Intros über den Anfang des ersten
  // Teils legen. Nur Intro + die ersten ~10 s des Teils werden dafür neu
  // kodiert, der Rest wird weiter kopiert – der Geschwindigkeitsvorteil
  // dieses Wegs bleibt also erhalten. Scheitert die Überblendung, wird
  // schlicht hart geschnitten wie bisher (Folge geht immer vor Feinschliff).
  if (intro && fs.existsSync(intro) && vorbereitet.length >= 2) {
    try {
      const ersatz = await introUeberblenden({
        intro: vorbereitet[0], teil1: vorbereitet[1], rate, ch,
      });
      vorbereitet.splice(0, 2, ...ersatz);
      tmpFiles.push(...ersatz);
    } catch (e) {
      console.warn('Intro-Überblendung übersprungen:', e.message);
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

// Blendet das Intro in den ersten Aufnahme-Teil über (Cold Open).
// Liefert die Dateien, die Intro und Teil 1 in der Concat-Liste ersetzen.
async function introUeberblenden({ intro, teil1, rate, ch }) {
  const d = INTRO_UEBERBLENDUNG;
  const introDauer = (await probe(intro)).duration;
  const teilDauer = (await probe(teil1)).duration;
  if (introDauer < d + 1) throw new Error(`Intro zu kurz für ${d} s Überblendung (${introDauer}s).`);
  if (teilDauer < d + 1) throw new Error(`Erster Teil zu kurz für die Überblendung (${teilDauer}s).`);

  const KOPF = d + 5; // so viele Sekunden des Teils werden mitkodiert (Reserve)
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const kopf = path.join(paths.tmp, `kopf-${stamp}.mp3`);

  if (teilDauer <= KOPF + d) {
    // Sehr kurzer erster Teil: komplett mit einrechnen, kein Abtrennen nötig.
    await crossfadeDatei({ a: intro, b: teil1, dauerB: null, out: kopf, rate, ch });
    return [kopf];
  }

  await crossfadeDatei({ a: intro, b: teil1, dauerB: KOPF, out: kopf, rate, ch });

  // Rest des ersten Teils ab KOPF ohne Neukodierung abtrennen. Der Schnitt
  // sitzt auf der nächsten MP3-Rahmengrenze (~26 ms Raster) – bei laufender
  // Sprache unhörbar, und nur so bleibt der Weg auch bei 2-h-Folgen schnell.
  const rest = path.join(paths.tmp, `rest-${stamp}.mp3`);
  await new Promise((resolve, reject) => {
    ffmpeg(teil1)
      .outputOptions(['-ss', String(KOPF), '-c', 'copy'])
      .on('error', reject).on('end', resolve)
      .save(rest);
  });
  return [kopf, rest];
}

// Kodiert a + b mit acrossfade zu einer Datei. dauerB begrenzt, wie viel von b
// eingelesen wird (null = ganz). c2=nofade: die Sprache startet sofort in
// voller Lautstärke, nur die Intro-Musik blendet aus.
function crossfadeDatei({ a, b, dauerB, out, rate, ch }) {
  const layout = ch === 1 ? 'mono' : 'stereo';
  const basis = `aformat=sample_rates=${rate}:channel_layouts=${layout},aresample=${rate}`;
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(a).input(b);
    if (dauerB) cmd.inputOptions([`-t`, String(dauerB)]);
    cmd
      .complexFilter([
        `[0:a]${basis}[i0]`,
        `[1:a]${basis}[i1]`,
        `[i0][i1]acrossfade=d=${INTRO_UEBERBLENDUNG}:c1=tri:c2=nofade[out]`,
      ], 'out')
      .audioCodec('libmp3lame').audioBitrate(BITRATE)
      .audioFrequency(rate).audioChannels(ch)
      .format('mp3')
      .on('error', reject).on('end', resolve)
      .save(out);
  });
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
function mainChain({ enhance, trimSilence, normalize }) {
  const parts = [];
  if (bereinigungNoetig(enhance)) parts.push(enhanceChain(enhance));
  if (trimSilence?.enabled) parts.push(silenceChain(trimSilence.seconds));

  // Auf Podcast-Standard-Lautheit bringen (-16 LUFS). Das ist der Grund,
  // warum Teil 1 und Teil 2 hinterher gleich laut sind: JEDER Teil wird
  // einzeln auf denselben Zielwert gezogen, nicht die fertige Folge.
  if (normalize?.enabled !== false) parts.push('loudnorm=I=-16:TP=-1.5:LRA=11');

  return parts.join(',');
}

// Fügt (optional) Intro + alle Aufnahme-Teile in ihrer Reihenfolge + (optional)
// Outro zu einer MP3 zusammen. Eine Folge besteht oft aus mehreren Aufnahmen –
// etwa Vorgespräch und Spoilerteil, manchmal zusätzlich Wiederholungen.
// Alle Segmente werden neu kodiert und normalisiert. Auf die Aufnahmen wird
// – falls gewünscht – die KI-/DSP-Sprachoptimierung angewendet.
export async function buildEpisode({ intro, main, outro, outFile, enhance, trimSilence, normalize, onProgress }) {
  const mains = (Array.isArray(main) ? main : [main]).filter(Boolean);
  const ordered = [
    { file: intro, isMain: false },
    ...mains.map((file) => ({ file, isMain: true })),
    { file: outro, isMain: false },
  ].filter((seg) => seg.file && fs.existsSync(seg.file));

  // Cold Open: Intro in den ersten Teil überblenden – aber nur, wenn beide
  // lang genug sind, sonst bräche acrossfade den ganzen Bau ab.
  let ueberblenden = false;
  if (ordered.length >= 2 && !ordered[0].isMain && ordered[1].isMain) {
    try {
      const [di, dt] = await Promise.all([probe(ordered[0].file), probe(ordered[1].file)]);
      ueberblenden = di.duration > INTRO_UEBERBLENDUNG + 1 && dt.duration > INTRO_UEBERBLENDUNG + 1;
    } catch { /* im Zweifel hart schneiden */ }
  }

  return new Promise((resolve, reject) => {
    const command = ffmpeg();
    ordered.forEach((seg) => command.input(seg.file));

    const filterParts = [];
    ordered.forEach((seg, i) => {
      const base = `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo,aresample=${SAMPLE_RATE}`;
      // Optimierung und Pausenkürzung nur auf die Aufnahmen, nicht auf Intro/Outro.
      const processing = seg.isMain ? mainChain({ enhance, trimSilence, normalize }) : '';
      const chain = processing ? `${processing},${base}` : base;
      filterParts.push(`[${i}:a]${chain}[a${i}]`);
    });

    let stroeme = ordered.map((_, i) => `a${i}`);
    if (ueberblenden) {
      filterParts.push(`[a0][a1]acrossfade=d=${INTRO_UEBERBLENDUNG}:c1=tri:c2=nofade[ax]`);
      stroeme = ['ax', ...stroeme.slice(2)];
    }
    if (stroeme.length === 1) {
      filterParts.push(`[${stroeme[0]}]anull[out]`);
    } else {
      filterParts.push(`${stroeme.map((s) => `[${s}]`).join('')}concat=n=${stroeme.length}:v=0:a=1[out]`);
    }

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
