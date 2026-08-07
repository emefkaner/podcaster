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

**Stand 06.08.2026: Der Nutzer hat die Netzsperre aufgehoben** — seither ist
z. B. `d8j0ntlcm91z4.cloudfront.net` (Higgsfield-Ergebnisse) erreichbar, und
erzeugte Cover lassen sich hier ansehen und prüfen. Die Tabelle unten
beschreibt den **gesperrten** Zustand; ob er wieder gilt, vor Gebrauch mit
einem kurzen `curl` prüfen statt raten.

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

0. **Erst klären, wer drauf ist.** Standard sind die **drei** aus
   `cover-vorlagen/03` und `04`. **Andreas** ist nur manchmal dabei — dann sind
   es vier, seine Vorlage ist `cover-vorlagen/01`. **Gastpodcaster** kommen
   öfter vor; für die gibt es keine Vorlage, also **vorher ein Bild der Person
   erfragen**. Niemals eine Figur dazuerfinden.
1. **Immer nur ein Bild auf einmal.** Kein Stapel, keine Varianten parallel.
2. **Modell: `flux_2` (variant `pro`, 1k).** Kostet genau 1 Credit und ist das
   einzige geprüfte Modell, das beides kann. Vor dem Erzeugen immer mit
   `get_cost: true` gegenprüfen.

   Durchgetestet am 06.08.2026 mit `cover-vorlagen/03` als Referenz:

   | Modell | Ergebnis |
   |---|---|
   | `flux_2` (Black Forest Labs) | **läuft, Prompt wird befolgt** |
   | `nano_banana_2_lite` (Google) | `nsfw` — abgelehnt, mit 1 wie mit 2 Referenzen |
   | `seedream_v4_5` (Bytedance) | `nsfw` — ebenso |
   | `soul_2` (Higgsfield) | läuft, aber **unbrauchbar**: schreibt den Prompt automatisch um und beschreibt dabei nur das Referenzbild — heraus kommt ein Klon der Vorlage. `enhance_prompt: false` wird nicht unterstützt. |

   `nsfw` ist Higgsfields Sammelstatus für „vom Filter abgelehnt", ein Grund
   wird nicht mitgeliefert. Nacktheit kann es nicht sein; vermutlich greift der
   Ähnlichkeitsschutz für reale Personen, weil die Vorlagen erkennbare
   Karikaturen sind. Nicht erneut durchprobieren — direkt `flux_2` nehmen.

   **Zwei Vorlagen, zwei Aufgaben — das ist der entscheidende Punkt:**
   Das **Originalfoto der drei** liefert die Gesichter, `cover-vorlagen/03`
   liefert **nur** den Zeichenstil. Die alten Cover als Gesichtsquelle zu nehmen
   ist eine Kopie der Kopie und liefert generische Figuren — daran sind die
   ersten Versuche gescheitert. Im Auftrag ausdrücklich hinschreiben, welche
   Referenz wofür gilt.

   Das Foto liegt **nicht** im Repo (`podcaster` ist öffentlich). Der Nutzer
   schickt es in den Chat; daraus mit
   `cover-vorlagen/gesichter-ausschneiden.mjs` die drei Gesichter einzeln
   ausschneiden und per `media_upload` zu Higgsfield laden (Bytes selbst per
   `curl -X PUT` hochschieben, dann `media_confirm`).

   Repo-Bilder gehen alternativ über `media_import_url` mit der Rohadresse,
   z. B. `https://raw.githubusercontent.com/emefkaner/podcaster/main/cover-vorlagen/03-hail-mary.jpg`.

   **Das fertige Bild immer selbst herunterladen und ansehen** (seit der
   Netzfreigabe möglich) und gegen den Auftrag prüfen, BEVOR es dem Nutzer
   gezeigt wird. Beim ersten Mandalorian-Cover fehlte emefkas Brille und eine
   Unterzeile war aus der Vorlage durchgesickert — solche Fehler selbst
   abfangen. Ist die Adresse gesperrt (curl 000), muss der Nutzer beurteilen.
3. **Bei Unklarheiten nachfragen**, statt etwas anzunehmen.
4. Passt das Bild: die Adresse nennen. Der Nutzer fügt sie in der Folge unter
   „Bild von einer Adresse übernehmen" ein.
5. Passt es nicht: Änderungswunsch abwarten und **ein** neues erzeugen.

Die Referenzbilder liegen im Repo unter **`cover-vorlagen/`** — vier Stück,
1024×1024. Über `media_upload` hochladen und als Referenz mitgeben, damit
Figuren und Zeichenstil erhalten bleiben. Wer wer ist, steht in
`cover-vorlagen/README.md`.

Hintergrund: Googles Bildmodelle lehnen diese Aufträge mit
`PROHIBITED_CONTENT` ab, weil erkennbare Personen in den Vorlagen sind.
Higgsfields Entwickler-API antwortet mit 403 (eigenes Produkt, nicht im
Ultra-Abo enthalten). Der Weg über diesen Chat ist deshalb der einzige, der
mit den vorhandenen Credits funktioniert.

Der eingebaute Cover-Generator wurde deshalb aus der App entfernt. In der
Folge gibt es nur noch „Bild von einer Adresse übernehmen" und den Upload.

## Sprache

Antworten und Commit-Nachrichten auf Deutsch.
