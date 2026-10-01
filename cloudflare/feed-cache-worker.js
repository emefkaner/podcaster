// Cloudflare Worker: Zwischenspeicher für /feed.xml.
//
// Zweck: Podcast-Verzeichnisse fragen den Feed viel öfter ab, als sich etwas
// ändert — Render (Gratis-Plan) schläft nur nach 15 Minuten OHNE Aufruf ein,
// jeder Aufruf weckt ihn sofort wieder. Fragt irgendwer öfter als alle 15
// Minuten an, bleibt Render dauerhaft wach und die 750 Gratis-Instanzstunden
// sind schnell aufgebraucht.
//
// Ausdrücklicher Wunsch des Nutzers: Render soll NUR durch seine eigene
// Nutzung aufwachen (etwas speichern, oder auch nur die Seite aufrufen) —
// nie durch fremde Feed-Abfragen von außen. Deshalb holt dieser Worker fast
// nie von selbst neu, sondern wird aktiv geleert:
//
//   1. Bei jeder Änderung (neue Folge, Einstellungen): `src/store.js` ruft
//      sofort /purge?secret=… auf.
//   2. Bei JEDEM Seitenaufruf, beiläufig: `pruefeFaelligeFolgen()` in
//      `src/store.js` prüft, ob eine eingeplante Folge inzwischen fällig
//      geworden ist, und leert in dem Fall ebenfalls. So reicht es, dass der
//      Nutzer irgendwann nach dem Veröffentlichungstermin die App öffnet —
//      Render ist für diesen Aufruf ohnehin wach, das kostet nichts
//      zusätzlich.
//
// CACHE_SEKUNDEN ist NUR NOCH ein Sicherheitsnetz für den Fall, dass die
// Leerung mal fehlschlägt (falsches Geheimnis, Worker kurz down o. Ä.) — ohne
// das würde ein stiller Fehler den Feed für immer veralten lassen. Bewusst
// lang (7 Tage), damit dieses Sicherheitsnetz im Normalbetrieb nie zuschlägt
// und Render tatsächlich nur durch echte Nutzung aufwacht.
//
// Ursprungsadresse: die bestehende App bleibt unverändert erreichbar, dieser
// Worker fragt sie nur seltener ab, als es Verzeichnisse/Apps sonst täten.

const URSPRUNG = 'https://cinespasten.emefka.com/feed.xml';
const CACHE_SEKUNDEN = 7 * 24 * 60 * 60; // 7 Tage Sicherheitsnetz — siehe Begründung oben
const CACHE_KEY = new Request('https://feed-cache.internal/feed.xml', { method: 'GET' });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cache = caches.default;

    if (url.pathname === '/purge') {
      if (!env.PURGE_SECRET || url.searchParams.get('secret') !== env.PURGE_SECRET) {
        return new Response('Falsches oder fehlendes Geheimnis', { status: 403 });
      }
      await cache.delete(CACHE_KEY);
      return new Response('ok');
    }

    let antwort = await cache.match(CACHE_KEY);
    if (antwort) return antwort;

    const ursprungsAntwort = await fetch(URSPRUNG, {
      headers: { 'User-Agent': 'podcast3r-feed-cache-worker' },
    });

    // Fehler beim Ursprung (Render schläft/deployed gerade) NICHT zwischenspeichern —
    // sonst hängt der Fehler bis zu 7 Tage fest.
    if (!ursprungsAntwort.ok) return ursprungsAntwort;

    const body = await ursprungsAntwort.arrayBuffer();
    antwort = new Response(body, {
      status: 200,
      headers: {
        'content-type': ursprungsAntwort.headers.get('content-type') || 'application/rss+xml; charset=utf-8',
        'cache-control': `public, max-age=${CACHE_SEKUNDEN}`,
      },
    });

    ctx.waitUntil(cache.put(CACHE_KEY, antwort.clone()));
    return antwort;
  },
};
