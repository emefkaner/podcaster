# Übergabe an die lokale Claude-Sitzung — Stand 01.10.2026

Diese Datei fasst alles zusammen, was eine neue Sitzung auf dem Rechner des
Nutzers wissen muss, um die angefangene Arbeit fortzusetzen. Sie enthält
**keine Geheimnisse** und liegt deshalb im Repo. Zuerst lesen, dann
`CLAUDE.md` (Arbeitsregeln und alle früheren Entscheidungen) und
`cover-vorlagen/README.md` (Cover-Erzeugung). Beide liegen im Repo und werden
von einer lokalen Claude-Code-Sitzung automatisch geladen.

## 1. Das Projekt in drei Sätzen

**podcast3r** ist die selbstgebaute Produktions-App für den deutschen
Filmpodcast **CINESPASTEN** (Nutzer: emefka). Node 22 / Express (ESM), gehostet
auf **Render** (Gratis-Plan), Dateien auf **Cloudflare R2**, Domain
`cinespasten.emefka.com`. Die App nimmt Folgen auf bzw. entgegen, bereinigt den
Klang (RNNoise + ffmpeg), hängt Intro/Outro an, transkribiert (Gemini),
schreibt einen Infotext und veröffentlicht über den eigenen RSS-Feed.

| Was | Wo |
|---|---|
| Laufende App | `https://cinespasten.emefka.com` |
| Feed (aktuell noch direkt auf Render) | `https://cinespasten.emefka.com/feed.xml` |
| Render-Dashboard | `https://dashboard.render.com/` → Dienst `podcast-studio` |
| Produktions-Repo (davon baut Render, Branch `master`) | `https://github.com/emefkaner/podcaster` |
| Arbeits-Repo der Cloud-Sitzung | `https://github.com/emefkaner/basic`, Branch `claude/podcast-website-auto-publish-ltemxp` |
| Strato-Webspace (`www.emefka.com`) | Apache 2.4, HTTPS mit gültigem Zertifikat, PHP 8.4, SSH/SFTP |
| Öffentliche R2-Adresse | `https://pub-49c743a8f5c248e39e2747a101eaf3f2.r2.dev` |

**Push-Regel:** Jede Änderung in **beide** Repos. Bei `podcaster`:
`git push origin main && git push origin main:master` — Render baut `master`.
Letzte Stände beim Schreiben dieser Datei: `basic` fba8b1a, `podcaster`
db960e1 (inhaltlich identisch).

## 2. Regeln, die immer gelten

Kurzfassung — ausführlich in `CLAUDE.md`:

- **Nicht raten — überprüfen.** Vor jeder Behauptung Code lesen, Aufruf
  ausführen, im Browser testen. Unsicherheit benennen. Bei Unklarheit fragen.
- **Anleitungen für den Nutzer:** nummeriert, ein Schritt = eine Handlung,
  vollständige Adressen, Beschriftungen wörtlich, Erfolgskriterium und was bei
  Misserfolg zu tun ist. Kein Fließtext zwischen den Schritten.
- **Deutsch** in Antworten und Commit-Nachrichten.
- **Sicherheit:**
  - `podcaster` ist **öffentlich**. Keine Geheimnisse, keine Fotos der
    Podcaster ins Repo. `SETUP-WERTE.md`, `gesichter/`, `strato/*.local.php`,
    `strato/GEHEIMNIS.txt` sind per `.gitignore` ausgeschlossen.
  - Die ausgefüllte `feed-refresh.php` (mit echtem Geheimnis) darf **nie**
    committet werden. Repo-Fassung behält den Platzhalter.
  - Kein Modellname (z. B. „claude-…") in Commits, Code-Kommentaren oder
    gepushten Dateien.
  - `nurArbeitsdateiLoeschen()` in `src/routes/episodes.js` behalten — es löscht
    nur unter `paths.tmp` und schützt die Originalaufnahmen.
  - Testskripte gehören nicht ins Repo (Kritzelordner/Scratchpad nutzen).
    Altlast, geprüft: Im Repo-Wurzelverzeichnis sind `_e2e.mjs`, `_e2e2.mjs`,
    `_swtest.mjs`, `_ui2.mjs`, `_uitest.mjs`, `_wasmtest.mjs`, `_wasmtest2.mjs`
    (zusammen 244 Zeilen, seit Commit c82801e) **getrackt** — Testskripte aus
    früheren Sitzungen, die gegen diese Regel verstoßen. Kandidaten zum
    Entfernen; vorher den Nutzer fragen, nichts davon wird von der App oder
    vom Rauchtest gebraucht (`test/smoke.mjs` ist der einzige Test).
- **Immer nur ein Bild auf einmal** bei der Cover-Erzeugung; Details und
  Higgsfield-Kennungen der Gesichter in `cover-vorlagen/README.md`.

## 3. Die aktuelle Aufgabe: Feed-Kopie auf dem Strato-Webspace

### 3.1 Warum (verifiziert, nicht vermutet)

Render meldete 617 (26.09.) und dann 696 (30.09.) von 750 Gratis-
Instanzstunden — der Dienst war praktisch rund um die Uhr wach. Aus Renders
eigener Doku (`render.com/docs/free`, `render.com/docs/compute-plans`):

- Ein Gratis-Webdienst schläft nach **15 Minuten ohne eingehende Anfrage** ein;
  **jede** Anfrage weckt ihn (Aufwachen dauert ~1 Minute).
- Die Instanzstunde läuft, solange er wach ist — egal wie schnell die Antwort.
- Die 15 Minuten sind **nicht einstellbar**. Ein Zwischenspeicher **in** der
  App hilft nicht, weil die Anfrage trotzdem bei Render ankommen muss.
- Der bezahlte Compute-Plan `0.5c-512mb` (alter Name „Starter", 7 $/Monat)
  hat weder Schlafgrenze noch Stundenlimit. Compute-Plan ≠ Workspace-Plan;
  umstellbar im Dashboard: Dienst → **Compute** → **Edit** → Plan wählen →
  **Save**. Dann auch `render.yaml` (`plan: free`) anpassen, sonst fällt ein
  Blueprint-Sync eventuell zurück.

Wer so oft anfragt, ist unbekannt (Apple-/Spotify-Crawler, Podcast-Apps, evtl.
ein Uptime-Monitor) — nur in Renders Dashboard → **Logs** einsehbar.

**Wunsch des Nutzers, wörtlich:** Render soll **nur** durch seine eigene
Nutzung aufwachen (etwas speichern oder auch nur die Seite aufrufen), nie durch
fremde Feed-Abfragen. Eingeplante Folgen liegen höchstens 48 h in der Zukunft;
eine Verzögerung bis dahin ist ausdrücklich in Ordnung.

### 3.2 Was gebaut ist

Ein „Pförtner" **vor** Render: eine statische Datei auf dem Webspace, die
Apache ausliefert, plus ein Skript, das sie auf Zuruf der App erneuert.

| Datei | Zweck |
|---|---|
| `strato/feed-refresh.php` | Holt mit richtigem `?secret=` einmal `https://cinespasten.emefka.com/feed.xml` von Render und schreibt `feed.xml` in denselben Ordner. Ersetzt die Datei **nur** durch einen vollständigen Feed (`<?xml` am Anfang, `</rss>` enthalten) — eine Fehlerseite kann die Kopie nie überschreiben. Schreibt erst in `.tmp`, dann `rename` (atomar). Mit Platzhalter-Geheimnis verweigert es jede Arbeit (HTTP 500). Falsches Geheimnis → HTTP 403 mit Zeichenzahlen (angekommen / in der Datei), Hinweis bei Leerzeichen (ein `+` in der Adresse wird zum Leerzeichen). |
| `strato/README.md` | Schritt-für-Schritt-Anleitung mit Fehlertabelle. |
| `src/store.js` → `feedSpiegelAuffrischen(anlass)` | Fire-and-forget-GET auf `FEED_MIRROR_PURGE_URL`; HTTP-Fehler und Netzfehler landen mit Anlass im Log (`Feed-Spiegel auffrischen (…) fehlgeschlagen`). Ohne gesetzte Variable: tut nichts. |
| `src/store.js` → `writeJson()` | Ruft nach jeder Änderung an Folgen/Einstellungen `feedSpiegelAuffrischen('Änderung')`. |
| `src/store.js` → `pruefeFaelligeFolgen()` | Läuft per Middleware in `src/server.js` bei **jedem** Aufruf. Ist eine eingeplante Folge inzwischen fällig, wird einmal aufgefrischt (`'fällige Folge'`); Modul-Merker `faelligkeitStand` verhindert Wiederholung. |
| `src/server.js` | Middleware für `pruefeFaelligeFolgen()`; im `listen()`-Callback `feedSpiegelAuffrischen('Serverstart')` — ersetzt jedes Zeitnetz (das würde Render ohne Zutun wecken). Muss NACH `listen()` stehen, das Skript ruft `/feed.xml` zurück. |
| `src/rss.js` | Gibt `<itunes:new-feed-url>` aus, wenn `FEED_MIRROR_URL` gesetzt ist — damit Verzeichnisse umziehen können (derselbe Mechanismus wie beim erfolgreichen Anchor-Umzug: GUIDs bleiben stabil, `e.importGuid || e.id`). |
| `src/config.js` | `feedMirrorUrl` (env `FEED_MIRROR_URL`), `feedMirrorPurgeUrl` (env `FEED_MIRROR_PURGE_URL`). Name „PURGE" stammt vom früheren Cloudflare-Worker; bewusst nicht umbenannt. |
| `render.yaml` | Beide Variablen als `sync: false` eingetragen. |

Beide Variablen leer = Verhalten exakt wie vor dem Umbau (Rauchtest 33/33).

Beim Serverstart löst zusätzlich `seedAssets()` → `saveSettings()` einmal eine
Auffrischung aus — harmlos, kein Fehler.

Verworfene Alternativen (nicht wieder aufrollen, Begründung in `CLAUDE.md`):
Cloudflare Worker (zu umständlich für den Nutzer; Code in der Git-Historie bis
`6fd2d97`), Cloudflare vor die ganze Domain (DNS/E-Mail-Umzug, Ausfallrisiko),
Feed direkt auf `r2.dev` (laut Cloudflare „rate-limited", „development
purposes only", „cannot guarantee consistent reliability").

Warum PHP statt Python: Apache führt `.php` direkt aus; Python liefe auf Strato
als CGI mit drei zusätzlichen Fehlerquellen (Ausführrechte, Interpreter-Pfad,
Handler). Das Strato-Paket des Nutzers hat beides.

### 3.3 Was verifiziert ist und wie man es nachstellt

Lokal durchgespielt (PHP 8.4 mit curl): App auf Port 3998 als „Render",
`php -S` als „Strato". Ergebnisse: Serverstart erzeugt `feed.xml`; falsches
Geheimnis → 403 mit Zeichenzahlen; Platzhalter → 500; Erfolg → `ok N Bytes`;
Titel per `PUT /api/settings` geändert → Kopie trägt den neuen Titel; Ursprung
auf eine HTML-Seite umgebogen → 502 und Kopie unverändert. Rauchtest 33/33.

Nachstellen:

```bash
npm install
S=/tmp/strato-test; rm -rf $S; mkdir -p $S/web $S/data
sed -e "s#https://cinespasten.emefka.com/feed.xml#http://127.0.0.1:3998/feed.xml#" \
    -e "s#HIER-EIN-LANGES-ZUFALLSWORT-EINTRAGEN';#testgeheimnis';#" \
    strato/feed-refresh.php > $S/web/feed-refresh.php
php -S 127.0.0.1:8769 -t $S/web &
APP_PASSWORD=t DATA_DIR=$S/data PORT=3998 R2_ACCOUNT_ID= GEMINI_API_KEY= \
  FEED_MIRROR_URL=http://127.0.0.1:8769/feed.xml \
  FEED_MIRROR_PURGE_URL="http://127.0.0.1:8769/feed-refresh.php?secret=testgeheimnis" \
  node src/server.js &
sleep 3; ls -l $S/web/feed.xml            # vom Serverstart erzeugt
curl "http://127.0.0.1:8769/feed-refresh.php?secret=falsch"          # 403
curl "http://127.0.0.1:8769/feed-refresh.php?secret=testgeheimnis"   # ok N Bytes
```

Rauchtest: `node test/smoke.mjs` (lokal ohne `PLAYWRIGHT_CHROMIUM`, wenn
Playwright seinen Browser selbst hat; sonst Pfad setzen).

### 3.4 Wo die Einrichtung gerade steht

Der Nutzer hat Schritt A der Anleitung begonnen: Skript bearbeitet, per SFTP in
`www.emefka.com/cinespasten/` hochgeladen, aufgerufen — Antwort:
**„Falsches oder fehlendes Geheimnis"**. Das heißt: Datei liegt richtig, PHP
läuft, Adresse stimmt; nur der Vergleich scheitert. Wahrscheinlichste Ursache:
Das Wort hinter `?secret=` ist nicht byteweise das Wort zwischen den
Anführungszeichen in der Datei (Tippfehler, Groß-/Kleinschreibung,
Sonderzeichen, mitkopierte Anführungszeichen, oder in der Adresse stand noch
der Platzhalter `DEINGEHEIMNIS`). Auf dem Webspace liegt noch die **alte**
Skriptfassung ohne Zeichenzahlen in der Meldung; die neue (fba8b1a) ist im
Repo.

Der Nutzer empfand den Fernweg (Anleitung → er klickt → Rückfrage) als zu
unflexibel und wechselt deshalb auf eine lokale Sitzung mit direktem SFTP-
Zugriff. **Ab hier übernimmt die lokale Sitzung die Schritte selbst.**

### 3.5 Was die lokale Sitzung jetzt tun soll

Vorab klären (fragen, falls nicht aus dem Umfeld ersichtlich): SFTP-Host,
Benutzer, Zugang (Passwort oder Schlüssel) für den Strato-Webspace; welcher
Ordner dort der Web-Wurzelordner von `www.emefka.com` ist (per `ls` über SFTP
herausfinden — dort liegen die Dateien der bestehenden Website).

1. Geheimnis erzeugen: `openssl rand -hex 16` (32 Zeichen, nur `0-9a-f`, damit
   nichts in einer Adresse umkodiert wird). In `strato/GEHEIMNIS.txt` ablegen
   (gitignored) und dem Nutzer einmal zeigen — er braucht es für Render.
2. Ausgefüllte Kopie bauen (gitignored):
   `sed "s#HIER-EIN-LANGES-ZUFALLSWORT-EINTRAGEN#$(cat strato/GEHEIMNIS.txt)#" strato/feed-refresh.php > strato/feed-refresh.local.php`
   Danach `git status` — die beiden Dateien dürfen nicht auftauchen.
3. Per SFTP in `<Webwurzel>/cinespasten/` die Kopie **als `feed-refresh.php`**
   hochladen (die vorhandene alte Fassung überschreiben).
4. Prüfen:
   `curl -s "https://www.emefka.com/cinespasten/feed-refresh.php?secret=$(cat strato/GEHEIMNIS.txt)"`
   Erwartet: `ok N Bytes` (beim ersten Mal bis ~1 Minute, Render wacht auf).
   Jede andere Meldung nennt die Ursache; Tabelle in `strato/README.md`.
5. Gegenprobe: `curl -s https://www.emefka.com/cinespasten/feed.xml | head -c 300`
   und zählen: `curl -s https://www.emefka.com/cinespasten/feed.xml | grep -c '<item>'`
   muss der Folgenzahl von `https://cinespasten.emefka.com/feed.xml` entsprechen.
6. Render — das kann nur der Nutzer im Browser; Anleitung dafür geben:
   `https://dashboard.render.com/` → `podcast-studio` → **Environment** →
   zwei Variablen anlegen:
   - `FEED_MIRROR_URL` = `https://www.emefka.com/cinespasten/feed.xml`
   - `FEED_MIRROR_PURGE_URL` = `https://www.emefka.com/cinespasten/feed-refresh.php?secret=<Geheimnis>`
   → **Save Changes**. (Alternative ohne Klicken: Render REST-API mit API-Key
   des Nutzers — nur wenn er das will.)
   Erfolg: `curl -s https://cinespasten.emefka.com/feed.xml | grep new-feed-url`
   zeigt die Strato-Adresse; im Render-Log beim Start keine Zeile
   `Feed-Spiegel auffrischen (Serverstart) fehlgeschlagen`.
7. Spotify for Podcasters (und ggf. Apple Podcasts Connect): Feed-Adresse auf
   `https://www.emefka.com/cinespasten/feed.xml` umstellen — nur der Nutzer.
   **Ohne diesen Schritt klingeln die Verzeichnisse weiter bei Render.**
8. Nachkontrolle nach 2–3 Tagen: Render-Dashboard → Instanzstunden. Erwartung:
   nur noch wenige Stunden pro Tag statt ~24.
9. Optional, falls Strato Cronjobs anbietet: **nicht** als Zeitnetz auf das
   Skript legen — das würde Render wecken. Gewollt ist: kein Zeitnetz.

Falls Strato wider Erwarten hakt (curl-Erweiterung fehlt, Ordner nicht
beschreibbar, kein Ausgang ins Netz): Rückfalloption ist der Render-Compute-
Plan für 7 $/Monat (3.1). Vorher den Nutzer fragen — es ist sein Geld.

### 3.6 Nicht verifiziert

- Stratos tatsächliche PHP-Konfiguration (curl, Schreibrechte, ausgehende
  Verbindungen) — zeigt sich in Schritt 4.
- Ob Renders Instanzstunden danach wirklich sinken — erst nach Schritt 7 und
  ein paar Tagen sichtbar.
- Ob ein Spotify-/Apple-Crawler die `<itunes:new-feed-url>` von allein
  übernimmt. Beim Anchor-Umzug hat die manuelle Umstellung plus 301
  funktioniert; auf das Tag allein nicht verlassen.
- Beschriftungen im Strato-Kundenbereich (Hilfeseiten laden nur mit
  JavaScript; der Produktvergleich auf `strato.de/hosting` war lesbar).

## 4. Offene Punkte aus früheren Sitzungen

- **R2-Lesetoken**: Der Nutzer hatte in einer früheren Sitzung ein
  schreibgeschütztes R2-Token in den Chat eingefügt und sollte es danach
  löschen — unbestätigt. Nachfragen.
- **„Erneut versuchen"-Fehler**: Beim Bauen einer Folge erschien ein Fehler mit
  dieser Schaltfläche; der Fehlertext wurde nie geliefert. Vermutung (nicht
  belegt): Seit `ep.normalize` standardmäßig an ist, läuft jeder Bau über den
  langsamen Filterpfad, und Renders kleine CPU reißt den 45-Minuten-Watchdog.
  Bei Wiederauftreten: Text/Screenshot anfordern, Render-Log lesen.
- **Mit ffmpeg lokal jetzt prüfbar** (im Sandkasten gab es kein ffmpeg):
  Cold-Open-Überblendung auf den Server-Wegen `buildEpisode` und
  `buildEpisodeCopy` (anhören bei ~24–29 s und ~39 s), `loudnorm`-Angleich der
  Teile, Wellenform-`/peaks`, und ob Renders ffmpeg `arnndn` kennt (das steht
  beim ersten echten Lauf im Render-Log; lokal: `ffmpeg -filters | grep arnndn`).
- **Odyssey-Cover**: brauchbare Fassung Lauf 3
  (`https://d8j0ntlcm91z4.cloudfront.net/user_3EtxJ5di48y0PgUBtivJILyMnkx/hf_20260817_214506_c5671559-b62d-4e6c-b420-b8827d0c1353.png`,
  Texte korrekt, Helme bei zweien auf dem Kopf statt unterm Arm). Nutzer hat
  mit „hier passt alles soweit" abgeschlossen.
- **Formel-1-Bild** (Maurice fährt emefka in der Boxengasseneinfahrt hinten
  rein): sechs `flux_2`-Versuche, keiner mit korrekter Hintereinander-
  Geometrie und beiden richtigen Gesichtern. Vorschlag stand: ein Versuch mit
  `seedream_v5_pro` (Risiko `nsfw`-Ablehnung bei echten Gesichtern, wie
  `seedream_v4_5` im August). Nutzer hat nicht entschieden.
- **Andreas** hat keine brauchbare Gesichtsvorlage bei Higgsfield (beide
  Uploads kaputt, `AccessDenied`/HTTP 500). Für ein Cover mit ihm ein Foto als
  Dateianhang erfragen.
- **Bandbreite** (5 GB/Monat auf Render): Juli/August schon einmal gesperrt.
  Gebaut: 30-Tage-Cache für `vendor/` und `assets/`, `/quelle` zeigt direkt
  auf R2. Nicht gebaut: `/parts/:id/file` per 302 auf R2 (braucht CORS am
  Bucket).

## 5. Was lokal anders ist als im Sandkasten

- Kein Sicherheits-Proxy: `cinespasten.emefka.com`, `pub-….r2.dev`, Render-
  Dashboard usw. sind erreichbar — Prüfungen gegen die echte Installation sind
  möglich. Nodes `fetch` braucht keine Proxy-Sonderbehandlung mehr.
- ffmpeg/ffprobe vermutlich vorhanden (`ffmpeg -version`) → Audio-Wege testbar.
- Playwright: `npx playwright install chromium`, falls kein Browser liegt;
  Rauchtest dann ohne `PLAYWRIGHT_CHROMIUM`.
- Higgsfield/Adobe/Google-Werkzeuge hängen an den Connectoren des Nutzers; ob
  sie in der lokalen Sitzung verfügbar sind, zeigt die Werkzeugliste.
- `npm install` zuerst; Node 22.

## 6. Kurzreferenz

**Umgebungsvariablen auf Render** (alle in `render.yaml`, Werte nur im
Dashboard): `APP_PASSWORD`, `SESSION_SECRET`, `PUBLIC_URL`, `GEMINI_API_KEY`,
optional `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`,
`ANCHOR_EMAIL`/`ANCHOR_PASSWORD`, **neu:** `FEED_MIRROR_URL`,
`FEED_MIRROR_PURGE_URL`.

**Wichtige Dateien:** `src/server.js` (Express, Fehler-Handler, Cache-Header,
Middleware), `src/store.js` (JSON-„Datenbank", R2-Backup, Feed-Auffrischung),
`src/rss.js` (Feed inkl. `feedDatum`/`istEingeplant` — zwei frühere Fehler, die
Folgen unsichtbar machten), `src/audio.js` (ffmpeg-Ketten, RNNoise,
Cold Open), `src/routes/episodes.js` (Folgen, Bau, Wellenform-Peaks),
`src/routes/settings.js` (Einstellungen, Cover-Upload mit versioniertem
Dateinamen), `src/seed.js` (Intro/Outro/Cover beim Start), `public/app.js`
(Oberfläche, Wellenform-Editor mit Zoom), `public/localaudio.js` (ffmpeg.wasm
im Browser), `test/smoke.mjs` (33 Prüfungen), `strato/` (dieser Umbau).

**Feed-Regeln:** Nur `status === 'published'` und nicht eingeplant; Datum
`feedDatum()` (nie 1970, nie stillschweigend raus); GUID `importGuid || id`;
Cover-URL mit `?v=` + versioniertem Dateinamen gegen Apples Cache.
