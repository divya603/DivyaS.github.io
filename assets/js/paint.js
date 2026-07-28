/* MS Paint site chrome — drawing engine.
   The page content scrolls inside #paint-viewport (Paint's white canvas).
   Strokes are stored in content coordinates and replayed onto a fixed,
   viewport-sized canvas overlay, translated by the viewport's scroll offset. */
(function () {
  'use strict';

  var canvas = document.getElementById('mspaint-canvas');
  var viewport = document.getElementById('paint-viewport');
  var app = document.querySelector('.paint-app');
  if (!canvas || !viewport || !app) return;

  // Touch devices scroll with the same gesture — drawing is desktop-only.
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;

  var ctx = canvas.getContext('2d');
  var statusEl = document.getElementById('mspaint-status');
  var currentFg = app.querySelector('.mspaint-current-fg');

  var MAX_OPS = 400;

  var tool = 'pencil';
  var color = '#000000';
  var size = 2;

  var ops = [];      // finished strokes: {tool, color, size, points:[{x,y}]}
  var cur = null;    // stroke in progress
  var lastPos = null;
  var sprayTimer = null;
  var rafPending = false;

  var STATUS = {
    select: 'For Help, click Help Topics on the Help Menu.',
    pencil: 'Pencil: click and drag anywhere on the page to draw.',
    brush: 'Brush: nice thick strokes.',
    spray: 'Airbrush: pssssst.',
    line: 'Line: drag to stretch a straight line.',
    eraser: 'Eraser: rub out your mistakes.'
  };

  var INTERACTIVE = 'a,button,input,select,textarea,label,summary,iframe,video,audio,[contenteditable]';

  /* ---------- canvas + rendering ---------- */

  function resizeCanvas() {
    canvas.width = viewport.clientWidth;
    canvas.height = viewport.clientHeight;
    canvas.style.width = viewport.clientWidth + 'px';
    canvas.style.height = viewport.clientHeight + 'px';
    redraw();
  }

  function scheduleRedraw() {
    if (rafPending) return;
    rafPending = true;
    window.requestAnimationFrame(function () {
      rafPending = false;
      redraw();
    });
  }

  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(-viewport.scrollLeft, -viewport.scrollTop);
    var start = 0;
    for (var i = ops.length - 1; i >= 0; i--) {
      if (ops[i].tool === 'clear') { start = i + 1; break; }
    }
    for (var j = start; j < ops.length; j++) drawOp(ops[j]);
    if (cur) drawOp(cur);
    ctx.restore();
  }

  function drawOp(op) {
    var pts = op.points;
    if (op.tool === 'clear' || !pts || !pts.length) return;
    ctx.globalCompositeOperation = op.tool === 'eraser' ? 'destination-out' : 'source-over';
    if (op.tool === 'spray') {
      ctx.fillStyle = op.color;
      for (var i = 0; i < pts.length; i++) ctx.fillRect(pts[i].x, pts[i].y, 2, 2);
    } else if (op.tool === 'line') {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = Math.max(op.size, 1);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      var end = pts[pts.length - 1];
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    } else {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.tool === 'pencil' ? 1 : op.tool === 'brush' ? op.size * 2 : op.size * 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) {
        ctx.lineTo(pts[0].x + 0.01, pts[0].y);
      } else {
        for (var k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- drawing input ---------- */

  function contentPoint(e) {
    var r = viewport.getBoundingClientRect();
    return {
      x: e.clientX - r.left + viewport.scrollLeft,
      y: e.clientY - r.top + viewport.scrollTop
    };
  }

  function onPointerDown(e) {
    if (tool === 'select' || e.button !== 0) return;
    if (e.target !== viewport && !viewport.contains(e.target)) return;
    var r = viewport.getBoundingClientRect();
    if (e.clientX - r.left > viewport.clientWidth) return; // on the scrollbar
    if (e.target.closest && e.target.closest(INTERACTIVE)) return;
    e.preventDefault(); // stops text selection / image drag while sketching
    lastPos = contentPoint(e);
    cur = { tool: tool, color: color, size: size, points: [contentPoint(e)] };
    try {
      document.documentElement.setPointerCapture(e.pointerId);
    } catch (err) { /* capture is a nicety, not a requirement */ }
    if (tool === 'spray') startSpray();
    scheduleRedraw();
  }

  function onPointerMove(e) {
    if (!cur) return;
    lastPos = contentPoint(e);
    if (cur.tool === 'spray') return; // dots are emitted by the timer
    if (cur.tool === 'line') {
      cur.points[1] = contentPoint(e);
    } else {
      cur.points.push(contentPoint(e));
    }
    scheduleRedraw();
  }

  function endStroke() {
    if (!cur) return;
    stopSpray();
    ops.push(cur);
    cur = null;
    if (ops.length > MAX_OPS) ops.splice(0, ops.length - MAX_OPS);
    scheduleRedraw();
  }

  function startSpray() {
    stopSpray();
    sprayTimer = window.setInterval(function () {
      if (!cur || !lastPos) return;
      var radius = 4 + cur.size * 3;
      var count = 6 + cur.size * 2;
      for (var i = 0; i < count; i++) {
        var angle = Math.random() * Math.PI * 2;
        var dist = Math.random() * radius;
        cur.points.push({
          x: lastPos.x + Math.cos(angle) * dist,
          y: lastPos.y + Math.sin(angle) * dist
        });
      }
      scheduleRedraw();
    }, 40);
  }

  function stopSpray() {
    if (sprayTimer) {
      window.clearInterval(sprayTimer);
      sprayTimer = null;
    }
  }

  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endStroke);
  window.addEventListener('pointercancel', endStroke);
  window.addEventListener('blur', endStroke);
  viewport.addEventListener('scroll', scheduleRedraw, { passive: true });
  window.addEventListener('resize', resizeCanvas);
  if (window.ResizeObserver) {
    new ResizeObserver(resizeCanvas).observe(viewport);
  }

  /* ---------- toolbar ---------- */

  function setTool(next) {
    tool = next;
    var buttons = app.querySelectorAll('.mspaint-tool[data-tool]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('is-active', buttons[i].getAttribute('data-tool') === next);
    }
    if (tool !== 'select') {
      document.body.setAttribute('data-paint-tool', tool);
    } else {
      document.body.removeAttribute('data-paint-tool');
    }
    setStatus(STATUS[next] || '');
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function undo() {
    if (cur) return;
    ops.pop();
    scheduleRedraw();
  }

  function clearAll() {
    ops.push({ tool: 'clear', points: [] });
    if (ops.length > MAX_OPS) ops.splice(0, ops.length - MAX_OPS);
    scheduleRedraw();
  }

  app.addEventListener('click', function (e) {
    var toolBtn = e.target.closest('.mspaint-tool[data-tool]');
    if (toolBtn) { setTool(toolBtn.getAttribute('data-tool')); return; }

    var swatch = e.target.closest('.mspaint-swatch[data-color]');
    if (swatch) {
      color = swatch.getAttribute('data-color');
      if (currentFg) currentFg.style.background = color;
      return;
    }

    var sizeBtn = e.target.closest('.mspaint-size[data-size]');
    if (sizeBtn) {
      size = parseInt(sizeBtn.getAttribute('data-size'), 10) || 2;
      var sizes = app.querySelectorAll('.mspaint-size');
      for (var i = 0; i < sizes.length; i++) sizes[i].classList.toggle('is-active', sizes[i] === sizeBtn);
      return;
    }

    if (e.target.closest('#mspaint-undo')) { undo(); return; }
    if (e.target.closest('#mspaint-clear')) { clearAll(); return; }
    if (e.target.closest('#mspaint-close')) {
      setStatus("Nice try — this website IS the Paint window. There's no escape.");
      return;
    }
    if (e.target.closest('#mspaint-minimize') || e.target.closest('#mspaint-maximize')) {
      setStatus('This window is already exactly the right size.');
    }
  });

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (editing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') {
      setTool('select');
    }
  });

  /* ---------- init ---------- */

  resizeCanvas();
  setTool('pencil');
})();
