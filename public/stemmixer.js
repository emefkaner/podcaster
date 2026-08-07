'use strict';

// Live-Vorhören der drei Adobe-Spuren.
//
// Zum Ausprobieren der Regler jedes Mal eine MP3 zu rechnen wäre unzumutbar —
// bei zweistündigen Aufnahmen dauert das Minuten. Das Web-Audio-System des
// Browsers kann die Spuren dagegen parallel abspielen und die Lautstärke
// währenddessen ändern. Gerechnet wird erst, wenn der Mix sitzt.
//
// Bewusst ohne Abhängigkeiten und ohne Modul-Import: wird als klassisches
// Skript geladen und hängt sich an window.stemMixer.

(function () {
  let kontext = null;
  let puffer = { sprache: null, hintergrund: null, hall: null };
  let quellen = [];
  let regler = {};
  let startZeit = 0;      // Kontext-Zeit, zu der die Wiedergabe begann
  let startVersatz = 0;   // Position im Stück, an der begonnen wurde
  let laeuft = false;

  function ctx() {
    if (!kontext) kontext = new (window.AudioContext || window.webkitAudioContext)();
    return kontext;
  }

  // Datei einlesen und dekodieren. Das kann bei langen Aufnahmen dauern,
  // passiert aber nur einmal je Spur.
  async function spurLaden(name, datei) {
    if (!datei) { puffer[name] = null; return null; }
    const roh = await datei.arrayBuffer();
    puffer[name] = await ctx().decodeAudioData(roh);
    return puffer[name];
  }

  function laenge() {
    return Math.max(0, ...Object.values(puffer).filter(Boolean).map((b) => b.duration));
  }

  function position() {
    if (!laeuft) return startVersatz;
    return Math.min(laenge(), startVersatz + (ctx().currentTime - startZeit));
  }

  function stoppen() {
    // Erreichte Stelle festhalten, BEVOR laeuft auf false geht – sonst rechnet
    // position() sie nicht mehr aus und das Weiterhören begänne wieder bei null.
    if (laeuft) startVersatz = position();
    for (const q of quellen) { try { q.stop(); } catch {} }
    quellen = [];
    laeuft = false;
  }

  // Ab einer Position abspielen. Alle vorhandenen Spuren starten gleichzeitig,
  // jede über einen eigenen Lautstärkeregler.
  function abspielen(ab = 0, pegel = {}) {
    stoppen();
    const c = ctx();
    if (c.state === 'suspended') c.resume();

    startVersatz = Math.max(0, Math.min(laenge(), ab));
    startZeit = c.currentTime;
    regler = {};

    for (const [name, buf] of Object.entries(puffer)) {
      if (!buf) continue;
      const quelle = c.createBufferSource();
      quelle.buffer = buf;
      const gain = c.createGain();
      gain.gain.value = wert(pegel[name]);
      quelle.connect(gain).connect(c.destination);
      quelle.start(0, startVersatz);
      quellen.push(quelle);
      regler[name] = gain;
    }
    laeuft = quellen.length > 0;
    return laeuft;
  }

  function wert(prozent) {
    const p = Number(prozent);
    return Number.isFinite(p) ? Math.max(0, Math.min(200, p)) / 100 : 1;
  }

  // Lautstärke einer Spur im laufenden Betrieb ändern. Die kurze Rampe
  // verhindert das Knacken, das ein harter Sprung erzeugen würde.
  function pegelSetzen(name, prozent) {
    const g = regler[name];
    if (!g) return;
    const c = ctx();
    g.gain.setTargetAtTime(wert(prozent), c.currentTime, 0.015);
  }

  window.stemMixer = {
    spurLaden,
    abspielen,
    stoppen,
    pegelSetzen,
    laenge,
    position,
    get laeuft() { return laeuft; },
    geladen: (name) => Boolean(puffer[name]),
    zuruecksetzen() {
      stoppen();
      puffer = { sprache: null, hintergrund: null, hall: null };
      startVersatz = 0;
    },
  };
})();
