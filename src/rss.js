import { config } from './config.js';
import { getSettings, listEpisodes, coverUrlOf } from './store.js';
import { formatDuration } from './audio.js';

// XML-Sonderzeichen maskieren.
function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Das Datum, mit dem eine Folge im Feed steht.
//
// Hier lauerten zwei Fehler, die beide dazu führten, dass eine Folge in der
// App als „Veröffentlicht" dastand, in der Podcast-App aber nicht auftauchte:
//   1. Ein unlesbares Datum ergab NaN. Der Vergleich `NaN <= jetzt` ist false,
//      also fiel die Folge stillschweigend aus dem Feed.
//   2. Fehlte das Datum ganz, machte `new Date(null)` daraus den 1.1.1970 —
//      die Folge stand zwar im Feed, aber ganz unten, Jahrzehnte hinter allen
//      anderen. In der Podcast-App sieht das aus wie „nicht da".
// Deshalb: nur ein wirklich lesbares Datum zählt, sonst das Anlagedatum, sonst
// jetzt. Eine veröffentlichte Folge verschwindet nie wegen eines Datums.
export function feedDatum(e) {
  for (const wert of [e.publishedAt, e.createdAt]) {
    const d = new Date(wert);
    if (wert && !isNaN(d.getTime())) return d;
  }
  return new Date();
}

// Erst ab dem Termin in den Feed – aber nur, wenn der Termin auch lesbar ist.
export function istEingeplant(e, jetzt = Date.now()) {
  const d = new Date(e.publishedAt);
  return Boolean(e.publishedAt) && !isNaN(d.getTime()) && d.getTime() > jetzt;
}

// Baut einen Podcast-RSS-Feed 2.0 inkl. iTunes-Tags.
// Genau dieses Format erwartet Spotify for Podcasters beim einmaligen Eintragen.
export function buildFeed() {
  const s = getSettings();
  const base = config.publicUrl;
  // Nur Folgen aufnehmen, deren Zeitpunkt erreicht ist. Für später eingeplante
  // Folgen bleibt der Feed unverändert, bis der Termin da ist.
  const jetzt = Date.now();
  const published = listEpisodes()
    .filter((e) => e.status === 'published' && !istEingeplant(e, jetzt))
    .sort((a, b) => feedDatum(b) - feedDatum(a));

  const coverUrl = coverUrlOf(s);

  const items = published
    .map((e) => {
      const audioUrl = e.audioUrl || '';
      const pubDate = feedDatum(e).toUTCString();
      // Beim Import behalten wir die Original-GUID, damit Spotify/Apple die Folge
      // als dieselbe wiedererkennen und keine Dubletten anlegen.
      const guid = e.importGuid || e.id;
      return `    <item>
      <title>${esc(e.title)}</title>
      <description>${esc(e.description)}</description>
      <itunes:summary>${esc(e.description)}</itunes:summary>
      <content:encoded><![CDATA[${e.description || ''}]]></content:encoded>
      <enclosure url="${esc(audioUrl)}" length="${e.size || 0}" type="audio/mpeg"/>
      <guid isPermaLink="false">${esc(guid)}</guid>
      <pubDate>${pubDate}</pubDate>
      <itunes:duration>${formatDuration(e.duration || 0)}</itunes:duration>
      <itunes:explicit>${s.explicit ? 'true' : 'false'}</itunes:explicit>
${e.imageUrl ? `      <itunes:image href="${esc(e.imageUrl)}"/>\n` : ''}    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(s.title)}</title>
    <link>${esc(base)}</link>
    <language>${esc(s.language || 'de')}</language>
    <description>${esc(s.description)}</description>
    <itunes:summary>${esc(s.description)}</itunes:summary>
    <itunes:author>${esc(s.author)}</itunes:author>
    <itunes:type>episodic</itunes:type>
    <itunes:explicit>${s.explicit ? 'true' : 'false'}</itunes:explicit>
    <itunes:category text="${esc(s.category || 'Society & Culture')}"/>
    ${coverUrl ? `<itunes:image href="${esc(coverUrl)}"/>` : ''}
    <itunes:owner>
      <itunes:name>${esc(s.ownerName)}</itunes:name>
      <itunes:email>${esc(s.ownerEmail)}</itunes:email>
    </itunes:owner>
${items}
  </channel>
</rss>`;
}
