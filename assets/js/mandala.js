/* Background mandalas.
   Two mandalas grow outward from the bottom-left and top-right corners of the
   viewport, ring by ring, over ~90 seconds. Each is deep orange at its centre,
   warms through gold, and dissolves into the page before it reaches the text,
   so the two never visibly collide.

   Progress is stored per browser tab, so moving between pages continues the
   animation instead of restarting it; a fresh visit starts over. */
(function () {
  'use strict';

  var canvas = document.getElementById('mandala-bg');
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext('2d');

  var DURATION = 90000;   // ms for one mandala to finish drawing
  var STAGGER = 0.08;     // second mandala trails the first by this fraction
  var MAX_ALPHA = 0.5;    // ink strength at the centre
  var FALLOFF = 1.5;      // how quickly the ink fades toward the rim
  var GROW_BAND = 0.13;   // fraction of the radius a ring takes to fade in
  var RING_COUNT = 14;
  var STORAGE_KEY = 'mandala-start';

  /* Motif per ring, cycled outward. Layered petals with the odd band of dots,
     scallops and plain circles between them, echoing the reference artwork. */
  var CYCLE = ['petal', 'dots', 'petalVein', 'ring', 'teardrop', 'petalVein', 'arch',
               'dots', 'petalVein', 'teardrop', 'ring', 'arch', 'petalVein', 'dots'];

  /* Deep orange at the centre through to pale gold. Alpha does the actual
     disappearing, so this dissolves into whatever the page background is. */
  var STOPS = [
    [0.00, 186, 58, 8],
    [0.30, 221, 99, 15],
    [0.60, 240, 164, 44],
    [1.00, 250, 219, 122]
  ];

  var TAU = Math.PI * 2;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var W = 0, H = 0, R = 0;
  var rings = [];
  var startedAt = null;
  var rafId = null;
  var lastPaint = 0;

  /* ---------- helpers ---------- */

  function px(cx, r, a) { return cx + r * Math.cos(a); }
  function py(cy, r, a) { return cy + r * Math.sin(a); }

  function colorAt(f) {
    var i = 1;
    while (i < STOPS.length - 1 && f > STOPS[i][0]) i++;
    var a = STOPS[i - 1], b = STOPS[i];
    var t = (f - a[0]) / (b[0] - a[0] || 1);
    return 'rgb(' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ',' +
      Math.round(a[3] + (b[3] - a[3]) * t) + ')';
  }

  function smoothstep(t) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  /* Petal counts rise with radius so every band stays about equally dense
     instead of the outer rings looking stretched and empty. */
  function buildRings(radius) {
    var out = [];
    var prev = 0;
    for (var i = 0; i < RING_COUNT; i++) {
      var r = radius * Math.pow((i + 1) / RING_COUNT, 1.05);
      var band = r - prev;
      var mid = (r + prev) * 0.5;
      var count = Math.round(TAU * mid / (band * 1.15));
      count = Math.max(8, Math.min(64, Math.round(count / 4) * 4));
      out.push({ r0: prev, r1: r, count: count, type: CYCLE[i % CYCLE.length] });
      prev = r;
    }
    return out;
  }

  /* ---------- motifs ---------- */

  function petal(cx, cy, angle, r0, r1, halfWidth, vein) {
    var mid = r0 + (r1 - r0) * 0.5;
    ctx.beginPath();
    ctx.moveTo(px(cx, r0, angle), py(cy, r0, angle));
    ctx.quadraticCurveTo(
      px(cx, mid, angle - halfWidth), py(cy, mid, angle - halfWidth),
      px(cx, r1, angle), py(cy, r1, angle));
    ctx.quadraticCurveTo(
      px(cx, mid, angle + halfWidth), py(cy, mid, angle + halfWidth),
      px(cx, r0, angle), py(cy, r0, angle));
    ctx.stroke();

    if (vein) {
      var vr0 = r0 + (r1 - r0) * 0.22;
      var vr1 = r0 + (r1 - r0) * 0.80;
      var vw = halfWidth * 0.42;
      var vmid = (vr0 + vr1) * 0.5;
      ctx.beginPath();
      ctx.moveTo(px(cx, vr0, angle), py(cy, vr0, angle));
      ctx.quadraticCurveTo(
        px(cx, vmid, angle - vw), py(cy, vmid, angle - vw),
        px(cx, vr1, angle), py(cy, vr1, angle));
      ctx.quadraticCurveTo(
        px(cx, vmid, angle + vw), py(cy, vmid, angle + vw),
        px(cx, vr0, angle), py(cy, vr0, angle));
      ctx.stroke();
    }
  }

  /* A shallow scallop sitting across the outer part of the band. */
  function arch(cx, cy, angle, step, r0, r1) {
    var base = r0 + (r1 - r0) * 0.35;
    var a0 = angle - step * 0.5;
    var a1 = angle + step * 0.5;
    ctx.beginPath();
    ctx.moveTo(px(cx, base, a0), py(cy, base, a0));
    ctx.quadraticCurveTo(
      px(cx, r1 * 1.01, angle), py(cy, r1 * 1.01, angle),
      px(cx, base, a1), py(cy, base, a1));
    ctx.stroke();
  }

  function dot(cx, cy, angle, r, size) {
    ctx.beginPath();
    ctx.arc(px(cx, r, angle), py(cy, r, angle), size, 0, TAU);
    ctx.stroke();
  }

  /* ---------- one mandala ---------- */

  function drawMandala(cx, cy, progress, phase) {
    if (progress <= 0) return;
    var frontier = progress * R;

    for (var i = 0; i < rings.length; i++) {
      var ring = rings[i];

      var appear = smoothstep((frontier - ring.r0) / (R * GROW_BAND));
      if (appear <= 0) continue;

      var f = ring.r1 / R;
      var alpha = MAX_ALPHA * Math.pow(1 - f, FALLOFF) * appear;
      if (alpha < 0.004) continue;

      ctx.strokeStyle = colorAt(f).replace('rgb(', 'rgba(').replace(')', ',' + alpha.toFixed(3) + ')');
      ctx.lineWidth = 1;

      var grown = ring.r0 + (ring.r1 - ring.r0) * appear;
      var step = TAU / ring.count;
      var offset = phase + i * 0.21;

      if (ring.type === 'ring') {
        ctx.beginPath();
        ctx.arc(cx, cy, grown, 0, TAU);
        ctx.stroke();
        continue;
      }

      for (var k = 0; k < ring.count; k++) {
        var angle = offset + k * step;
        if (ring.type === 'petal') {
          petal(cx, cy, angle, ring.r0, grown, step * 0.62, false);
        } else if (ring.type === 'petalVein') {
          petal(cx, cy, angle, ring.r0, grown, step * 0.62, true);
        } else if (ring.type === 'teardrop') {
          petal(cx, cy, angle, ring.r0 + (ring.r1 - ring.r0) * 0.14, grown, step * 0.38, false);
        } else if (ring.type === 'arch') {
          arch(cx, cy, angle, step, ring.r0, grown);
        } else if (ring.type === 'dots') {
          dot(cx, cy, angle, (ring.r0 + grown) * 0.5,
              Math.max(1.1, (ring.r1 - ring.r0) * 0.2 * appear));
        }
      }
    }
  }

  /* ---------- frame ---------- */

  function draw() {
    ctx.clearRect(0, 0, W, H);
    var elapsed = startedAt === null ? 0 : Date.now() - startedAt;
    var p = reduceMotion ? 1 : Math.min(elapsed / DURATION, 1);
    var pB = reduceMotion ? 1
      : Math.min(Math.max(elapsed / DURATION - STAGGER, 0) / (1 - STAGGER), 1);

    drawMandala(0, H, p, -0.22);     // bottom-left corner
    drawMandala(W, 0, pB, 0.63);     // top-right corner

    return p >= 1 && pB >= 1;
  }

  function tick(now) {
    if (now - lastPaint >= 45) {     // ~22fps is plenty for something this slow
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
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    R = H;                 // a finished mandala reaches the top of the page
    rings = buildRings(R);

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
    startedAt = Date.now();          // private browsing: just start fresh
  }

  var resizeTimer = null;
  window.addEventListener('resize', function () {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, 150);
  });

  resize();
  if (!reduceMotion) start();
})();
