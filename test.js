// Schnelltest ohne Browser: lernen die Autos in 30 Generationen, 3 Runden zu fahren?
//   node test.js
const S = require('./sim.js');
const w = new S.World({ seed: 1, rnd: S.mulberry32(3) });
while (w.generation <= 30) w.tick();
console.log('Beste Fitness je Generation:', w.history.join(' '));
if (!w.lastBest.finished) { console.error('FEHLER: kein Auto ist ins Ziel gekommen'); process.exit(1); }
console.log('OK – das beste Auto schafft alle', S.LAPS, 'Runden.');

// Eigene Strecke (wie aus dem Editor): Oval ist gültig, eine Acht nicht
const oval = [];
for (let i = 0; i < 16; i++) { const t = i / 16 * 2 * Math.PI; oval.push([500 + Math.cos(t) * 380, 320 + Math.sin(t) * 220]); }
const ovalErr = S.validateTrack(S.trackFromCtrl(oval, 30));
const acht = [[250, 200], [750, 440], [750, 200], [250, 440]];
const achtErr = S.validateTrack(S.trackFromCtrl(acht, 30));
if (ovalErr || !achtErr) { console.error('FEHLER: Streckenprüfung', { ovalErr, achtErr }); process.exit(1); }
const w2 = new S.World({ track: S.trackFromCtrl(oval, 30), rnd: S.mulberry32(5) });
while (w2.generation <= 20) w2.tick();
if (!w2.lastBest.finished) { console.error('FEHLER: KI schafft die eigene Strecke nicht'); process.exit(1); }
console.log('OK – eigene Strecken werden geprüft und die KI lernt darauf.');

// Bild-Strecke wie aus Paint: weisser Hintergrund, schwarzer Ring, grüne Startlinie
function paintBild({ gruen = true, quer = true } = {}) {
  const W = S.WORLD_W, H = S.WORLD_H, px = new Uint8ClampedArray(W * H * 4).fill(255);
  const set = (x, y, r, g, b) => { const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = ((x - 500) / 420) ** 2 + ((y - 320) / 260) ** 2, e2 = ((x - 500) / 340) ** 2 + ((y - 320) / 180) ** 2;
    if (e <= 1 && e2 >= 1) set(x, y, 0, 0, 0);
  }
  if (gruen) for (let x = quer ? 838 : 900; x <= 922; x++) for (let y = 318; y <= 322; y++) set(x, y, 34, 177, 76);
  return px;
}
const bild = S.trackFromPixels(paintBild());
if (bild.error) { console.error('FEHLER: Bild-Strecke', bild.error); process.exit(1); }
for (const [opt, name] of [[{ gruen: false }, 'ohne Startlinie'], [{ quer: false }, 'Startlinie nicht ganz quer']]) {
  if (!S.trackFromPixels(paintBild(opt)).error) { console.error('FEHLER: Bild', name, 'wurde nicht abgelehnt'); process.exit(1); }
}
const w3 = new S.World({ track: bild, rnd: S.mulberry32(9) });
while (w3.generation <= 25) w3.tick();
console.log('Bild-Strecke, beste Fitness:', w3.history.slice(-5).join(' '));
if (!w3.lastBest.finished) { console.error('FEHLER: KI schafft die Bild-Strecke nicht'); process.exit(1); }
console.log('OK – Bild-Strecken (Paint) funktionieren, die KI lernt darauf.');
