/* Réservations et prêts (#48) : onglets Réservations, Prêts, Opérations physiques (U5); liste maîtresse et dossier (H2).
   Lecture seule : aucune fin de prêt, confirmation, retour forcé ni ouverture à distance (09 §17, §25). `availableActions` n'est jamais affiché.
   Un prêt n'est jamais déduit d'une réservation : le lien passe par une opération qui porte les deux identifiants (G8). */
(function () {
  var AG = window.AG, T = AG.t, U = AG.ui, FX = AG.fx, esc = U.esc, fmt = U.fmt, S = AG.state, R = T.rl, Q = AG.q;
  var STATES = ['nominal', 'loading', 'empty', 'partial', 'stale', 'unavailable', 'unreachable', 'service-error', 'forbidden', 'unauthorized', 'detail-404', 'join-failed'];
  var main = AG.mountShell({ current: 'reservations', states: STATES });

  var TAB = Q.get('tab'); if (['reservations', 'loans', 'operations'].indexOf(TAB) < 0) TAB = S === 'join-failed' ? 'operations' : 'reservations';
  var SIZE = Math.max(1, parseInt(Q.get('size') || '20', 10) || 20);
  var PAGE = Math.max(1, parseInt(Q.get('page') || '1', 10) || 1);
  var STATUS_LIST = {
    reservations: ['ACTIVE', 'FULFILLED', 'CANCELLED', 'EXPIRED'],
    loans: ['ACTIVE', 'RETURN_PENDING', 'COMPLETED'],
    operations: ['REQUESTED', 'AWAITING_LOCAL_PROOF', 'AUTHORIZED', 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'OBSERVATION_RECEIVED', 'CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY']
  };
  var DATA = {
    reservations: { items: FX.RESERVATIONS, date: function (r) { return r.createdAt; }, asset: function (r) { return r.asset.id; } },
    loans: { items: FX.LOANS, date: function (l) { return l.checkedOutAt; }, asset: function (l) { return l.asset.id; } },
    operations: { items: FX.OPS, date: function (o) { return o.createdAt; }, asset: function (o) { return o.assetId; } }
  };
  var EMPTY_PRESET = { reservations: { status: 'CANCELLED', asset: FX.ASSETS[0].id }, loans: { status: 'COMPLETED', from: '2026-11-11' }, operations: { status: 'EXPIRED' } };
  var hasFilterParam = ['status', 'asset', 'from', 'to'].some(function (k) { return Q.has(k); });
  var F = {
    status: Q.get('status') || '', asset: Q.get('asset') || '', from: Q.get('from') || '', to: Q.get('to') || ''
  };
  if (S === 'empty' && !hasFilterParam) Object.assign(F, EMPTY_PRESET[TAB]);
  var selectedId = Q.get('sel');
  if (S === 'detail-404' && !selectedId) selectedId = FX.uid('inconnu');

  var listFail = { unavailable: 1, unreachable: 1, 'service-error': 1, forbidden: 1 }[S];
  var loading = S === 'loading';

  function rows() {
    var d = DATA[TAB];
    return d.items.filter(function (x) {
      if (F.status && x.status !== F.status) return false;
      if (F.asset && d.asset(x) !== F.asset) return false;
      var k = fmt.dayKey(d.date(x));
      if (F.from && k < F.from) return false;
      if (F.to && k > F.to) return false;
      return true;
    }).sort(function (a, b) { var x = d.date(a), y = d.date(b); return x < y ? 1 : x > y ? -1 : a.id < b.id ? 1 : -1; });
  }

  /* ---------- libellés ---------- */
  function assetOf(x) { return TAB === 'operations' ? U.join.asset(x.assetId) : x.asset; }
  function holderLine(id, label) { return esc(label) + ' ' + U.idHtml(id); }
  function chipsFor(x) {
    if (TAB === 'reservations') return U.chips.reservation(x.status);
    if (TAB === 'loans') return U.chips.loan(x.status) + (x.overdue ? U.chips.late() : '');
    return U.chips.op(x.status);
  }
  function assetNameHtml(x) { var a = assetOf(x); return a ? U.assetName(a) : esc(R.assetIdOnly) + ' ' + U.idHtml(x.assetId); }

  function rowHtml(x, selected) {
    var title, f1 = '', f2 = '';
    if (TAB === 'reservations') {
      title = assetNameHtml(x);
      f1 = esc(R.fromTo({ from: fmt.short(x.reservedFrom), to: fmt.clock(x.reservedUntil) }));
      f2 = holderLine(x.userId, R.holderLine);
    } else if (TAB === 'loans') {
      title = assetNameHtml(x);
      f1 = x.overdue && x.status !== 'COMPLETED' ? '<span class="cs-late">' + esc(R.lateSince({ time: U.when(x.dueAt) })) + '</span>' : esc(R.dueAt({ time: U.when(x.dueAt) }));
      f1 += ' · ' + esc(R.checkout({ time: fmt.short(x.checkedOutAt) }));
      f2 = holderLine(x.holderUserId, R.holderLine);
    } else {
      var cell = U.join.cell(x.compartmentId);
      title = esc(R.type[x.type]) + ' · ' + assetNameHtml(x);
      f1 = esc(cell ? T.an.cellOnly({ cell: cell.code }) : T.an.cellIdOnly) + ' · ' + esc(fmt.short(x.createdAt));
      f2 = holderLine(x.userId, R.userLine);
    }
    return '<li><a class="ag-item" href="' + U.here({ sel: x.id }) + '" data-sel="' + x.id + '"' + (selected ? ' aria-current="true"' : '') + '>' +
      '<span class="ag-item__chips">' + chipsFor(x) + '</span><span class="ag-item__title">' + title + '</span>' +
      '<span class="ag-item__facts">' + f1 + '</span><span class="ag-item__facts">' + f2 + '</span></a></li>';
  }

  /* ---------- dossier ---------- */
  function link(href, label) { return '<a class="ag-link" href="' + href + '">' + esc(label) + '</a>'; }
  function go(tab, id) { return U.url('reservations', { tab: tab, sel: id }); }
  function sec(title, inner, note) {
    return '<section class="cs-sec"><h3 class="ag-overline">' + esc(title) + '</h3>' + inner + (note ? '<p class="cs-sec__note">' + note + '</p>' : '') + '</section>';
  }
  function fact(label, valueHtml, help) { return '<div><dt>' + esc(label) + '</dt><dd>' + valueHtml + (help ? '<p class="ag-help">' + help + '</p>' : '') + '</dd></div>'; }
  function tl(time, label, kind, sub, fullTime) {
    var t = time ? (fullTime ? fmt.clockSec(time) : fmt.short(time)) : '';
    return { t: time || '', html: '<li class="cs-tl__item' + (kind ? ' cs-tl__item--' + kind : '') + '"><span class="cs-tl__time"' + (t ? '' : ' aria-hidden="true"') + '>' + esc(t) + '</span><span class="cs-tl__dot" aria-hidden="true"></span>' +
      '<span class="cs-tl__label">' + esc(label) + (sub ? '<span class="cs-tl__sub">' + esc(sub) + '</span>' : '') + '</span></li>' };
  }
  function olSorted(items) {
    var dated = items.filter(function (x) { return x.t; }).sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    var undated = items.filter(function (x) { return !x.t; });
    return '<ol class="cs-tl">' + dated.concat(undated).map(function (x) { return x.html; }).join('') + '</ol>';
  }
  function olFixed(items) { return '<ol class="cs-tl cs-seq">' + items.map(function (x) { return x.html; }).join('') + '</ol>'; }
  function placementText(a) { return a && a.placement ? a.placement.lockerCode + ' · ' + R.cell + ' ' + a.placement.compartmentCode : R.noPlacement; }
  function opLinked(label, id, emptyText) {
    var o = id ? FX.opById(id) : null;
    if (!id) return '<div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(label) + '</span><span>' + esc(emptyText) + '</span></div>';
    if (S === 'partial') return '<div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(label) + '</span><span>' + U.idHtml(id) + '</span></div>';
    return '<div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(label) + '</span><span>' + (o ? U.chips.op(o.status) + ' ' : '') + link(go('operations', id), R.openOp) + ' ' + U.idHtml(id) + '</span></div>';
  }
  function partialAlert() {
    return '<div style="margin-top:10px">' + U.alert('error', 'status-error', T.serviceErrorTitle, '<p>' + esc(T.serviceErrorBody) + '</p>', { code: '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30', codeLabel: T.traceIdLabel, action: U.retryBtn() }) + '</div>';
  }
  var ZONE_NOTE = esc(T.zoneNote({ zone: FX.ZONE }));

  function dossierReservation(r) {
    var a = r.asset, op = r.currentOperationId;
    var items = [tl(r.createdAt, R.tl.created, ''), tl(r.reservedFrom, R.tl.from, ''), tl(r.reservedUntil, R.tl.until, 'marker')];
    if (r.fulfilledAt) items.push(tl(r.fulfilledAt, R.tl.fulfilled, 'ok'));
    if (r.cancelledAt) items.push(tl(r.cancelledAt, R.tl.cancelled, ''));
    if (r.expiredAt) items.push(tl(r.expiredAt, R.tl.expired, ''));
    if (r.status === 'ACTIVE') items.push(tl(null, R.tl.activeNow, 'absent'));
    var loanRow = r.status === 'FULFILLED'
      ? '<div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(R.loanLink) + '</span><span>' + esc(R.loanLinkMissing) + U.gap('G8') + ' ' + link(U.url('reservations', { tab: 'operations', asset: a.id }), R.opsOfAsset) + '</span></div>' : '';
    return {
      overline: R.selected.res, title: U.assetTitle(a), sub: [a.model.manufacturer, a.model.modelNumber].filter(Boolean).join(' '),
      block: '<div class="ag-diag ag-diag--' + (r.status === 'ACTIVE' ? 'info' : 'none') + '"><div class="ag-diag__row">' + U.chips.reservation(r.status) + '</div><p class="ag-diag__note">' + esc(R.callRes) + '</p></div>',
      body:
        sec(R.secTimeline, olSorted(items), ZONE_NOTE) +
        sec(R.secFacts, '<dl class="ag-facts cs-factgrid">' + fact(R.fAsset, U.assetTitle(a)) + fact(R.fPlacement, esc(placementText(a))) +
          fact(R.holderField, esc(R.idOnly) + U.gap('G1') + '<br>' + U.idHtml(r.userId, true), esc(R.idOnlyHelp)) + fact(R.fReservationId, U.idHtml(r.id, true)) + '</dl>') +
        sec(R.secOps, '<div class="cs-links">' + opLinked(R.fCurrentOp, op, r.status === 'ACTIVE' ? R.noCurrentOp : R.closedNoOp) + loanRow + '</div>' + (S === 'partial' ? partialAlert() : '')) +
        sec(R.secLinks, '<div class="cs-links"><div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(T.sections.audit) + '</span><span>' + link(U.url('audit', { subjectId: r.id }), R.openAudit) + '</span></div></div>')
    };
  }

  function dossierLoan(l) {
    var a = l.asset, late = l.overdue && l.status !== 'COMPLETED';
    var items = [tl(l.checkedOutAt, R.tl.checkedOut, 'ok'), tl(l.dueAt, R.tl.due, late ? 'terminal-anomaly' : 'marker', late ? R.lateSince({ time: fmt.time(l.dueAt) }) : '')];
    if (l.returnRequestedAt) items.push(tl(l.returnRequestedAt, R.tl.returnRequested, ''));
    items.push(l.returnedAt ? tl(l.returnedAt, R.tl.returned, 'ok') : tl(null, R.tl.notReturned, 'absent'));
    var anomalyId = l.currentOperationId && FX.opById(l.currentOperationId) ? FX.opById(l.currentOperationId).anomalyId : null;
    var diagTone = late ? 'warn' : l.status === 'RETURN_PENDING' ? 'info' : 'none';
    var notes = '<p class="ag-diag__note">' + esc(R.callLoan) + '</p>';
    if (late) notes = '<p class="ag-diag__lead">' + esc(R.callLate) + '</p>' + (l.status === 'RETURN_PENDING' ? '<p class="ag-diag__note">' + esc(R.callReturnPending) + '</p>' : '') + notes;
    else if (l.status === 'RETURN_PENDING') notes = '<p class="ag-diag__lead">' + esc(R.callReturnPending) + '</p>' + notes;
    return {
      overline: R.selected.loan, title: U.assetTitle(a), sub: [a.model.manufacturer, a.model.modelNumber].filter(Boolean).join(' '),
      block: '<div class="ag-diag ag-diag--' + diagTone + '"><div class="ag-diag__row">' + U.chips.loan(l.status) + (late ? U.chips.late() : '') + '</div>' + notes + '</div>',
      body:
        sec(R.secTimeline, olSorted(items), ZONE_NOTE) +
        sec(R.secFacts, '<dl class="ag-facts cs-factgrid">' + fact(R.fAsset, U.assetTitle(a)) + fact(R.fPlacement, esc(placementText(a))) +
          fact(R.holderField, esc(R.idOnly) + U.gap('G1') + '<br>' + U.idHtml(l.holderUserId, true), esc(R.idOnlyHelp)) +
          fact(R.fLate, esc(l.overdue ? R.yes : R.no)) + fact(R.fLoanId, U.idHtml(l.id, true)) + '</dl>') +
        sec(R.secOps, '<div class="cs-links">' + opLinked(R.fCheckoutOp, l.checkoutOperationId, '') + opLinked(R.fReturnOp, l.returnOperationId, R.noReturnOp) + opLinked(R.fCurrentOp, l.currentOperationId, R.noCurrentOp) +
          (S === 'partial' ? '' : '<div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(R.anomalyLinked) + '</span><span>' + (anomalyId ? link(U.url('anomalies', { sel: anomalyId }), R.openAnomaly) : esc(R.noAnomaly)) + '</span></div>') + '</div>' + (S === 'partial' ? partialAlert() : '')) +
        sec(R.secLinks, '<div class="cs-links"><div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(T.sections.audit) + '</span><span>' + link(U.url('audit', { subjectId: l.id }), R.openAudit) + '</span></div></div>')
    };
  }

  function dossierOp(o) {
    var a = U.join.asset(o.assetId), cell = U.join.cell(o.compartmentId), terminal = !!o.terminalAt || ['CONFIRMED', 'FAILED', 'EXPIRED', 'ANOMALY'].indexOf(o.status) >= 0;
    var absent = terminal ? R.seq.notGot : R.seq.notYet;
    function step(time, label, applicable) {
      if (applicable === false) return tl(null, label + ' · ' + R.seq.na, 'absent');
      return time ? tl(time, label, 'ok', R.seq.got, true) : tl(null, label, 'absent', absent);
    }
    var hasChallenge = !!o.localAccessChallengeId;
    var seq = [
      step(o.createdAt, R.seq.created),
      step(o.localProofDisplayedAt, R.seq.displayed, hasChallenge),
      step(o.localProofValidatedAt, R.seq.validated, hasChallenge),
      step(o.authorizedAt, R.seq.authorized),
      step(o.commandSentAt, R.seq.sent),
      step(o.acknowledgedAt, R.seq.acknowledged),
      step(o.doorOpenedAt, R.seq.doorOpened),
      step(o.observationReceivedAt, R.seq.observed),
      step(o.confirmedAt, R.seq.confirmed)
    ];
    if (o.status === 'FAILED') seq.push(tl(o.terminalAt, R.seq.failed, 'terminal-blocked', o.failureReason || ''));
    if (o.status === 'EXPIRED') seq.push(tl(o.terminalAt, R.seq.expired, 'terminal-anomaly'));
    if (o.status === 'ANOMALY') seq.push(tl(o.terminalAt, R.seq.anomaly, 'terminal-anomaly', '', true));
    var anomaly = o.anomalyId ? FX.anomalyById(o.anomalyId) : null;
    var tone = o.status === 'ANOMALY' ? 'anomaly' : o.status === 'CONFIRMED' ? 'none' : o.status === 'FAILED' ? '' : o.status === 'EXPIRED' ? 'warn' : 'info';
    var joinNote = !a || !cell ? '<div style="margin-top:14px">' + U.alert('warning', 'status-offline', R.joinFailedTitle, '<p>' + esc(R.joinFailedBody) + '</p>', { action: U.retryBtn() }) + '</div>' : '';
    return {
      overline: R.selected.op, title: esc(R.type[o.type]) + ' · ' + (a ? U.assetTitle(a) : esc(R.assetIdOnly)), sub: fmt.full(o.createdAt),
      block: '<div class="ag-diag ag-diag--' + tone + '"><div class="ag-diag__row">' + U.chips.op(o.status) + '</div><p class="ag-diag__note">' + esc(R.callOp) + '</p></div>' + joinNote,
      body:
        sec(R.secSequence, olFixed(seq), esc(R.seqNote) + '<br>' + ZONE_NOTE) +
        sec(R.secFacts, '<dl class="ag-facts cs-factgrid">' + fact(R.fAsset, a ? U.assetTitle(a) : esc(R.assetIdOnly) + U.gap('G3') + '<br>' + U.idHtml(o.assetId, true)) +
          fact(R.cell, cell ? esc(cell.code) : esc(R.cellIdOnly) + '<br>' + U.idHtml(o.compartmentId, true)) + fact(R.locker, esc(FX.LOCKER.code)) +
          fact(R.userField, esc(R.idOnly) + U.gap('G1') + '<br>' + U.idHtml(o.userId, true)) +
          fact(R.fRequired, esc(R.requiredAction[o.requiredAction] || o.requiredAction)) + (o.expiresAt ? fact(R.fExpires, esc(fmt.time(o.expiresAt))) : '') + '</dl>') +
        sec(R.secOps, '<div class="cs-links">' +
          '<div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(R.openReservation) + '</span><span>' + (o.reservationId ? link(go('reservations', o.reservationId), R.openReservation) : '—') + '</span></div>' +
          '<div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(R.openLoan) + '</span><span>' + (o.loanId ? link(go('loans', o.loanId), R.openLoan) : '—') + '</span></div>' +
          (S === 'partial' ? '' : '<div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(R.anomalyLinked) + '</span><span>' + (anomaly ? U.chips.anomaly(anomaly.status) + ' ' + link(U.url('anomalies', { sel: anomaly.id }), R.openAnomaly) : esc(R.noAnomaly)) + '</span></div>') + '</div>' + (S === 'partial' ? partialAlert() : '')) +
        sec(R.secTech, '<dl class="cs-kvs"><div><dt>' + esc(R.fOpId) + '</dt><dd>' + esc(o.id) + '</dd></div>' + (o.localAccessChallengeId ? '<div><dt>' + esc(R.fChallenge) + '</dt><dd>' + esc(o.localAccessChallengeId) + '</dd></div>' : '') +
          '<div><dt>' + esc(R.fFailure) + '</dt><dd>' + esc(o.failureReason === null ? 'null' : o.failureReason) + '</dd></div></dl>') +
        sec(R.secLinks, '<div class="cs-links"><div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(T.sections.audit) + '</span><span>' + link(U.url('audit', { operationId: o.id }), R.openAuditOp) + '</span></div></div>')
    };
  }

  function dossierHtml(x) {
    var d = TAB === 'reservations' ? dossierReservation(x) : TAB === 'loans' ? dossierLoan(x) : dossierOp(x);
    return '<section class="ag-panel ag-dossier" aria-labelledby="dossier-title"><div id="dossier" class="ag-dossier__scroll" tabindex="0" role="group" aria-labelledby="dossier-title">' +
      '<p class="ag-overline">' + esc(d.overline) + '</p><h2 class="ag-dossier__title" id="dossier-title">' + d.title + '</h2>' + (d.sub ? '<p class="ag-dossier__sub">' + esc(d.sub) + '</p>' : '') +
      '<p class="ag-sec-title" style="margin-top:8px"><span class="ag-readonly">' + U.icon('lock') + esc(T.readOnly) + '</span></p>' +
      d.block + '<div class="cs-sec-wrap">' + d.body + '</div></div></section>';
  }

  /* ---------- page ---------- */
  function tabsHtml() {
    var t = [['reservations', R.tabReservations], ['loans', R.tabLoans], ['operations', R.tabOps]];
    return '<nav class="ag-tabs" aria-label="' + esc(R.viewsLabel) + '">' + t.map(function (x) {
      var href = U.here({ tab: x[0], sel: null, status: null, asset: null, from: null, to: null, page: null, dialog: null });
      return '<a class="ag-tabs__tab" href="' + href + '"' + (TAB === x[0] ? ' aria-current="page"' : '') + '>' + esc(x[1]) + '</a>';
    }).join('') + '</nav>';
  }
  function filtersHtml() {
    var statusOpts = '<option value="">' + esc(T.allM) + '</option>' + STATUS_LIST[TAB].map(function (s) {
      var label = TAB === 'reservations' ? R.st.reservation[s] : TAB === 'loans' ? R.st.loan[s] : R.st.op[s];
      return '<option value="' + s + '"' + (F.status === s ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    var assetOpts = '<option value="">' + esc(T.allM) + '</option>' + FX.ASSETS.map(function (a) { return '<option value="' + a.id + '"' + (F.asset === a.id ? ' selected' : '') + '>' + esc(U.assetText(a)) + '</option>'; }).join('');
    return '<form class="cs-filters" id="filters" aria-label="' + esc(T.filtersLegend) + '"><div class="cs-filters__grid">' +
      '<div class="ag-ff"><label class="ag-ff__label" for="f-status">' + esc(T.fStatus) + '</label><select id="f-status" class="ag-ff__control ag-ff__control--select">' + statusOpts + '</select></div>' +
      '<div class="ag-ff"><label class="ag-ff__label" for="f-asset">' + esc(T.fAsset) + '</label><select id="f-asset" class="ag-ff__control ag-ff__control--select">' + assetOpts + '</select></div>' +
      '<div class="ag-ff"><label class="ag-ff__label" for="f-from">' + esc(T.fFrom) + '</label><input id="f-from" type="date" class="ag-ff__control" value="' + esc(F.from) + '" aria-describedby="f-help"></div>' +
      '<div class="ag-ff"><label class="ag-ff__label" for="f-to">' + esc(T.fTo) + '</label><input id="f-to" type="date" class="ag-ff__control" value="' + esc(F.to) + '" aria-describedby="f-help"></div></div>' +
      '<div class="cs-filters__actions"><button type="submit" class="ag-btn ag-btn--primary ag-btn--sm">' + esc(T.filter) + '</button>' + U.btn(T.clearAll, { size: 'sm', id: 'f-clear' }) + '</div>' +
      '<p class="cs-filters__help" id="f-help">' + esc(T.fPeriodHelp) + ' ' + esc(FX.ZONE) + '.</p></form>';
  }
  function pagerHtml(total, pages) {
    var first = PAGE <= 1, last = PAGE >= pages;
    return '<nav class="ag-pager" aria-label="' + esc(T.paginationLabel) + '"><button type="button" class="ag-btn ag-btn--secondary ag-btn--sm' + (first ? ' is-inert' : '') + '"' + (first ? ' aria-disabled="true"' : ' data-page="' + (PAGE - 1) + '"') + '>' + esc(T.previous) + '</button>' +
      '<span class="ag-pager__page">' + esc(T.pageOf({ page: PAGE, pages: pages })) + '</span><button type="button" class="ag-btn ag-btn--secondary ag-btn--sm' + (last ? ' is-inert' : '') + '"' + (last ? ' aria-disabled="true"' : ' data-page="' + (PAGE + 1) + '"') + '>' + esc(T.next) + '</button></nav>';
  }
  function titleOf(n) { return TAB === 'reservations' ? R.titleRes({ n: n }) : TAB === 'loans' ? R.titleLoans({ n: n }) : R.titleOps({ n: n }); }

  function render() {
    var all = rows(), total = all.length, pages = Math.max(1, Math.ceil(total / SIZE));
    if (PAGE > pages) PAGE = pages;
    var shown = all.slice((PAGE - 1) * SIZE, PAGE * SIZE);
    // Le dossier est lu par son identifiant (GET /admin/.../{id}), même hors du filtre de la liste.
    var sel = selectedId ? DATA[TAB].items.filter(function (x) { return x.id === selectedId; })[0] : null;
    if (!sel && S !== 'detail-404') sel = shown[0] || null; // aucune sélection, ou identifiant inconnu de cet onglet : premier résultat
    var meta = loading ? '' : '<div class="cs-meta">' + (listFail ? '' : '<span class="cs-meta__time">' + esc(T.updatedAt({ time: U.now() })) + '</span>') + U.btn(T.refresh, { size: 'sm', icon: 'refresh', attrs: 'data-retry="' + (S === 'stale' ? 'fail' : 'ok') + '"' }) + '</div>';
    var head = AG.pageHead(T.sections.reservationsLoans, esc(R.lead), meta, tabsHtml());
    if (S === 'unauthorized') {
      main.innerHTML = AG.pageHead(T.sections.reservationsLoans, '', '') + '<p class="ag-sr-only" role="status">' + esc(T.unauthorizedNote) + '</p><div class="cs-gap">' + esc(T.unauthorizedNote) + ' <a href="../../manager-v3/prototype/sign-in.html?state=session-expired&lang=' + AG.lang + '&theme=' + AG.theme + '">' + esc(T.unauthorizedLink) + '</a></div>';
      return;
    }
    var listInner;
    var titleText = loading ? { reservations: R.tabReservations, loans: R.tabLoans, operations: R.tabOps }[TAB] : listFail ? { reservations: R.tabReservations, loans: R.tabLoans, operations: R.tabOps }[TAB] : titleOf(total);
    var foot = '';
    if (loading) listInner = U.skeletonRows(3) + '<p class="ag-sr-only" role="status">' + esc(T.loadingList) + '</p>';
    else if (listFail) listInner = '<div class="ag-list__alerts">' + U.failure(S, 'reservations') + '</div>';
    else if (!total) listInner = '<div class="ag-list__empty"><p class="ag-list__empty-title">' + esc(R.empty[TAB === 'operations' ? 'ops' : TAB === 'loans' ? 'loans' : 'res']) + '</p><p class="ag-list__empty-body">' + esc(R.emptyBody) + '</p><div class="cs-empty-actions">' + U.btn(T.clearAll, { size: 'sm', id: 'empty-clear' }) + '</div></div>';
    else {
      listInner = (S === 'stale' ? '<div class="ag-list__alerts">' + U.stale() + '</div>' : '') + '<ul class="ag-list__items">' + shown.map(function (x) { return rowHtml(x, sel && x.id === sel.id); }).join('') + '</ul>' + (pages > 1 ? pagerHtml(total, pages) : '');
      foot = '<p class="ag-list__foot">' + esc(R.listFoot({ time: U.now() })) + '<span class="cs-zone">' + esc(T.zoneNote({ zone: FX.ZONE })) + '</span></p>';
    }
    var listHtml = '<section class="ag-panel ag-list" aria-labelledby="list-title"' + (loading ? ' aria-busy="true"' : '') + '><div class="ag-list__head"><h2 class="ag-list__title" id="list-title" tabindex="-1">' + esc(titleText) + '</h2><span class="ag-list__meta">' + esc(R.listMeta) + '</span></div>' + listInner + foot + '</section>';
    var showDossier = !listFail && (loading || sel || S === 'detail-404') && (loading || total > 0 || S === 'detail-404');
    var dossierHtmlStr = '';
    if (showDossier) {
      if (loading) dossierHtmlStr = '<section class="ag-panel ag-dossier" aria-busy="true" aria-label="' + esc(R.selected.res) + '">' + U.skeletonDossier() + '</section>';
      else if (S === 'detail-404') dossierHtmlStr = '<section class="ag-panel ag-dossier" aria-label="' + esc(R.selected.res) + '"><div class="ag-dossier__alert" tabindex="-1">' + U.failure('not-found', 'reservations', { back: true }) + '</div></section>';
      else dossierHtmlStr = dossierHtml(sel);
    }
    main.innerHTML = head + filtersHtml() + '<div class="ag-eq' + (showDossier ? '' : ' ag-eq--single') + '">' + listHtml + dossierHtmlStr + '</div>';
    bind(all);
  }

  function bind(all) {
    U.wireRetry(main);
    var form = document.getElementById('filters');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      location.search = U.here({ status: val('f-status') || null, asset: val('f-asset') || null, from: val('f-from') || null, to: val('f-to') || null, sel: null, page: null }).split('?')[1];
    });
    function clearAll() { location.search = U.here({ status: null, asset: null, from: null, to: null, sel: null, page: null, state: S === 'empty' ? null : S }).split('?')[1]; }
    document.getElementById('f-clear').addEventListener('click', clearAll);
    var ec = document.getElementById('empty-clear'); if (ec) ec.addEventListener('click', clearAll);
    main.querySelectorAll('[data-page]').forEach(function (b) {
      b.addEventListener('click', function () { location.search = U.here({ page: b.getAttribute('data-page'), sel: null }).split('?')[1]; });
    });
    var back = main.querySelector('[data-back]'); if (back) back.addEventListener('click', function () { location.search = U.here({ sel: null, state: null }).split('?')[1]; });
    main.querySelectorAll('a[data-sel]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        selectedId = a.getAttribute('data-sel');
        history.replaceState(null, '', a.getAttribute('href'));
        var stacked = window.matchMedia('(max-width: 1023px)').matches;
        render();
        var item = main.querySelector('a[data-sel="' + selectedId + '"]');
        var dossier = document.getElementById('dossier');
        if (stacked && dossier) { dossier.focus(); dossier.scrollIntoView({ block: 'start' }); } else if (item) item.focus();
        var picked = all.filter(function (x) { return x.id === selectedId; })[0];
        if (picked) U.announce(T.rl.selected[TAB === 'reservations' ? 'res' : TAB === 'loans' ? 'loan' : 'op']);
      });
    });
  }
  function val(id) { return document.getElementById(id).value; }

  render();
  AG.ready();
})();
