/**
 * app.js — Page routing and Service Worker registration.
 */

(function() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  }

  const page = location.pathname.split('/').pop() || 'index.html';

  if (page === 'home.html' || page === 'index.html' || page === '') {
    if (typeof initHome === 'function') initHome();
  }
  // puzzle.html — puzzle-render.js self-initialises
})();
