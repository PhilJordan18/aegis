/* Index du prototype : écrans, états et paramètres. Page de revue, hors produit. */
(function () {
  var AG = window.AG, lang = AG.lang;
  var fr = lang === 'fr';
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var SCREENS = [
    { page: 'overview', name: fr ? "Vue d'ensemble" : 'Overview', issue: 'DES-02', tabs: [],
      states: ['nominal', 'loading', 'all-clear', 'locker-offline', 'locker-unknown', 'partial', 'stale', 'unreachable', 'service-error', 'forbidden', 'unauthorized'] },
    { page: 'reservations', name: fr ? 'Réservations et prêts' : 'Reservations and loans', issue: '#48', tabs: ['reservations', 'loans', 'operations'],
      states: ['nominal', 'loading', 'empty', 'partial', 'stale', 'unreachable', 'service-error', 'forbidden', 'unauthorized', 'detail-404', 'join-failed'] },
    { page: 'anomalies', name: fr ? 'Anomalies' : 'Anomalies', issue: '#52', tabs: [],
      states: ['nominal', 'loading', 'empty', 'partial', 'stale', 'unreachable', 'service-error', 'forbidden', 'unauthorized', 'detail-404', 'join-failed', 'ack-resolved', 'ack-not-acknowledgeable', 'ack-validation', 'ack-unreachable'] },
    { page: 'audit', name: fr ? 'Audit' : 'Audit', issue: '#53', tabs: [],
      states: ['nominal', 'loading', 'empty', 'partial', 'invalid-cursor', 'stale', 'unreachable', 'service-error', 'forbidden', 'unauthorized'] }
  ];
  function q(extra) {
    var p = new URLSearchParams();
    p.set('lang', lang); p.set('theme', AG.theme);
    Object.keys(extra || {}).forEach(function (k) { p.set(k, extra[k]); });
    return '?' + p.toString();
  }
  function toggle(label, params, current) { return '<a class="cs-ix__tog" href="index.html' + q(params) + '"' + (current ? ' aria-current="true"' : '') + '>' + esc(label) + '</a>'; }

  var h = '<main id="contenu" class="cs-ix" tabindex="-1">' +
    '<aside class="cs-band" aria-label="' + (fr ? 'Aperçu de revue' : 'Review preview') + '"><strong>' + (fr ? 'Aperçu de revue' : 'Review preview') + '</strong><span>' + (fr ? 'données fictives; aucune requête; non intégré à apps/admin-web.' : 'fictional data; no request; not integrated into apps/admin-web.') + '</span></aside>' +
    '<h1 class="ag-page__title">' + (fr ? 'Console Manager : prototype statique' : 'Manager console: static prototype') + '</h1>' +
    '<p class="cs-lead">' + (fr ? 'Vue d’ensemble, Réservations et prêts, Anomalies et Audit (issue #158, DES-02). Proposition à valider par Philippe : aucune approbation n’est acquise.' : 'Overview, Reservations and loans, Anomalies and Audit (issue #158, DES-02). Proposal for Philippe to validate: no approval is implied.') + '</p>' +
    '<div class="cs-ix__bar" role="group" aria-label="' + (fr ? 'Langue et apparence des liens' : 'Language and appearance of the links') + '">' +
    toggle('Français', { lang: 'fr', theme: AG.theme }, fr) + toggle('English', { lang: 'en', theme: AG.theme }, !fr) +
    toggle(fr ? 'Sombre' : 'Dark', { lang: lang, theme: 'dark' }, AG.theme === 'dark') + toggle(fr ? 'Clair' : 'Light', { lang: lang, theme: 'light' }, AG.theme === 'light') + '</div>';
  SCREENS.forEach(function (s) {
    h += '<section class="ag-panel cs-ix__sec" aria-labelledby="h-' + s.page + '"><h2 id="h-' + s.page + '" class="cs-ix__h">' + esc(s.name) + ' <span class="cs-ix__issue">' + esc(s.issue) + '</span></h2>';
    if (s.tabs.length) {
      h += '<p class="cs-ix__row"><span class="cs-ix__label">' + (fr ? 'Onglets' : 'Tabs') + '</span>' + s.tabs.map(function (t) { return '<a href="' + s.page + '.html' + q({ tab: t }) + '">' + esc(t) + '</a>'; }).join('') + '</p>';
    }
    h += '<p class="cs-ix__row"><span class="cs-ix__label">' + (fr ? 'États' : 'States') + '</span>' + s.states.map(function (st) {
      return '<a href="' + s.page + '.html' + q(st === 'nominal' ? {} : { state: st }) + '">' + esc(st) + '</a>';
    }).join('') + '</p>';
    if (s.page === 'anomalies') h += '<p class="cs-ix__row"><span class="cs-ix__label">' + (fr ? 'Dialogue' : 'Dialog') + '</span><a href="anomalies.html' + q({ dialog: '1' }) + '">dialog=1</a><a href="anomalies.html' + q({ dialog: '1', state: 'ack-resolved' }) + '">dialog=1 + ack-resolved</a></p>';
    if (s.page === 'audit') h += '<p class="cs-ix__row"><span class="cs-ix__label">' + (fr ? 'Filtres' : 'Filters') + '</span><a href="audit.html' + q({ filters: '1' }) + '">filters=1</a><a href="audit.html' + q({ eventType: 'ANOMALY_CREATED' }) + '">eventType=ANOMALY_CREATED</a></p>';
    h += '</section>';
  });
  h += '<section class="ag-panel cs-ix__sec" aria-labelledby="h-params"><h2 id="h-params" class="cs-ix__h">' + (fr ? 'Paramètres d’URL' : 'URL parameters') + '</h2><dl class="cs-kvs">' +
    '<div><dt>lang</dt><dd>fr, en</dd></div><div><dt>theme</dt><dd>dark, light (' + (fr ? 'sinon le réglage du système' : 'otherwise the system setting') + ')</dd></div>' +
    '<div><dt>state</dt><dd>' + (fr ? 'voir les listes ci-dessus' : 'see the lists above') + '</dd></div><div><dt>notes=off</dt><dd>' + (fr ? 'masque les annotations de revue (bandeau, repères G1 à G12, encadrés de contrat manquant)' : 'hides the review annotations (band, G1 to G12 tags, missing-contract boxes)') + '</dd></div>' +
    '<div><dt>tab, sel, size, page</dt><dd>' + (fr ? 'onglet, élément sélectionné, taille et page de la liste' : 'tab, selected item, list size and page') + '</dd></div><div><dt>drawer=1</dt><dd>' + (fr ? 'tiroir de navigation ouvert (sous 1024 px)' : 'navigation drawer open (below 1024 px)') + '</dd></div></dl></section>';
  h += '</main>';
  document.getElementById('root').innerHTML = h;
  document.documentElement.lang = lang === 'en' ? 'en-CA' : 'fr-CA';
  document.title = fr ? 'Console Manager — index du prototype' : 'Manager console — prototype index';
  document.body.setAttribute('data-ready', '1');
})();
