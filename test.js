// Schnelltest ohne Browser: lernen die Autos in 30 Generationen, 3 Runden zu fahren?
//   node test.js
const S = require('./sim.js');
const w = new S.World({ seed: 1, rnd: S.mulberry32(3) });
while (w.generation <= 30) w.tick();
console.log('Beste Fitness je Generation:', w.history.join(' '));
if (!w.lastBest.finished) { console.error('FEHLER: kein Auto ist ins Ziel gekommen'); process.exit(1); }
console.log('OK – das beste Auto schafft alle', S.LAPS, 'Runden.');
