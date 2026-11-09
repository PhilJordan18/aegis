/*
 * Mockup behaviour for direction A (#153): language, theme, device composition,
 * scroll-driven step state, failure fallback. Prototype only; the implementation
 * re-creates this in React with the catalog entries listed in handoff.md.
 * Query: ?theme=dark|light  ?lang=fr|en  ?step=1..6  ?motion=reduce  ?device=none
 */
(function () {
  var params = new URLSearchParams(location.search)
  var lang = params.get('lang') === 'en' ? 'en' : 'fr'
  var dark = params.has('theme') ? params.get('theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
  var reduce = params.get('motion') === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches
  var root = document.documentElement
  root.setAttribute('data-theme', dark ? 'dark' : 'light')
  root.lang = lang === 'en' ? 'en-CA' : 'fr-CA'
  if (reduce) root.classList.add('reduce')

  // ---- copy (fr fixes the shape; en mirrors it; names are never translated) ----
  var T = {
    fr: {
      title: 'Aegis Manager',
      skip: 'Aller au contenu principal',
      brandLabel: 'Aegis Manager, accueil',
      sections: 'Sections', signIn: 'Se connecter', lang: 'Langue',
      nav: { produit: 'Produit', readiness: 'Readiness', parcours: 'Parcours', systeme: 'Système', garanties: 'Garanties', studio: 'Studio' },
      heroOver: 'L’essentiel, sous contrôle.',
      h1a: 'Prêt.', h1b: 'Autorisé.', h1c: 'Prouvé.',
      heroDesc: 'Disponibilité, conformité et traçabilité de vos équipements.',
      heroSystem: 'Aegis relie l’application du technicien, l’administration Aegis Manager et un casier connecté. Il est conçu pour qu’un équipement critique ne sorte que s’il est prêt, autorisé et observé.',
      seeJourney: 'Voir le parcours',
      mention: 'Espace administrateur · compte fourni par votre administrateur.',
      stageCaption: 'Casier P0 · un hub avec écran · deux cellules indépendantes',
      stageSource: 'Modèle 3D de Jimmy · rendu fixe',
      heroAlt: 'Le casier Aegis : un module hub avec écran posé sur deux cellules A1 et A2, portes fermées.',
      devFallback: 'Casier Aegis : un hub avec écran, deux cellules A1 et A2. L’image n’a pas pu être chargée.',
      readinessOver: 'Readiness', readinessH: 'Un inventaire peut se tromper. Aegis dit pourquoi.',
      readinessP1: 'Un équipement inscrit comme disponible peut être emprunté, absent de sa cellule, endommagé, non calibré ou interdit à la personne qui le demande. Aegis évalue sa disponibilité opérationnelle pour chaque technicien : prêt, bloqué ou à vérifier, toujours avec la raison.',
      readinessP2: 'Cette readiness est déduite des faits : présence, disponibilité, état de service, calibration, niveau d’accès. Personne ne la coche.',
      diagLabel: 'Exemple de diagnostic', diagHead: 'Diagnostic pour un technicien', mock: 'Exemple illustratif',
      ready: 'Prêt', blocked: 'Bloqué', unknown: 'À vérifier',
      d1name: 'Multimètre 1', d1facts: 'Cellule A1 · présent · calibration valide jusqu’au 30 nov. 2026 · accès standard',
      d2name: 'Multimètre 2', d2reason: 'Calibration expirée depuis le 8 sept. 2026', d2facts: 'Cellule A2 · présent · accès standard · le retour reste possible',
      d3name: 'Caméra thermique', d3reason: 'État physique inconnu : le casier ne répond plus depuis 14 h 02', d3facts: 'Cellule A1 · dernière lecture 13 h 58 HNE',
      journeyOver: 'Parcours', journeyH: 'Six étapes, une seule porte.',
      journeyLead: 'Le casier suit l’étape que vous lisez. Rien ne s’ouvre sur une réservation ni sur un code affiché : seule une commande autorisée, pour une seule cellule, à durée limitée.',
      live: 'Disponible', planned: 'En conception',
      steps: [
        { t: 'Réserver', x: 'Le technicien réserve A1 depuis Aegis Mobile jusqu’à une heure de la plage d’exploitation. Aucune porte ne bouge.', alt: 'Casier fermé, écran en veille.' },
        { t: 'Préparer', x: 'Il prépare le retrait : le hub affichera un QR temporaire lié à son compte et à cette opération.', alt: 'Casier fermé, l’écran du hub affiche un QR temporaire pour le retrait A1.' },
        { t: 'Scanner', x: 'Il scanne le QR avec son téléphone. Le serveur revérifie droits, réservation, horaire et readiness.', alt: 'Casier fermé, l’écran indique que le serveur vérifie.' },
        { t: 'Ouvrir', x: 'Une seule commande, pour A1 seulement, valable deux minutes. Une commande expirée, rejouée ou destinée à une autre cellule n’est pas exécutée.', alt: 'La porte A1 est ouverte, A2 reste fermée; l’écran donne la consigne.' },
        { t: 'Prouver', x: 'Porte refermée, lecture stable du bon tag : le serveur confirmera le retrait et créera le prêt. Jamais par un clic.', alt: 'Portes fermées, le voyant A1 est vert, l’écran confirme le retrait.' },
        { t: 'Retourner', x: 'Même parcours au retour. La readiness sera recalculée; un équipement non prêt peut toujours revenir.', alt: 'Casier fermé, l’écran indique que le retour est enregistré.' }
      ],
      railStep: 'Étape',
      rail: ['portes fermées · écran en veille', 'écran : QR temporaire · retrait A1', 'écran : vérification par le serveur', 'porte A1 ouverte, A2 fermée · écran : consigne', 'portes fermées · voyant A1 · écran : retrait confirmé', 'portes fermées · écran : retour enregistré'],
      zoomLabel: 'Écran du hub, agrandi',
      screen: {
        idle: { over: 'Veille', title: 'A1 · A2', text: 'Réservez depuis Aegis Mobile.', foot: 'Casier en ligne' },
        qr: { over: 'Retrait · A1', title: 'Scannez', text: 'Code à usage unique', foot: '01:58' },
        verify: { over: 'Retrait · A1', title: 'Vérification…', text: 'Droits, réservation, horaire, readiness', foot: 'Serveur' },
        open: { over: 'Retrait · A1', title: 'A1 ouverte', text: 'Prenez MM-001, puis refermez la porte.', foot: '01:21' },
        confirmed: { over: 'Retrait · A1', title: 'Retrait confirmé', text: 'Prêt créé · MM-001', foot: 'Porte fermée · tag lu' },
        result: { over: 'Retour · A1', title: 'Retour enregistré', text: 'Readiness recalculée', foot: 'Merci' }
      },
      systemOver: 'Système', systemH: 'Qui parle à qui.',
      sysAlt: 'Schéma : Aegis Mobile et Aegis Manager parlent en HTTPS à Aegis Control, qui garde PostgreSQL privé et échange en MQTT TLS avec le hub; le hub commande A1 et A2 par un câble dédié chacune.',
      sys: { mobile: 'Aegis Mobile', mobile2: 'Technicien · iPhone', manager: 'Aegis Manager', manager2: 'Administration · Web', control: 'Aegis Control', control2: 'API Spring · seule autorité métier', control3: 'Autorise, corrèle, confirme', db: 'PostgreSQL', db2: 'privé, jamais exposé', broker: 'Broker', broker2: 'MQTT · TLS', hub: 'Hub', hub2: 'Écran · exécute', a1: 'Cellule A1', a2: 'Cellule A2', cable: 'câble dédié' },
      sysN1b: 'Les clients parlent uniquement à l’API.', sysN1: 'Aucun téléphone, aucun navigateur ne touche le casier ni la base.',
      sysN2b: 'Le hub exécute, il n’autorise pas.', sysN2: 'Il affiche le QR, applique une commande autorisée et rapporte ce qu’il observe.',
      sysN3b: 'Une cellule, un câble.', sysN3: 'Deux départs indépendants depuis le hub; les cellules n’ont ni écran, ni Wi-Fi, ni MQTT.',
      sysL1b: 'Aegis Mobile et Aegis Manager', sysL1: 'parlent en HTTPS à Aegis Control, la seule autorité métier.',
      sysL2b: 'Aegis Control', sysL2: 'garde PostgreSQL privé et parle au hub par MQTT sur TLS.',
      sysL3b: 'Le hub', sysL3: 'exécute les commandes autorisées et pilote A1 et A2 par un câble dédié chacune.',
      guarOver: 'Garanties', guarH: 'Cinq règles que le serveur ne négocie pas.',
      guar: [
        ['Disponibilité réelle', 'Chaque équipement indique s’il peut servir; sinon, la raison précise : calibration expirée, maintenance, absence de sa cellule.'],
        ['Retrait conforme', 'Le serveur refuse un retrait non autorisé ou non conforme; l’interface l’explique, elle ne le décide pas.'],
        ['Bonne cellule', 'Seule la cellule attendue s’ouvre, après une autorisation valide. Une réservation ou un code affiché n’ouvre rien.'],
        ['Preuve physique', 'Retrait et retour sont confirmés par des observations cohérentes du casier, jamais par un simple clic.'],
        ['Chaîne de possession', 'Chaque action et chaque observation restent consultables dans l’audit, sans effacement.']
      ],
      studioOver: 'Aegis Studio', studioH: 'Deux personnes, un prototype.',
      studioP: 'Aegis est un prototype académique du cours Écosystème connecté (420-5X7-SO, Cégep de Sorel-Tracy, automne 2026). Le laboratoire est notre terrain de validation; le marché visé est celui des équipes de maintenance, d’inspection et de services techniques.',
      p1role: 'Logiciel : API, Web, iOS, simulateur', p2role: 'Matériel : mécanique, électronique, firmware, modèle 3D',
      statusOver: 'État du prototype · 9 novembre 2026',
      status: [
        ['Intégré', 'Catalogue, readiness par technicien, réservations, statut du casier, firmware de connexion du hub'],
        ['Simulé', 'Présence RFID, commandes et accusés, erreurs de l’appareil : avec le simulateur de hub, sans matériel'],
        ['En conception', 'QR d’accès local, retrait et retour confirmés physiquement, chronologie d’audit'],
        ['Non mesuré', 'Aucune validation physique n’est encore consignée; aucune performance n’est annoncée']
      ],
      foot1: 'Aegis Manager · Administration', foot2: 'Technicien ? Utilisez Aegis Mobile sur iPhone.', foot3: 'Aegis Studio · Philippe et Jimmy'
    },
    en: {
      title: 'Aegis Manager',
      skip: 'Skip to main content',
      brandLabel: 'Aegis Manager, home',
      sections: 'Sections', signIn: 'Sign in', lang: 'Language',
      nav: { produit: 'Product', readiness: 'Readiness', parcours: 'Journey', systeme: 'System', garanties: 'Guarantees', studio: 'Studio' },
      heroOver: 'The essentials, under control.',
      h1a: 'Ready.', h1b: 'Authorized.', h1c: 'Proven.',
      heroDesc: 'Availability, compliance and traceability of your equipment.',
      heroSystem: 'Aegis connects the technician’s app, the Aegis Manager administration and a connected locker. It is built so that a critical item leaves only when it is ready, authorized and observed.',
      seeJourney: 'See the journey',
      mention: 'Administrator area · account provided by your administrator.',
      stageCaption: 'P0 locker · one hub with a screen · two independent compartments',
      stageSource: 'Jimmy’s 3D model · fixed render',
      heroAlt: 'The Aegis locker: a hub module with a screen on top of two compartments A1 and A2, doors closed.',
      devFallback: 'Aegis locker: a hub with a screen, two compartments A1 and A2. The image could not be loaded.',
      readinessOver: 'Readiness', readinessH: 'An inventory can be wrong. Aegis says why.',
      readinessP1: 'An item listed as available may be on loan, missing from its compartment, damaged, uncalibrated or off-limits to the person asking. Aegis assesses its operational readiness for each technician: ready, blocked or to check, always with the reason.',
      readinessP2: 'That readiness is derived from facts: presence, availability, service state, calibration, access level. Nobody ticks it.',
      diagLabel: 'Diagnostic example', diagHead: 'Diagnostic for one technician', mock: 'Illustrative example',
      ready: 'Ready', blocked: 'Blocked', unknown: 'To check',
      d1name: 'Multimeter 1', d1facts: 'Compartment A1 · present · calibration valid until Nov 30, 2026 · standard access',
      d2name: 'Multimeter 2', d2reason: 'Calibration expired on Sep 8, 2026', d2facts: 'Compartment A2 · present · standard access · return remains possible',
      d3name: 'Thermal camera', d3reason: 'Physical state unknown: the locker has not answered since 2:02 p.m.', d3facts: 'Compartment A1 · last reading 1:58 p.m. EST',
      journeyOver: 'Journey', journeyH: 'Six steps, one door.',
      journeyLead: 'The locker follows the step you are reading. Nothing opens on a reservation or a displayed code: only an authorized command, for a single compartment, for a limited time.',
      live: 'Available', planned: 'In design',
      steps: [
        { t: 'Reserve', x: 'The technician reserves A1 from Aegis Mobile up to one hour into the operating window. No door moves.', alt: 'Locker closed, screen on standby.' },
        { t: 'Prepare', x: 'They prepare the pickup: the hub will display a temporary QR tied to their account and to this operation.', alt: 'Locker closed, the hub screen shows a temporary QR for pickup A1.' },
        { t: 'Scan', x: 'They scan the QR with their phone. The server re-checks rights, reservation, schedule and readiness.', alt: 'Locker closed, the screen says the server is verifying.' },
        { t: 'Open', x: 'A single command, for A1 only, valid for two minutes. An expired, replayed or wrong-compartment command is not executed.', alt: 'Door A1 is open, A2 stays closed; the screen gives the instruction.' },
        { t: 'Prove', x: 'Door closed, stable read of the right tag: the server will confirm the pickup and create the loan. Never by a click.', alt: 'Doors closed, the A1 light is green, the screen confirms the pickup.' },
        { t: 'Return', x: 'Same journey on return. Readiness will be recomputed; an item that is not ready can still come back.', alt: 'Locker closed, the screen says the return is recorded.' }
      ],
      railStep: 'Step',
      rail: ['doors closed · screen on standby', 'screen: temporary QR · pickup A1', 'screen: server verification', 'door A1 open, A2 closed · screen: instruction', 'doors closed · A1 light · screen: pickup confirmed', 'doors closed · screen: return recorded'],
      zoomLabel: 'Hub screen, enlarged',
      screen: {
        idle: { over: 'Standby', title: 'A1 · A2', text: 'Reserve from Aegis Mobile.', foot: 'Locker online' },
        qr: { over: 'Pickup · A1', title: 'Scan', text: 'Single-use code', foot: '01:58' },
        verify: { over: 'Pickup · A1', title: 'Verifying…', text: 'Rights, reservation, schedule, readiness', foot: 'Server' },
        open: { over: 'Pickup · A1', title: 'A1 open', text: 'Take MM-001, then close the door.', foot: '01:21' },
        confirmed: { over: 'Pickup · A1', title: 'Pickup confirmed', text: 'Loan created · MM-001', foot: 'Door closed · tag read' },
        result: { over: 'Return · A1', title: 'Return recorded', text: 'Readiness recomputed', foot: 'Thank you' }
      },
      systemOver: 'System', systemH: 'Who talks to whom.',
      sysAlt: 'Diagram: Aegis Mobile and Aegis Manager talk over HTTPS to Aegis Control, which keeps PostgreSQL private and exchanges over MQTT TLS with the hub; the hub drives A1 and A2 through one dedicated cable each.',
      sys: { mobile: 'Aegis Mobile', mobile2: 'Technician · iPhone', manager: 'Aegis Manager', manager2: 'Administration · Web', control: 'Aegis Control', control2: 'Spring API · sole business authority', control3: 'Authorizes, correlates, confirms', db: 'PostgreSQL', db2: 'private, never exposed', broker: 'Broker', broker2: 'MQTT · TLS', hub: 'Hub', hub2: 'Screen · executes', a1: 'Compartment A1', a2: 'Compartment A2', cable: 'dedicated cable' },
      sysN1b: 'Clients talk only to the API.', sysN1: 'No phone and no browser touches the locker or the database.',
      sysN2b: 'The hub executes, it does not authorize.', sysN2: 'It displays the QR, applies an authorized command and reports what it observes.',
      sysN3b: 'One compartment, one cable.', sysN3: 'Two independent runs from the hub; compartments have no screen, no Wi-Fi, no MQTT.',
      sysL1b: 'Aegis Mobile and Aegis Manager', sysL1: 'talk over HTTPS to Aegis Control, the sole business authority.',
      sysL2b: 'Aegis Control', sysL2: 'keeps PostgreSQL private and talks to the hub over MQTT on TLS.',
      sysL3b: 'The hub', sysL3: 'executes authorized commands and drives A1 and A2 through one dedicated cable each.',
      guarOver: 'Guarantees', guarH: 'Five rules the server does not negotiate.',
      guar: [
        ['True readiness', 'Each item shows whether it can be used; if not, the precise reason: expired calibration, maintenance, missing from its compartment.'],
        ['Compliant pickup', 'The server refuses an unauthorized or non-compliant pickup; the interface explains it, it does not decide it.'],
        ['Right compartment', 'Only the expected compartment opens, after a valid authorization. A reservation or a displayed code opens nothing.'],
        ['Physical proof', 'Pickup and return are confirmed by coherent observations from the locker, never by a simple click.'],
        ['Chain of custody', 'Every action and every observation stays available in the audit, without erasure.']
      ],
      studioOver: 'Aegis Studio', studioH: 'Two people, one prototype.',
      studioP: 'Aegis is an academic prototype from the Connected Ecosystem course (420-5X7-SO, Cégep de Sorel-Tracy, fall 2026). The laboratory is our validation ground; the target market is maintenance, inspection and technical service teams.',
      p1role: 'Software: API, Web, iOS, simulator', p2role: 'Hardware: mechanics, electronics, firmware, 3D model',
      statusOver: 'Prototype status · November 9, 2026',
      status: [
        ['Integrated', 'Catalog, per-technician readiness, reservations, locker status, hub connection firmware'],
        ['Simulated', 'RFID presence, commands and acknowledgements, device errors: with the hub simulator, without hardware'],
        ['In design', 'Local access QR, physically confirmed pickup and return, audit timeline'],
        ['Not measured', 'No physical validation is recorded yet; no performance is claimed']
      ],
      foot1: 'Aegis Manager · Administration', foot2: 'Technician? Use Aegis Mobile on iPhone.', foot3: 'Aegis Studio · Philippe and Jimmy'
    }
  }
  var t = T[lang]
  window.AEGIS_T = T

  // ---- apply copy: data-t="key" or data-t="a.b"; data-t-attr="attr:key" ----
  function get(path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k] }, t) }
  document.title = t.title
  document.querySelectorAll('[data-t]').forEach(function (el) { var v = get(el.getAttribute('data-t')); if (v != null) el.textContent = v })
  document.querySelectorAll('[data-t-attr]').forEach(function (el) {
    el.getAttribute('data-t-attr').split(';').forEach(function (pair) { var p = pair.split(':'); var v = get(p[1]); if (v != null) el.setAttribute(p[0], v) })
  })
  document.querySelectorAll('.seg').forEach(function (seg) {
    seg.querySelectorAll('a').forEach(function (a) {
      var l = a.getAttribute('hreflang')
      var q = new URLSearchParams(location.search); q.set('lang', l); a.href = '?' + q.toString()
      if (l === lang) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current')
    })
  })

  // ---- device constants (declared before the lists that use them) ----
  var ASSETS = '../assets/device/'
  var CORNERS = [[606, 798], [813, 822], [816, 998], [611, 970]] // from ../assets/device/screen.json
  var IMG = { W: 2400, H: 2600 }
  function qrMarkup() {
    var n = 21, cells = ''
    function finder(cx, cy) { for (var r = 0; r < 7; r++) for (var c = 0; c < 7; c++) { var ring = r === 0 || r === 6 || c === 0 || c === 6; var core = r >= 2 && r <= 4 && c >= 2 && c <= 4; if (ring || core) cells += '<rect x="' + (cx + c) + '" y="' + (cy + r) + '" width="1" height="1"/>' } }
    finder(0, 0); finder(14, 0); finder(0, 14)
    var seed = 7
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      var inFinder = (r < 8 && c < 8) || (r < 8 && c > 12) || (r > 12 && c < 8)
      if (inFinder) continue
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      if ((seed >> 16) % 100 < 46) cells += '<rect x="' + c + '" y="' + r + '" width="1" height="1"/>'
    }
    return '<svg viewBox="0 0 21 21" aria-hidden="true" shape-rendering="crispEdges">' + cells + '</svg>'
  }
  var QR = qrMarkup()

  // ---- lists built from copy ----
  var STATES = ['idle', 'qr', 'verify', 'open', 'confirmed', 'result']
  var DOORS = { idle: 'closed', qr: 'closed', verify: 'closed', open: 'open-a1', confirmed: 'closed', result: 'closed' }
  var LED = { idle: 'off', qr: 'off', verify: 'off', open: 'off', confirmed: 'a1', result: 'off' }

  var stepsEl = document.getElementById('steps')
  t.steps.forEach(function (s, i) {
    var li = document.createElement('li')
    li.className = 'step'
    li.innerHTML = '<span class="step__num">' + String(i + 1).padStart(2, '0') + '</span>' +
      '<p class="step__title">' + s.t + ' <span class="tag' + (i === 0 ? ' tag--live' : '') + '">' + (i === 0 ? t.live : t.planned) + '</span></p>' +
      '<p class="step__text">' + s.x + '</p>' +
      '<figure class="vignette">' + deviceMarkup(STATES[i], s.alt, true) + '<figcaption>' + t.railStep + ' ' + String(i + 1).padStart(2, '0') + ' · ' + t.rail[i] + '</figcaption></figure>'
    stepsEl.appendChild(li)
  })
  var ledger = document.getElementById('ledger')
  t.guar.forEach(function (g, i) {
    var li = document.createElement('li')
    li.innerHTML = '<span class="ledger__num">' + String(i + 1).padStart(2, '0') + '</span><h3>' + g[0] + '</h3><p>' + g[1] + '</p>'
    ledger.appendChild(li)
  })
  var status = document.getElementById('status')
  t.status.forEach(function (s) {
    var li = document.createElement('li')
    li.innerHTML = '<span>' + s[0] + '</span><span>' + s[1] + '</span>'
    status.appendChild(li)
  })

  function screenMarkup(state) {
    var s = t.screen[state]
    var body = state === 'qr'
      ? '<div class="screen__qr">' + QR + '</div><div><p class="screen__title">' + s.title + '</p><p class="screen__text">' + s.text + '</p></div>'
      : '<p class="screen__title' + (state === 'confirmed' || state === 'result' ? ' screen__ok' : '') + '">' + (state === 'confirmed' ? '<span class="screen__dot"></span>' : '') + s.title + '</p><p class="screen__text">' + s.text + '</p>' + (state === 'verify' ? '<div class="screen__bar"><i></i></div>' : '')
    return '<div class="screen screen--' + state + '" aria-hidden="true"><div class="screen__top"><span class="screen__word">aegis</span><span>' + s.over + '</span></div><div class="screen__body">' + body + '</div><div class="screen__foot"><span>' + s.foot + '</span><span>' + (state === 'idle' ? '' : 'A1') + '</span></div></div>'
  }
  function deviceMarkup(state, alt, withZoom) {
    // journey images load lazily; ?eager=1 lets the render script wait for all of them
    var lazy = withZoom && !params.has('eager') ? ' loading="lazy"' : ''
    var zoom = withZoom ? '<div class="zoom"><p class="zoom__label mono">' + t.zoomLabel + '</p><div class="zoom__card"><div class="screen-box">' + screenMarkup(state) + '</div></div></div>' : ''
    return '<div class="dev' + (withZoom ? ' dev--zoom' : '') + '" data-state="' + state + '" data-doors="' + DOORS[state] + '" data-led="' + LED[state] + '" role="img" aria-label="' + alt.replace(/"/g, '&quot;') + '">' + zoom +
      '<div class="dev__box">' +
      '<img class="dev__img dev__img--closed" src="' + ASSETS + 'casier-ferme.png" alt="" width="2400" height="2600"' + lazy + '>' +
      '<img class="dev__img dev__img--open" src="' + ASSETS + 'casier-a1-ouverte.png" alt="" width="2400" height="2600"' + lazy + '>' +
      '<img class="dev__img dev__img--led" src="' + ASSETS + 'casier-ferme-voyant-a1.png" alt="" width="2400" height="2600"' + lazy + '>' +
      '<div class="dev__screen">' + screenMarkup(state) + '</div>' +
      '<div class="dev__fallback"><svg viewBox="0 0 300 300" aria-hidden="true"><rect x="78" y="20" width="144" height="130" rx="6"/><rect x="96" y="44" width="40" height="30" rx="2" class="scr"/><rect x="6" y="152" width="144" height="130" rx="6"/><rect x="150" y="152" width="144" height="130" rx="6"/></svg><span class="mono">' + t.devFallback + '</span></div>' +
      (withZoom ? '<svg class="zoom__lead" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0"/><circle r="4"/></svg>' : '') +
      '</div></div>'
  }
  document.getElementById('hero-device').innerHTML = deviceMarkup('idle', t.heroAlt, false)
  document.getElementById('journey-device').innerHTML = deviceMarkup('idle', t.steps[0].alt, true)

  // homography from the 300 × 200 screen box to the four image corners, as matrix3d
  function solve(A, b) {
    var n = b.length
    for (var i = 0; i < n; i++) {
      var p = i
      for (var r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r
      var tmp = A[i]; A[i] = A[p]; A[p] = tmp; tmp = b[i]; b[i] = b[p]; b[p] = tmp
      for (var r2 = i + 1; r2 < n; r2++) { var f = A[r2][i] / A[i][i]; for (var c = i; c < n; c++) A[r2][c] -= f * A[i][c]; b[r2] -= f * b[i] }
    }
    var x = new Array(n)
    for (var k = n - 1; k >= 0; k--) { var s = b[k]; for (var c2 = k + 1; c2 < n; c2++) s -= A[k][c2] * x[c2]; x[k] = s / A[k][k] }
    return x
  }
  function matrix3d(dst) {
    var src = [[0, 0], [300, 0], [300, 200], [0, 200]], A = [], b = []
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1]
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u)
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v)
    }
    var h = solve(A, b)
    return 'matrix3d(' + [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, 1].map(function (n) { return n.toFixed(6) }).join(',') + ')'
  }
  function layoutDevice(dev) {
    var box = dev.querySelector('.dev__box')
    var w = box.clientWidth, h = box.clientHeight
    if (!w) return
    // object-fit: contain inside the aspect-ratio box: the image fills the box exactly
    var k = w / IMG.W
    var dst = CORNERS.map(function (c) { return [c[0] * k, c[1] * k] })
    dev.querySelector('.dev__screen').style.transform = matrix3d(dst)
    var lead = dev.querySelector('.zoom__lead'), zoom = dev.querySelector('.zoom')
    if (lead && zoom && getComputedStyle(lead).display !== 'none') {
      var zr = zoom.querySelector('.zoom__card').getBoundingClientRect(), dr = box.getBoundingClientRect()
      var x1 = zr.left - dr.left + zr.width * .5, y1 = zr.top - dr.top + zr.height
      var cx = (dst[0][0] + dst[2][0]) / 2, cy = (dst[0][1] + dst[2][1]) / 2
      lead.setAttribute('width', w); lead.setAttribute('height', h)
      var line = lead.querySelector('line'); line.setAttribute('x1', x1); line.setAttribute('y1', y1); line.setAttribute('x2', cx); line.setAttribute('y2', cy)
      var dot = lead.querySelector('circle'); dot.setAttribute('cx', cx); dot.setAttribute('cy', cy)
    }
  }
  function layoutAll() { document.querySelectorAll('.dev').forEach(layoutDevice) }
  if ('ResizeObserver' in window) { var ro = new ResizeObserver(layoutAll); document.querySelectorAll('.dev__box').forEach(function (d) { ro.observe(d) }) }
  addEventListener('load', layoutAll); layoutAll()

  // failure fallback: any missing render hides the composition and shows the drawn silhouette
  document.querySelectorAll('.dev__img').forEach(function (img) {
    img.addEventListener('error', function () { img.closest('.dev').classList.add('dev--failed') })
    if (params.get('device') === 'none') img.src = ASSETS + 'missing.png'
  })

  // ---- journey state ----
  var journey = document.getElementById('journey-device').querySelector('.dev')
  var railText = document.getElementById('rail-text'), dots = document.querySelectorAll('#rail-dots i')
  var steps = Array.prototype.slice.call(stepsEl.children)
  function setStep(i) {
    var state = STATES[i]
    steps.forEach(function (li, k) { li.classList.toggle('is-active', k === i); if (k === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current') })
    journey.setAttribute('data-state', state); journey.setAttribute('data-doors', DOORS[state]); journey.setAttribute('data-led', LED[state])
    journey.setAttribute('aria-label', t.steps[i].alt)
    journey.querySelector('.dev__screen').innerHTML = screenMarkup(state)
    var box = journey.querySelector('.zoom .screen-box'); if (box) box.innerHTML = screenMarkup(state)
    railText.textContent = t.railStep + ' ' + String(i + 1).padStart(2, '0') + ' · ' + t.rail[i]
    dots.forEach(function (d, k) { d.classList.toggle('on', k <= i) })
  }
  var preset = parseInt(params.get('step'), 10)
  setStep(preset >= 1 && preset <= 6 ? preset - 1 : 0)
  if (!(preset >= 1) && !reduce && 'IntersectionObserver' in window && matchMedia('(min-width: 1024px)').matches) {
    // one change per step, when 60 % of the step is visible; no scroll hijacking
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) setStep(steps.indexOf(e.target)) })
    }, { threshold: 0.6, rootMargin: '-10% 0px -10% 0px' })
    steps.forEach(function (li) { io.observe(li) })
  }

  // ---- header sheet (narrow widths) ----
  var btn = document.getElementById('menu-btn'), sheet = document.getElementById('sheet')
  btn.addEventListener('click', function () { var open = sheet.getAttribute('data-open') === 'true'; sheet.setAttribute('data-open', String(!open)); btn.setAttribute('aria-expanded', String(!open)) })
  if (params.get('menu') === 'open') { sheet.setAttribute('data-open', 'true'); btn.setAttribute('aria-expanded', 'true') }
})()
