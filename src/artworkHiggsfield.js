import fs from 'node:fs';
import path from 'node:path';
import { HiggsfieldClient } from '@higgsfield/client';
import { config } from './config.js';

// Cover-Erzeugung über Higgsfield. Nutzt den Soul-Modus, der Referenzbilder
// auswertet und dadurch Gesichter über mehrere Bilder hinweg wiedererkennbar hält.
// Wird verwendet, wenn Zugangsdaten hinterlegt sind – sonst greift Gemini.

const ENDPUNKT = '/v1/text2image/soul';

export function higgsfieldVerfuegbar() {
  return Boolean(config.higgsfield.apiKey && config.higgsfield.apiSecret);
}

function clientHolen() {
  return new HiggsfieldClient({
    apiKey: config.higgsfield.apiKey,
    apiSecret: config.higgsfield.apiSecret,
  });
}

const FORMAT_NACH_ENDUNG = { '.jpg': 'jpeg', '.jpeg': 'jpeg', '.png': 'png', '.webp': 'webp' };

/**
 * Erzeugt Cover-Vorschläge aus Referenzbildern und einer Beschreibung.
 * @returns {Promise<{data: Buffer, mimeType: string}[]>}
 */
export async function higgsfieldVorschlaege({ basePaths, prompt, count = 3 }) {
  if (!higgsfieldVerfuegbar()) throw new Error('Higgsfield-Zugangsdaten fehlen.');
  const bilder = (basePaths || []).filter((p) => p && fs.existsSync(p));
  if (!bilder.length) throw new Error('Kein Ausgangsbild hinterlegt.');

  const client = clientHolen();
  try {
    // Referenzbilder hochladen – Higgsfield erwartet Adressen, keine Rohdaten.
    const referenzen = [];
    for (const datei of bilder.slice(0, 4)) {
      const format = FORMAT_NACH_ENDUNG[path.extname(datei).toLowerCase()] || 'jpeg';
      const url = await client.uploadImage(fs.readFileSync(datei), format);
      referenzen.push(url);
    }

    const ergebnis = await client.generate(ENDPUNKT, {
      params: {
        prompt,
        quality: '1080p',
        aspect_ratio: '1:1',          // Podcast-Cover sind quadratisch
        batch_size: Math.min(4, Math.max(1, count)),
        image_reference: referenzen.map((url) => ({ type: 'image_url', image_url: url })),
        image_reference_strength: 0.8, // hoch, damit die Gesichter erhalten bleiben
      },
    });

    // Fertige Bilder herunterladen.
    const bilderRaus = [];
    for (const job of ergebnis?.jobs || []) {
      const url = job?.results?.raw?.url || job?.results?.min?.url || job?.result?.url;
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok) continue;
      bilderRaus.push({
        data: Buffer.from(await res.arrayBuffer()),
        mimeType: res.headers.get('content-type') || 'image/jpeg',
      });
    }

    if (!bilderRaus.length) throw new Error('Higgsfield lieferte keine Bilder zurück.');
    return bilderRaus;
  } finally {
    client.close?.();
  }
}
