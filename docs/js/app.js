/**
 * app.js — Page routing, auth guard, Service Worker registration,
 *          home page init dispatch.
 */

(function() {
  // ── Register Service Worker ───────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  }

  const page = location.pathname.split('/').pop() || 'index.html';

  // ── index.html — PIN / setup screen ──────────────
  if (page === 'index.html' || page === '') {
    // If already authenticated this session, skip PIN screen
    if (Auth.isAuthenticated()) {
      window.location.href = 'home.html';
      return;
    }
    PinScreen.init();
    return;
  }

  // ── All other pages require authentication ────────
  if (!Auth.isAuthenticated()) {
    window.location.href = 'index.html';
    return;
  }

  // ── home.html ─────────────────────────────────────
  if (page === 'home.html') {
    // initHome is defined in home.js
    if (typeof initHome === 'function') initHome();
    return;
  }

  // ── puzzle.html ───────────────────────────────────
  // puzzle-render.js self-initialises as an IIFE.

})();
