# Statische Feed-Kopie auf dem Strato-Webspace

## Warum

Renders Gratis-Plan schläft nach **15 Minuten ohne Aufruf** ein, und **jeder**
Aufruf weckt ihn wieder (Renders eigene Doku, `render.com/docs/free`). Podcast-
Verzeichnisse und -Apps fragen den Feed aber öfter als alle 15 Minuten ab —
Render blieb deshalb dauerhaft wach und die 750 Gratis-Instanzstunden im Monat
waren verbraucht.

Die App selbst kann nichts dagegen tun: Ihr Code läuft erst, **nachdem** Render
schon aufgewacht ist. Es braucht also etwas **vor** Render, das die Abfragen
beantwortet. Das ist hier eine schlichte statische Datei auf eurem Webspace:

- `feed.xml` — die Kopie des Feeds. Diese Adresse bekommen Spotify & Apple.
  Apache liefert sie aus, Render merkt davon nichts.
- `feed-refresh.php` — zehn Zeilen, die auf Zuruf den Feed einmal von Render
  holen und als `feed.xml` ablegen. Rufer ist **ausschließlich die App
  selbst**: nach jeder Änderung, bei fällig gewordenen eingeplanten Folgen und
  beim Serverstart. In diesen Momenten ist Render ohnehin wach.

Ergebnis: Render wacht nur noch auf, wenn **du** etwas tust — nie durch fremde
Abfragen von außen.

Warum PHP und nicht Python: Eine `.php`-Datei führt Apache auf Strato direkt
aus — hochladen, fertig. Python liefe dort als CGI mit drei weiteren Stellen,
die mit einem nackten „500" scheitern können (Ausführrechte, Interpreter-Pfad,
Handler-Konfiguration). Für zehn Zeilen ist PHP schlicht weniger Angriffsfläche.

## Einrichten

Vorab ein Geheimnis ausdenken: ein langes Zufallswort, 20+ wahllose Zeichen,
nur Buchstaben und Ziffern (keine Sonderzeichen — es landet in einer Adresse).
**Notieren**, es wird zweimal gebraucht.

### Auf dem Webspace

1. `strato/feed-refresh.php` aus diesem Repo in einem Texteditor öffnen.
2. In der Zeile `const GEHEIMNIS = 'HIER-EIN-LANGES-ZUFALLSWORT-EINTRAGEN';`
   den Platzhalter durch euer Geheimnis ersetzen, Anführungszeichen stehen
   lassen. Speichern. **Diese geänderte Datei nie ins Repo zurücklegen** —
   `podcaster` ist öffentlich.
3. Per SFTP mit dem Webspace verbinden (Zugangsdaten stehen im Strato-
   Kundenbereich bei eurem Paket; Programm z. B. Cyberduck oder FileZilla).
4. Im Web-Wurzelordner (dort, wo die Dateien von `www.emefka.com` liegen) einen
   Ordner `cinespasten` anlegen.
5. Die geänderte `feed-refresh.php` in diesen Ordner hochladen.
6. Im Browser aufrufen — Geheimnis einsetzen:
   `https://www.emefka.com/cinespasten/feed-refresh.php?secret=GEHEIMNIS`
   *Erfolg:* Die Seite zeigt `ok` und eine Byte-Zahl, z. B. `ok 48213 Bytes`.
   Es kann beim ersten Mal bis zu einer Minute dauern (Render wacht auf).
7. Gegenprobe: `https://www.emefka.com/cinespasten/feed.xml` öffnen.
   *Erfolg:* Der Feed als XML, oben `<?xml …` und `<rss …`.

Mögliche Fehlermeldungen in Schritt 6 und was sie heißen:

| Meldung | Bedeutung |
|---|---|
| `Geheimnis in feed-refresh.php noch nicht eingetragen` | Schritt 2 vergessen |
| `Falsches oder fehlendes Geheimnis` | Geheimnis in der Adresse ≠ Geheimnis in der Datei |
| `Feed von Render nicht bekommen (HTTP 0) …` | Webspace kommt nicht nach außen (Strato-Support fragen) |
| `Feed von Render nicht bekommen (HTTP 5xx)` | Render antwortet gerade nicht — kurz warten, nochmal |
| `Konnte feed.xml nicht schreiben` | Ordner nicht beschreibbar — Rechte im SFTP-Programm prüfen |

### Auf Render

8. `https://dashboard.render.com/` → Dienst `podcast-studio` → **Environment**.
9. Zwei Umgebungsvariablen anlegen:
   - `FEED_MIRROR_URL` = `https://www.emefka.com/cinespasten/feed.xml`
   - `FEED_MIRROR_PURGE_URL` =
     `https://www.emefka.com/cinespasten/feed-refresh.php?secret=GEHEIMNIS`
     (euer Geheimnis einsetzen)
10. **Save Changes** — Render baut neu.
    *Erfolg:* Im Render-Log erscheint beim Start **keine** Zeile
    `Feed-Spiegel auffrischen (Serverstart) fehlgeschlagen`. Und
    `https://cinespasten.emefka.com/feed.xml` enthält jetzt eine Zeile
    `<itunes:new-feed-url>https://www.emefka.com/cinespasten/feed.xml</itunes:new-feed-url>`.

### Verzeichnisse umstellen — ohne das bringt alles nichts

11. Bei **Spotify for Podcasters** einloggen → den Podcast → Einstellungen →
    Feed-Adresse auf `https://www.emefka.com/cinespasten/feed.xml` ändern.
12. Dasselbe überall, wo der Feed sonst noch eingetragen ist (Apple Podcasts
    Connect usw.).

Solange die Verzeichnisse die alte Adresse abfragen, klingeln sie weiter bei
Render. Erst nach Schritt 11/12 geht die Instanzstunden-Zahl runter — sichtbar
im Render-Dashboard nach ein paar Tagen.

Bei Misserfolg an irgendeinem Schritt: Bildschirm abfotografieren und
herschicken. Die genauen Beschriftungen im Strato-Kundenbereich konnte ich von
hier nicht prüfen (die Hilfeseiten laden nur mit JavaScript).

## Was im Betrieb zu wissen ist

- Die Kopie frischt sich **nur** auf Zuruf der App auf. Es gibt kein Zeitnetz,
  das sie von selbst erneuert — gewollt, sonst würde es Render wecken.
- Schlägt ein Auffrischen fehl, steht es im Render-Log mit Anlass:
  `Feed-Spiegel auffrischen (Änderung|fällige Folge|Serverstart) fehlgeschlagen: …`.
  Beim nächsten Serverstart wird es automatisch erneut versucht.
- Das Skript ersetzt `feed.xml` nur durch eine Antwort, die wirklich wie ein
  vollständiger Feed aussieht (`<?xml` am Anfang, `</rss>` am Ende). Eine
  Fehlerseite von Render kann die funktionierende Kopie also nicht
  überschreiben.
- Bereits veröffentlichte Folgen ändern sich im Feed nie von allein — nur eine
  **eingeplante** Folge wird zu ihrem Termin fällig. Dafür reicht es, dass du
  irgendwann danach die App öffnest: Beim Aufruf prüft die App das und frischt
  die Kopie auf.
