/* Background mandalas, henna/mehndi style.
   Two mandalas grow outward from the bottom-left and top-right corners of the
   viewport over ~90 seconds: deep ginger at the centre warming to sunset gold
   at the rim.

   The vocabulary is deliberately all curves -- coiled spirals, veined leaves,
   paisley teardrops, lobed blooms and lacy scallops. No straight radial rules
   or sharp zigzags, which is what makes this style read as drawn ornament
   rather than geometry. Every band is a whole-number multiple of one base
   symmetry so the spokes line up across the figure.

   Motifs are drawn in a local frame (origin on the band's inner edge, +X
   pointing radially outward), which is what keeps the curve maths legible.

   Finished bands are committed to an offscreen canvas so each frame only
   redraws the band still growing. Progress is stored per browser tab, so
   moving between pages continues the animation; a fresh visit starts over. */
(function () {
  'use strict';

  var canvas = document.getElementById('mandala-bg');
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');
  var cache = document.createElement('canvas');
  var cctx = cache.getContext('2d');

  var DURATION = 90000;   // ms to grow from the opening state to full size
  var MAX_ALPHA = 0.85;   // ink strength at the centre
  var FALLOFF = 0.8;      // gentle: line-work stays visible out to the rim
  var GROW_BAND = 0.085;  // fraction of the radius a band takes to fade in
  var OPENING_BANDS = 5;  // bands already drawn when the page first opens
  var SYM = 8;            // base symmetry; every band is a multiple of this
  var STORAGE_KEY = 'mandala-start';

  /* Band schedule, innermost first. `w` is a relative width (normalised to the
     radius below) and `m` multiplies the base symmetry. Wide ornate bands
     alternate with narrow bands of beadwork and lace. */
  var BANDS = [
    { type: 'rosette', w: 0.80, m: 2 },
    { type: 'dots',    w: 0.20, m: 3 },
    { type: 'bloom',   w: 1.05, m: 3 },
    { type: 'lace',    w: 0.30, m: 6 },
    { type: 'ring',    w: 0.10 },
    { type: 'leaf',    w: 1.25, m: 4 },
    { type: 'dots',    w: 0.22, m: 8 },
    { type: 'curl',    w: 0.85, m: 5 },
    { type: 'lace',    w: 0.32, m: 9 },
    { type: 'ring',    w: 0.10 },
    { type: 'paisley', w: 1.35, m: 6 },
    { type: 'dots',    w: 0.22, m: 11 },
    { type: 'bloom',   w: 1.30, m: 8 },
    { type: 'lace',    w: 0.34, m: 13 },
    { type: 'curl',    w: 0.95, m: 9 },
    { type: 'ring',    w: 0.10 },
    { type: 'leaf',    w: 1.55, m: 10 },
    { type: 'dots',    w: 0.22, m: 15 },
    { type: 'paisley', w: 1.45, m: 11 },
    { type: 'lace',    w: 0.36, m: 17 },
    { type: 'bloom',   w: 1.50, m: 12 },
    { type: 'lace',    w: 0.34, m: 20 }
  ];

  /* Deep ginger at the centre, sunset orange through the middle, warm gold at
     the rim -- saturated the whole way rather than washing out. */
  var STOPS = [
    [0.00, 172, 54, 8],
    [0.28, 199, 78, 14],
    [0.58, 221, 118, 28],
    [0.82, 233, 154, 48],
    [1.00, 240, 182, 74]
  ];

  var TAU = Math.PI * 2;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 0, H = 0, R = 0;
  var bands = [];
  var openingProgress = 0;
  var doneA = 0, doneB = 0;      // bands already committed to the cache
  var startedAt = null;
  var rafId = null;
  var lastPaint = 0;

  /* ---------- helpers ---------- */

  function px(cx, r, a) { return cx + r * Math.cos(a); }
  function py(cy, r, a) { return cy + r * Math.sin(a); }

  function colorAt(f, alpha) {
    var i = 1;
    while (i < STOPS.length - 1 && f > STOPS[i][0]) i++;
    var a = STOPS[i - 1], b = STOPS[i];
    var t = (f - a[0]) / (b[0] - a[0] || 1);
    return 'rgba(' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ',' +
      Math.round(a[3] + (b[3] - a[3]) * t) + ',' +
      alpha.toFixed(3) + ')';
  }

  function smoothstep(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  function buildBands(radius) {
    var total = 0, i;
    for (i = 0; i < BANDS.length; i++) total += BANDS[i].w;

    var out = [];
    var prev = 0;
    for (i = 0; i < BANDS.length; i++) {
      var spec = BANDS[i];
      var r = prev + radius * (spec.w / total);
      out.push({ type: spec.type, r0: prev, r1: r, count: SYM * (spec.m || 1) });
      prev = r;
    }
    return out;
  }

  /* Run fn in a frame whose origin sits at (radius, angle) with +X pointing
     radially outward, so motifs can be written as plain 2-D curves. */
  function frame(c, cx, cy, angle, r, fn, arg) {
    c.save();
    c.translate(px(cx, r, angle), py(cy, r, angle));
    c.rotate(angle);
    fn(c, arg);
    c.restore();
  }

  function dotAt(c, x, y, r) {
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.stroke();
  }

  /* ---------- motifs (local frame: +X outward) ---------- */

  /* A rounded flower petal with an inner lobe and a pair of seed dots. */
  function bloom(c, o) {
    var L = o.L, w = o.w;
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(L * 0.20, -w * 0.75, L * 0.86, -w * 0.80, L, 0);
    c.bezierCurveTo(L * 0.86, w * 0.80, L * 0.20, w * 0.75, 0, 0);
    c.stroke();

    c.beginPath();
    c.moveTo(L * 0.18, 0);
    c.bezierCurveTo(L * 0.36, -w * 0.44, L * 0.78, -w * 0.46, L * 0.88, 0);
    c.bezierCurveTo(L * 0.78, w * 0.46, L * 0.36, w * 0.44, L * 0.18, 0);
    c.stroke();

    if (L > 22) {
      dotAt(c, L * 0.42, 0, Math.min(2, L * 0.045));
      dotAt(c, L * 0.66, 0, Math.min(1.5, L * 0.032));
    }
  }

  /* A pointed leaf with a midrib and curved veins sweeping toward the tip. */
  function leaf(c, o) {
    var L = o.L, w = o.w;
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(L * 0.34, -w * 0.92, L, 0);
    c.quadraticCurveTo(L * 0.34, w * 0.92, 0, 0);
    c.stroke();

    c.beginPath();
    c.moveTo(L * 0.06, 0);
    c.lineTo(L * 0.94, 0);
    c.stroke();

    if (L < 26) return;
    for (var i = 1; i <= 4; i++) {
      var t = 0.12 + i * 0.17;
      var x = L * t;
      var reach = w * (1 - Math.abs(t - 0.4)) * 0.7;
      c.beginPath();
      c.moveTo(x, 0);
      c.quadraticCurveTo(x + L * 0.09, -reach * 0.55, x + L * 0.15, -reach);
      c.stroke();
      c.beginPath();
      c.moveTo(x, 0);
      c.quadraticCurveTo(x + L * 0.09, reach * 0.55, x + L * 0.15, reach);
      c.stroke();
    }
  }

  /* A teardrop that hooks over at the tip, with a dotted throat. */
  function paisley(c, o) {
    var L = o.L, w = o.w;
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(L * 0.18, -w * 0.85, L * 0.70, -w * 0.95, L * 0.86, -w * 0.28);
    c.bezierCurveTo(L * 0.98, w * 0.10, L * 0.80, w * 0.42, L * 0.62, w * 0.18);
    c.stroke();

    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(L * 0.22, w * 0.80, L * 0.60, w * 0.72, L * 0.62, w * 0.18);
    c.stroke();

    c.beginPath();
    c.moveTo(L * 0.16, -w * 0.08);
    c.bezierCurveTo(L * 0.34, -w * 0.50, L * 0.64, -w * 0.54, L * 0.72, -w * 0.16);
    c.stroke();

    if (L > 26) {
      dotAt(c, L * 0.34, w * 0.14, Math.min(1.6, L * 0.035));
      dotAt(c, L * 0.50, w * 0.20, Math.min(1.4, L * 0.030));
    }
  }

  /* The henna signature: a stem that coils into a spiral. Drawn as a mirrored
     pair so each spoke reads as a symmetric flourish. */
  function curl(c, o) {
    var L = o.L, w = o.w;
    var turns = 1.6, steps = 20;

    for (var s = -1; s <= 1; s += 2) {
      var hubX = L * 0.68;
      var hubY = s * w * 0.44;
      var coil = Math.min(L * 0.30, w * 0.52);

      c.beginPath();
      c.moveTo(0, 0);
      c.bezierCurveTo(L * 0.20, s * w * 0.20, L * 0.44, s * w * 0.58,
                      hubX, hubY + s * coil);
      for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var th = t * turns * TAU;
        var rr = coil * (1 - t * 0.85);
        c.lineTo(hubX - s * rr * Math.sin(th), hubY + s * rr * Math.cos(th));
      }
      c.stroke();
    }

    c.beginPath();
    c.moveTo(L * 0.28, 0);
    c.quadraticCurveTo(L * 0.54, -w * 0.18, L * 0.82, 0);
    c.quadraticCurveTo(L * 0.54, w * 0.18, L * 0.28, 0);
    c.stroke();
    if (L > 24) dotAt(c, L * 0.55, 0, Math.min(1.6, L * 0.04));
  }


  /* A small rounded flower for the very centre. */
  function rosette(c, o) {
    var L = o.L, w = o.w;
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(L * 0.26, -w * 0.85, L * 0.80, -w * 0.70, L, 0);
    c.bezierCurveTo(L * 0.80, w * 0.70, L * 0.26, w * 0.85, 0, 0);
    c.stroke();
    if (L > 16) dotAt(c, L * 0.55, 0, Math.min(1.8, L * 0.06));
  }

  /* A semicircular bump; a ring of them makes a lace edge. */
  function laceBump(c, o) {
    c.beginPath();
    c.arc(0, 0, o.bump, -Math.PI / 2, Math.PI / 2);
    c.stroke();
  }

  /* ---------- one band ---------- */

  function drawBand(c, cx, cy, band, index, appear, phase) {
    var f = band.r1 / R;
    var alpha = MAX_ALPHA * Math.pow(1 - f, FALLOFF) * appear;
    if (alpha < 0.004) return;

    c.strokeStyle = colorAt(f, alpha);
    c.lineWidth = f < 0.35 ? 1.15 : 1;
    c.lineJoin = 'round';
    c.lineCap = 'round';

    var grown = band.r0 + (band.r1 - band.r0) * appear;
    var step = TAU / band.count;
    /* Offset alternate ornate bands by half a step so motifs interlock with
       the band beneath instead of stacking into rigid spokes. */
    var offset = phase + (index % 2 ? step * 0.5 : 0);

    if (band.type === 'ring') {
      c.beginPath();
      c.arc(cx, cy, grown, 0, TAU);
      c.stroke();
      var inner = band.r0 + (grown - band.r0) * 0.5;
      if (inner > 3) {
        c.beginPath();
        c.arc(cx, cy, inner, 0, TAU);
        c.stroke();
      }
      return;
    }

    var L = grown - band.r0;
    if (L <= 0.5) return;
    var mid = (band.r0 + grown) * 0.5;
    var halfArc = mid * step * 0.5;

    for (var k = 0; k < band.count; k++) {
      var angle = offset + k * step;
      switch (band.type) {
        case 'bloom':
          frame(c, cx, cy, angle, band.r0, bloom, { L: L, w: halfArc * 0.95 });
          break;
        case 'leaf':
          frame(c, cx, cy, angle, band.r0, leaf, { L: L, w: halfArc * 0.80 });
          break;
        case 'paisley':
          frame(c, cx, cy, angle, band.r0, paisley, { L: L, w: halfArc * 0.95 });
          break;
        case 'curl':
          frame(c, cx, cy, angle, band.r0, curl, { L: L, w: halfArc * 1.0 });
          break;
        case 'rosette':
          frame(c, cx, cy, angle, band.r0, rosette, { L: L, w: halfArc * 0.9 });
          break;
        case 'lace':
          frame(c, cx, cy, angle, mid, laceBump, { bump: Math.min(L * 0.5, halfArc) });
          break;
        case 'dots':
          dotAt(c, px(cx, mid, angle), py(cy, mid, angle),
                Math.max(0.9, L * 0.26 * appear));
          break;
      }
    }
  }

  function appearance(band, frontier) {
    return smoothstep((frontier - band.r0) / (R * GROW_BAND));
  }

  /* Bands that have finished growing are painted once into the cache. */
  function commitFinished(cx, cy, progress, phase, done) {
    var frontier = progress * R;
    while (done < bands.length && appearance(bands[done], frontier) >= 1) {
      drawBand(cctx, cx, cy, bands[done], done, 1, phase);
      done++;
    }
    return done;
  }

  function drawGrowing(cx, cy, progress, phase, done) {
    var frontier = progress * R;
    for (var i = done; i < bands.length; i++) {
      var appear = appearance(bands[i], frontier);
      if (appear <= 0) break;
      drawBand(ctx, cx, cy, bands[i], i, appear, phase);
    }
  }

  /* ---------- frame loop ---------- */

  function progressNow() {
    if (reduceMotion) return 1;
    var elapsed = startedAt === null ? 0 : Date.now() - startedAt;
    var t = Math.min(elapsed / DURATION, 1);
    return openingProgress + (1 - openingProgress) * t;
  }

  function draw() {
    var p = progressNow();

    doneA = commitFinished(0, H, p, -0.22, doneA);
    doneB = commitFinished(W, 0, p, 0.63, doneB);

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cache, 0, 0, W, H);

    drawGrowing(0, H, p, -0.22, doneA);
    drawGrowing(W, 0, p, 0.63, doneB);

    return p >= 1 && doneA >= bands.length && doneB >= bands.length;
  }

  function tick(now) {
    if (now - lastPaint >= 60) {   // this grows slowly; no need for 60fps
      lastPaint = now;
      if (draw()) { rafId = null; return; }
    }
    rafId = window.requestAnimationFrame(tick);
  }

  function start() {
    if (rafId === null) rafId = window.requestAnimationFrame(tick);
  }

  /* ---------- sizing ---------- */

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;

    [canvas, cache].forEach(function (el) {
      el.width = Math.round(W * dpr);
      el.height = Math.round(H * dpr);
    });
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, W, H);

    R = H;                        // a finished mandala reaches the top of the page
    bands = buildBands(R);
    doneA = doneB = 0;            // cache invalidated by the resize

    /* Open with the first few bands already drawn so there is something to see
       the instant the page loads. */
    var opened = bands[Math.min(OPENING_BANDS, bands.length - 1)];
    openingProgress = (opened.r0 / R) + GROW_BAND;

    if (rafId === null) draw(); else start();
  }

  /* ---------- init ---------- */

  try {
    var stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      startedAt = parseInt(stored, 10);
      if (isNaN(startedAt)) startedAt = null;
    }
    if (startedAt === null) {
      startedAt = Date.now();
      window.sessionStorage.setItem(STORAGE_KEY, String(startedAt));
    }
  } catch (err) {
    startedAt = Date.now();       // private browsing: just start fresh
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 150);
  });

  resize();
  if (!reduceMotion) start();
})();
