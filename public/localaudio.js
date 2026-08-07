'use strict';

// Audio-Aufbereitung direkt im Browser.
//
// Warum: Der Server läuft auf einem sehr kleinen Plan. Rauschunterdrückung ist
// der rechenintensivste Schritt und dauert dort länger als die Aufnahme selbst.
// Auf einem normalen Rechner ist derselbe Schritt ein Vielfaches schneller.
// Deshalb kann die Bearbeitung wahlweise hier passieren; hochgeladen wird dann
// die fertig bearbeitete Fassung, und der Server fügt nur noch zusammen.
//
// Genutzt wird ffmpeg als WebAssembly. Die etwa 31 MB werden einmalig geladen
// und danach vom Browser zwischengespeichert.

// Alle ffmpeg-Bausteine liegen in der eigenen App (public/vendor/ffmpeg).
// Aus derselben Herkunft geladen entfällt jedes Cross-Origin-Problem, an dem die
// Aufbereitung auf dem Gerät bisher scheiterte.
const BASE = '/vendor/ffmpeg';
const CORE = `${BASE}/ffmpeg-core.js`;
const WASM = `${BASE}/ffmpeg-core.wasm`;
const WRAPPER = `${BASE}/ffmpeg.js`;
const WORKER = `${BASE}/814.ffmpeg.js`; // internes Arbeitsskript der Bibliothek
const UTIL = `${BASE}/util.js`;

let ffmpegInstanz = null;
let ladeVersuch = null;

// Nur anbieten, wo es auch sinnvoll ist: genug Speicher und kein Telefon.
// Gibt bei Ablehnung den Grund zurück, damit die App ihn anzeigen kann.
export function lokalPruefen() {
  if (!window.WebAssembly) return { ok: false, grund: 'Browser unterstützt WebAssembly nicht.' };
  if (!window.isSecureContext) return { ok: false, grund: 'Nur über eine gesicherte Verbindung möglich.' };
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    return { ok: false, grund: 'Auf dem Handy zu speicherhungrig — der Server übernimmt.' };
  }
  const speicher = navigator.deviceMemory || 4;
  if (speicher < 4) return { ok: false, grund: `Zu wenig Arbeitsspeicher (${speicher} GB).` };
  return { ok: true, grund: '' };
}

export function lokalMoeglich() {
  return lokalPruefen().ok;
}

function skriptLaden(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Konnte ${src} nicht laden`));
    document.head.appendChild(s);
  });
}

async function ffmpegHolen(onStatus) {
  if (ffmpegInstanz) return ffmpegInstanz;
  if (ladeVersuch) return ladeVersuch;

  ladeVersuch = (async () => {
    onStatus?.('Audio-Werkzeug wird geladen (einmalig ca. 31 MB) …');
    await skriptLaden(WRAPPER);

    const { FFmpeg } = window.FFmpegWASM;
    const ffmpeg = new FFmpeg();

    // Wichtig: KEIN classWorkerURL übergeben.
    // Die Bibliothek erzeugt damit einen Modul-Worker, in dem importScripts()
    // verboten ist – genau daran scheiterte das Laden des Kerns bisher.
    // Ohne die Angabe nimmt sie ihr eigenes Arbeitsskript als klassischen Worker,
    // und weil alle Dateien hier aus derselben Herkunft kommen, ist das erlaubt.
    const absolut = (p) => new URL(p, window.location.origin).href;
    await ffmpeg.load({
      coreURL: absolut(CORE),
      wasmURL: absolut(WASM),
    });

    ffmpegInstanz = ffmpeg;
    return ffmpeg;
  })();

  try {
    return await ladeVersuch;
  } catch (e) {
    ladeVersuch = null;
    throw e;
  }
}

// Name des RNNoise-Modells INNERHALB des ffmpeg-Dateisystems. Die Datei wird
// vorher aus /assets/rnnoise.rnn geholt und dort abgelegt.
const RNN_DATEI = 'rnnoise.rnn';
const RNN_URL = '/assets/rnnoise.rnn';
let rnnGeladen = false;

// Das Modell einmal in das ffmpeg-Dateisystem legen. Geprüft: der mitgelieferte
// Kern kennt den Filter arnndn („Reduce noise from speech using Recurrent
// Neural Networks"), das Netz läuft also auch im Browser.
async function rnnoiseBereitstellen(ffmpeg, onStatus) {
  if (rnnGeladen) return true;
  onStatus?.('KI-Entrauschung wird vorbereitet (300 KB) …', null);
  const res = await fetch(RNN_URL, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`RNNoise-Modell nicht abrufbar (HTTP ${res.status}).`);
  const daten = new Uint8Array(await res.arrayBuffer());
  if (!daten.length) throw new Error('RNNoise-Modell kam leer zurück.');
  await ffmpeg.writeFile(RNN_DATEI, daten);
  rnnGeladen = true;
  return true;
}

// Dieselbe Filterkette wie auf dem Server – hier nur lokal gerechnet.
// Klassische Filter und RNNoise sind einzeln zuschaltbar.
function filterKette({ enhance, trimSilence }) {
  const teile = [];
  const klassisch = Boolean(enhance?.enabled);
  const rnn = Boolean(enhance?.rnnoise);

  if (klassisch || rnn) teile.push('highpass=f=90');
  if (rnn) teile.push(`arnndn=m=${RNN_DATEI}`);

  if (klassisch) {
    const s = Math.min(100, Math.max(0, enhance.strength)) / 100;
    teile.push(`afftdn=nr=${(6 + s * 22).toFixed(0)}:nf=-25:tn=1`);
    teile.push('lowpass=f=14000');
    teile.push('acompressor=threshold=-18dB:ratio=3:attack=20:release=250');
  }

  if (trimSilence?.enabled) {
    const stop = Math.max(0.5, trimSilence.seconds || 2);
    teile.push(`silenceremove=stop_periods=-1:stop_duration=${stop}:stop_threshold=-38dB:stop_silence=0.4`);
  }

  teile.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  return teile.join(',');
}

/**
 * Setzt die komplette Folge zusammen: Intro + alle Teile + Outro.
 * Läuft ebenfalls hier, damit der Server gar kein ffmpeg mehr braucht.
 * @param {Blob[]} teile bereits aufbereitete Aufnahme-Teile in Reihenfolge
 * @param {{introUrl?:string, outroUrl?:string}} rahmen
 * @returns {Promise<Blob>} fertige Folge als MP3
 */
export async function lokalZusammenbauen(teile, rahmen, onStatus) {
  const ffmpeg = await ffmpegHolen(onStatus);
  const dateien = [];

  // Intro und Outro holen, sofern hinterlegt. Fehler werden gemeldet statt
  // stillschweigend übergangen – sonst bliebe unklar, warum sie fehlen.
  const laden = async (url, name) => {
    if (!url) return null;
    let res;
    try {
      res = await fetch(url, { credentials: 'same-origin' });
    } catch (e) {
      throw new Error(`${name} konnte nicht geladen werden: ${e.message}`);
    }
    if (!res.ok) throw new Error(`${name} konnte nicht geladen werden (HTTP ${res.status}).`);
    const daten = new Uint8Array(await res.arrayBuffer());
    if (!daten.length) throw new Error(`${name} kam leer zurück.`);
    await ffmpeg.writeFile(name, daten);
    return name;
  };

  try {
    onStatus?.('Intro und Outro werden geholt …', null);
    const intro = await laden(rahmen.introUrl, 'intro' + endung(rahmen.introUrl));
    const outro = await laden(rahmen.outroUrl, 'outro' + endung(rahmen.outroUrl));

    onStatus?.('Teile werden vorbereitet …', null);
    for (let i = 0; i < teile.length; i++) {
      const name = `teil${i}.mp3`;
      await ffmpeg.writeFile(name, new Uint8Array(await teile[i].arrayBuffer()));
      dateien.push(name);
    }

    const reihenfolge = [intro, ...dateien, outro].filter(Boolean);
    const ausgang = 'folge.mp3';

    // Alle Segmente auf ein einheitliches Format bringen und aneinanderhängen.
    const eingaben = reihenfolge.flatMap((f) => ['-i', f]);
    const vorbereiten = reihenfolge
      .map((_, i) => `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo,aresample=44100[a${i}]`)
      .join(';');
    const zusammen = reihenfolge.map((_, i) => `[a${i}]`).join('');
    const filter = `${vorbereiten};${zusammen}concat=n=${reihenfolge.length}:v=0:a=1[out]`;

    onStatus?.('Folge wird zusammengebaut …', 0);
    await ffmpeg.exec([
      ...eingaben,
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      ausgang,
    ]);

    const ergebnis = await ffmpeg.readFile(ausgang);
    for (const f of [...reihenfolge, ausgang]) await ffmpeg.deleteFile(f).catch(() => {});
    onStatus?.('Folge fertig.', 100);
    return new Blob([ergebnis.buffer], { type: 'audio/mpeg' });
  } catch (e) {
    for (const f of dateien) await ffmpeg.deleteFile(f).catch(() => {});
    throw e;
  }
}

function endung(url) {
  const m = String(url || '').match(/\.(wav|mp3|m4a|aac|ogg)(\?|$)/i);
  return m ? `.${m[1].toLowerCase()}` : '.mp3';
}

/**
 * Bereitet eine Datei lokal auf und gibt die fertige MP3 zurück.
 * @param {File|Blob} datei
 * @param {{enhance:object, trimSilence:object}} einstellungen
 * @param {(text:string, prozent:number|null)=>void} onStatus
 * @returns {Promise<Blob>}
 */
export async function lokalAufbereiten(datei, einstellungen, onStatus) {
  const ffmpeg = await ffmpegHolen(onStatus);
  if (einstellungen?.enhance?.rnnoise) await rnnoiseBereitstellen(ffmpeg, onStatus);

  const eingang = 'eingang' + (datei.name?.match(/\.[a-z0-9]+$/i)?.[0] || '.webm');
  const ausgang = 'ausgang.mp3';

  // Dauer aus den Fortschrittsmeldungen ableiten, um Prozente zu zeigen.
  let dauer = 0;
  const logHandler = ({ message }) => {
    const m = message.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (m) dauer = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
  };
  ffmpeg.on('log', logHandler);

  const progHandler = ({ time }) => {
    // time kommt in Mikrosekunden
    const sek = (time || 0) / 1e6;
    const pct = dauer ? Math.min(99, Math.round((sek / dauer) * 100)) : null;
    onStatus?.('Wird auf diesem Gerät bearbeitet …', pct);
  };
  ffmpeg.on('progress', progHandler);

  try {
    onStatus?.('Datei wird eingelesen …', 0);
    const daten = new Uint8Array(await datei.arrayBuffer());
    await ffmpeg.writeFile(eingang, daten);

    onStatus?.('Wird auf diesem Gerät bearbeitet …', 0);
    await ffmpeg.exec([
      '-i', eingang,
      '-af', filterKette(einstellungen),
      '-ac', '2', '-ar', '44100', '-b:a', '128k',
      ausgang,
    ]);

    const ergebnis = await ffmpeg.readFile(ausgang);
    await ffmpeg.deleteFile(eingang).catch(() => {});
    await ffmpeg.deleteFile(ausgang).catch(() => {});

    onStatus?.('Fertig bearbeitet.', 100);
    return new Blob([ergebnis.buffer], { type: 'audio/mpeg' });
  } finally {
    ffmpeg.off('log', logHandler);
    ffmpeg.off('progress', progHandler);
  }
}

/**
 * Mischt die drei Adobe-Spuren (Sprache, Hintergrund, Hall) zu einer MP3.
 *
 * Adobe Enhance zerlegt eine Aufnahme in genau diese drei; hier werden sie mit
 * je eigener Lautstärke wieder zusammengeführt. 100 % heißt „so laut wie in der
 * Originalaufnahme", 0 % heißt „ganz raus".
 *
 * spuren: { sprache: File, hintergrund: File|null, hall: File|null }
 * pegel:  { sprache: 0..200, hintergrund: 0..200, hall: 0..200 }  (Prozent)
 */
export async function spurenMischen(spuren, pegel, onStatus) {
  const ffmpeg = await ffmpegHolen(onStatus);

  const liste = [
    { schluessel: 'sprache', datei: spuren.sprache },
    { schluessel: 'hintergrund', datei: spuren.hintergrund },
    { schluessel: 'hall', datei: spuren.hall },
  ].filter((s) => s.datei);

  if (!liste.length) throw new Error('Keine Spur ausgewählt.');

  const namen = [];
  const ausgang = 'mischung.mp3';
  try {
    for (let i = 0; i < liste.length; i++) {
      onStatus?.(`Spur ${i + 1} von ${liste.length} wird eingelesen …`, null);
      const name = `spur${i}${endung(liste[i].datei.name)}`;
      await ffmpeg.writeFile(name, new Uint8Array(await liste[i].datei.arrayBuffer()));
      namen.push(name);
    }

    // Je Spur die Lautstärke setzen, dann zusammenmischen. normalize=0 ist
    // wichtig: sonst senkt amix automatisch ab, sobald mehrere Spuren laufen —
    // die eingestellten Verhältnisse wären dann nicht mehr die eingestellten.
    const eingaben = namen.flatMap((n) => ['-i', n]);
    const pegelKette = liste
      .map((s, i) => {
        const wert = Math.max(0, Math.min(200, Number(pegel[s.schluessel] ?? 100))) / 100;
        return `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${wert.toFixed(3)}[v${i}]`;
      })
      .join(';');
    const eingehend = liste.map((_, i) => `[v${i}]`).join('');
    const filter = namen.length === 1
      ? `${pegelKette};[v0]anull[out]`
      : `${pegelKette};${eingehend}amix=inputs=${namen.length}:duration=longest:normalize=0[out]`;

    onStatus?.('Spuren werden gemischt …', 0);
    await ffmpeg.exec([
      ...eingaben,
      '-filter_complex', filter,
      '-map', '[out]',
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      ausgang,
    ]);

    const ergebnis = await ffmpeg.readFile(ausgang);
    onStatus?.('Mischung fertig.', 100);
    return new Blob([ergebnis.buffer], { type: 'audio/mpeg' });
  } finally {
    for (const n of [...namen, ausgang]) await ffmpeg.deleteFile(n).catch(() => {});
  }
}
