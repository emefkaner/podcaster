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
function fmtDur(sec) {
  if (!sec) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')} min`;
}
const STATUS_LABEL = { processing: 'Wird verarbeitet', draft: 'Entwurf', published: 'Veröffentlicht', error: 'Fehler' };

// ---------- Routing (sehr simpel) ----------
function go(path) { history.pushState({}, '', path); render(); }
window.addEventListener('popstate', render);

function render() {
  const p = location.pathname;
  if (p === '/settings') return renderSettings();
  const m = p.match(/^\/episode\/(.+)$/);
  if (m) return renderEpisode(decodeURIComponent(m[1]));
  return renderHome();
}

// ---------- Menü ----------
$('#menuBtn').addEventListener('click', async () => {
  const choice = prompt('Menü:\n1 = Start / Aufnehmen\n2 = Einstellungen\n3 = Abmelden\n\nZahl eingeben:');
  if (choice === '1') go('/');
  else if (choice === '2') go('/settings');
  else if (choice === '3') { await fetch('/logout', { method: 'POST' }); window.location.href = '/login'; }
});

// ================= START / AUFNEHMEN =================
async function renderHome() {
  pageTitle.textContent = 'Podcast Studio';
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
        <label for="strength">Stärke: <span id="strengthVal">60</span>%</label>
        <input type="range" id="strength" min="0" max="100" value="60" style="width:100%;" />
        <p class="field-hint">Dezent (links) bis stark (rechts). Für Auto/Restaurant eher 60–85%.</p>
      </div>

      <label style="display:flex;align-items:center;gap:10px;margin-top:14px;">
        <input type="checkbox" id="trimChk" style="width:auto;" />
        Lange Pausen automatisch kürzen
      </label>
      <div id="trimWrap" style="opacity:.4;">
        <label for="trimSec">Ab <span id="trimVal">2,0</span> Sekunden Stille</label>
        <input type="range" id="trimSec" min="5" max="60" value="20" step="5" style="width:100%;" disabled />
        <p class="field-hint">Kürzt lange Denk- und Umschaltpausen, lässt Atempausen stehen.</p>
      </div>

      <button id="submitBtn" class="btn primary" disabled style="margin-top:16px;">
        Verarbeiten &amp; als Entwurf anlegen
      </button>
      <p class="field-hint">Intro + Aufnahme + Outro werden zusammengefügt, transkribiert und ein Infotext-Vorschlag erstellt. Veröffentlicht wird erst nach deiner Freigabe.</p>
    </div>

    <h2 class="section">Deine Folgen</h2>
    <div id="episodeList"><p class="muted">Lade …</p></div>
  `;

  setupRecorder();
  setupUpload();
  loadEpisodes();
}

// ---- Recorder (MediaRecorder API) ----
let mediaRecorder, chunks = [], recordedBlob = null, timerInt, seconds = 0;

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

  const fd = new FormData();
  // Alle ausgewählten Dateien als Teile mitschicken – sonst die Aufnahme.
  if (files.length) {
    for (const f of files) fd.append('audio', f, f.name);
  } else {
    fd.append('audio', recordedBlob, 'aufnahme.webm');
  }
  fd.append('title', $('#titleInput').value.trim());
  fd.append('enhance', $('#enhanceChk').checked ? 'true' : 'false');
  fd.append('strength', $('#strength').value);
  fd.append('trimSilence', $('#trimChk').checked ? 'true' : 'false');
  fd.append('trimSeconds', String($('#trimSec').value / 10));

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Lädt hoch …';
  try {
    const ep = await api('/api/episodes', { method: 'POST', body: fd });
    toast('Hochgeladen – Verarbeitung läuft.');
    go(`/episode/${encodeURIComponent(ep.id)}`);
  } catch (err) {
    toast('Fehler: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Verarbeiten & als Entwurf anlegen';
  }
}

async function loadEpisodes() {
  const list = $('#episodeList');
  try {
    const eps = await api('/api/episodes');
    if (!eps.length) { list.innerHTML = '<p class="muted">Noch keine Folgen.</p>'; return; }
    list.innerHTML = eps.map((e) => `
      <div class="episode" data-id="${e.id}">
        <div>
          <h3>${escapeHtml(e.title)}</h3>
          <div class="meta">${fmtDate(e.createdAt)}${e.duration ? ' · ' + fmtDur(e.duration) : ''}</div>
        </div>
        <span class="badge ${e.status}">${STATUS_LABEL[e.status] || e.status}</span>
      </div>`).join('');
    list.querySelectorAll('.episode').forEach((el) =>
      el.addEventListener('click', () => go(`/episode/${encodeURIComponent(el.dataset.id)}`)));
  } catch (err) {
    list.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

// ================= EPISODE-DETAIL / REVIEW =================
async function renderEpisode(id) {
  pageTitle.textContent = 'Folge';
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
    view.innerHTML = `
      <button class="back" onclick="history.back()">← Zurück</button>
      <div class="card" style="text-align:center;">
        <p><span class="spinner"></span></p>
        <h3>${escapeHtml(ep.title)}</h3>
        <p class="muted">Zusammenfügen, Optimieren, Transkribieren und Infotext erstellen …<br>Das kann je nach Länge ein paar Minuten dauern.</p>
      </div>`;
    setTimeout(() => renderEpisode(id), 4000);
    return;
  }

  if (ep.status === 'error') {
    view.innerHTML = `
      <button class="back" onclick="history.back()">← Zurück</button>
      <div class="card">
        <h3>${escapeHtml(ep.title)}</h3>
        <p class="error">Verarbeitung fehlgeschlagen: ${escapeHtml(ep.error || '')}</p>
        <button class="btn danger" id="delBtn">Löschen</button>
      </div>`;
    $('#delBtn').addEventListener('click', () => deleteEpisode(id));
    return;
  }

  const audioUrl = ep.audioUrl || '';
  const isPublished = ep.status === 'published';
  view.innerHTML = `
    <button class="back" onclick="history.back()">← Zurück</button>
    <div class="card">
      <span class="badge ${ep.status}">${STATUS_LABEL[ep.status]}</span>
      <label for="epTitle">Titel</label>
      <input type="text" id="epTitle" value="${escapeAttr(ep.title)}" />

      <label for="epDesc">Infotext (KI-Vorschlag – frei änderbar)</label>
      <textarea id="epDesc">${escapeHtml(ep.description || '')}</textarea>
      <p class="field-hint">Das ist der Text, der später im Podcast erscheint. Prüfe/ändere ihn und speichere.</p>

      <div class="btn-row" style="margin-top:12px;">
        <button class="btn" id="saveBtn">Speichern</button>
        <button class="btn ghost small" id="regenBtn" title="Neuen KI-Vorschlag">↻ Text</button>
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

      <label>Eigenes Bild hochladen</label>
      <input type="file" id="epImage" accept="image/*" />
      <button class="btn ghost small" id="epImageBtn" style="margin-top:8px;">Bild speichern</button>

      <label style="margin-top:18px;">Fertige Folge anhören (Intro + Audio + Outro)</label>
      <audio controls src="${audioUrl}"></audio>
    </div>

    <div class="card">
      <h2 class="section" style="margin-top:0;">1) Eigener RSS-Feed</h2>
      ${isPublished
        ? `<p class="success">✓ Diese Folge ist im RSS-Feed und wird von Spotify abgeholt.</p>
           <button class="btn danger" id="unpubBtn">Aus Feed zurückziehen</button>`
        : `<button class="btn primary" id="pubBtn">Veröffentlichen (in den RSS-Feed)</button>
           <p class="field-hint">Es wird vor der Veröffentlichung nochmal nachgefragt.</p>`}
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

  $('#regenBtn').addEventListener('click', async () => {
    toast('Für einen neuen Vorschlag bitte Text manuell anpassen (Neu-Generierung folgt später).');
  });

  if ($('#pubBtn')) $('#pubBtn').addEventListener('click', async () => {
    // Erst speichern, dann bestätigen, dann publishen.
    await api(`/api/episodes/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: $('#epTitle').value, description: $('#epDesc').value }),
    });
    if (!confirm('Folge jetzt veröffentlichen? Sie erscheint dann im RSS-Feed und Spotify holt sie automatisch ab.')) return;
    await api(`/api/episodes/${encodeURIComponent(id)}/publish`, { method: 'POST' });
    toast('Veröffentlicht ✓');
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
  pageTitle.textContent = 'Einstellungen';
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
        <div class="muted" style="font-size:.82rem;">Bildmodell: ${escapeHtml(st.bildmodell)}</div>
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

// Service Worker (PWA-Grundgerüst).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

render();
