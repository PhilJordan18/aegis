/*
 * Aegis prototype — single data fixture (source of truth for all 10 compositions).
 *
 * Every screen reads its data from this file through lib/aegis.js. Later
 * phases MUST NOT invent data inside a screen: add it here, with a tag.
 *
 * Tags ($src maps, one entry per field):
 *   "N:<ref>"   normative: value or rule defined by a normative document
 *               (02 scope, 03-10 cahier de conception). <ref> = doc §.
 *   "N~:<ref>"  normative rule applied to a fixture-chosen instant (e.g. an
 *               expiry computed from a time we picked). Rule normative, instant not.
 *   "C4".."C8"  mock: field or value not exposed by 09 v1.3 (remaining proposal,
 *               sections.md §9). Must be shown with an in-screen mock marker.
 *               C1–C3 (and P1) are formalized in 09 v1.3 and now tagged "N:".
 *   "F:<why>"   fixture assumption: value not defined by any document.
 *               Tagged here; shown with a marker only if it is not a plain
 *               value of a field that 09 defines (see README § Marqueurs).
 *
 * Instants are ISO-8601 UTC like the API (09 §3). The locker time zone is
 * America/Toronto, UTC-04:00 (EDT) on 2026-09-16. Display always converts
 * with that zone (lib/aegis.js AG.fmt).
 */
window.AEGIS_FIXTURE = {
  meta: {
    version: "09 v1.3 alignment / 2026-09-23",
    day: "2026-09-16",
    dayLabel: "mercredi 16 septembre 2026",
    timeZone: "America/Toronto",
    utcOffset: "-04:00",
    $src: {
      day: "N:09 examples (2026-09-16T14:30:00Z §8.2, §10.1)",
      timeZone: "N:02 §9.10, 09 §13.2",
      utcOffset: "N~:IANA America/Toronto, heure avancée (HAE) en septembre"
    }
  },

  // ------------------------------------------------------------------ locker
  locker: {
    id: "d46a74ae-39dc-460b-8af0-38fc791b376a",
    code: "AEGIS-DEMO-01",
    name: "Casier de démonstration",
    topology: "HUB_CELL",
    compartments: {
      A1: { id: "1ae77ae3-8490-4f09-9412-a7816b77bff9", code: "A1", enabled: true },
      A2: { id: "5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10", code: "A2", enabled: true }
    },
    $src: {
      id: "N:09 §8.2 example placement.lockerId",
      code: "N:09 §8.2 example placement.lockerCode",
      name: "F:LockerStatusView.name exists (09 §8.6) but no value is given",
      topology: "N:09 §8.6 enum; F:HUB_CELL chosen (02 §11.14 hub + cellules)",
      "compartments.A1": "N:09 §8.2 example compartmentId / A1",
      "compartments.A2": "F:A2 id generated; code A2 N:02 §10.1"
    }
  },

  schedule: {
    timeZone: "America/Toronto",
    weekdays: { opensAt: "09:00", closesAt: "17:00" },
    weekend: "closed",
    $src: { all: "N:09 §13.2 example (lun.–ven. 09:00–17:00, sam.–dim. fermé)" }
  },

  // Deployment label shown after login only (sections.md C6). Neutral value.
  institutionLabel: {
    value: "Laboratoire de démonstration",
    $src: { value: "C6" }
  },

  // ------------------------------------------------------------------- users
  users: {
    technician: {
      id: "75acc15f-fc23-45d9-857d-b543694e4fc2",
      displayName: "Technicien Démo",
      email: "technician@aegis.demo",
      role: "TECHNICIAN",
      maximumAccessLevel: "STANDARD",
      $src: { all: "N:09 §10.2 example login response" }
    },
    admin: {
      id: "c3b1f5a2-7d64-4e0b-8f2a-6a9d1e4b7c21",
      displayName: "Administrateur Démo",
      email: "admin@aegis.demo",
      role: "ADMIN",
      maximumAccessLevel: "RESTRICTED",
      $src: {
        role: "N:09 §4.4, §5 (rôles distincts)",
        id: "F:no demo admin defined in 02/09 (02 §10.1 says one is prepared)",
        displayName: "F:no demo admin defined",
        email: "F:no demo admin defined",
        maximumAccessLevel: "F:no demo admin defined"
      }
    }
  },

  // ------------------------------------------------------------------ models
  models: {
    "MM-001": {
      id: "a09aa622-fba1-4457-8f67-7f123284e132",
      name: "Multimètre 1", manufacturer: "Fluke", modelNumber: "117",
      $src: { all: "N:09 §8.2 example model" }
    },
    "MM-002": {
      id: "e71c9a40-5b2d-4c8e-a3f6-19d0b8e2c574",
      name: "Multimètre 2", manufacturer: "Fluke", modelNumber: "117",
      $src: {
        name: "N:02 §10.1 (« Multimètre 2 »)",
        id: "F:generated",
        manufacturer: "F:02 §10.1 says « comparables »; Fluke assumed",
        modelNumber: "F:117 assumed (comparable to MM-001)"
      }
    }
  },

  // ------------------------------------------------------------------ assets
  assets: {
    "MM-001": {
      id: "300e72fd-118c-4d1f-af9c-7fb61e89f62c",
      assetCode: "MM-001",
      requiredAccessLevel: "STANDARD",
      operationalStatus: "SERVICEABLE",
      calibration: { required: true, dueAt: "2026-12-01T05:00:00Z" },
      placement: { lockerCode: "AEGIS-DEMO-01", compartmentCode: "A1" },
      serialNumber: null,
      identifier: { type: "RFID_UHF", value: "E20034120123456789000001" },
      $src: {
        id: "N:09 §8.2 example",
        assetCode: "N:09 §8.2 example",
        requiredAccessLevel: "N:02 §10.1, 09 §8.2",
        operationalStatus: "N:09 §8.2 example",
        calibration: "N:09 §8.2 example (1 déc. 2026 00:00 HNE)",
        placement: "N:09 §8.2 example",
        serialNumber: "N:09 §8.9 AdminAssetView.serialNumber; F:null (not recorded)",
        identifier: "N:09 §12.3 example value (write only). NOT in AdminAssetView (09 §8.9), no read route: never displayed"
      }
    },
    "MM-002": {
      id: "8b4f2e19-6c07-4a5d-b1e3-2d9f7a0c6e58",
      assetCode: "MM-002",
      requiredAccessLevel: "STANDARD",
      operationalStatus: "SERVICEABLE",
      calibration: { required: true, dueAt: "2026-09-08T04:00:00Z" },
      placement: { lockerCode: "AEGIS-DEMO-01", compartmentCode: "A2" },
      serialNumber: null,
      identifier: { type: "RFID_UHF", value: "E20034120123456789000002" },
      $src: {
        id: "F:generated",
        assetCode: "F:MM-002 not defined in docs (follows MM-001 pattern)",
        requiredAccessLevel: "N:02 §10.1",
        operationalStatus: "F:02 §10.1 lists only the expired calibration",
        calibration: "N:02 §10.1 (expirée); F:date 8 sept. 2026 = example of sections.md §1.3",
        placement: "N:02 §10.1 (A2)",
        serialNumber: "N:09 §8.9 AdminAssetView.serialNumber; F:null (not recorded)",
        identifier: "F:value generated (write only). NOT in AdminAssetView (09 §8.9), no read route: never displayed"
      }
    }
  },

  // ------------------------------------------------------------- reservation
  reservation: {
    id: "7b726e56-2a19-44de-887b-d3e2bfc8bf28",
    assetCode: "MM-001",
    user: "technician",
    reservedFrom: "2026-09-16T14:31:40Z",
    reservedUntil: "2026-09-16T20:30:00Z",
    createdAt: "2026-09-16T14:31:40Z",
    fulfilledAt: "2026-09-16T14:42:00Z",
    availableActionsWhileActive: ["CANCEL", "CHECKOUT"],
    $src: {
      id: "N:09 §14.1 example Location",
      reservedUntil: "N:09 §14.1 example (20:30Z = 16 h 30 HAE)",
      reservedFrom: "F:10 h 31 min 40 s, server clock (09 §14.1 step 1)",
      createdAt: "F:= reservedFrom",
      fulfilledAt: "N~:05 §7.1 (= checkout confirmedAt)",
      availableActionsWhileActive: "F:09 §8.3 defines string[] without values",
      currentOperationId: "N:09 §8.3 — per snapshot (latest checkout attempt while ACTIVE, null once FULFILLED)"
    }
  },

  // LockerStatusView.currentWindow (09 §8.6), evaluated by the server at the
  // moment of the screen. While open: closesAt = end of today's window,
  // nextOpensAt = null.
  currentWindow: {
    timeZone: "America/Toronto",
    open: true,
    closesAt: "2026-09-16T21:00:00Z",
    nextOpensAt: null,
    $src: { all: "N:09 §8.6 OperatingWindowView; values N:09 §13.2 schedule (17 h 00 HAE)" }
  },

  // ------------------------------------------------------ checkout operation
  // Timestamps follow the requested moments. The 09 §15.1 / 10 §10.1 example
  // times (14:31–14:32Z) are illustrative and mutually inconsistent with this
  // timeline; only their identifiers are reused.
  checkoutOperation: {
    id: "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
    type: "CHECKOUT",
    user: "technician",
    assetCode: "MM-001",
    compartment: "A1",
    reservationId: "7b726e56-2a19-44de-887b-d3e2bfc8bf28",
    loanId: null,
    localAccessChallengeId: "9d65cbae-4610-4e40-a314-3b93af07be9c",
    createdAt: "2026-09-16T14:39:37Z",
    localProofDisplayedAt: "2026-09-16T14:39:39Z",
    localProofExpiresAt: "2026-09-16T14:40:37Z",
    localProofValidatedAt: "2026-09-16T14:40:05Z",
    authorizedAt: "2026-09-16T14:40:05Z",
    expiresAt: "2026-09-16T14:42:05Z",
    commandSentAt: "2026-09-16T14:40:06Z",
    acknowledgedAt: "2026-09-16T14:40:07Z",
    doorOpenedAt: "2026-09-16T14:40:31Z",
    observationReceivedAt: "2026-09-16T14:41:59Z",
    confirmedAt: "2026-09-16T14:42:00Z",
    terminalAt: "2026-09-16T14:42:00Z",
    failureReason: null,
    anomalyId: null,
    $src: {
      id: "N:09 §15.1 example",
      localAccessChallengeId: "N:09 §15.1 example",
      createdAt: "F:10 h 39 min 37 s (« Préparer le retrait »)",
      localProofDisplayedAt: "F:hub display ack 2 s later (09 §15.1)",
      localProofExpiresAt: "N~:02 §9.11 / 05 §5.5 proposition « 60 s max »",
      localProofValidatedAt: "N~:05 §5.3 (= authorizedAt)",
      authorizedAt: "F:scan at 10 h 40 min 05 s",
      expiresAt: "N~:05 §5.3 (authorizedAt + 120 s)",
      commandSentAt: "F:", acknowledgedAt: "F:", doorOpenedAt: "F:",
      observationReceivedAt: "F:RFID window 10:41:56–10:41:59 after door closed (10 §12.2)",
      confirmedAt: "F:10 h 42 min 00 s (< expiresAt)",
      loanId: "N:09 §8.5 (null for CHECKOUT)"
    }
  },

  // -------------------------------------------------------------------- loan
  loan: {
    id: "4e9a7c1b-0d3f-4b62-8e15-a7c2f9d06b3e",
    assetCode: "MM-001",
    holder: "technician",
    status: "ACTIVE",
    checkedOutAt: "2026-09-16T14:42:00Z",
    dueAt: "2026-09-16T20:30:00Z",
    returnRequestedAt: null,
    returnedAt: null,
    checkoutOperationId: "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
    returnOperationId: null,
    availableActions: ["RETURN"],
    $src: {
      id: "F:generated",
      checkedOutAt: "N~:05 §4.3 (= checkout confirmedAt)",
      dueAt: "N:03 §4.13, 04 Loan.dueAt, 05 §8 (copie de reservedUntil)",
      availableActions: "F:09 §8.4 defines string[] without values",
      currentOperationId: "N:09 §8.4 — per snapshot (null: no return attempt yet)",
      holderDisplayName: "C4: illustrative only — LoanView exposes holderUserId, no UserSummary (09 §8.4, §8.8)"
    }
  },

  // ----------------------------------------------------------------- anomaly
  // Chosen scenario: ASSET_PRESENT_WITH_ACTIVE_LOAN (03 §5.11; 06 §12.4;
  // 08 « type distinct »). An out-of-operation RFID scan of A1 (10 §20:
  // « événement … hors opération reste permis », operationId absent) reports
  // MM-001's tag while its loan is ACTIVE. The loan is NOT ended; the asset
  // stays BORROWED (06 §12.4). INCONSISTENT_PHYSICAL_STATE was rejected: 05
  // §5.4 defines it only inside an operation in OBSERVATION_RECEIVED.
  anomaly: {
    id: "b2d6e8f0-3a41-4c97-9e5b-7f1a2c3d4e5f",
    type: "ASSET_PRESENT_WITH_ACTIVE_LOAN",
    severity: "MEDIUM",
    status: "OPEN",
    lockerOperationId: null,
    assetCode: "MM-001",
    compartment: "A1",
    detectedAt: "2026-09-16T15:04:18Z",
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgementNote: null,
    resolvedAt: null,
    resolutionEvidenceObservationId: null,
    resolutionNote: null,
    summary: "Multimètre 1 détecté dans la cellule A1 alors que son prêt est actif.",
    noteDraft: "Inspection du compartiment planifiée avec le responsable du laboratoire.",
    $src: {
      type: "N:03 §5.11, 06 §12.4",
      severity: "F:09 §8.7 enum; no severity per type is documented",
      status: "N:05 §6.1",
      lockerOperationId: "N~:10 §20 out-of-operation event (operationId absent)",
      detectedAt: "F:11 h 04 min 18 s",
      summary: "F:AnomalyView.summary is a server string (09 §8.7); wording assumed",
      noteDraft: "N:09 §18.2 example note",
      linkedLoan: "F:link derived from assetId via GET /admin/loans?assetId= (09 §17); AnomalyView has no loanId",
      acknowledgedBy: "N:09 §8.7 UserSummary (§8.8) — null while OPEN"
    }
  },

  // Normalized observations only (09 §18.1: raw payloads excluded).
  observations: [
    { id: "obs-a1-1", at: "2026-09-16T14:40:31Z", compartment: "A1", type: "DOOR_OPENED", operation: "checkout", $src: "N~:03 §5.10; F:instant" },
    { id: "obs-a1-2", at: "2026-09-16T14:41:56Z", compartment: "A1", type: "DOOR_CLOSED", operation: "checkout", $src: "N~:03 §5.10; F:instant" },
    { id: "obs-a1-3", at: "2026-09-16T14:41:59Z", compartment: "A1", type: "ASSET_ABSENT", assetCode: "MM-001", reader: "HEALTHY", windowSeconds: 3, operation: "checkout", $src: "N~:10 §12.2 (fenêtre saine de 3 s, tag absent)" },
    { id: "obs-a1-4", at: "2026-09-16T15:04:18Z", compartment: "A1", type: "ASSET_PRESENT", assetCode: "MM-001", reader: "HEALTHY", readCount: 4, windowSeconds: 3, operation: null, $src: "N~:10 §12.1–12.2, §20; F:instant and readCount" }
  ],

  // ----------------------------------------------------------------- moments
  // One moment per composition. Shown in captions and overview labels only,
  // never inside product UI (the iOS status-bar clock is system chrome).
  moments: {
    "10:29": { at: "2026-09-16T14:29:00Z", label: "10 h 29" },
    "10:30": { at: "2026-09-16T14:30:00Z", label: "10 h 30" },
    "10:31": { at: "2026-09-16T14:31:00Z", label: "10 h 31" },
    "10:32": { at: "2026-09-16T14:32:00Z", label: "10 h 32" },
    "10:39": { at: "2026-09-16T14:39:50Z", label: "10 h 39 min 50 s" },
    "10:43": { at: "2026-09-16T14:43:00Z", label: "10 h 43" },
    "11:20": { at: "2026-09-16T15:20:00Z", label: "11 h 20" },
    "11:21": { at: "2026-09-16T15:21:00Z", label: "11 h 21" }
  },

  // --------------------------------------------------------------- snapshots
  // Derived state visible at each moment. Readiness is evaluated for the
  // technician (09 §8.1). operationalDiagnostic is the admin view (09 §8.9):
  // non-personal reasons only, no result, no reference technician.
  // Limitation (see README): AG.at merges the full static entities into each
  // snapshot, so entity fields may hold instants later than the moment (e.g.
  // reservation.fulfilledAt at 10:32). Screens only display fields that are
  // accomplished at their moment or deadlines; tools/check.mjs verifies this.
  snapshots: {
    "10:29": { ref: "10:30" },
    "10:30": {
      locker: { connectionStatus: "ONLINE", lastSeenAt: "2026-09-16T14:29:58Z" },
      assets: {
        "MM-001": { availability: "AVAILABLE", presence: "PRESENT", calibrationStatus: "VALID",
          readiness: { result: "READY", reasons: [], evaluatedAt: "2026-09-16T14:30:00Z" },
          operationalDiagnostic: { evaluatedAt: "2026-09-16T14:30:00Z", reasons: [] } },
        "MM-002": { availability: "AVAILABLE", presence: "PRESENT", calibrationStatus: "EXPIRED",
          readiness: { result: "BLOCKED", reasons: ["CALIBRATION_EXPIRED"], evaluatedAt: "2026-09-16T14:30:00Z" },
          operationalDiagnostic: { evaluatedAt: "2026-09-16T14:30:00Z", reasons: ["CALIBRATION_EXPIRED"] } }
      },
      reservation: null, operation: null, loan: null, anomalies: [],
      $src: {
        "MM-001.readiness": "N:02 §10.1–10.2, 09 §8.2 example",
        "MM-002.readiness": "N:02 §10.1–10.2 (BLOCKED / CALIBRATION_EXPIRED)",
        operationalDiagnostic: "N:09 §8.9 AdminAssetView.operationalDiagnostic (non-personal reasons, never ACCESS_DENIED, no result field)",
        "locker.lastSeenAt": "F:heartbeat every 10 s (02 §9.11)"
      }
    },
    "10:31": { ref: "10:30" },
    "10:32": {
      locker: { connectionStatus: "ONLINE", lastSeenAt: "2026-09-16T14:31:58Z" },
      assets: {
        "MM-001": { availability: "RESERVED", presence: "PRESENT", calibrationStatus: "VALID",
          readiness: { result: "READY", reasons: [], evaluatedAt: "2026-09-16T14:32:00Z" } },
        "MM-002": { availability: "AVAILABLE", presence: "PRESENT", calibrationStatus: "EXPIRED",
          readiness: { result: "BLOCKED", reasons: ["CALIBRATION_EXPIRED"], evaluatedAt: "2026-09-16T14:32:00Z" } }
      },
      reservation: { status: "ACTIVE", currentOperationId: null }, operation: null, loan: null, anomalies: [],
      $src: { "MM-001.readiness": "N:sections.md §1.2 row « Réservé pour vous » (READY for the holder)" }
    },
    "10:39": {
      locker: { connectionStatus: "ONLINE", lastSeenAt: "2026-09-16T14:39:48Z" },
      assets: {
        "MM-001": { availability: "RESERVED", presence: "PRESENT", calibrationStatus: "VALID",
          readiness: { result: "READY", reasons: [], evaluatedAt: "2026-09-16T14:39:37Z" } }
      },
      reservation: { status: "ACTIVE", currentOperationId: "2f38d3b6-c18f-4a74-aa9a-2d574286013f" },
      operation: { status: "AWAITING_LOCAL_PROOF", requiredAction: "SCAN_HUB_QR", secondsLeft: 47 },
      loan: null, anomalies: [],
      $src: { operation: "N:09 §15.1, sections.md §1.4 (code affiché)", secondsLeft: "N~:localProofExpiresAt − moment = 47 s" }
    },
    "10:43": {
      locker: { connectionStatus: "ONLINE", lastSeenAt: "2026-09-16T14:42:58Z" },
      assets: {
        "MM-001": { availability: "BORROWED", presence: "ABSENT", calibrationStatus: "VALID",
          readiness: { result: "BLOCKED", reasons: ["NOT_AVAILABLE"], evaluatedAt: "2026-09-16T14:43:00Z" } },
        "MM-002": { availability: "AVAILABLE", presence: "PRESENT", calibrationStatus: "EXPIRED",
          readiness: { result: "BLOCKED", reasons: ["CALIBRATION_EXPIRED"], evaluatedAt: "2026-09-16T14:43:00Z" } }
      },
      reservation: { status: "FULFILLED", currentOperationId: null },
      operation: { status: "CONFIRMED", requiredAction: "NONE" },
      loan: { status: "ACTIVE", overdue: false, currentOperationId: null }, anomalies: [],
      $src: {
        "MM-001.readiness": "N:03 §4.13, 06 §4.4 (BORROWED ⇒ BLOCKED / NOT_AVAILABLE)",
        "MM-001.presence": "N~:10 §12.2 ASSET_ABSENT after checkout"
      }
    },
    "11:20": {
      locker: { connectionStatus: "ONLINE", lastSeenAt: "2026-09-16T15:19:58Z" },
      compartments: {
        A1: { doorState: "CLOSED", lockState: "LOCKED", rfidReaderStatus: "HEALTHY", lastObservedAt: "2026-09-16T15:04:18Z" },
        A2: { doorState: "CLOSED", lockState: "LOCKED", rfidReaderStatus: "HEALTHY", lastObservedAt: "2026-09-16T14:02:10Z" }
      },
      assets: {
        "MM-001": { availability: "BORROWED", presence: "PRESENT", calibrationStatus: "VALID",
          operationalDiagnostic: { evaluatedAt: "2026-09-16T15:20:00Z", reasons: ["NOT_AVAILABLE"] } },
        "MM-002": { availability: "AVAILABLE", presence: "PRESENT", calibrationStatus: "EXPIRED",
          operationalDiagnostic: { evaluatedAt: "2026-09-16T15:20:00Z", reasons: ["CALIBRATION_EXPIRED"] } }
      },
      reservation: { status: "FULFILLED", currentOperationId: null },
      operation: { status: "CONFIRMED", requiredAction: "NONE" },
      loan: { status: "ACTIVE", overdue: false, currentOperationId: null },
      anomalies: [{ status: "OPEN" }],
      activeReservations: 0, overdueLoans: 0, operationsInProgress: 0,
      $src: {
        "MM-001.presence": "N~:obs-a1-4 (présence observée; le prêt reste ACTIVE, 06 §12.4)",
        "MM-001.availability": "N:03 §5.2 (prêt non terminé ⇒ BORROWED)",
        compartments: "N:09 §8.6 fields; F:values",
        "A2.lastObservedAt": "F:last periodic observation, value assumed",
        counts: "N~:derived from the complete fixture lists (≤ 2 assets, sections.md §7.1 borne P0)"
      }
    },
    "11:21": { ref: "11:20" }
  }
};
