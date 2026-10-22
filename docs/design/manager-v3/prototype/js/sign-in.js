/* Prototype de la connexion : états pilotés par ?state=…&lang=…&theme=… (aucun appel réseau). */
(function () {
  var Q = window.AEGIS_PARAMS, LANG = window.AEGIS_LANG, T, I = window.AEGIS_ICONS, B = window.AEGIS_BRAND;
  var $ = function (id) { return document.getElementById(id); };
  var state = Q.get('state') || 'nominal';
  var retry = parseInt(Q.get('retry') || '55', 10);
  var still = Q.has('still');
  var alertMode = Q.get('alert') === 'top' ? 'top' : 'bottom'; // bottom : sous le bouton (aucun saut); top : état validé (décale le formulaire)
  var TRACE = Q.get('trace') || '4bf92f3577b34da6a3ce929d0e0e4736';
  var EMAIL = 'revue@apercu.test';
  var timer = null, deadline = 0, locked = false;

  if (Q.get('signature') === 'off') document.documentElement.setAttribute('data-signature', 'off');
  if (Q.get('notes') === 'off') document.documentElement.setAttribute('data-notes', 'off');
  $('home-icon').innerHTML = I.ui('back');
  $('note-icon').innerHTML = I.ui('info');
  var alertZone = $(alertMode === 'top' ? 'alert-top' : 'alert-bottom');
  var otherZone = $(alertMode === 'top' ? 'alert-bottom' : 'alert-top');
  otherZone.parentNode.removeChild(otherZone);
  alertZone.id = 'alert-zone';

  function applyLang(lang) {
    LANG = lang; T = window.AEGIS_COPY[lang];
    document.documentElement.lang = T.htmlLang; document.documentElement.setAttribute('data-lang', lang);
    document.title = T.signInTitle;
    document.querySelectorAll('[data-i18n]').forEach(function (n) { n.textContent = T[n.getAttribute('data-i18n')]; });
    $('brand').innerHTML = B.link({ size: 30, label: T.brandHomeLabel, app: T.appName });
    $('tagline').textContent = T.tagline;
    $('signature').innerHTML = T.signature[0] + '<br> ' + T.signature[1] + '<br> <span>' + T.signature[2] + '</span>';
    $('description').textContent = T.description;
    $('signature-flag').textContent = '◇ ' + T.signatureFlag;
    document.querySelector('.si__lang').setAttribute('aria-label', T.langLabel);
    document.querySelectorAll('.si__lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
    $('reveal').textContent = $('password').type === 'password' ? T.reveal : T.conceal;
    $('reveal').setAttribute('aria-label', $('password').type === 'password' ? T.revealLabel : T.concealLabel);
    $('submit-label').textContent = $('submit').getAttribute('aria-busy') === 'true' ? T.submitting : T.submit;
    $('submit-icon').innerHTML = $('submit').getAttribute('aria-busy') === 'true' ? '<span class="ag-spinner" aria-hidden="true"></span>' : I.ui('arrow');
    $('role-title').textContent = T.roleHeading;
    $('role-account').textContent = T.roleAccountUsed;
    $('role-retry').innerHTML = '<span>' + T.roleRetry + '</span>' + I.ui('arrow');
  }
  applyLang(LANG);

  function alertHtml(kind, icon, title, body, trace) {
    var role = kind === 'info' ? 'status' : 'alert';
    return '<div class="ag-alert ag-alert--' + kind + ' is-entering" role="' + role + '" id="alert">' + I.status(icon) +
      '<div><p class="ag-alert__title">' + title + '</p>' + (body ? '<p class="ag-alert__body">' + body + '</p>' : '') +
      (trace ? '<dl class="ag-alert__code"><dt>' + T.traceLabel + '</dt><dd id="trace">' + trace + '</dd></dl>' : '') + '</div></div>';
  }
  function setError(field, text) {
    var ctl = $(field + '-control'), err = $(field + '-error'), input = $(field);
    if (text) {
      ctl.setAttribute('data-invalid', ''); err.hidden = false; err.innerHTML = I.status('error') + '<span>' + text + '</span>';
      input.setAttribute('aria-invalid', 'true'); input.setAttribute('aria-describedby', field + '-error');
    } else {
      ctl.removeAttribute('data-invalid'); err.hidden = true; err.innerHTML = '';
      input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby');
    }
  }
  function describePasswordWithAlert(on) {
    var p = $('password'), ids = [];
    if (on) ids.push('alert');
    if (p.getAttribute('aria-invalid') === 'true') ids.push('password-error');
    if (ids.length) p.setAttribute('aria-describedby', ids.join(' ')); else p.removeAttribute('aria-describedby');
  }
  function remainingText(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function setBusy(on) {
    var b = $('submit');
    b.classList.toggle('is-busy', on);
    if (on) { b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-busy', 'true'); }
    else if (!locked) { b.removeAttribute('aria-disabled'); b.removeAttribute('aria-busy'); }
    $('submit-label').textContent = on ? T.submitting : T.submit;
    $('submit-icon').innerHTML = on ? '<span class="ag-spinner" aria-hidden="true"></span>' : I.ui('arrow');
    document.querySelectorAll('.ag-field input').forEach(function (i) { i.readOnly = on; });
    document.querySelectorAll('.ag-field__control').forEach(function (c) { if (on) c.setAttribute('data-readonly', ''); else c.removeAttribute('data-readonly'); });
    $('status').textContent = on ? T.submittingStatus : '';
  }
  function lock(seconds) {
    locked = true; deadline = Date.now() + seconds * 1000;
    var b = $('submit'); b.classList.add('is-locked'); b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-describedby', 'alert hint');
    var h = $('hint'); h.hidden = false;
    function tick() {
      var r = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      h.textContent = T.rateLimitedHint(remainingText(r));
      if (r <= 0) unlock();
    }
    tick();
    if (!still) timer = setInterval(tick, 1000);
    else h.textContent = T.rateLimitedHint(remainingText(seconds));
  }
  function unlock() {
    clearInterval(timer); locked = false;
    var b = $('submit'); b.classList.remove('is-locked'); b.removeAttribute('aria-disabled'); b.removeAttribute('aria-describedby');
    $('hint').hidden = true; $('alert-zone').innerHTML = ''; $('status').textContent = T.rateLimitedReady;
  }

  var current = state;
  function showFormState(name) {
    current = name;
    clearInterval(timer); locked = false;
    $('submit').classList.remove('is-locked'); $('submit').removeAttribute('aria-describedby'); $('hint').hidden = true;
    $('form-view').hidden = false; $('role-view').hidden = true;
    var zone = $('alert-zone'); zone.innerHTML = '';
    setError('email', ''); setError('password', ''); setBusy(false);
    var focus = 'email';
    var email = $('email'), password = $('password');
    switch (name) {
      case 'sending':
        email.value = EMAIL; password.value = 'motdepasse-fictif'; setBusy(true); focus = null; break;
      case 'invalid-credentials':
        email.value = EMAIL; password.value = '';
        zone.innerHTML = alertHtml('error', 'error', T.invalidCredentialsTitle, T.invalidCredentialsBody);
        describePasswordWithAlert(true); focus = 'password'; break;
      case 'validation':
        email.value = 'nom@'; password.value = '';
        setError('email', T.emailInvalid); setError('password', T.passwordRequired); focus = 'email'; break;
      case 'rate-limited':
        email.value = EMAIL; password.value = '';
        zone.innerHTML = alertHtml('warning', 'warningClock', T.rateLimitedTitle, T.rateLimitedBody(retry));
        lock(retry); focus = null; break;
      case 'unreachable':
        email.value = EMAIL; password.value = 'motdepasse-fictif';
        zone.innerHTML = alertHtml('warning', 'warningOffline', T.unreachableTitle, T.unreachableBody); focus = null; break;
      case 'service-error':
        email.value = EMAIL; password.value = 'motdepasse-fictif';
        zone.innerHTML = alertHtml('error', 'error', T.serviceErrorTitle, T.serviceErrorBody, TRACE); focus = null; break;
      case 'session-expired':
        email.value = EMAIL; password.value = '';
        zone.innerHTML = alertHtml('info', 'infoClock', T.sessionExpiredTitle, T.sessionExpiredBody);
        describePasswordWithAlert(true); focus = 'password'; break;
      default:
        email.value = ''; password.value = ''; focus = 'email';
    }
    if (name === 'nominal-focus-button') focus = null;
    if (focus && !Q.has('nofocus')) $(focus).focus();
    $('status').textContent = name === 'sending' ? T.submittingStatus : '';
  }

  function showRoleState() {
    current = 'role-unauthorized';
    $('form-view').hidden = true; $('role-view').hidden = false;
    $('role-title').textContent = T.roleHeading;
    $('role-alert').innerHTML = alertHtml('warning', 'warningPerson', T.roleTitle, T.roleBody).replace('id="alert"', 'id="role-alert-box"');
    $('role-account').textContent = T.roleAccountUsed;
    $('role-retry').innerHTML = '<span>' + T.roleRetry + '</span>' + I.ui('arrow');
    $('role-title').focus();
  }

  $('reveal').addEventListener('click', function () {
    var p = $('password'), show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    $('reveal').textContent = show ? T.conceal : T.reveal;
    $('reveal').setAttribute('aria-label', show ? T.concealLabel : T.revealLabel);
  });
  $('role-retry').addEventListener('click', function () { showFormState('nominal'); });
  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (locked || $('submit').getAttribute('aria-busy') === 'true') return;
    var em = $('email').value.trim(), pw = $('password').value;
    var emailErr = !em ? T.emailRequired : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) ? '' : T.emailInvalid);
    var pwErr = pw ? '' : T.passwordRequired;
    setError('email', emailErr); setError('password', pwErr);
    if (emailErr || pwErr) { $(emailErr ? 'email' : 'password').focus(); return; }
    $('alert-zone').innerHTML = ''; setBusy(true);
    setTimeout(function () { showFormState('invalid-credentials'); }, 900); // prototype : pas de serveur
  });

  ['email', 'password'].forEach(function (f) {
    $(f).addEventListener('input', function () { // revalidation à la saisie, après un premier envoi seulement
      if ($(f + '-control').hasAttribute('data-invalid')) {
        var v = $(f).value.trim();
        setError(f, f === 'email' ? (!v ? T.emailRequired : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : T.emailInvalid)) : (v ? '' : T.passwordRequired));
      }
    });
  });
  document.querySelectorAll('.si__lang button').forEach(function (b) {
    b.addEventListener('click', function () {
      var q = new URLSearchParams(location.search); q.set('lang', b.dataset.lang);
      history.replaceState(null, '', '?' + q.toString());
      clearInterval(timer); locked = false; $('submit').classList.remove('is-locked'); $('submit').removeAttribute('aria-disabled'); $('hint').hidden = true;
      applyLang(b.dataset.lang);
      var keep = Q.has('nofocus'); if (!keep) Q.append('nofocus', '1');
      if (current === 'role-unauthorized') showRoleState(); else showFormState(current);
      b.focus();
    });
  });

  if (state === 'role-unauthorized') showRoleState(); else showFormState(state);
  window.AEGIS_TEST = { show: function (n) { if (n === 'role-unauthorized') showRoleState(); else showFormState(n); } };
  document.body.setAttribute('data-ready', state);
})();
