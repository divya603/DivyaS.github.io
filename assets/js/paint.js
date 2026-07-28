/* MS Paint drawing overlay.
   Lets visitors doodle anywhere on the page with an MS-Paint-style tool window.
   Strokes are stored in document coordinates and replayed onto a fixed,
   viewport-sized canvas, translated by the current scroll offset. */
(function () {
  'use strict';

  // Touch devices use the same gesture for scrolling — desktop only.
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;

  var canvas = document.getElementById('mspaint-canvas');
  var win = document.getElementById('mspaint-window');
  var taskbarBtn = document.getElementById('mspaint-taskbar-btn');
  if (!canvas || !win || !taskbarBtn) return;

  var ctx = canvas.getContext('2d');
  var statusEl = win.querySelector('.mspaint-status');
  var currentFg = win.querySelector('.mspaint-current-fg');

  var STORAGE_KEY = 'mspaint-open';
  var MAX_OPS = 400;

  var enabled = true;
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

  var INTERACTIVE = 'a,button,input,select,textarea,label,summary,iframe,video,audio,[contenteditable],.mspaint-window,.mspaint-taskbar-btn';

  /* ---------- canvas + rendering ---------- */

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
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
    ctx.translate(-window.scrollX, -window.scrollY);
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

  function docPoint(e) {
    return { x: e.pageX, y: e.pageY };
  }

  function onPointerDown(e) {
    if (!enabled || tool === 'select' || e.button !== 0) return;
    if (window.getComputedStyle(win).display === 'none') return; // hidden by CSS (narrow screen)
    if (e.target.closest && e.target.closest(INTERACTIVE)) return;
    e.preventDefault(); // stops text selection / image drag while sketching
    lastPos = docPoint(e);
    cur = { tool: tool, color: color, size: size, points: [docPoint(e)] };
    try {
      document.documentElement.setPointerCapture(e.pointerId);
    } catch (err) { /* capture is a nicety, not a requirement */ }
    if (tool === 'spray') startSpray();
    scheduleRedraw();
  }

  function onPointerMove(e) {
    if (!cur) return;
    lastPos = docPoint(e);
    if (cur.tool === 'spray') return; // dots are emitted by the timer
    if (cur.tool === 'line') {
      cur.points[1] = docPoint(e);
    } else {
      cur.points.push(docPoint(e));
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
  window.addEventListener('scroll', scheduleRedraw, { passive: true });
  window.addEventListener('resize', resizeCanvas);

  /* ---------- toolbar ---------- */

  function setTool(next) {
    tool = next;
    var buttons = win.querySelectorAll('.mspaint-tool[data-tool]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('is-active', buttons[i].getAttribute('data-tool') === next);
    }
    updateBodyCursor();
    if (statusEl) statusEl.textContent = STATUS[next] || '';
  }

  function updateBodyCursor() {
    if (enabled && tool !== 'select') {
      document.body.setAttribute('data-paint-tool', tool);
    } else {
      document.body.removeAttribute('data-paint-tool');
    }
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

  function openWindow() {
    enabled = true;
    win.classList.remove('mspaint-hidden');
    taskbarBtn.classList.add('mspaint-hidden');
    updateBodyCursor();
    try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch (err) { /* private mode */ }
  }

  function closeWindow() {
    enabled = false;
    endStroke();
    win.classList.add('mspaint-hidden');
    taskbarBtn.classList.remove('mspaint-hidden');
    updateBodyCursor();
    try { window.localStorage.setItem(STORAGE_KEY, '0'); } catch (err) { /* private mode */ }
  }

  win.addEventListener('click', function (e) {
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
      var sizes = win.querySelectorAll('.mspaint-size');
      for (var i = 0; i < sizes.length; i++) sizes[i].classList.toggle('is-active', sizes[i] === sizeBtn);
      return;
    }

    if (e.target.closest('#mspaint-undo')) { undo(); return; }
    if (e.target.closest('#mspaint-clear')) { clearAll(); return; }
    if (e.target.closest('#mspaint-minimize')) { win.classList.toggle('mspaint-minimized'); return; }
    if (e.target.closest('#mspaint-close')) closeWindow();
  });

  taskbarBtn.addEventListener('click', openWindow);

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    var editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (editing) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      if (!enabled) return;
      e.preventDefault();
      undo();
    } else if (e.key === 'Escape') {
      setTool('select');
    }
  });

  /* ---------- draggable window ---------- */

  var titlebar = win.querySelector('.mspaint-titlebar');
  if (titlebar) {
    var dragDX = 0;
    var dragDY = 0;
    var dragging = false;

    titlebar.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button')) return;
      e.preventDefault();
      var rect = win.getBoundingClientRect();
      win.style.left = rect.left + 'px';
      win.style.top = rect.top + 'px';
      win.style.bottom = 'auto';
      dragDX = e.clientX - rect.left;
      dragDY = e.clientY - rect.top;
      dragging = true;
      try { titlebar.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    });
    titlebar.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var x = Math.min(Math.max(e.clientX - dragDX, 4 - win.offsetWidth + 40), window.innerWidth - 40);
      var y = Math.min(Math.max(e.clientY - dragDY, 0), window.innerHeight - 24);
      win.style.left = x + 'px';
      win.style.top = y + 'px';
    });
    titlebar.addEventListener('pointerup', function () { dragging = false; });
    titlebar.addEventListener('pointercancel', function () { dragging = false; });
  }

  /* ---------- init ---------- */

  resizeCanvas();
  setTool('pencil');

  var openPref = null;
  try { openPref = window.localStorage.getItem(STORAGE_KEY); } catch (err) { /* private mode */ }
  if (openPref === '0') {
    closeWindow();
  } else {
    openWindow();
  }
})();
