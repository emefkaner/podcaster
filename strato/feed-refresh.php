<?php
// feed-refresh.php — der „Pförtner" für den Podcast-Feed, auf dem Strato-Webspace.
//
// Was es tut: Wird es mit dem richtigen Geheimnis aufgerufen, holt es EINMAL den
// Feed von der App auf Render und legt ihn als statische Datei `feed.xml` in
// denselben Ordner. Spotify/Apple & Co. lesen dann diese statische Datei — die
// liefert Apache aus, ohne dass Render davon je etwas mitbekommt.
//
// Wer ruft es auf: ausschließlich podcast3r selbst (Umgebungsvariable
// FEED_MIRROR_PURGE_URL auf Render), und zwar nach jeder Änderung, bei fällig
// gewordenen eingeplanten Folgen und beim Serverstart. Render ist in diesen
// Momenten ohnehin wach — der Rückruf hierher kostet also nichts zusätzlich.
//
// Einrichtung: siehe README.md in diesem Ordner. Das Geheimnis unten VOR dem
// Hochladen eintragen — mit dem Platzhalter verweigert das Skript jede Arbeit.

declare(strict_types=1);

const URSPRUNG  = 'https://cinespasten.emefka.com/feed.xml';
const ZIEL      = __DIR__ . '/feed.xml';
const GEHEIMNIS = 'HIER-EIN-LANGES-ZUFALLSWORT-EINTRAGEN';

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

if (GEHEIMNIS === 'HIER-EIN-LANGES-ZUFALLSWORT-EINTRAGEN') {
    http_response_code(500);
    exit("Geheimnis in feed-refresh.php noch nicht eingetragen\n");
}
if (!isset($_GET['secret']) || !hash_equals(GEHEIMNIS, (string) $_GET['secret'])) {
    http_response_code(403);
    exit("Falsches oder fehlendes Geheimnis\n");
}

// Mit curl statt file_get_contents: allow_url_fopen ist auf Shared Hosting nicht
// garantiert, die curl-Erweiterung schon. Großzügige Wartezeit, falls Render
// gerade erst aufwacht (laut Render-Doku bis zu ~1 Minute).
$ch = curl_init(URSPRUNG);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT        => 120,
    CURLOPT_USERAGENT      => 'podcast3r-feed-refresh',
]);
$xml    = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$fehler = curl_error($ch);
curl_close($ch);

// Nur ein echter, vollständiger Feed darf die alte Datei ersetzen. Ein
// Fehlertext oder eine leere Antwort würde sonst den funktionierenden Feed
// überschreiben — dann wäre der Podcast für alle Apps verschwunden.
if ($xml === false || $status !== 200 || !str_starts_with(ltrim($xml), '<?xml') || !str_contains($xml, '</rss>')) {
    http_response_code(502);
    exit("Feed von Render nicht bekommen (HTTP $status) $fehler\n");
}

// Erst in eine Hilfsdatei schreiben, dann umbenennen: So sieht ein Abrufer nie
// eine halb geschriebene Datei.
$tmp = ZIEL . '.tmp';
if (file_put_contents($tmp, $xml) === false || !rename($tmp, ZIEL)) {
    http_response_code(500);
    exit("Konnte feed.xml nicht schreiben (Schreibrechte im Ordner?)\n");
}

echo 'ok ' . strlen($xml) . " Bytes\n";
