# Feed-Zwischenspeicher (Cloudflare Worker)

Warum es diesen Ordner gibt: Renders Gratis-Plan gewährt 750 Instanzstunden im
Monat und schläft nach **15 Minuten ohne Aufruf** ein — jeder Aufruf weckt ihn
aber sofort wieder (geprüft in Renders eigener Doku, `render.com/docs/free`).
Fragen Podcast-Verzeichnisse den Feed öfter als alle 15 Minuten ab, bleibt
Render dauerhaft wach, und die 750 Stunden sind schnell aufgebraucht.

Dieser Worker beantwortet `/feed.xml` stattdessen selbst, aus einem
Zwischenspeicher. Ausdrücklicher Wunsch: Render soll **nur** durch eigene
Nutzung aufwachen (etwas speichern, oder auch nur die Seite aufrufen) — nie
durch fremde Feed-Abfragen von außen. Deshalb:

- **Leert sich sofort**, wenn du in der App etwas veröffentlichst oder änderst
  (`/purge`) — Render ist in dem Moment ohnehin wach, kostet also nichts extra.
- **Leert sich auch bei jedem bloßen Seitenaufruf**, beiläufig: Die App prüft
  dabei (`pruefeFaelligeFolgen()` in `src/store.js`), ob eine eingeplante
  Folge inzwischen fällig geworden ist, und leert in dem Fall mit. Reicht also,
  dass du irgendwann nach dem Termin die App öffnest — kostet ebenfalls
  nichts extra, Render ist für diesen Aufruf ja ohnehin wach.
- **Nur als Sicherheitsnetz** hält der Worker den Feed höchstens **7 Tage**,
  falls die Leerung einmal fehlschlägt (falsches Geheimnis, Worker kurz down).
  Im Normalbetrieb sollte dieser Fall nie eintreten — fragt in den 7 Tagen
  niemand den Feed ab, holt auch dieses Sicherheitsnetz nichts nach.

Damit wacht Render im Normalfall **ausschließlich** durch deine eigene Nutzung
auf. Kann theoretisch noch passieren: Das Sicherheitsnetz greift nur, wenn in
den 7 Tagen seit der letzten Leerung *und* zufällig genau dann jemand den Feed
abfragt — in der Praxis sollte das nicht vorkommen.

Der Code liegt in `feed-cache-worker.js`. Cloudflare-Konto braucht ihr wegen R2
schon.

## Einrichten

1. Adresse öffnen: `https://dash.cloudflare.com/`, einloggen.
2. Im linken Menü **Workers & Pages** anklicken.
3. Knopf **Create application** (oder **Create Worker**, je nach Kontostand)
   anklicken.
4. Eine Vorlage namens **„Hello World"** auswählen (kein Git-Repo verbinden).
5. Als Namen `podcast3r-feed-cache` eintragen, dann **Deploy** anklicken.
   *Erfolg:* Cloudflare zeigt eine `*.workers.dev`-Adresse — die brauchst du
   gleich, **notieren**.
6. Auf der Worker-Seite den Knopf **Edit code** (manchmal „Quick edit") anklicken.
7. Den kompletten Beispieltext im Editor löschen und stattdessen den
   **gesamten Inhalt von `feed-cache-worker.js`** aus diesem Ordner einfügen.
8. Oben rechts **Deploy** anklicken.
   *Erfolg:* Meldung, dass die neue Fassung live ist.

## Geheimnis für die Leerung setzen

9. Auf der Worker-Seite **Settings** anklicken.
10. Unter **Variables and Secrets** den Knopf **Add** anklicken.
11. **Type**: `Secret` auswählen. **Variable name**: `PURGE_SECRET`. **Value**:
    ein selbst ausgedachtes langes Zufallswort (z. B. 20 wahllose Zeichen) —
    **dieses Wort gleich notieren**, es lässt sich hinterher nicht mehr
    anzeigen.
12. **Deploy** anklicken.
    *Erfolg:* `PURGE_SECRET` steht (als `••••••`) in der Liste.

## Render anschließen

13. Adresse öffnen: `https://dashboard.render.com/` → euren Dienst
    (`podcast-studio`) → **Environment**.
14. Zwei neue Umgebungsvariablen anlegen:
    - `FEED_MIRROR_URL` = eure workers.dev-Adresse + `/feed.xml`,
      z. B. `https://podcast3r-feed.dein-konto.workers.dev/feed.xml`
    - `FEED_MIRROR_PURGE_URL` = dieselbe Adresse + `/purge?secret=` + euer
      Geheimnis aus Schritt 11,
      z. B. `https://podcast3r-feed.dein-konto.workers.dev/purge?secret=xxxxx`
15. **Save Changes** anklicken — Render baut automatisch neu.
    *Erfolg:* Nach dem Deploy zeigt `https://cinespasten.emefka.com/feed.xml`
    weiterhin denselben Feed wie vorher, jetzt zusätzlich mit einer Zeile
    `<itunes:new-feed-url>` darin (mit „Seitenquelltext anzeigen" im Browser
    oder `curl` prüfbar).

## Podcast-Verzeichnisse umstellen

16. Bei **Spotify for Podcasters** einloggen, den Podcast öffnen, die
    Feed-Adresse auf die neue `.../feed.xml`-Adresse aus Schritt 14 ändern.
17. Bei allen anderen Verzeichnissen, bei denen der Feed eingetragen ist
    (Apple Podcasts Connect etc.), dasselbe.

Bei Misserfolg an irgendeinem Schritt: Bildschirm abfotografieren und
herschicken — die genauen Beschriftungen bei Cloudflare ändern sich gelegentlich
(zuletzt geprüft: 27.09.2026).

## Testen, ob die Leerung ankommt

Nach dem Speichern einer Folge oder der Einstellungen sollte im Render-Log die
Zeile `Feed-Cache-Leerung fehlgeschlagen` **nicht** auftauchen. Taucht sie auf,
steht die Fehlermeldung dahinter (meist: `FEED_MIRROR_PURGE_URL` falsch
abgetippt oder Geheimnis stimmt nicht mit `PURGE_SECRET` überein).
