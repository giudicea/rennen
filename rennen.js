/*
 * rennen.js — Oberfläche & Grafik für das KI-Rennen
 * (Logik in sim.js, neuronales Netz in nn.js)
 */
(() => {
  'use strict';

  const S = window.RaceSim;
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'ki-rennen-best';

  const cv = $('track'), ctx = cv.getContext('2d');
  const netCv = $('net'), nctx = netCv.getContext('2d');
  const chartCv = $('chart'), cctx = chartCv.getContext('2d');

  const COL = {
    bg: '#10111b', asphalt: '#2a2c3a', wall: '#9397ab', start: '#e9e9ed',
    car: '#9184d9', lead: '#d2cefd', dead: 'rgba(147,151,171,0.18)',
    ray: 'rgba(242,201,76,0.55)', player: '#f2c94c', pos: '#6fcf97', neg: '#eb5757'
  };

  let world = new S.World({ seed: Date.now() & 0xffff });
  let speed = 1;
  let showRays = true;
  let shuffle = false;

  // ─── Rennmodus (Spieler gegen Champion) ───
  let race = null;
  const keys = { left: false, right: false, gas: false, brake: false };

  // ─── Zeichnen ───
  function poly(pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }

  function drawTrack(tr) {
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, S.WORLD_W, S.WORLD_H);
    // Asphalt = Fläche zwischen den Wänden (evenodd)
    ctx.beginPath();
    for (const w of [tr.left, tr.right]) {
      ctx.moveTo(w[0][0], w[0][1]);
      for (let i = 1; i < w.length; i++) ctx.lineTo(w[i][0], w[i][1]);
      ctx.closePath();
    }
    ctx.fillStyle = COL.asphalt;
    ctx.fill('evenodd');
    ctx.lineWidth = 2;
    ctx.strokeStyle = COL.wall;
    poly(tr.left); ctx.stroke();
    poly(tr.right); ctx.stroke();
    // Mittellinie gestrichelt
    ctx.setLineDash([6, 10]);
    ctx.strokeStyle = 'rgba(233,233,237,0.12)';
    ctx.lineWidth = 1;
    poly(tr.center); ctx.stroke();
    ctx.setLineDash([]);
    // Start/Ziel
    ctx.strokeStyle = COL.start;
    ctx.lineWidth = 4;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(tr.left[0][0], tr.left[0][1]);
    ctx.lineTo(tr.right[0][0], tr.right[0][1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCar(c, color, rays) {
    if (rays) {
      ctx.strokeStyle = COL.ray;
      ctx.lineWidth = 1;
      for (let r = 0; r < S.RAY_ANGLES.length; r++) {
        const a = c.a + S.RAY_ANGLES[r], d = c.rays[r] * S.RAY_LEN;
        const ex = c.x + Math.cos(a) * d, ey = c.y + Math.sin(a) * d;
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.fillStyle = COL.ray;
        ctx.beginPath(); ctx.arc(ex, ey, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.a);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-S.CAR_L / 2, -S.CAR_W / 2, S.CAR_L, S.CAR_W, 2.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(16,17,27,0.7)';                // Windschutzscheibe
    ctx.fillRect(1, -S.CAR_W / 2 + 1.5, 4, S.CAR_W - 3);
    ctx.restore();
  }

  function drawNet(net) {
    const W = netCv.width, H = netCv.height;
    nctx.clearRect(0, 0, W, H);
    if (!net) return;
    const L = net.sizes, padX = 95, padY = 22;
    const pos = L.map((n, l) => {
      const x = padX + (l / (L.length - 1)) * (W - 2 * padX);
      return Array.from({ length: n }, (_, i) => [x, padY + ((i + 0.5) / n) * (H - 2 * padY)]);
    });
    for (let l = 1; l < L.length; l++) {
      for (let j = 0; j < L[l]; j++) {
        for (let i = 0; i < L[l - 1]; i++) {
          const w = net.weight(l, i, j);
          nctx.strokeStyle = w > 0 ? COL.pos : COL.neg;
          nctx.globalAlpha = Math.min(0.85, Math.abs(w) * 0.3 * (0.3 + Math.abs(net.act[l - 1][i])));
          nctx.lineWidth = Math.min(3, Math.abs(w) * 1.2);
          nctx.beginPath();
          nctx.moveTo(pos[l - 1][i][0], pos[l - 1][i][1]);
          nctx.lineTo(pos[l][j][0], pos[l][j][1]);
          nctx.stroke();
        }
      }
    }
    nctx.globalAlpha = 1;
    const inNames = ['←90°', '←45°', '←20°', '↑', '→20°', '→45°', '→90°', 'Tempo'];
    const outNames = ['Lenkung', 'Gas'];
    nctx.font = '18px system-ui, sans-serif';
    for (let l = 0; l < L.length; l++) {
      for (let i = 0; i < L[l]; i++) {
        const [x, y] = pos[l][i], a = net.act[l][i];
        nctx.fillStyle = a >= 0 ? `rgba(145,132,217,${0.25 + 0.75 * Math.min(1, a)})`
                                : `rgba(235,87,87,${0.25 + 0.75 * Math.min(1, -a)})`;
        nctx.beginPath(); nctx.arc(x, y, 9, 0, Math.PI * 2); nctx.fill();
        nctx.strokeStyle = '#e9e9ed'; nctx.lineWidth = 1; nctx.stroke();
        nctx.fillStyle = '#9397ab';
        if (l === 0) { nctx.textAlign = 'right'; nctx.fillText(inNames[i] || '', x - 14, y + 6); }
        if (l === L.length - 1) { nctx.textAlign = 'left'; nctx.fillText(outNames[i] || '', x + 14, y + 6); }
      }
    }
  }

  function drawChart() {
    const W = chartCv.width, H = chartCv.height, h = world.history;
    cctx.clearRect(0, 0, W, H);
    if (h.length < 2) {
      cctx.fillStyle = '#9397ab'; cctx.font = '20px system-ui, sans-serif';
      cctx.fillText('Fitness-Verlauf erscheint ab Gen. 2', 10, H / 2 + 6);
      return;
    }
    const max = Math.max(...h, 1);
    cctx.strokeStyle = COL.car; cctx.lineWidth = 3;
    cctx.beginPath();
    h.forEach((v, i) => {
      const x = (i / (h.length - 1)) * (W - 10) + 5, y = H - 8 - (v / max) * (H - 16);
      i ? cctx.lineTo(x, y) : cctx.moveTo(x, y);
    });
    cctx.stroke();
  }

  // ─── Training ───
  function newTrack() { world.setTrack((Math.random() * 1e9) >>> 0); }

  function trainFrame() {
    for (let s = 0; s < speed; s++) {
      if (world.tick() && shuffle) newTrack();
    }
    drawTrack(world.track);
    const lead = world.leader();
    for (const c of world.cars) if (!c.alive) drawCar(c, COL.dead, false);
    for (const c of world.cars) if (c.alive && c !== lead) drawCar(c, COL.car, false);
    if (lead) drawCar(lead, COL.lead, showRays && lead.alive);
    drawNet(lead && lead.brain);

    $('s-gen').textContent = world.generation;
    $('s-alive').textContent = world.alive + ' / ' + world.popSize;
    if (world.lastBest) {
      const b = world.lastBest;
      $('s-last').textContent = b.finished ? '🏁 ins Ziel' : `Runde ${Math.min(S.LAPS, b.laps + 1)} · ${Math.round(b.fitness)}`;
    }
    $('s-rec').textContent = world.bestEver ? Math.round(world.bestEver) : '–';
    if (lead) msg(lead.alive ? `Führend: Runde ${Math.min(S.LAPS, lead.laps + 1)} / ${S.LAPS}` : '');
    drawChart();
  }

  // ─── Rennen gegen die KI ───
  function startRace() {
    const brain = world.champion || world.leader().brain;
    const ai = new S.Car(world.track, brain.clone());
    const me = new S.Car(world.track, null);
    // nebeneinander starten
    const nx = -Math.sin(ai.a), ny = Math.cos(ai.a);
    ai.x += nx * 12; ai.y += ny * 12;
    me.x -= nx * 12; me.y -= ny * 12;
    race = { ai, me, count: 180, winner: null };
    document.body.classList.add('racing');
  }

  function raceFrame() {
    const { ai, me } = race;
    if (race.count > 0) {
      race.count--;
    } else if (!race.winner) {
      const [s, t] = ai.think(world.track);
      ai.drive(world.track, s, t, true);
      me.sense(world.track);
      me.drive(world.track, (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
        keys.gas ? 1 : keys.brake ? -1 : 0, true);
      if (me.finished && !race.winner) race.winner = (ai.finished && ai.finishStep < me.finishStep) ? 'ai' : 'me';
      else if (ai.finished && !race.winner) race.winner = 'ai';
    }
    drawTrack(world.track);
    drawCar(ai, COL.car, showRays);
    drawCar(me, COL.player, false);
    drawNet(ai.brain);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9e9ed';
    if (race.count > 0) {
      ctx.font = 'bold 96px system-ui, sans-serif';
      ctx.fillText(Math.ceil(race.count / 60), S.WORLD_W / 2, S.WORLD_H / 2 + 32);
    } else if (race.winner) {
      ctx.font = 'bold 64px system-ui, sans-serif';
      ctx.fillText(race.winner === 'me' ? '🏆 Du gewinnst!' : '🤖 Die KI gewinnt!', S.WORLD_W / 2, S.WORLD_H / 2 + 22);
    }
    ctx.textAlign = 'left';
    const lap = (c) => Math.min(S.LAPS, c.laps + 1);
    msg(`Du: Runde ${lap(me)}/${S.LAPS}   ·   KI: Runde ${lap(ai)}/${S.LAPS}` +
      (world.champion ? '' : '   (Tipp: erst ein paar Generationen trainieren!)'));
  }

  // ─── Schleife ───
  function frame() {
    if (race) raceFrame(); else trainFrame();
    requestAnimationFrame(frame);
  }

  function msg(t) { $('msg').textContent = t; }

  // ─── Bedienung ───
  $('speed').addEventListener('input', (e) => { speed = +e.target.value; $('v-speed').textContent = speed + '×'; });
  $('mut').addEventListener('input', (e) => {
    world.mutationRate = e.target.value / 100;
    $('v-mut').textContent = e.target.value + ' %';
  });
  $('rays').addEventListener('change', (e) => { showRays = e.target.checked; });
  $('shuffle').addEventListener('change', (e) => { shuffle = e.target.checked; });
  $('b-track').addEventListener('click', newTrack);
  $('b-reset').addEventListener('click', () => {
    const seed = world.track.seed;
    world = new S.World({ seed, mutationRate: $('mut').value / 100 });
  });
  $('b-save').addEventListener('click', () => {
    const best = world.champion || world.leader().brain;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(best)); msg('💾 Bestes Netz gespeichert.'); }
    catch (_) { msg('Speichern nicht möglich (Browser-Speicher blockiert).'); }
  });
  $('b-load').addEventListener('click', () => {
    let net = null;
    try { net = S.NeuralNet.fromJSON(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch (_) { /* leer */ }
    if (!net) { msg('Kein gespeichertes Netz gefunden.'); return; }
    world = new S.World({ seed: world.track.seed, seedBrain: net, mutationRate: $('mut').value / 100 });
    world.champion = net.clone();
    msg('📂 Gespeichertes Netz geladen — es fährt in der neuen Generation mit.');
  });
  $('b-race').addEventListener('click', startRace);
  $('b-again').addEventListener('click', startRace);
  $('b-train').addEventListener('click', () => { race = null; document.body.classList.remove('racing'); });

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'gas', KeyW: 'gas', ArrowDown: 'brake', KeyS: 'brake'
  };
  function setKey(e, down) {
    const k = KEYMAP[e.code];
    if (!k || !race) return;
    keys[k] = down;
    e.preventDefault();
  }
  addEventListener('keydown', (e) => setKey(e, true));
  addEventListener('keyup', (e) => setKey(e, false));
  for (const b of document.querySelectorAll('.touch [data-key]')) {
    const k = b.dataset.key;
    const on = (e) => { e.preventDefault(); keys[k] = true; };
    const off = (e) => { e.preventDefault(); keys[k] = false; };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
  }

  requestAnimationFrame(frame);
})();
