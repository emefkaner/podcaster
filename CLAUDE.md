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

- Der Sicherheits-Proxy lässt nur wenige Ziele zu (Anthropic, npm, PyPI).
  Die laufende App unter `cinespasten.emefka.com` ist von hier **nicht**
  erreichbar. Prüfungen deshalb lokal ausführen.
- Nach Änderungen: auf beide Branches pushen, da Render von `master` baut.
  `git push origin main && git push origin main:master`

## Sprache

Antworten und Commit-Nachrichten auf Deutsch.
