import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';

// Sprachverbesserung über die Dolby.io Media Enhance API.
//
// Warum nicht Adobe: Adobes eigene Übersicht der Audio/Video-APIs
// (developer.adobe.com/audio-video-firefly-services) listet Reframe,
// Translate & Lip Sync, Text-to-Speech, Text-to-Avatar und Dynamic Graphics
// Render – aber KEINE Sprachverbesserung. „Enhance Speech" gibt es nur in
// Adobes eigener Oberfläche, nicht als Schnittstelle.
//
// Ablauf laut Dolbys eigener Postman-Sammlung
// (dolbyio-samples/media-api-samples, postman/collections/Enhance...json):
//   1. POST /media/input   -> liefert eine Adresse zum Hochladen
//   2. PUT  <diese Adresse> -> Datei hochladen
//   3. POST /media/enhance -> liefert eine job_id
//   4. GET  /media/enhance?job_id=… -> Status abfragen, bis „Success"
//   5. GET  /media/output?url=dlb://… -> Ergebnis herunterladen

const BASIS = 'https://api.dolby.com';

// Wie oft nachgefragt wird und wann abgebrochen wird. Dolby rechnet in der
// Regel schneller als Echtzeit; 45 Minuten sind für eine zweistündige Folge
// reichlich bemessen.
const ABFRAGE_ABSTAND_MS = 5000;
const HOECHSTDAUER_MS = 45 * 60 * 1000;

export function dolbyAktiv() {
  return Boolean(config.dolby.key);
}

// ---- Regler -> API-Parameter -------------------------------------------
//
// ACHTUNG, hier steckt die einzige ungeprüfte Stelle: Dolbys Referenzseite
// (docs.dolby.io) ist von der Entwicklungsumgebung aus nicht erreichbar.
// Wörtlich belegt sind nur `content.type`, `audio.noise.reduction.amount`
// und `audio.speech.isolation.enable` – die stammen aus einem Beispiel von
// Dolby selbst. `audio.speech.isolation.amount` ist plausibel, aber nicht
// nachgelesen. Deshalb baut `enhanceKoerper` den Körper in zwei Stufen und
// `verbessern` versucht es bei einer Abweisung noch einmal ohne die
// ungeprüften Felder – statt die ganze Folge scheitern zu lassen.

// Dolby kennt für die Rauschunterdrückung vier feste Stufen, keine Prozente.
// Deshalb ist auch der Regler in der App vierstufig – ein stufenloser Regler
// würde eine Feinheit vortäuschen, die es nicht gibt (und „0 %" würde ein
// Abschalten versprechen, das die Stufe „low" gar nicht leistet).
export const RAUSCH_STUFEN = ['low', 'medium', 'high', 'max'];
export const RAUSCH_NAMEN = ['leicht', 'mittel', 'stark', 'maximal'];

function stufe(index) {
  const i = Math.round(Number(index));
  if (!Number.isFinite(i)) return RAUSCH_STUFEN[1];
  return RAUSCH_STUFEN[Math.min(RAUSCH_STUFEN.length - 1, Math.max(0, i))];
}

function prozent(wert, standard = 0) {
  const n = Number(wert);
  if (!Number.isFinite(n)) return standard;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function enhanceKoerper(regler = {}, { nurGeprueft = false } = {}) {
  const sprache = prozent(regler.sprache, 0);

  const audio = {
    noise: { reduction: { amount: stufe(regler.rauschen ?? 1) } },
    speech: { isolation: { enable: sprache > 0 } },
  };
  if (!nurGeprueft && sprache > 0) {
    audio.speech.isolation.amount = sprache;
  }
  return { content: { type: 'podcast' }, audio };
}

// ---- HTTP-Helfer -------------------------------------------------------

async function api(pfad, { method = 'GET', body = null } = {}) {
  const res = await fetch(`${BASIS}${pfad}`, {
    method,
    headers: {
      'x-api-key': config.dolby.key,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let daten = null;
  try { daten = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
  if (!res.ok) {
    const grund = daten?.detail || daten?.title || text.slice(0, 300) || `HTTP ${res.status}`;
    const fehler = new Error(`Dolby ${method} ${pfad}: ${grund}`);
    fehler.status = res.status;
    throw fehler;
  }
  return daten;
}

async function hochladen(zielUrl, datei) {
  const groesse = fs.statSync(datei).size;
  const res = await fetch(zielUrl, {
    method: 'PUT',
    headers: { 'Content-Length': String(groesse) },
    body: Readable.toWeb(fs.createReadStream(datei)),
    duplex: 'half',
  });
  if (!res.ok) {
    throw new Error(`Hochladen zu Dolby fehlgeschlagen: HTTP ${res.status}`);
  }
}

async function herunterladen(dlbUrl, ziel) {
  const res = await fetch(`${BASIS}/media/output?url=${encodeURIComponent(dlbUrl)}`, {
    headers: { 'x-api-key': config.dolby.key },
  });
  if (!res.ok) {
    throw new Error(`Ergebnis von Dolby holen fehlgeschlagen: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(ziel));
}

// ---- Hauptweg ----------------------------------------------------------

/**
 * Schickt eine Audiodatei zu Dolby und legt das Ergebnis unter `ziel` ab.
 *
 * @param {object}   opts
 * @param {string}   opts.datei  Pfad zur Eingangsdatei
 * @param {string}   opts.ziel   Pfad, unter dem das Ergebnis landen soll
 * @param {object}   opts.regler { rauschen: 0..100, sprache: 0..100 }
 * @param {Function} opts.melde  (text, prozent) für die Fortschrittsanzeige
 * @returns {Promise<{jobId: string, hinweis: string}>}
 */
export async function dolbyVerbessern({ datei, ziel, regler = {}, melde = () => {} }) {
  if (!dolbyAktiv()) {
    throw new Error('Kein Dolby-Schlüssel hinterlegt (Umgebungsvariable DOLBY_API_KEY).');
  }
  if (!fs.existsSync(datei)) throw new Error(`Datei nicht gefunden: ${datei}`);

  const kennung = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const eingang = `dlb://podcast3r/${kennung}-in.mp3`;
  const ausgang = `dlb://podcast3r/${kennung}-out.mp3`;
  let hinweis = '';

  melde('Aufnahme wird zu Dolby geschickt …', 0);
  const { url: putUrl } = await api('/media/input', { method: 'POST', body: { url: eingang } });
  await hochladen(putUrl, datei);

  melde('Dolby verbessert die Sprache …', 0);
  let job;
  try {
    job = await api('/media/enhance', {
      method: 'POST',
      body: { input: eingang, output: ausgang, ...enhanceKoerper(regler) },
    });
  } catch (err) {
    // Nur bei einer Abweisung wegen des Körpers noch einmal versuchen – dann
    // ohne die Felder, die ich nicht nachlesen konnte.
    if (err.status !== 400 && err.status !== 422) throw err;
    hinweis = `Dolby hat die ausführlichen Regler abgelehnt (${err.message}). `
            + 'Es lief mit den Grundeinstellungen weiter.';
    console.warn(hinweis);
    job = await api('/media/enhance', {
      method: 'POST',
      body: { input: eingang, output: ausgang, ...enhanceKoerper(regler, { nurGeprueft: true }) },
    });
  }

  const jobId = job?.job_id;
  if (!jobId) throw new Error('Dolby hat keine job_id geliefert.');

  const start = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, ABFRAGE_ABSTAND_MS));
    const stand = await api(`/media/enhance?job_id=${encodeURIComponent(jobId)}`);
    const status = String(stand?.status || '');
    if (status === 'Success') break;
    if (status === 'Failed' || status === 'Cancelled') {
      throw new Error(`Dolby meldet „${status}": ${stand?.error?.message || 'kein Grund genannt'}`);
    }
    melde('Dolby verbessert die Sprache …', Number(stand?.progress) || 0);
    if (Date.now() - start > HOECHSTDAUER_MS) {
      throw new Error('Dolby war nach 45 Minuten noch nicht fertig – abgebrochen.');
    }
  }

  melde('Verbesserte Aufnahme wird geholt …', 100);
  await herunterladen(ausgang, ziel);
  return { jobId, hinweis };
}
