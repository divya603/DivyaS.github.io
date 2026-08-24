/* Background mandalas: the grow-in is pure CSS (see .mandala-corner in
   site.css). This script only fast-forwards that animation so it keeps
   growing across page navigations within the same tab instead of
   restarting, by giving it a negative delay equal to elapsed time. Progress
   is stored per browser tab; a fresh visit starts over. */
(function () {
  'use strict';

  var DURATION = 90000; // must match the animation-duration in site.css
  var STORAGE_KEY = 'mandala-start';

  var corners = document.querySelectorAll('.mandala-corner');
  if (!corners.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var startedAt = null;
  try {
    var stored = window.sessionStorage.getItem(STORAGE_KEY);
    if (stored) startedAt = parseInt(stored, 10);
    if (!startedAt || isNaN(startedAt)) {
      startedAt = Date.now();
      window.sessionStorage.setItem(STORAGE_KEY, String(startedAt));
    }
  } catch (err) {
    startedAt = Date.now(); // private browsing: just start fresh
  }

  var elapsed = Math.min(Date.now() - startedAt, DURATION);
  if (elapsed <= 0) return;

  for (var i = 0; i < corners.length; i++) {
    corners[i].style.animationDelay = '-' + elapsed + 'ms';
  }
})();
