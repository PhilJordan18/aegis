/* Chargé dans <head> : pose lang, thème et police avant la première peinture. */
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
  if (q.get('font') === 'system') root.setAttribute('data-font', 'system');
  window.AEGIS_PARAMS = q;
  window.AEGIS_LANG = lang;
})();
