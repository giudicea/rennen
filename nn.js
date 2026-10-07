/*
 * nn.js — kleines vorwärtsgerichtetes neuronales Netz (Feed-Forward, tanh)
 *
 * Kein Backprop: die Gewichte werden per Neuroevolution (siehe sim.js)
 * verbessert — kopieren, kreuzen, mutieren.
 *
 *   const net = new NeuralNet([8, 10, 6, 2]);
 *   net.predict([...8 Eingaben]) -> [2 Ausgaben in -1..1]
 *
 * Läuft im Browser (window.NeuralNet) und in Node (module.exports).
 */
(function (root) {
  'use strict';

  function gauss(rnd) {
    // Box-Muller
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  class NeuralNet {
    /**
     * @param {number[]} sizes  Neuronen je Schicht, z. B. [8, 10, 6, 2]
     * @param {Float64Array} [weights]  flache Gewichte (sonst zufällig)
     */
    constructor(sizes, weights, rnd = Math.random) {
      this.sizes = sizes.slice();
      let n = 0;
      for (let l = 1; l < sizes.length; l++) n += sizes[l] * (sizes[l - 1] + 1); // +1 = Bias
      this.count = n;
      if (weights) {
        this.w = Float64Array.from(weights);
      } else {
        this.w = new Float64Array(n);
        for (let i = 0; i < n; i++) this.w[i] = rnd() * 2 - 1;
      }
      // Aktivierungen der letzten Auswertung (für die Visualisierung)
      this.act = sizes.map((s) => new Float64Array(s));
    }

    predict(input) {
      const { sizes, w, act } = this;
      act[0].set(input);
      let k = 0;
      for (let l = 1; l < sizes.length; l++) {
        const prev = act[l - 1], cur = act[l], np = sizes[l - 1];
        for (let j = 0; j < sizes[l]; j++) {
          let sum = w[k++]; // Bias
          for (let i = 0; i < np; i++) sum += prev[i] * w[k++];
          cur[j] = Math.tanh(sum);
        }
      }
      return Array.from(act[act.length - 1]);
    }

    /** Gewicht der Verbindung i (Schicht l-1) -> j (Schicht l) */
    weight(l, i, j) {
      let k = 0;
      for (let m = 1; m < l; m++) k += this.sizes[m] * (this.sizes[m - 1] + 1);
      return this.w[k + j * (this.sizes[l - 1] + 1) + 1 + i];
    }

    clone() { return new NeuralNet(this.sizes, this.w); }

    /** Jedes Gewicht mit Wahrscheinlichkeit `rate` um N(0, strength) verschieben */
    mutate(rate, strength, rnd = Math.random) {
      for (let i = 0; i < this.count; i++) {
        if (rnd() < rate) {
          this.w[i] += gauss(rnd) * strength;
          if (this.w[i] > 4) this.w[i] = 4;
          if (this.w[i] < -4) this.w[i] = -4;
        }
      }
      return this;
    }

    /** Uniformes Crossover zweier Eltern gleicher Form */
    static crossover(a, b, rnd = Math.random) {
      const child = a.clone();
      for (let i = 0; i < child.count; i++) if (rnd() < 0.5) child.w[i] = b.w[i];
      return child;
    }

    toJSON() { return { sizes: this.sizes, w: Array.from(this.w) }; }

    static fromJSON(o) {
      if (!o || !Array.isArray(o.sizes) || !Array.isArray(o.w)) return null;
      const net = new NeuralNet(o.sizes, o.w);
      return net.count === o.w.length ? net : null;
    }
  }

  NeuralNet.gauss = gauss;

  if (typeof module !== 'undefined' && module.exports) module.exports = NeuralNet;
  else root.NeuralNet = NeuralNet;
})(this);
