/* Chargé dans <head> : pose lang, thème et annotations avant la première peinture.
   Paramètres d'URL : lang (fr, en), theme (dark, light), state (voir index.html), notes=off (masque les annotations de revue). */
(function () {
  var q = new URLSearchParams(location.search);
  var root = document.documentElement;
  var theme = q.get('theme');
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var lang = q.get('lang') === 'en' ? 'en' : 'fr';
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-lang', lang);
  root.lang = lang === 'en' ? 'en-CA' : 'fr-CA';
  if (q.get('notes') === 'off') root.setAttribute('data-notes', 'off');
  window.AG = { q: q, lang: lang, theme: theme, state: q.get('state') || 'nominal', ui: {}, fx: {} };
})();
