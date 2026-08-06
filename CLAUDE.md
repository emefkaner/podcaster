# Arbeitsweise in diesem Projekt

## Nicht raten — überprüfen

Vermutungen führen hier regelmäßig in die Irre und kosten den Nutzer Zeit
(mehrere Deploy-Runden, bis der eigentliche Fehler gefunden war).

Deshalb gilt:

1. **Vor jeder Behauptung prüfen.** Bibliotheks-Code lesen, Datei ansehen,
   Aufruf tatsächlich ausführen — statt aus dem Gedächtnis zu schließen.
2. **Im Browser testen, was im Browser läuft.** In der Umgebung stehen
   Playwright und Chromium bereit; damit lässt sich Frontend-Verhalten
   wirklich ausprobieren, statt es anzunehmen.
3. **Wenn etwas unklar bleibt: nachfragen.** Lieber eine kurze Rückfrage als
   eine plausible, aber falsche Erklärung.
4. **Unsicherheit benennen.** Wenn etwas nicht überprüft werden konnte, das
   klar sagen — nicht als Tatsache verkaufen.

## Anleitungen für den Nutzer — kurz und klickbar

Keine vagen Verweise. „Schau auf GitHub unter Actions, ob er grün wird" ist
unbrauchbar. Stattdessen:

1. **Vollständige Adresse hinschreiben**, zum Kopieren:
   `https://github.com/emefkaner/podcaster/actions`
2. **Nummerierte Schritte**, ein Schritt = eine Handlung.
3. **Beschriftungen wörtlich nennen**, so wie sie auf dem Bildschirm stehen
   („Klick auf **Save changes**"), nicht umschreiben.
4. **Sagen, woran man Erfolg erkennt** — grüner Haken, welche Meldung, welche
   Zahl.
5. **Sagen, was bei Misserfolg zu tun ist** — meist: abfotografieren und
   herschicken.

Kein Fließtext für Handlungsanweisungen. Erklärungen gehören davor oder
danach, nicht zwischen die Schritte.

## Umgebung

- Der Sicherheits-Proxy lässt nur wenige Ziele zu. Die laufende App unter
  `cinespasten.emefka.com` ist von hier **nicht** erreichbar. Prüfungen deshalb
  lokal ausführen.
- **Erreichbar ist aber `generativelanguage.googleapis.com`** (geprüft: Google
  antwortet selbst, der Proxy blockt nicht). Mit einem gültigen Schlüssel lässt
  sich hier also nachsehen, welche Gemini-Modelle ein Konto nutzen darf —
  `www.google.com` und die meisten anderen Ziele sind dagegen dicht.
- Für lokale Prüfungen: `APP_PASSWORD=… DATA_DIR=… PORT=… node src/server.js`,
  dann mit Playwright gegen `localhost` testen. Chromium liegt unter
  `/opt/pw-browsers/chromium` (`executablePath` mitgeben). `ffmpeg`/`ffprobe`
  gibt es in dieser Umgebung **nicht** — Audio-Wege lassen sich hier also nicht
  durchspielen, nur die Oberfläche.

### Wohin gepusht wird

Zwei Repos mit identischem Inhalt:

- **`emefkaner/podcaster`** — davon baut Render. Hier liegt der Ernstfall.
  `git push origin main && git push origin main:master` (Render baut `master`).
- **`emefkaner/basic`** — Arbeits-Repo dieser Sitzung, Branch
  `claude/podcast-website-auto-publish-ltemxp`.

Jede Änderung gehört in **beide**. Ist `podcaster` nicht angebunden, per
`add_repo` holen; der Klon liegt dann unter `/workspace/podcaster`.

## Offener Wunsch: Adobe Enhance mit eigenen Reglern

Ziel des Nutzers. Noch nicht gebaut — hier festgehalten, damit es nicht verloren geht.

`media_enhance_speech` (Adobe-Werkzeug in diesem Chat) trennt eine Aufnahme in
**drei Spuren**: bereinigte Sprache, Hintergrund, Hall. Genau diese drei soll
der Nutzer in der App **einzeln rein- und rausdrehen** können — also drei
Regler statt eines einzigen „Stärke"-Reglers. Das Mischen selbst ist einfach
(Lautstärke je Spur, dann zusammenmischen) und könnte im Browser laufen; die
offene Frage ist allein, woher die drei Spuren kommen.

Was dabei **ungeklärt** ist:

- Ob Adobe Enhance eine öffentliche API mit eigenen Zugangsdaten hat, was sie
  kostet und ob das Abo des Nutzers sie abdeckt. **Von hier nicht prüfbar:**
  `developer.adobe.com`, `podcast.adobe.com`, `firefly-api.adobe.io` und
  `ims-na1.adobelogin.com` sind alle gesperrt (curl: 000). Die Werkzeuge in
  diesem Chat laufen über einen anderen Kanal und sagen nichts darüber aus.
- Ob der Browser direkt zu Adobe hochladen darf (CORS). Sonst liefe alles über
  Render — und dessen Bandbreite ist knapp (5 GB frei, davon 70 % verbraucht).

**Der Nutzer testet das zu Hause in seinem freien Netz.** Hier im Sandkasten
lässt es sich nicht durchspielen — das ist erwartet, kein Fehler.

## Erreichbarkeit vom Sandkasten aus (geprüft)

Nicht raten, ob etwas erreichbar ist — es steht hier:

| Ziel | Status |
|---|---|
| `generativelanguage.googleapis.com` | **erreichbar** (Gemini antwortet selbst) |
| `<account>.r2.cloudflarestorage.com` | **erreichbar** (S3-API antwortet) |
| `registry.npmjs.org`, `api.anthropic.com` | erreichbar |
| `pub-….r2.dev` (öffentliche R2-Adresse) | gesperrt |
| `cinespasten.emefka.com` (die App) | gesperrt |
| alle Adobe-Hosts, `api.github.com`, `www.google.com` | gesperrt |

Wichtig: In `SETUP-WERTE.md` stehen **keine** R2-Schlüssel (nur Bucket,
Account-ID, öffentliche Adresse). Ohne Schlüssel kein Zugriff auf die Bilder im
Speicher, obwohl der Endpunkt erreichbar wäre.

## Infotext — Form

Kurz halten. Der Nutzer will ausdrücklich **keine** langen Show Notes:

- Genau ein Satz je Person, beginnend mit dem Namen.
- Danach eine Leerzeile und **eine offene, neckische Frage** zum Film, z. B.
  „Wird es den Cinespasten gefallen, wenn Grogu wieder Frösche isst?"
- Sonst nichts: keine Überschrift, keine Stichpunkte, kein Fazit-Absatz.

## Cover erzeugen — Ablauf auf Zuruf

Schreibt der Nutzer im Chat `COVER: <was anders sein soll>`, wird ein
Folgen-Cover erzeugt. Regeln dafür:

1. **Immer nur ein Bild auf einmal.** Kein Stapel, keine Varianten parallel.
2. **Höchstens 1 Credit pro Bild.** Geprüft: `nano_banana_2_lite` kostet
   genau 1 Credit (1k, 1:1); `nano_banana_2` kostet 1,5 und ist damit zu teuer.
   Vor dem Erzeugen mit `get_cost: true` gegenprüfen, wenn etwas anderes
   verwendet werden soll.
3. **Bei Unklarheiten nachfragen**, statt etwas anzunehmen.
4. Passt das Bild: die Adresse nennen. Der Nutzer fügt sie in der Folge unter
   „Bild von einer Adresse übernehmen" ein.
5. Passt es nicht: Änderungswunsch abwarten und **ein** neues erzeugen.

Die Referenzbilder (die bisherigen Cover) müssen als Datei vorliegen; über
`media_upload` hochladen und als Referenz mitgeben, damit Figuren und
Zeichenstil erhalten bleiben.

Hintergrund: Googles Bildmodelle lehnen diese Aufträge mit
`PROHIBITED_CONTENT` ab, weil erkennbare Personen in den Vorlagen sind.
Higgsfields Entwickler-API antwortet mit 403 (eigenes Produkt, nicht im
Ultra-Abo enthalten). Der Weg über diesen Chat ist deshalb der einzige, der
mit den vorhandenen Credits funktioniert.

Der eingebaute Cover-Generator wurde deshalb aus der App entfernt. In der
Folge gibt es nur noch „Bild von einer Adresse übernehmen" und den Upload.

## Sprache

Antworten und Commit-Nachrichten auf Deutsch.
