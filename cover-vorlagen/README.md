# Cover-Vorlagen

Die bisherigen Folgen-Cover als Referenz für neue. Aus dem R2-Speicher geholt
(`base-images/`) und auf 1024×1024 JPEG verkleinert — die Originale lagen teils
als 2048er PNG mit 9 MB vor, was für Referenzbilder unnötig ist.

| Datei | Was drauf ist |
|---|---|
| `01-die-cinespasten.jpg` | Das Reihen-Cover. Tron-Look, Schriftzug **DIE CINESPASTEN** oben. **Vier** Personen. |
| `02-mercy.jpg` | „MERCY". Zwei Hosts im Vordergrund, dazu eine Filmfigur rechts. |
| `03-hail-mary.jpg` | „HAIL MARY" mit Unterzeile „EASY ON THE SPACE SUITS". Die drei in Raumanzügen. |
| `04-crime-101.jpg` | „CRIME 101". Die drei im Überwachungswagen, Regennacht. |

## Wer aufs Cover gehört

**Die Stammbesetzung — drei Personen** (vom Nutzer selbst zugeordnet):

| Wer | Woran erkennbar | Auf `01` | Auf `03` / `04` |
|---|---|---|---|
| **Matthias** | hellblond, breites Zahn-Lächeln, glatt rasiert | 1. von links | links |
| **Maurice** | kräftiger, dunkelblond, Bärtchen | 3. von links | Mitte |
| **emefka** | dunkles Haar, schwarze Brille, Kinnbart, skeptischer Blick | 4. von links | rechts |

**Andreas — nur manchmal.** Die verbleibende Figur auf `01`: **2. von links**,
schmaler, rotbraunes Haar, leichter Bart. Er ist der Einzige, der auf `03` und
`04` fehlt. Ist er in einer Folge dabei, sagt der Nutzer das ausdrücklich; dann
gehört er mit aufs Cover — mal zu dritt, mal zu viert.

**Von Andreas gibt es ein Foto** (Porträtaufnahme: dunkles, welliges Haar,
kräftiger Vollbart, freundliches Lächeln, schwarzes Polohemd vor blauem
Hintergrund). Der Nutzer hat es am 07.08.2026 im Chat gezeigt. **Es als Datei
anhängen lassen** und als Gesichts-Vorlage nehmen — nicht den Ausschnitt aus
`01`. Der ist eine Zeichnung nach einem Foto und nur 440 Pixel groß; damit
gerät sein Gesicht deutlich ungenauer als das der anderen. Wie bei den drei
anderen liegt auch sein Foto bewusst nicht im Repo.

**Gastpodcaster — kommen öfter vor.** Der Nutzer kündigt sie an. Für einen Gast
gibt es **keine Vorlage** — ohne Bild erfindet das Modell ein Gesicht. Deshalb:
**vorher nach einem Foto oder Bild der Person fragen** und es als zusätzliche
Referenz mitgeben. Nie einfach eine Figur dazuerfinden.

Zeichenstil: kräftig konturierte Comic-Illustration, leicht karikierte Gesichter
auf realistisch gerendertem Hintergrund, satte Farben, starkes Gegenlicht.

## Gesichter einzeln ausschneiden

```
node cover-vorlagen/gesichter-ausschneiden.mjs [quelle] [zielordner]
```

Im ganzen Cover ist jedes Gesicht nur rund 150 Pixel groß — als Referenz fürs
Bildmodell zu wenig, die Figuren kommen dann ungenau zurück. Das Skript schneidet
Kopf und Schultern einzeln heraus.

Gegen die 1024er-Dateien hier im Ordner ergibt das ~350 Pixel je Gesicht, gegen
die **2048er-Originale aus dem R2-Speicher** (`base-images/`) ~700. Wenn möglich
die Originale nehmen.

Die Ausschnitte landen standardmäßig in `gesichter/` und sind per `.gitignore`
ausgeschlossen — sie sind Arbeitsmaterial, kein Repo-Inhalt.

## Verwendung — zwei Vorlagen, zwei Aufgaben

**Wichtig, teuer gelernt:** Diese Cover taugen nur als **Stil**-Vorlage, nicht
als Gesichts-Vorlage. Sie sind selbst schon eine Zeichnung nach einem Foto —
wer sie als Gesichtsquelle nimmt, kopiert eine Kopie, und die Figuren geraten
generisch. Genau daran sind die ersten Versuche gescheitert.

Richtig ist:

| Vorlage | Wofür |
|---|---|
| **Originalfoto der drei** (liegt nicht im Repo, siehe unten) | die Gesichter |
| `03-hail-mary.jpg` | ausschließlich der Zeichenstil |

Aus dem Foto werden die drei Gesichter **einzeln ausgeschnitten** (Skript:
`cover-vorlagen/gesichter-ausschneiden.mjs`) und zusammen mit dem Stil-Cover als
Referenzen an `flux_2` gegeben. Im Auftrag ausdrücklich schreiben, welche
Referenz wofür gilt — sonst kopiert das Modell den Inhalt des Stil-Covers.

Das **Foto selbst liegt bewusst nicht im Repo** (`podcaster` ist öffentlich).
Der Nutzer schickt es bei Bedarf in den Chat; hochgeladen wird es nur zu
Higgsfield.

Der Ablauf steht in `CLAUDE.md` unter „Cover erzeugen — Ablauf auf Zuruf".

In der App gibt es **keinen** Cover-Generator mehr. Ein fertiges Bild kommt über
„Bild von einer Adresse übernehmen" oder den Upload in die Folge.
