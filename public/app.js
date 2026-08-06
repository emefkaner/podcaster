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
        <label for="strength">Stärke: <span id="strengthVal">50</span>%</label>
        <input type="range" id="strength" min="0" max="100" value="50" style="width:100%;" />
        <p class="field-hint">Dezent (links) bis stark (rechts). Für Auto/Restaurant eher 60–85%.</p>
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
        fertige.forEach(([blob, name]) => fd.append('audio', blob, name));

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
  let ep, settings = {};
  try {
    [ep, settings] = await Promise.all([
      api(`/api/episodes/${encodeURIComponent(id)}`),
      api('/api/settings').catch(() => ({})),
    ]);
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

      <div class="btn-row" style="margin-top:12px;">
        <button class="btn" id="saveBtn">Speichern</button>
        <button class="btn ghost small" id="regenBtn" title="Neuen KI-Vorschlag">↻ Text</button>
      </div>
      ${!ep.transcript?.trim() ? `
        <p class="field-hint">Kein Transkript vorhanden — „↻ Text" recherchiert dann den Film
          anhand des Titels und schreibt daraus. Optional kannst du Stichworte mitgeben:</p>
        <input type="text" id="descHints" placeholder="optional: z. B. langer Spoilerteil, Matthew war begeistert" />` : ''}

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

      <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:14px;margin:10px 0;">
        <b style="font-size:.95rem;">🎨 Cover generieren</b>
        <p class="field-hint" style="margin-top:4px;">Eure Gesichter bleiben immer gleich. Titel, Kleidung, Kulisse und Stimmung passen sich dem Film an.</p>

        <label style="margin-top:10px;">Titel oben aufs Cover</label>
        <input type="text" id="artHeadline" value="${escapeAttr(ep.artworkHeadline || settings.coverHeadline || '')}" placeholder="z. B. CINESPASTEN CRIME 101" />

        <label>Unterzeile unten <span class="muted">(optional)</span></label>
        <input type="text" id="artSubtitle" value="${escapeAttr(ep.artworkSubtitle || '')}" placeholder="z. B. EASY ON THE SPACE SUITS" />

        <label>Kleidung, Kulisse &amp; Stimmung</label>
        <textarea id="artPrompt" style="min-height:70px;" placeholder="Spartaner-Rüstungen mit Helmen, antikes Meer, Zyklop im Hintergrund, warmes Abendlicht">${escapeHtml(ep.artworkPrompt || '')}</textarea>

        <button class="btn" id="artBtn" style="margin-top:10px;">3 Vorschläge generieren</button>
        <p class="field-hint">Kostet ein paar Cent pro Durchgang.</p>
        <div id="artResult"></div>
      </div>

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

  $('#saveBtn').addEventListener('click', async () => {
    await api(`/api/episodes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: $('#epTitle').value, description: $('#epDesc').value }),
    });
    toast('Gespeichert.');
  });

  wireParts(id, ep);

  // Beim Öffnen bereits vorhandene Vorschläge anzeigen.
  if (ep.artworkCandidates?.length) showCandidates(id, ep.artworkCandidates);

  $('#artBtn').addEventListener('click', async () => {
    const prompt = $('#artPrompt').value.trim();
    if (!prompt) return toast('Bitte kurz beschreiben, was verändert werden soll.');
    const btn = $('#artBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Generiere … (~30 Sek.)';
    $('#artResult').innerHTML = '';
    try {
      const r = await api(`/api/episodes/${encodeURIComponent(id)}/artwork`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt, count: 3,
          headline: $('#artHeadline').value,
          subtitle: $('#artSubtitle').value,
        }),
      });
      showCandidates(id, r.candidates);
      toast(`${r.candidates.length} Vorschläge fertig.`);
    } catch (e) {
      $('#artResult').innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
    } finally {
      btn.disabled = false; btn.textContent = '3 Vorschläge generieren';
    }
  });

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
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>';
    try {
      const r = await api(`/api/episodes/${encodeURIComponent(id)}/describe`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hinweise }),
      });
      $('#epDesc').value = r.vorschlag;
      $('#hintBox')?.classList.add('hidden');
      toast('Neuer Vorschlag eingesetzt — prüfen und speichern.');
    } catch (e) {
      toast('Fehler: ' + e.message, 4500);
    } finally {
      btn.disabled = false; btn.textContent = label;
    }
  }

  // Ohne Transkript wird recherchiert; etwaige Stichworte fließen mit ein.
  $('#regenBtn').addEventListener('click', () => {
    neuenTextHolen(($('#descHints')?.value || '').trim(), $('#regenBtn'));
  });

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

// Zeigt die generierten Cover-Vorschläge zur Auswahl an.
function showCandidates(id, candidates) {
  const box = $('#artResult');
  if (!box) return;
  box.innerHTML = `
    <p class="field-hint" style="margin-top:12px;">Tippe auf den Vorschlag, den du nehmen willst:</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:8px;">
      ${candidates.map((c) => `
        <button class="cand" data-key="${escapeAttr(c.key)}"
                style="padding:0;border:2px solid var(--border);border-radius:12px;overflow:hidden;background:none;cursor:pointer;">
          <img src="${escapeAttr(c.url)}" alt="Vorschlag" style="width:100%;aspect-ratio:1;object-fit:cover;display:block;" />
        </button>`).join('')}
    </div>`;

  box.querySelectorAll('.cand').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Diesen Vorschlag als Folgen-Cover übernehmen? Die anderen werden verworfen.')) return;
      btn.style.borderColor = 'var(--primary)';
      try {
        await api(`/api/episodes/${encodeURIComponent(id)}/artwork/select`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: btn.dataset.key }),
        });
        toast('Cover übernommen ✓');
        renderEpisode(id);
      } catch (e) {
        toast('Fehler: ' + e.message);
      }
    });
  });
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
      <h2 class="section" style="margin-top:0;">🎨 Cover-Generator</h2>
      <p class="muted">Lade hier euer Ausgangsbild hoch (z. B. das Team-Foto). Bei jeder Folge wird es dann passend zum Thema abgewandelt — mehrere Bilder helfen, dass eure Gesichter erkennbar bleiben.</p>

      <label>Ausgangsbilder</label>
      <div id="baseList" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
        ${(s.baseImageUrls || []).map((b) => `
          <div style="position:relative;">
            <img src="${escapeAttr(b.url)}" alt="Ausgangsbild" style="width:88px;height:88px;object-fit:cover;border-radius:10px;display:block;" />
            <button class="delBase" data-name="${escapeAttr(b.name)}" title="Entfernen"
              style="position:absolute;top:-6px;right:-6px;width:24px;height:24px;border-radius:50%;border:none;background:var(--danger);color:#fff;cursor:pointer;font-size:.9rem;line-height:1;">×</button>
          </div>`).join('') || '<span class="muted">Noch keine Ausgangsbilder.</span>'}
      </div>
      <input type="file" id="baseFiles" accept="image/*" multiple />
      <button class="btn ghost small" id="baseUploadBtn" style="margin-top:8px;">Ausgangsbilder hinzufügen</button>

      <label style="margin-top:18px;">Standard-Titel oben auf dem Cover</label>
      <input type="text" id="s_coverHeadline" value="${escapeAttr(s.coverHeadline || '')}" placeholder="DIE CINESPASTEN" />
      <p class="field-hint">Wird bei jeder Folge vorgeschlagen. Pro Folge kannst du abweichen (z. B. „CINESPASTEN CRIME 101").</p>

      <label style="margin-top:14px;">Grund-Look (gilt für alle Folgen)</label>
      <textarea id="s_imageStyle" style="min-height:90px;">${escapeHtml(s.imageStyle || '')}</textarea>
      <p class="field-hint">Der durchgehende Look eurer Reihe. Titel, Kleidung und Kulisse legst du pro Folge fest.</p>
      <button class="btn ghost small" id="saveStyleBtn" style="margin-top:8px;">Stil speichern</button>
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

  $('#baseUploadBtn').addEventListener('click', async () => {
    const files = $('#baseFiles').files;
    if (!files.length) return toast('Bitte zuerst Bilder auswählen.');
    const fd = new FormData();
    for (const f of files) fd.append('images', f);
    const btn = $('#baseUploadBtn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Lädt …';
    try {
      await api('/api/settings/base-images', { method: 'POST', body: fd });
      toast('Hinzugefügt.');
      renderSettings();
    } catch (e) {
      toast('Fehler: ' + e.message);
      btn.disabled = false; btn.textContent = 'Ausgangsbilder hinzufügen';
    }
  });

  view.querySelectorAll('.delBase').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Dieses Ausgangsbild entfernen?')) return;
      await api(`/api/settings/base-images/${encodeURIComponent(b.dataset.name)}`, { method: 'DELETE' });
      renderSettings();
    });
  });

  $('#saveStyleBtn').addEventListener('click', async () => {
    await api('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageStyle: $('#s_imageStyle').value,
        coverHeadline: $('#s_coverHeadline').value,
      }),
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
        <div>${ok(st.schluessel.gemini)} Gemini-Schlüssel (Transkript, Text, Cover)</div>
        <div>${ok(st.dateien.intro)} Intro: ${escapeHtml(st.dateien.intro || 'fehlt')}</div>
        <div>${ok(st.dateien.outro)} Outro: ${escapeHtml(st.dateien.outro || 'fehlt')}</div>
        <div>${ok(st.dateien.cover)} Podcast-Cover: ${escapeHtml(st.dateien.cover || 'fehlt')}</div>
        <div>${ok(st.dateien.ausgangsbilder)} Ausgangsbilder für Cover-Generator: <b>${st.dateien.ausgangsbilder}</b></div>
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
        <div class="muted" style="font-size:.82rem;margin-top:6px;">Cover-Generator: ${escapeHtml(st.bildanbieter)}</div>
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
