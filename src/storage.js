import fs from 'node:fs';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config, paths } from './config.js';

// Speicher-Abstraktion.
//   - Wenn Cloudflare R2 konfiguriert ist: alle dauerhaften Dateien liegen in R2
//     (öffentliche MP3s/Cover + Metadaten-Backup). Lokale Platte = nur Zwischenspeicher.
//   - Sonst: Fallback auf lokale Platte unter DATA_DIR (zum Testen / kleiner Betrieb).

const r2 = config.r2;
const enabled = Boolean(r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket && r2.publicUrl);

let client = null;
if (enabled) {
  client = new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
}

export function storageEnabled() {
  return enabled;
}

// Öffentliche URL für einen R2-Key (bzw. lokalen /media-Pfad im Fallback).
export function publicUrl(key) {
  if (enabled) return `${r2.publicUrl.replace(/\/$/, '')}/${key}`;
  // Fallback: lokal ausgeliefert unter /media/<key>
  return `${config.publicUrl}/media/${key}`;
}

// Lokale Datei nach R2 hochladen (bzw. im Fallback an ihren /media-Platz kopieren).
export async function uploadFile(localPath, key, contentType) {
  if (enabled) {
    await client.send(new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      Body: fs.createReadStream(localPath),
      ContentLength: fs.statSync(localPath).size,
      ContentType: contentType,
    }));
    return publicUrl(key);
  }
  const dest = path.join(paths.data, 'media', key);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (path.resolve(dest) !== path.resolve(localPath)) fs.copyFileSync(localPath, dest);
  return publicUrl(key);
}

// R2-Objekt in eine lokale Datei laden (z. B. Intro/Outro vor der ffmpeg-Verarbeitung).
// Gibt den lokalen Pfad zurück, oder null wenn nicht vorhanden.
export async function downloadToFile(key, localPath) {
  if (!enabled) {
    const src = path.join(paths.data, 'media', key);
    return fs.existsSync(src) ? src : null;
  }
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    await streamToFile(res.Body, localPath);
    return localPath;
  } catch {
    return null;
  }
}

export async function deleteKey(key) {
  if (!key) return;
  if (enabled) {
    try { await client.send(new DeleteObjectCommand({ Bucket: r2.bucket, Key: key })); } catch {}
  } else {
    fs.rmSync(path.join(paths.data, 'media', key), { force: true });
  }
}

// ---- JSON-Persistenz (Metadaten). Bei R2 zusätzlich als Backup-Objekt. ----
export async function putJson(key, obj) {
  const body = JSON.stringify(obj, null, 2);
  if (enabled) {
    await client.send(new PutObjectCommand({
      Bucket: r2.bucket, Key: key, Body: body, ContentType: 'application/json',
    }));
  }
}

export async function getJson(key) {
  if (!enabled) return null;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: r2.bucket, Key: key }));
    const text = await streamToString(res.Body);
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- Stream-Helfer ----
function streamToFile(stream, dest) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    stream.pipe(out);
    stream.on('error', reject);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

function streamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
