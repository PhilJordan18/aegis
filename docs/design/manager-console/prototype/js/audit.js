/* Audit (#53) : chronologie corrélée et détail (H2), pagination par curseur (09 §19.1, §22.2).
   Historique non modifiable : aucune action d'écriture. Les codes ne sont visibles que dans le détail.
   Aucun événement physique n'est synthétisé : l'absence de preuve est dite (G4). */
(function () {
  var AG = window.AG, T = AG.t, U = AG.ui, FX = AG.fx, esc = U.esc, fmt = U.fmt, S = AG.state, A = T.au, Q = AG.q;
  var STATES = ['nominal', 'loading', 'empty', 'partial', 'invalid-cursor', 'stale', 'unavailable', 'unreachable', 'service-error', 'forbidden', 'unauthorized'];
  var main = AG.mountShell({ current: 'audit', states: STATES });
  var LIMIT = Math.min(100, Math.max(1, parseInt(Q.get('limit') || '12', 10) || 12));
  var KEYS = ['from', 'to', 'eventType', 'subjectType', 'subjectId', 'operationId', 'actorUserId'];
  var F = {};
  KEYS.forEach(function (k) { F[k] = Q.get(k) || ''; });
  if (S === 'empty' && !KEYS.some(function (k) { return Q.has(k); })) F.eventType = 'ANOMALY_RESOLVED_BY_EVIDENCE';
  var selectedId = Q.get('sel');
  var pagesLoaded = 1;
  var listFail = { unavailable: 1, unreachable: 1, 'service-error': 1, forbidden: 1 }[S];
  var loading = S === 'loading';
  var SUBJECT = { fr: { RESERVATION: 'Réservation', LOAN: 'Prêt', LOCKER_OPERATION: 'Opération', ANOMALY: 'Anomalie' }, en: { RESERVATION: 'Reservation', LOAN: 'Loan', LOCKER_OPERATION: 'Operation', ANOMALY: 'Anomaly' } }[AG.lang];
  var SUBJECT_PAGE = { RESERVATION: ['reservations', 'reservations'], LOAN: ['reservations', 'loans'], LOCKER_OPERATION: ['reservations', 'operations'], ANOMALY: ['anomalies', null] };
  var LABEL = { eventType: A.fEventType, subjectType: A.fSubjectType, subjectId: A.fSubjectId, operationId: A.fOperationId, actorUserId: A.fActorId, from: T.fFrom, to: T.fTo };

  function events() {
    return FX.AUDIT.filter(function (e) {
      if (F.eventType && e.eventType !== F.eventType) return false;
      if (F.subjectType && e.subjectType !== F.subjectType) return false;
      if (F.subjectId && e.subjectId !== F.subjectId) return false;
      if (F.operationId && e.operationId !== F.operationId) return false;
      if (F.actorUserId && !(e.actor && e.actor.userId === F.actorUserId)) return false;
      var k = fmt.dayKey(e.occurredAt);
      if (F.from && k < F.from) return false;
      if (F.to && k > F.to) return false;
      return true;
    });
  }
  function eventLabel(t) { return A.events[t] || (A.unknownEvent + ' · ' + t); }
  function stateLabel(s) { return s === null || s === undefined ? A.noState : (T.states[s] || (A.unknownState + ' · ' + s)); }
  function actorText(e) { return e.actor ? A.actorUser({ id: U.shortId(e.actor.userId) }) : A.actorNone; }
  function subjectText(e) { return (SUBJECT[e.subjectType] || e.subjectType) + ' ' + U.shortId(e.subjectId); }
  function resultChip(r) {
    if (r === 'SUCCESS') return U.chip('ready', 'status-ready', A.res.SUCCESS);
    if (r === 'REFUSED') return U.chip('unknown', 'status-warn', A.res.REFUSED);
    if (r === 'FAILED') return U.chip('blocked', 'status-blocked', A.res.FAILED);
    return U.chip('neutral', 'status-info', A.unknownResult({ code: r }));
  }

  function rowHtml(e, selected) {
    var states = e.fromState || e.toState ? '<span class="cs-ev__line">' + esc(stateLabel(e.fromState)) + '<span class="cs-arrow" aria-hidden="true">→</span><span class="ag-sr-only">' + esc(A.fTo) + ' </span>' + esc(stateLabel(e.toState)) + '</span>' : '';
    return '<li><a class="ag-item cs-ev" href="' + U.here({ sel: e.id }) + '" data-sel="' + e.id + '"' + (selected ? ' aria-current="true"' : '') + '>' +
      '<span class="cs-ev__time">' + esc(fmt.clockSec(e.occurredAt)) + '</span><span class="cs-ev__body"><span class="cs-ev__name">' + esc(eventLabel(e.eventType)) + (e.result !== 'SUCCESS' ? ' ' + resultChip(e.result) : '') + '</span>' +
      '<span class="cs-ev__line">' + esc(actorText(e)) + ' · ' + esc(subjectText(e)) + '</span>' + states + '</span></a></li>';
  }
  function groupHtml(list, selId) {
    var out = '', day = null;
    list.forEach(function (e) {
      var k = fmt.dayKey(e.occurredAt);
      if (k !== day) { if (day !== null) out += '</ul>'; out += '<h3 class="cs-day">' + esc(fmt.day(e.occurredAt)) + '</h3><ul class="cs-evs">'; day = k; }
      out += rowHtml(e, e.id === selId);
    });
    return out + (day !== null ? '</ul>' : '');
  }

  function fact(label, v, help) { return '<div><dt>' + esc(label) + '</dt><dd>' + v + (help ? '<p class="ag-help">' + help + '</p>' : '') + '</dd></div>'; }
  function link(href, label) { return '<a class="ag-link" href="' + href + '">' + esc(label) + '</a>'; }
  function detailsHtml(d) {
    var keys = d ? Object.keys(d) : [];
    if (!keys.length) return '<p>' + esc(A.noDetails) + '</p>';
    return '<dl class="cs-kvs">' + keys.map(function (k) { return '<div><dt>' + esc(k) + '</dt><dd>' + esc(typeof d[k] === 'object' ? JSON.stringify(d[k]) : d[k]) + '</dd></div>'; }).join('') + '</dl>';
  }
  function dossierHtml(e) {
    var sp = SUBJECT_PAGE[e.subjectType];
    var subjectLink = sp ? link(sp[1] ? U.url(sp[0], { tab: sp[1], sel: e.subjectId }) : U.url(sp[0], { sel: e.subjectId }), A.openSubject[e.subjectType]) : '';
    var opLinks = e.operationId ? '<div class="cs-links"><div class="cs-linkrow"><span>' + link(U.here({ operationId: e.operationId, sel: null }), A.openOpAudit) + '</span></div><div class="cs-linkrow"><span>' + link(U.url('reservations', { tab: 'operations', sel: e.operationId }), T.rl.openOp) + '</span></div></div>' : '';
    return '<section class="ag-panel ag-dossier" aria-labelledby="dossier-title"><div id="dossier" class="ag-dossier__scroll" tabindex="0" role="group" aria-labelledby="dossier-title">' +
      '<p class="ag-overline">' + esc(A.selected) + '</p><h2 class="ag-dossier__title" id="dossier-title">' + esc(eventLabel(e.eventType)) + '</h2><p class="ag-dossier__sub">' + esc(fmt.full(e.occurredAt)) + '</p>' +
      '<p class="ag-sec-title" style="margin-top:8px"><span class="ag-readonly">' + U.icon('lock') + esc(T.readOnly) + '</span></p>' +
      '<div class="ag-diag ag-diag--none"><div class="ag-diag__row">' + resultChip(e.result) + '</div>' +
      '<p class="ag-diag__lead"><span class="cs-detail-state">' + esc(e.fromState || A.noState) + '</span><span class="cs-arrow" aria-hidden="true">→</span><span class="cs-detail-state">' + esc(e.toState || A.noState) + '</span></p>' +
      '<p class="ag-diag__note">' + esc(stateLabel(e.fromState)) + ' → ' + esc(stateLabel(e.toState)) + U.gap('G5') + '</p></div>' +
      '<section class="cs-sec"><h3 class="ag-overline">' + esc(T.rl.secFacts) + '</h3><dl class="ag-facts cs-factgrid">' +
      fact(A.fTime, esc(fmt.full(e.occurredAt))) + fact(A.fEventType, '<code class="cs-id">' + esc(e.eventType) + '</code>' + U.gap('G5')) +
      fact(A.fActor, e.actor ? esc(A.actorUser({ id: '' })).trim() + ' ' + U.idHtml(e.actor.userId, true) : esc(A.actorNone), esc(A.actorHelp) + U.gap('G4')) +
      fact(A.fSubject, esc(SUBJECT[e.subjectType] || e.subjectType) + ' <code class="cs-id">' + esc(e.subjectType) + '</code><br>' + U.idHtml(e.subjectId, true)) +
      fact(A.fOperation, e.operationId ? U.idHtml(e.operationId, true) : '—') + fact(A.fResult, '<code class="cs-id">' + esc(e.result) + '</code>') +
      fact(A.fReason, e.reason ? '<code class="cs-id">' + esc(e.reason) + '</code>' : '—') + fact(A.fId, U.idHtml(e.id, true)) + '</dl>' +
      '<div class="cs-links">' + (subjectLink ? '<div class="cs-linkrow"><span>' + subjectLink + '</span></div>' : '') + '</div>' + opLinks + '</section>' +
      '<section class="cs-sec"><h3 class="ag-overline">' + esc(A.fDetails) + '</h3>' + detailsHtml(e.details) + '<p class="cs-sec__note">' + esc(A.detailKeys) + U.gap('G4') + '</p></section>' +
      '<section class="cs-sec"><h3 class="ag-overline">' + esc(A.evidenceTitle) + '</h3><div class="cs-callout">' + U.icon('info') + '<div><p>' + esc(A.evidenceMissing) + '</p></div></div></section>' +
      '</div></section>';
  }

  function activeChips() {
    var k = KEYS.filter(function (x) { return F[x]; });
    if (!k.length) return '';
    return '<div class="cs-chips" role="group" aria-label="' + esc(T.activeFilters) + '">' + k.map(function (x) {
      var v = /Id|operationId/.test(x) ? U.shortId(F[x]) : F[x];
      return '<button type="button" class="ag-btn ag-btn--secondary ag-btn--sm" data-unfilter="' + x + '" aria-label="' + esc(T.removeFilter({ label: LABEL[x] + ' ' + v })) + '"><span>' + esc(LABEL[x]) + NB + ': ' + esc(v) + '</span>' + U.icon('close') + '</button>';
    }).join('') + '</div>';
  }
  var NB = ' ';
  function filtersHtml() {
    function inp(k, type) { return '<div class="ag-ff"><label class="ag-ff__label" for="f-' + k + '">' + esc(LABEL[k]) + '</label><input id="f-' + k + '" type="' + (type || 'text') + '" class="ag-ff__control" value="' + esc(F[k]) + '"' + (type === 'date' ? ' aria-describedby="f-help"' : ' autocomplete="off" spellcheck="false"') + '></div>'; }
    var n = KEYS.filter(function (x) { return F[x]; }).length;
    return '<details class="cs-disclosure" id="filter-box"><summary>' + U.icon('chevron') + '<span>' + esc(T.filtersLegend) + '</span><span class="cs-disclosure__count">(' + esc(T.filterCount({ n: n })) + ')</span></summary>' +
      '<form class="cs-filters" id="filters" aria-label="' + esc(T.filtersLegend) + '"><div class="cs-filters__grid">' + inp('from', 'date') + inp('to', 'date') + inp('eventType') + inp('subjectType') + inp('subjectId') + inp('operationId') + inp('actorUserId') + '</div>' +
      '<div class="cs-filters__actions"><button type="submit" class="ag-btn ag-btn--primary ag-btn--sm">' + esc(T.filter) + '</button>' + U.btn(T.clearAll, { size: 'sm', id: 'f-clear' }) + '</div>' +
      '<p class="cs-filters__help" id="f-help">' + esc(T.fPeriodHelp) + ' ' + esc(FX.ZONE) + '.</p></form></details>' + activeChips();
  }

  function render(focusId) {
    var all = events(), shown = all.slice(0, pagesLoaded * LIMIT), hasMore = all.length > shown.length;
    var sel = selectedId ? FX.AUDIT.filter(function (x) { return x.id === selectedId; })[0] : null;
    if (!sel) sel = shown[0] || null;
    var meta = loading ? '' : '<div class="cs-meta">' + (listFail ? '' : '<span class="cs-meta__time">' + esc(T.updatedAt({ time: U.now() })) + '</span>') + U.btn(T.refresh, { size: 'sm', icon: 'refresh', attrs: 'data-retry="' + (S === 'stale' ? 'fail' : 'ok') + '"' }) + '</div>';
    var head = AG.pageHead(T.sections.audit, esc(A.lead), meta, '<p class="cs-sec__note" style="margin-top:6px"><span class="ag-readonly">' + U.icon('lock') + esc(A.immutable) + '</span></p>');
    if (S === 'unauthorized') {
      main.innerHTML = AG.pageHead(T.sections.audit, '', '') + '<p class="ag-sr-only" role="status">' + esc(T.unauthorizedNote) + '</p><div class="cs-gap">' + esc(T.unauthorizedNote) + ' <a href="../../manager-v3/prototype/sign-in.html?state=session-expired&lang=' + AG.lang + '&theme=' + AG.theme + '">' + esc(T.unauthorizedLink) + '</a></div>';
      return;
    }
    var inner = '', foot = '', title = loading || listFail ? T.sections.audit : A.listTitle({ n: shown.length });
    if (loading) inner = U.skeletonRows(4) + '<p class="ag-sr-only" role="status">' + esc(T.loadingList) + '</p>';
    else if (listFail) inner = '<div class="ag-list__alerts">' + U.failure(S, 'audit') + '</div>';
    else if (!all.length) inner = '<div class="ag-list__empty"><p class="ag-list__empty-title">' + esc(A.empty) + '</p><p class="ag-list__empty-body">' + esc(A.emptyBody) + '</p><div class="cs-empty-actions">' + U.btn(T.clearAll, { size: 'sm', id: 'empty-clear' }) + '</div></div>';
    else {
      var bottom = '';
      if (S === 'invalid-cursor') bottom = '<div class="cs-more__alert">' + U.alert('warning', 'status-info', A.invalidCursorTitle, '<p>' + esc(A.invalidCursorBody) + '</p>', { action: U.btn(A.restart, { size: 'sm', attrs: 'data-retry="nominal"' }) }) + '</div>';
      else if (S === 'partial') bottom = '<div class="cs-more__alert">' + U.alert('error', 'status-error', A.nextFailedTitle, '<p>' + esc(A.nextFailedBody) + '</p>', { code: '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30', codeLabel: T.traceIdLabel, action: U.retryBtn() }) + '</div>';
      else if (hasMore) bottom = '<div class="cs-more"><button type="button" class="ag-btn ag-btn--secondary ag-btn--sm" id="more">' + esc(A.loadMore) + '</button><span class="cs-more__text">' + esc(A.moreExist) + '</span></div>';
      else bottom = '<p class="cs-more cs-more__text">' + esc(A.endReached) + '</p>';
      inner = '<div class="ag-list__items cs-evwrap" id="evlist">' + (S === 'stale' ? U.stale() : '') + groupHtml(shown, sel && sel.id) + '</div>' + bottom;
      foot = '<p class="ag-list__foot">' + esc(A.listFoot({ time: U.now() })) + '<span class="cs-zone">' + esc(T.zoneNote({ zone: FX.ZONE })) + '</span></p>';
    }
    var listHtml = '<section class="ag-panel ag-list" aria-labelledby="list-title"' + (loading ? ' aria-busy="true"' : '') + '><div class="ag-list__head"><h2 class="ag-list__title" id="list-title" tabindex="-1">' + esc(title) + '</h2><span class="ag-list__meta">' + esc(A.listMeta) + '</span></div>' + inner + foot + '</section>';
    var showDossier = !listFail && (loading || sel);
    var dossier = !showDossier ? '' : loading ? '<section class="ag-panel ag-dossier" aria-busy="true" aria-label="' + esc(A.selected) + '">' + U.skeletonDossier() + '</section>' : dossierHtml(sel);
    main.innerHTML = head + filtersHtml() + '<div class="ag-eq' + (showDossier ? '' : ' ag-eq--single') + '">' + listHtml + dossier + '</div>';
    var box = document.getElementById('filter-box');
    box.open = Q.get('filters') === '1'; // fermé par défaut : les filtres actifs restent visibles sous forme de puces
    bind(shown);
    if (focusId) { var el = main.querySelector('a[data-sel="' + focusId + '"]'); if (el) el.focus(); }
  }

  function bind(shown) {
    U.wireRetry(main);
    function go(changes) { location.search = U.here(changes).split('?')[1]; }
    document.getElementById('filters').addEventListener('submit', function (e) {
      e.preventDefault();
      var ch = { sel: null, state: S === 'empty' ? null : S };
      KEYS.forEach(function (k) { ch[k] = document.getElementById('f-' + k).value.trim() || null; });
      go(ch);
    });
    function clearAll() { var ch = { sel: null, state: S === 'empty' ? null : S }; KEYS.forEach(function (k) { ch[k] = null; }); go(ch); }
    document.getElementById('f-clear').addEventListener('click', clearAll);
    var ec = document.getElementById('empty-clear'); if (ec) ec.addEventListener('click', clearAll);
    main.querySelectorAll('[data-unfilter]').forEach(function (b) {
      b.addEventListener('click', function () { var ch = { sel: null }; ch[b.getAttribute('data-unfilter')] = null; if (S === 'empty') ch.state = null; go(ch); });
    });
    var more = document.getElementById('more');
    if (more) more.addEventListener('click', function () {
      if (more.getAttribute('aria-disabled') === 'true') return;
      more.setAttribute('aria-disabled', 'true'); more.classList.add('is-busy'); more.insertAdjacentHTML('beforeend', AG.icons.spinner()); more.firstChild.textContent = A.loadingMore;
      window.setTimeout(function () {
        var before = pagesLoaded * LIMIT; pagesLoaded++;
        var added = events().slice(before, pagesLoaded * LIMIT);
        render(added[0] && added[0].id);
        U.announce(A.loadedMore({ n: added.length }));
      }, 600);
    });
    main.querySelectorAll('a[data-sel]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        selectedId = a.getAttribute('data-sel');
        history.replaceState(null, '', a.getAttribute('href'));
        var stacked = window.matchMedia('(max-width: 1023px)').matches;
        render(stacked ? null : selectedId);
        var d = document.getElementById('dossier');
        if (stacked && d) { d.focus(); d.scrollIntoView({ block: 'start' }); }
        U.announce(A.selected);
      });
    });
  }

  render();
  AG.ready();
})();
