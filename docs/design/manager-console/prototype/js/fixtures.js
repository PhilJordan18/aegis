/* DONNÉES FICTIVES (aucune requête, aucune donnée réelle).
   Les formes suivent docs/cahier-conception/09-contrats-rest.md : §8.3 ReservationView, §8.4 LoanView,
   §8.5 LockerOperationView, §8.6 LockerStatusView, §8.7 AnomalyView, §8.8 résumés, §16.2 AdminLockerView, §19.1 AuditEventView.
   Aucun champ n'est ajouté. Deux écarts de forme sont des HYPOTHÈSES de fixture, signalées dans handoff.md :
     - AuditEventView.actor : le contrat ne définit pas son type (G4); la fixture suppose { userId } ou null;
     - AuditEventView.result / eventType / subjectType : vocabulaires non définis (G5); valeurs supposées.
   Récit : le 11 novembre 2026, 14 h 12 (heure de l'Est). Le prêt de MM-001 est en retard et son retour a échoué en anomalie;
   une opération de retrait est en cours sur MM-002. Seuls deux exemplaires et deux cellules existent (démonstration P0). */
(function () {
  var NOW = '2026-11-11T19:12:40Z';
  var ZONE = 'America/Toronto';

  /* Identifiants déterministes d'allure UUID v4 (hachage de toute la graine, puis générateur mulberry32). */
  function uid(seed) {
    var h = 1779033703 ^ seed.length;
    for (var i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    var a = (Math.imul(h ^ (h >>> 16), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0;
    var hex = '';
    for (var j = 0; j < 4; j++) {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      hex += (((t ^ (t >>> 14)) >>> 0).toString(16)).padStart(8, '0');
    }
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-' + '89ab'[parseInt(hex[16], 16) % 4] + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }
  /* Heure locale du laboratoire (HNE, UTC-5 en novembre 2026) -> instant UTC. */
  function L(day, hms) {
    var p = hms.split(':').map(Number);
    return new Date(Date.UTC(2026, 10, day, p[0] + 5, p[1], p[2] || 0)).toISOString().replace('.000Z', 'Z');
  }

  var LOCKER = { id: uid('locker'), code: 'AEGIS-DEMO-01', name: 'Casier de démonstration', topology: 'HUB_CELL' };
  var CELLS = { A1: { id: uid('cell-a1'), code: 'A1' }, A2: { id: uid('cell-a2'), code: 'A2' } };
  function placement(cell) { return { lockerId: LOCKER.id, lockerCode: LOCKER.code, compartmentId: CELLS[cell].id, compartmentCode: cell }; }
  var MM1 = { id: '300e72fd-118c-4d1f-af9c-7fb61e89f62c', assetCode: 'MM-001', model: { id: uid('model-1'), name: 'Multimètre 1', manufacturer: 'Fluke', modelNumber: '117' }, placement: placement('A1') };
  var MM2 = { id: '5a3d1c9e-2b7f-4e0a-8c11-6d9f2e7b4a02', assetCode: 'MM-002', model: { id: uid('model-2'), name: 'Multimètre 2', manufacturer: 'Fluke', modelNumber: '117' }, placement: placement('A2') };
  var ASSETS = [MM1, MM2];
  var U1 = uid('user-1'), U2 = uid('user-2');
  var ADMIN = { id: uid('admin-1'), displayName: 'Administrateur Démo' };

  /* ---- Réservations (§8.3) : userId seulement, aucun nom (écart C4, G1). availableActions n'est jamais affiché. ---- */
  function reservation(k, o) {
    return Object.assign({ id: uid(k), userId: U1, reservedFrom: null, createdAt: null, cancelledAt: null, fulfilledAt: null, expiredAt: null, currentOperationId: null, availableActions: [] }, o);
  }
  var RESERVATIONS = [
    reservation('R1', { asset: MM2, userId: U2, status: 'ACTIVE', createdAt: L(11, '13:41:12'), reservedFrom: L(11, '13:41:12'), reservedUntil: L(11, '16:30:00'), currentOperationId: uid('O1') }),
    reservation('R2', { asset: MM1, userId: U1, status: 'FULFILLED', createdAt: L(11, '09:03:12'), reservedFrom: L(11, '09:03:12'), reservedUntil: L(11, '12:30:00'), fulfilledAt: L(11, '09:06:20') }),
    reservation('R3', { asset: MM2, userId: U1, status: 'CANCELLED', createdAt: L(10, '14:20:05'), reservedFrom: L(10, '14:20:05'), reservedUntil: L(10, '17:00:00'), cancelledAt: L(10, '14:48:31') }),
    reservation('R5', { asset: MM2, userId: U1, status: 'FULFILLED', createdAt: L(10, '09:30:40'), reservedFrom: L(10, '09:30:40'), reservedUntil: L(10, '16:00:00'), fulfilledAt: L(10, '09:35:10') }),
    reservation('R6', { asset: MM1, userId: U2, status: 'FULFILLED', createdAt: L(9, '10:05:00'), reservedFrom: L(9, '10:05:00'), reservedUntil: L(9, '15:00:00'), fulfilledAt: L(9, '10:10:12') }),
    reservation('R4', { asset: MM2, userId: U2, status: 'EXPIRED', createdAt: L(9, '11:40:00'), reservedFrom: L(9, '11:40:00'), reservedUntil: L(9, '12:00:00'), expiredAt: L(9, '12:00:05') })
  ];

  /* ---- Prêts (§8.4) ---- */
  function loan(k, o) {
    return Object.assign({ id: uid(k), returnRequestedAt: null, returnedAt: null, returnOperationId: null, currentOperationId: null, overdue: false, availableActions: [] }, o);
  }
  var LOANS = [
    loan('L1', { asset: MM1, holderUserId: U1, status: 'RETURN_PENDING', checkedOutAt: L(11, '09:06:20'), dueAt: L(11, '12:30:00'), overdue: true, returnRequestedAt: L(11, '13:57:48'), checkoutOperationId: uid('O2'), currentOperationId: uid('O0') }),
    loan('L2', { asset: MM2, holderUserId: U1, status: 'COMPLETED', checkedOutAt: L(10, '09:35:10'), dueAt: L(10, '16:00:00'), returnRequestedAt: L(10, '15:40:02'), returnedAt: L(10, '15:41:20'), checkoutOperationId: uid('O6'), returnOperationId: uid('O7') }),
    loan('L3', { asset: MM1, holderUserId: U2, status: 'COMPLETED', checkedOutAt: L(9, '10:10:12'), dueAt: L(9, '15:00:00'), returnRequestedAt: L(9, '14:20:00'), returnedAt: L(9, '14:21:30'), checkoutOperationId: uid('O8'), returnOperationId: uid('O9') })
  ];

  /* ---- Opérations physiques (§8.5) : UUID seulement pour l'actif, la cellule et l'utilisateur (G3) ---- */
  function op(k, o) {
    return Object.assign({
      id: uid(k), userId: U1, lockerId: LOCKER.id, reservationId: null, loanId: null, authorizedAt: null, localAccessChallengeId: null,
      localProofExpiresAt: null, localProofDisplayedAt: null, localProofValidatedAt: null, requiredAction: 'NONE', expiresAt: null,
      commandSentAt: null, acknowledgedAt: null, doorOpenedAt: null, observationReceivedAt: null, confirmedAt: null, terminalAt: null,
      failureReason: null, anomalyId: null
    }, o);
  }
  function seq(day, t) { return t.map(function (x) { return x ? L(day, x) : null; }); }
  function full(k, day, t, o) { // t : créée, affichée, validée, autorisée, envoyée, acquittée, porte, observation, confirmée
    var s = seq(day, t);
    return op(k, Object.assign({ createdAt: s[0], localAccessChallengeId: uid(k + '-ch'), localProofDisplayedAt: s[1], localProofValidatedAt: s[2], authorizedAt: s[3], commandSentAt: s[4], acknowledgedAt: s[5], doorOpenedAt: s[6], observationReceivedAt: s[7], confirmedAt: s[8], terminalAt: s[8] }, o));
  }
  var OPS = [
    op('O1', { type: 'CHECKOUT', status: 'COMMAND_ACKNOWLEDGED', assetId: MM2.id, compartmentId: CELLS.A2.id, userId: U2, reservationId: uid('R1'), createdAt: L(11, '14:11:05'), localAccessChallengeId: uid('O1-ch'), localProofDisplayedAt: L(11, '14:11:12'), localProofValidatedAt: L(11, '14:11:49'), localProofExpiresAt: L(11, '14:12:12'), authorizedAt: L(11, '14:11:50'), requiredAction: 'WAIT', expiresAt: L(11, '14:13:50'), commandSentAt: L(11, '14:11:51'), acknowledgedAt: L(11, '14:11:53') }),
    full('O0', 11, ['13:57:48', '13:57:55', '13:58:20', '13:58:21', '13:58:22', '13:58:24', '13:58:41', '14:02:05', null], { type: 'RETURN', status: 'ANOMALY', assetId: MM1.id, compartmentId: CELLS.A1.id, loanId: uid('L1'), terminalAt: L(11, '14:02:10'), anomalyId: uid('AN1'), requiredAction: 'NONE' }),
    full('O2', 11, ['09:04:00', '09:04:07', '09:04:31', '09:04:32', '09:04:33', '09:04:35', '09:05:30', '09:06:15', '09:06:20'], { type: 'CHECKOUT', status: 'CONFIRMED', assetId: MM1.id, compartmentId: CELLS.A1.id, reservationId: uid('R2'), loanId: uid('L1') }),
    full('O5', 9, ['11:48:00', '11:48:08', '11:48:40', '11:48:41', '11:48:42', '11:48:44', '11:49:10', null, null], { type: 'CHECKOUT', status: 'ANOMALY', assetId: MM2.id, compartmentId: CELLS.A2.id, userId: U2, reservationId: uid('R4'), terminalAt: L(9, '11:52:00'), anomalyId: uid('AN2') }),
    full('O6', 10, ['09:33:00', '09:33:06', '09:33:40', '09:33:41', '09:33:42', '09:33:44', '09:34:20', '09:35:05', '09:35:10'], { type: 'CHECKOUT', status: 'CONFIRMED', assetId: MM2.id, compartmentId: CELLS.A2.id, reservationId: uid('R5'), loanId: uid('L2') }),
    full('O7', 10, ['15:40:02', '15:40:09', '15:40:30', '15:40:31', '15:40:32', '15:40:34', '15:40:58', '15:41:15', '15:41:20'], { type: 'RETURN', status: 'CONFIRMED', assetId: MM2.id, compartmentId: CELLS.A2.id, loanId: uid('L2') }),
    full('O8', 9, ['10:08:00', '10:08:05', '10:08:30', '10:08:31', '10:08:32', '10:08:34', '10:09:00', '10:10:05', '10:10:12'], { type: 'CHECKOUT', status: 'CONFIRMED', assetId: MM1.id, compartmentId: CELLS.A1.id, userId: U2, reservationId: uid('R6'), loanId: uid('L3') }),
    full('O9', 9, ['14:20:00', '14:20:06', '14:20:30', '14:20:31', '14:20:32', '14:20:34', '14:20:58', '14:21:25', '14:21:30'], { type: 'RETURN', status: 'CONFIRMED', assetId: MM1.id, compartmentId: CELLS.A1.id, userId: U2, loanId: uid('L3') })
  ];

  /* ---- Anomalies (§8.7) : assetId et compartmentId sont des UUID (G3); la section evidence n'a pas de forme (G2) ---- */
  function anomaly(k, o) {
    return Object.assign({ id: uid(k), lockerOperationId: null, assetId: null, compartmentId: null, acknowledgedAt: null, acknowledgedBy: null, acknowledgementNote: null, resolvedAt: null, resolutionEvidenceObservationId: null, resolutionNote: null }, o);
  }
  var ANOMALIES = [
    anomaly('AN1', { type: 'EXPECTED_ASSET_NOT_OBSERVED', severity: 'HIGH', status: 'OPEN', lockerOperationId: uid('O0'), assetId: MM1.id, compartmentId: CELLS.A1.id, detectedAt: L(11, '14:02:10'), summary: "L'équipement attendu n'a pas été observé dans la cellule A1 après la fermeture de la porte." }),
    anomaly('AN2', { type: 'DOOR_NOT_CLOSED_BEFORE_EXPIRY', severity: 'MEDIUM', status: 'ACKNOWLEDGED', lockerOperationId: uid('O5'), assetId: MM2.id, compartmentId: CELLS.A2.id, detectedAt: L(9, '11:52:00'), acknowledgedAt: L(10, '09:15:30'), acknowledgedBy: ADMIN, acknowledgementNote: "Porte de la cellule A2 inspectée avec le responsable du laboratoire; charnière à remplacer.", summary: "La porte de la cellule A2 est restée ouverte jusqu'à l'échéance de l'opération." }),
    anomaly('AN3', { type: 'UNEXPECTED_ASSET_OBSERVED', severity: 'LOW', status: 'RESOLVED', assetId: MM1.id, compartmentId: CELLS.A2.id, detectedAt: L(7, '16:10:00'), acknowledgedAt: L(7, '16:25:00'), acknowledgedBy: ADMIN, acknowledgementNote: "MM-001 remis dans la mauvaise cellule; retour à A1 demandé.", resolvedAt: L(8, '08:41:00'), resolutionEvidenceObservationId: uid('OBS-1'), resolutionNote: "Équipement observé dans la cellule attendue A1.", summary: "Un équipement non attendu a été observé dans la cellule A2." })
  ];

  /* ---- Casier (§16.2 AdminLockerView + §8.6 LockerStatusView) ---- */
  function lockerStatus(offline) {
    return {
      lockerId: LOCKER.id, code: LOCKER.code, name: LOCKER.name, topology: LOCKER.topology,
      connectionStatus: offline ? 'OFFLINE' : 'ONLINE', lastSeenAt: offline ? L(11, '14:11:53') : L(11, '14:12:31'), evaluatedAt: NOW,
      currentWindow: { timeZone: ZONE, open: true, closesAt: L(11, '17:00:00'), nextOpensAt: null },
      compartments: [
        { id: CELLS.A1.id, code: 'A1', enabled: true, connectionStatus: 'CONNECTED', rfidReaderStatus: 'HEALTHY', doorState: 'CLOSED', lockState: 'LOCKED', lastObservedAt: L(11, '14:02:05') },
        { id: CELLS.A2.id, code: 'A2', enabled: true, connectionStatus: 'CONNECTED', rfidReaderStatus: 'HEALTHY', doorState: 'CLOSED', lockState: 'UNLOCKED', lastObservedAt: L(11, '14:11:53') }
      ],
      deviceErrors: []
    };
  }
  var ADMIN_LOCKER = { id: LOCKER.id, code: LOCKER.code, name: LOCKER.name, topology: LOCKER.topology, compartments: [
    { id: CELLS.A1.id, code: 'A1', enabled: true, currentAsset: { id: MM1.id, assetCode: MM1.assetCode } },
    { id: CELLS.A2.id, code: 'A2', enabled: true, currentAsset: { id: MM2.id, assetCode: MM2.assetCode } }
  ] };

  /* ---- Audit (§19.1) : formes d'actor, result, eventType et subjectType supposées (G4, G5) ---- */
  var AUDIT_RAW = [
    // [jour, heure, eventType, acteur, subjectType, sujet, opération, de, vers, résultat, motif, détails]
    [9, '11:52:00', 'ANOMALY_CREATED', null, 'ANOMALY', 'AN2', 'O5', null, 'OPEN', 'SUCCESS', 'DOOR_NOT_CLOSED_BEFORE_EXPIRY', { severity: 'MEDIUM', compartmentCode: 'A2' }],
    [10, '09:15:30', 'ANOMALY_ACKNOWLEDGED', 'ADMIN', 'ANOMALY', 'AN2', 'O5', 'OPEN', 'ACKNOWLEDGED', 'SUCCESS', null, {}],
    [10, '15:41:20', 'LOAN_COMPLETED', null, 'LOAN', 'L2', 'O7', 'RETURN_PENDING', 'COMPLETED', 'SUCCESS', null, { assetCode: 'MM-002' }],
    [11, '09:03:12', 'RESERVATION_CREATED', 'U1', 'RESERVATION', 'R2', null, null, 'ACTIVE', 'SUCCESS', null, { assetCode: 'MM-001' }],
    [11, '09:04:00', 'OPERATION_REQUESTED', 'U1', 'LOCKER_OPERATION', 'O2', 'O2', null, 'REQUESTED', 'SUCCESS', null, { type: 'CHECKOUT', compartmentCode: 'A1' }],
    [11, '09:06:20', 'OPERATION_CONFIRMED', null, 'LOCKER_OPERATION', 'O2', 'O2', 'OBSERVATION_RECEIVED', 'CONFIRMED', 'SUCCESS', null, { type: 'CHECKOUT' }],
    [11, '09:06:20', 'RESERVATION_FULFILLED', null, 'RESERVATION', 'R2', 'O2', 'ACTIVE', 'FULFILLED', 'SUCCESS', null, {}],
    [11, '09:06:20', 'LOAN_CREATED', null, 'LOAN', 'L1', 'O2', null, 'ACTIVE', 'SUCCESS', null, { dueAt: L(11, '12:30:00') }],
    [11, '13:41:12', 'RESERVATION_CREATED', 'U2', 'RESERVATION', 'R1', null, null, 'ACTIVE', 'SUCCESS', null, { assetCode: 'MM-002', reservedUntil: L(11, '16:30:00') }],
    [11, '13:57:48', 'LOAN_RETURN_REQUESTED', 'U1', 'LOAN', 'L1', 'O0', 'ACTIVE', 'RETURN_PENDING', 'SUCCESS', null, {}],
    [11, '13:57:48', 'OPERATION_REQUESTED', 'U1', 'LOCKER_OPERATION', 'O0', 'O0', null, 'REQUESTED', 'SUCCESS', null, { type: 'RETURN', compartmentCode: 'A1' }],
    [11, '13:57:55', 'LOCAL_CHALLENGE_DISPLAYED', null, 'LOCKER_OPERATION', 'O0', 'O0', 'REQUESTED', 'AWAITING_LOCAL_PROOF', 'SUCCESS', null, {}],
    [11, '13:58:20', 'LOCAL_CHALLENGE_CONSUMED', 'U1', 'LOCKER_OPERATION', 'O0', 'O0', 'AWAITING_LOCAL_PROOF', 'AUTHORIZED', 'SUCCESS', null, {}],
    [11, '13:58:22', 'COMMAND_SENT', null, 'LOCKER_OPERATION', 'O0', 'O0', 'AUTHORIZED', 'COMMAND_SENT', 'SUCCESS', null, { commandType: 'UNLOCK_COMPARTMENT' }],
    [11, '13:58:24', 'COMMAND_ACKNOWLEDGED', null, 'LOCKER_OPERATION', 'O0', 'O0', 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'SUCCESS', null, {}],
    [11, '13:58:41', 'DOOR_OPENED', null, 'LOCKER_OPERATION', 'O0', 'O0', 'COMMAND_ACKNOWLEDGED', 'DOOR_OPENED', 'SUCCESS', null, { compartmentCode: 'A1' }],
    [11, '14:02:10', 'OPERATION_ANOMALY', null, 'LOCKER_OPERATION', 'O0', 'O0', 'DOOR_OPENED', 'ANOMALY', 'FAILED', 'EXPECTED_ASSET_NOT_OBSERVED', { compartmentCode: 'A1' }],
    [11, '14:02:10', 'ANOMALY_CREATED', null, 'ANOMALY', 'AN1', 'O0', null, 'OPEN', 'SUCCESS', 'EXPECTED_ASSET_NOT_OBSERVED', { severity: 'HIGH', compartmentCode: 'A1' }],
    [11, '14:11:05', 'OPERATION_REQUESTED', 'U2', 'LOCKER_OPERATION', 'O1', 'O1', null, 'REQUESTED', 'SUCCESS', null, { type: 'CHECKOUT', compartmentCode: 'A2' }],
    [11, '14:11:12', 'LOCAL_CHALLENGE_DISPLAYED', null, 'LOCKER_OPERATION', 'O1', 'O1', 'REQUESTED', 'AWAITING_LOCAL_PROOF', 'SUCCESS', null, {}],
    [11, '14:11:30', 'LOCAL_CHALLENGE_REJECTED', 'U2', 'LOCKER_OPERATION', 'O1', 'O1', 'AWAITING_LOCAL_PROOF', 'AWAITING_LOCAL_PROOF', 'REFUSED', 'LOCAL_PROOF_INVALID', {}],
    [11, '14:11:49', 'LOCAL_CHALLENGE_CONSUMED', 'U2', 'LOCKER_OPERATION', 'O1', 'O1', 'AWAITING_LOCAL_PROOF', 'AUTHORIZED', 'SUCCESS', null, {}],
    [11, '14:11:51', 'COMMAND_SENT', null, 'LOCKER_OPERATION', 'O1', 'O1', 'AUTHORIZED', 'COMMAND_SENT', 'SUCCESS', null, { commandType: 'UNLOCK_COMPARTMENT' }],
    [11, '14:11:53', 'COMMAND_ACKNOWLEDGED', null, 'LOCKER_OPERATION', 'O1', 'O1', 'COMMAND_SENT', 'COMMAND_ACKNOWLEDGED', 'SUCCESS', null, {}]
  ];
  var ACTORS = { U1: { userId: U1 }, U2: { userId: U2 }, ADMIN: { userId: ADMIN.id } };
  var AUDIT = AUDIT_RAW.map(function (r, i) {
    var subjectKey = r[5];
    return {
      id: uid('E' + i), eventType: r[2], actor: r[3] ? ACTORS[r[3]] : null, subjectType: r[4], subjectId: uid(subjectKey), operationId: r[6] ? uid(r[6]) : null,
      fromState: r[7], toState: r[8], result: r[9], reason: r[10], occurredAt: L(r[0], r[1]), details: r[11]
    };
  }).sort(function (a, b) { return a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : a.id < b.id ? 1 : -1; });

  window.AG.fx = {
    NOW: NOW, ZONE: ZONE, uid: uid, L: L, LOCKER: LOCKER, CELLS: CELLS, ASSETS: ASSETS, ADMIN: ADMIN, U1: U1, U2: U2,
    RESERVATIONS: RESERVATIONS, LOANS: LOANS, OPS: OPS, ANOMALIES: ANOMALIES, AUDIT: AUDIT,
    lockerStatus: lockerStatus, ADMIN_LOCKER: ADMIN_LOCKER,
    assetById: function (id) { return ASSETS.filter(function (a) { return a.id === id; })[0] || null; },
    cellById: function (id) { return id === CELLS.A1.id ? CELLS.A1 : id === CELLS.A2.id ? CELLS.A2 : null; },
    opById: function (id) { return OPS.filter(function (o) { return o.id === id; })[0] || null; },
    loanById: function (id) { return LOANS.filter(function (o) { return o.id === id; })[0] || null; },
    reservationById: function (id) { return RESERVATIONS.filter(function (o) { return o.id === id; })[0] || null; },
    anomalyById: function (id) { return ANOMALIES.filter(function (o) { return o.id === id; })[0] || null; }
  };
})();
