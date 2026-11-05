(function () {
  var Q = window.AEGIS_PARAMS, T = window.AEGIS_COPY[window.AEGIS_LANG], I = window.AEGIS_ICONS;
  var $ = function (id) { return document.getElementById(id); };
  document.documentElement.lang = T.htmlLang;
  document.title = T.shellTitle;
  $('skip').textContent = T.skip;

  var B = window.AEGIS_BRAND;
  function mark(s) { return B.mark(s); }
  function brand(size) { return B.link({ size: size, label: T.brandHome, app: T.appName }); }
  var icons = ['overview', 'equipment', 'reservations', 'lockers', 'anomalies', 'audit'];
  function nav() {
    var li = T.nav.map(function (label, i) {
      if (i === 1) return '<li><a href="#contenu" aria-current="page">' + I.ui(icons[i]) + '<span>' + label + '</span></a></li>';
      return '<li><span class="sh-nav__item" aria-disabled="true">' + I.ui(icons[i]) + '<span>' + label + '<span class="ag-sr-only">, ' + T.upcoming + '</span></span><i class="sh-nav__soon" aria-hidden="true"></i></span></li>';
    }).join('');
    return '<nav aria-label="' + T.navLabel + '"><ul class="sh-nav">' + li + '</ul></nav>' +
      '<p class="sh__legend"><i aria-hidden="true"></i>' + T.upcomingLegend + '</p>';
  }
  function account() {
    return '<button type="button" class="sh-account" aria-expanded="false"><span class="sh-account__avatar" aria-hidden="true">AD</span>' +
      '<span class="sh-account__who"><span class="sh-account__name">' + T.accountName + '</span><span class="sh-account__role">' + T.accountRole + '</span></span>' + I.ui('chevron') + '</button>';
  }

  $('bar-brand').innerHTML = brand(28);
  $('side').innerHTML = brand(32) + nav() + '<div class="sh__account">' + account() + '</div>';
  $('menu-icon').innerHTML = I.ui('menu');
  $('menu-label').textContent = T.menu;
  $('menu-btn').setAttribute('aria-label', T.menuOpen);

  var d = $('drawer');
  d.setAttribute('aria-label', T.menu);
  d.innerHTML = '<div class="sh__drawerhead">' + brand(28) + '<button type="button" class="sh__drawerclose" id="drawer-close" autofocus aria-label="' + T.menuClose + '">' + I.ui('close') + '</button></div>' +
    nav() + '<div class="sh__account">' + account() + '</div>';
  $('menu-btn').addEventListener('click', function () { d.showModal(); });
  d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
  $('drawer-close').addEventListener('click', function () { d.close(); });
  d.querySelector('a[aria-current]').addEventListener('click', function () { d.close(); });
  if (Q.get('drawer') === '1') d.showModal();

  $('page-title').textContent = T.pageTitle;
  $('locker-chip').innerHTML = I.status('ready') + T.lockerOnline;
  $('locker-info').textContent = T.lockerInfo;
  $('band-title').textContent = T.mockBandTitle;
  $('band-body').textContent = T.mockBandBody;
  $('list-title').textContent = T.listTitle;
  $('list-meta').textContent = T.listMeta;
  $('rows').innerHTML = T.rows.map(function (r, i) {
    return '<li class="sh__row' + (i === 1 ? ' sh__row--selected' : '') + '"><span class="ag-chip ag-chip--' + r.chip + '">' + I.status(r.chip === 'blocked' ? 'blocked' : 'neutral') + r.chipText + '</span>' +
      (r.reason ? '<span class="sh__reason">' + r.reason + '</span>' : '') +
      '<span><span class="sh__name">' + r.name + '</span><span class="sh__code">' + r.code + '</span></span>' +
      '<span class="sh__facts">' + r.facts + '</span></li>';
  }).join('');
  $('spec-mark').outerHTML = mark(36);
  $('spec-title').textContent = T.specimenTitle;
  $('spec-chips').innerHTML = T.specimenChips.map(function (c) {
    return '<li><span class="ag-chip ag-chip--' + c[0] + '">' + I.status(c[0]) + c[1] + '</span></li>';
  }).join('');
  $('spec-note').textContent = T.specimenNote;
  if (Q.get('specimen') === 'off') $('specimen').hidden = true;
  document.body.setAttribute('data-ready', '1');
})();
