/**
 * Sign-in copy, word for word from docs/design/manager-entree/states.md §3.
 * `approved` = [A] (asset-lifecycle/sections.md §3, U6). `proposed` = [P] or
 * [A→P], awaiting Philippe's approval (states.md §5). U+00A0 precedes « : ? »
 * (handoff §7). Server `title`/`detail` are never displayed.
 */
const NBSP = ' '

export const signInCopy = {
  approved: {
    heading: 'Connexion',
    accountNote: 'Compte fourni par votre administrateur.',
    emailLabel: 'Adresse courriel',
    passwordLabel: 'Mot de passe',
    submit: 'Se connecter',
    invalidCredentialsTitle: 'Adresse courriel ou mot de passe incorrect.',
    rateLimitedTitle: 'Trop de tentatives.',
    rateLimitedFallback: 'Réessayez dans une minute.',
    sessionExpiredTitle: 'Votre session a expiré. Reconnectez-vous.',
    unreachableTitle: 'Connexion au service impossible.',
    technicianAccount: "Ce compte technicien s'utilise dans l'application Aegis.",
  },
  proposed: {
    home: 'Accueil',
    technicianFooter: `Technicien${NBSP}? Utilisez l'application Aegis sur iPhone.`,
    emailRequired: 'Saisissez votre adresse courriel.',
    emailInvalid: 'Saisissez une adresse courriel valide, par exemple nom@example.com.',
    emailTooLong: "L'adresse courriel ne peut pas dépasser 320 caractères.",
    passwordRequired: 'Saisissez votre mot de passe.',
    /** Server violation on a password the client accepted (review R5). */
    passwordRejected: "Ce mot de passe n'est pas accepté. Vérifiez-le, puis réessayez.",
    validationUnknown: 'Vérifiez les champs indiqués, puis réessayez.',
    submitting: 'Connexion…',
    submittingStatus: 'Connexion en cours.',
    reveal: 'Afficher',
    conceal: 'Masquer',
    revealLabel: 'Afficher le mot de passe',
    concealLabel: 'Masquer le mot de passe',
    revealedStatus: 'Votre mot de passe est visible.',
    concealedStatus: 'Votre mot de passe est masqué.',
    invalidCredentialsBody: 'Vérifiez les deux champs, puis réessayez.',
    /** [A→P] T1: the delay is fixed when the 429 arrives. */
    rateLimitedBody: (seconds: number) => `Réessayez dans ${seconds}${NBSP}${seconds > 1 ? 'secondes' : 'seconde'}.`,
    rateLimitedHint: (remaining: string) => `Disponible dans ${remaining}`,
    rateLimitedReady: 'Vous pouvez réessayer.',
    /** [A] wording split into title and body; « puis réessayez » added [P] (T3). */
    unreachableBody: 'Vérifiez le réseau, puis réessayez.',
    serviceErrorTitle: "Le service n'a pas pu traiter la connexion.",
    serviceErrorBody: `Réessayez dans un instant. Si le problème persiste, transmettez ce code au support${NBSP}:`,
    /** Not in states.md: same message when no traceId is available. */
    serviceErrorBodyWithoutCode: 'Réessayez dans un instant.',
    /** [A→P] T2. */
    sessionExpiredBody: "L'expiration ne modifie ni les réservations, ni les prêts, ni les opérations en cours.",
    sessionInvalidTitle: "Votre session n'est plus valide. Reconnectez-vous.",
    sessionInvalidBody: "Aucune réservation, aucun prêt ni aucune opération n'a été modifié.",
    signedOutTitle: 'Vous êtes déconnecté.',
    roleHeading: 'Accès réservé aux administrateurs',
    roleBody: "Aegis Manager est réservé aux comptes administrateur. Aucune donnée n'a été chargée et la session a été fermée.",
    roleUnknownTitle: 'Ce compte ne peut pas utiliser Aegis Manager.',
    roleAccountUsed: `Compte utilisé${NBSP}:`,
    roleRetry: 'Se connecter avec un autre compte',
  },
} as const
