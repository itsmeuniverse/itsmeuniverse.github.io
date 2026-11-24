/* Interactive research figures + theme toggle. Vanilla JS, no dependencies. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ */
  /* Theme toggle                                                        */
  /* ------------------------------------------------------------------ */
  var darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function effectiveTheme() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return darkQuery && darkQuery.matches ? 'dark' : 'light';
  }
  var toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      refreshColors();
    });
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', refreshColors);

  var C = {};
  function refreshColors() {
    var s = getComputedStyle(root);
    ['--accent', '--warm', '--text', '--muted', '--faint', '--rule', '--fig-bg', '--surface'].forEach(function (k) {
      C[k.slice(2)] = s.getPropertyValue(k).trim();
    });
    figures.forEach(function (f) { f.dirty = true; });
  }
  function alpha(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    var n = parseInt(h, 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ------------------------------------------------------------------ */
  /* Small linear algebra for symmetric 2x2 matrices [a, b, c] = [[a,b],[b,c]] */
  /* ------------------------------------------------------------------ */
  function mul(P, Q) { // general 2x2 as [p00,p01,p10,p11]
    return [P[0] * Q[0] + P[1] * Q[2], P[0] * Q[1] + P[1] * Q[3], P[2] * Q[0] + P[3] * Q[2], P[2] * Q[1] + P[3] * Q[3]];
  }
  function full(S) { return [S[0], S[1], S[1], S[2]]; }
  function sym(M) { return [M[0], 0.5 * (M[1] + M[2]), M[3]]; }
  function sqrtSPD(S) { // exact: sqrt(M) = (M + sqrt(det) I) / sqrt(tr + 2 sqrt(det))
    var d = Math.sqrt(Math.max(S[0] * S[2] - S[1] * S[1], 0));
    var t = Math.sqrt(S[0] + S[2] + 2 * d);
    return [(S[0] + d) / t, S[1] / t, (S[2] + d) / t];
  }
  function invSym(S) { var det = S[0] * S[2] - S[1] * S[1]; return [S[2] / det, -S[1] / det, S[0] / det]; }
  function eig(S) { // returns {l1, l2, angle} with l1 >= l2, angle of l1's eigenvector
    var m = 0.5 * (S[0] + S[2]), r = Math.sqrt(0.25 * (S[0] - S[2]) * (S[0] - S[2]) + S[1] * S[1]);
    return { l1: m + r, l2: Math.max(m - r, 1e-12), angle: 0.5 * Math.atan2(2 * S[1], S[0] - S[2]) };
  }
  function spd(theta, l1, l2) {
    var c = Math.cos(theta), s = Math.sin(theta);
    return [l1 * c * c + l2 * s * s, (l1 - l2) * c * s, l1 * s * s + l2 * c * c];
  }

  /* ------------------------------------------------------------------ */
  /* Figure framework                                                    */
  /* ------------------------------------------------------------------ */
  var figures = [];

  function Figure(el, impl) {
    var self = this;
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.slider = el.querySelector('[data-role="t"]');
    this.playBtn = el.querySelector('[data-role="play"]');
    this.shuffleBtn = el.querySelector('[data-role="shuffle"]');
    this.playing = !reduceMotion;
    this.visible = false;
    this.dirty = true;
    this.impl = impl;
    this.state = {};
    impl.init(this);
    if (reduceMotion && impl.still) impl.still(this);

    this.resize();
    if (window.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(this.canvas);
    else window.addEventListener('resize', function () { self.resize(); });

    if (this.slider) {
      this.slider.addEventListener('input', function () {
        self.setPlaying(false);
        impl.setT(self, parseFloat(self.slider.value));
        self.dirty = true;
      });
    }
    if (this.playBtn) this.playBtn.addEventListener('click', function () { self.setPlaying(!self.playing); });
    if (this.shuffleBtn) this.shuffleBtn.addEventListener('click', function () { impl.shuffle(self); self.dirty = true; });
    this.setPlaying(this.playing);
  }
  Figure.prototype.setPlaying = function (p) {
    this.playing = p;
    if (this.playBtn) {
      this.playBtn.textContent = p ? 'Pause' : 'Play';
      this.playBtn.setAttribute('aria-label', p ? 'Pause animation' : 'Play animation');
    }
  };
  Figure.prototype.resize = function () {
    var r = this.canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(r.width, 1); this.h = Math.max(r.height, 1);
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  };
  Figure.prototype.syncSlider = function (v) { if (this.slider) this.slider.value = v; };

  var last = 0;
  function frame(now) {
    var dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    figures.forEach(function (f) {
      if (!f.visible) return;
      if (f.playing) { f.impl.step(f, dt); f.dirty = true; }
      if (f.dirty) { f.impl.draw(f, f.ctx, f.w, f.h); f.dirty = false; }
    });
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------ */
  /* Figure 1: Bures–Wasserstein geodesic between two covariances        */
  /* ------------------------------------------------------------------ */
  var BW = {
    init: function (f) { this.shuffle(f, true); f.state.clock = 0; },
    shuffle: function (f, first) {
      var s = f.state;
      var th = first ? 0.35 : Math.random() * Math.PI;
      var turn = Math.PI / 2 + (first ? 0.15 : (Math.random() - 0.5) * 0.9);
      s.A = spd(th, 1.0, first ? 0.07 : 0.05 + Math.random() * 0.08);
      s.B = spd(th + turn, first ? 0.75 : 0.55 + Math.random() * 0.4, first ? 0.06 : 0.04 + Math.random() * 0.08);
      var rA = sqrtSPD(s.A), rAi = invSym(rA);
      var mid = sqrtSPD(sym(mul(mul(full(rA), full(s.B)), full(rA))));
      s.T = sym(mul(mul(full(rAi), full(mid)), full(rAi)));
      s.bw = Math.sqrt(Math.max(s.A[0] + s.A[2] + s.B[0] + s.B[2] - 2 * (mid[0] + mid[2]), 0));
      if (s.t === undefined) s.t = 0;
    },
    geo: function (s, t) {
      var M = [(1 - t) + t * s.T[0], t * s.T[1], t * s.T[1], (1 - t) + t * s.T[2]];
      return sym(mul(mul(M, full(s.A)), M));
    },
    lin: function (s, t) { return [(1 - t) * s.A[0] + t * s.B[0], (1 - t) * s.A[1] + t * s.B[1], (1 - t) * s.A[2] + t * s.B[2]]; },
    setT: function (f, t) { f.state.t = t; f.state.clock = Math.acos(1 - 2 * t) / Math.PI * 3.2; },
    still: function (f) { f.state.t = 0.5; f.syncSlider(0.5); },
    step: function (f, dt) {
      var s = f.state;
      s.clock = (s.clock + dt) % 6.4; // 3.2 s each way, eased
      var u = s.clock < 3.2 ? s.clock / 3.2 : 2 - s.clock / 3.2;
      s.t = 0.5 - 0.5 * Math.cos(Math.PI * u);
      f.syncSlider(s.t);
    },
    ellipse: function (ctx, cx, cy, S, k, stroke, fill, dash, lw) {
      var e = eig(S);
      ctx.beginPath();
      ctx.ellipse(cx, cy, k * Math.sqrt(e.l1), k * Math.sqrt(e.l2), -e.angle, 0, 2 * Math.PI);
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.setLineDash(dash || []); ctx.lineWidth = lw || 1.5; ctx.strokeStyle = stroke; ctx.stroke(); ctx.setLineDash([]); }
    },
    draw: function (f, ctx, w, h) {
      var s = f.state;
      ctx.clearRect(0, 0, w, h);
      var k = Math.min(w, h) * 0.2;           // pixels per unit standard deviation
      var x0 = w * 0.25, x1 = w * 0.75, cy = h * 0.5;
      var cx = function (t) { return x0 + (x1 - x0) * t; };
      // geodesic trail
      for (var i = 0; i <= 8; i++) {
        var tt = i / 8;
        BW.ellipse(ctx, cx(tt), cy, BW.geo(s, tt), k, alpha(C.accent, 0.16), null, null, 1);
      }
      BW.ellipse(ctx, x0, cy, s.A, k, alpha(C.text, 0.55), alpha(C.text, 0.05), null, 1.2);
      BW.ellipse(ctx, x1, cy, s.B, k, alpha(C.text, 0.55), alpha(C.text, 0.05), null, 1.2);
      // current
      var X = cx(s.t);
      BW.ellipse(ctx, X, cy, BW.lin(s, s.t), k, C.warm, null, [5, 4], 1.6);
      BW.ellipse(ctx, X, cy, BW.geo(s, s.t), k, C.accent, alpha(C.accent, 0.14), null, 2.2);
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(X, cy, 2.5, 0, 2 * Math.PI); ctx.fill();
      // labels
      ctx.font = 'italic 16px "Source Serif 4", Georgia, serif';
      ctx.fillStyle = C.text;
      ctx.textAlign = 'center';
      ctx.fillText('A', x0, cy - k * Math.sqrt(s.A[2]) - 10);
      ctx.fillText('B', x1, cy - k * Math.sqrt(s.B[2]) - 10);
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.fillStyle = C.muted;
      ctx.textAlign = 'left';
      ctx.fillText('t = ' + s.t.toFixed(2), 10, h - 12);
      ctx.textAlign = 'right';
      ctx.fillText('Bures–Wasserstein distance = ' + s.bw.toFixed(3), w - 10, h - 12);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Figure 2: price-based load balancing over groups of experts         */
  /* ------------------------------------------------------------------ */
  var MOE = {
    N: 48, G: 4,
    init: function (f) { this.shuffle(f); },
    shuffle: function (f) {
      var s = f.state, N = this.N, G = this.G;
      var bias = [0.9, 0.35, 0, -0.35].map(function (b) { return b * (0.7 + 0.6 * Math.random()); });
      // shuffle which group is popular
      for (var i = G - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = bias[i]; bias[i] = bias[j]; bias[j] = tmp; }
      s.score = [];
      for (var n = 0; n < N; n++) {
        var row = [];
        for (var g = 0; g < G; g++) row.push(bias[g] + 0.55 * gauss());
        s.score.push(row);
      }
      s.price = [0, 0, 0, 0];
      s.round = 0;
      s.timer = 0;
      s.hold = 0;
      s.first = this.assign(s);
      s.assign = s.first.slice();
      s.pos = null;
      s.maxLoad = Math.max.apply(null, this.loads(s.assign));
      s.balanced = false;
      if (reduceMotion) { while (!this.iterate(s) && s.round < 400) {} s.pos = null; }
    },
    still: function () {},
    assign: function (s) {
      return s.score.map(function (row) {
        var best = 0, bv = -Infinity;
        for (var g = 0; g < row.length; g++) { var v = row[g] - s.price[g]; if (v > bv) { bv = v; best = g; } }
        return best;
      });
    },
    loads: function (a) { var L = [0, 0, 0, 0]; a.forEach(function (g) { L[g]++; }); return L; },
    iterate: function (s) { // one dual-ascent step on the prices; returns true when balanced
      var cap = this.N / this.G, L = this.loads(s.assign);
      if (L.every(function (l) { return Math.abs(l - cap) <= 0; })) { s.balanced = true; return true; }
      var eta = 0.5 / Math.sqrt(s.round + 4);
      for (var g = 0; g < this.G; g++) s.price[g] += eta * (L[g] - cap) / cap;
      s.round++;
      s.assign = this.assign(s);
      if (s.round > 24) { // finish deterministically: move the cheapest tokens out of overloaded groups
        this.repair(s);
      }
      return false;
    },
    repair: function (s) {
      var cap = this.N / this.G, L = this.loads(s.assign), self = this;
      var moved = true;
      while (moved) {
        moved = false;
        for (var g = 0; g < self.G; g++) {
          if (L[g] <= cap) continue;
          var best = null, bestLoss = Infinity, bestTo = -1;
          for (var n = 0; n < self.N; n++) {
            if (s.assign[n] !== g) continue;
            for (var h = 0; h < self.G; h++) {
              if (L[h] >= cap) continue;
              var loss = (s.score[n][g] - s.price[g]) - (s.score[n][h] - s.price[h]);
              if (loss < bestLoss) { bestLoss = loss; best = n; bestTo = h; }
            }
          }
          if (best !== null) { s.assign[best] = bestTo; L[g]--; L[bestTo]++; moved = true; }
        }
      }
    },
    setT: function () {},
    step: function (f, dt) {
      var s = f.state;
      if (s.balanced) {
        s.hold += dt;
        if (s.hold > 3.2) this.shuffle(f);
        return;
      }
      s.timer += dt;
      if (s.round === 0 && s.timer < 1.4) return; // show the greedy assignment first
      if (s.timer > 0.32) { s.timer = 0; this.iterate(s); }
    },
    layout: function (s, w, h) {
      var G = this.G, perRow = 2;
      var top = 34, bottom = 60;
      var colW = w / G;
      var rows = Math.ceil(Math.max(s.maxLoad, this.N / G + 2) / perRow) + 1;
      var d = Math.min(colW / (perRow + 1.6), (h - top - bottom) / rows);
      var counters = [0, 0, 0, 0], out = [];
      for (var n = 0; n < this.N; n++) {
        var g = s.assign[n], k = counters[g]++;
        var r = Math.floor(k / perRow), c = k % perRow;
        out.push([colW * g + colW / 2 + (c - (perRow - 1) / 2) * d, h - bottom - (r + 0.5) * d]);
      }
      return { pts: out, d: d, colW: colW, base: h - bottom, top: top };
    },
    draw: function (f, ctx, w, h) {
      var s = f.state, G = this.G, cap = this.N / G;
      var L = this.layout(s, w, h);
      if (!s.pos || s.pos.length !== L.pts.length) s.pos = L.pts.map(function (p) { return p.slice(); });
      var ease = f.playing ? 0.18 : 1;
      ctx.clearRect(0, 0, w, h);
      // target line
      var yCap = L.base - Math.ceil(cap / 2) * L.d;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = alpha(C.text, 0.45); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(8, yCap); ctx.lineTo(w - 8, yCap); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = '11px Inter, system-ui, sans-serif'; ctx.fillStyle = C.muted; ctx.textAlign = 'right';
      ctx.fillText('target', w - 10, yCap - 5);
      // baseline + labels
      ctx.strokeStyle = alpha(C.text, 0.35);
      ctx.beginPath(); ctx.moveTo(8, L.base + 2); ctx.lineTo(w - 8, L.base + 2); ctx.stroke();
      var loads = this.loads(s.assign);
      ctx.textAlign = 'center';
      for (var g = 0; g < G; g++) {
        var x = L.colW * g + L.colW / 2;
        ctx.fillStyle = C.text; ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.fillText('group ' + (g + 1), x, L.base + 19);
        ctx.fillStyle = C.muted; ctx.font = '11px Inter, system-ui, sans-serif';
        ctx.fillText('load ' + loads[g], x, L.base + 34);
        ctx.fillText('price ' + (s.price[g] >= 0 ? '+' : '') + s.price[g].toFixed(2), x, L.base + 48);
      }
      // tokens
      var r = Math.max(L.d * 0.36, 2);
      for (var n = 0; n < this.N; n++) {
        var p = s.pos[n], q = L.pts[n];
        p[0] += (q[0] - p[0]) * ease; p[1] += (q[1] - p[1]) * ease;
        var movedTok = s.assign[n] !== s.first[n];
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 2 * Math.PI);
        ctx.fillStyle = movedTok ? C.warm : C.accent;
        ctx.fill();
      }
      // header
      ctx.textAlign = 'left'; ctx.font = '12px Inter, system-ui, sans-serif'; ctx.fillStyle = C.muted;
      ctx.fillText(s.round === 0 ? 'greedy: each token takes its best group' : (s.balanced ? 'balanced after ' + s.round + ' price updates' : 'price update ' + s.round), 10, 18);
      ctx.textAlign = 'right';
      ctx.fillStyle = C.accent; ctx.fillText('● first choice', w - 92, 18);
      ctx.fillStyle = C.warm; ctx.fillText('● moved', w - 10, 18);
      f.dirty = true; // keep easing toward targets
    }
  };

  /* ------------------------------------------------------------------ */
  /* Figure 3: noising path and the one-step jump                        */
  /* ------------------------------------------------------------------ */
  var NOISE = {
    M: 650, SMAX: 1.1,
    init: function (f) {
      var s = f.state;
      s.x = []; s.z = [];
      for (var i = 0; i < this.M; i++) {
        // two interleaved spiral arms
        var u = Math.sqrt(Math.random()), arm = i % 2;
        var ang = u * 3.4 * Math.PI + arm * Math.PI;
        var rad = 0.12 + 0.88 * u;
        s.x.push([rad * Math.cos(ang) + 0.03 * gauss(), rad * Math.sin(ang) + 0.03 * gauss()]);
        s.z.push([gauss(), gauss()]);
      }
      s.u = 0; s.phase = 0; s.clock = 0; s.jump = false;
    },
    shuffle: function () {},
    sigma: function (u) { return this.SMAX * Math.pow(u, 2.2); },
    setT: function (f, u) { f.state.u = u; f.state.jump = false; f.state.phase = 0; f.state.clock = u * 3.6; },
    still: function (f) { f.state.u = 0.55; f.syncSlider(0.55); },
    step: function (f, dt) {
      var s = f.state;
      s.clock += dt;
      if (s.phase === 0) { // noising
        s.u = Math.min(s.clock / 3.6, 1); s.jump = false;
        if (s.u >= 1) { s.phase = 1; s.clock = 0; }
      } else if (s.phase === 1) { // hold at max noise
        if (s.clock > 0.8) { s.phase = 2; s.clock = 0; }
      } else if (s.phase === 2) { // one-step jump
        var v = Math.min(s.clock / 0.55, 1);
        s.u = 1 - (1 - Math.pow(1 - v, 3)); s.jump = true;
        if (v >= 1) { s.phase = 3; s.clock = 0; s.u = 0; }
      } else if (s.clock > 1.4) { s.phase = 0; s.clock = 0; s.jump = false; }
      f.syncSlider(s.u);
    },
    draw: function (f, ctx, w, h) {
      var s = f.state;
      ctx.clearRect(0, 0, w, h);
      var strip = 40;
      var cx = w / 2, cy = (h - strip) / 2 + 4, sc = Math.min(w, h - strip) * 0.32;
      var sig = this.sigma(s.u);
      var dot = Math.max(1.3, sc / 90);
      // jump streaks
      if (s.jump) {
        ctx.strokeStyle = alpha(C.warm, 0.13); ctx.lineWidth = 1;
        ctx.beginPath();
        for (var j = 0; j < this.M; j += 4) {
          var a = s.x[j], z = s.z[j];
          ctx.moveTo(cx + sc * (a[0] + this.SMAX * z[0]), cy - sc * (a[1] + this.SMAX * z[1]));
          ctx.lineTo(cx + sc * (a[0] + sig * z[0]), cy - sc * (a[1] + sig * z[1]));
        }
        ctx.stroke();
      }
      ctx.fillStyle = s.jump ? C.warm : C.accent;
      for (var i = 0; i < this.M; i++) {
        var p = s.x[i], q = s.z[i];
        var X = cx + sc * (p[0] + sig * q[0]), Y = cy - sc * (p[1] + sig * q[1]);
        if (X < -5 || X > w + 5 || Y < -5 || Y > h - strip) continue;
        ctx.fillRect(X - dot / 2, Y - dot / 2, dot, dot);
      }
      // strip: example training density over sigma (log-normal), with current marker
      var y0 = h - 12, x0 = 12, x1 = w - 12, hh = strip - 18;
      ctx.strokeStyle = alpha(C.text, 0.3); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.stroke();
      ctx.beginPath();
      var maxp = 0, pts = [];
      for (var k = 0; k <= 120; k++) {
        var uu = k / 120, sg = Math.max(this.sigma(uu), 1e-4);
        var lp = (Math.log(sg) + 1.2) / 1.2;
        var dens = Math.exp(-0.5 * lp * lp) * (this.sigma(Math.min(uu + 1e-3, 1)) - this.sigma(uu)) / 1e-3 / sg;
        pts.push(dens); if (dens > maxp) maxp = dens;
      }
      for (k = 0; k <= 120; k++) {
        var px = x0 + (x1 - x0) * k / 120, py = y0 - hh * pts[k] / maxp;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineTo(x1, y0); ctx.lineTo(x0, y0); ctx.closePath();
      ctx.fillStyle = alpha(C.accent, 0.16); ctx.fill();
      var mx = x0 + (x1 - x0) * s.u;
      ctx.strokeStyle = s.jump ? C.warm : C.accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mx, y0 + 3); ctx.lineTo(mx, y0 - hh - 2); ctx.stroke();
      ctx.font = '11px Inter, system-ui, sans-serif'; ctx.fillStyle = C.muted; ctx.textAlign = 'left';
      ctx.fillText('example training density over σ', x0, y0 - hh - 6);
      ctx.textAlign = 'left'; ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.fillText(s.jump ? 'one-step jump to data' : 'σ = ' + sig.toFixed(2), 10, 18);
    }
  };

  function gauss() {
    var u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* Hero: gradient flow on L(a,b) = (ab - c)^2; the fiber ab = c        */
  /* degenerates to a node at c = 0.                                     */
  /* ------------------------------------------------------------------ */
  var FIBER = {
    R: 2, NP: 90, LMAX: Math.log(1 + 25),
    init: function (f) {
      var s = f.state;
      s.c = 1; s.clock = 0; s.az = -0.75; s.p = [];
      for (var i = 0; i < this.NP; i++) s.p.push(this.spawn());
    },
    spawn: function () {
      var R = this.R;
      return { a: (Math.random() * 2 - 1) * R * 0.95, b: (Math.random() * 2 - 1) * R * 0.95, trail: [], age: Math.random() * 3 };
    },
    shuffle: function () {},
    still: function (f) { f.state.c = 0.35; f.syncSlider(0.35); },
    setT: function (f, v) { f.state.c = v; f.state.clock = Math.acos(2 * v - 1) / Math.PI * 9; },
    loss: function (a, b, c) { var r = a * b - c; return r * r; },
    h: function (a, b, c) { return Math.log(1 + this.loss(a, b, c)) / this.LMAX; },
    step: function (f, dt) {
      var s = f.state, self = this;
      s.clock = (s.clock + dt) % 18;            // c: 1 -> 0 -> 1 over 18 s
      s.c = Math.min(1, Math.max(0, 0.5 + 0.56 * Math.cos(Math.PI * s.clock / 9)));
      f.syncSlider(s.c);
      s.az += dt * 0.12;
      this.flow(s, dt);
    },
    flow: function (s, dt) {
      var self = this, lr = 0.9 * dt;
      s.p.forEach(function (q, i) {
        for (var k = 0; k < 3; k++) {
          var r = q.a * q.b - s.c;
          var ga = 2 * r * q.b, gb = 2 * r * q.a;
          var g = Math.sqrt(ga * ga + gb * gb), cap = 4;
          if (g > cap) { ga *= cap / g; gb *= cap / g; }
          q.a -= lr * ga; q.b -= lr * gb;
        }
        q.trail.push([q.a, q.b]); if (q.trail.length > 26) q.trail.shift();
        q.age += dt;
        if (q.age > 5 + (i % 7) * 0.4 || Math.abs(q.a) > self.R || Math.abs(q.b) > self.R) s.p[i] = self.spawn();
      });
    },
    proj: function (f, a, b, z) {
      var s = f.state, w = f.w, h = f.h;
      var ca = Math.cos(s.az), sa = Math.sin(s.az);
      var x = a * ca - b * sa, y = a * sa + b * ca;
      var sc = Math.min(w, h) * 0.24, tilt = 0.5;
      return [w / 2 + sc * x, h * 0.64 + sc * (y * tilt) - sc * 1.05 * z, y];
    },
    color: function (z) { // low -> accent, high -> warm
      return z < 0.5 ? alpha(C.accent, 0.55 - 0.3 * z) : alpha(C.warm, 0.15 + 0.4 * (z - 0.5));
    },
    draw: function (f, ctx, w, h) {
      var s = f.state, R = this.R, self = this, n = 26, m = 48;
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      // wireframe
      for (var dir = 0; dir < 2; dir++) {
        for (var i = 0; i <= n; i++) {
          var u = -R + 2 * R * i / n, prev = null;
          for (var j = 0; j <= m; j++) {
            var v = -R + 2 * R * j / m;
            var a = dir ? u : v, b = dir ? v : u;
            var z = self.h(a, b, s.c), P = self.proj(f, a, b, z);
            if (prev) {
              ctx.strokeStyle = self.color(0.5 * (z + prev[3]));
              ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(P[0], P[1]); ctx.stroke();
            }
            prev = [P[0], P[1], P[2], z];
          }
        }
      }
      // zero set: the fiber ab = c
      ctx.strokeStyle = C.text; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      function curve(fn, t0, t1) {
        ctx.beginPath(); var started = false;
        for (var k = 0; k <= 80; k++) {
          var t = t0 + (t1 - t0) * k / 80, ab = fn(t);
          if (Math.abs(ab[0]) > R || Math.abs(ab[1]) > R) { started = false; continue; }
          var P = self.proj(f, ab[0], ab[1], 0);
          if (!started) { ctx.moveTo(P[0], P[1]); started = true; } else ctx.lineTo(P[0], P[1]);
        }
        ctx.stroke();
      }
      if (s.c < 0.004) {
        curve(function (t) { return [t, 0]; }, -R, R);
        curve(function (t) { return [0, t]; }, -R, R);
        var O = self.proj(f, 0, 0, 0);
        ctx.fillStyle = C.warm; ctx.beginPath(); ctx.arc(O[0], O[1], 4.5, 0, 2 * Math.PI); ctx.fill();
      } else {
        var lo = s.c / R;
        curve(function (t) { return [t, s.c / t]; }, lo, R);
        curve(function (t) { return [-t, -s.c / t]; }, lo, R);
      }
      // particles under gradient flow
      s.p.forEach(function (q) {
        if (q.trail.length > 1) {
          ctx.strokeStyle = alpha(C.warm, 0.5); ctx.lineWidth = 1.2; ctx.beginPath();
          q.trail.forEach(function (t, k) {
            var P = self.proj(f, t[0], t[1], self.h(t[0], t[1], s.c));
            if (k) ctx.lineTo(P[0], P[1]); else ctx.moveTo(P[0], P[1]);
          });
          ctx.stroke();
        }
        var P = self.proj(f, q.a, q.b, self.h(q.a, q.b, s.c));
        ctx.fillStyle = C.warm; ctx.beginPath(); ctx.arc(P[0], P[1], 2.2, 0, 2 * Math.PI); ctx.fill();
      });
      ctx.font = 'italic 15px "Source Serif 4", Georgia, serif'; ctx.fillStyle = C.text; ctx.textAlign = 'right';
      ctx.fillText(s.c < 0.004 ? 'ab = 0  (singular)' : 'ab = ' + s.c.toFixed(2), w - 14, h - 14);
    }
  };

  var impls = { bw: BW, moe: MOE, noise: NOISE, fiber: FIBER };
  refreshColors();
  document.querySelectorAll('.fig[data-fig]').forEach(function (el) {
    var impl = impls[el.getAttribute('data-fig')];
    if (impl) figures.push(new Figure(el, impl));
  });
  if (window.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        figures.forEach(function (f) { if (f.el === e.target) { f.visible = e.isIntersecting; f.dirty = true; } });
      });
    }, { rootMargin: '80px' });
    figures.forEach(function (f) { io.observe(f.el); });
  } else {
    figures.forEach(function (f) { f.visible = true; });
  }
  // Redraw once web fonts are ready so canvas labels use them.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { figures.forEach(function (f) { f.dirty = true; }); });
  requestAnimationFrame(frame);
})();
