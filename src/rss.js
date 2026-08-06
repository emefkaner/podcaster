import { config } from './config.js';
import { getSettings, listEpisodes } from './store.js';
import { formatDuration } from './audio.js';
import { publicUrl } from './storage.js';

// XML-Sonderzeichen maskieren.
function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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
    .filter((e) => e.status === 'published' && new Date(e.publishedAt).getTime() <= jetzt)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  const coverUrl = s.cover ? publicUrl(`assets/${s.cover}`) : '';

  const items = published
    .map((e) => {
      const audioUrl = e.audioUrl || '';
      const pubDate = new Date(e.publishedAt).toUTCString();
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
