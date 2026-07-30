/* Background mandalas.
   Two mandalas grow outward from the bottom-left and top-right corners of the
   viewport over ~90 seconds: deep ginger at the centre warming to sunset gold
   at the rim.

   Every band is a whole-number multiple of one base symmetry, so the spokes
   line up across the whole figure -- that radial alignment, plus nested
   motifs (petals inside petals, arches holding petals), is what makes it read
   as a mandala rather than a stack of unrelated pattern rings.

   Completed bands are committed to an offscreen canvas so each frame only
   redraws the one band still growing. Progress is stored per browser tab, so
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
     alternate with narrow bands of fine detail, as in traditional mandalas. */
  var BANDS = [
    { type: 'rosette', w: 0.95, m: 2 },
    { type: 'ring',    w: 0.13 },
    { type: 'beads',   w: 0.28, m: 3 },
    { type: 'ring',    w: 0.11 },
    { type: 'lotus',   w: 1.30, m: 2 },
    { type: 'ring',    w: 0.12 },
    { type: 'saw',     w: 0.32, m: 6 },
    { type: 'ring',    w: 0.11 },
    { type: 'arcade',  w: 1.05, m: 3 },
    { type: 'beads',   w: 0.26, m: 6 },
    { type: 'ring',    w: 0.11 },
    { type: 'fan',     w: 1.40, m: 3 },
    { type: 'ring',    w: 0.11 },
    { type: 'comb',    w: 0.34, m: 8 },
    { type: 'ring',    w: 0.11 },
    { type: 'lotus',   w: 1.50, m: 4 },
    { type: 'scallop', w: 0.46, m: 6 },
    { type: 'ring',    w: 0.11 },
    { type: 'beads',   w: 0.24, m: 8 },
    { type: 'arcade',  w: 1.20, m: 4 },
    { type: 'ring',    w: 0.11 },
    { type: 'fan',     w: 1.55, m: 4 },
    { type: 'saw',     w: 0.36, m: 8 },
    { type: 'ring',    w: 0.10 }
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
      out.push({
        type: spec.type,
        r0: prev,
        r1: r,
        count: SYM * (spec.m || 1)
      });
      prev = r;
    }
    return out;
  }

  /* ---------- motifs ---------- */

  function petalPath(c, cx, cy, angle, r0, r1, halfWidth) {
    var mid = r0 + (r1 - r0) * 0.5;
    c.beginPath();
    c.moveTo(px(cx, r0, angle), py(cy, r0, angle));
    c.quadraticCurveTo(
      px(cx, mid, angle - halfWidth), py(cy, mid, angle - halfWidth),
      px(cx, r1, angle), py(cy, r1, angle));
    c.quadraticCurveTo(
      px(cx, mid, angle + halfWidth), py(cy, mid, angle + halfWidth),
      px(cx, r0, angle), py(cy, r0, angle));
    c.stroke();
  }

  /* Petal within petal within petal — the layered look of the reference. */
  function lotus(c, cx, cy, angle, r0, r1, halfWidth, layers) {
    var band = r1 - r0;
    for (var i = 0; i < layers; i++) {
      var inset = i * 0.13;
      petalPath(c, cx, cy, angle,
        r0 + band * inset,
        r1 - band * inset * 0.72,
        halfWidth * (1 - i * 0.26));
    }
    var dotR = r0 + band * 0.14;
    if (band > 14) {
      c.beginPath();
      c.arc(px(cx, dotR, angle), py(cy, dotR, angle), Math.min(2.2, band * 0.05), 0, TAU);
      c.stroke();
    }
  }

  /* A petal with ribs radiating inside it. */
  function fan(c, cx, cy, angle, r0, r1, halfWidth) {
    petalPath(c, cx, cy, angle, r0, r1, halfWidth);
    petalPath(c, cx, cy, angle, r0 + (r1 - r0) * 0.16, r1 - (r1 - r0) * 0.12, halfWidth * 0.7);
    var ribs = 3;
    for (var i = 1; i <= ribs; i++) {
      var t = i / (ribs + 1);
      var a = angle + (t - 0.5) * halfWidth * 1.15;
      c.beginPath();
      c.moveTo(px(cx, r0 + (r1 - r0) * 0.30, a), py(cy, r0 + (r1 - r0) * 0.30, a));
      c.lineTo(px(cx, r1 - (r1 - r0) * 0.20, a), py(cy, r1 - (r1 - r0) * 0.20, a));
      c.stroke();
    }
  }

  /* An arch with a small petal sitting inside it. */
  function arcade(c, cx, cy, angle, step, r0, r1) {
    var base = r0 + (r1 - r0) * 0.10;
    var a0 = angle - step * 0.5;
    var a1 = angle + step * 0.5;
    c.beginPath();
    c.moveTo(px(cx, base, a0), py(cy, base, a0));
    c.quadraticCurveTo(
      px(cx, r1 * 1.005, angle), py(cy, r1 * 1.005, angle),
      px(cx, base, a1), py(cy, base, a1));
    c.stroke();
    petalPath(c, cx, cy, angle,
      r0 + (r1 - r0) * 0.22, r1 - (r1 - r0) * 0.26, step * 0.26);
  }

  function rosette(c, cx, cy, angle, r0, r1, halfWidth) {
    petalPath(c, cx, cy, angle, r0, r1, halfWidth);
    petalPath(c, cx, cy, angle, r0 + (r1 - r0) * 0.2, r1 - (r1 - r0) * 0.22, halfWidth * 0.6);
  }

  function scallop(c, cx, cy, angle, step, r0, r1) {
    var base = r0 + (r1 - r0) * 0.28;
    var a0 = angle - step * 0.5;
    var a1 = angle + step * 0.5;
    c.beginPath();
    c.moveTo(px(cx, base, a0), py(cy, base, a0));
    c.quadraticCurveTo(
      px(cx, r1, angle), py(cy, r1, angle),
      px(cx, base, a1), py(cy, base, a1));
    c.stroke();
  }

  function saw(c, cx, cy, angle, step, r0, r1) {
    var base = r0 + (r1 - r0) * 0.18;
    var a0 = angle - step * 0.5;
    var a1 = angle + step * 0.5;
    c.beginPath();
    c.moveTo(px(cx, base, a0), py(cy, base, a0));
    c.lineTo(px(cx, r1, angle), py(cy, r1, angle));
    c.lineTo(px(cx, base, a1), py(cy, base, a1));
    c.stroke();
  }

  function comb(c, cx, cy, angle, r0, r1) {
    var a = r0 + (r1 - r0) * 0.15;
    var b = r0 + (r1 - r0) * 0.88;
    c.beginPath();
    c.moveTo(px(cx, a, angle), py(cy, a, angle));
    c.lineTo(px(cx, b, angle), py(cy, b, angle));
    c.stroke();
  }

  /* ---------- one band ---------- */

  function drawBand(c, cx, cy, band, index, appear, phase) {
    var f = band.r1 / R;
    var alpha = MAX_ALPHA * Math.pow(1 - f, FALLOFF) * appear;
    if (alpha < 0.004) return;

    c.strokeStyle = colorAt(f, alpha);
    c.lineWidth = f < 0.35 ? 1.15 : 1;

    var grown = band.r0 + (band.r1 - band.r0) * appear;
    var step = TAU / band.count;
    /* Every second ornate band is offset half a step so petals interlock
       with the band beneath instead of stacking in identical spokes. */
    var offset = phase + (index % 2 ? step * 0.5 : 0);

    if (band.type === 'ring') {
      c.beginPath();
      c.arc(cx, cy, grown, 0, TAU);
      c.stroke();
      var inner = band.r0 + (grown - band.r0) * 0.55;
      if (inner > 3) {
        c.beginPath();
        c.arc(cx, cy, inner, 0, TAU);
        c.stroke();
      }
      return;
    }

    for (var k = 0; k < band.count; k++) {
      var angle = offset + k * step;
      switch (band.type) {
        case 'rosette':
          rosette(c, cx, cy, angle, band.r0, grown, step * 0.60);
          break;
        case 'lotus':
          lotus(c, cx, cy, angle, band.r0, grown, step * 0.62, 3);
          break;
        case 'fan':
          fan(c, cx, cy, angle, band.r0, grown, step * 0.60);
          break;
        case 'arcade':
          arcade(c, cx, cy, angle, step, band.r0, grown);
          break;
        case 'scallop':
          scallop(c, cx, cy, angle, step, band.r0, grown);
          break;
        case 'saw':
          saw(c, cx, cy, angle, step, band.r0, grown);
          break;
        case 'comb':
          comb(c, cx, cy, angle, band.r0, grown);
          break;
        case 'beads':
          var br = (band.r0 + grown) * 0.5;
          c.beginPath();
          c.arc(px(cx, br, angle), py(cy, br, angle),
                Math.max(0.9, (band.r1 - band.r0) * 0.24 * appear), 0, TAU);
          c.stroke();
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

  /* ---------- frame ---------- */

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
