import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { XMLParser } from 'fast-xml-parser';
import { paths } from './config.js';
import { listEpisodes, saveEpisode, getSettings, saveSettings } from './store.js';
import { uploadFile } from './storage.js';

// Wandelt "HH:MM:SS", "MM:SS" oder reine Sekunden in Sekunden um.
function parseDuration(val) {
  if (val == null) return 0;
  const str = String(val).trim();
  if (/^\d+$/.test(str)) return Number(str);
  const parts = str.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

// Reines Parsen (ohne Netzwerk) – gut testbar.
export function parseFeed(xml) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel;
  if (!channel) throw new Error('Kein gültiger RSS-Feed (channel fehlt).');

  const meta = {
    title: channel.title || '',
    description: channel.description || channel['itunes:summary'] || '',
    author: channel['itunes:author'] || '',
    ownerName: channel['itunes:owner']?.['itunes:name'] || '',
    ownerEmail: channel['itunes:owner']?.['itunes:email'] || '',
    language: channel.language || 'de',
    coverUrl: channel['itunes:image']?.['@_href'] || channel.image?.url || '',
  };

  const items = asArray(channel.item).map((it) => {
    const enclosure = it.enclosure || {};
    const guidRaw = it.guid;
    const guid = typeof guidRaw === 'object' ? guidRaw['#text'] : guidRaw;
    return {
      guid: String(guid || enclosure['@_url'] || it.title || crypto.randomUUID()),
      title: it.title || 'Ohne Titel',
      description: it['content:encoded'] || it.description || it['itunes:summary'] || '',
      enclosureUrl: enclosure['@_url'] || '',
      enclosureType: enclosure['@_type'] || 'audio/mpeg',
      length: Number(enclosure['@_length'] || 0),
      duration: parseDuration(it['itunes:duration']),
      pubDate: it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString(),
      // Folgen-eigenes Bild (fällt sonst auf das Podcast-Cover zurück).
      imageUrl: it['itunes:image']?.['@_href'] || it['media:thumbnail']?.['@_url'] || '',
    };
  });

  return { meta, items };
}

// Viele Podcast-Hosts liefern nur an Anfragen mit Browser-Kennung aus und
// antworten sonst mit einer leeren oder abweisenden Seite.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; PodcastStudio/1.0; +https://github.com/emefkaner/podcaster)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
};

// Holt eine URL als Text (Feed) bzw. als Datei (MP3/Cover).
async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow', headers: HEADERS });
  if (!res.ok) throw new Error(`Feed konnte nicht geladen werden (HTTP ${res.status}).`);
  const text = await res.text();
  if (!text.trim()) throw new Error('Der Feed kam leer zurück.');
  return { text, finalUrl: res.url, contentType: res.headers.get('content-type') || '' };
}

// Dateiendung aus einer Bild-URL ableiten (mit .jpg als Standard).
function imageExt(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.jpg';
  } catch {
    return '.jpg';
  }
}

// Lädt eine Datei stückweise auf die Platte, statt sie komplett in den
// Arbeitsspeicher zu holen – wichtig auf kleinen Instanzen mit wenig RAM.
async function downloadTo(url, dest) {
  const res = await fetch(url, { redirect: 'follow', headers: HEADERS });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status}) für ${url}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  return fs.statSync(dest).size;
}

// Importiert alle Folgen aus einem bestehenden Podcast-RSS-Feed.
// opts.rehost: MP3s in den eigenen Speicher kopieren (empfohlen für sauberen Umzug).
// opts.importMeta: Podcast-Infos + Cover übernehmen.
export async function importFeed(feedUrl, opts = {}) {
  const { rehost = true, importMeta = true, onProgress = () => {} } = opts;
  const { text: xml, finalUrl, contentType } = await fetchText(feedUrl);

  // Kam statt XML eine Webseite zurück, hilft die Fehlermeldung beim Suchen.
  if (/^\s*<!doctype html|^\s*<html/i.test(xml)) {
    throw new Error(
      `Unter dieser Adresse liegt eine Webseite statt eines RSS-Feeds ` +
      `(${contentType || 'unbekannter Typ'}${finalUrl !== feedUrl ? `, umgeleitet auf ${finalUrl}` : ''}). ` +
      `Bitte die echte RSS-Adresse verwenden.`
    );
  }

  const { meta, items } = parseFeed(xml);

  if (!items.length) {
    throw new Error(
      `Der Feed „${meta.title || 'ohne Titel'}" enthält keine Folgen ` +
      `(${Math.round(xml.length / 1024)} KB geladen${finalUrl !== feedUrl ? `, umgeleitet auf ${finalUrl}` : ''}). ` +
      `Stimmt die Adresse?`
    );
  }

  const result = { total: items.length, imported: 0, skipped: 0, metaImported: false, errors: [] };
  onProgress({ ...result, phase: `${items.length} Folgen gefunden – Podcast-Infos werden übernommen …` });

  // Podcast-Infos übernehmen (nur leere/Standard-Felder füllen, nichts überschreiben,
  // was du schon selbst gesetzt hast).
  if (importMeta) {
    const cur = getSettings();
    const patch = {};
    for (const k of ['title', 'description', 'author', 'ownerName', 'ownerEmail', 'language']) {
      if (meta[k] && (!cur[k] || cur[k] === 'Mein Podcast' || cur[k] === 'Ich' ||
          cur[k] === 'Beschreibung meines Podcasts.')) patch[k] = meta[k];
    }
    // Cover übernehmen (herunterladen + in den Speicher legen).
    if (meta.coverUrl && !cur.cover) {
      try {
        const ext = path.extname(new URL(meta.coverUrl).pathname) || '.jpg';
        const tmp = path.join(paths.tmp, `cover-import${ext}`);
        await downloadTo(meta.coverUrl, tmp);
        await uploadFile(tmp, `assets/cover${ext}`, ext === '.png' ? 'image/png' : 'image/jpeg');
        fs.rmSync(tmp, { force: true });
        patch.cover = `cover${ext}`;
      } catch (e) {
        result.errors.push(`Cover-Import: ${e.message}`);
      }
    }
    if (Object.keys(patch).length) { saveSettings(patch); result.metaImported = true; }
  }

  // Bereits importierte GUIDs überspringen (idempotent).
  const existing = new Set(listEpisodes().map((e) => e.importGuid).filter(Boolean));

  for (const item of items) {
    if (existing.has(item.guid)) { result.skipped++; continue; }
    if (!item.enclosureUrl) { result.skipped++; continue; }
    onProgress({ ...result, phase: `Übernehme „${item.title}" …` });

    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    let audioUrl = item.enclosureUrl;
    let audioKey = '';
    let size = item.length;

    if (rehost) {
      try {
        const tmp = path.join(paths.tmp, `${id}.mp3`);
        size = await downloadTo(item.enclosureUrl, tmp);
        audioKey = `episodes/${id}.mp3`;
        audioUrl = await uploadFile(tmp, audioKey, 'audio/mpeg');
        fs.rmSync(tmp, { force: true });
      } catch (e) {
        // Fällt auf den Original-Link zurück, statt den Import abzubrechen.
        result.errors.push(`${item.title}: ${e.message}`);
        audioUrl = item.enclosureUrl;
        audioKey = '';
      }
    }

    // Folgen-eigenes Bild übernehmen (falls vorhanden).
    let imageUrl = item.imageUrl;
    let imageKey = '';
    if (item.imageUrl && rehost) {
      try {
        const ext = imageExt(item.imageUrl);
        const tmp = path.join(paths.tmp, `img-${id}${ext}`);
        await downloadTo(item.imageUrl, tmp);
        imageKey = `episode-images/${id}${ext}`;
        imageUrl = await uploadFile(tmp, imageKey, ext === '.png' ? 'image/png' : 'image/jpeg');
        fs.rmSync(tmp, { force: true });
      } catch (e) {
        result.errors.push(`Bild „${item.title}": ${e.message}`);
        imageUrl = item.imageUrl; // Original-Link behalten
        imageKey = '';
      }
    }

    saveEpisode({
      id,
      title: item.title,
      description: item.description,
      transcript: '',
      status: 'published',        // Alt-Folgen sind bereits veröffentlicht
      importGuid: item.guid,
      rawTmp: '',
      audioKey,
      audioUrl,
      imageKey,
      imageUrl,
      duration: item.duration,
      size,
      enhance: { enabled: false, strength: 0 },
      error: '',
      createdAt: item.pubDate,
      publishedAt: item.pubDate,
    });
    result.imported++;
  }

  return result;
}
