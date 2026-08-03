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

const CDN = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
const WRAPPER = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js';
const UTIL = 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js';

let ffmpegInstanz = null;
let ladeVersuch = null;

// Nur anbieten, wo es auch sinnvoll ist: genug Speicher und kein Telefon.
export function lokalMoeglich() {
  if (!window.WebAssembly) return false;
  const speicher = navigator.deviceMemory || 4;
  const mobil = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return speicher >= 4 && !mobil;
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
    await skriptLaden(UTIL);

    const { FFmpeg } = window.FFmpegWASM;
    const { toBlobURL } = window.FFmpegUtil;
    const ffmpeg = new FFmpeg();

    await ffmpeg.load({
      coreURL: await toBlobURL(`${CDN}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CDN}/ffmpeg-core.wasm`, 'application/wasm'),
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

// Dieselbe Filterkette wie auf dem Server – hier nur lokal gerechnet.
function filterKette({ enhance, trimSilence }) {
  const teile = [];

  if (enhance?.enabled) {
    const s = Math.min(100, Math.max(0, enhance.strength)) / 100;
    teile.push('highpass=f=90');
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
 * Bereitet eine Datei lokal auf und gibt die fertige MP3 zurück.
 * @param {File|Blob} datei
 * @param {{enhance:object, trimSilence:object}} einstellungen
 * @param {(text:string, prozent:number|null)=>void} onStatus
 * @returns {Promise<Blob>}
 */
export async function lokalAufbereiten(datei, einstellungen, onStatus) {
  const ffmpeg = await ffmpegHolen(onStatus);

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
