import fs from 'node:fs';
import { paths, defaultSettings } from './config.js';
import { storageEnabled, putJson, getJson } from './storage.js';

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
