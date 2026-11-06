import type { RouteId } from '../../app/routes'
import type { AccessLevel } from '../../features/auth/contract'
import type { FieldErrorCode } from '../../features/auth/signInValidation'
import type { Availability, DiagnosticReason, OperationalStatus, Presence } from '../../features/catalog/contract'
import { createPluralSelector } from '../plural'

/**
 * French catalog: the reference for the shape of every other catalog (en.ts is
 * typed against it, so a missing key fails `tsc`) and the fallback language.
 * Texts are those of docs/design/manager-entree/ (states.md §3, handoff §7):
 * [A] = approved, everything else [P] = proposed, awaiting Philippe's approval.
 *
 * Rules (docs/localisation/convention.md): one complete sentence per message,
 * values inserted already formatted, named parameters, plurals through
 * `createPluralSelector`, never a server `title`/`detail`. U+00A0 precedes
 * « : ? » and the narrow gaps the handoff requires.
 */
const NBSP = '\u00A0'
const plural = createPluralSelector('fr')
const count = new Intl.NumberFormat('fr-CA')

export const fr = {
  brand: {
    /** Accessible name of the brand link; « aegis » and « Manager » are names and are never translated. */
    homeLabel: 'Aegis Manager, accueil',
    /** [A] Common signature, decided on 2026-10-21 (glossary « Signatures de marque »); « Prêt » is READY. */
    signature: {
      /** [A] */
      ready: 'Prêt.',
      /** [A] */
      authorized: 'Autorisé.',
      /** [A] */
      proven: 'Prouvé.',
    },
    /** [A] Decided on 2026-10-21. */
    tagline: 'L’essentiel, sous contrôle.',
    /** [A] Decided on 2026-10-21. */
    description: 'Disponibilité, conformité et traçabilité de vos équipements.',
  },

  language: {
    legend: 'Langue',
  },

  appearance: {
    legend: 'Apparence',
    system: 'Système',
    light: 'Clair',
    dark: 'Sombre',
  },

  pageTitle: {
    landing: 'Aegis Manager',
    signIn: 'Connexion — Aegis Manager',
    equipment: 'Équipements — Aegis Manager',
    equipmentPreview: 'Équipements — Aegis Manager',
    lockers: 'Casiers — Aegis Manager',
    notFound: 'Page introuvable — Aegis Manager',
  } satisfies Record<RouteId, string>,

  shell: {
    skipLink: 'Aller au contenu principal',
    sectionsLabel: 'Sections',
    accountLabel: 'Compte',
    administratorRole: 'Administrateur',
    openMenu: 'Ouvrir le menu',
    closeMenu: 'Fermer le menu',
    menuTitle: 'Menu',
    signOut: 'Se déconnecter',
    soonLegend: 'Section à venir',
    soonSuffix: ', à venir',
    /** Order imposed by sections.md §5 and handoff §6 SidebarNav. */
    sections: {
      overview: "Vue d'ensemble",
      equipment: 'Équipements',
      reservationsLoans: 'Réservations et prêts',
      lockers: 'Casiers',
      anomalies: 'Anomalies',
      audit: 'Audit',
    },
  },

  landing: {
    signIn: 'Se connecter',
    seeGuarantees: 'Voir les cinq garanties',
    /** [A] */
    accountNote: 'Compte fourni par votre administrateur.',
    mockCaption: "Diagnostic d'un exemplaire",
    mockBadge: 'Exemple illustratif',
    blockers: ({ count: value }: { count: number }) =>
      plural(value, { one: `${count.format(value)} empêchement`, other: `${count.format(value)} empêchements` }),
    noBlockers: 'Aucun empêchement détecté',
    calibrationExpired: ({ date }: { date: string }) => `Calibration expirée depuis le ${date}`,
    guaranteesLabel: 'Cinq garanties du P0',
    guarantees: {
      readiness: {
        title: 'Disponibilité réelle',
        text: `Chaque équipement indique s'il peut servir; sinon, la raison précise${NBSP}: calibration expirée, maintenance, absence de sa cellule.`,
      },
      checkout: {
        title: 'Retrait conforme',
        text: "Le serveur refuse un retrait non autorisé ou non conforme; l'interface l'explique, elle ne le décide pas.",
      },
      compartment: {
        title: 'Bonne cellule',
        text: "Seule la cellule attendue s'ouvre, après une autorisation valide. Une réservation ou un code affiché n'ouvre rien.",
      },
      proof: {
        title: 'Preuve physique',
        text: 'Retrait et retour sont confirmés par des observations cohérentes du casier, jamais par un simple clic.',
      },
      custody: {
        title: 'Chaîne de possession',
        text: "Chaque action et chaque observation restent consultables dans l'audit, sans effacement.",
      },
    },
    footerPrototype: "Prototype académique en cours de validation en laboratoire, conçu pour les équipes de maintenance et d'inspection.",
    footerTechnician: `Technicien${NBSP}? Utilisez Aegis Mobile sur iPhone.`,
  },

  signIn: {
    /** [A] */
    heading: 'Connexion',
    /** [A] */
    accountNote: 'Compte fourni par votre administrateur.',
    /** [A] */
    emailLabel: 'Adresse courriel',
    /** [A] */
    passwordLabel: 'Mot de passe',
    /** [A] */
    submit: 'Se connecter',
    /** [A] Eyebrow above the title, from the v3 mock. */
    role: 'Espace administrateur',
    /** [A] */
    subtitle: 'Accédez à Aegis Manager.',
    home: 'Accueil',
    /** [A] */
    footerProduct: 'Aegis Manager · Administration',
    footerTechnician: `Technicien${NBSP}? Utilisez Aegis Mobile sur iPhone.`,
    fieldError: {
      emailRequired: 'Saisissez votre adresse courriel.',
      emailInvalid: 'Saisissez une adresse courriel valide, par exemple nom@example.com.',
      emailTooLong: "L'adresse courriel ne peut pas dépasser 320 caractères.",
      passwordRequired: 'Saisissez votre mot de passe.',
      /** Server violation on a password the client accepted (review R5). */
      passwordRejected: "Ce mot de passe n'est pas accepté. Vérifiez-le, puis réessayez.",
    } satisfies Record<FieldErrorCode, string>,
    validationUnknown: 'Vérifiez les champs indiqués, puis réessayez.',
    submitting: 'Connexion…',
    submittingStatus: 'Connexion en cours.',
    reveal: 'Afficher',
    conceal: 'Masquer',
    revealLabel: 'Afficher le mot de passe',
    concealLabel: 'Masquer le mot de passe',
    revealedStatus: 'Votre mot de passe est visible.',
    concealedStatus: 'Votre mot de passe est masqué.',
    /** [A] */
    invalidCredentialsTitle: 'Adresse courriel ou mot de passe incorrect.',
    invalidCredentialsBody: 'Vérifiez les deux champs, puis réessayez.',
    /** [A] */
    rateLimitedTitle: 'Trop de tentatives.',
    /** [A→P] T1: the one place the delay is shown, fixed when the 429 arrives; `duration` is already formatted (« 42 secondes »). */
    rateLimitedBody: ({ duration }: { duration: string }) => `Réessayez dans ${duration}.`,
    /** [A] Shown when the 429 carries no usable Retry-After. */
    rateLimitedFallback: 'Réessayez dans une minute.',
    rateLimitedReady: 'Vous pouvez réessayer.',
    /** [A] */
    unreachableTitle: 'Connexion au service impossible.',
    /** [A] wording split into title and body; « puis réessayez » added [P] (T3). */
    unreachableBody: 'Vérifiez le réseau, puis réessayez.',
    serviceErrorTitle: "Le service n'a pas pu traiter la connexion.",
    serviceErrorBody: "Réessayez dans un instant. Si le problème persiste, transmettez l'identifiant de suivi au support.",
    /** [A] Visible label of the traceId, shared with iOS (glossary, decided on 2026-10-21); the traceId itself is never translated. */
    traceIdLabel: `Identifiant de suivi${NBSP}:`,
    /** Not in states.md: same message when no traceId is available. */
    serviceErrorBodyWithoutCode: 'Réessayez dans un instant.',
    /** [A] */
    sessionExpiredTitle: 'Votre session a expiré. Reconnectez-vous.',
    /** [A→P] T2. */
    sessionExpiredBody: "L'expiration ne modifie ni les réservations, ni les prêts, ni les opérations en cours.",
    sessionInvalidTitle: "Votre session n'est plus valide. Reconnectez-vous.",
    sessionInvalidBody: "Aucune réservation, aucun prêt ni aucune opération n'a été modifié.",
    signedOutTitle: 'Vous êtes déconnecté.',
    roleHeading: 'Accès réservé aux administrateurs',
    roleBody: "Aegis Manager est réservé aux comptes administrateur. Aucune donnée n'a été chargée et la session a été fermée.",
    /** [A] Names the mobile app as the footers do (Aegis Mobile). */
    technicianAccount: "Ce compte technicien s'utilise dans Aegis Mobile.",
    roleUnknownTitle: 'Ce compte ne peut pas utiliser Aegis Manager.',
    roleAccountUsed: `Compte utilisé${NBSP}:`,
    roleRetry: 'Se connecter avec un autre compte',
  },

  /**
   * Équipements (CAT-01, read-only list and dossier). Every text below is [P]: proposed, awaiting
   * Philippe's approval. Reasons, statuses and calibration follow docs/localisation/glossaire.md;
   * codes (REST enums, assetCode, traceId) are never translated, only their presentation.
   */
  equipment: {
    heading: 'Équipements',
    viewsLabel: 'Vues des équipements',
    unitsTab: 'Exemplaires',
    modelsTab: 'Modèles',
    selectedOverline: 'Exemplaire sélectionné',
    listTitle: ({ count: value }: { count: number }) =>
      plural(value, { one: `${count.format(value)} exemplaire`, other: `${count.format(value)} exemplaires` }),
    listMeta: 'Diagnostic opérationnel',
    listFoot: ({ time }: { time: string }) => `Triés par code · diagnostic évalué à ${time}`,
    blockers: ({ count: value }: { count: number }) =>
      plural(value, { one: `${count.format(value)} empêchement`, other: `${count.format(value)} empêchements` }),
    noBlockers: 'Aucun empêchement détecté',
    archived: 'Archivé',
    archivedOn: ({ date }: { date: string }) => `Archivé le ${date}`,
    /** « Disponible · Présence inconnue · En service »: availability, presence, service state. */
    facts: ({ availability, presence, status }: { availability: string; presence: string; status: string }) => `${availability} · ${presence} · ${status}`,

    loading: 'Chargement des exemplaires…',
    loaded: ({ count: value, page, pages }: { count: number; page: number; pages: number }) =>
      `Liste chargée${NBSP}: ${plural(value, { one: `${count.format(value)} exemplaire`, other: `${count.format(value)} exemplaires` })}, page ${count.format(page)} sur ${count.format(pages)}.`,
    selectedStatus: ({ name }: { name: string }) => `Exemplaire sélectionné${NBSP}: ${name}.`,
    detailLoading: "Chargement de l'exemplaire…",

    paginationLabel: 'Pagination des exemplaires',
    previousPage: 'Précédent',
    nextPage: 'Suivant',
    pageOf: ({ page, pages }: { page: number; pages: number }) => `Page ${count.format(page)} sur ${count.format(pages)}`,

    emptyTitle: 'Aucun exemplaire.',
    emptyBody: "Dès qu'un exemplaire est enregistré, il apparaît ici avec son diagnostic opérationnel.",

    retry: 'Réessayer',
    backToList: 'Retour à la liste',
    unreachableTitle: 'Connexion au service impossible.',
    unreachableBody: 'Vérifiez le réseau, puis réessayez.',
    serviceErrorTitle: "Le service n'a pas pu fournir ces données.",
    serviceErrorBody: "Réessayez dans un instant. Si le problème persiste, transmettez l'identifiant de suivi au support.",
    serviceErrorBodyWithoutCode: 'Réessayez dans un instant.',
    traceIdLabel: `Identifiant de suivi${NBSP}:`,
    forbiddenTitle: "Votre compte n'a pas accès aux équipements.",
    forbiddenBody: "Le serveur a refusé la demande. Aucune donnée n'a été chargée.",
    notFoundTitle: 'Exemplaire introuvable.',
    notFoundBody: "Cet exemplaire n'existe plus ou n'est plus accessible.",
    staleTitle: 'Données non actualisées.',
    staleBody: ({ time }: { time: string }) => `Les données affichées ont été évaluées à ${time}. La dernière actualisation a échoué.`,

    diagnosticTitle: 'Diagnostic opérationnel',
    diagnosticNote: ({ time }: { time: string }) =>
      `Empêchements non personnels connus (disponibilité, état de service, calibration, présence), évalués à ${time}. Une liste vide ne donne ni droit d'emprunt ni possibilité d'ouvrir le casier.`,
    unknownNote: `L'état physique n'est pas encore observé${NBSP}: aucune présence ni absence n'est supposée.`,
    derivedFacts: 'Faits dérivés',
    settings: 'Réglages',
    readOnly: 'lecture seule',
    factAvailability: 'Disponibilité',
    factPresence: 'Présence',
    factCalibration: 'Calibration',
    factPlacement: 'Placement',
    factSerialNumber: 'Numéro de série',
    settingAccessLevel: "Niveau d'accès requis",
    settingServiceState: 'État de service',
    settingCalibrationRequired: 'Calibration requise',
    settingCalibrationDue: 'Échéance de calibration',
    yes: 'Oui',
    no: 'Non',
    notProvided: 'Non renseigné',
    noPlacement: 'Aucun placement connu',
    presenceUnknownHelp: "Aucune observation de présence n'est disponible.",
    zoneNote: ({ zone }: { zone: string }) => `Fuseau du laboratoire${NBSP}: ${zone}`,

    /** 09 §3: a value this version does not know is shown as an unavailable state, never as a known one. */
    unrecognized: 'État indisponible',
    unrecognizedNote: "Une valeur envoyée par le serveur n'est pas reconnue par cette version de l'application. Elle est affichée comme état indisponible.",
    reason: {
      NOT_PRESENT: 'Absent du casier',
      NOT_AVAILABLE: 'Non disponible',
      MAINTENANCE: 'En maintenance',
      DAMAGED: 'Endommagé',
      CALIBRATION_EXPIRED: 'Calibration expirée',
      UNKNOWN_PHYSICAL_STATE: 'État physique inconnu',
    } satisfies Record<DiagnosticReason, string>,
    calibrationExpiredOn: ({ date }: { date: string }) => `Calibration expirée depuis le ${date}`,
    availability: {
      AVAILABLE: 'Disponible',
      RESERVED: 'Réservé',
      BORROWED: 'Emprunté',
      UNAVAILABLE: 'Indisponible',
    } satisfies Record<Availability, string>,
    presence: {
      PRESENT: 'Présent',
      ABSENT: 'Absent du casier',
      UNKNOWN: 'Inconnue',
    } satisfies Record<Presence, string>,
    presenceInline: {
      PRESENT: 'Présent',
      ABSENT: 'Absent du casier',
      UNKNOWN: 'Présence inconnue',
    } satisfies Record<Presence, string>,
    serviceState: {
      SERVICEABLE: 'En service',
      MAINTENANCE: 'En maintenance',
      DAMAGED: 'Endommagé',
    } satisfies Record<OperationalStatus, string>,
    accessLevel: {
      STANDARD: 'Standard',
      RESTRICTED: 'Restreint',
    } satisfies Record<AccessLevel, string>,
    calibrationStatus: {
      NOT_REQUIRED: 'Non requise',
      UNKNOWN: 'Échéance non renseignée',
    },
    calibrationValidUntil: ({ date }: { date: string }) => `Valide jusqu'au ${date}`,
    calibrationExpiredSince: ({ date }: { date: string }) => `Expirée depuis le ${date}`,
  },

  /**
   * Locker status (PHY-01 #29, 09 §8.6, §16.1). « En ligne », « Hors ligne », « État inconnu » come from the
   * approved Web direction (prototype `copy.connection`); every other text here is [P], proposed.
   */
  lockers: {
    heading: 'Casiers',
    loadingLockers: 'Recherche des casiers…',
    loadingStatus: 'Chargement du statut du casier…',
    /** Announced once, then only when the connection state changes. */
    announce: ({ code, connection }: { code: string; connection: string }) => `Casier ${code}${NBSP}: ${connection}.`,
    emptyTitle: 'Aucun casier trouvé parmi les équipements placés.',
    emptyBody: 'Un casier apparaît ici dès qu\'un exemplaire y est placé. Les placements se consultent dans Équipements.',
    emptyAction: 'Ouvrir Équipements',
    notFoundTitle: 'Casier introuvable.',
    notFoundBody: "Ce casier n'existe pas ou n'est plus accessible.",
    forbiddenTitle: "Votre compte n'a pas accès au statut des casiers.",
    statusLabel: 'Statut du casier',
    connection: {
      ONLINE: 'En ligne',
      OFFLINE: 'Hors ligne',
      UNKNOWN: 'État inconnu',
    },
    connectionNote: {
      OFFLINE: "Le casier n'envoie plus de signal valide.",
      UNKNOWN: `Aucun signal valide n'a encore été reçu${NBSP}: l'état du casier n'est pas connu.`,
    },
    lastSignal: ({ time }: { time: string }) => `Dernier signal${NBSP}: ${time}`,
    neverSignal: 'Aucun signal reçu',
    evaluatedNote: ({ time }: { time: string }) => `Évalué par le serveur à ${time}. Cette lecture n'autorise aucune ouverture.`,
    readOnlyNote: "Aucune commande n'est envoyée au casier depuis cet écran.",

    windowTitle: "Horaire d'exploitation",
    windowOpen: 'Ouvert',
    windowClosed: 'Fermé',
    windowClosesAt: 'Fermeture',
    windowNextOpensAt: 'Prochaine ouverture',
    noSchedule: "Aucun horaire d'ouverture",
    noScheduleHelp: "Aucune plage d'ouverture n'est configurée pour ce casier.",
    zoneNote: ({ zone }: { zone: string }) => `Fuseau du casier${NBSP}: ${zone}`,

    compartmentsTitle: ({ count: value }: { count: number }) =>
      plural(value, { one: `${count.format(value)} cellule`, other: `${count.format(value)} cellules` }),
    compartmentsCaption: ({ code }: { code: string }) => `Cellules du casier ${code}`,
    noCompartments: 'Aucune cellule déclarée pour ce casier.',
    colCompartment: 'Cellule',
    colEnabled: 'Activée',
    colLink: 'Liaison',
    colReader: 'Lecteur RFID',
    colDoor: 'Porte',
    colLock: 'Serrure',
    colLastObservation: 'Dernière observation',
    /** [P] The server keeps the last heartbeat's values on the cells while the locker is not online. */
    lastKnownNote: `Dernier état connu, à la dernière observation${NBSP}: le casier n'est pas en ligne, ces valeurs ne sont pas l'état actuel.`,
    noObservation: 'Aucune observation',
    link: {
      CONNECTED: 'Connectée',
      DISCONNECTED: 'Déconnectée',
      UNKNOWN: 'Inconnue',
    },
    reader: {
      HEALTHY: 'En bon état',
      FAULTED: 'En défaut',
      UNKNOWN: 'Inconnu',
    },
    door: {
      OPEN: 'Ouverte',
      CLOSED: 'Fermée',
      UNKNOWN: 'Inconnue',
    },
    lock: {
      LOCKED: 'Verrouillée',
      UNLOCKED: 'Déverrouillée',
      UNKNOWN: 'Inconnue',
    },

    /** Errors the hub reported in its current session (#29, 09 §8.6). [P] Texts await review with the QA recipe. */
    errorsTitle: ({ count: value }: { count: number }) =>
      plural(value, { one: `${count.format(value)} erreur signalée`, other: `${count.format(value)} erreurs signalées` }),
    errorsIntro: `Erreurs signalées par le casier depuis son dernier démarrage. Une erreur signalée n'est pas forcément une panne en cours${NBSP}: elle ne change ni l'état du casier, ni celui des cellules, ni la disponibilité.`,
    errorsNone: 'Aucune erreur signalée depuis le dernier démarrage du casier.',
    errorsNoSignal: `Aucun signal reçu du casier${NBSP}: aucune erreur signalée à afficher.`,
    errorsNotOnline: `Le casier n'est pas en ligne${NBSP}: cette liste peut ne plus refléter son état.`,
    errorsLimit: ({ max }: { max: number }) => `Seules les ${max} erreurs les plus importantes sont affichées${NBSP}; d'autres peuvent exister.`,
    severity: {
      CRITICAL: 'Critique',
      WARNING: 'Avertissement',
    },
    errorCode: {
      CELL_COMMUNICATION_LOST: 'Communication avec une cellule perdue',
      RFID_READER_FAULT: 'Défaut du lecteur RFID',
      DOOR_SENSOR_FAULT: 'Défaut du capteur de porte',
      LOCK_ACTUATOR_FAULT: "Défaut de l'actionneur de serrure",
      POWER_FAULT: "Défaut d'alimentation",
      CLOCK_SYNC_LOST: "Synchronisation de l'horloge perdue",
      STORAGE_FAULT: 'Défaut du stockage local',
      INBOUND_MESSAGE_INVALID: 'Message reçu invalide',
    } as Record<string, string>,
    errorUnknownCode: 'Code non reconnu par cette version de Manager',
    errorWholeLocker: 'Casier entier',
    errorCompartment: ({ code }: { code: string }) => `Cellule ${code}`,
    errorUnlistedCompartment: 'Cellule non listée',
    errorOccurrences: ({ count: value }: { count: number }) =>
      plural(value, { one: `${count.format(value)} signalement`, other: `${count.format(value)} signalements` }),
    errorReceived: ({ time }: { time: string }) => `Reçue${NBSP}: ${time}`,
    errorFirstReceived: ({ time }: { time: string }) => `Première réception${NBSP}: ${time}`,
    errorLastReceived: ({ time }: { time: string }) => `Dernière réception${NBSP}: ${time}`,
  },

  /** Operating-schedule editor (CFG-02 #28). All texts [P]: the form awaits visual approval (docs/design/manager-forms/). */
  schedule: {
    edit: "Modifier l’horaire",
    title: ({ code }: { code: string }) => `Horaire d’exploitation du casier ${code}`,
    description: 'Les heures sont locales au fuseau du casier. Le serveur enregistre une nouvelle version et calcule la fenêtre en cours.',
    loading: 'Chargement de l’horaire…',
    loadErrorTitle: 'L’horaire n’a pas pu être lu.',
    loadErrorBody: 'Réessayez. Rien n’a été modifié.',
    notConfigured: `Aucun horaire n’est configuré${NBSP}: tous les jours sont fermés tant que vous n’enregistrez pas.`,
    fieldTimeZone: 'Fuseau horaire',
    fieldTimeZoneHelp: 'Identifiant IANA, par exemple America/Toronto.',
    open: 'Ouvert',
    closed: 'Fermé toute la journée',
    opensAt: 'Ouverture',
    closesAt: 'Fermeture',
    day: {
      MONDAY: 'Lundi',
      TUESDAY: 'Mardi',
      WEDNESDAY: 'Mercredi',
      THURSDAY: 'Jeudi',
      FRIDAY: 'Vendredi',
      SATURDAY: 'Samedi',
      SUNDAY: 'Dimanche',
    },
    violation: {
      requiredWhenOpen: 'Indiquez une heure pour un jour ouvert.',
      notAllowedWhenClosed: 'Un jour fermé n’a pas d’heures.',
      notAfterOpensAt: 'La fermeture doit suivre l’ouverture, le même jour.',
      duplicateDay: 'Ce jour apparaît deux fois.',
      invalid: 'Valeur non reconnue par le serveur.',
    },
    saved: ({ code }: { code: string }) => `Horaire du casier ${code} enregistré.`,
  },

  dialog: {
    close: 'Fermer',
  },

  /** Catalog forms (CAT-01 #25). All texts [P]: the forms await Philippe's visual approval (docs/design/manager-forms/). */
  catalogEdit: {
    newAsset: 'Nouvel exemplaire',
    newModel: 'Nouveau modèle',
    edit: 'Modifier',
    archive: 'Archiver',
    cancel: 'Annuler',
    create: 'Créer',
    save: 'Enregistrer',
    retry: 'Réessayer',
    optional: '(facultatif)',

    createAssetTitle: 'Nouvel exemplaire',
    editAssetTitle: ({ code }: { code: string }) => `Modifier l’exemplaire ${code}`,
    assetFormDescription: `La disponibilité, la présence et le diagnostic ne se saisissent pas${NBSP}: le serveur les calcule.`,
    createModelTitle: 'Nouveau modèle',
    editModelTitle: ({ name }: { name: string }) => `Modifier le modèle ${name}`,
    archiveAssetTitle: ({ code }: { code: string }) => `Archiver l’exemplaire ${code}${NBSP}?`,
    archiveAssetBody: "Il ne pourra plus être modifié. Son placement prend fin et ses identifiants actifs sont révoqués. Son historique est conservé.",
    archiveAssetGuard: 'Le serveur refuse l’archivage pendant une réservation active, un prêt ouvert ou une opération en cours.',
    archiveModelTitle: ({ name }: { name: string }) => `Archiver le modèle ${name}${NBSP}?`,
    archiveModelBody: 'Il ne pourra plus être modifié ni choisi pour un exemplaire, et son nom redevient disponible. Son historique est conservé.',
    archiveModelGuard: 'Le serveur refuse l’archivage tant qu’un exemplaire non archivé utilise ce modèle.',

    fieldModelName: 'Nom',
    fieldManufacturer: 'Fabricant',
    fieldModelNumber: 'Numéro de modèle',
    fieldDescription: 'Description',
    fieldDefaultCalibration: 'Calibration exigée par défaut',
    fieldDefaultCalibrationHelp: 'Proposée à la création d’un exemplaire de ce modèle.',
    fieldModel: 'Modèle',
    chooseModel: 'Choisir un modèle',
    archivedModelOption: ({ name }: { name: string }) => `${name} (archivé)`,
    fieldAssetCode: 'Code de l’exemplaire',
    fieldAssetCodeHelp: 'Unique, exemplaires archivés compris.',
    fieldSerialNumber: 'Numéro de série',
    fieldAccessLevel: 'Niveau d’accès requis',
    fieldServiceState: 'État de service',
    fieldCalibrationRequired: 'Calibration requise',
    fieldCalibrationDue: 'Échéance de calibration',
    fieldCalibrationDueHelp: ({ zone }: { zone: string }) => `Date et heure dans le fuseau du laboratoire (${zone}).`,
    modelsLoading: 'Chargement des modèles…',
    modelsUnavailable: 'Les modèles n’ont pas pu être chargés. Fermez, puis réessayez.',
    noActiveModel: 'Aucun modèle actif. Créez d’abord un modèle dans l’onglet Modèles.',

    violation: {
      required: 'Ce champ est requis.',
      tooLong: ({ max }: { max: number }) => `${count.format(max)} caractères au maximum.`,
      invalid: 'Valeur non valide.',
      chooseModel: 'Choisissez un modèle.',
      modelNotActive: 'Ce modèle est archivé ou introuvable. Choisissez un modèle actif.',
      calibrationDueRequired: `Indiquez l’échéance${NBSP}: la calibration est requise.`,
      calibrationDueNotAllowed: 'Aucune échéance n’est acceptée sans calibration requise.',
      refused: 'Valeur refusée par le serveur.',
    },
    refusal: {
      ASSET_MODEL_NAME_ALREADY_EXISTS: 'Un modèle actif porte déjà ce nom.',
      ASSET_CODE_ALREADY_EXISTS: 'Ce code est déjà utilisé, exemplaires archivés compris.',
      ASSET_SERIAL_NUMBER_ALREADY_EXISTS: 'Ce numéro de série est déjà utilisé, exemplaires archivés compris.',
      ASSET_MODEL_ARCHIVED: `Ce modèle est archivé${NBSP}: il ne se modifie plus.`,
      ASSET_ARCHIVED: `Cet exemplaire est archivé${NBSP}: il ne se modifie plus.`,
      ASSET_MODEL_IN_USE: 'Ce modèle est encore utilisé par au moins un exemplaire non archivé.',
      ASSET_ALREADY_RESERVED: 'Impossible pendant une réservation active.',
      ASSET_HAS_OPEN_LOAN: 'Impossible pendant un emprunt en cours.',
      ASSET_OPERATION_IN_PROGRESS: 'Impossible pendant une opération du casier en cours.',
      CONCURRENT_MODIFICATION: 'Modifié entre-temps. Fermez, rechargez, puis recommencez.',
    },
    refusedTitle: 'Le serveur a refusé la demande.',
    refusedBody: 'Rien n’a été modifié.',
    validationTitle: 'Corrigez les champs signalés.',
    validationOtherTitle: 'Une valeur a été refusée par le serveur.',
    unreachableTitle: 'Aucune réponse du service.',
    unreachableBody: `Le résultat n’est pas connu. Réessayer renvoie la même demande${NBSP}: elle ne sera pas appliquée deux fois.`,
    inProgressTitle: 'La première demande est encore en cours.',
    inProgressBody: `Réessayez dans un instant${NBSP}: elle ne sera pas appliquée deux fois.`,
    forbiddenTitle: 'Votre compte n’a pas le droit de faire cette modification.',
    notFoundTitle: 'Cet élément n’existe plus ou n’est plus accessible.',
    serviceErrorTitle: 'Le service n’a pas pu traiter la demande.',

    assetCreated: ({ code }: { code: string }) => `Exemplaire ${code} créé.`,
    assetSaved: ({ code }: { code: string }) => `Modifications de l’exemplaire ${code} enregistrées.`,
    assetArchived: ({ code }: { code: string }) => `Exemplaire ${code} archivé.`,
    modelCreated: ({ name }: { name: string }) => `Modèle ${name} créé.`,
    modelSaved: ({ name }: { name: string }) => `Modifications du modèle ${name} enregistrées.`,
    modelArchived: ({ name }: { name: string }) => `Modèle ${name} archivé.`,
    archivedAssetNote: `Exemplaire archivé${NBSP}: ses réglages ne se modifient plus.`,

    modelsTitle: ({ count: value }: { count: number }) => plural(value, { one: `${count.format(value)} modèle`, other: `${count.format(value)} modèles` }),
    modelsMeta: 'Triés par nom · archivés compris',
    modelsListLoading: 'Chargement des modèles…',
    modelsLoaded: ({ count: value }: { count: number }) =>
      `Liste chargée${NBSP}: ${plural(value, { one: `${count.format(value)} modèle`, other: `${count.format(value)} modèles` })}.`,
    modelsEmptyTitle: 'Aucun modèle.',
    modelsEmptyBody: 'Créez un modèle avant d’enregistrer ses exemplaires.',
    modelsPaginationLabel: 'Pagination des modèles',
    modelsForbiddenTitle: 'Votre compte n’a pas accès aux modèles.',
    defaultCalibrationYes: 'Calibration exigée par défaut',
    defaultCalibrationNo: 'Sans calibration par défaut',
    modelActions: ({ name }: { name: string }) => `Actions du modèle ${name}`,
    assetActions: 'Actions de l’exemplaire',
  },

  notFound: {
    /** Not covered by the handoff: the sign-in panel layout, conservatively reused. Copy provisional. */
    heading: 'Page introuvable',
    body: "Cette adresse ne correspond à aucune page d'Aegis Manager.",
    home: "Retour à l'accueil",
  },
}
