/* Aides communes : mise en forme des instants (fuseau du laboratoire, comme apps/admin-web/src/i18n/format.ts),
   composants (puce de statut, alerte, bouton, encadré), liens entre écrans, relance simulée. */
(function () {
  var AG = window.AG, T = AG.t, I = AG.icons, FX = AG.fx, U = AG.ui;
  var tag = AG.lang === 'en' ? 'en-CA' : 'fr-CA';
  var cache = {};
  function dtf(opts) {
    var k = JSON.stringify(opts);
    return cache[k] || (cache[k] = new Intl.DateTimeFormat(tag, Object.assign({ timeZone: FX.ZONE }, opts)));
  }
  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var esc = U.esc;
  var fmt = U.fmt = {
    time: function (iso) { return dtf({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso)); },
    clock: function (iso) { return dtf({ hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); },
    clockSec: function (iso) { return dtf({ hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(iso)); },
    short: function (iso) { return dtf({ month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); },
    full: function (iso) { return dtf({ year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).format(new Date(iso)); },
    date: function (iso) { return dtf({ dateStyle: 'medium' }).format(new Date(iso)); },
    day: function (iso) { return dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)); },
    dayKey: function (iso) { return new Intl.DateTimeFormat('en-CA', { timeZone: FX.ZONE }).format(new Date(iso)); },
    n: function (n) { return new Intl.NumberFormat(tag).format(n); }
  };
  U.now = function () { return fmt.time(FX.NOW); };
  /* Heure du jour pour aujourd'hui, date courte et heure sinon (l'instant de référence du prototype est FX.NOW). */
  U.when = function (iso) { return fmt.dayKey(iso) === fmt.dayKey(FX.NOW) ? fmt.clock(iso) : fmt.short(iso); };
  U.shortId = function (id) { return id ? id.slice(0, 8) + '…' : ''; };
  U.idHtml = function (id, full) { return '<code class="cs-id' + (full ? ' cs-id--full' : '') + '">' + esc(full ? id : U.shortId(id)) + '</code>'; };

  U.icon = function (n, c) { return I.get(n, c); };
  U.chip = function (role, icon, text, size) {
    return '<span class="ag-chip ag-chip--' + role + (size ? ' ag-chip--' + size : '') + '">' + I.get(icon) + esc(text) + '</span>';
  };
  U.gap = function (id) {
    return '<span class="cs-gaptag">' + esc(id) + '<span class="ag-sr-only"> (' + esc(T.gap(id)) + ')</span></span>';
  };
  U.btn = function (text, o) {
    o = o || {};
    return '<button type="button" class="ag-btn ag-btn--' + (o.variant || 'secondary') + (o.size ? ' ag-btn--' + o.size : '') + (o.cls ? ' ' + o.cls : '') + '"' +
      (o.id ? ' id="' + o.id + '"' : '') + (o.attrs ? ' ' + o.attrs : '') + '>' + (o.icon ? I.get(o.icon) : '') + esc(text) + '</button>';
  };
  U.alert = function (kind, icon, title, bodyHtml, o) {
    o = o || {};
    return '<div class="ag-alert ag-alert--' + kind + '" role="' + (kind === 'info' ? 'status' : 'alert') + '"' + (o.id ? ' id="' + o.id + '"' : '') + (o.tabindex ? ' tabindex="-1"' : '') + '>' +
      I.get(icon) + '<div class="ag-alert__content"><p class="ag-alert__title">' + esc(title) + '</p>' +
      (bodyHtml ? '<div class="ag-alert__body">' + bodyHtml + '</div>' : '') +
      (o.code ? '<p class="ag-alert__code-row">' + (o.codeLabel ? '<span class="ag-alert__code-label">' + esc(o.codeLabel) + '</span> ' : '') + '<code class="ag-alert__code">' + esc(o.code) + '</code></p>' : '') +
      (o.action ? '<div class="ag-alert__action">' + o.action + '</div>' : '') + '</div></div>';
  };
  U.callout = function (kind, icon, html, extra) {
    return '<div class="cs-callout' + (kind ? ' cs-callout--' + kind : '') + (extra ? ' ' + extra : '') + '">' + I.get(icon) + '<div>' + html + '</div></div>';
  };
  U.retryBtn = function (mode) { return U.btn(T.retry, { variant: 'secondary', size: 'sm', attrs: 'data-retry="' + (mode || 'nominal') + '"' }); };

  /* Alertes de défaillance, une par nature (mêmes textes que le catalogue des Équipements). kind : unreachable, service-error, forbidden, unavailable, not-found */
  var TRACE = '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30';
  U.failure = function (kind, section, o) {
    o = o || {};
    if (kind === 'unreachable') return U.alert('warning', 'status-offline', T.unreachableTitle, '<p>' + esc(T.unreachableBody) + '</p>', { action: U.retryBtn() });
    if (kind === 'service-error') return U.alert('error', 'status-error', T.serviceErrorTitle, '<p>' + esc(T.serviceErrorBody) + '</p>', { code: TRACE, codeLabel: T.traceIdLabel, action: U.retryBtn() });
    if (kind === 'forbidden') return U.alert('error', 'status-error', T.forbidden[section], '<p>' + esc(T.forbiddenBody) + '</p>');
    if (kind === 'unavailable') return U.alert('warning', 'status-clock', T.unavailableTitle, '<p>' + esc(T.unavailableBody) + '</p>', { code: T.unavailableCode, action: U.retryBtn('stay') });
    if (kind === 'not-found') return U.alert('warning', 'status-info', T.notFoundTitle, '<p>' + esc(T.notFoundBody) + '</p>', { action: o.back ? U.btn(T.backToList, { size: 'sm', attrs: 'data-back' }) : '' });
    return '';
  };
  U.stale = function () {
    return U.alert('warning', 'status-offline', T.staleTitle, '<p>' + esc(T.staleBody({ time: U.now() })) + '</p>', { action: U.retryBtn() });
  };
  U.skeletonRows = function (n) {
    var out = '<div class="ag-list__items" aria-hidden="true">';
    for (var i = 0; i < (n || 3); i++) out += '<div class="ag-skel"><span class="ag-skel__bar ag-skel__bar--chip"></span><span class="ag-skel__bar ag-skel__bar--name"></span><span class="ag-skel__bar ag-skel__bar--facts"></span></div>';
    return out + '</div>';
  };
  U.skeletonDossier = function () {
    return '<div class="ag-dossier__skel" aria-hidden="true"><span class="ag-skel__bar ag-skel__bar--title"></span><span class="ag-skel__bar ag-skel__bar--block"></span><span class="ag-skel__bar ag-skel__bar--facts"></span></div>';
  };

  /* Liens : conservent lang, theme, notes; l'état n'est reporté que s'il est donné. */
  U.url = function (page, params) {
    var q = new URLSearchParams();
    ['lang', 'theme', 'notes'].forEach(function (k) { if (AG.q.get(k)) q.set(k, AG.q.get(k)); });
    Object.keys(params || {}).forEach(function (k) { if (params[k] !== null && params[k] !== undefined && params[k] !== '') q.set(k, params[k]); });
    var s = q.toString();
    return page + '.html' + (s ? '?' + s : '');
  };
  U.here = function (changes) {
    var q = new URLSearchParams(location.search);
    Object.keys(changes).forEach(function (k) { if (changes[k] === null) q.delete(k); else q.set(k, changes[k]); });
    return location.pathname.split('/').pop() + '?' + q.toString();
  };
  U.announce = function (text) {
    var live = document.getElementById('live');
    if (!live) return;
    live.textContent = '';
    window.setTimeout(function () { live.textContent = text; }, 30);
  };

  /* Relance simulée : « Réessayer » et « Actualiser » (aucune requête). mode « stay » : le service répond encore 404. */
  U.wireRetry = function (root) {
    root.querySelectorAll('[data-retry]').forEach(function (b) {
      if (b.__wired) return;
      b.__wired = true;
      b.addEventListener('click', function () {
        if (b.getAttribute('aria-disabled') === 'true') return;
        var mode = b.getAttribute('data-retry');
        b.setAttribute('aria-disabled', 'true');
        b.classList.add('is-busy');
        b.insertAdjacentHTML('beforeend', I.spinner());
        window.setTimeout(function () {
          b.removeAttribute('aria-disabled');
          b.classList.remove('is-busy');
          var sp = b.querySelector('.ag-spinner');
          if (sp) sp.remove();
          if (mode === 'ok') { U.announce(T.refreshed({ time: U.now() })); return; }
          if (mode === 'stay') { U.announce(T.stillUnavailable); return; }
          if (mode === 'fail') { U.announce(T.refreshFailed); return; }
          window.location.replace(U.here({ state: null, dialog: null }));
        }, 700);
      });
    });
  };

  /* Étiquettes d'états : puces (forme + symbole + texte, jamais la couleur seule). */
  U.chips = {
    reservation: function (s) {
      var m = { ACTIVE: ['progress', 'status-info'], FULFILLED: ['neutral', 'status-ready'], CANCELLED: ['neutral', 'status-info'], EXPIRED: ['neutral', 'status-clock'] }[s] || ['neutral', 'status-info'];
      return U.chip(m[0], m[1], T.rl.st.reservation[s] || s);
    },
    loan: function (s) {
      var m = { ACTIVE: ['progress', 'status-person'], RETURN_PENDING: ['progress', 'status-clock'], COMPLETED: ['neutral', 'status-ready'] }[s] || ['neutral', 'status-info'];
      return U.chip(m[0], m[1], T.rl.st.loan[s] || s);
    },
    late: function () { return U.chip('unknown', 'status-clock', T.rl.lateChip); },
    op: function (s) {
      var m = { CONFIRMED: ['ready', 'status-ready'], FAILED: ['blocked', 'status-blocked'], EXPIRED: ['unknown', 'status-clock'], ANOMALY: ['anomaly', 'status-warn'] }[s] || ['progress', 'status-clock'];
      return U.chip(m[0], m[1], T.rl.st.op[s] || s);
    },
    severity: function (s) {
      var m = { HIGH: ['blocked', 'status-error'], MEDIUM: ['unknown', 'status-warn'], LOW: ['info', 'status-info'] }[s];
      return U.chip(m[0], m[1], T.an.sev[s]);
    },
    anomaly: function (s) {
      var m = { OPEN: ['anomaly', 'status-warn'], ACKNOWLEDGED: ['info', 'status-person'], RESOLVED: ['neutral', 'status-ready'] }[s];
      return U.chip(m[0], m[1], T.an.st[s]);
    },
    conn: function (s) {
      var m = { ONLINE: ['ready', 'status-online'], OFFLINE: ['unknown', 'status-offline'], UNKNOWN: ['neutral', 'status-info'] }[s];
      return U.chip(m[0], m[1], T.conn[s]);
    }
  };

  U.assetName = function (a) { return a.model.name + ' <span class="ag-item__code">' + esc(a.assetCode) + '</span>'; };
  U.assetText = function (a) { return a.model.name + ' · ' + a.assetCode; };
  U.assetTitle = function (a) { return esc(a.model.name) + ' · <span class="ag-tnum">' + esc(a.assetCode) + '</span>'; };
  U.placementText = function (a) { return a.placement ? a.placement.lockerCode + ' · ' + T.rl.cell + ' ' + a.placement.compartmentCode : null; };

  /* Résolution (jointure) des libellés d'une anomalie ou d'une opération : UUID -> code, par les lectures Équipements et Casiers (G3).
     L'état « join-failed » force le repli « identifiant seulement ». */
  U.join = {
    failed: function () { return AG.state === 'join-failed'; },
    asset: function (id) { return U.join.failed() ? null : FX.assetById(id); },
    cell: function (id) { return U.join.failed() ? null : FX.cellById(id); }
  };

  U.textEscNl = function (s) { return esc(s).replace(/\n/g, '<br>'); };

  U.nowClock = function () { return fmt.time(FX.NOW); };
})();
