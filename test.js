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
