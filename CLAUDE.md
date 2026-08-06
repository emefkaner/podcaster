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
