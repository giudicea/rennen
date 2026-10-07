# KI-Rennen 🏎️

Neuronale Netze lernen per **Neuroevolution** Autofahren — und danach fährst du
selbst gegen die beste KI. Reines statisches HTML/CSS/JS, **kein Build-Schritt**:
einfach `index.html` im Browser öffnen.

## So funktioniert's

- **60 Autos**, jedes mit einem eigenen neuronalen Netz (Feed-Forward,
  8 → 10 → 6 → 2, tanh)
- **Eingaben:** 7 Abstands-Sensoren (Strahlen von −90° bis +90°) + Tempo
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

- Live-Ansicht des **Netzes** des führenden Autos und Fitness-Verlauf
- Regler für **Tempo** (bis 40×) und **Mutationsrate**
- Zufällige Strecken, optional jede Generation eine neue (lernt allgemeiner)
- Bestes Netz im Browser **speichern/laden**
- **🏁 Gegen die KI fahren** — Pfeiltasten/WASD oder Touch-Tasten am Handy

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

## Herkunft

Entstanden als Bonus im [Kraftwerk-Idle](https://github.com/giudicea/kraftwerk-idle)-Projekt.

## Lizenz

[GPL-3.0](LICENSE)
