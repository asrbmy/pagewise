// Apply the saved theme before first paint to avoid a light/dark flash.
try {
  var p = JSON.parse(localStorage.getItem('pagewise:prefs') || '{}');
  var t = p.theme || 'system';
  if (t === 'system') t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
