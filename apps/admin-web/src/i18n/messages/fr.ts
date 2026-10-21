import type { RouteId } from '../../app/routes'
import type { FieldErrorCode } from '../../features/auth/signInValidation'
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
    /** Accessible name of the wordmark link; the visible name « Aegis Manager » is a product name and is never translated. */
    homeLabel: 'Aegis Manager, accueil',
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
    overline: "Aegis Manager · console d'administration",
    heroLine1: 'Autorisé',
    heroLine2: 'Observé',
    heroLine3: 'Tracé',
    lead: "Aegis montre si chaque équipement critique peut servir, n'ouvre que la cellule attendue et conserve une chaîne de possession complète, du retrait au retour.",
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
    footerTechnician: `Technicien${NBSP}? Utilisez l'application Aegis sur iPhone.`,
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
    home: 'Accueil',
    footerTechnician: `Technicien${NBSP}? Utilisez l'application Aegis sur iPhone.`,
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
    /** [A→P] T1: the delay is fixed when the 429 arrives; `duration` is already formatted (« 42 secondes »). */
    rateLimitedBody: ({ duration }: { duration: string }) => `Réessayez dans ${duration}.`,
    /** [A] Shown when the 429 carries no usable Retry-After. */
    rateLimitedFallback: 'Réessayez dans une minute.',
    /** `remaining` is a countdown clock (« 0:42 »). */
    rateLimitedHint: ({ remaining }: { remaining: string }) => `Disponible dans ${remaining}`,
    rateLimitedReady: 'Vous pouvez réessayer.',
    /** [A] */
    unreachableTitle: 'Connexion au service impossible.',
    /** [A] wording split into title and body; « puis réessayez » added [P] (T3). */
    unreachableBody: 'Vérifiez le réseau, puis réessayez.',
    serviceErrorTitle: "Le service n'a pas pu traiter la connexion.",
    /** The traceId follows this sentence as is; the sentence is its label. */
    serviceErrorBody: `Réessayez dans un instant. Si le problème persiste, transmettez ce code au support${NBSP}:`,
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
    /** [A] */
    technicianAccount: "Ce compte technicien s'utilise dans l'application Aegis.",
    roleUnknownTitle: 'Ce compte ne peut pas utiliser Aegis Manager.',
    roleAccountUsed: `Compte utilisé${NBSP}:`,
    roleRetry: 'Se connecter avec un autre compte',
  },

  equipment: {
    heading: 'Équipements',
    /** [P] Awaiting design approval; follows the preview bar wording « La liste réelle arrive avec CAT-01. » (states.md §4). */
    pendingTitle: 'La liste des équipements arrive avec CAT-01.',
  },

  notFound: {
    /** Not covered by the handoff: the sign-in panel layout, conservatively reused. Copy provisional. */
    heading: 'Page introuvable',
    body: "Cette adresse ne correspond à aucune page d'Aegis Manager.",
    home: "Retour à l'accueil",
  },
}
