# 🎙️ podcast3r

Eine kleine, mobil-optimierte Web-App, mit der du **überall vom Handy** einen Podcast
aufnehmen oder eine Audiodatei hochladen kannst. Die App:

1. nimmt deine Aufnahme entgegen (Handy-Mikrofon **oder** Datei-Upload),
2. **optimiert die Sprache per KI/DSP** gegen Hintergrundgeräusche (an/aus + Stärke-Regler),
3. fügt automatisch **Intro + Aufnahme + Outro** zusammen,
4. **transkribiert** die Aufnahme (Google Gemini – kostenlos, stark bei Deutsch),
5. erstellt einen **Infotext-Vorschlag** – den du prüfen/ändern kannst,
6. und veröffentlicht die Folge **nach deiner Bestätigung** in deinen eigenen
   **RSS-Feed**, den Spotify automatisch abholt.

> **Wichtig zu Spotify:** Es gibt keine offizielle API, um Folgen direkt in
> „Spotify for Podcasters" hochzuladen. Der offizielle Weg ist ein **RSS-Feed**,
> den du **einmalig** bei Spotify einträgst. Danach erscheint jede neue Folge
> automatisch. Diese App ist genau dieser Feed – plus die ganze Aufnahme-/
> Verarbeitungs-Automatik.

---

## Schnellstart (lokal testen)

```bash
npm install
cp .env.example .env      # Werte eintragen (mind. APP_PASSWORD, OPENAI_API_KEY)
npm start
# -> http://localhost:3000
```

Auf dem Handy braucht die Mikrofon-Aufnahme **HTTPS** (lokal geht `localhost`).

## Umgebungsvariablen

| Variable            | Zweck                                                        |
|---------------------|-------------------------------------------------------------|
| `APP_PASSWORD`      | Login-Passwort (nur du kommst rein)                         |
| `SESSION_SECRET`    | langer Zufallswert zum Signieren der Login-Cookies          |
| `PUBLIC_URL`        | öffentliche Adresse der App, z. B. `https://…onrender.com`  |
| `GEMINI_API_KEY`    | **Empfohlen:** Transkription **und** Infotext ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) |
| `OPENAI_API_KEY`    | optionale Alternative zur Transkription (Whisper)           |
| `ANTHROPIC_API_KEY` | optionale Alternative für den Infotext (Claude)             |
| `DATA_DIR`          | Lokaler Zwischenspeicher / Fallback (Render: `/data`)       |
| `R2_*`              | Cloudflare R2 (empfohlen, siehe unten) – dauerhafter Speicher|
| `PORT`              | Server-Port (Standard 3000)                                 |

## Speicher: Cloudflare R2 (empfohlen)

Podcast-MP3s brauchen dauerhaften, öffentlich streambaren Speicher mit viel
Bandbreite. **Dropbox/OneDrive/Google Drive sind dafür ungeeignet** (HTML-Links
statt Direktdateien, kein sauberes Streaming, Traffic-Drosselung/-Sperren).

**Cloudflare R2** ist ideal: **10 GB Speicher gratis, kostenloser Traffic**,
saubere Direktlinks. Setup:

1. Cloudflare-Account → **R2** → Bucket anlegen.
2. Bucket **öffentlich** schalten (r2.dev-Subdomain aktivieren oder eigene Domain).
3. **API-Token** (S3) erstellen → Access Key + Secret.
4. Die fünf `R2_*`-Variablen setzen (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`).

Sind alle gesetzt, liegen MP3s, Cover **und** ein Metadaten-Backup in R2 – der
Server braucht dann keinen persistenten Datenträger. Fehlt eine Variable, nutzt
die App automatisch die lokale Platte (`DATA_DIR`).

---

## Deployment (empfohlen: Render)

1. Repo zu GitHub pushen.
2. Auf [render.com](https://render.com): **New → Blueprint** → dieses Repo wählen
   (die mitgelieferte `render.yaml` legt Web-Service **und** persistenten Datenträger an).
3. Im Dashboard die Secrets setzen: `APP_PASSWORD`, `OPENAI_API_KEY`,
   ggf. `ANTHROPIC_API_KEY`.
4. Nach dem ersten Deploy `PUBLIC_URL` auf die echte Render-URL setzen
   (z. B. `https://podcast-studio.onrender.com`) und neu deployen.

> Alternativ läuft es genauso auf Railway, Fly.io oder jedem VPS
> (`docker build` + Volume auf `/data` mounten).

---

## Ersteinrichtung in der App

1. Einloggen → Menü (☰) → **Einstellungen**.
2. **Podcast-Infos** ausfüllen (Titel, Beschreibung, E-Mail – die verlangt Spotify).
3. **Intro-, Outro-** und **Cover-Bild** hochladen (Cover ist für Spotify Pflicht,
   quadratisch, ≥ 1400 px).
4. Fertig – die **RSS-Feed-URL** steht unten in den Einstellungen.

## Bestehenden Podcast umziehen (Import)

Wenn du schon einen Podcast hast (z. B. bei Spotify/Anchor), kannst du alle
Folgen übernehmen: **Einstellungen → „Bestehende Folgen importieren"** → aktuelle
RSS-Feed-URL eintragen → Import starten. Die App liest den Feed, übernimmt alle
Folgen (idempotent, keine Duplikate), kopiert auf Wunsch die MP3s in deinen
Speicher und übernimmt Podcast-Infos + Cover.

Danach beim alten Anbieter bzw. bei Apple/Spotify die **Feed-Weiterleitung
(Redirect)** auf deine neue `…/feed.xml`-URL setzen – so bleiben Follower,
Bewertungen und das Archiv erhalten.

## Bei Spotify eintragen

1. [Spotify for Podcasters / Creators](https://podcasters.spotify.com) öffnen.
2. Neuen Podcast **via RSS-Feed** hinzufügen und deine `…/feed.xml`-URL eingeben.
3. Bestätigen. Ab jetzt zieht Spotify jede veröffentlichte Folge automatisch.

---

## Direkt zu Spotify for Podcasters pushen (optional, inoffiziell)

Zusätzlich zum RSS-Feed kann die App eine Folge **direkt in deinen bestehenden
Spotify-Podcasters-(Anchor-)Account** hochladen und veröffentlichen – so bleibt
deine bestehende Show inkl. Follower erhalten, ohne Umzug.

- Setze `ANCHOR_EMAIL` und `ANCHOR_PASSWORD` (Konto **ohne** 2-Faktor).
- In der Folge dann „In deinen bestehenden Podcast pushen".

> ⚠️ **Ehrlicher Hinweis:** Es gibt keine offizielle API. Dieser Modus steuert die
> echte Weboberfläche per Browser-Automation (Playwright). Das ist **fragil**
> (Layout-Änderungen bei Spotify können ihn brechen) und **entspricht nicht den
> Spotify-Nutzungsbedingungen** – Nutzung auf eigenes Risiko. Bei Fehlern legt die
> App Screenshots unter `DATA_DIR/debug` ab, damit man die Selektoren in
> `src/anchorPublisher.js` nachziehen kann. Der **RSS-Feed** ist der stabile,
> offizielle Hauptweg; der Anchor-Push ist die Bequemlichkeits-Ergänzung.

## Optionale, stärkere Rauschunterdrückung (RNNoise)

Standardmäßig läuft die KI-Optimierung über ffmpeg (kostenlos, lokal). Für noch
stärkere Trennung von Stimme und Umgebung (Auto/Restaurant) kannst du ein
**RNNoise-Modell** hinterlegen: Datei nach `data/assets/rnnoise.rnn` legen –
die App nutzt es dann automatisch zusätzlich.

---

## Was diese App bewusst NICHT tut

- Sie lädt **nicht** direkt in dein Spotify-Konto hoch (dafür gibt es keine API) –
  sie stellt den RSS-Feed bereit, den Spotify abholt.
- Sie veröffentlicht **nie** ohne deine Bestätigung.
