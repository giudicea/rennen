# KI-Rennen 🏎️

Neuronale Netze lernen per **Neuroevolution** Autofahren — und danach fährst du
selbst gegen die beste KI. Reines statisches HTML/CSS/JS, **kein Build-Schritt**:
einfach `index.html` im Browser öffnen.

## So funktioniert's

- **60 Autos**, jedes mit einem eigenen neuronalen Netz (Feed-Forward,
  8 → 10 → 6 → 2, tanh)
- **Eingaben:** 7 Abstands-Sensoren (Strahlen von −90° bis +90°) + Tempo —
  oder umschaltbar ein **📡 LiDAR 360°** mit 16 bzw. 32 Strahlen rundherum
- **Ausgaben:** Lenkung und Gas/Bremse
- **Lernen:** Wer die Wand berührt oder nicht vorankommt, scheidet aus. Nach
  jeder Generation werden die besten Fahrer (Elite + Turnier-Auswahl)
  gekreuzt und mutiert. Meist schaffen sie nach ~5–10 Generationen alle 3 Runden.

## Funktionen

- **✏️ Strecken-Editor** — eigene Strecken bauen: Punkte klicken oder freihand
  zeichnen, Punkte ziehen/einfügen/löschen, Breite einstellen, Fahrtrichtung
  umdrehen, Rückgängig. Die Strecke wird live geprüft (keine Überschneidungen,
  keine zu engen Kurven). Strecken lassen sich im Browser **speichern** und per
  **Link teilen** — wer den Link öffnet, hat sofort deine Strecke.
- **🖼️ Strecken aus Bildern** — in Paint malen und laden (siehe unten)

- Live-Ansicht des **Netzes** des führenden Autos und Fitness-Verlauf
- Regler für **Tempo** (bis 40×) und **Mutationsrate**
- Zufällige Strecken, optional jede Generation eine neue (lernt allgemeiner)
- Bestes Netz im Browser **speichern/laden**
- **🏁 Gegen die KI fahren** — Pfeiltasten/WASD oder Touch-Tasten am Handy

## 📡 Standard-Sensoren oder LiDAR 360°?

Unter **Sensoren** lässt sich umschalten. Ein Vergleich (je 6 Trainingsläufe à
40 Generationen, danach Test auf 5 unbekannten Strecken):

| Sensoren | erstes Mal im Ziel (Generation) | unbekannte Strecken geschafft | Rechenzeit |
| --- | --- | --- | --- |
| 👀 7 nach vorne | 3–9 | **26 / 30** | 1× |
| 📡 LiDAR 16 | 2–13 | 7 / 30 | ~1,7× |
| 📡 LiDAR 32 | 1–11 | 8 / 30 | ~3,5× |

Die eigene Strecke lernt LiDAR genauso schnell. Weil das Netz aber viel mehr
Eingaben hat, lernt es die Strecke eher **auswendig**, statt allgemein fahren zu
lernen. Mit **„Jede Generation neue Strecke“** (60 Generationen) wird es
deutlich besser: 7 Sensoren 17/20, LiDAR 16 12/20, LiDAR 32 10/20.
Ausprobieren lohnt sich trotzdem — vor allem auf engen, verwinkelten Strecken.

## 🎨 Strecken in Paint malen

Statt Punkte zu klicken, kannst du eine Strecke einfach **als Bild malen**
(Paint, Paint 3D, GIMP, Handy-Zeichen-App …). Das Spiel erkennt die Strasse an
den Farben:

| Farbe | Bedeutung |
| --- | --- |
| ⬛ **Schwarz / Dunkelgrau** | Strasse (hier darf gefahren werden) |
| ⬜ **Weiss** (oder jede helle Farbe) | Wand / Gras — wer das berührt, scheidet aus |
| 🟩 **Grün** | Start-/Ziellinie — **quer über die ganze Strasse**, von Rand zu Rand |
| 🟥 **Rot** (optional) | kleiner Punkt kurz **hinter** der Startlinie = Fahrtrichtung |

**Schritt für Schritt (Windows-Paint):**

1. Paint öffnen → **Bild → Grösse ändern / Eigenschaften** → *Pixel*,
   **1000 × 640** einstellen (andere Grössen gehen auch, das Bild wird eingepasst).
2. Der Hintergrund bleibt **weiss**.
3. **Pinsel** wählen, **schwarz**, grosse Strichstärke (ca. 40–80 px) und eine
   **geschlossene Runde** malen — Anfang und Ende müssen sich treffen.
   Tipp: lieber breit und mit weichen Kurven, enge Haarnadeln sind schwer.
4. Mit dem **Linienwerkzeug** in **Grün** eine dicke Linie **quer** über die
   Strasse ziehen, etwas über beide Ränder hinaus. Das ist Start und Ziel.
5. Optional: mit **Rot** einen kleinen Punkt auf die Strasse direkt hinter
   die grüne Linie setzen — dorthin fahren die Autos los.
6. **Als PNG speichern** (*Datei → Speichern unter → PNG*). JPG geht auch,
   PNG gibt aber sauberere Kanten.
7. Im Spiel **✏️ Strecke bauen → 🖼️ Bild laden** (oder das Bild einfach auf die
   Strecke ziehen) → **✓ Übernehmen & KI trainieren**.

Kein Bock bei Null anzufangen? **📄 Paint-Vorlage** lädt die aktuelle Strecke
als fertiges Bild herunter — in Paint öffnen, umbauen, speichern, wieder laden.

Wenn etwas nicht passt, sagt dir das Spiel, was fehlt (z. B. *„Die grüne Linie
muss die Strasse ganz durchqueren“*). Fahren die Autos falsch herum, einfach
**⇄ Richtung** drücken. Bild-Strecken lassen sich unter *Meine Strecken*
speichern; der 🔗 Teilen-Link funktioniert nur für Punkte-Strecken.

## Lokal starten

```
python3 -m http.server   # -> http://localhost:8000
node test.js             # Schnelltest: lernt die KI ohne Browser?
```

## Struktur

| Datei | Zweck |
| --- | --- |
| `index.html` | Oberfläche |
| `styles.css` | Design-Tokens (Nocturne-Theme) |
| `nn.js` | neuronales Netz (Vorwärtsrechnung, Mutation, Crossover) |
| `sim.js` | Strecke, Fahrphysik, Sensoren, Evolution (läuft auch in Node) |
| `rennen.js` | Grafik, Bedienung, Rennen gegen die KI |
| `test.js` | Lern-Schnelltest für Node |

## Lizenz

[GPL-3.0](LICENSE)
