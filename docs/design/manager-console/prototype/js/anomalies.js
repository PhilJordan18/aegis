/* Anomalies (#52) : liste et dossier (H2), reconnaissance documentée.
   Aucun bouton « Résoudre » : seule une nouvelle observation du casier résout (09 §18.2, §25). Reconnaître n'est pas résoudre.
   Fixtures : voir fixtures.js. Le détail `evidence` n'a pas de forme définie (G2) : il n'est pas inventé. */
(function () {
  var AG = window.AG, T = AG.t, U = AG.ui, FX = AG.fx, esc = U.esc, fmt = U.fmt, S = AG.state, A = T.an, Q = AG.q;
  var STATES = ['nominal', 'loading', 'empty', 'partial', 'stale', 'unavailable', 'unreachable', 'service-error', 'forbidden', 'unauthorized', 'detail-404', 'join-failed', 'ack-resolved', 'ack-not-acknowledgeable', 'ack-validation', 'ack-unreachable'];
  var main = AG.mountShell({ current: 'anomalies', states: STATES });
  var SEV = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  var TYPES = Object.keys(A.types);

  var data = FX.ANOMALIES.map(function (a) { return Object.assign({}, a); });
  var selectedId = Q.get('sel');
  var hasStatusParam = Q.has('status');
  var F = { status: hasStatusParam ? (Q.get('status') === 'ALL' ? '' : Q.get('status')) : (selectedId ? '' : 'OPEN'), severity: Q.get('severity') || '', type: Q.get('type') || '' };
  if (S === 'empty' && !Q.has('severity') && !hasStatusParam) { F.severity = 'LOW'; F.status = 'OPEN'; }
  if (S === 'detail-404' && !selectedId) selectedId = FX.uid('inconnu');
  var listFail = { unavailable: 1, unreachable: 1, 'service-error': 1, forbidden: 1 }[S];
  var loading = S === 'loading';
  var banner = ''; // « résolue pendant la lecture » / « reconnue »

  function rows() {
    return data.filter(function (a) { return (!F.status || a.status === F.status) && (!F.severity || a.severity === F.severity) && (!F.type || a.type === F.type); })
      .sort(function (a, b) { return a.detectedAt < b.detectedAt ? 1 : a.detectedAt > b.detectedAt ? -1 : a.id < b.id ? 1 : -1; });
  }
  function where(a) {
    var asset = U.join.asset(a.assetId), cell = U.join.cell(a.compartmentId);
    return { asset: asset, cell: cell, text: [cell ? A.cellOnly({ cell: cell.code }) : A.cellIdOnly, a.assetId ? (asset ? U.assetText(asset) : A.assetIdOnly) : null].filter(Boolean).join(' · ') };
  }
  function rowHtml(a, selected) {
    return '<li><a class="ag-item" href="' + U.here({ sel: a.id }) + '" data-sel="' + a.id + '"' + (selected ? ' aria-current="true"' : '') + '>' +
      '<span class="ag-item__chips">' + U.chips.severity(a.severity) + U.chips.anomaly(a.status) + '</span>' +
      '<span class="ag-item__title">' + esc(A.types[a.type] || A.unknownType) + '</span>' +
      '<span class="ag-item__facts">' + esc(where(a).text) + '</span><span class="ag-item__facts">' + esc(A.detected({ time: U.when(a.detectedAt) })) + '</span></a></li>';
  }
  function sec(title, inner, note) { return '<section class="cs-sec"><h3 class="ag-overline">' + esc(title) + '</h3>' + inner + (note ? '<p class="cs-sec__note">' + note + '</p>' : '') + '</section>'; }
  function fact(label, v, help) { return '<div><dt>' + esc(label) + '</dt><dd>' + v + (help ? '<p class="ag-help">' + help + '</p>' : '') + '</dd></div>'; }
  function link(href, label) { return '<a class="ag-link" href="' + href + '">' + esc(label) + '</a>'; }

  function dossierHtml(a) {
    var w = where(a), op = a.lockerOperationId ? FX.opById(a.lockerOperationId) : null;
    var lead = a.status === 'OPEN' ? A.notAcked : a.status === 'ACKNOWLEDGED' ? A.ackedState : A.resolvedAt({ time: fmt.time(a.resolvedAt) });
    var tone = a.status === 'OPEN' ? 'anomaly' : a.status === 'ACKNOWLEDGED' ? 'info' : 'none';
    var actions = a.status === 'OPEN' && S !== 'loading' ?
      '<div class="ag-dossier__actions" role="group" aria-label="' + esc(A.secAck) + '">' + U.btn(A.ackAction, { variant: 'primary', size: 'sm', id: 'ack-open', attrs: 'aria-haspopup="dialog"' }) + '<span class="ag-help">' + esc(A.ackActionHelp) + '</span></div>' : '';
    var joinNote = (a.assetId && !w.asset) || (a.compartmentId && !w.cell) ? '<div style="margin-top:14px">' + U.alert('warning', 'status-offline', A.joinFailedTitle, '<p>' + esc(A.joinFailedBody) + '</p>', { action: U.retryBtn() }) + '</div>' : '';
    var evidence = S === 'partial'
      ? U.alert('error', 'status-error', A.detailPartialTitle, '<p>' + esc(A.detailPartialBody) + '</p>', { code: '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30', codeLabel: T.traceIdLabel, action: U.retryBtn() })
      : '<div class="cs-gap"><strong>' + esc(A.evidenceGapTitle) + '</strong> ' + U.gap('G2') + '<br>' + esc(A.evidenceGapBody) + '</div>';
    var ackSec = a.acknowledgedAt
      ? '<p>' + esc(A.ackBy({ name: a.acknowledgedBy ? a.acknowledgedBy.displayName : '—', time: fmt.time(a.acknowledgedAt) })) + '</p><p class="cs-sec__note">' + esc(A.ackNote) + '</p><blockquote class="cs-quote">' + esc(a.acknowledgementNote || '') + '</blockquote>'
      : '<p>' + esc(A.notAcked) + '</p>';
    var resSec = a.status === 'RESOLVED'
      ? '<p>' + esc(A.resolvedAt({ time: fmt.time(a.resolvedAt) })) + '</p><dl class="ag-facts">' + fact(A.resEvidence, U.idHtml(a.resolutionEvidenceObservationId, true), esc(A.evidenceGapTitle)) + '</dl>' +
        '<p class="cs-sec__note">' + esc(A.resNote) + U.gap('G9') + '</p><blockquote class="cs-quote">' + esc(a.resolutionNote || '') + '<span class="cs-quote__src">' + esc(A.resNoteSrc) + '</span></blockquote>'
      : '<p>' + esc(A.notResolved) + '</p>';
    return '<section class="ag-panel ag-dossier" aria-labelledby="dossier-title"><div id="dossier" class="ag-dossier__scroll" tabindex="0" role="group" aria-labelledby="dossier-title">' +
      (banner || '') +
      '<p class="ag-overline">' + esc(A.selected) + '</p><h2 class="ag-dossier__title" id="dossier-title">' + esc(A.types[a.type] || A.unknownType) + '</h2><p class="ag-dossier__sub">' + esc(w.text) + '</p>' +
      '<div class="ag-diag ag-diag--' + tone + '"><div class="ag-diag__row">' + U.chips.severity(a.severity) + U.chips.anomaly(a.status) + '</div><p class="ag-diag__lead">' + esc(lead) + '</p></div>' + actions + joinNote +
      sec(A.secSummary, '<blockquote class="cs-quote">' + esc(a.summary) + '<span class="cs-quote__src">' + esc(A.summarySrc) + '</span></blockquote>') +
      sec(A.secWhere, '<dl class="ag-facts cs-factgrid">' + fact(A.fCell, w.cell ? esc(w.cell.code) : esc(A.cellIdOnly) + (a.compartmentId ? '<br>' + U.idHtml(a.compartmentId, true) : '')) +
        fact(A.fAsset, a.assetId ? (w.asset ? U.assetTitle(w.asset) : esc(A.assetIdOnly) + U.gap('G3') + '<br>' + U.idHtml(a.assetId, true)) : '—') + fact(A.fDetected, esc(fmt.time(a.detectedAt))) + fact(A.fType, esc(A.types[a.type] || A.unknownType)) + '</dl>') +
      sec(A.secEvidence, evidence) +
      sec(A.secOp, '<div class="cs-links"><div class="cs-linkrow"><span class="cs-linkrow__label">' + esc(op ? T.rl.type[op.type] : A.secOp) + '</span><span>' +
        (a.lockerOperationId ? (op ? U.chips.op(op.status) + ' ' : '') + link(U.url('reservations', { tab: 'operations', sel: a.lockerOperationId }), A.openOp) + ' ' + U.idHtml(a.lockerOperationId) : esc(A.noOp)) + '</span></div></div>', esc(A.openLoan)) +
      sec(A.secAck, ackSec) + sec(A.secRes, resSec) +
      sec(T.sections.audit, '<div class="cs-links"><div class="cs-linkrow"><span>' + link(U.url('audit', { subjectId: a.id }), A.openAudit) + '</span></div></div>') +
      '</div></section>';
  }

  function filtersHtml() {
    function opt(v, label, cur) { return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>'; }
    var st = opt('', T.all, F.status) + opt('OPEN', A.sOpen, F.status) + opt('ACKNOWLEDGED', A.sAck, F.status) + opt('RESOLVED', A.sRes, F.status);
    var sv = opt('', T.all, F.severity) + ['HIGH', 'MEDIUM', 'LOW'].map(function (s) { return opt(s, A.sev[s], F.severity); }).join('');
    var ty = opt('', T.all, F.type) + TYPES.map(function (t) { return opt(t, A.types[t], F.type); }).join('');
    function field(id, label, options) { return '<div class="ag-ff"><label class="ag-ff__label" for="' + id + '">' + esc(label) + '</label><select id="' + id + '" class="ag-ff__control ag-ff__control--select">' + options + '</select></div>'; }
    return '<form class="cs-filters" id="filters" aria-label="' + esc(T.filtersLegend) + '"><div class="cs-filters__grid">' + field('f-status', A.fStatus, st) + field('f-severity', A.fSeverity, sv) + field('f-type', A.fType, ty) + '</div>' +
      '<div class="cs-filters__actions"><button type="submit" class="ag-btn ag-btn--primary ag-btn--sm">' + esc(T.filter) + '</button>' + U.btn(T.clearAll, { size: 'sm', id: 'f-clear' }) + '</div></form>';
  }

  /* ---------- dialogue ---------- */
  function graphemes(s) { return typeof Intl !== 'undefined' && Intl.Segmenter ? Array.from(new Intl.Segmenter(AG.lang, { granularity: 'grapheme' }).segment(s)).length : Array.from(s).length; }
  function dialogHtml(a) {
    var D = A.dlg;
    return '<dialog class="ag-dialog ag-dialog--md" id="ack" aria-labelledby="ack-title" aria-describedby="ack-desc" tabindex="-1"><div class="ag-dialog__panel">' +
      '<div class="ag-dialog__head"><h2 id="ack-title" class="ag-dialog__title">' + esc(D.title) + '</h2><button type="button" class="ag-icon-button" id="ack-x" aria-label="' + esc(D.close) + '">' + U.icon('close') + '</button></div>' +
      '<div id="ack-desc" class="ag-dialog__description"><p>' + esc(A.types[a.type] || '') + ' · ' + esc(where(a).text) + '</p><p>' + esc(D.description) + '</p></div>' +
      '<form class="ag-dialog__form" id="ack-form" novalidate><div class="ag-dialog__body">' +
      '<div class="ag-dialog__alert" id="ack-alert" tabindex="-1"></div>' +
      '<div class="ag-ff"><label class="ag-ff__label" for="ack-note">' + esc(D.label) + '</label><p class="ag-ff__help" id="ack-help">' + esc(D.help) + U.gap('G9') + '</p>' +
      '<textarea id="ack-note" class="ag-ff__control ag-ff__control--area" rows="4" aria-describedby="ack-help ack-count ack-err" data-autofocus></textarea>' +
      '<p class="cs-count" id="ack-count">' + esc(D.counter({ n: 0 })) + '</p><div class="ag-ff__slot" id="ack-err"></div></div></div>' +
      '<div class="ag-dialog__actions"><button type="button" class="ag-btn ag-btn--secondary" id="ack-cancel">' + esc(D.cancel) + '</button><button type="submit" class="ag-btn ag-btn--primary" id="ack-submit">' + esc(D.submit) + '</button></div></form></div></dialog>';
  }
  var opener = null;
  function wireDialog(a) {
    var dlg = document.getElementById('ack'), form = document.getElementById('ack-form'), note = document.getElementById('ack-note'), D = A.dlg;
    var busy = false;
    function close() { if (busy) return; dlg.close(); }
    function setErr(msg) {
      var slot = document.getElementById('ack-err');
      slot.innerHTML = msg ? '<p class="ag-ff__error" id="ack-err-msg">' + U.icon('status-error') + '<span>' + esc(msg) + '</span></p>' : '';
      if (msg) note.setAttribute('aria-invalid', 'true'); else note.removeAttribute('aria-invalid');
    }
    function setAlert(html) { var al = document.getElementById('ack-alert'); al.innerHTML = html; al.style.marginBottom = html ? '12px' : '0'; if (html) al.focus(); }
    note.addEventListener('input', function () {
      var n = graphemes(note.value), c = document.getElementById('ack-count');
      c.textContent = D.counter({ n: n }); c.classList.toggle('cs-count--over', n > 500);
      if (n <= 500 && note.value.trim()) setErr('');
    });
    document.getElementById('ack-cancel').addEventListener('click', close);
    document.getElementById('ack-x').addEventListener('click', close);
    dlg.addEventListener('cancel', function (e) { if (busy) e.preventDefault(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    dlg.addEventListener('close', function () { if (opener && opener.isConnected) opener.focus(); else document.getElementById('contenu').focus(); });
    dlg.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var f = Array.prototype.slice.call(dlg.querySelectorAll('button, textarea, [tabindex]:not([tabindex="-1"])')).filter(function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === dlg)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (busy) return;
      setAlert('');
      var n = graphemes(note.value);
      if (!note.value.trim()) { setErr(D.errEmpty); note.focus(); return; }
      if (n > 500) { setErr(D.errLong); note.focus(); return; }
      setErr('');
      busy = true; dlg.setAttribute('aria-busy', 'true');
      var sb = document.getElementById('ack-submit'); sb.setAttribute('aria-disabled', 'true'); sb.classList.add('is-busy'); sb.insertAdjacentHTML('beforeend', AG.icons.spinner()); note.readOnly = true;
      window.setTimeout(function () {
        busy = false; dlg.removeAttribute('aria-busy'); sb.removeAttribute('aria-disabled'); sb.classList.remove('is-busy'); var sp = sb.querySelector('.ag-spinner'); if (sp) sp.remove(); note.readOnly = false;
        if (S === 'ack-validation') { setErr(D.errServer); note.focus(); return; }
        if (S === 'ack-unreachable') { setAlert(U.alert('warning', 'status-offline', D.unreachableTitle, '<p>' + esc(D.unreachableBody) + '</p>')); return; }
        if (S === 'ack-resolved' || S === 'ack-not-acknowledgeable') {
          var resolved = S === 'ack-resolved';
          setAlert(U.alert(resolved ? 'error' : 'warning', resolved ? 'status-error' : 'status-info', resolved ? D.resolvedTitle : D.notAckTitle, '<p>' + esc(resolved ? D.resolvedBody : D.notAckBody) + '</p>', { code: resolved ? '409 ANOMALY_ALREADY_RESOLVED' : '409 ANOMALY_NOT_ACKNOWLEDGEABLE', action: U.btn(D.refreshClose, { size: 'sm', id: 'ack-refresh' }) }));
          document.getElementById('ack-refresh').addEventListener('click', function () {
            if (resolved) { a.status = 'RESOLVED'; a.resolvedAt = FX.L(11, '14:12:55'); a.resolutionNote = null; banner = U.alert('info', 'status-info', A.resolvedMeanwhileTitle, '<p>' + esc(A.resolvedMeanwhileBody) + '</p>'); }
            dlg.close(); render(); U.announce(resolved ? A.resolvedMeanwhileTitle : D.notAckTitle);
          });
          return;
        }
        // 200 : AnomalyView au statut ACKNOWLEDGED
        a.status = 'ACKNOWLEDGED'; a.acknowledgedAt = FX.NOW; a.acknowledgedBy = FX.ADMIN; a.acknowledgementNote = note.value.trim();
        banner = U.alert('info', 'status-info', A.ackedOk, '');
        dlg.close(); render(); U.announce(A.ackedOk);
        var d = document.getElementById('dossier'); if (d) d.focus();
      }, 800);
    });
  }
  function openDialog(a, prefill) {
    var host = document.getElementById('dialog-host');
    host.innerHTML = dialogHtml(a);
    opener = document.getElementById('ack-open');
    wireDialog(a);
    var dlg = document.getElementById('ack');
    dlg.showModal();
    var note = document.getElementById('ack-note');
    if (prefill) { note.value = prefill; note.dispatchEvent(new Event('input')); }
    note.focus();
  }

  /* ---------- page ---------- */
  function render() {
    var all = rows(), total = all.length;
    var sel = selectedId ? data.filter(function (x) { return x.id === selectedId; })[0] : null;
    if (!sel && S !== 'detail-404') sel = all[0] || null;
    var meta = loading ? '' : '<div class="cs-meta">' + (listFail ? '' : '<span class="cs-meta__time">' + esc(T.updatedAt({ time: U.now() })) + '</span>') + U.btn(T.refresh, { size: 'sm', icon: 'refresh', attrs: 'data-retry="' + (S === 'stale' ? 'fail' : 'ok') + '"' }) + '</div>';
    var head = AG.pageHead(T.sections.anomalies, esc(A.lead), meta);
    if (S === 'unauthorized') {
      main.innerHTML = AG.pageHead(T.sections.anomalies, '', '') + '<p class="ag-sr-only" role="status">' + esc(T.unauthorizedNote) + '</p><div class="cs-gap">' + esc(T.unauthorizedNote) + ' <a href="../../manager-v3/prototype/sign-in.html?state=session-expired&lang=' + AG.lang + '&theme=' + AG.theme + '">' + esc(T.unauthorizedLink) + '</a></div>';
      return;
    }
    var reminder = U.callout('info', 'info', '<p><strong>' + esc(A.reminder) + '</strong> ' + esc(A.reminderB) + '</p>', 'cs-reminder');
    var inner, foot = '', title = loading || listFail ? T.sections.anomalies : A.title({ n: total });
    if (loading) inner = U.skeletonRows(3) + '<p class="ag-sr-only" role="status">' + esc(T.loadingList) + '</p>';
    else if (listFail) inner = '<div class="ag-list__alerts">' + U.failure(S, 'anomalies') + '</div>';
    else if (!total) inner = '<div class="ag-list__empty"><p class="ag-list__empty-title">' + esc(A.empty) + '</p><p class="ag-list__empty-body">' + esc(A.emptyBody) + '</p><div class="cs-empty-actions">' + U.btn(T.clearAll, { size: 'sm', id: 'empty-clear' }) + '</div></div>';
    else {
      inner = (S === 'stale' ? '<div class="ag-list__alerts">' + U.stale() + '</div>' : '') + '<ul class="ag-list__items">' + all.map(function (x) { return rowHtml(x, sel && x.id === sel.id); }).join('') + '</ul>';
      foot = '<p class="ag-list__foot">' + esc(A.listFoot({ time: U.now() })) + '<span class="cs-zone">' + esc(T.zoneNote({ zone: FX.ZONE })) + '</span></p>';
    }
    var listHtml = '<section class="ag-panel ag-list" aria-labelledby="list-title"' + (loading ? ' aria-busy="true"' : '') + '><div class="ag-list__head"><h2 class="ag-list__title" id="list-title" tabindex="-1">' + esc(title) + '</h2><span class="ag-list__meta">' + esc(A.listMeta) + '</span></div>' + inner + foot + '</section>';
    var showDossier = !listFail && (loading || S === 'detail-404' || sel);
    var dossier = '';
    if (showDossier) {
      if (loading) dossier = '<section class="ag-panel ag-dossier" aria-busy="true" aria-label="' + esc(A.selected) + '">' + U.skeletonDossier() + '</section>';
      else if (S === 'detail-404') dossier = '<section class="ag-panel ag-dossier" aria-label="' + esc(A.selected) + '"><div class="ag-dossier__alert" tabindex="-1">' + U.failure('not-found', 'anomalies', { back: true }) + '</div></section>';
      else dossier = dossierHtml(sel);
    }
    main.innerHTML = head + reminder + filtersHtml() + '<div class="ag-eq' + (showDossier ? '' : ' ag-eq--single') + '">' + listHtml + dossier + '</div><div id="dialog-host"></div>';
    bind(sel);
  }
  function val(id) { return document.getElementById(id).value; }
  function bind(sel) {
    U.wireRetry(main);
    document.getElementById('filters').addEventListener('submit', function (e) {
      e.preventDefault();
      location.search = U.here({ status: val('f-status') || 'ALL', severity: val('f-severity') || null, type: val('f-type') || null, sel: null }).split('?')[1];
    });
    function clearAll() { location.search = U.here({ status: 'ALL', severity: null, type: null, sel: null, state: S === 'empty' ? null : S }).split('?')[1]; }
    document.getElementById('f-clear').addEventListener('click', clearAll);
    var ec = document.getElementById('empty-clear'); if (ec) ec.addEventListener('click', clearAll);
    var back = main.querySelector('[data-back]'); if (back) back.addEventListener('click', function () { location.search = U.here({ sel: null, state: null }).split('?')[1]; });
    main.querySelectorAll('a[data-sel]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        selectedId = a.getAttribute('data-sel'); banner = '';
        history.replaceState(null, '', a.getAttribute('href'));
        var stacked = window.matchMedia('(max-width: 1023px)').matches;
        render();
        var item = main.querySelector('a[data-sel="' + selectedId + '"]'), d = document.getElementById('dossier');
        if (stacked && d) { d.focus(); d.scrollIntoView({ block: 'start' }); } else if (item) item.focus();
        U.announce(A.selected);
      });
    });
    var ob = document.getElementById('ack-open');
    if (ob && sel) ob.addEventListener('click', function () { openDialog(sel); });
  }

  render();
  if (Q.get('dialog') === '1' && !listFail && !loading && S !== 'unauthorized' && S !== 'detail-404') {
    var target = data.filter(function (x) { return x.status === 'OPEN'; })[0];
    if (target) { selectedId = target.id; render(); openDialog(target, Q.get('note') || ''); }
  }
  AG.ready();
})();
