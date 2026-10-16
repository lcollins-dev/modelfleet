// Reads the theme store's `isDarkMode` key, so the stored theme applies before the app loads. A file rather than an
// inline script, as the server's Content-Security-Policy refuses inline scripts.
try {
  if (localStorage.getItem('isDarkMode') === 'false') {
    document.documentElement.dataset.theme = 'light';
  }
} catch {}
