import fs from 'node:fs';
import { config, paths, defaultSettings } from './config.js';
import { storageEnabled, putJson, getJson, publicUrl } from './storage.js';

// Sehr einfache "Datenbank": zwei JSON-Dateien.
// Lokale Datei = schnelle Quelle der Wahrheit; bei aktivem R2 wird jede Änderung
// zusätzlich als Backup nach R2 gespiegelt und beim Start von dort wiederhergestellt.

const R2_KEYS = {
  [paths.store]: 'meta/store.json',
  [paths.settings]: 'meta/settings.json',
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomar
  // Backup nach R2 (fire-and-forget; Fehler nur loggen).
  const key = R2_KEYS[file];
  if (key && storageEnabled()) {
    putJson(key, data).catch((e) => console.error('R2-Backup fehlgeschlagen:', e.message));
  }
  // Episoden oder Einstellungen geändert → vorgeschalteten Feed-Zwischenspeicher
  // sofort leeren (fire-and-forget). So muss eine echte Änderung nicht erst auf
  // dessen Rückfall-Timer warten; Render ist in diesem Moment ohnehin wach.
  if (key && config.feedMirrorPurgeUrl) {
    fetch(config.feedMirrorPurgeUrl).catch((e) => console.error('Feed-Cache-Leerung fehlgeschlagen:', e.message));
  }
}

// Zuletzt gefundene Fälligkeitszeit, für die schon geleert wurde — verhindert
// wiederholtes Leeren bei jedem Seitenaufruf, solange dieselbe Folge fällig ist.
let faelligkeitPurgeStand = 0;

// Beiläufige Prüfung bei JEDEM Seitenaufruf (aus server.js aufgerufen): ist eine
// EINGEPLANTE Folge seit dem letzten Aufruf fällig geworden? Dann den
// Feed-Zwischenspeicher leeren. Render ist durch den gerade laufenden Aufruf
// ohnehin wach — das kostet nichts zusätzlich. So wacht Render nur noch durch
// eigene Nutzung auf (Speichern ODER bloßes Aufrufen der Seite), nie durch
// fremde Feed-Abfragen von außen. Siehe cloudflare/feed-cache-worker.js.
export function pruefeFaelligeFolgen() {
  if (!config.feedMirrorPurgeUrl) return;
  const jetzt = Date.now();
  let neuerStand = faelligkeitPurgeStand;
  for (const e of listEpisodes()) {
    if (e.status !== 'published' || !e.publishedAt) continue;
    const t = new Date(e.publishedAt).getTime();
    if (!isNaN(t) && t <= jetzt && t > faelligkeitPurgeStand) neuerStand = Math.max(neuerStand, t);
  }
  if (neuerStand === faelligkeitPurgeStand) return; // nichts neu Fälliges
  faelligkeitPurgeStand = neuerStand;
  fetch(config.feedMirrorPurgeUrl).catch((e) => console.error('Feed-Cache-Leerung (fällige Folge) fehlgeschlagen:', e.message));
}

// Beim Start: fehlt eine lokale JSON-Datei (z. B. neuer Container ohne Volume),
// aus dem R2-Backup wiederherstellen.
export async function initStore() {
  if (!storageEnabled()) return;
  for (const [file, key] of Object.entries(R2_KEYS)) {
    if (!fs.existsSync(file)) {
      const data = await getJson(key);
      if (data) {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
        console.log(`Wiederhergestellt aus R2: ${key}`);
      }
    }
  }
}

// ---- Episoden ----
export function listEpisodes() {
  return readJson(paths.store, { episodes: [] }).episodes || [];
}

export function getEpisode(id) {
  return listEpisodes().find((e) => e.id === id) || null;
}

export function saveEpisode(episode) {
  const episodes = listEpisodes();
  const idx = episodes.findIndex((e) => e.id === episode.id);
  if (idx >= 0) episodes[idx] = episode;
  else episodes.unshift(episode);
  writeJson(paths.store, { episodes });
  return episode;
}

export function deleteEpisode(id) {
  writeJson(paths.store, { episodes: listEpisodes().filter((e) => e.id !== id) });
}

// ---- Einstellungen ----
export function getSettings() {
  return { ...defaultSettings, ...readJson(paths.settings, {}) };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(paths.settings, next);
  return next;
}

// Öffentliche Adresse des Podcast-Covers – MIT Versionsanhängsel.
//
// Wichtig: Ein neues Cover landet unter demselben Namen (`assets/cover.jpg`).
// Ohne Anhängsel bleibt die Adresse also byteweise identisch, und Browser,
// CDN und Podcast-Apps zeigen weiter ihr zwischengespeichertes altes Bild —
// die Datei auf dem Server ist längst die neue. Genau daran hing das „es wird
// immer noch das alte Cover angezeigt".
//
// Das Anhängsel kommt aus `coverStand` und ändert sich nur, wenn das Cover
// wirklich gewechselt wurde. So bleibt das Zwischenspeichern dazwischen heil.
export function coverUrlOf(s = getSettings()) {
  if (!s.cover) return '';
  const basis = publicUrl(`assets/${s.cover}`);
  const stand = Date.parse(s.coverStand || '');
  if (!Number.isFinite(stand)) return basis;
  return `${basis}${basis.includes('?') ? '&' : '?'}v=${stand}`;
}
