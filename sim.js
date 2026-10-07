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
  const RAY_LEN = 220;
  const MAX_V = 8;
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

  // ─── Auto ───
  class Car {
    constructor(track, brain) {
      this.brain = brain;
      this.reset(track);
    }

    reset(track) {
      const a = track.center[0], b = track.center[1];
      this.x = a[0]; this.y = a[1];
      this.a = Math.atan2(b[1] - a[1], b[0] - a[0]);
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
      this.rays = new Float64Array(RAY_ANGLES.length).fill(1);
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
      for (let r = 0; r < RAY_ANGLES.length; r++) {
        const ang = this.a + RAY_ANGLES[r];
        const ex = this.x + Math.cos(ang) * RAY_LEN, ey = this.y + Math.sin(ang) * RAY_LEN;
        let best = 1;
        for (let d = -15; d <= 40; d++) {
          const i = mod(this.idx + d, track.n), j = (i + 1) % track.n;
          for (const wall of [track.left, track.right]) {
            const t = segHit(this.x, this.y, ex, ey, wall[i][0], wall[i][1], wall[j][0], wall[j][1]);
            if (t >= 0 && t < best) best = t;
          }
        }
        this.rays[r] = best;
      }
      return this.rays;
    }

    hitsWall(track) {
      const c = this.corners();
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
      this.a += steer * 0.07 * Math.min(1, this.v / 2.5);
      this.v += throttle > 0 ? throttle * 0.22 : throttle * 0.4;
      this.v *= 0.985;
      if (this.v < 0) this.v = 0;
      if (this.v > MAX_V) this.v = MAX_V;
      const ox = this.x, oy = this.y;
      this.x += Math.cos(this.a) * this.v;
      this.y += Math.sin(this.a) * this.v;

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

      if (this.hitsWall(track)) {
        if (bounce) {
          // zurücksetzen und leicht Richtung Mittellinie schieben, damit man nicht festklebt
          const p = track.center[this.idx], dx = p[0] - ox, dy = p[1] - oy, d = Math.hypot(dx, dy) || 1;
          this.x = ox + (dx / d) * 3; this.y = oy + (dy / d) * 3;
          this.v = 0; this.crashed = true;
        }
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

    think(track) {
      const inp = Array.from(this.sense(track));
      inp.push(this.v / MAX_V);
      return this.brain.predict(inp);
    }
  }

  // ─── Population + Evolution ───
  class World {
    constructor(opts = {}) {
      this.popSize = opts.popSize || 60;
      this.mutationRate = opts.mutationRate ?? 0.1;
      this.mutationStrength = opts.mutationStrength ?? 0.5;
      this.rnd = opts.rnd || Math.random;
      this.track = opts.track || makeTrack(opts.seed ?? 1);
      this.generation = 1;
      this.bestEver = 0;
      this.champion = null;   // bestes Netz bisher
      this.history = [];      // beste Fitness je Generation
      this.cars = [];
      for (let i = 0; i < this.popSize; i++) this.cars.push(new Car(this.track, new NeuralNet(LAYERS, null, this.rnd)));
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
        if (r < 0.1) child = new NeuralNet(LAYERS, null, this.rnd);                       // frisches Blut
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
    WORLD_W, WORLD_H, N, HALF_W, CAR_L, CAR_W, RAY_ANGLES, RAY_LEN, MAX_V, LAYERS, LAPS, MAX_STEPS,
    makeTrack, trackFromCtrl, validateTrack, Car, World, NeuralNet, mulberry32
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = RaceSim;
  else root.RaceSim = RaceSim;
})(this);
