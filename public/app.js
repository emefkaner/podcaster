'use strict';

// ---------- Kleine Helfer ----------
const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const pageTitle = $('#pageTitle');

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}

// Upload mit Fortschrittsanzeige. fetch() meldet keinen Sendefortschritt,
// deshalb hier der klassische Weg über XMLHttpRequest.
function uploadMitFortschritt(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 401) { window.location.href = '/login'; return reject(new Error('unauth')); }
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error || `Fehler ${xhr.status}`));
    });
    xhr.addEventListener('error', () => reject(new Error('Verbindung unterbrochen')));
    xhr.addEventListener('abort', () => reject(new Error('Abgebrochen')));
    xhr.send(formData);
  });
}

function fmtMB(bytes) {
  return (bytes / 1048576).toFixed(1).replace('.', ',');
}

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (res.status === 401) { window.location.href = '/login'; throw new Error('unauth'); }
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const body = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || 'Fehler');
  return body;
}

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-DE',
    { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDur(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')} min`;
}
const STATUS_LABEL = { processing: 'Wird verarbeitet', draft: 'Entwurf', published: 'Veröffentlicht', error: 'Fehler' };

// ---------- Routing (sehr simpel) ----------
// Timer der Verarbeitungs-Anzeige, damit beim Seitenwechsel nichts weiterläuft.
let procTimer = null;
function stopProc() { if (procTimer) { clearTimeout(procTimer); procTimer = null; } }

function go(path) { history.pushState({}, '', path); render(); }
window.addEventListener('popstate', render);

function render() {
  stopProc(); // laufende Fortschritts-Abfrage einer anderen Seite beenden
  const p = location.pathname;
  if (p === '/settings') return renderSettings();
  const m = p.match(/^\/episode\/(.+)$/);
  if (m) return renderEpisode(decodeURIComponent(m[1]));
  return renderHome();
}

// Marke oben führt zurück zur Startseite. Läuft gerade eine Aufbereitung im
// Browser, wird vorher gefragt – sonst wäre die Arbeit weg.
$('#homeBtn')?.addEventListener('click', () => {
  if (location.pathname === '/') return;
  if (arbeitetGerade && !confirm('Die Aufbereitung läuft noch. Trotzdem zurück zur Startseite?')) return;
  go('/');
});

// ---------- Menü ----------
const menu = $('#menu'), menuBtn = $('#menuBtn');

function closeMenu() {
  menu.classList.add('hidden');
  menuBtn.setAttribute('aria-expanded', 'false');
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = menu.classList.toggle('hidden') === false;
  menuBtn.setAttribute('aria-expanded', String(open));
});

// Klick daneben oder Escape schließt das Menü.
document.addEventListener('click', (e) => {
  if (!menu.classList.contains('hidden') && !menu.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

menu.querySelectorAll('.menu-item').forEach((item) => {
  item.addEventListener('click', async () => {
    const target = item.dataset.go;
    closeMenu();
    if (target === 'logout') {
      await fetch('/logout', { method: 'POST' });
      window.location.href = '/login';
    } else if (target === 'feed') {
      window.open('/feed.xml', '_blank');
    } else {
      go(target);
    }
  });
});

// ================= START / AUFNEHMEN =================
async function renderHome() {
  pageTitle.textContent = 'podcast3r';
  view.innerHTML = `
    <div class="card recorder">
      <div class="timer" id="timer">00:00</div>
      <button id="recBtn" class="rec-btn" title="Aufnahme starten">●</button>
      <p class="muted" id="recHint">Tippen zum Aufnehmen</p>
    </div>

    <div class="divider"><span>oder</span></div>

    <div class="card">
      <label for="fileInput">Audiodateien hochladen</label>
      <input type="file" id="fileInput" accept="audio/*,video/*" multiple />
      <p class="field-hint">Mehrere Teile auf einmal möglich — z. B. Vorgespräch und Spoilerteil. Reihenfolge kannst du danach ändern.</p>
    </div>

    <div class="card">
      <label for="titleInput">Titel der Folge</label>
      <input type="text" id="titleInput" placeholder="z. B. CRIME 101" />

      <label style="display:flex;align-items:center;gap:10px;margin-top:16px;">
        <input type="checkbox" id="enhanceChk" checked style="width:auto;" />
        KI-Sprachoptimierung (gegen Hintergrundgeräusche)
      </label>
      <div id="strengthWrap">
        <label for="strength">Stärke: <span id="strengthVal">20</span>%</label>
        <input type="range" id="strength" min="0" max="100" value="20" style="width:100%;" />
        <p class="field-hint">Dezent (links) bis stark (rechts). 20 % ist der Standard und klingt natürlich;
          bei Auto oder Restaurant kannst du höher gehen. Wird es dumpf oder blechern, war es zu stark.</p>
      </div>

      <label style="display:flex;align-items:center;gap:10px;margin-top:14px;">
        <input type="checkbox" id="trimChk" checked style="width:auto;" />
        Lange Pausen automatisch kürzen
      </label>
      <div id="trimWrap">
        <label for="trimSec">Ab <span id="trimVal">2,0</span> Sekunden Stille</label>
        <input type="range" id="trimSec" min="5" max="60" value="20" step="5" style="width:100%;" />
        <p class="field-hint">Kürzt lange Denk- und Umschaltpausen, lässt Atempausen stehen.</p>
      </div>

      <label style="display:flex;align-items:center;gap:10px;margin-top:14px;" id="lokalLabel" class="hidden">
        <input type="checkbox" id="lokalChk" checked style="width:auto;" />
        Auf diesem Gerät bearbeiten <span class="muted">(viel schneller)</span>
      </label>
      <p class="field-hint hidden" id="lokalHint">
        Rauschunterdrückung und Pausenkürzung rechnet dein Rechner statt des kleinen Servers.
        Beim ersten Mal wird einmalig ein Audio-Werkzeug geladen (ca. 31 MB).
      </p>

      <button id="submitBtn" class="btn primary" disabled style="margin-top:16px;">
        Verarbeiten &amp; als Entwurf anlegen
      </button>
      <p class="field-hint">Intro + Aufnahme + Outro werden zusammengefügt, transkribiert und ein Infotext-Vorschlag erstellt. Veröffentlicht wird erst nach deiner Freigabe.</p>
    </div>

    <div class="list-head">
      <h2 class="section" style="margin:0;">Deine Folgen</h2>
      <div class="list-tools">
        <button class="btn ghost small" id="sortBtn" title="Sortierung umschalten">↓ Neueste zuerst</button>
        <button class="btn ghost small" id="foldBtn" title="Alle Jahre auf-/zuklappen">Alle aufklappen</button>
      </div>
    </div>
    <div id="episodeList"><p class="muted">Lade …</p></div>
  `;

  setupRecorder();
  setupUpload();
  loadEpisodes();
}

// ---- Recorder (MediaRecorder API) ----
let mediaRecorder, chunks = [], recordedBlob = null, timerInt, seconds = 0;
let localAudio = null; // wird bei Bedarf nachgeladen (ffmpeg als WebAssembly)
let letzterLokalFehler = ''; // zur Fehlersuche, falls die lokale Bearbeitung scheitert

// Läuft gerade eine Aufbereitung oder ein Upload? Dann darf die Seite weder
// automatisch neu laden noch unbemerkt geschlossen werden – die Arbeit im
// Browser wäre sonst verloren.
let arbeitetGerade = false;
window.addEventListener('beforeunload', (e) => {
  if (!arbeitetGerade) return;
  e.preventDefault();
  e.returnValue = '';
});

function setupRecorder() {
  const recBtn = $('#recBtn'), timer = $('#timer'), hint = $('#recHint');

  recBtn.addEventListener('click', async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        recordedBlob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        recBtn.classList.remove('recording');
        recBtn.textContent = '●';
        clearInterval(timerInt);
        hint.textContent = `Aufnahme fertig (${timer.textContent}). Titel eingeben und verarbeiten.`;
        $('#fileInput').value = '';
        updateSubmit();
      };
      mediaRecorder.start();
      seconds = 0; timer.textContent = '00:00';
      timerInt = setInterval(() => {
        seconds++;
        timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }, 1000);
      recBtn.classList.add('recording');
      recBtn.textContent = '■';
      hint.textContent = 'Aufnahme läuft … tippen zum Stoppen';
      recordedBlob = null;
    } catch (err) {
      toast('Mikrofon-Zugriff nicht möglich. Läuft die Seite über HTTPS?');
    }
  });
}

// ---- Upload / Absenden ----
function setupUpload() {
  const fileInput = $('#fileInput');
  const chk = $('#enhanceChk'), strength = $('#strength'), strengthVal = $('#strengthVal');
  const wrap = $('#strengthWrap');

  fileInput.addEventListener('change', () => { recordedBlob = null; updateSubmit(); });
  $('#titleInput').addEventListener('input', updateSubmit);
  strength.addEventListener('input', () => { strengthVal.textContent = strength.value; });
  chk.addEventListener('change', () => { wrap.style.opacity = chk.checked ? '1' : '0.4'; strength.disabled = !chk.checked; });

  // Lokale Bearbeitung: Zustand immer anzeigen, damit nachvollziehbar ist,
  // ob dein Rechner die Arbeit übernimmt oder der Server.
  const hinweis = $('#lokalHint');
  import('/localaudio.js').then((mod) => {
    localAudio = mod;
    const { ok, grund } = mod.lokalPruefen();
    $('#lokalLabel')?.classList.remove('hidden');
    hinweis?.classList.remove('hidden');
    if (ok) {
      hinweis.innerHTML = 'Rauschunterdrückung, Pausenkürzung und Zusammenbau rechnet dein Gerät '
        + 'statt des kleinen Servers. Beim ersten Mal wird einmalig ein Audio-Werkzeug geladen (ca. 31 MB).';
    } else {
      $('#lokalChk').checked = false;
      $('#lokalChk').disabled = true;
      hinweis.innerHTML = `<span class="error">Auf diesem Gerät nicht möglich:</span> ${escapeHtml(grund)}`;
    }
  }).catch((e) => {
    $('#lokalLabel')?.classList.remove('hidden');
    hinweis?.classList.remove('hidden');
    if ($('#lokalChk')) { $('#lokalChk').checked = false; $('#lokalChk').disabled = true; }
    hinweis.innerHTML = `<span class="error">Audio-Werkzeug nicht ladbar:</span> ${escapeHtml(e.message)}`;
  });

  const trimChk = $('#trimChk'), trimSec = $('#trimSec'), trimVal = $('#trimVal'), trimWrap = $('#trimWrap');
  const showTrim = () => { trimVal.textContent = (trimSec.value / 10).toFixed(1).replace('.', ','); };
  trimSec.addEventListener('input', showTrim);
  trimChk.addEventListener('change', () => {
    trimWrap.style.opacity = trimChk.checked ? '1' : '0.4';
    trimSec.disabled = !trimChk.checked;
  });

  $('#submitBtn').addEventListener('click', submitEpisode);
}

function updateSubmit() {
  const hasAudio = recordedBlob || $('#fileInput').files.length > 0;
  const hasTitle = $('#titleInput').value.trim().length > 0;
  $('#submitBtn').disabled = !(hasAudio && hasTitle);
}

async function submitEpisode() {
  const btn = $('#submitBtn');
  const files = $('#fileInput').files;
  if (!files.length && !recordedBlob) return;

  const enhance = { enabled: $('#enhanceChk').checked, strength: Number($('#strength').value) };
  const trimSilence = { enabled: $('#trimChk').checked, seconds: Number($('#trimSec').value) / 10 };
  const willFilter = enhance.enabled || trimSilence.enabled;
  const canLocal = $('#lokalChk')?.checked && localAudio && localAudio.lokalMoeglich();

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Arbeitet …';
  arbeitetGerade = true; // schützt vor Neuladen und versehentlichem Schließen

  // Fortschrittsbalken unter dem Knopf einblenden.
  if (!$('#uploadBar')) {
    btn.insertAdjacentHTML('afterend', `
      <div id="uploadBar" style="margin-top:10px;">
        <div class="progress"><div class="progress-fill" id="uploadFill"></div></div>
        <p class="field-hint" id="uploadInfo">Vorbereiten …</p>
      </div>`);
  }
  const fill = $('#uploadFill'), info = $('#uploadInfo');
  const setzeBalken = (pct, text) => {
    if (typeof pct === 'number') { fill.classList.remove('indeterminate'); fill.style.width = `${pct}%`; }
    else { fill.classList.add('indeterminate'); }
    info.textContent = text;
  };

  const quellen = files.length ? [...files] : [new File([recordedBlob], 'aufnahme.webm')];
  const fd = new FormData();
  fd.append('title', $('#titleInput').value.trim());

  let lokalGeschafft = false;
  let filterAufServer = willFilter; // wird false, wenn Optimierung übersprungen wird

  try {
    // 1) Wenn Optimierung gewünscht und auf dem Gerät möglich: dort komplett rechnen.
    if (willFilter && canLocal) {
      try {
        const fertige = [];
        let nr = 0;
        for (const datei of quellen) {
          nr++;
          const fertig = await localAudio.lokalAufbereiten(datei, { enhance, trimSilence },
            (text, pct) => setzeBalken(pct, `Teil ${nr} von ${quellen.length}: ${text}`));
          fertige.push([fertig, datei.name.replace(/\.[^.]+$/, '') + '.mp3']);
        }
        // Wichtig: die ORIGINALE ablegen, nicht die bearbeitete Fassung.
        // Nur so lässt sich die Optimierung später anders einstellen.
        quellen.forEach((datei) => fd.append('audio', datei, datei.name));

        const s = await api('/api/settings').catch(() => ({}));
        const folge = await localAudio.lokalZusammenbauen(
          fertige.map(([blob]) => blob),
          { introUrl: s.introUrl, outroUrl: s.outroUrl },
          (text, pct) => setzeBalken(pct, text)
        );
        fd.append('fertig', folge, 'folge.mp3');
        fd.append('lokalBearbeitet', 'true');
        lokalGeschafft = true;
      } catch (e) {
        // Nicht still den langsamen Server-Weg nehmen, sondern nachfragen.
        console.error('Lokale Bearbeitung fehlgeschlagen:', e);
        letzterLokalFehler = (e && e.message) ? e.message : String(e);
        const weiter = confirm(
          'Die Optimierung auf diesem Gerät ist nicht möglich:\n' + letzterLokalFehler +
          '\n\nOhne Rauschunterdrückung/Pausenkürzung fortfahren?\n' +
          'Der Server fügt dann nur Intro und Outro an – das geht schnell.');
        if (!weiter) throw new Error('__abgebrochen__');
        filterAufServer = false;
      }
    } else if (willFilter && !canLocal) {
      // Optimierung gewünscht, aber auf dem Gerät gar nicht verfügbar.
      const weiter = confirm(
        'Rauschunterdrückung/Pausenkürzung ist auf diesem Gerät nicht möglich' +
        (letzterLokalFehler ? ` (${letzterLokalFehler})` : '') + '.\n\n' +
        'Ohne diese Optimierung fortfahren?\n' +
        'Der Server fügt dann nur Intro und Outro an – das geht schnell.');
      if (!weiter) throw new Error('__abgebrochen__');
      filterAufServer = false;
    }

    // 2) Nicht auf dem Gerät gebaut? Rohteile hochladen. Filter laufen auf dem
    //    Server nur, wenn ausdrücklich gewünscht – sonst wird bloß zusammengefügt.
    if (!lokalGeschafft) {
      for (const datei of quellen) fd.append('audio', datei, datei.name);
      fd.append('enhance', (filterAufServer && enhance.enabled) ? 'true' : 'false');
      fd.append('strength', String(enhance.strength));
      fd.append('trimSilence', (filterAufServer && trimSilence.enabled) ? 'true' : 'false');
      fd.append('trimSeconds', String(trimSilence.seconds));
    }

    const ep = await uploadMitFortschritt('/api/episodes', fd, (geladen, gesamt) => {
      const pct = Math.round((geladen / gesamt) * 100);
      setzeBalken(pct, pct < 100
        ? `Wird hochgeladen: ${pct} % · ${fmtMB(geladen)} von ${fmtMB(gesamt)} MB`
        : 'Hochgeladen — Verarbeitung startet …');
    });
    arbeitetGerade = false;
    toast('Hochgeladen – Verarbeitung läuft.');
    go(`/episode/${encodeURIComponent(ep.id)}`);
  } catch (err) {
    arbeitetGerade = false;
    if (err.message !== '__abgebrochen__') toast('Fehler: ' + err.message, 4500);
    $('#uploadBar')?.remove();
    btn.disabled = false;
    btn.textContent = 'Verarbeiten & als Entwurf anlegen';
  }
}

// Sortierrichtung merken, damit sie beim nächsten Besuch noch stimmt.
let episodesCache = [];
let sortNeuesteZuerst = localStorage.getItem('sortAlt') !== '1';

async function loadEpisodes() {
  const list = $('#episodeList');
  try {
    episodesCache = await api('/api/episodes');
    if (!episodesCache.length) { list.innerHTML = '<p class="muted">Noch keine Folgen.</p>'; return; }
    zeichneFolgen();

    $('#sortBtn').addEventListener('click', () => {
      sortNeuesteZuerst = !sortNeuesteZuerst;
      localStorage.setItem('sortAlt', sortNeuesteZuerst ? '0' : '1');
      zeichneFolgen();
    });

    $('#foldBtn').addEventListener('click', () => {
      const jahre = list.querySelectorAll('details.jahr');
      const alleOffen = [...jahre].every((d) => d.open);
      jahre.forEach((d) => { d.open = !alleOffen; });
      $('#foldBtn').textContent = alleOffen ? 'Alle aufklappen' : 'Alle zuklappen';
    });
  } catch (err) {
    list.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

function zeichneFolgen() {
  const list = $('#episodeList');
  $('#sortBtn').textContent = sortNeuesteZuerst ? '↓ Neueste zuerst' : '↑ Älteste zuerst';

  const datum = (e) => new Date(e.publishedAt || e.createdAt);
  const sortiert = [...episodesCache].sort((a, b) =>
    sortNeuesteZuerst ? datum(b) - datum(a) : datum(a) - datum(b));

  // Nach Jahren gruppieren, Reihenfolge folgt der Sortierung.
  const jahre = new Map();
  for (const e of sortiert) {
    const j = datum(e).getFullYear() || '—';
    if (!jahre.has(j)) jahre.set(j, []);
    jahre.get(j).push(e);
  }

  // Das zuerst gezeigte Jahr bleibt offen, die übrigen sind eingeklappt.
  let erstes = true;
  list.innerHTML = [...jahre.entries()].map(([jahr, folgen]) => {
    const offen = erstes ? ' open' : '';
    erstes = false;
    return `
      <details class="jahr"${offen}>
        <summary>
          <span class="jahr-zahl">${jahr}</span>
          <span class="jahr-anzahl">${folgen.length} ${folgen.length === 1 ? 'Folge' : 'Folgen'}</span>
        </summary>
        <div class="jahr-inhalt">
          ${folgen.map(folgeZeile).join('')}
        </div>
      </details>`;
  }).join('');

  list.querySelectorAll('.episode').forEach((el) =>
    el.addEventListener('click', () => go(`/episode/${encodeURIComponent(el.dataset.id)}`)));
}

function folgeZeile(e) {
  const geplant = e.status === 'published' && new Date(e.publishedAt).getTime() > Date.now();
  return `
    <div class="episode" data-id="${e.id}">
      <div style="min-width:0;">
        <h3>${escapeHtml(e.title)}</h3>
        <div class="meta">${fmtDate(e.publishedAt || e.createdAt)}${e.duration ? ' · ' + fmtDur(e.duration) : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex:none;">
        <span class="badge ${geplant ? 'draft' : e.status}">${geplant ? 'Geplant' : (STATUS_LABEL[e.status] || e.status)}</span>
        ${e.nummer ? `<span class="epnum" title="Interne Folgennummer">#${e.nummer}</span>` : ''}
      </div>
    </div>`;
}

// ================= EPISODE-DETAIL / REVIEW =================
async function renderEpisode(id) {
  // Marke bleibt oben stehen, die Seite ergibt sich aus dem Inhalt.
  view.innerHTML = '<p class="muted">Lade …</p>';
  let ep;
  try {
    ep = await api(`/api/episodes/${encodeURIComponent(id)}`);
  } catch (err) { view.innerHTML = `<p class="error">${err.message}</p>`; return; }

  // Solange in Verarbeitung: Statusanzeige + Polling.
  if (ep.status === 'processing') {
    const schritte = [
      'Aufnahmen werden geladen',
      'Audio wird zusammengebaut',
      'Fertige Folge wird gespeichert',
      'Aufnahme wird transkribiert',
      'Infotext wird geschrieben',
    ];

    // Grundgerüst EINMAL bauen; danach nur noch einzelne Werte aktualisieren –
    // dadurch kein Neuaufbau der Seite und kein Flackern.
    view.innerHTML = `
      <button class="back" onclick="history.back()">← Zurück</button>
      <div class="card">
        <h3 style="margin-top:0;">${escapeHtml(ep.title)}</h3>
        <div class="progress" style="margin:14px 0 8px;">
          <div class="progress-fill" id="procFill"></div>
        </div>
        <p style="margin:0;font-weight:600;" id="procPhase"></p>
        <ol class="steps" id="procSteps">
          ${schritte.map((s, i) => `<li id="procStep${i}"><span class="mark">○</span> ${s}</li>`).join('')}
        </ol>
        <p class="field-hint">Läuft im Hintergrund weiter — du kannst die Seite verlassen.</p>
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn ghost small" id="stuckBtn">Hängt fest?</button>
          <button class="btn danger small" id="delProc">Folge löschen</button>
        </div>
      </div>`;

    $('#delProc').addEventListener('click', () => deleteEpisode(id));
    $('#stuckBtn').addEventListener('click', async () => {
      if (!confirm('Verarbeitung als abgebrochen markieren?\n\nDanach kannst du sie neu starten oder die Folge löschen.')) return;
      stopProc();
      await api(`/api/episodes/${encodeURIComponent(id)}/abbrechen`, { method: 'POST' });
      renderEpisode(id);
    });

    const zeichneStand = (e) => {
      const f = e.fortschritt || {};
      const hatProzent = typeof f.prozent === 'number' && f.prozent > 0;
      const fill = $('#procFill');
      if (fill) {
        fill.classList.toggle('indeterminate', !hatProzent);
        fill.style.width = hatProzent ? `${f.prozent}%` : '';
      }
      const phase = $('#procPhase');
      if (phase) phase.innerHTML = `${escapeHtml(f.phase || 'Wird vorbereitet …')}`
        + (hatProzent ? ` <span class="muted">${f.prozent} %</span>` : '');
      const aktuell = schritte.findIndex((s) => (f.phase || '').startsWith(s));
      schritte.forEach((_, i) => {
        const li = $(`#procStep${i}`);
        if (!li) return;
        const fertig = i < aktuell, aktiv = i === aktuell;
        li.className = fertig ? 'fertig' : aktiv ? 'aktiv' : '';
        const mark = li.querySelector('.mark');
        if (mark) mark.innerHTML = fertig ? '✓' : aktiv ? '<span class="spinner"></span>' : '○';
      });
    };

    zeichneStand(ep);

    // Sanftes Nachfragen ohne Neuaufbau. Erst bei fertiger/fehlerhafter Folge
    // einmal komplett neu zeichnen.
    const poll = async () => {
      let fresh;
      try { fresh = await api(`/api/episodes/${encodeURIComponent(id)}`); }
      catch { procTimer = setTimeout(poll, 4000); return; }
      if (fresh.status !== 'processing') { stopProc(); return renderEpisode(id); }
      zeichneStand(fresh);
      procTimer = setTimeout(poll, 4000);
    };
    procTimer = setTimeout(poll, 4000);
    return;
  }

  if (ep.status === 'error') {
    const hatTeile = (ep.parts || []).length > 0;
    view.innerHTML = `
      <button class="back" onclick="history.back()">← Zurück</button>
      <div class="card">
        <h3 style="margin-top:0;">${escapeHtml(ep.title)}</h3>
        <p class="error">${escapeHtml(ep.error || 'Verarbeitung fehlgeschlagen.')}</p>
        ${hatTeile ? `<p class="field-hint">${ep.parts.length} Aufnahme-Teil(e) sind noch vorhanden.</p>` : ''}
        <div class="btn-row" style="margin-top:12px;">
          ${hatTeile ? '<button class="btn primary" id="retryBtn">Erneut versuchen</button>' : ''}
          <button class="btn danger" id="delBtn">Löschen</button>
        </div>
      </div>`;
    $('#delBtn').addEventListener('click', () => deleteEpisode(id));
    $('#retryBtn')?.addEventListener('click', async () => {
      await api(`/api/episodes/${encodeURIComponent(id)}/build`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ withText: true }),
      });
      toast('Neuer Versuch gestartet.');
      renderEpisode(id);
    });
    return;
  }

  const audioUrl = ep.audioUrl || '';
  const isPublished = ep.status === 'published';
  // Eingeplant heißt: veröffentlicht, aber der Zeitpunkt liegt noch vorn.
  const istGeplant = isPublished && new Date(ep.publishedAt).getTime() > Date.now();
  view.innerHTML = `
    <button class="back" onclick="history.back()">← Zurück</button>
    <div class="card">
      <span class="badge ${ep.status}">${STATUS_LABEL[ep.status]}</span>
      ${ep.nummer ? `<span class="epnum" title="Interne Folgennummer – erscheint nicht im Feed">#${ep.nummer}</span>` : ''}
      <label for="epTitle">Titel</label>
      <input type="text" id="epTitle" value="${escapeAttr(ep.title)}" />

      <label for="epDesc">Infotext (KI-Vorschlag – frei änderbar)</label>
      <textarea id="epDesc">${escapeHtml(ep.description || '')}</textarea>
      <p class="field-hint">Das ist der Text, der später im Podcast erscheint. Prüfe/ändere ihn und speichere.</p>
      ${ep.transcriptError
        ? `<p class="error" style="margin-top:6px;">Kein Transkript entstanden:
             ${escapeHtml(ep.transcriptError)}</p>`
        : ''}
      ${ep.descriptionError
        ? `<p class="error" style="margin-top:6px;">Beim Zusammenbauen kam kein Infotext zustande:
             ${escapeHtml(ep.descriptionError)}<br>Mit „↻ Text" kannst du es erneut versuchen.</p>`
        : ''}

      <div class="btn-row" style="margin-top:12px;">
        <button class="btn primary" id="saveBtn">💾 Änderungen speichern</button>
        <button class="btn ghost" id="regenBtn" title="Text von der KI neu schreiben lassen">↻ Text</button>
        ${(ep.parts || []).length
          ? `<button class="btn ghost" id="sttBtn" title="Aufnahme neu abhören und mitschreiben lassen">🎧 Transkript nachholen</button>`
          : ''}
      </div>
      <p class="field-hint" id="saveHint">Alles gespeichert.</p>
      <div id="sttInfo"></div>

      ${ep.descriptionSuggestion?.trim() && ep.descriptionSuggestion.trim() !== (ep.description || '').trim()
        ? `<div style="margin-top:14px;padding:12px;border:1px solid var(--border);border-left:3px solid var(--pink);border-radius:0 10px 10px 0;background:var(--surface);">
             <b style="font-size:.92rem;">Es liegt ein neuerer KI-Vorschlag bereit</b>
             <p style="white-space:pre-wrap;margin:8px 0;font-size:.9rem;">${escapeHtml(ep.descriptionSuggestion)}</p>
             <div class="btn-row">
               <button class="btn small" id="useSuggest">In den Infotext übernehmen</button>
               <button class="btn ghost small" id="dropSuggest">Verwerfen</button>
             </div>
           </div>`
        : ''}
      ${!ep.transcript?.trim() ? `
        <p class="field-hint">Kein Transkript vorhanden — „↻ Text" recherchiert dann den Film
          anhand des Titels und schreibt daraus. Optional kannst du Stichworte mitgeben:</p>
        <input type="text" id="descHints" placeholder="optional: z. B. langer Spoilerteil, Matthew war begeistert" />` : ''}

      <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px;margin-top:20px;">
        <b style="font-size:.95rem;">🎚️ Klang nachjustieren</b>
        <p class="field-hint" style="margin-top:4px;">Wird immer aus den <b>Originalaufnahmen</b> neu berechnet — du kannst also beliebig oft probieren, ohne Qualität zu verlieren.</p>

        <p class="field-hint" style="margin:8px 0 12px;padding:8px 10px;border-left:3px solid var(--purple);background:var(--surface);border-radius:0 8px 8px 0;">
          <b>Aktuelle Fassung:</b> ${klangStandText(ep)}
        </p>

        <label style="display:flex;align-items:center;gap:10px;">
          <input type="checkbox" id="reEnh" ${ep.enhance?.enabled ? 'checked' : ''} style="width:auto;" />
          Rauschunterdrückung
        </label>
        <label for="reStrength">Stärke: <span id="reStrengthVal">${ep.enhance?.strength ?? 20}</span>%</label>
        <input type="range" id="reStrength" min="0" max="100" value="${ep.enhance?.strength ?? 20}" style="width:100%;" />
        <p class="field-hint">Klingt es dumpf oder blechern, war es zu stark — dann runter auf 20–30 %.</p>

        <label style="display:flex;align-items:center;gap:10px;margin-top:10px;">
          <input type="checkbox" id="reTrim" ${ep.trimSilence?.enabled ? 'checked' : ''} style="width:auto;" />
          Lange Pausen kürzen (ab <span id="reTrimVal">${(ep.trimSilence?.seconds ?? 2).toFixed(1).replace('.', ',')}</span> s)
        </label>
        <input type="range" id="reTrimSec" min="5" max="60" step="5" value="${Math.round((ep.trimSilence?.seconds ?? 2) * 10)}" style="width:100%;" />

        <button class="btn" id="reBtn" style="margin-top:10px;">Neu berechnen</button>
        <div id="reInfo"></div>
      </div>

      <label style="margin-top:20px;">Aufnahme-Teile (Reihenfolge = Abspielreihenfolge)</label>
      <div id="partList">${renderParts(ep)}</div>
      <input type="file" id="addParts" accept="audio/*,video/*" multiple style="margin-top:8px;" />
      <button class="btn ghost small" id="addPartsBtn" style="margin-top:8px;">Teile hinzufügen</button>
      ${ep.needsRebuild
        ? `<div style="margin-top:12px;padding:12px;background:var(--warn-soft,#3a2f14);border:1px solid var(--border);border-radius:10px;">
             <b>Änderungen noch nicht übernommen.</b>
             <p class="field-hint" style="margin:4px 0 8px;">Die fertige Folge unten entspricht noch dem alten Stand.</p>
             <button class="btn primary" id="rebuildBtn">Folge neu zusammenbauen</button>
           </div>`
        : ''}

      <label style="margin-top:18px;">Folgen-Bild ${ep.imageUrl ? '' : '<span class="muted">(ohne: Podcast-Cover wird verwendet)</span>'}</label>
      ${ep.imageUrl ? `<img src="${escapeAttr(ep.imageUrl)}" alt="Folgen-Bild" style="width:120px;height:120px;object-fit:cover;border-radius:12px;display:block;margin-bottom:10px;" />` : ''}

      <label>Bild von einer Adresse übernehmen</label>
      <input type="text" id="epImageUrl" placeholder="https://… (Adresse des fertigen Covers einfügen)" />
      <button class="btn" id="epImageUrlBtn" style="margin-top:8px;">Übernehmen</button>
      <p class="field-hint">Die App lädt das Bild selbst herunter — kein Zwischenspeichern auf dem Rechner nötig.</p>

      <label>Oder eigenes Bild hochladen</label>
      <input type="file" id="epImage" accept="image/*" />
      <button class="btn ghost small" id="epImageBtn" style="margin-top:8px;">Bild speichern</button>

      <label style="margin-top:18px;">Fertige Folge anhören (Intro + Audio + Outro)</label>
      <audio controls src="${audioUrl}"></audio>
    </div>

    <div class="card">
      <h2 class="section" style="margin-top:0;">1) Eigener RSS-Feed</h2>
      ${isPublished && istGeplant
        ? `<p><span class="badge draft">Geplant</span> Erscheint am <b>${fmtDateTime(ep.publishedAt)}</b>
             und taucht bis dahin nicht im Feed auf.</p>
           <button class="btn danger" id="unpubBtn" style="margin-top:10px;">Planung zurücknehmen</button>`
        : isPublished
        ? `<p class="success">✓ Diese Folge ist im RSS-Feed und wird von Spotify abgeholt.</p>
           <button class="btn danger" id="unpubBtn">Aus Feed zurückziehen</button>`
        : `<p class="field-hint" style="margin-top:0;">Die Folge bleibt Entwurf, bis du dich hier entscheidest.
             Speichern kannst du jederzeit oben — auch mehrfach, etwa um später ein anderes Cover einzusetzen.</p>
           <button class="btn primary" id="pubBtn" style="margin-top:10px;">Jetzt veröffentlichen</button>

           <label style="margin-top:16px;">Oder für später einplanen</label>
           <input type="datetime-local" id="planZeit" style="width:100%;" />
           <button class="btn" id="planBtn" style="margin-top:8px;">Zu diesem Zeitpunkt veröffentlichen</button>
           <p class="field-hint">Die Folge erscheint dann automatisch im Feed — du musst nichts weiter tun.</p>`}
    </div>

    <div class="card">
      <h2 class="section" style="margin-top:0;">2) Direkt zu Spotify Podcasters (Anchor)</h2>
      ${ep.anchorStatus === 'pushed'
        ? `<p class="success">✓ An Spotify Podcasters gepusht${ep.anchorPushedAt ? ' am ' + fmtDate(ep.anchorPushedAt) : ''}.</p>`
        : ''}
      ${ep.anchorStatus === 'failed'
        ? `<p class="error">Letzter Push fehlgeschlagen: ${escapeHtml(ep.anchorError || '')}</p>` : ''}
      <button class="btn" id="anchorBtn">In deinen bestehenden Podcast pushen</button>
      <p class="field-hint">Nutzt Browser-Automation (inoffiziell). Läuft in deine bestehende cinespasten-Show – Follower bleiben. Kann bei UI-Änderungen von Spotify mal haken.</p>
      <button class="btn ghost small" id="delBtn2" style="margin-top:12px;">Folge löschen</button>
    </div>

    ${ep.transcript ? `<details class="card"><summary>Transkript anzeigen</summary><p class="muted" style="white-space:pre-wrap;margin-top:10px;">${escapeHtml(ep.transcript)}</p></details>` : ''}
  `;

  // Ungespeicherte Änderungen sichtbar machen und beim Verlassen warnen –
  // sonst ist unklar, ob Titel und Text schon gesichert sind.
  const hinweis = $('#saveHint');
  let ungespeichert = false;
  const markiereGeaendert = () => {
    ungespeichert = true;
    hinweis.innerHTML = '<span style="color:var(--warn);">● Nicht gespeicherte Änderungen</span>';
  };
  const markiereGesichert = () => {
    ungespeichert = false;
    hinweis.innerHTML = '<span class="success">✓ Alles gespeichert</span>';
  };
  $('#epTitle').addEventListener('input', markiereGeaendert);
  $('#epDesc').addEventListener('input', markiereGeaendert);
  markiereGesichert();

  const speichern = async () => {
    await api(`/api/episodes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: $('#epTitle').value, description: $('#epDesc').value }),
    });
    markiereGesichert();
  };

  $('#saveBtn').addEventListener('click', async () => {
    const btn = $('#saveBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Speichert …';
    try { await speichern(); toast('Gespeichert ✓'); }
    catch (e) { toast('Fehler: ' + e.message); }
    finally { btn.disabled = false; btn.innerHTML = '💾 Änderungen speichern'; }
  });

  // Beim Zurückgehen nicht kommentarlos verwerfen.
  $('.back')?.addEventListener('click', (e) => {
    if (ungespeichert && !confirm('Es gibt nicht gespeicherte Änderungen. Trotzdem zurück?')) {
      e.preventDefault(); e.stopPropagation();
    }
  }, true);

  wireParts(id, ep);
  wireNachjustieren(id, ep);

  $('#epImageUrlBtn')?.addEventListener('click', async () => {
    const url = $('#epImageUrl').value.trim();
    if (!url) return toast('Bitte eine Adresse einfügen.');
    const btn = $('#epImageUrlBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Lädt …';
    try {
      await api(`/api/episodes/${encodeURIComponent(id)}/image-from-url`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      toast('Cover übernommen ✓');
      renderEpisode(id);
    } catch (e) {
      toast('Fehler: ' + e.message, 5000);
      btn.disabled = false; btn.textContent = 'Übernehmen';
    }
  });

  $('#epImageBtn').addEventListener('click', async () => {
    const file = $('#epImage').files[0];
    if (!file) return toast('Bitte zuerst ein Bild auswählen.');
    const btn = $('#epImageBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Lädt …';
    const fd = new FormData();
    fd.append('image', file);
    try {
      await api(`/api/episodes/${encodeURIComponent(id)}/image`, { method: 'POST', body: fd });
      toast('Bild gespeichert.');
      renderEpisode(id);
    } catch (e) {
      toast('Fehler: ' + e.message);
      btn.disabled = false; btn.textContent = 'Bild speichern';
    }
  });

  // Text neu vorschlagen lassen. Ohne Transkript wird erst nach Stichworten gefragt.
  async function neuenTextHolen(hinweise, btn) {
    const label = btn.textContent;
    const feld = $('#epDesc');
    const vorher = feld.value;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api(`/api/episodes/${encodeURIComponent(id)}/describe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hinweise }),
      });
      const neu = (r.vorschlag || '').trim();
      if (!neu) throw new Error('Die KI hat keinen Text geliefert.');

      feld.value = neu;
      markiereGeaendert(); // Vorschlag ist noch nicht gesichert

      // Sichtbar machen, dass sich etwas getan hat: hinscrollen und kurz
      // hervorheben. Sonst bleibt unklar, ob überhaupt etwas passiert ist.
      feld.scrollIntoView({ behavior: 'smooth', block: 'center' });
      feld.classList.add('blitz');
      setTimeout(() => feld.classList.remove('blitz'), 1200);

      toast(neu === vorher.trim()
        ? 'Die KI hat denselben Text noch einmal geliefert.'
        : 'Neuer Vorschlag eingesetzt — prüfen und speichern.', 4000);
    } catch (e) {
      toast('Kein neuer Text: ' + e.message, 6000);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  // Ohne Transkript wird recherchiert; etwaige Stichworte fließen mit ein.
  $('#regenBtn').addEventListener('click', () => {
    neuenTextHolen(($('#descHints')?.value || '').trim(), $('#regenBtn'));
  });

  // Bereitliegenden Vorschlag übernehmen oder wegräumen.
  $('#useSuggest')?.addEventListener('click', () => {
    $('#epDesc').value = ep.descriptionSuggestion;
    markiereGeaendert();
    $('#epDesc').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#epDesc').classList.add('blitz');
    setTimeout(() => $('#epDesc').classList.remove('blitz'), 1200);
    toast('Übernommen — noch speichern.', 3500);
  });
  $('#dropSuggest')?.addEventListener('click', async () => {
    await api(`/api/episodes/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ descriptionSuggestion: '' }),
    });
    renderEpisode(id);
  });

  // Transkript nachholen: läuft auf dem Server weiter, deshalb nachfragen.
  $('#sttBtn')?.addEventListener('click', async () => {
    const btn = $('#sttBtn'), info = $('#sttInfo');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Hört zu …';
    info.innerHTML = '<p class="field-hint">Die Aufnahme wird abgehört. Bei langen Folgen dauert das einige Minuten — '
                   + 'du kannst die Seite ruhig verlassen.</p>';
    try {
      await api(`/api/episodes/${encodeURIComponent(id)}/transcribe`, { method: 'POST' });
      warteAufTranskript(id);
    } catch (e) {
      info.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
      btn.disabled = false; btn.textContent = '🎧 Transkript nachholen';
    }
  });

  // Läuft beim Öffnen schon eins? Dann direkt weiterverfolgen.
  if (ep.textLaeuft) {
    const btn = $('#sttBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Hört zu …'; }
    warteAufTranskript(id);
  }

  // Vor jedem Veröffentlichen die aktuellen Texte sichern.
  const texteSichern = () => api(`/api/episodes/${encodeURIComponent(id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: $('#epTitle').value, description: $('#epDesc').value }),
  });

  $('#pubBtn')?.addEventListener('click', async () => {
    await texteSichern();
    if (!confirm('Folge jetzt veröffentlichen? Sie erscheint dann im RSS-Feed und Spotify holt sie automatisch ab.')) return;
    await api(`/api/episodes/${encodeURIComponent(id)}/publish`, { method: 'POST' });
    toast('Veröffentlicht ✓');
    renderEpisode(id);
  });

  $('#planBtn')?.addEventListener('click', async () => {
    const wert = $('#planZeit').value;
    if (!wert) return toast('Bitte einen Zeitpunkt wählen.');
    const zeit = new Date(wert);
    if (zeit.getTime() <= Date.now()) return toast('Der Zeitpunkt muss in der Zukunft liegen.');
    await texteSichern();
    if (!confirm(`Folge für ${zeit.toLocaleString('de-DE')} einplanen?\n\nSie erscheint erst dann im Feed.`)) return;
    await api(`/api/episodes/${encodeURIComponent(id)}/publish`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zeitpunkt: zeit.toISOString() }),
    });
    toast('Eingeplant ✓');
    renderEpisode(id);
  });

  if ($('#unpubBtn')) $('#unpubBtn').addEventListener('click', async () => {
    if (!confirm('Folge aus dem Feed zurückziehen?')) return;
    await api(`/api/episodes/${encodeURIComponent(id)}/unpublish`, { method: 'POST' });
    toast('Zurückgezogen.');
    renderEpisode(id);
  });

  $('#anchorBtn').addEventListener('click', async () => {
    if (!confirm('Diese Folge jetzt direkt in deinen bestehenden Spotify-Podcasters-Account (Anchor) hochladen und veröffentlichen?')) return;
    const btn = $('#anchorBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Pushe … (kann 1–2 Min. dauern)';
    try {
      await api(`/api/episodes/${encodeURIComponent(id)}/push-anchor`, { method: 'POST' });
      toast('An Spotify Podcasters gepusht ✓');
      renderEpisode(id);
    } catch (e) {
      toast('Push fehlgeschlagen: ' + e.message, 5000);
      btn.disabled = false; btn.textContent = 'In deinen bestehenden Podcast pushen';
    }
  });

  $('#delBtn2').addEventListener('click', () => deleteEpisode(id));
}

// Fragt regelmäßig nach, ob das Transkript fertig ist. Der Vorgang läuft auf
// dem Server – die Seite darf zwischendurch geschlossen werden.
function warteAufTranskript(id) {
  stopProc();
  procTimer = setTimeout(async () => {
    let ep;
    try { ep = await api(`/api/episodes/${encodeURIComponent(id)}`); } catch { return; }
    if (ep.textLaeuft) return warteAufTranskript(id);
    toast(ep.transcript
      ? 'Transkript fertig — Vorschlag steht bereit.'
      : `Kein Transkript: ${ep.transcriptError || 'unbekannter Grund'}`, 6000);
    renderEpisode(id);
  }, 4000);
}

// Beschreibt in einem Satz, mit welchen Werten die aktuell hörbare Fassung
// gerechnet wurde. Die Regler darunter lassen sich verstellen — dieser Satz
// bleibt stehen und zeigt weiter den tatsächlichen Stand der Audiodatei.
function klangStandText(ep) {
  const teile = [];
  if (ep.enhance?.enabled) teile.push(`${ep.enhance.strength ?? 20} % Rauschunterdrückung`);
  else teile.push('ohne Rauschunterdrückung');

  if (ep.trimSilence?.enabled) {
    teile.push(`Pausen ab ${(ep.trimSilence.seconds ?? 2).toFixed(1).replace('.', ',')} s gekürzt`);
  } else {
    teile.push('Pausen unverändert');
  }

  const wann = ep.klangStand ? ` · zuletzt berechnet ${fmtDateTime(ep.klangStand)}` : '';
  return `${teile.join(', ')}${wann}`;
}

// Klang nachjustieren: Originale holen, im Browser neu bearbeiten, Folge ersetzen.
function wireNachjustieren(id, ep) {
  const st = $('#reStrength'), tr = $('#reTrimSec'), info = $('#reInfo'), btn = $('#reBtn');
  if (!btn) return;

  st.addEventListener('input', () => { $('#reStrengthVal').textContent = st.value; });
  tr.addEventListener('input', () => {
    $('#reTrimVal').textContent = (tr.value / 10).toFixed(1).replace('.', ',');
  });

  btn.addEventListener('click', async () => {
    if (!localAudio?.lokalMoeglich()) {
      return toast('Neu berechnen geht nur auf einem Rechner, nicht am Handy.', 4500);
    }
    const teile = ep.parts || [];
    if (!teile.length) return toast('Keine Originalaufnahmen vorhanden.');

    const enhance = { enabled: $('#reEnh').checked, strength: Number(st.value) };
    const trimSilence = { enabled: $('#reTrim').checked, seconds: Number(tr.value) / 10 };

    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Rechnet …';
    info.innerHTML = `<div class="progress" style="margin-top:10px;"><div class="progress-fill" id="reFill"></div></div>
                      <p class="field-hint" id="reText">Originale werden geholt …</p>`;
    const setz = (pct, text) => {
      const f = $('#reFill');
      if (typeof pct === 'number') { f.classList.remove('indeterminate'); f.style.width = `${pct}%`; }
      else f.classList.add('indeterminate');
      $('#reText').textContent = text;
    };
    arbeitetGerade = true;

    try {
      // Originale über die App holen (aus dem Speicher direkt darf der Browser nicht).
      const originale = [];
      for (let i = 0; i < teile.length; i++) {
        setz(null, `Original ${i + 1} von ${teile.length} wird geholt …`);
        const r = await fetch(`/api/episodes/${encodeURIComponent(id)}/parts/${encodeURIComponent(teile[i].id)}/file`,
          { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`Aufnahme ${i + 1} nicht abrufbar (HTTP ${r.status}).`);
        originale.push(new File([await r.blob()], teile[i].name || `teil${i}.mp3`));
      }

      const bearbeitet = [];
      for (let i = 0; i < originale.length; i++) {
        bearbeitet.push(await localAudio.lokalAufbereiten(originale[i], { enhance, trimSilence },
          (text, pct) => setz(pct, `Teil ${i + 1} von ${originale.length}: ${text}`)));
      }

      const s = await api('/api/settings').catch(() => ({}));
      const folge = await localAudio.lokalZusammenbauen(bearbeitet,
        { introUrl: s.introUrl, outroUrl: s.outroUrl }, (text, pct) => setz(pct, text));

      setz(null, 'Neue Fassung wird hochgeladen …');
      const fd = new FormData();
      fd.append('fertig', folge, 'folge.mp3');
      fd.append('enhance', String(enhance.enabled));
      fd.append('strength', String(enhance.strength));
      fd.append('trimSilence', String(trimSilence.enabled));
      fd.append('trimSeconds', String(trimSilence.seconds));
      await uploadMitFortschritt(`/api/episodes/${encodeURIComponent(id)}/fertig`, fd,
        (a, b) => setz(Math.round((a / b) * 100), `Wird hochgeladen: ${Math.round((a / b) * 100)} %`));

      arbeitetGerade = false;
      toast('Neu berechnet ✓ — jetzt anhören.');
      renderEpisode(id);
    } catch (e) {
      arbeitetGerade = false;
      info.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
      btn.disabled = false; btn.textContent = 'Neu berechnen';
    }
  });
}

// Liste der Aufnahme-Teile mit Sortier- und Löschknöpfen.
function renderParts(ep) {
  const parts = ep.parts || [];
  if (!parts.length) return '<p class="muted">Keine Teile vorhanden.</p>';
  return parts.map((p, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;margin-bottom:6px;background:var(--bg);">
      <span class="muted" style="font-variant-numeric:tabular-nums;">${i + 1}.</span>
      <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.9rem;">${escapeHtml(p.name || 'Teil')}</span>
      <button class="btn ghost small partEdit" data-id="${escapeAttr(p.id)}" title="schneiden">✂️</button>
      <button class="btn ghost small partUp" data-id="${escapeAttr(p.id)}" ${i === 0 ? 'disabled' : ''} title="nach oben">↑</button>
      <button class="btn ghost small partDown" data-id="${escapeAttr(p.id)}" ${i === parts.length - 1 ? 'disabled' : ''} title="nach unten">↓</button>
      <button class="btn ghost small partDel" data-id="${escapeAttr(p.id)}" title="entfernen" style="color:var(--danger);">×</button>
    </div>
    <div id="editor-${escapeAttr(p.id)}" class="hidden" style="margin:-2px 0 10px;"></div>`).join('');
}

// Verdrahtet die Knöpfe der Teile-Liste.
function wireParts(id, ep) {
  const move = async (partId, delta) => {
    const ids = (ep.parts || []).map((p) => p.id);
    const from = ids.indexOf(partId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await api(`/api/episodes/${encodeURIComponent(id)}/parts/order`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ids }),
    });
    renderEpisode(id);
  };

  view.querySelectorAll('.partEdit').forEach((b) =>
    b.addEventListener('click', () => openWaveEditor(id, b.dataset.id)));
  view.querySelectorAll('.partUp').forEach((b) => b.addEventListener('click', () => move(b.dataset.id, -1)));
  view.querySelectorAll('.partDown').forEach((b) => b.addEventListener('click', () => move(b.dataset.id, 1)));
  view.querySelectorAll('.partDel').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Diesen Aufnahme-Teil entfernen?')) return;
    await api(`/api/episodes/${encodeURIComponent(id)}/parts/${encodeURIComponent(b.dataset.id)}`, { method: 'DELETE' });
    renderEpisode(id);
  }));

  $('#addPartsBtn')?.addEventListener('click', async () => {
    const files = $('#addParts').files;
    if (!files.length) return toast('Bitte zuerst Dateien auswählen.');
    const btn = $('#addPartsBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Lädt …';
    const fd = new FormData();
    for (const f of files) fd.append('audio', f, f.name);
    try {
      await api(`/api/episodes/${encodeURIComponent(id)}/parts`, { method: 'POST', body: fd });
      toast('Teile hinzugefügt.');
      renderEpisode(id);
    } catch (e) {
      toast('Fehler: ' + e.message);
      btn.disabled = false; btn.textContent = 'Teile hinzufügen';
    }
  });

  $('#rebuildBtn')?.addEventListener('click', async () => {
    const withText = confirm('Auch Transkript und Textvorschlag neu erzeugen?\n\nOK = ja (dauert länger)\nAbbrechen = nur Audio neu zusammenbauen');
    await api(`/api/episodes/${encodeURIComponent(id)}/build`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ withText }),
    });
    toast('Wird neu zusammengebaut …');
    renderEpisode(id);
  });
}

// ---- Wellenform-Editor: Bereiche markieren und herausschneiden ----
const waveState = {}; // partId -> { peaks, duration, sel: {start,end}|null }

async function openWaveEditor(episodeId, partId) {
  const box = document.getElementById(`editor-${partId}`);
  if (!box) return;
  if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }

  box.classList.remove('hidden');
  box.innerHTML = '<p class="field-hint"><span class="spinner"></span> Wellenform wird berechnet …</p>';

  try {
    const data = waveState[partId]?.peaks
      ? waveState[partId]
      : await api(`/api/episodes/${encodeURIComponent(episodeId)}/parts/${encodeURIComponent(partId)}/peaks`);
    waveState[partId] = { peaks: data.peaks, duration: data.duration, sel: null };

    box.innerHTML = `
      <div style="border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg);">
        <canvas id="wave-${partId}" style="width:100%;height:90px;display:block;touch-action:none;cursor:crosshair;"></canvas>
        <p class="field-hint" id="waveInfo-${partId}" style="margin:8px 0 0;">
          Ziehe über die Kurve, um einen Bereich zu markieren. Länge: ${fmtClock(data.duration)}
        </p>
        <div class="btn-row" style="margin-top:8px;">
          <button class="btn ghost small" id="waveClear-${partId}" disabled>Auswahl aufheben</button>
          <button class="btn danger small" id="waveCut-${partId}" disabled>Auswahl herausschneiden</button>
        </div>
      </div>`;

    drawWave(partId);
    wireWave(episodeId, partId);
  } catch (e) {
    box.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

function fmtClock(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function drawWave(partId) {
  const cv = document.getElementById(`wave-${partId}`);
  const st = waveState[partId];
  if (!cv || !st) return;

  const ratio = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * ratio; cv.height = h * ratio;
  const ctx = cv.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, w, h);

  const style = getComputedStyle(document.body);
  const accent = style.getPropertyValue('--primary').trim() || '#6366f1';
  const mid = h / 2;
  const n = st.peaks.length;

  // Markierter Bereich als Hintergrund.
  if (st.sel) {
    const x1 = (st.sel.start / st.duration) * w;
    const x2 = (st.sel.end / st.duration) * w;
    ctx.fillStyle = 'rgba(239,68,68,0.25)';
    ctx.fillRect(Math.min(x1, x2), 0, Math.abs(x2 - x1), h);
  }

  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(1, w / n * 0.8);
  for (let i = 0; i < n; i++) {
    const x = (i / n) * w;
    const amp = st.peaks[i] * (h / 2) * 0.95;
    ctx.beginPath();
    ctx.moveTo(x, mid - amp);
    ctx.lineTo(x, mid + amp);
    ctx.stroke();
  }
}

function wireWave(episodeId, partId) {
  const cv = document.getElementById(`wave-${partId}`);
  const st = waveState[partId];
  const info = document.getElementById(`waveInfo-${partId}`);
  const cutBtn = document.getElementById(`waveCut-${partId}`);
  const clearBtn = document.getElementById(`waveClear-${partId}`);
  let dragging = false, anchor = 0;

  const posToTime = (e) => {
    const r = cv.getBoundingClientRect();
    const x = ((e.touches?.[0]?.clientX ?? e.clientX) - r.left) / r.width;
    return Math.min(st.duration, Math.max(0, x * st.duration));
  };
  const update = () => {
    drawWave(partId);
    const has = st.sel && st.sel.end - st.sel.start > 0.2;
    cutBtn.disabled = !has;
    clearBtn.disabled = !st.sel;
    info.textContent = has
      ? `Markiert: ${fmtClock(st.sel.start)} – ${fmtClock(st.sel.end)} (${(st.sel.end - st.sel.start).toFixed(1)} Sek.)`
      : `Ziehe über die Kurve, um einen Bereich zu markieren. Länge: ${fmtClock(st.duration)}`;
  };

  const start = (e) => { dragging = true; anchor = posToTime(e); st.sel = { start: anchor, end: anchor }; update(); e.preventDefault(); };
  const moveTo = (e) => {
    if (!dragging) return;
    const t = posToTime(e);
    st.sel = { start: Math.min(anchor, t), end: Math.max(anchor, t) };
    update(); e.preventDefault();
  };
  const end = () => { dragging = false; };

  cv.addEventListener('pointerdown', start);
  cv.addEventListener('pointermove', moveTo);
  window.addEventListener('pointerup', end);

  clearBtn.addEventListener('click', () => { st.sel = null; update(); });

  cutBtn.addEventListener('click', async () => {
    if (!st.sel) return;
    const len = (st.sel.end - st.sel.start).toFixed(1);
    if (!confirm(`${len} Sekunden herausschneiden (${fmtClock(st.sel.start)} – ${fmtClock(st.sel.end)})?`)) return;
    cutBtn.disabled = true; cutBtn.innerHTML = '<span class="spinner"></span> Schneidet …';
    try {
      await api(`/api/episodes/${encodeURIComponent(episodeId)}/parts/${encodeURIComponent(partId)}/cut`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuts: [st.sel] }),
      });
      delete waveState[partId];
      toast('Bereich entfernt ✓');
      renderEpisode(episodeId);
    } catch (e) {
      toast('Fehler: ' + e.message);
      cutBtn.disabled = false; cutBtn.textContent = 'Auswahl herausschneiden';
    }
  });

  update();
}

async function deleteEpisode(id) {
  if (!confirm('Diese Folge unwiderruflich löschen?')) return;
  await api(`/api/episodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  toast('Gelöscht.');
  go('/');
}

// ================= EINSTELLUNGEN =================
async function renderSettings() {
  // Marke bleibt oben stehen, die Seite ergibt sich aus dem Inhalt.
  view.innerHTML = '<p class="muted">Lade …</p>';
  const s = await api('/api/settings');

  view.innerHTML = `
    <button class="back" onclick="history.back()">← Zurück</button>

    <div class="card">
      <h2 class="section" style="margin-top:0;">🩺 Systemstatus</h2>
      <p class="muted">Zeigt auf einen Blick, was eingerichtet ist. Bei Problemen einfach abfotografieren.</p>
      <div id="statusBox"><span class="spinner"></span></div>
    </div>

    <div class="card">
      <h2 class="section" style="margin-top:0;">Podcast-Infos (für den RSS-Feed)</h2>
      <label>Podcast-Titel</label>
      <input type="text" id="s_title" value="${escapeAttr(s.title)}" />
      <label>Beschreibung</label>
      <textarea id="s_description">${escapeHtml(s.description)}</textarea>
      <label>Autor / Host</label>
      <input type="text" id="s_author" value="${escapeAttr(s.author)}" />
      <label>Eigentümer-Name</label>
      <input type="text" id="s_ownerName" value="${escapeAttr(s.ownerName)}" />
      <label>Kontakt-E-Mail (von Spotify verlangt)</label>
      <input type="email" id="s_ownerEmail" value="${escapeAttr(s.ownerEmail)}" />
      <label>Sprache</label>
      <input type="text" id="s_language" value="${escapeAttr(s.language)}" />
      <label>Kategorie</label>
      <input type="text" id="s_category" value="${escapeAttr(s.category)}" />
      <label style="display:flex;align-items:center;gap:10px;">
        <input type="checkbox" id="s_explicit" ${s.explicit ? 'checked' : ''} style="width:auto;" /> Explizite Inhalte
      </label>
      <button class="btn primary" id="saveSettings" style="margin-top:14px;">Infos speichern</button>
    </div>

    <div class="card">
      <h2 class="section" style="margin-top:0;">Intro, Outro &amp; Cover</h2>
      <label>Intro (immer am Anfang) ${s.intro ? '✓ gesetzt' : ''}</label>
      <input type="file" id="a_intro" accept="audio/*" />
      <label>Outro (immer am Ende) ${s.outro ? '✓ gesetzt' : ''}</label>
      <input type="file" id="a_outro" accept="audio/*" />
      <label>Cover-Bild (Pflicht für Spotify, quadratisch ≥ 1400px) ${s.cover ? '✓ gesetzt' : ''}</label>
      <input type="file" id="a_cover" accept="image/*" />
      <button class="btn primary" id="saveAssets" style="margin-top:14px;">Dateien hochladen</button>
      ${s.coverUrl ? `<img src="${s.coverUrl}" alt="Cover" style="width:120px;height:120px;object-fit:cover;border-radius:12px;margin-top:14px;" />` : ''}
    </div>

    <div class="card">
      <h2 class="section" style="margin-top:0;">🎭 Wer spricht im Podcast</h2>
      <p class="muted">Fließt in jeden Infotext ein — die KI schreibt dann in eurem Sinne und spielt an, wie ihr auf den Film reagiert.</p>
      <textarea id="s_crew" style="min-height:130px;">${escapeHtml(s.crew || '')}</textarea>
      <p class="field-hint">Eine Zeile pro Person: Name, Eigenheiten, typische Reaktionen.</p>
      <button class="btn ghost small" id="saveCrewBtn" style="margin-top:8px;">Speichern</button>
    </div>

    <div class="card">
      <h2 class="section" style="margin-top:0;">Bestehende Folgen importieren (Umzug)</h2>
      <p class="muted">Trag die RSS-URL deines aktuellen Podcasts ein (z. B. cinespasten). Alle Folgen werden übernommen.</p>
      <label>Aktuelle RSS-Feed-URL</label>
      <input type="text" id="imp_url" value="${escapeAttr(s.sourceFeedUrl || '')}" placeholder="https://…/feed.xml oder anchor.fm/s/…/podcast/rss" />
      <label style="display:flex;align-items:center;gap:10px;">
        <input type="checkbox" id="imp_rehost" checked style="width:auto;" /> Audiodateien in meinen Speicher kopieren (empfohlen)
      </label>
      <label style="display:flex;align-items:center;gap:10px;">
        <input type="checkbox" id="imp_meta" checked style="width:auto;" /> Podcast-Infos &amp; Cover übernehmen
      </label>
      <button class="btn primary" id="importBtn" style="margin-top:14px;">Import starten</button>
      <p class="field-hint">Je nach Anzahl/Größe der Folgen kann das ein paar Minuten dauern. Läuft mehrfach ohne Duplikate.</p>
      <div id="importResult" class="muted" style="margin-top:10px;"></div>
    </div>

    <div class="card">
      <h2 class="section" style="margin-top:0;">Dein RSS-Feed</h2>
      <p class="muted">Diese URL trägst du <b>einmalig</b> bei Spotify for Podcasters ein. Danach erscheinen neue Folgen automatisch.</p>
      <input type="text" readonly value="${location.origin}/feed.xml" onclick="this.select()" />
      <a class="btn ghost small" href="/feed.xml" target="_blank" style="margin-top:10px;">Feed ansehen</a>
    </div>
  `;

  $('#saveSettings').addEventListener('click', async () => {
    await api('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: $('#s_title').value, description: $('#s_description').value,
        author: $('#s_author').value, ownerName: $('#s_ownerName').value,
        ownerEmail: $('#s_ownerEmail').value, language: $('#s_language').value,
        category: $('#s_category').value, explicit: $('#s_explicit').checked,
      }),
    });
    toast('Gespeichert.');
  });

  loadStatus();

  $('#saveCrewBtn').addEventListener('click', async () => {
    await api('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crew: $('#s_crew').value }),
    });
    toast('Gespeichert.');
  });

  $('#importBtn').addEventListener('click', async () => {
    const url = $('#imp_url').value.trim();
    if (!url) return toast('Bitte Feed-URL eingeben.');
    try {
      await api('/api/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedUrl: url, rehost: $('#imp_rehost').checked, importMeta: $('#imp_meta').checked }),
      });
      toast('Import gestartet.');
      pollImport();
    } catch (e) {
      $('#importResult').innerHTML = `<span class="error">${escapeHtml(e.message)}</span>`;
    }
  });

  // Läuft schon einer? Dann direkt die Anzeige aufnehmen.
  pollImport();

  $('#saveAssets').addEventListener('click', async () => {
    const fd = new FormData();
    if ($('#a_intro').files[0]) fd.append('intro', $('#a_intro').files[0]);
    if ($('#a_outro').files[0]) fd.append('outro', $('#a_outro').files[0]);
    if ($('#a_cover').files[0]) fd.append('cover', $('#a_cover').files[0]);
    const btn = $('#saveAssets');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Lädt …';
    try { await api('/api/settings/assets', { method: 'POST', body: fd }); toast('Hochgeladen.'); renderSettings(); }
    catch (e) { toast('Fehler: ' + e.message); btn.disabled = false; btn.textContent = 'Dateien hochladen'; }
  });
}

// Verfolgt einen laufenden Import und zeigt den Fortschritt an.
// Der Import läuft serverseitig weiter, auch wenn die Seite geschlossen wird.
async function pollImport() {
  const out = $('#importResult'), btn = $('#importBtn');
  if (!out) return;
  let st;
  try { st = await api('/api/import/status'); } catch { return; }

  if (st.running) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Import läuft …'; }
    const done = (st.imported || 0) + (st.skipped || 0);
    const pct = st.total ? Math.round((done / st.total) * 100) : 0;
    out.innerHTML = `
      <div style="margin-top:10px;">
        <div style="height:8px;background:var(--surface-2);border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:var(--primary);transition:width .4s;"></div>
        </div>
        <p class="field-hint" style="margin-top:6px;">
          ${escapeHtml(st.phase || '')}<br>
          ${st.total ? `${done} von ${st.total} Folgen · ${st.imported} übernommen` : 'Feed wird gelesen …'}
        </p>
        <p class="field-hint">Läuft im Hintergrund weiter — du kannst die Seite ruhig verlassen.</p>
      </div>`;
    setTimeout(pollImport, 3000);
    return;
  }

  if (btn) { btn.disabled = false; btn.textContent = 'Import starten'; }
  if (st.finishedAt) {
    out.innerHTML = st.error
      ? `<span class="error">Abgebrochen: ${escapeHtml(st.error)}</span>`
      : `<span class="success">✓ Fertig:</span> ${st.imported} übernommen, ${st.skipped} übersprungen (von ${st.total}).` +
        (st.errors?.length ? `<br><span class="error">${st.errors.length} Warnung(en): ${escapeHtml(st.errors.slice(0, 3).join('; '))}</span>` : '');
  }
}

// Zeigt den Systemstatus als kompakte Liste mit Häkchen.
async function loadStatus() {
  const box = $('#statusBox');
  if (!box) return;
  try {
    const st = await api('/api/status');
    const ok = (v) => (v ? '<span class="success">✓</span>' : '<span class="error">✗</span>');
    const r2 = st.speicher.startsWith('Cloudflare');
    const p = st.pruefung;
    box.innerHTML = `
      <div style="display:grid;gap:6px;font-size:.9rem;">
        <div>${ok(r2)} Speicher: <b>${escapeHtml(st.speicher)}</b></div>
        <div>${ok(st.schluessel.gemini)} Gemini-Schlüssel (Transkript und Infotext)</div>
        <div>${ok(st.schluessel.gemini && !String(st.geminiModell).startsWith('Fehler'))}
          Gemini-Modell: <b>${escapeHtml(st.geminiModell || '–')}</b></div>
        <div>${ok(st.dateien.intro)} Intro: ${escapeHtml(st.dateien.intro || 'fehlt')}</div>
        <div>${ok(st.dateien.outro)} Outro: ${escapeHtml(st.dateien.outro || 'fehlt')}</div>
        <div>${ok(st.dateien.cover)} Podcast-Cover: ${escapeHtml(st.dateien.cover || 'fehlt')}</div>
        <div>${ok(st.podcast.kontaktEmail)} Kontakt-E-Mail: ${escapeHtml(st.podcast.kontaktEmail || 'fehlt (von Spotify verlangt)')}</div>
        <div style="margin-top:6px;">📻 Folgen: <b>${st.folgen.gesamt}</b>
          (${st.folgen.veroeffentlicht} veröffentlicht, ${st.folgen.entwuerfe} Entwürfe${st.folgen.fehler ? `, <span class="error">${st.folgen.fehler} Fehler</span>` : ''})</div>
        ${p ? `
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);">
          <b style="font-size:.88rem;">Umzugs-Prüfung</b>
          <div style="margin-top:4px;">📅 Zeitraum: <b>${escapeHtml(p.aeltesteFolge || '–')}</b> bis <b>${escapeHtml(p.neuesteFolge || '–')}</b></div>
          <div>${ok(p.nochBeimAltenAnbieter === 0)} Audio im eigenen Speicher: <b>${escapeHtml(p.audioImEigenenSpeicher)}</b></div>
          ${p.nochBeimAltenAnbieter ? `<div class="error">⚠️ ${p.nochBeimAltenAnbieter} Folge(n) noch beim alten Anbieter${p.beispieleFremd.length ? `: ${escapeHtml(p.beispieleFremd.join(', '))}` : ''}</div>` : ''}
          ${p.ohneAudio ? `<div class="error">⚠️ ${p.ohneAudio} Folge(n) ohne Audiodatei</div>` : ''}
          <div>🖼️ Mit eigenem Folgenbild: <b>${p.mitFolgenbild}</b></div>
          ${p.ohneText ? `<div class="error">⚠️ ${p.ohneText} Folge(n) ohne Text</div>` : '<div>✍️ Alle Folgen haben einen Text</div>'}
          <div class="muted" style="font-size:.82rem;">Belegter Speicher: ca. ${p.gesamtgroesseMB} MB von 10 000 MB</div>
        </div>` : ''}
      </div>`;
  } catch (e) {
    box.innerHTML = `<p class="error">Status nicht abrufbar: ${escapeHtml(e.message)}</p>`;
  }
}

// ---------- Escaping ----------
function escapeHtml(str = '') {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
function escapeAttr(str = '') {
  return String(str).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Service Worker (PWA-Grundgerüst). Übernimmt ein neuer die Kontrolle, lädt die
// Seite einmal neu – sonst liefe die alte Oberfläche gegen einen neuen Server.
if ('serviceWorker' in navigator) {
  // Beim allerersten Besuch übernimmt erstmalig ein Service Worker – das ist
  // keine neue Version und soll nicht gemeldet werden.
  const hatteSchonEinen = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('/sw.js').catch(() => {});

  // Früher wurde hier automatisch neu geladen. Das hat laufende Arbeit im
  // Browser zerstört – eine Aufbereitung mitten im Vorgang war danach weg.
  // Deshalb: nur Bescheid geben, das Neuladen entscheidet der Nutzer.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hatteSchonEinen) return;   // erste Einrichtung, nichts zu melden
    if (arbeitetGerade) return;     // während laufender Arbeit gar nicht stören
    zeigeNeuladenHinweis();
  });
}

function zeigeNeuladenHinweis() {
  if (document.getElementById('swHinweis')) return;
  const box = document.createElement('div');
  box.id = 'swHinweis';
  box.className = 'toast';
  box.style.cursor = 'pointer';
  box.innerHTML = 'Neue Version verfügbar — <b>zum Neuladen tippen</b>';
  box.addEventListener('click', () => window.location.reload());
  document.body.appendChild(box);
}

render();
