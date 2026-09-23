/*
 * Aegis prototype runtime (no dependency, no network).
 *
 * Load order in every page (synchronous, in <head>):
 *   data/fixture.js → data/screens.js → lib/aegis.js
 *
 * URL parameters (deterministic renders):
 *   ?theme=light|dark            → <html data-theme>
 *   ?treatment=a|b               → <html data-treatment>
 *   ?transparency=reduce         → <html data-transparency="reduce"> (opaque glass fallback)
 * <html data-platform="ios|web"> is set statically by each page.
 *
 * Exposes window.AG:
 *   AG.theme, AG.treatment, AG.platform
 *   AG.fx                    the fixture
 *   AG.at(momentKey)         merged view of the fixture at a moment
 *   AG.fmt.*                 French (fr-CA) formatters in America/Toronto
 *   AG.copy.*                interface copy (sections.md §1.2–1.4, §5)
 *   AG.status.*              domain state → {kind, label, secondary}
 *                            (technician readiness; admin operationalDiagnostic, 09 §8.9)
 *   AG.icon(name, cls)       inline SVG placeholders for SF Symbols
 *   AG.c.*                   shared components (HTML strings)
 *   AG.ios.*, AG.web.*       platform chrome
 *   AG.mount(fn)             renders fn() into #app
 */
(function () {
  "use strict";
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const treatment = params.get("treatment") === "b" ? "b" : "a";
  root.dataset.theme = theme;
  root.dataset.treatment = treatment;
  if (params.get("transparency") === "reduce") root.dataset.transparency = "reduce";
  const platform = root.dataset.platform || "web";
  const fx = window.AEGIS_FIXTURE;
  const TZ = fx.meta.timeZone;

  // ------------------------------------------------------------ formatters
  const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function parts(iso) {
    const d = new Date(iso);
    const f = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    });
    const o = {};
    f.formatToParts(d).forEach(p => { o[p.type] = p.value; });
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, s: +o.second };
  }
  const pad = n => String(n).padStart(2, "0");
  const dayNum = d => (d === 1 ? "1er" : String(d));
  const fmt = {
    /** "10 h 30" */
    time: iso => { const p = parts(iso); return `${p.h}\u00A0h\u00A0${pad(p.min)}`; },
    /** "10 h 30 min 05 s" */
    timeSec: iso => { const p = parts(iso); return `${p.h} h ${pad(p.min)} min ${pad(p.s)} s`; },
    /** "10:30:05" tabular, for dense chronologies */
    clock: iso => { const p = parts(iso); return `${pad(p.h)}:${pad(p.min)}:${pad(p.s)}`; },
    /** "10:30" status-bar clock */
    statusClock: iso => { const p = parts(iso); return `${p.h}:${pad(p.min)}`; },
    /** "8 sept. 2026" */
    date: iso => { const p = parts(iso); return `${dayNum(p.d)}\u00A0${MONTHS[p.m - 1]}\u00A0${p.y}`; },
    /** "8 septembre 2026" */
    dateLong: iso => { const p = parts(iso); return `${dayNum(p.d)}\u00A0${MONTHS_LONG[p.m - 1]}\u00A0${p.y}`; },
    /** "2026-09-08" (date input value) */
    isoDate: iso => { const p = parts(iso); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; },
    /** "0:47" */
    countdown: s => `${Math.floor(s / 60)}:${pad(s % 60)}`,
    /** "16 min" */
    minutes: (fromIso, toIso) => `${Math.round((new Date(toIso) - new Date(fromIso)) / 60000)} min`,
    zoneShort: "HAE",
    zoneLabel: "heure du casier (HAE, America/Toronto)"
  };

  // ------------------------------------------------------------------ copy
  // Source: sections.md §1.2 (statuts), §1.3 (raisons), §1.4 (opération), §5.
  const copy = {
    reasons: {
      NOT_AVAILABLE: () => "Indisponible pour le moment",
      NOT_PRESENT: () => "Absent de sa cellule",
      DAMAGED: () => "Endommagé",
      MAINTENANCE: () => "En maintenance",
      CALIBRATION_EXPIRED: a => `Calibration expirée depuis le ${fmt.date(a.calibration.dueAt)}`,
      ACCESS_DENIED: () => "Niveau d'accès insuffisant",
      UNKNOWN_PHYSICAL_STATE: () => "Présence non confirmée"
    },
    /** Short labels for dense cells (Web table); the full reason stays in the inspector. */
    reasonShort: {
      NOT_AVAILABLE: "Indisponible", NOT_PRESENT: "Absent de sa cellule", DAMAGED: "Endommagé",
      MAINTENANCE: "En maintenance", CALIBRATION_EXPIRED: "Calibration expirée",
      ACCESS_DENIED: "Niveau d'accès insuffisant", UNKNOWN_PHYSICAL_STATE: "Présence non confirmée"
    },
    reasonOrder: ["NOT_AVAILABLE", "NOT_PRESENT", "DAMAGED", "MAINTENANCE", "CALIBRATION_EXPIRED", "ACCESS_DENIED", "UNKNOWN_PHYSICAL_STATE"],
    reasonAction: {
      NOT_AVAILABLE: "Choisir un autre équipement",
      NOT_PRESENT: "Prévenir un administrateur",
      DAMAGED: "Prévenir un administrateur",
      MAINTENANCE: "Choisir un autre équipement",
      CALIBRATION_EXPIRED: "Choisir un autre équipement",
      ACCESS_DENIED: "Demander l'accès à un administrateur",
      UNKNOWN_PHYSICAL_STATE: "Réessayer plus tard"
    },
    availabilityAdmin: { AVAILABLE: "Disponible", RESERVED: "Réservé", BORROWED: "Emprunté", BORROWED_OVERDUE: "Emprunté · en retard", UNAVAILABLE: "Indisponible" },
    service: { SERVICEABLE: "En service", MAINTENANCE: "En maintenance", DAMAGED: "Endommagé" },
    presence: { PRESENT: "Présent", ABSENT: "Absent", UNKNOWN: "Non confirmée" },
    calibration: {
      VALID: a => `Valide jusqu'au ${fmt.date(a.calibration.dueAt)}`,
      EXPIRED: a => `Expirée depuis le ${fmt.date(a.calibration.dueAt)}`,
      NOT_REQUIRED: () => "Non requise",
      UNKNOWN: () => "Inconnue"
    },
    accessLevel: { STANDARD: "Standard", RESTRICTED: "Restreint" },
    role: { TECHNICIAN: "Technicien", ADMIN: "Administrateur" },
    loanStatus: { ACTIVE: "Actif", RETURN_PENDING: "Retour en cours", COMPLETED: "Terminé" },
    reservationStatus: { ACTIVE: "Active", FULFILLED: "Honorée · retrait confirmé", CANCELLED: "Annulée", EXPIRED: "Expirée" },
    anomalyStatus: { OPEN: "Ouverte", ACKNOWLEDGED: "Reconnue", RESOLVED: "Résolue" },
    severity: { HIGH: "Élevée", MEDIUM: "Moyenne", LOW: "Faible" },
    anomalyType: {
      EXPECTED_ASSET_NOT_OBSERVED: "Équipement attendu non observé",
      UNEXPECTED_ASSET_OBSERVED: "Équipement inattendu observé",
      ASSET_PRESENT_WITH_ACTIVE_LOAN: "Équipement présent malgré un prêt actif",
      DOOR_NOT_CLOSED_BEFORE_EXPIRY: "Porte non refermée avant l'échéance",
      COMMAND_REJECTED: "Commande refusée par le casier",
      DEVICE_OFFLINE_DURING_OPERATION: "Casier hors ligne pendant l'opération",
      INCONSISTENT_PHYSICAL_STATE: "État physique incohérent"
    },
    observation: {
      DOOR_OPENED: "Porte ouverte", DOOR_CLOSED: "Porte fermée",
      LOCK_UNLOCKED: "Serrure déverrouillée", LOCK_LOCKED: "Serrure verrouillée",
      ASSET_PRESENT: "Équipement présent", ASSET_ABSENT: "Équipement absent",
      ASSET_IDENTIFIER_DETECTED: "Identifiant détecté", DEVICE_RESTARTED: "Redémarrage du casier"
    },
    operation: {
      REQUESTED: ["Demande envoyée", "Patientez."],
      AWAITING_LOCAL_PROOF_PENDING: ["Le code s'affiche sur le casier", "Approchez-vous de l'écran du casier."],
      AWAITING_LOCAL_PROOF: ["Scannez le code du casier", "Aucune porte n'est ouverte."],
      AUTHORIZED: ["Accès autorisé", "Déverrouillage de A1 en préparation. N'ouvrez pas encore."],
      COMMAND_SENT: ["Commande transmise au casier", "Attendez le signal de la cellule A1."],
      COMMAND_ACKNOWLEDGED: ["Déverrouillage lancé", "Ouvrez la porte A1 et retirez le multimètre. Si elle reste fermée, ne forcez pas et attendez le message suivant."],
      DOOR_OPENED: ["Porte ouverte", "Retirez l'équipement, puis refermez la porte."],
      OBSERVATION_RECEIVED: ["Vérification en cours", "Gardez la porte fermée."],
      CONFIRMED: ["Retrait confirmé", ""],
      FAILED: ["Opération arrêtée sans ouverture", "Vous pouvez recommencer."],
      EXPIRED: ["Délai dépassé", "Aucune porte n'a été ouverte. Recommencez la préparation."],
      ANOMALY: ["Intervention requise", "Ne réessayez pas. Un administrateur doit vérifier la cellule A1."]
    },
    connection: { ONLINE: "En ligne", OFFLINE: "Hors ligne", UNKNOWN: "État inconnu" },
    sections: {
      ios: [["equipements", "Équipements", "box"], ["activite", "Mon activité", "activity"], ["compte", "Compte", "person"]],
      web: [["vue", "Vue d'ensemble", "grid"], ["equipements", "Équipements", "box"], ["transactions", "Réservations et prêts", "calendar"], ["casiers", "Casiers", "locker"], ["anomalies", "Anomalies", "alert"], ["audit", "Audit", "list"]]
    }
  };

  // ------------------------------------------------------ fixture access
  function snapshot(key) {
    let s = fx.snapshots[key];
    while (s && s.ref) s = fx.snapshots[s.ref];
    return s;
  }
  /** Merged read model at a moment. */
  function at(key) {
    const s = snapshot(key);
    const assets = {};
    Object.keys(fx.assets).forEach(code => {
      const base = fx.assets[code];
      const st = (s.assets && s.assets[code]) || {};
      assets[code] = Object.assign({}, base, { model: fx.models[code] }, st);
    });
    return {
      key, moment: fx.moments[key], snap: s, assets,
      assetList: Object.keys(assets).sort().map(k => assets[k]),
      locker: Object.assign({}, fx.locker, s.locker || {}, { compartmentsState: s.compartments || {} }),
      reservation: s.reservation ? Object.assign({}, fx.reservation, s.reservation) : null,
      operation: s.operation ? Object.assign({}, fx.checkoutOperation, s.operation) : null,
      loan: s.loan ? Object.assign({}, fx.loan, s.loan) : null,
      anomaly: (s.anomalies && s.anomalies.length) ? Object.assign({}, fx.anomaly, s.anomalies[0]) : null,
      users: fx.users, institution: fx.institutionLabel.value,
      currentWindow: fx.currentWindow
    };
  }

  // ------------------------------------------- domain state → presentation
  function sortReasons(r) { return r.slice().sort((a, b) => copy.reasonOrder.indexOf(a) - copy.reasonOrder.indexOf(b)); }
  const status = {
    /** Technician status, sections.md §1.2 (defensive: BORROWED never « Prêt »). */
    technician(asset, view) {
      const cell = asset.placement ? asset.placement.compartmentCode : "";
      const r = asset.readiness || { result: "UNKNOWN", reasons: [] };
      if (asset.availability === "BORROWED") {
        if (view.loan && view.loan.assetCode === asset.assetCode) {
          return view.loan.overdue
            ? { kind: "overdue", label: "Emprunté par vous", secondary: `En retard depuis ${fmt.time(view.loan.dueAt)}` }
            : { kind: "mine", icon: "st-borrowed", label: "Emprunté par vous", secondary: `Retour prévu à ${fmt.time(view.loan.dueAt)}` };
        }
        return { kind: "neutral", label: "Emprunté", secondary: "Indisponible jusqu'au retour" };
      }
      if (asset.availability === "RESERVED") {
        if (view.reservation && view.reservation.assetCode === asset.assetCode && view.reservation.status === "ACTIVE") {
          return { kind: "mine", icon: "st-reserved", label: "Réservé pour vous", secondary: `À retirer avant ${fmt.time(view.reservation.reservedUntil)}` };
        }
        return { kind: "neutral", label: "Déjà réservé", secondary: "Indisponible pour le moment" };
      }
      if (asset.availability === "UNAVAILABLE") return { kind: "neutral", label: "Indisponible", secondary: "Retiré de la circulation par l'administration" };
      if (r.result === "READY") return { kind: "ready", label: "Prêt", secondary: `Disponible dans la cellule ${cell}` };
      if (r.result === "UNKNOWN") return { kind: "unknown", label: "À vérifier", secondary: "Présence non confirmée par le casier" };
      const reasons = sortReasons(r.reasons);
      return {
        kind: "blocked", label: "Bloqué", reasons,
        secondary: copy.reasons[reasons[0]](asset),
        more: reasons.length - 1,
        action: copy.reasonAction[reasons[0]]
      };
    },
    /**
     * Administrator operational diagnostic (09 §8.9 AdminAssetView.operationalDiagnostic
     * { evaluatedAt, reasons }). Derived ONLY from `reasons`: there is no result field,
     * no reference technician, never ACCESS_DENIED. An empty list is not readiness and
     * not a permission; it is shown neutrally, never as « Prêt », « Bloqué » or a check mark.
     */
    operationalDiagnostic(asset) {
      const d = asset.operationalDiagnostic;
      if (!d) return null;
      const reasons = sortReasons(d.reasons || []);
      if (!reasons.length) {
        return { kind: "neutral", icon: "st-info", empty: true, count: 0, reasons, label: "Aucun empêchement détecté", lines: [], evaluatedAt: d.evaluatedAt };
      }
      const n = reasons.length;
      return {
        kind: "blocked", empty: false, count: n, reasons, evaluatedAt: d.evaluatedAt,
        label: `${n} empêchement${n > 1 ? "s" : ""}`,
        lines: reasons.map(r => copy.reasons[r](asset)),
        short: reasons.map(r => copy.reasonShort[r])
      };
    },
    availabilityAdmin(asset, view) {
      if (asset.availability === "BORROWED" && view.loan && view.loan.overdue) return { kind: "overdue", label: copy.availabilityAdmin.BORROWED_OVERDUE };
      const map = { AVAILABLE: "available", RESERVED: "mine", BORROWED: "mine", UNAVAILABLE: "neutral" };
      return { kind: map[asset.availability], label: copy.availabilityAdmin[asset.availability] };
    }
  };

  // ----------------------------------------------------------------- icons
  // Simple geometric placeholders for SF Symbols. Status icons: filled shape
  // (currentColor = status icon token) + glyph in --ag-glyph.
  const G = 'stroke="var(--ag-glyph)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"';
  const S = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    // status shapes
    "st-ready": `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.4 12.3l3.1 3.1 6.1-6.6" ${G}/>`,
    "st-blocked": `<path d="M8.1 2.6h7.8l5.5 5.5v7.8l-5.5 5.5H8.1l-5.5-5.5V8.1z" fill="currentColor"/><path d="M7.5 12h9" ${G}/>`,
    "st-unknown": `<path d="M12 1.6L22.4 12 12 22.4 1.6 12z" fill="currentColor"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.7.3-1 .8-1 1.5v.4" ${G}/><circle cx="12" cy="16.6" r="1.2" fill="var(--ag-glyph)"/>`,
    "st-reserved": `<rect x="2.2" y="2.2" width="19.6" height="19.6" rx="5.5" fill="currentColor"/><path d="M8.6 6.8h6.8v10.6L12 14.9l-3.4 2.5z" ${G}/>`,
    "st-borrowed": `<rect x="2.2" y="2.2" width="19.6" height="19.6" rx="5.5" fill="currentColor"/><path d="M9 15l6.3-6.3M10.2 8.6h5.2v5.2" ${G}/>`,
    "st-neutral": `<rect x="2.2" y="2.2" width="19.6" height="19.6" rx="5.5" fill="currentColor"/><rect x="8" y="11" width="8" height="6" rx="1.3" ${G}/><path d="M9.6 11V9.4a2.4 2.4 0 0 1 4.8 0V11" ${G}/>`,
    "st-info": `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 11v5.4" ${G}/><circle cx="12" cy="7.6" r="1.3" fill="var(--ag-glyph)"/>`,
    "st-available": `<circle cx="12" cy="12" r="10" fill="currentColor"/><circle cx="12" cy="12" r="3.4" fill="var(--ag-glyph)"/>`,
    "st-overdue": `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7v5.2l3.2 2" ${G}/>`,
    "st-alert": `<path d="M12 2.2c.6 0 1.1.3 1.4.8l9 15.8c.6 1.1-.2 2.4-1.4 2.4H3c-1.2 0-2-1.3-1.4-2.4l9-15.8c.3-.5.8-.8 1.4-.8z" fill="currentColor"/><path d="M12 8.6v5" ${G}/><circle cx="12" cy="17" r="1.25" fill="var(--ag-glyph)"/>`,
    "st-progress": `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 6.8a5.2 5.2 0 1 1-5.2 5.2" ${G}/>`,
    "st-success": `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.4 12.3l3.1 3.1 6.1-6.6" ${G}/>`,
    "st-failed": `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.6 8.6l6.8 6.8M15.4 8.6l-6.8 6.8" ${G}/>`,
    "st-expired": `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.5 6.8h7M8.5 17.2h7M9.3 6.8c0 3 5.4 3.4 5.4 5.2s-5.4 2.2-5.4 5.2" ${G}/>`,
    "st-online": `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.6 10.4a6.2 6.2 0 0 1 8.8 0M9.6 12.9a3.2 3.2 0 0 1 4.8 0" ${G}/><circle cx="12" cy="15.8" r="1.2" fill="var(--ag-glyph)"/>`,
    "st-offline": `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.6 10.4a6.2 6.2 0 0 1 8.8 0M7 7l10 10" ${G}/>`,
    // UI glyphs (stroke)
    search: `<circle cx="10.8" cy="10.8" r="6.3" ${S}/><path d="M15.5 15.5l4.6 4.6" ${S}/>`,
    "chevron-right": `<path d="M9.5 5.5L16 12l-6.5 6.5" ${S}/>`,
    "chevron-down": `<path d="M6 9.5l6 6 6-6" ${S}/>`,
    "chevron-left": `<path d="M14.5 5.5L8 12l6.5 6.5" ${S}/>`,
    updown: `<path d="M8 9.5l4-4 4 4M8 14.5l4 4 4-4" ${S}/>`,
    sort: `<path d="M7.5 19V5M4 8.5L7.5 5 11 8.5M16.5 5v14M13 15.5l3.5 3.5 3.5-3.5" ${S}/>`,
    filter: `<path d="M4 6.5h16M7 12h10M10 17.5h4" ${S}/>`,
    plus: `<path d="M12 5v14M5 12h14" ${S}/>`,
    xmark: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" ${S}/>`,
    calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="3" ${S}/><path d="M3.5 10h17M8 3v4M16 3v4" ${S}/>`,
    clock: `<circle cx="12" cy="12" r="8.5" ${S}/><path d="M12 7.5V12l3 2" ${S}/>`,
    info: `<circle cx="12" cy="12" r="8.5" ${S}/><path d="M12 11v5.2" ${S}/><circle cx="12" cy="7.9" r="1.1" fill="currentColor"/>`,
    lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.5" ${S}/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" ${S}/>`,
    box: `<path d="M12 3l8 4.3v9.4L12 21l-8-4.3V7.3z" ${S}/><path d="M4 7.3l8 4.4 8-4.4M12 11.7V21" ${S}/>`,
    activity: `<rect x="5" y="4" width="14" height="17" rx="3" ${S}/><path d="M9 4.2V3h6v1.2M8.8 12.3l2.2 2.2 4.2-4.4" ${S}/>`,
    person: `<circle cx="12" cy="12" r="9" ${S}/><circle cx="12" cy="10" r="3.2" ${S}/><path d="M6.4 18.2a6.6 6.6 0 0 1 11.2 0" ${S}/>`,
    grid: `<rect x="4" y="4" width="7" height="7" rx="2" ${S}/><rect x="13" y="4" width="7" height="7" rx="2" ${S}/><rect x="4" y="13" width="7" height="7" rx="2" ${S}/><rect x="13" y="13" width="7" height="7" rx="2" ${S}/>`,
    locker: `<rect x="4" y="3.5" width="16" height="17" rx="2.5" ${S}/><path d="M12 3.5v17M9.2 10.5v3M14.8 10.5v3" ${S}/>`,
    alert: `<path d="M12 4l8.8 15.2H3.2z" ${S}/><path d="M12 10v4" ${S}/><circle cx="12" cy="16.9" r="1" fill="currentColor"/>`,
    list: `<path d="M9 6.5h11M9 12h11M9 17.5h11" ${S}/><circle cx="5" cy="6.5" r="1.2" fill="currentColor"/><circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="5" cy="17.5" r="1.2" fill="currentColor"/>`,
    qrframe: `<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3" ${S}/><rect x="8.5" y="8.5" width="7" height="7" rx="1" ${S}/>`,
    eye: `<path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z" ${S}/><circle cx="12" cy="12" r="2.8" ${S}/>`,
    arrow: `<path d="M5 12h14M13 6l6 6-6 6" ${S}/>`,
    tag: `<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7z" ${S}/><circle cx="8" cy="8" r="1.4" ${S}/>`,
    pin: `<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" ${S}/><circle cx="12" cy="10" r="2.3" ${S}/>`,
    logout: `<path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10M14.5 8l4 4-4 4M18.5 12H9" ${S}/>`,
    history: `<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.2h3.2" ${S}/><path d="M12 8v4.3l2.8 1.7" ${S}/>`,
    shield: `<path d="M12 3l7 2.6v5.6c0 4.6-3 8-7 9.8-4-1.8-7-5.2-7-9.8V5.6z" ${S}/>`,
    external: `<path d="M13.5 5.5h5v5M18.5 5.5l-8 8M10 6.5H7a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 7 18.5h9a1.5 1.5 0 0 0 1.5-1.5v-3" ${S}/>`,
    more: `<circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/>`,
    check: `<path d="M5.5 12.5l4.2 4.2 8.8-9.4" ${S}/>`
  };
  function icon(name, cls) {
    const body = ICONS[name];
    if (!body) return "";
    return `<svg class="ag-ico ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  const KIND_ICON = {
    ready: "st-ready", blocked: "st-blocked", unknown: "st-unknown", mine: "st-reserved",
    neutral: "st-neutral", available: "st-available", overdue: "st-overdue", anomaly: "st-alert",
    "sev-high": "st-alert", "sev-medium": "st-alert", "sev-low": "st-alert",
    progress: "st-progress", success: "st-success", failed: "st-failed", expired: "st-expired",
    online: "st-online", offline: "st-offline"
  };

  // ------------------------------------------------------------ components
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const c = {
    /**
     * Status label — symbol + shape + French text; never colour alone.
     * kind: ready|blocked|unknown|mine|neutral|available|overdue|anomaly|
     *       sev-high|sev-medium|sev-low|progress|success|failed|expired|online|offline
     * opts.size: sm|md|lg   opts.variant: pill (filled) | plain (text only)
     * opts.icon: override status icon (e.g. "st-borrowed")
     */
    status(kind, label, opts) {
      const o = opts || {};
      const ic = o.icon || KIND_ICON[kind] || "st-neutral";
      return `<span class="ag-status ag-status--${kind} ag-status--${o.size || "md"} ag-status--${o.variant || "pill"}">${icon(ic, "ag-status__icon")}<span class="ag-status__text">${esc(label)}</span></span>`;
    },
    /** Status from a presentation object {kind,label,icon}. */
    statusOf(p, opts) { return c.status(p.kind, p.label, Object.assign({ icon: p.icon }, opts || {})); },
    /** Blocking-reason line: primary reason, "+ N autre(s) raison(s)", optional action. */
    reason(text, opts) {
      const o = opts || {};
      const more = o.more ? `<span class="ag-reason__more">+ ${o.more} autre${o.more > 1 ? "s" : ""} raison${o.more > 1 ? "s" : ""}</span>` : "";
      const action = o.action ? `<span class="ag-reason__action">${esc(o.action)}</span>` : "";
      return `<span class="ag-reason ag-reason--${o.kind || "blocked"}">${o.noIcon ? "" : icon(o.icon || "st-blocked", "ag-reason__icon")}<span class="ag-reason__body"><span class="ag-reason__text">${esc(text)}</span>${more}${action}</span></span>`;
    },
    /** Mock-data marker (annotation layer). ref: C4…C8 | F | SIM (C1–C3 are normative in 09 v1.3) */
    mock(ref, opts) {
      const o = opts || {};
      const label = ref === "SIM" ? "Simulation" : ref === "F" ? "Fictif" : `Fictif · ${ref}`;
      return `<span class="ag-mock${o.block ? " ag-mock--block" : ""}" data-mock="${esc(ref)}" title="${esc((window.AEGIS_MOCK_LEGEND || {})[ref] || "")}">${label}</span>`;
    },
    /** Button. variant: primary|secondary|tertiary|destructive ; size: sm|md|lg */
    btn(label, opts) {
      const o = opts || {};
      const ic = o.icon ? icon(o.icon, "ag-btn__icon") : "";
      return `<button type="button" class="ag-btn ag-btn--${o.variant || "primary"} ag-btn--${o.size || "md"}${o.block ? " ag-btn--block" : ""}"${o.disabled ? " disabled aria-disabled=\"true\"" : ""}>${ic}<span>${esc(label)}</span></button>`;
    },
    /** Countdown: ring + "Expire dans 0:47". */
    countdown(seconds, total, opts) {
      const o = opts || {};
      const r = 21, circ = 2 * Math.PI * r, frac = Math.max(0, Math.min(1, seconds / total));
      return `<div class="ag-countdown${o.compact ? " ag-countdown--compact" : ""}" role="timer" aria-label="${esc(o.prefix || "Expire dans")} ${fmt.countdown(seconds)}">
        <svg class="ag-countdown__ring" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="${r}" class="ag-countdown__track"/><circle cx="24" cy="24" r="${r}" class="ag-countdown__value" stroke-dasharray="${(circ * frac).toFixed(2)} ${circ.toFixed(2)}" transform="rotate(-90 24 24)"/></svg>
        <span class="ag-countdown__text"><span class="ag-countdown__prefix">${esc(o.prefix || "Expire dans")}</span> <span class="ag-countdown__value-text">${fmt.countdown(seconds)}</span></span>
      </div>`;
    },
    /**
     * Chronology rows. items: [{time, title, detail, state: done|current|pending|failed|anomaly, code}]
     * `code` (raw state) is shown only when opts.showCodes (Web audit/technical context, sections.md §1.1).
     */
    chrono(items, opts) {
      const o = opts || {};
      return `<ol class="ag-chrono">${items.map(it => `<li class="ag-chrono__row ag-chrono__row--${it.state || "done"}">
        <span class="ag-chrono__time">${esc(it.time || "")}</span>
        <span class="ag-chrono__rail" aria-hidden="true"><span class="ag-chrono__dot"></span></span>
        <span class="ag-chrono__body"><span class="ag-chrono__title">${esc(it.title)}</span>${it.detail ? `<span class="ag-chrono__detail">${esc(it.detail)}</span>` : ""}${o.showCodes && it.code ? `<code class="ag-chrono__code">${esc(it.code)}</code>` : ""}</span>
      </li>`).join("")}</ol>`;
    },
    /** Evidence rows — normalized observations only (09 §18.1). items: [{time, cell, label, detail, context, key}] */
    evidence(items) {
      return `<ul class="ag-evidence">${items.map(it => `<li class="ag-evidence__row${it.key ? " is-key" : ""}">
        <span class="ag-evidence__time">${esc(it.time)}</span>
        <span class="ag-evidence__cell">${esc(it.cell)}</span>
        <span class="ag-evidence__body"><span class="ag-evidence__label">${esc(it.label)}</span>${it.detail ? `<span class="ag-evidence__detail">${esc(it.detail)}</span>` : ""}</span>
        ${it.context ? `<span class="ag-evidence__context">${esc(it.context)}</span>` : ""}
      </li>`).join("")}</ul>`;
    },
    /** Scanner viewfinder placeholder. Always a SIMULATION: pattern is decorative, carries no token. */
    scanner(opts) {
      const o = opts || {};
      // Deterministic decorative pattern; deliberately lacks QR finder patterns so it cannot be read as a code.
      let cells = "";
      let seed = 7;
      for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        if ((seed >> 16) % 3 === 0) cells += `<rect x="${x * 8}" y="${y * 8}" width="7" height="7" rx="1.5"/>`;
      }
      return `<div class="ag-scanner${o.dimmed ? " ag-scanner--dimmed" : ""}">
        <div class="ag-scanner__camera" aria-hidden="true"></div>
        <div class="ag-scanner__frame">
          <span class="ag-scanner__corner ag-scanner__corner--tl"></span><span class="ag-scanner__corner ag-scanner__corner--tr"></span>
          <span class="ag-scanner__corner ag-scanner__corner--bl"></span><span class="ag-scanner__corner ag-scanner__corner--br"></span>
          <svg class="ag-scanner__code" viewBox="0 0 104 104" aria-hidden="true">${cells}</svg>
          <span class="ag-scanner__sim">Simulation — code fictif, aucun jeton</span>
        </div>
        ${o.caption ? `<p class="ag-scanner__caption">${esc(o.caption)}</p>` : ""}
      </div>`;
    },
    /** Dialog (Web modal / iOS alert-like card). actions: HTML of buttons. */
    dialog(opts) {
      return `<div class="ag-dialog-layer"><div class="ag-dialog" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 class="ag-dialog__title" id="dlg-title">${esc(opts.title)}</h2>
        <div class="ag-dialog__body">${opts.body || ""}</div>
        <div class="ag-dialog__actions">${opts.actions || ""}</div>
      </div></div>`;
    },
    /** Label/value pair used in inspectors and detail views. */
    fact(label, valueHtml, opts) {
      const o = opts || {};
      return `<div class="ag-fact${o.wide ? " ag-fact--wide" : ""}"><dt class="ag-fact__label">${esc(label)}${o.mock ? " " + c.mock(o.mock) : ""}</dt><dd class="ag-fact__value">${valueHtml}</dd></div>`;
    },
    wordmark(sub) {
      return `<span class="ag-wordmark"><span class="ag-wordmark__name">Aegis</span>${sub ? `<span class="ag-wordmark__sub">${esc(sub)}</span>` : ""}</span>`;
    },
    esc
  };

  // --------------------------------------------------------- iOS chrome
  const ios = {
    /** System status bar (system chrome, not product UI). */
    statusBar(iso, opts) {
      const o = opts || {};
      return `<div class="ios-statusbar${o.onDark ? " ios-statusbar--light" : ""}" aria-hidden="true">
        <span class="ios-statusbar__time">${fmt.statusClock(iso)}</span>
        <span class="ios-statusbar__island"></span>
        <span class="ios-statusbar__icons">
          <svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
          <svg viewBox="0 0 17 12" width="17" height="12"><path d="M8.5 2.3c2.4 0 4.6.9 6.3 2.5l1.2-1.2A10.6 10.6 0 0 0 8.5.6 10.6 10.6 0 0 0 1 3.6l1.2 1.2a9 9 0 0 1 6.3-2.5zm0 3.4c1.5 0 2.9.6 4 1.6l1.2-1.2a7.3 7.3 0 0 0-10.4 0l1.2 1.2c1.1-1 2.5-1.6 4-1.6zm0 3.4c.6 0 1.2.2 1.6.6L8.5 11.3 6.9 9.7c.4-.4 1-.6 1.6-.6z"/></svg>
          <svg viewBox="0 0 27 13" width="27" height="13"><rect x=".5" y=".5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="17.5" height="9" rx="2.5"/><path d="M25 4.4v4.2c.8-.3 1.4-1.1 1.4-2.1s-.6-1.8-1.4-2.1z" opacity=".45"/></svg>
        </span>
      </div>`;
    },
    homeIndicator() { return `<div class="ios-home" aria-hidden="true"></div>`; },
    /** Floating Liquid Glass–style tab bar: Équipements / Mon activité / Compte. */
    tabBar(active) {
      return `<nav class="ios-tabbar ag-glass" aria-label="Onglets">${copy.sections.ios.map(([id, label, ic]) =>
        `<a class="ios-tabbar__item${id === active ? " is-active" : ""}"${id === active ? ' aria-current="page"' : ""}>${icon(ic, "ios-tabbar__icon")}<span class="ios-tabbar__label">${label}</span></a>`).join("")}</nav>`;
    },
    /** Glass circular toolbar button (trailing nav items). */
    toolbarButton(ic, label) {
      return `<button type="button" class="ios-toolbtn ag-glass" aria-label="${esc(label)}">${icon(ic)}</button>`;
    },
    /** Sheet with grabber. opts.detent: "medium"|"large"; opts.title; content HTML. */
    sheet(content, opts) {
      const o = opts || {};
      return `<div class="ios-dim" aria-hidden="true"></div><section class="ios-sheet ios-sheet--${o.detent || "medium"}" role="dialog" aria-label="${esc(o.title || "")}">
        <div class="ios-sheet__grabber" aria-hidden="true"></div>
        ${o.title ? `<header class="ios-sheet__header">${o.leading || ""}<h2 class="ios-sheet__title">${esc(o.title)}</h2>${o.trailing || ""}</header>` : ""}
        <div class="ios-sheet__content">${content}</div>
      </section>`;
    }
  };

  // --------------------------------------------------------- Web chrome
  const web = {
    /** Sidebar: wordmark, optional institution label (C6), six sections, account area. */
    sidebar(active, view) {
      const admin = view.users.admin;
      const initials = admin.displayName.split(" ").map(w => w[0]).join("").slice(0, 2);
      return `<aside class="web-sidebar ag-glass" aria-label="Navigation principale">
        <div class="web-sidebar__brand">${c.wordmark("Manager")}
          <div class="web-sidebar__institution"><span>${esc(view.institution)}</span>${c.mock("C6")}</div>
        </div>
        <nav class="web-nav"><ul>${copy.sections.web.map(([id, label, ic]) =>
          `<li><a class="web-nav__item${id === active ? " is-active" : ""}"${id === active ? ' aria-current="page"' : ""} href="#">${icon(ic, "web-nav__icon")}<span>${label}</span></a></li>`).join("")}</ul></nav>
        <div class="web-account">
          <span class="web-account__avatar" aria-hidden="true">${esc(initials)}</span>
          <span class="web-account__who"><span class="web-account__name">${esc(admin.displayName)}</span><span class="web-account__role">${copy.role[admin.role]}</span></span>
          <button type="button" class="web-account__menu" aria-label="Menu du compte : apparence, déconnexion">${icon("updown")}</button>
        </div>
      </aside>`;
    },
    /** Locker connectivity chip for the top bar (LockerStatusView, 09 §8.6). */
    lockerChip(view) {
      const l = view.locker;
      const k = l.connectionStatus === "ONLINE" ? "online" : "offline";
      return `<span class="web-lockerchip">${c.status(k, copy.connection[l.connectionStatus], { size: "sm" })}<span class="web-lockerchip__meta">Casier ${esc(l.code)} · dernier signal ${fmt.time(l.lastSeenAt)}</span></span>`;
    }
  };

  function mount(fn) {
    const app = document.getElementById("app");
    app.innerHTML = fn();
    document.title = document.title || "Aegis prototype";
  }

  window.AG = { theme, treatment, platform, fx, at, fmt, copy, status, icon, c, ios, web, mount, params };
})();
