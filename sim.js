/*
 * sim.js — Strecke, Fahrphysik, Sensoren und Evolution (ohne Grafik)
 *
 * Jedes Auto hat 7 Abstands-Sensoren (Strahlen) + seine Geschwindigkeit als
 * Eingaben. Das Netz gibt Lenkung und Gas/Bremse aus. Nach jeder Generation
 * werden die besten Fahrer gekreuzt und mutiert (Neuroevolution).
 *
 * Läuft im Browser (window.RaceSim) und in Node (module.exports).
 */
(function (root) {
  'use strict';

  const NeuralNet = (typeof module !== 'undefined' && module.exports)
    ? require('./nn.js') : root.NeuralNet;

  // ─── Konstanten ───
  const WORLD_W = 1000, WORLD_H = 640;
  const N = 240;               // Punkte der Mittellinie
  const HALF_W = 34;           // halbe Streckenbreite
  const CAR_L = 18, CAR_W = 9;
  const RAY_ANGLES = [-90, -45, -20, 0, 20, 45, 90].map((d) => d * Math.PI / 180);
  const SENSOR_MODES = [7, 16, 32];     // 7 = Standard (vorne), sonst LiDAR 360°

  /** Sensor-Richtungen: 7 = Fächer nach vorne, sonst gleichmässig rundherum (LiDAR) */
  const angleCache = {};
  function rayAngles(count) {
    if (count === RAY_ANGLES.length) return RAY_ANGLES;
    if (!angleCache[count]) {
      // bei 0 (geradeaus) beginnen, dann im Uhrzeigersinn einmal rundherum
      angleCache[count] = Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        return a > Math.PI ? a - Math.PI * 2 : a;
      });
    }
    return angleCache[count];
  }
  /** Netzform je Sensoranzahl: Eingaben = Sensoren + Tempo */
  function layersFor(count) {
    return count > RAY_ANGLES.length ? [count + 1, 14, 8, 2] : [count + 1, 10, 6, 2];
  }
  const RAY_LEN = 500;
  const MAX_V = 20;
  const LAYERS = [RAY_ANGLES.length + 1, 10, 6, 2];
  const LAPS = 3;
  const STUCK_STEPS = 120;     // so lange ohne Fortschritt -> ausgeschieden
  const MAX_STEPS = 3000;      // Zeitlimit einer Generation

  // ─── Hilfsfunktionen ───
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const mod = (i, n) => ((i % n) + n) % n;

  // Schnittpunkt Strecke p->p2 mit q->q2; liefert t entlang p->p2 oder -1
  function segHit(px, py, p2x, p2y, qx, qy, q2x, q2y) {
    const rx = p2x - px, ry = p2y - py, sx = q2x - qx, sy = q2y - qy;
    const den = rx * sy - ry * sx;
    if (den === 0) return -1;
    const t = ((qx - px) * sy - (qy - py) * sx) / den;
    const u = ((qx - px) * ry - (qy - py) * rx) / den;
    return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? t : -1;
  }

  function polylineSelfIntersects(pts) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // Nachbarn über den Nullpunkt
        const c = pts[j], d = pts[(j + 1) % n];
        if (segHit(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]) >= 0) return true;
      }
    }
    return false;
  }

  // ─── Strecke ───
  function randomCtrl(seed) {
    const rnd = mulberry32(seed);
    const K = 12, cx = WORLD_W / 2, cy = WORLD_H / 2, rx = 430, ry = 255;
    const ctrl = [];
    for (let i = 0; i < K; i++) {
      const t = (i / K) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
      const r = 0.55 + rnd() * 0.45;
      ctrl.push([cx + Math.cos(t) * rx * r, cy + Math.sin(t) * ry * r]);
    }
    return ctrl;
  }

  /**
   * Baut eine geschlossene Strecke durch Kontrollpunkte (Catmull-Rom).
   * @param {number[][]} ctrl  mind. 3 Punkte [x, y]
   * @param {number} [halfW]   halbe Streckenbreite
   * @param {number} [n]       Anzahl Mittellinien-Punkte (sonst aus der Länge, ~8 px Abstand)
   */
  function trackFromCtrl(ctrl, halfW = HALF_W, n) {
    const K = ctrl.length, per = 20, dense = [];
    for (let i = 0; i < K; i++) {
      const p0 = ctrl[mod(i - 1, K)], p1 = ctrl[i], p2 = ctrl[(i + 1) % K], p3 = ctrl[(i + 2) % K];
      for (let s = 0; s < per; s++) {
        const t = s / per, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    if (!n) {
      let len = 0;
      for (let i = 0; i < dense.length; i++) {
        const a = dense[i], b = dense[(i + 1) % dense.length];
        len += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
      n = Math.max(60, Math.min(800, Math.round(len / 8)));
    }
    // Abstände gleichmässig machen (Resampling nach Bogenlänge)
    const pts = resample(dense, n);
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[mod(i - 1, n)], b = pts[(i + 1) % n];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
      left.push([pts[i][0] - ty * halfW, pts[i][1] + tx * halfW]);
      right.push([pts[i][0] + ty * halfW, pts[i][1] - tx * halfW]);
    }
    return {
      ctrl: ctrl.map((p) => [p[0], p[1]]), halfW, n, center: pts, left, right,
      maxSteps: Math.max(MAX_STEPS, n * LAPS * 4)
    };
  }

  function polylinesCross(a, b) {
    const n = a.length, m = b.length;
    for (let i = 0; i < n; i++) {
      const p = a[i], q = a[(i + 1) % n];
      for (let j = 0; j < m; j++) {
        const r = b[j], s = b[(j + 1) % m];
        if (segHit(p[0], p[1], q[0], q[1], r[0], r[1], s[0], s[1]) >= 0) return true;
      }
    }
    return false;
  }

  /** Prüft eine Strecke; liefert null (ok) oder eine Fehlermeldung */
  function validateTrack(tr) {
    if (!tr || tr.ctrl.length < 3) return 'Mindestens 3 Punkte setzen.';
    const M = 4;
    for (const w of [tr.left, tr.right]) {
      for (const p of w) {
        if (p[0] < M || p[1] < M || p[0] > WORLD_W - M || p[1] > WORLD_H - M) return 'Die Strecke ragt über den Rand.';
      }
    }
    if (polylineSelfIntersects(tr.left) || polylineSelfIntersects(tr.right) || polylinesCross(tr.left, tr.right)) {
      return 'Die Strecke überschneidet sich oder eine Kurve ist zu eng.';
    }
    return null;
  }

  function buildTrack(seed) {
    const tr = trackFromCtrl(randomCtrl(seed), HALF_W, N);
    tr.seed = seed;
    return tr;
  }

  function resample(pts, n) {
    const m = pts.length, cum = [0];
    for (let i = 1; i <= m; i++) {
      const a = pts[i - 1], b = pts[i % m];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[m], out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const d = (k / n) * total;
      while (cum[j + 1] < d) j++;
      const a = pts[j], b = pts[(j + 1) % m];
      const t = (d - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }

  /** Erzeugt eine gültige Strecke (Wände dürfen sich nicht selbst schneiden) */
  function makeTrack(seed) {
    for (let s = seed >>> 0; ; s = (s + 7919) >>> 0) {
      const tr = buildTrack(s);
      if (!validateTrack(tr)) return tr;
    }
  }

  // ─── Bild-Strecke (z. B. in Paint gemalt) ───
  // Farben: dunkel (schwarz/grau) = Strasse, hell (weiss …) = Wand,
  // grün = Start-/Ziellinie quer über die Strasse, rot (optional) = Fahrtrichtung.
  function pixelKind(r, g, b) {
    if (g > 120 && g > r + 40 && g > b + 40) return 3;            // grün: Startlinie
    if (r > 140 && r > g + 60 && r > b + 60) return 4;            // rot: Richtung
    return (0.299 * r + 0.587 * g + 0.114 * b) < 140 ? 1 : 0;     // dunkel = Strasse
  }

  /**
   * Baut eine Strecke aus Bildpunkten (RGBA, genau WORLD_W × WORLD_H).
   * @param {Uint8ClampedArray} rgba
   * @param {boolean} [flip]  Fahrtrichtung umdrehen
   * @returns {object} Strecke oder { error }
   */
  function trackFromPixels(rgba, flip) {
    const W = WORLD_W, H = WORLD_H, size = W * H;
    const kind = new Uint8Array(size);
    let gx = 0, gy = 0, gn = 0, rx = 0, ry = 0, rn = 0, roadN = 0;
    for (let i = 0; i < size; i++) {
      const k = pixelKind(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
      kind[i] = k;
      const x = i % W, y = (i / W) | 0;
      if (k === 3) { gx += x; gy += y; gn++; }
      else if (k === 4) { rx += x; ry += y; rn++; }
      else if (k === 1) roadN++;
    }
    if (roadN < 2000) return { error: 'Keine Strasse gefunden — male die Strasse schwarz oder dunkelgrau auf weissen Hintergrund.' };
    if (gn < 5) return { error: 'Keine grüne Startlinie gefunden — zeichne eine grüne Linie quer über die Strasse.' };
    gx /= gn; gy /= gn;
    // Hauptachse der grünen Linie (Kovarianz) -> Normale = Fahrtrichtung
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < size; i++) {
      if (kind[i] !== 3) continue;
      const dx = (i % W) - gx, dy = ((i / W) | 0) - gy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let nx = -Math.sin(th), ny = Math.cos(th);
    if (rn) { if ((rx / rn - gx) * nx + (ry / rn - gy) * ny < 0) { nx = -nx; ny = -ny; } }
    if (flip) { nx = -nx; ny = -ny; }

    // Strasse = dunkel + rot; Startlinie ist für die Distanz-Suche eine Sperre
    const road = new Uint8Array(size);
    for (let i = 0; i < size; i++) road[i] = (kind[i] === 1 || kind[i] === 3 || kind[i] === 4) ? 1 : 0;
    for (let x = 0; x < W; x++) { road[x] = 0; road[(H - 1) * W + x] = 0; }
    for (let y = 0; y < H; y++) { road[y * W] = 0; road[y * W + W - 1] = 0; }

    // Breitensuche ab der Vorderseite der Startlinie einmal rundherum
    const dist = new Float32Array(size).fill(-1);
    const queue = new Int32Array(size);
    let qh = 0, qt = 0;
    const side = new Int8Array(size);   // +1/-1: Strassenpunkte direkt an der Linie
    for (let i = 0; i < size; i++) {
      if (kind[i] !== 3) continue;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = (y + dy) * W + (x + dx);
        if (j < 0 || j >= size || !road[j] || kind[j] === 3) continue;
        const sd = ((x + dx) - gx) * nx + ((y + dy) - gy) * ny;
        side[j] = sd >= 0 ? 1 : -1;
        if (sd >= 0 && dist[j] < 0) { dist[j] = 0; queue[qt++] = j; }
      }
    }
    if (!qt) return { error: 'Die grüne Startlinie liegt nicht auf der Strasse.' };
    const D8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    while (qh < qt) {
      const i = queue[qh++], x = i % W, y = (i / W) | 0;
      for (const [dx, dy, c] of D8) {
        const j = (y + dy) * W + (x + dx);
        if (!road[j] || kind[j] === 3 || dist[j] >= 0) continue;
        dist[j] = dist[i] + c;
        queue[qt++] = j;
      }
    }
    // Länge = Distanz auf der Rückseite der Startlinie
    let L = 0, back = 0;
    for (let i = 0; i < size; i++) if (side[i] === -1 && dist[i] > 0) { L += dist[i]; back++; }
    if (!back) return { error: 'Die Strasse ist keine geschlossene Runde (oder die Startlinie ist nicht verbunden).' };
    L /= back;
    let maxD = 0;
    for (let i = 0; i < size; i++) if (dist[i] > maxD) maxD = dist[i];
    if (L < maxD * 0.6) return { error: 'Die grüne Linie muss die Strasse ganz durchqueren (von Rand zu Rand).' };
    if (L < 300) return { error: 'Die Runde ist zu kurz.' };
    for (let i = 0; i < size; i++) if (kind[i] === 3) dist[i] = 0;

    const n = Math.round(L / 8);
    return {
      kind: 'bild', road, dist, flip: !!flip, n, length: L,
      start: { x: gx, y: gy, a: Math.atan2(ny, nx) },
      maxSteps: Math.max(MAX_STEPS, n * LAPS * 4)
    };
  }

  const onRoad = (tr, x, y) => {
    const xi = x | 0, yi = y | 0;
    return xi >= 0 && yi >= 0 && xi < WORLD_W && yi < WORLD_H && tr.road[yi * WORLD_W + xi] === 1;
  };
  // Fortschritt (in ~8-px-Einheiten) an einer Stelle, -1 = unbekannt
  const distAt = (tr, x, y) => {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= WORLD_W || yi >= WORLD_H) return -1;
    const d = tr.dist[yi * WORLD_W + xi];
    return d < 0 ? -1 : d / 8;
  };

  const SEG_BUF = new Float64Array(80 * 2 * 4);

  // ─── Auto ───
  class Car {
    constructor(track, brain) {
      this.brain = brain;
      this.reset(track);
    }

    reset(track) {
      if (track.start) {
        this.x = track.start.x; this.y = track.start.y; this.a = track.start.a;
      } else {
        const a = track.center[0], b = track.center[1];
        this.x = a[0]; this.y = a[1];
        this.a = Math.atan2(b[1] - a[1], b[0] - a[0]);
      }
      this.du = 0;            // Bild-Strecke: letzter Distanzwert
      this.v = 0;
      this.idx = 0;           // nächster Mittellinien-Punkt
      this.n = track.n;
      this.maxSteps = track.maxSteps;
      this.progress = 0;      // zurückgelegte Punkte (kann über n hinausgehen = Runden)
      this.best = 0;
      this.sinceBest = 0;
      this.steps = 0;
      this.alive = true;
      this.finished = false;
      this.finishStep = 0;
      this.crashed = false;
      // Sensor-Richtungen ergeben sich aus der Eingabegrösse des Netzes
      this.angles = rayAngles(this.brain ? this.brain.sizes[0] - 1 : RAY_ANGLES.length);
      this.rays = new Float64Array(this.angles.length).fill(1);
      this.out = [0, 0];
    }

    get laps() { return Math.max(0, Math.floor(this.progress / this.n)); }

    get fitness() {
      let f = Math.max(0, this.best);
      if (this.finished) f += (this.maxSteps - this.finishStep) * 0.5;
      return f;
    }

    corners() {
      const c = Math.cos(this.a), s = Math.sin(this.a);
      const hl = CAR_L / 2, hw = CAR_W / 2;
      return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([u, v]) =>
        [this.x + u * c - v * s, this.y + u * s + v * c]);
    }

    sense(track) {
      const angles = this.angles;
      // Vektor-Strecke: Wandstücke in der Nähe einmal sammeln, dann für alle Strahlen prüfen
      let segs = null, ns = 0;
      if (!track.road) {
        const back = angles.length > RAY_ANGLES.length ? -32 : -15;
        segs = SEG_BUF;
        for (let d = back; d <= 40; d++) {
          const i = mod(this.idx + d, track.n), j = (i + 1) % track.n;
          for (const wall of [track.left, track.right]) {
            segs[ns++] = wall[i][0]; segs[ns++] = wall[i][1]; segs[ns++] = wall[j][0]; segs[ns++] = wall[j][1];
          }
        }
      }
      for (let r = 0; r < angles.length; r++) {
        const ang = this.a + angles[r];
        const ex = this.x + Math.cos(ang) * RAY_LEN, ey = this.y + Math.sin(ang) * RAY_LEN;
        let best = 1;
        if (track.road) {
          const cx = Math.cos(ang), cy = Math.sin(ang);
          for (let d = 2; d <= RAY_LEN; d += 3) {
            if (!onRoad(track, this.x + cx * d, this.y + cy * d)) { best = d / RAY_LEN; break; }
          }
          this.rays[r] = best;
          continue;
        }
        for (let k = 0; k < ns; k += 4) {
          const t = segHit(this.x, this.y, ex, ey, segs[k], segs[k + 1], segs[k + 2], segs[k + 3]);
          if (t >= 0 && t < best) best = t;
        }
        this.rays[r] = best;
      }
      return this.rays;
    }

    hitsWall(track) {
      const c = this.corners();
      if (track.road) {
        for (let k = 0; k < 4; k++) {
          const p = c[k], q = c[(k + 1) % 4];
          if (!onRoad(track, p[0], p[1]) || !onRoad(track, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) return true;
        }
        return false;
      }
      for (let d = -6; d <= 6; d++) {
        const i = mod(this.idx + d, track.n), j = (i + 1) % track.n;
        for (const wall of [track.left, track.right]) {
          for (let k = 0; k < 4; k++) {
            const p = c[k], q = c[(k + 1) % 4];
            if (segHit(p[0], p[1], q[0], q[1], wall[i][0], wall[i][1], wall[j][0], wall[j][1]) >= 0) return true;
          }
        }
      }
      return false;
    }

    /** steer, throttle in -1..1 ; bounce = bei Wandkontakt abprallen statt ausscheiden */
    drive(track, steer, throttle, bounce) {
      this.steps++;
      steer = Math.max(-1, Math.min(1, steer));
      throttle = Math.max(-1, Math.min(1, throttle));
      this.out = [steer, throttle];
      this.a += steer * 0.1 * Math.min(1, this.v / 2.5);
      this.v += throttle > 0 ? throttle * 0.4 : throttle * 0.5;
      this.v *= 0.985;
      if (this.v < 0) this.v = 0;
      if (this.v > MAX_V) this.v = MAX_V;
      const ox = this.x, oy = this.y;
      this.x += Math.cos(this.a) * this.v;
      this.y += Math.sin(this.a) * this.v;

      if (track.road) this.progressRaster(track);
      else this.progressVector(track);

      if (this.hitsWall(track)) {
        if (bounce) this.bounce(track, ox, oy);
        else { this.alive = false; this.crashed = true; return; }
      }

      if (this.progress > this.best) { this.best = this.progress; this.sinceBest = 0; }
      else this.sinceBest++;

      if (this.progress >= LAPS * track.n && !this.finished) {
        this.finished = true;
        this.finishStep = this.steps;
        if (!bounce) this.alive = false;
      }
    }

    progressRaster(track) {
      const d = distAt(track, this.x, this.y);
      if (d < 0) return;
      let delta = d - this.du;
      if (delta > track.n / 2) delta -= track.n;
      if (delta < -track.n / 2) delta += track.n;
      this.du = d;
      this.progress += delta;
    }

    /** Wandkontakt im Rennmodus: zurück auf die Strasse statt ausscheiden */
    bounce(track, ox, oy) {
      this.x = ox; this.y = oy; this.v = 0; this.crashed = true;
      if (!track.road) {
        // leicht Richtung Mittellinie schieben, damit man nicht festklebt
        const p = track.center[this.idx], dx = p[0] - ox, dy = p[1] - oy, d = Math.hypot(dx, dy) || 1;
        this.x = ox + (dx / d) * 3; this.y = oy + (dy / d) * 3;
        return;
      }
      // Bild-Strecke: in Streckenrichtung drehen und etwas zur Strassenmitte rücken
      let bestA = this.a, bestD = -1;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, px = ox + Math.cos(a) * 14, py = oy + Math.sin(a) * 14;
        const d = onRoad(track, px, py) ? distAt(track, px, py) : -1;
        let rel = d - this.du;
        if (rel < -track.n / 2) rel += track.n;
        if (d >= 0 && rel > bestD) { bestD = rel; bestA = a; }
      }
      this.a = bestA;
      if (this.hitsWall(track)) { this.x += Math.cos(bestA) * 2; this.y += Math.sin(bestA) * 2; }
    }

    progressVector(track) {
      // nächsten Mittellinien-Punkt lokal suchen -> Fortschritt
      let bi = this.idx, bd = Infinity;
      for (let d = -6; d <= 12; d++) {
        const i = mod(this.idx + d, track.n), p = track.center[i];
        const dd = (p[0] - this.x) ** 2 + (p[1] - this.y) ** 2;
        if (dd < bd) { bd = dd; bi = i; }
      }
      let delta = bi - this.idx;
      if (delta > track.n / 2) delta -= track.n;
      if (delta < -track.n / 2) delta += track.n;
      this.idx = bi;
      this.progress += delta;
    }

    think(track) {
      const inp = Array.from(this.sense(track));
      inp.push(this.v / MAX_V);
      return this.brain.predict(inp);
    }
  }

  // ─── Population + Evolution ───
  class World {
    constructor(opts = {}) {
      this.popSize = opts.popSize || 500;
      this.mutationRate = opts.mutationRate ?? 0.13;
      this.mutationStrength = opts.mutationStrength ?? 0.55;
      this.rnd = opts.rnd || Math.random;
      // Anzahl Sensoren: aus einem mitgegebenen Netz, sonst Option (Standard 7)
      this.rays = opts.seedBrain ? opts.seedBrain.sizes[0] - 1 : (opts.rays || RAY_ANGLES.length);
      this.layers = opts.seedBrain ? opts.seedBrain.sizes.slice() : layersFor(this.rays);
      this.track = opts.track || makeTrack(opts.seed ?? 1);
      this.generation = 1;
      this.bestEver = 0;
      this.champion = null;   // bestes Netz bisher
      this.history = [];      // beste Fitness je Generation
      this.cars = [];
      for (let i = 0; i < this.popSize; i++) this.cars.push(new Car(this.track, new NeuralNet(this.layers, null, this.rnd)));
      if (opts.seedBrain) this.cars[0].brain = opts.seedBrain.clone();
      this.step = 0;
    }

    /** neue Strecke: Seed (Zufallsstrecke) oder fertiges Strecken-Objekt */
    setTrack(seedOrTrack) {
      this.track = typeof seedOrTrack === 'object' ? seedOrTrack : makeTrack(seedOrTrack);
      for (const c of this.cars) c.reset(this.track);
      this.step = 0;
    }

    get alive() { let n = 0; for (const c of this.cars) if (c.alive) n++; return n; }

    /** bestes noch fahrendes Auto (oder bestes überhaupt) */
    leader() {
      let best = null;
      for (const c of this.cars) if (c.alive && (!best || c.progress > best.progress)) best = c;
      if (best) return best;
      for (const c of this.cars) if (!best || c.fitness > best.fitness) best = c;
      return best;
    }

    /** einen Simulationsschritt; liefert true, wenn eine neue Generation begann */
    tick() {
      this.step++;
      let any = false;
      for (const c of this.cars) {
        if (!c.alive) continue;
        const [steer, throttle] = c.think(this.track);
        c.drive(this.track, steer, throttle, false);
        if (c.alive && (c.sinceBest > STUCK_STEPS || c.progress < -10)) c.alive = false;
        if (c.alive) any = true;
      }
      if (!any || this.step >= this.track.maxSteps) { this.evolve(); return true; }
      return false;
    }

    evolve() {
      const sorted = this.cars.slice().sort((a, b) => b.fitness - a.fitness);
      const top = sorted[0];
      this.history.push(Math.round(top.fitness));
      if (top.fitness >= this.bestEver || !this.champion) {
        this.bestEver = top.fitness;
        this.champion = top.brain.clone();
      }
      this.lastBest = { fitness: top.fitness, laps: top.laps, finished: top.finished };

      const pool = sorted.slice(0, Math.max(4, Math.floor(this.popSize * 0.3)));
      const pick = () => {
        // Turnier-Auswahl (3 Kandidaten) aus den besten 30 %
        let b = pool[Math.floor(this.rnd() * pool.length)];
        for (let k = 0; k < 2; k++) {
          const c = pool[Math.floor(this.rnd() * pool.length)];
          if (c.fitness > b.fitness) b = c;
        }
        return b.brain;
      };

      const next = [];
      next.push(this.champion.clone());          // Elite 1: bester aller Zeiten
      next.push(top.brain.clone());              // Elite 2: bester dieser Runde
      while (next.length < this.popSize) {
        const r = this.rnd();
        let child;
        if (r < 0.1) child = new NeuralNet(this.layers, null, this.rnd);                      // frisches Blut
        else if (r < 0.55) child = pick().clone();
        else child = NeuralNet.crossover(pick(), pick(), this.rnd);
        child.mutate(this.mutationRate, this.mutationStrength, this.rnd);
        next.push(child);
      }
      this.cars = next.map((b) => new Car(this.track, b));
      this.generation++;
      this.step = 0;
    }
  }

  const RaceSim = {
    WORLD_W, WORLD_H, N, HALF_W, CAR_L, CAR_W, RAY_ANGLES, SENSOR_MODES, rayAngles, layersFor, RAY_LEN, MAX_V, LAYERS, LAPS, MAX_STEPS,
    makeTrack, trackFromCtrl, validateTrack, trackFromPixels, pixelKind, Car, World, NeuralNet, mulberry32
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RaceSim;
  else root.RaceSim = RaceSim;
})(this);
