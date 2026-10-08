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

  // sticky = Hinweis bleibt ein paar Sekunden stehen (statt vom Live-Status überschrieben zu werden)
  let stickyUntil = 0;
  function msg(t, sticky) {
    if (!sticky && performance.now() < stickyUntil) return;
    if (sticky) stickyUntil = performance.now() + 4000;
    $('msg').textContent = t;
  }

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

  function drawTrack(tr, opt = {}) {
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, S.WORLD_W, S.WORLD_H);
    if (opt.grid) {
      ctx.strokeStyle = 'rgba(147,151,171,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 40; x < S.WORLD_W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, S.WORLD_H); }
      for (let y = 40; y < S.WORLD_H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(S.WORLD_W, y); }
      ctx.stroke();
    }
    if (!tr) return;
    if (tr.road) { ctx.drawImage(renderRaster(tr), 0, 0); return; }
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
    ctx.strokeStyle = opt.wall || COL.wall;
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

  // Bild-Strecke einmal in ein Offscreen-Bild umrechnen (Asphalt, Rand, Startlinie)
  function renderRaster(tr) {
    if (tr.render) return tr.render;
    const W = S.WORLD_W, H = S.WORLD_H;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data, src = tr.src && tr.src.rgba;
    for (let i = 0; i < W * H; i++) {
      let col = [16, 17, 27];
      if (tr.road[i]) {
        const x = i % W;
        const edge = !tr.road[i - 1] || !tr.road[i + 1] || !tr.road[i - W] || !tr.road[i + W] || x === 0;
        const green = src && S.pixelKind(src[i * 4], src[i * 4 + 1], src[i * 4 + 2]) === 3;
        col = edge ? [147, 151, 171] : green ? [233, 233, 237] : [42, 44, 58];
      }
      d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    tr.render = c;
    return c;
  }

  function drawCar(c, color, rays) {
    if (rays) {
      ctx.strokeStyle = COL.ray;
      ctx.lineWidth = 1;
      for (let r = 0; r < c.angles.length; r++) {
        const a = c.a + c.angles[r], d = c.rays[r] * S.RAY_LEN;
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
    const nIn = L[0] - 1;
    let inNames;
    if (nIn === S.RAY_ANGLES.length) inNames = ['←90°', '←45°', '←20°', '↑', '→20°', '→45°', '→90°', 'Tempo'];
    else {
      // LiDAR: Winkel beschriften, bei vielen Strahlen nur jeden zweiten/vierten
      const step = nIn > 16 ? 4 : 2;
      inNames = S.rayAngles(nIn).map((a, i) => (i % step ? '' : Math.round(a * 180 / Math.PI) + '°'));
      inNames.push('Tempo');
    }
    const outNames = ['Lenkung', 'Gas'];
    const maxN = Math.max(...L);
    const rad = Math.max(3, Math.min(9, (H - 2 * padY) / maxN / 2.3));   // Kreise bei vielen Neuronen kleiner
    nctx.font = `${maxN > 20 ? 14 : 18}px system-ui, sans-serif`;
    for (let l = 0; l < L.length; l++) {
      for (let i = 0; i < L[l]; i++) {
        const [x, y] = pos[l][i], a = net.act[l][i];
        nctx.fillStyle = a >= 0 ? `rgba(145,132,217,${0.25 + 0.75 * Math.min(1, a)})`
                                : `rgba(235,87,87,${0.25 + 0.75 * Math.min(1, -a)})`;
        nctx.beginPath(); nctx.arc(x, y, rad, 0, Math.PI * 2); nctx.fill();
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
    // höchstens ~14 ms pro Bild rechnen, damit die Seite flüssig bleibt (LiDAR braucht mehr Rechenzeit)
    const t0 = performance.now();
    for (let s = 0; s < speed; s++) {
      if (world.tick() && shuffle) newTrack();
      if (performance.now() - t0 > 14) break;
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

  // ─── Strecken-Editor ───
  const TRACKS_KEY = 'ki-rennen-strecken';
  // Trefferradius ~20 Bildschirm-Pixel (am Handy ist die Leinwand stark verkleinert)
  const scale = () => cv.width / (cv.getBoundingClientRect().width || cv.width);
  const hitR = () => Math.max(16, 20 * scale());
  const DRAW_STEP = 45;      // Freihand: alle 45 px ein neuer Punkt
  let edit = null;           // { pts, halfW, undo, drag, track, error, erase }

  function canvasPos(e) {
    const r = cv.getBoundingClientRect();
    const x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height;
    return [Math.max(0, Math.min(S.WORLD_W, x)), Math.max(0, Math.min(S.WORLD_H, y))];
  }

  function startEditor() {
    race = null;
    document.body.classList.remove('racing');
    document.body.classList.add('editing');
    stickyUntil = 0;
    const t = world.track;
    edit = {
      pts: t.ctrl ? t.ctrl.map((p) => [p[0], p[1]]) : [], halfW: t.halfW || S.HALF_W,
      image: t.src ? { ...t.src, flip: t.flip } : null, undo: [], drag: null, erase: false
    };
    $('width').value = edit.halfW;
    $('v-width').textContent = edit.halfW * 2 + ' px';
    $('erase').checked = false;
    rebuild(true);
    refreshTrackList();
  }

  function stopEditor() {
    edit = null;
    document.body.classList.remove('editing');
  }

  function snapshot() {
    edit.undo.push(edit.pts.map((p) => p.slice()));
    if (edit.undo.length > 200) edit.undo.shift();
  }

  /** Strecke aus den Punkten neu bauen; validate = auf Fehler prüfen (teuer, nicht beim Ziehen) */
  function rebuild(validate) {
    if (edit.image) {
      if (!edit.image.track || edit.image.track.flip !== edit.image.flip) {
        const tr = S.trackFromPixels(edit.image.rgba, edit.image.flip);
        if (!tr.error) tr.src = { rgba: edit.image.rgba, url: edit.image.url };
        edit.image.track = tr;
      }
      edit.track = edit.image.track.error ? null : edit.image.track;
      edit.error = edit.image.track.error || null;
    } else {
      edit.track = edit.pts.length >= 3 ? S.trackFromCtrl(edit.pts, edit.halfW) : null;
      if (validate) edit.error = edit.track ? S.validateTrack(edit.track) : 'Mindestens 3 Punkte setzen.';
    }
    $('b-apply').disabled = !!edit.error;
    $('b-tsave').disabled = !!edit.error;
    $('b-share').disabled = !!edit.error || !!edit.image;
    $('width').disabled = !!edit.image;
    stickyUntil = 0;                       // Editor-Status hat Vorrang vor alten Hinweisen
    if (edit.error) msg('⚠️ ' + edit.error);
    else if (edit.image) msg(`✓ Bild-Strecke ok — Länge ca. ${Math.round(edit.track.length / 10) * 10} px. Mit „⇄ Richtung“ umdrehen, mit „🗑 Leeren“ zurück zum Punkte-Editor.`);
    else msg(`✓ Strecke ok — ${edit.pts.length} Punkte, Länge ca. ${Math.round(edit.track.n * 8 / 10) * 10} px`);
  }

  function hitPoint(p) {
    const R = hitR();
    let best = -1, bd = R * R;
    edit.pts.forEach((q, i) => {
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // Abstand Punkt -> Strecke a-b
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ((dx * dx + dy * dy) || 1)));
    return Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
  }

  function hitLine(p) {
    const n = edit.pts.length;
    if (n < 3) return -1;
    let best = -1, bd = hitR();
    for (let i = 0; i < n; i++) {
      const d = segDist(p, edit.pts[i], edit.pts[(i + 1) % n]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function deletePoint(i) {
    snapshot();
    edit.pts.splice(i, 1);
    rebuild(true);
  }

  cv.addEventListener('pointerdown', (e) => {
    if (!edit) return;
    e.preventDefault();
    if (edit.image) { msg('Bild-Strecke aktiv — ändere das Bild in Paint, oder „🗑 Leeren“ für den Punkte-Editor.'); return; }
    const p = canvasPos(e);
    const i = hitPoint(p);
    if (edit.erase) { if (i >= 0) deletePoint(i); return; }
    cv.setPointerCapture(e.pointerId);
    snapshot();
    if (i >= 0) {
      edit.drag = { type: 'move', i, moved: false };
    } else {
      const seg = hitLine(p);
      if (seg >= 0) {                                   // auf die Linie geklickt: Punkt einfügen
        edit.pts.splice(seg + 1, 0, p);
        edit.drag = { type: 'move', i: seg + 1, moved: true };
      } else {                                          // freie Fläche: Punkt anhängen / freihand zeichnen
        edit.pts.push(p);
        edit.drag = { type: 'draw', last: p, moved: true };
      }
      rebuild(false);
    }
  });

  cv.addEventListener('pointermove', (e) => {
    if (!edit || edit.image) return;
    const p = canvasPos(e);
    if (!edit.drag) {
      cv.style.cursor = edit.erase ? (hitPoint(p) >= 0 ? 'pointer' : 'default')
        : hitPoint(p) >= 0 ? 'grab' : hitLine(p) >= 0 ? 'copy' : 'crosshair';
      return;
    }
    const d = edit.drag;
    if (d.type === 'move') {
      edit.pts[d.i] = p;
      d.moved = true;
      rebuild(false);
    } else if (Math.hypot(p[0] - d.last[0], p[1] - d.last[1]) > DRAW_STEP) {
      edit.pts.push(p);
      d.last = p;
      rebuild(false);
    }
  });

  function endDrag() {
    if (!edit || !edit.drag) return;
    if (!edit.drag.moved) edit.undo.pop();          // nur angeklickt, nichts geändert
    edit.drag = null;
    rebuild(true);
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('dblclick', (e) => {
    if (!edit || edit.erase) return;
    const i = hitPoint(canvasPos(e));
    if (i >= 0) deletePoint(i);
  });
  cv.addEventListener('contextmenu', (e) => {           // Rechtsklick auf Punkt = löschen
    if (!edit) return;
    e.preventDefault();
    const i = hitPoint(canvasPos(e));
    if (i >= 0) deletePoint(i);
  });

  function startArrow(x, y, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = COL.pos;
    ctx.beginPath(); ctx.moveTo(34, 0); ctx.lineTo(18, -9); ctx.lineTo(18, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function editFrame() {
    if (edit.image) {
      if (edit.track) {
        drawTrack(edit.track);
        startArrow(edit.track.start.x, edit.track.start.y, edit.track.start.a);
      } else {
        ctx.fillStyle = COL.bg;
        ctx.fillRect(0, 0, S.WORLD_W, S.WORLD_H);
        if (edit.image.img) { ctx.globalAlpha = 0.6; ctx.drawImage(edit.image.img, 0, 0); ctx.globalAlpha = 1; }
      }
      return;
    }
    const bad = !!edit.error && !edit.drag;
    drawTrack(edit.track, { grid: true, wall: bad ? COL.neg : COL.wall });
    const pts = edit.pts, n = pts.length;
    if (n) {
      // Kontroll-Polygon
      ctx.setLineDash([3, 6]);
      ctx.strokeStyle = 'rgba(210,206,253,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
      if (n >= 3) ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      // Fahrtrichtung am Start
      if (edit.track) {
        const a = edit.track.center[0], b = edit.track.center[3];
        startArrow(a[0], a[1], Math.atan2(b[1] - a[1], b[0] - a[0]));
      }
      // Punkte
      const k = Math.max(1, scale() * 0.6);         // Punkte am Handy grösser zeichnen
      ctx.font = `${Math.round(11 * k)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      pts.forEach((q, i) => {
        ctx.fillStyle = i === 0 ? COL.pos : COL.car;
        ctx.beginPath(); ctx.arc(q[0], q[1], (i === 0 ? 9 : 7) * k, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#10111b'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#10111b';
        ctx.fillText(i === 0 ? 'S' : String(i + 1), q[0], q[1] + 4 * k);
      });
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = '#9397ab';
      ctx.font = '22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Klicke Punkte oder zeichne mit gedrückter Maus eine Runde', S.WORLD_W / 2, S.WORLD_H / 2);
      ctx.textAlign = 'left';
    }
  }

  // ── Meine Strecken (Browser-Speicher) + Teilen per Link ──
  function loadTracks() {
    try { return JSON.parse(localStorage.getItem(TRACKS_KEY)) || []; } catch (_) { return []; }
  }
  function storeTracks(list) {
    try { localStorage.setItem(TRACKS_KEY, JSON.stringify(list)); return true; } catch (_) { return false; }
  }
  function refreshTrackList() {
    const sel = $('my-tracks'), list = loadTracks();
    sel.innerHTML = '';
    if (!list.length) sel.add(new Option('— noch keine gespeichert —', ''));
    list.forEach((t, i) => sel.add(new Option(t.name, i)));
  }
  const roundPts = (pts) => pts.map((p) => [Math.round(p[0]), Math.round(p[1])]);

  function encodeTrack(halfW, pts) {
    return btoa(JSON.stringify({ w: halfW, p: roundPts(pts) }));
  }
  function decodeTrack(code) {
    try {
      const o = JSON.parse(atob(code));
      if (!Array.isArray(o.p) || o.p.length < 3 || !o.p.every((q) => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite))) return null;
      const w = Math.max(14, Math.min(60, +o.w || S.HALF_W));
      const tr = S.trackFromCtrl(o.p, w);
      return S.validateTrack(tr) ? null : tr;
    } catch (_) { return null; }
  }

  $('b-edit').addEventListener('click', startEditor);
  $('b-cancel').addEventListener('click', stopEditor);
  $('b-apply').addEventListener('click', () => {
    if (!edit || edit.error) return;
    world.setTrack(edit.image ? edit.track : S.trackFromCtrl(edit.pts, edit.halfW));
    world.bestEver = 0;          // Rekord gilt pro Strecke
    world.history = [];
    stopEditor();
    msg('🏁 Neue Strecke übernommen — die KI lernt jetzt darauf.', true);
  });
  $('b-undo').addEventListener('click', () => {
    if (!edit || edit.image || !edit.undo.length) return;
    edit.pts = edit.undo.pop();
    rebuild(true);
  });
  $('b-clear').addEventListener('click', () => { edit.image = null; snapshot(); edit.pts = []; rebuild(true); });
  $('b-random').addEventListener('click', () => {
    edit.image = null;
    snapshot();
    const tr = S.makeTrack((Math.random() * 1e9) >>> 0);
    edit.pts = tr.ctrl;
    rebuild(true);
  });
  $('b-reverse').addEventListener('click', () => {
    if (edit.image) { edit.image.flip = !edit.image.flip; rebuild(true); return; }
    if (edit.pts.length < 2) return;
    snapshot();
    edit.pts = [edit.pts[0], ...edit.pts.slice(1).reverse()];
    rebuild(true);
  });
  $('width').addEventListener('input', (e) => {
    edit.halfW = +e.target.value;
    $('v-width').textContent = edit.halfW * 2 + ' px';
    rebuild(false);
  });
  $('width').addEventListener('change', () => rebuild(true));
  $('erase').addEventListener('change', (e) => { edit.erase = e.target.checked; });
  $('b-tsave').addEventListener('click', () => {
    if (!edit || edit.error) return;
    const list = loadTracks();
    const name = (prompt('Name der Strecke:', 'Meine Strecke ' + (list.length + 1)) || '').trim();
    if (!name) return;
    const entry = edit.image
      ? { name: name.slice(0, 40), img: edit.image.url, flip: edit.image.flip }
      : { name: name.slice(0, 40), w: edit.halfW, p: roundPts(edit.pts) };
    const at = list.findIndex((t) => t.name === entry.name);
    if (at >= 0) list[at] = entry; else list.push(entry);
    msg(storeTracks(list) ? `💾 „${entry.name}“ gespeichert.` : 'Speichern nicht möglich (Browser-Speicher voll oder blockiert).');
    refreshTrackList();
    $('my-tracks').value = String(at >= 0 ? at : list.length - 1);
  });
  $('b-tload').addEventListener('click', () => {
    const t = loadTracks()[+$('my-tracks').value];
    if (!t || $('my-tracks').value === '') return;
    if (t.img) { loadImage(t.img, t.flip); return; }
    edit.image = null;
    snapshot();
    edit.pts = t.p.map((q) => q.slice());
    edit.halfW = t.w;
    $('width').value = t.w;
    $('v-width').textContent = t.w * 2 + ' px';
    rebuild(true);
  });
  $('b-tdel').addEventListener('click', () => {
    const i = $('my-tracks').value;
    if (i === '') return;
    const list = loadTracks();
    if (!list[+i] || !confirm(`„${list[+i].name}“ löschen?`)) return;
    list.splice(+i, 1);
    storeTracks(list);
    refreshTrackList();
  });
  $('b-share').addEventListener('click', () => {
    if (!edit || edit.error) return;
    const url = location.href.split('#')[0] + '#strecke=' + encodeURIComponent(encodeTrack(edit.halfW, edit.pts));
    const done = () => msg('🔗 Link kopiert — wer ihn öffnet, bekommt deine Strecke.');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => prompt('Link zum Kopieren:', url));
    } else prompt('Link zum Kopieren:', url);
  });

  // ── Bild-Strecken (Paint) ──
  /** Bild auf 1000×640 einpassen (weisser Rand) und als Strecke prüfen */
  function useImage(img, flip) {
    const c = document.createElement('canvas');
    c.width = S.WORLD_W; c.height = S.WORLD_H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    const k = Math.min(c.width / img.width, c.height / img.height);
    const w = img.width * k, h = img.height * k;
    g.imageSmoothingEnabled = false;                    // keine Mischfarben an den Kanten
    g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h);
    edit.image = { rgba: g.getImageData(0, 0, c.width, c.height).data, url: c.toDataURL('image/png'), img: c, flip: !!flip };
    rebuild(true);
  }

  function loadImage(src, flip) {
    const img = new Image();
    img.onload = () => { if (edit) useImage(img, flip); };
    img.onerror = () => msg('⚠️ Das Bild konnte nicht geladen werden (PNG, JPG oder BMP verwenden).');
    img.src = src;
  }

  function loadFile(file) {
    if (!file || !edit) return;
    if (!/^image\//.test(file.type) && !/\.(png|jpe?g|bmp|gif|webp)$/i.test(file.name)) { msg('⚠️ Bitte eine Bilddatei wählen.'); return; }
    const r = new FileReader();
    r.onload = () => loadImage(r.result, false);
    r.readAsDataURL(file);
  }

  $('b-image').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
  cv.addEventListener('dragover', (e) => { if (edit) e.preventDefault(); });
  cv.addEventListener('drop', (e) => {
    if (!edit) return;
    e.preventDefault();
    loadFile(e.dataTransfer.files[0]);
  });

  // Vorlage für Paint: aktuelle (oder zufällige) Strecke schwarz auf weiss, grüne Startlinie, roter Richtungspunkt
  $('b-template').addEventListener('click', () => {
    let tr = edit && !edit.image && !edit.error && edit.track;
    if (!tr) tr = S.makeTrack((Math.random() * 1e9) >>> 0);
    const c = document.createElement('canvas');
    c.width = S.WORLD_W; c.height = S.WORLD_H;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.beginPath();
    for (const w of [tr.left, tr.right]) {
      g.moveTo(w[0][0], w[0][1]);
      for (let i = 1; i < w.length; i++) g.lineTo(w[i][0], w[i][1]);
      g.closePath();
    }
    g.fillStyle = '#000';
    g.fill('evenodd');
    const L = tr.left[0], R = tr.right[0];
    g.strokeStyle = 'rgb(34,177,76)';
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(L[0], L[1]); g.lineTo(R[0], R[1]); g.stroke();
    const d = tr.center[Math.min(4, tr.n - 1)];
    g.fillStyle = 'rgb(237,28,36)';
    g.beginPath(); g.arc(d[0], d[1], 6, 0, Math.PI * 2); g.fill();
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'strecke-vorlage.png';
    document.body.appendChild(a); a.click(); a.remove();
    msg('📄 Vorlage heruntergeladen — in Paint öffnen, bearbeiten, speichern und mit „🖼️ Bild laden“ einlesen.', true);
  });

  // Strecke aus geteiltem Link übernehmen
  const shared = /#strecke=([^&]+)/.exec(location.hash);
  if (shared) {
    const tr = decodeTrack(decodeURIComponent(shared[1]));
    if (tr) { world.setTrack(tr); msg('🔗 Geteilte Strecke geladen.', true); }
    else msg('⚠️ Der Strecken-Link ist ungültig.', true);
  }

  // ─── Schleife ───
  function frame() {
    if (edit) editFrame(); else if (race) raceFrame(); else trainFrame();
    requestAnimationFrame(frame);
  }


  // ─── Bedienung ───
  $('speed').addEventListener('input', (e) => { speed = +e.target.value; $('v-speed').textContent = speed + '×'; });
  $('mut').addEventListener('input', (e) => {
    world.mutationRate = e.target.value / 100;
    $('v-mut').textContent = e.target.value + ' %';
  });
  $('rays').addEventListener('change', (e) => { showRays = e.target.checked; });
  $('shuffle').addEventListener('change', (e) => { shuffle = e.target.checked; });
  $('b-track').addEventListener('click', newTrack);
  function updateNetInfo() {
    const L = world.layers;
    $('net-info').textContent = `${L[0]} Eingaben → ${L.slice(1, -1).join(' → ')} → ${L[L.length - 1]} Ausgaben`;
    $('sensor-info').textContent = world.rays === S.RAY_ANGLES.length
      ? '7 Abstands-Sensoren nach vorne'
      : `LiDAR: ${world.rays} Strahlen rundherum (360°)`;
  }
  $('b-reset').addEventListener('click', () => {
    world = new S.World({ track: world.track, rays: world.rays, mutationRate: $('mut').value / 100 });
  });
  $('sensors').addEventListener('change', (e) => {
    world = new S.World({ track: world.track, rays: +e.target.value, mutationRate: $('mut').value / 100 });
    updateNetInfo();
    msg(+e.target.value === S.RAY_ANGLES.length
      ? '👀 Standard-Sensoren — neue Generation 1.'
      : `📡 LiDAR mit ${e.target.value} Strahlen — neue Generation 1. Tipp: „Jede Generation neue Strecke“ einschalten.`, true);
  });
  $('b-save').addEventListener('click', () => {
    const best = world.champion || world.leader().brain;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(best)); msg('💾 Bestes Netz gespeichert.', true); }
    catch (_) { msg('Speichern nicht möglich (Browser-Speicher blockiert).', true); }
  });
  $('b-load').addEventListener('click', () => {
    let net = null;
    try { net = S.NeuralNet.fromJSON(JSON.parse(localStorage.getItem(SAVE_KEY))); } catch (_) { /* leer */ }
    if (!net) { msg('Kein gespeichertes Netz gefunden.', true); return; }
    world = new S.World({ track: world.track, seedBrain: net, mutationRate: $('mut').value / 100 });
    world.champion = net.clone();
    if ([...$('sensors').options].some((o) => +o.value === world.rays)) $('sensors').value = world.rays;
    updateNetInfo();
    msg('📂 Gespeichertes Netz geladen — es fährt in der neuen Generation mit.', true);
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

  // Regler auf die Startwerte aus sim.js setzen (falls dort geändert)
  $('mut').value = Math.round(world.mutationRate * 100);
  $('v-mut').textContent = $('mut').value + ' %';
  updateNetInfo();
  requestAnimationFrame(frame);
})();
