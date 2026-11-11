/* Coque Manager (même architecture que apps/admin-web/src/app/shell/ManagerShell.tsx) : barre latérale opaque de 280 px,
   barre supérieure et tiroir modal sous 1024 px. Équipements et Casiers existent déjà dans l'application : hors de ce prototype. */
(function () {
  var AG = window.AG, T = AG.t, U = AG.ui, esc = U.esc;
  var SECTIONS = [
    { id: 'overview', icon: 'grid', page: 'overview' },
    { id: 'equipment', icon: 'box', page: null },
    { id: 'reservationsLoans', icon: 'calendar', page: 'reservations' },
    { id: 'lockers', icon: 'locker', page: null },
    { id: 'anomalies', icon: 'alert', page: 'anomalies' },
    { id: 'audit', icon: 'list', page: 'audit' }
  ];

  function brand() {
    var A = '../../identite/assets/';
    return '<a class="ag-brand" href="' + U.url('index') + '" aria-label="' + esc(T.brandHome) + '">' +
      '<span class="ag-brand__mark" aria-hidden="true"><img class="ag-brand__img ag-brand__img--light" src="' + A + 'aegis-core-mark.svg" alt="" width="64" height="64">' +
      '<img class="ag-brand__img ag-brand__img--dark" src="' + A + 'aegis-core-mark-dark.svg" alt="" width="64" height="64"></span>' +
      '<span class="ag-brand__text"><span class="ag-brand__word">aegis</span><span class="ag-brand__app">Manager</span></span></a>';
  }
  function sectionList(current) {
    var items = SECTIONS.map(function (s) {
      var label = T.sections[s.id];
      if (s.page) {
        return '<li><a class="ag-nav__item" href="' + U.url(s.page) + '"' + (s.page === current ? ' aria-current="page"' : '') + '>' + U.icon(s.icon) + esc(label) + '</a></li>';
      }
      return '<li><span class="ag-nav__item ag-nav__item--out" aria-disabled="true">' + U.icon(s.icon) + esc(label) + '<span class="ag-sr-only">' + esc(T.outSuffix) + '</span><span class="ag-soon" aria-hidden="true"></span></span></li>';
    }).join('');
    return '<ul class="ag-nav">' + items + '</ul><p class="cs-nav-legend" aria-hidden="true"><span class="ag-soon"></span>' + esc(T.outLegend) + '</p>';
  }
  function initials(name) { return name.split(/\s+/).slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join(''); }
  function account() {
    return '<div class="cs-account"><span class="ag-avatar" aria-hidden="true">' + esc(initials(T.adminName)) + '</span>' +
      '<span class="ag-account__who"><span class="ag-account__name">' + esc(T.adminName) + '</span><span class="ag-account__role">' + esc(T.adminRole) + '</span></span></div>';
  }

  /* opts : current (page), flow (défilement de page), states (liste des états de l'écran) */
  AG.mountShell = function (opts) {
    document.documentElement.lang = T.htmlLang;
    document.title = T.pageTitles[opts.current];
    var root = document.getElementById('root');
    var bandState = '<span class="cs-band__state">' + esc(T.bandState) + ' : <strong>' + esc(AG.state) + '</strong></span>';
    var review = '';
    if (opts.states) {
      review = '<aside class="cs-review" aria-label="' + esc(T.reviewSummary) + '"><details><summary>' + esc(T.reviewSummary) + '</summary><ul>' + opts.states.map(function (s) {
        return '<li><a href="' + U.here({ state: s === 'nominal' ? null : s, dialog: null }) + '"' + (s === AG.state ? ' aria-current="true"' : '') + '>' + esc(s) + '</a></li>';
      }).join('') + '</ul><p>' + esc(T.reviewNote) + '</p></details></aside>';
    }
    root.innerHTML =
      '<div class="ag-shell' + (opts.flow ? ' ag-shell--flow' : '') + '">' +
      '<a class="ag-skip" href="#contenu">' + esc(T.skip) + '</a>' +
      '<nav class="ag-side" aria-label="' + esc(T.sectionsLabel) + '"><div class="ag-side__brand">' + brand() + '</div>' + sectionList(opts.current) + '<div class="ag-account">' + account() + '</div></nav>' +
      '<div class="ag-shell__main">' +
      '<header class="ag-topbar" role="banner">' + brand() + '<button type="button" class="ag-icon-button" id="menu-btn" aria-label="' + esc(T.openMenu) + '" aria-haspopup="dialog">' + U.icon('menu') + '</button></header>' +
      '<div class="ag-shell__content">' +
      '<aside class="cs-band" aria-label="' + esc(T.band) + '"><strong>' + esc(T.band) + '</strong><span>' + esc(T.bandBody) + '</span><a href="' + U.url('index') + '">' + esc(T.bandIndex) + '</a>' + bandState + '<div class="ag-sr-only" id="live" role="status"></div></aside>' +
      '<main id="contenu" class="ag-page" tabindex="-1"></main>' + review +
      '</div></div></div>' +
      '<dialog class="ag-drawer" id="drawer" aria-labelledby="drawer-title"><div class="ag-drawer__panel">' +
      '<div class="ag-drawer__head"><h2 id="drawer-title" class="ag-drawer__title">' + esc(T.menuTitle) + '</h2><button type="button" class="ag-icon-button" id="drawer-close" aria-label="' + esc(T.closeMenu) + '">' + U.icon('close') + '</button></div>' +
      '<nav aria-label="' + esc(T.sectionsLabel) + '">' + sectionList(opts.current) + '</nav>' +
      '<div class="ag-drawer__account" role="group" aria-label="' + esc(T.accountLabel) + '">' + account() + '</div></div></dialog>';

    var d = document.getElementById('drawer'), trigger = document.getElementById('menu-btn');
    trigger.addEventListener('click', function () { d.showModal(); });
    document.getElementById('drawer-close').addEventListener('click', function () { d.close(); });
    d.addEventListener('click', function (e) { if (e.target === d || e.target.closest('a')) d.close(); });
    d.addEventListener('close', function () { trigger.focus(); });
    d.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = Array.prototype.slice.call(d.querySelectorAll('a[href], button')).filter(function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    if (AG.q.get('drawer') === '1') d.showModal();
    return document.getElementById('contenu');
  };

  /* En-tête de page : h1 + indications; `actionsHtml` à droite. */
  AG.pageHead = function (title, leadHtml, actionsHtml, afterTitleHtml) {
    return '<header class="ag-page__head"><div class="ag-page__titles"><h1 id="titre-page" tabindex="-1" class="ag-page__title">' + esc(title) + '</h1>' +
      (leadHtml ? '<p class="cs-lead">' + leadHtml + '</p>' : '') + (afterTitleHtml || '') + '</div>' + (actionsHtml ? '<div class="ag-page__actions">' + actionsHtml + '</div>' : '') + '</header>';
  };
  AG.ready = function () {
    document.body.setAttribute('data-ready', '1');
  };
})();
