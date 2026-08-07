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
- Der Rauchtest braucht hier `PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium`:
  `PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium node test/smoke.mjs`.
  Ohne das sucht Playwright eine Browser-Fassung, die im Abbild nicht liegt.
- **Testskripte gehören NICHT ins Repo.** Sie landen dort sonst als
  unversionierte Dateien und der Stop-Hook meckert zu Recht. Damit ein Skript
  im Kritzelordner `playwright` auflösen kann, einmal einen Verweis anlegen:
  `ln -sfn /home/user/basic/node_modules <kritzelordner>/node_modules`.
  Danach laufen Skripte von dort ohne Umweg über das Repo.
- `ffmpeg.wasm` im kopflosen Chromium ist **zu langsam zum Testen** (31 MB
  Kern, lief in die Zeitüberschreitung). Oberfläche und Vorhören lassen sich
  prüfen, das eigentliche Rechnen nicht — das muss der Nutzer melden.

### Wohin gepusht wird

Zwei Repos mit identischem Inhalt:

- **`emefkaner/podcaster`** — davon baut Render. Hier liegt der Ernstfall.
  `git push origin main && git push origin main:master` (Render baut `master`).
- **`emefkaner/basic`** — Arbeits-Repo dieser Sitzung, Branch
  `claude/podcast-website-auto-publish-ltemxp`.

Jede Änderung gehört in **beide**. Ist `podcaster` nicht angebunden, per
`add_repo` holen; der Klon liegt dann unter `/workspace/podcaster`.

## KI-Sprachverbesserung: entschieden am 07.08.2026 — keine externe API

**Ergebnis: RNNoise lokal, sonst nichts.** Der Nutzer will keinen bezahlten
Dienst; die Verbesserung soll stattdessen schon **bei der Aufnahme auf dem
iPhone** passieren (Apples „Stimmisolation", siehe unten). Kein Anbieter mehr
vorschlagen, ohne dass er danach fragt.

Was geprüft wurde, damit es niemand zweimal prüft:

- **Adobe hat keine Enhance-API.** Adobes eigene Übersicht
  (`https://developer.adobe.com/audio-video-firefly-services/`) listet genau
  fünf Audio/Video-APIs: Dynamic Graphics Render, Reframe, Translate & Lip Sync,
  Text-to-Speech, Text-to-Avatar. „Enhance Speech" gibt es nur in Adobes
  Oberfläche. Das Chat-Werkzeug `media_enhance_speech` liefert sein Ergebnis
  ausschließlich ins Widget des Nutzers, nie in die App.
- **Dolby.io ist als Media-API tot.** `dolby.io` leitet auf
  `optiview.dolby.com` um, `docs.dolby.io/media-apis/docs` landet auf
  `optiview.dolby.com/docs/`, und `…/docs/media-apis/` gibt **404**. Die
  Produktliste der neuen Doku kennt nur noch Player, Ads, Live und Real-time.
  `api.dolby.com/media/enhance` antwortet zwar noch mit 401 — vermutlich für
  Bestandskunden. Eine schon gebaute Anbindung wurde deshalb wieder entfernt.
  **Lehre: bei einer Empfehlung nicht nur den Funktionsumfang prüfen, sondern
  auch, ob das Produkt überhaupt noch verkauft wird.**
- **Auphonic wäre der beste Ersatz** (falls das Thema je wiederkommt):
  podcast-spezifisch, und die komplette Parameterliste liegt **ohne Schlüssel**
  offen unter `https://auphonic.com/api/info/algorithms.json` — belegt sind u. a.
  `denoisemethod` (`speech_isolation`), `denoiseamount` (Off…100 dB),
  `filtermethod` (`studiovoice`), `levelerstrength`. Haken: gratis nur 2 h/Monat
  **mit eingemischtem Jingle**, sonst Credits.

**Der mitgelieferte ffmpeg.wasm kennt `arnndn`** — geprüft, nicht vermutet:
`ffmpeg -filters` im kopflosen Chromium listet „arnndn A->A Reduce noise from
speech using Recurrent Neural Networks". Ein 3-Sekunden-Testton lief damit
durch `lokalAufbereiten()` und kam als MP3 zurück. RNNoise läuft deshalb auf
**beiden** Wegen: im Browser (Modell wird über `/assets/rnnoise.rnn` in das
ffmpeg-Dateisystem geschrieben) und auf dem Server. Das Modell liegt genau
einmal, unter `public/assets/rnnoise.rnn`.

**Gebaut und behalten wurde nur:** `public/assets/rnnoise.rnn` (Modell
`beguiling-drafter` aus `GregorR/rnnoise-models`, laut deren README
ausdrücklich gemeinfrei; passend für Signal „Voice" inkl. Lachen bei
Aufnahmeraum-Rauschen). `enhanceChain()` in `src/audio.js` schaltet `arnndn`
dazu — aber nur, wenn `ffmpeg -filters` den Filter wirklich kennt, sonst bräche
die ganze Folge ab. **Ob Renders ffmpeg `arnndn` mitbringt, ist ungeprüft** (in
dieser Umgebung gibt es kein ffmpeg); die App schreibt es beim ersten Lauf ins
Protokoll.

### Der eigentliche Weg: Apples „Stimmisolation" beim Aufnehmen

Belegt aus Apples eigener Doku (`support.apple.com/de-de/101993` und das
iPhone-Handbuch zu „Sprachmemos"):

- **Ab iOS 26** lässt sich die Stimmisolation in **Aufnahme-Apps** verwenden —
  vorher ging sie nur bei Anrufen. Geräte: iPhone XR / XS und neuer.
- Weg: während der Aufnahme Kontrollzentrum öffnen → **„[App]-Steuerungen"** →
  unter **„Audio & Video"** → **„Stimmisolation"**.
- Die Auswahl gilt **je App** und bleibt dort aktiv, bis man sie umstellt.
- Ob Safari (und damit die Aufnahme in podcast3r selbst) den Mikrofonmodus
  anbietet, ist **ungeprüft** — Apple schreibt nur „bestimmte Apps von
  Drittanbietern". Der Nutzer sieht das in 30 Sekunden am Gerät.

Wichtig als Gegenargument, falls er unsicher wird: Beim Aufnehmen angewandt ist
die Bearbeitung **unwiderruflich**, und Stimmisolation ist auf Sprache getrimmt
— Lachen kann darunter leiden. Bei einem Filmpodcast, der viel lacht, ist das
ein echtes Risiko.

## Render ist seit 07.08.2026 GESPERRT (Bandbreite aufgebraucht)

Die 5 GB Gratis-Bandbreite des Hobby-Plans sind verbraucht; Render hat die
Dienste **ausgesetzt**. Optionen laut Render-Mail: Karte hinterlegen
(15 $ je 100 GB), auf Professional wechseln (500 GB), oder bis zur
Zurücksetzung am Monatsanfang warten. **Bis dahin kommt kein Deploy an und
die App ist nicht erreichbar.**

Wohin die 5 GB gingen, ist von hier nicht einsehbar (kein Zugriff auf
Render-Metriken) — plausible Haupttreiber, unbestätigt:

- Jeder Neubau einer Folge lädt die fertige MP3 nach R2 hoch — bei einer
  2-h-Folge ~200 MB **ausgehend** je Durchlauf. Mehrere Testrunden = Gigabytes.
- „Klang nachjustieren" am Rechner holt die Originale **durch die App
  hindurch** (`/parts/:id/file` streamt von R2 über Render zum Browser).
- `public/vendor/ffmpeg` (31 MB) je Browser ohne Langzeit-Cache.
- Transkriptions-Audio zu Gemini (~30 MB je 2-h-Folge, 32 kbit/s mono).

Mögliche Abhilfen (noch NICHT gebaut): `/parts/:id/file` per 302 direkt auf
die öffentliche R2-Adresse zeigen lassen (Achtung: braucht CORS-Regeln am
Bucket, von hier nicht prüfbar, da `pub-….r2.dev` gesperrt) und lange
Cache-Header für `vendor/`.

Offene Frage des Nutzers: Warum nicht sein vorhandener Webspace bei
`www.emefka.com`? Antwort hängt am Tarif — die App braucht einen dauerhaft
laufenden Node-20-Prozess **plus ffmpeg**; klassischer Webspace (PHP/statisch)
kann das nicht. Der Nutzer wollte nachsehen, ob sein Paket Node/SSH kann.

## Intro: Cold Open mit Überblendung (seit 08/2026)

- Neues Intro liegt als `seed/intro-coldopen.mp3` im Repo (28,9 s, 192 kbit/s).
  `seedAssets()` ersetzt die alten Seed-Dateien `intro.wav`/`intro.mp3`
  **automatisch** (Liste `ersetzt` in `src/seed.js`); selbst hochgeladene
  Intros mit anderem Namen bleiben unangetastet. Alle drei Fälle lokal geprüft.
- Die letzten **5 s** des Intros liegen ÜBER dem Anfang des ersten Teils:
  `acrossfade=d=5:c1=tri:c2=nofade` — Sprache sofort voll da, Musik blendet
  aus. Konstante `INTRO_UEBERBLENDUNG` in `src/audio.js` **und**
  `public/localaudio.js` (muss synchron bleiben).
- Drei Bauwege, alle angepasst: `buildEpisode` (Filterpfad),
  `buildEpisodeCopy` (Schnellpfad: nur Intro + erste 10 s des Teils werden neu
  kodiert, Rest ab Sekunde 10 per Stream-Copy — Schnitt sitzt auf
  MP3-Rahmengrenze, ~26 ms Raster), `lokalZusammenbauen` (Browser).
- **Geprüft im Browser** mit dem echten Intro: Folge = Intro + Teil − exakt 5 s;
  RMS im Überlappfenster = Sprachpegel. **Die beiden Server-Wege sind hier
  ungeprüft** (kein ffmpeg im Sandkasten) — beim ersten echten Bau anhören,
  besonders die Schnittstelle bei ~Sekunde 10 nach dem Intro.
- Zu kurze Intros/Teile (< 6 s) lösen den Rückfall auf harten Schnitt aus.
- Alte Folgen behalten den harten Schnitt, bis sie neu zusammengebaut werden.

## Adobe-Spurenmischer: wieder ausgebaut (07.08.2026)

Auf Wunsch des Nutzers komplett entfernt (`public/stemmixer.js`, Kasten in der
Folgenansicht, `spurenMischen()` in `localaudio.js`). Grund: Selbst-Hochladen
der drei Adobe-Spuren war für ihn keine Option, und automatisch kommen die
Spuren nie in die App (siehe Adobe-Abschnitt oben). Nicht wieder einbauen.

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
| `raw.githubusercontent.com` | **erreichbar** (Rohdateien fremder Repos holen) |
| `api.dolby.com` | **erreichbar** (antwortet mit 401 ohne Schlüssel) |
| `developer.adobe.com`, `podcast.adobe.com`, `ims-na1.adobelogin.com` | **erreichbar** (Stand 07.08. — die alte „gesperrt"-Notiz war überholt) |
| `pub-….r2.dev` (öffentliche R2-Adresse) | gesperrt |
| `cinespasten.emefka.com` (die App) | gesperrt |
| `api.github.com`, `www.google.com` | gesperrt |
| `docs.dolby.io`, `dev.to`, `elevenlabs.io` | gesperrt (WebFetch: EGRESS_BLOCKED) |

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
   `cover-vorlagen/03` und `04`. Es kann aber jemand fehlen oder dazukommen —
   nicht ungefragt alle drei nehmen. **Andreas** ist nur manchmal dabei; von ihm
   gibt es ein **Foto**, das sich der Nutzer als Datei anhängen lässt (Details in
   `cover-vorlagen/README.md`). Sein Ausschnitt aus `01` ist nur der Notnagel.
   **Gastpodcaster** kommen öfter vor; für die gibt es keine Vorlage, also
   **vorher ein Bild der Person erfragen**. Niemals eine Figur dazuerfinden.
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
   wird nicht mitgeliefert. Nicht erneut durchprobieren — direkt `flux_2` nehmen.

   **Keine geschützten Namen in den Auftrag schreiben.** Am 07.08.2026 belegt:
   Derselbe Auftrag wurde mit „Star Wars" und „Millennium Falcon" im Text von
   `flux_2` mit `nsfw` abgelehnt und lief ohne die Namen anstandslos durch.
   Der Filter greift also auf Marken, **nicht** auf die Gesichter — meine
   frühere Vermutung (Ähnlichkeitsschutz für reale Personen) war falsch.
   Motive stattdessen über die Form beschreiben. Haken: Umschreibungen treffen
   bekannte Fahrzeuge oft nicht; für den Falken lieber ein Referenzbild
   besorgen, statt ihn ein drittes Mal zu umschreiben.

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

   **Wie Fotos vom Nutzer hereinkommen.** Bilder, die er in den Chat einfügt,
   erreichen zwar meine Augen, aber **nicht das Dateisystem** — sie lassen sich
   weder zuschneiden noch hochladen. Auch der Anhang-Knopf hat am 07.08. nicht
   funktioniert. Zuverlässig ist `media_upload_widget`: Der Browser lädt direkt
   zu Higgsfield, ich bekomme die Medien-ID. Danach lässt sich die Datei über
   `https://d2ol7oe51mr4n9.cloudfront.net/user_<id>/<media_id>.jpg` **zurück**-
   holen, in voller Auflösung — so entstehen die Gesichts-Ausschnitte.

   **Höchstens vier Referenzbilder.** Mit fünf ordnet `flux_2` die Gesichter den
   Positionen nicht mehr zu und vertauscht die Personen. Drei Gesichter plus
   Motivbild ist das Maximum; die Stil-Vorlage dann weglassen und den Zeichenstil
   über den Text beschreiben.

   **Immer nur EINE Sache am Auftrag ändern.** Am 07.08. habe ich bei einer
   Korrektur den halben Prompt umgeschrieben — Ergebnis: Gesichter verwechselt,
   Falke weg, Rahmen zurück. Vom funktionierenden Auftrag ausgehen und nur den
   beanstandeten Satz anfassen.

7. **Fallen, die mehrfach zugeschlagen haben:**
   - Das Wort **„Cover"** im Auftrag erzeugt einen Bilderrahmen. Auch ohne das
     Wort taucht der Rand mal auf und mal nicht — das schwankt zwischen
     Durchläufen. Wenn er stört: neu erzeugen oder wegschneiden.
   - **„tool pouches"** am Gürtel liefert Scheren und Schraubenzieher. Wenn
     Waffen gemeint sind, ausdrücklich „blaster pistols" schreiben und Werkzeug
     verbieten.
   - **Breites Lachen lässt Gesichter dick wirken.** Klagt der Nutzer über einen
     „dicken Kopf", hilft ein entspannter, geschlossener Gesichtsausdruck oft
     mehr als eine Änderung der Statur.
   - Das Ergebnis liegt unter `d8j0ntlcm91z4.cloudfront.net` — herunterladen,
     **selbst ansehen**, gegen den Auftrag prüfen, erst dann zeigen.

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
