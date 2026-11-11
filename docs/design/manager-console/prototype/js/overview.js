/* Vue d'ensemble (#158) : modules prioritaires, sans graphique, sans total calculé sur une page, sans readiness côté client.
   Lectures (09) : anomalies OPEN (§18.1), prêts ACTIVE puis RETURN_PENDING avec `overdue` calculé par le serveur (§17, §8.4),
   réservations ACTIVE (§17), statut du casier (§16.1, §16.2), opérations non terminales dérivées de currentOperationId (G7). */
(function () {
  var AG = window.AG, T = AG.t, U = AG.ui, FX = AG.fx, esc = U.esc, fmt = U.fmt, S = AG.state, O = T.ov;
  var STATES = ['nominal', 'loading', 'all-clear', 'locker-offline', 'locker-unknown', 'partial', 'stale', 'unavailable', 'unreachable', 'service-error', 'forbidden', 'unauthorized'];
  var main = AG.mountShell({ current: 'overview', flow: true, states: STATES });
  var SEV = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  var TERMINAL = { CONFIRMED: 1, FAILED: 1, EXPIRED: 1, ANOMALY: 1 };

  var allFail = { unavailable: 1, unreachable: 1, 'service-error': 1, forbidden: 1 }[S];
  var loading = S === 'loading';
  var clear = S === 'all-clear';

  var anomalies = clear ? [] : FX.ANOMALIES.filter(function (a) { return a.status === 'OPEN'; }).sort(function (a, b) { return (SEV[b.severity] - SEV[a.severity]) || (a.detectedAt < b.detectedAt ? 1 : -1); });
  var overdue = clear ? [] : FX.LOANS.filter(function (l) { return l.overdue && l.status !== 'COMPLETED'; });
  var reservations = FX.RESERVATIONS.filter(function (r) { return r.status === 'ACTIVE'; });
  var opIds = reservations.map(function (r) { return r.currentOperationId; }).concat(FX.LOANS.filter(function (l) { return l.status !== 'COMPLETED'; }).map(function (l) { return l.currentOperationId; }));
  var ops = opIds.filter(Boolean).map(FX.opById).filter(function (o) { return o && !TERMINAL[o.status]; });
  var locker = FX.lockerStatus(S === 'locker-offline');
  if (S === 'locker-unknown') {
    locker.connectionStatus = 'UNKNOWN'; locker.lastSeenAt = null;
    locker.compartments.forEach(function (c) { c.doorState = 'UNKNOWN'; c.lockState = 'UNKNOWN'; c.lastObservedAt = null; });
  }

  function moduleHtml(key, cls, title, countHtml, bodyHtml, footHtml, opts) {
    opts = opts || {};
    return '<section class="ag-panel cs-mod ' + cls + '" aria-labelledby="m-' + key + '"' + (opts.busy ? ' aria-busy="true"' : '') + '>' +
      '<div class="cs-mod__head"><h2 class="cs-mod__title" id="m-' + key + '">' + esc(title) + '</h2>' + (countHtml || '') + '</div>' + bodyHtml + (footHtml || '') + '</section>';
  }
  function count(text, none) { return '<span class="cs-mod__count' + (none ? ' cs-mod__count--none' : '') + '">' + esc(text) + '</span>'; }
  function foot(page, params, label, extra) {
    return '<p class="cs-mod__foot"><a class="ag-link" href="' + U.url(page, params) + '">' + esc(label) + '</a>' + (extra || '') + '</p>';
  }
  function skeleton(title) {
    return '<div class="cs-mod__body" aria-hidden="true"><div class="ag-skel"><span class="ag-skel__bar ag-skel__bar--chip"></span><span class="ag-skel__bar ag-skel__bar--name"></span><span class="ag-skel__bar ag-skel__bar--facts"></span></div></div><p class="ag-sr-only" role="status">' + esc(O.loadingModule({ title: title })) + '</p>';
  }
  function moduleError(kind) { return '<div class="cs-mod__alert">' + U.failure(kind, 'overview') + '</div>'; }

  /* ---- 1. Anomalies ouvertes ---- */
  function anomalyRow(a) {
    var asset = FX.assetById(a.assetId), cell = FX.cellById(a.compartmentId);
    var where = [cell ? T.an.cellOnly({ cell: cell.code }) : T.an.cellIdOnly, asset ? U.assetText(asset) : T.an.assetIdOnly].join(' · ');
    return '<a class="cs-row" href="' + U.url('anomalies', { sel: a.id }) + '"><span class="cs-row__chips">' + U.chips.severity(a.severity) + U.chips.anomaly(a.status) + '</span>' +
      '<span class="cs-row__main">' + esc(T.an.types[a.type] || T.an.unknownType) + '</span>' +
      '<span class="cs-row__meta">' + esc(where) + ' · ' + esc(T.an.detected({ time: U.when(a.detectedAt) })) + '</span></a>';
  }
  function modAnomalies() {
    if (loading) return moduleHtml('anomalies', 'cs-mod--anomalies cs-mod--primary', O.anomalies, '', skeleton(O.anomalies), '', { busy: true });
    var n = anomalies.length;
    return moduleHtml('anomalies', 'cs-mod--anomalies cs-mod--primary', O.anomalies, count(n ? O.countAnomalies({ n: n }) : O.noneAnomalies, !n),
      n ? '<div class="cs-mod__body">' + anomalies.map(anomalyRow).join('') + '</div>' : '',
      foot('anomalies', {}, O.viewAnomalies));
  }

  /* ---- 2. Prêts en retard : le filtre porte sur le booléen `overdue` du serveur, jamais sur l'horloge du client ---- */
  function loanRow(l) {
    return '<a class="cs-row" href="' + U.url('reservations', { tab: 'loans', sel: l.id }) + '"><span class="cs-row__chips">' + U.chips.loan(l.status) + U.chips.late() + '</span>' +
      '<span class="cs-row__main">' + U.assetName(l.asset) + '</span>' +
      '<span class="cs-row__meta"><strong>' + esc(O.lateSince({ time: U.when(l.dueAt) })) + '</strong> · ' + esc(O.holder) + ' ' + U.idHtml(l.holderUserId) + '</span></a>';
  }
  function modLoans(partial) {
    if (loading) return moduleHtml('loans', 'cs-mod--loans', O.loans, '', skeleton(O.loans), '', { busy: true });
    var n = overdue.length;
    var c = partial ? count(O.atLeast({ text: O.countLoans({ n: n }) })) : count(n ? O.countLoans({ n: n }) : O.noneLoans, !n);
    var alert = partial ? '<div class="cs-mod__alert">' + U.alert('warning', 'status-offline', O.partialLoansTitle, '<p>' + esc(O.partialLoansBody) + '</p>', { action: U.retryBtn() }) + '</div>' : '';
    return moduleHtml('loans', 'cs-mod--loans', O.loans, c, (n ? '<div class="cs-mod__body">' + overdue.map(loanRow).join('') + '</div>' : '') + alert,
      foot('reservations', { tab: 'loans' }, O.viewLoans));
  }

  /* ---- 3. Casier ---- */
  function cellRows() {
    return locker.compartments.map(function (c) {
      var admin = FX.ADMIN_LOCKER.compartments.filter(function (x) { return x.id === c.id; })[0];
      return '<tr><th scope="row">' + esc(c.code) + '</th><td data-label="' + esc(O.door) + '">' + esc(T.doorState[c.doorState]) + '</td><td data-label="' + esc(O.lock) + '">' + esc(T.lockState[c.lockState]) + '</td><td data-label="' + esc(O.expectedAsset) + '">' + (admin && admin.currentAsset ? esc(admin.currentAsset.assetCode) : esc(O.noAsset)) + '</td></tr>';
    }).join('');
  }
  function modLocker(failKind) {
    if (loading) return moduleHtml('locker', 'cs-mod--locker', O.locker, '', skeleton(O.locker), '', { busy: true });
    if (failKind) return moduleHtml('locker', 'cs-mod--locker', O.locker, '', moduleError(failKind));
    var w = locker.currentWindow, online = locker.connectionStatus === 'ONLINE';
    var win = w.open ? O.windowOpen({ time: fmt.clock(w.closesAt) }) : O.windowClosed({ time: w.nextOpensAt ? fmt.short(w.nextOpensAt) : null });
    return moduleHtml('locker', 'cs-mod--locker', O.locker, '',
      '<div class="cs-lk cs-lk--wide"><div class="cs-lk__status"><div class="cs-lk__line"><span class="cs-lk__code">' + esc(locker.code) + '</span>' + U.chips.conn(locker.connectionStatus) + '</div>' +
      '<p class="cs-lk__sub ag-tnum">' + esc(locker.lastSeenAt ? O.lastSignal({ time: fmt.clock(locker.lastSeenAt) }) : O.neverSignal) + '</p>' +
      '<p class="cs-lk__sub">' + esc(win) + '</p>' +
      (online ? '' : '<p class="cs-lk__sub">' + esc(O.lastKnown) + '</p>') + '</div>' +
      '<div class="cs-lk__cells"><table class="cs-cells"><caption class="ag-sr-only">' + esc(O.cellsCaption({ code: locker.code })) + '</caption><thead><tr><th scope="col">' + esc(O.cell) + '</th><th scope="col">' + esc(O.door) + '</th><th scope="col">' + esc(O.lock) + '</th><th scope="col">' + esc(O.expectedAsset) + '</th></tr></thead><tbody>' + cellRows() + '</tbody></table>' +
      '<p class="cs-lk__sub">' + esc(O.evaluated({ time: fmt.clock(locker.evaluatedAt) })) + '</p></div></div>', '');
  }

  /* ---- 4. Opération en cours ---- */
  function opRow(o) {
    var asset = FX.assetById(o.assetId), cell = FX.cellById(o.compartmentId);
    return '<a class="cs-row" href="' + U.url('reservations', { tab: 'operations', sel: o.id }) + '"><span class="cs-row__chips">' + U.chips.op(o.status) + '</span>' +
      '<span class="cs-row__main">' + esc(T.rl.type[o.type]) + ' · ' + (asset ? U.assetName(asset) : esc(T.rl.assetIdOnly)) + '</span>' +
      '<span class="cs-row__meta">' + esc(cell ? T.an.cellOnly({ cell: cell.code }) : T.rl.cellIdOnly) + (o.expiresAt ? ' · ' + esc(O.expiresAt({ time: fmt.clock(o.expiresAt) })) : '') + '</span></a>';
  }
  function modOp() {
    if (loading) return moduleHtml('op', 'cs-mod--op', O.operation, '', skeleton(O.operation), '', { busy: true });
    var n = ops.length;
    return moduleHtml('op', 'cs-mod--op', O.operation, count(n ? O.countOp({ n: n }) : O.noneOp, !n),
      (n ? '<div class="cs-mod__body">' + ops.map(opRow).join('') + '</div>' : '') + '<p class="cs-mod__pad cs-lk__sub">' + esc(O.opNote) + U.gap('G7') + '</p>',
      foot('reservations', { tab: 'operations' }, O.viewOps));
  }

  /* ---- 5. Réservations actives ---- */
  function resRow(r) {
    return '<a class="cs-row" href="' + U.url('reservations', { tab: 'reservations', sel: r.id }) + '"><span class="cs-row__chips">' + U.chips.reservation(r.status) + '</span>' +
      '<span class="cs-row__main">' + U.assetName(r.asset) + '</span>' +
      '<span class="cs-row__meta">' + esc(O.untilTime({ time: U.when(r.reservedUntil) })) + ' · ' + esc(O.holder) + ' ' + U.idHtml(r.userId) + '</span></a>';
  }
  function modRes(failKind) {
    if (loading) return moduleHtml('res', 'cs-mod--res', O.reservations, '', skeleton(O.reservations), '', { busy: true });
    if (failKind) return moduleHtml('res', 'cs-mod--res', O.reservations, '', moduleError(failKind));
    var n = reservations.length;
    return moduleHtml('res', 'cs-mod--res', O.reservations, count(n ? O.countRes({ n: n }) : O.noneRes, !n),
      n ? '<div class="cs-mod__body">' + reservations.map(resRow).join('') + '</div>' : '',
      foot('reservations', { tab: 'reservations' }, O.viewReservations));
  }

  /* ---- Page ---- */
  var meta = loading ? '' : '<div class="cs-meta">' + (allFail ? '' : '<span class="cs-meta__time">' + esc(T.updatedAt({ time: U.now() })) + '</span>') + U.btn(T.refresh, { size: 'sm', icon: 'refresh', attrs: 'data-retry="ok"' }) + '</div>';
  var head = AG.pageHead(T.sections.overview, esc(O.lead) + '<br><span class="cs-meta__time">' + esc(T.zoneNote({ zone: FX.ZONE })) + '</span>', meta);
  var body = '';
  if (S === 'unauthorized') {
    main.innerHTML = AG.pageHead(T.sections.overview, '', '') + '<p class="ag-sr-only" role="status">' + esc(T.unauthorizedNote) + '</p>' +
      '<div class="cs-gap">' + esc(T.unauthorizedNote) + ' <a href="../../manager-v3/prototype/sign-in.html?state=session-expired&lang=' + AG.lang + '&theme=' + AG.theme + '">' + esc(T.unauthorizedLink) + '</a></div>';
  } else if (allFail) {
    main.innerHTML = head + '<div class="cs-pageerr">' + U.failure(S, 'overview') + '</div>';
  } else {
    var banner = '';
    if (!loading && locker.connectionStatus === 'OFFLINE') {
      banner = U.alert('warning', 'status-offline', O.lockerOfflineTitle({ code: locker.code }), '<p>' + esc(O.lockerOfflineBody({ time: fmt.clock(locker.lastSeenAt) })) + '</p>');
    } else if (!loading && locker.connectionStatus === 'UNKNOWN') {
      banner = U.alert('warning', 'status-offline', O.lockerUnknownTitle({ code: locker.code }), '<p>' + esc(O.lockerUnknownBody) + '</p>');
    }
    var stale = S === 'stale' ? U.stale() : '';
    var partial = S === 'partial';
    main.innerHTML = head + '<div class="cs-statusline">' + banner + (banner && stale ? '<div style="height:10px"></div>' : '') + stale + '</div>' +
      '<div class="cs-ov">' + modAnomalies() + modLoans(partial) + modLocker(partial ? 'unreachable' : null) + modOp() + modRes(partial ? 'service-error' : null) + '</div>';
    if (!banner && !stale) main.querySelector('.cs-statusline').remove();
  }
  U.wireRetry(main);
  AG.ready();
})();
