import type { Messages } from './index'
import { createPluralSelector } from '../plural'

/**
 * English catalog, typed against the French one: a missing key, an extra key or
 * a different parameter list fails `tsc`. Every string is a proposal, awaiting
 * Philippe's review. Terms follow docs/localisation/glossaire.md: equipment,
 * compartment, checkout, return, chain of custody; a borrowed asset is never
 * « Ready ». Product names (Aegis, Aegis Manager) are never translated.
 */
const plural = createPluralSelector('en')
const count = new Intl.NumberFormat('en-CA')

export const en: Messages = {
  brand: {
    homeLabel: 'Aegis Manager, home',
  },

  language: {
    legend: 'Language',
  },

  appearance: {
    legend: 'Appearance',
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  },

  pageTitle: {
    landing: 'Aegis Manager',
    signIn: 'Sign in — Aegis Manager',
    equipment: 'Equipment — Aegis Manager',
    equipmentPreview: 'Equipment — Aegis Manager',
    notFound: 'Page not found — Aegis Manager',
  },

  shell: {
    skipLink: 'Skip to main content',
    sectionsLabel: 'Sections',
    accountLabel: 'Account',
    administratorRole: 'Administrator',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    menuTitle: 'Menu',
    signOut: 'Sign out',
    soonLegend: 'Section coming soon',
    soonSuffix: ', coming soon',
    sections: {
      overview: 'Overview',
      equipment: 'Equipment',
      reservationsLoans: 'Reservations and loans',
      lockers: 'Lockers',
      anomalies: 'Anomalies',
      audit: 'Audit',
    },
  },

  landing: {
    signIn: 'Sign in',
    overline: 'Aegis Manager · administration console',
    heroLine1: 'Authorized',
    heroLine2: 'Observed',
    heroLine3: 'Traced',
    lead: 'Aegis shows whether each critical piece of equipment is ready for use, opens only the expected compartment and keeps a complete chain of custody, from checkout to return.',
    seeGuarantees: 'See the five guarantees',
    accountNote: 'Account provided by your administrator.',
    mockCaption: 'Unit diagnostic',
    mockBadge: 'Illustrative example',
    blockers: ({ count: value }) =>
      plural(value, { one: `${count.format(value)} blocker`, other: `${count.format(value)} blockers` }),
    noBlockers: 'No blockers detected',
    calibrationExpired: ({ date }) => `Calibration expired on ${date}`,
    guaranteesLabel: 'Five P0 guarantees',
    guarantees: {
      readiness: {
        title: 'True readiness',
        text: 'Each item of equipment shows whether it can be used; if not, the precise reason: expired calibration, maintenance, missing from its compartment.',
      },
      checkout: {
        title: 'Compliant checkout',
        text: 'The server refuses an unauthorized or non-compliant checkout; the interface explains it, it does not decide it.',
      },
      compartment: {
        title: 'Right compartment',
        text: 'Only the expected compartment opens, after a valid authorization. A reservation or a displayed code opens nothing.',
      },
      proof: {
        title: 'Physical proof',
        text: 'Checkout and return are confirmed by consistent observations from the locker, never by a simple click.',
      },
      custody: {
        title: 'Chain of custody',
        text: 'Every action and every observation remain available in the audit trail, with nothing erased.',
      },
    },
    footerPrototype: 'Academic prototype under validation in the laboratory, designed for maintenance and inspection teams.',
    footerTechnician: 'Technician? Use the Aegis app on iPhone.',
  },

  signIn: {
    heading: 'Sign in',
    accountNote: 'Account provided by your administrator.',
    emailLabel: 'Email address',
    passwordLabel: 'Password',
    submit: 'Sign in',
    home: 'Home',
    footerTechnician: 'Technician? Use the Aegis app on iPhone.',
    fieldError: {
      emailRequired: 'Enter your email address.',
      emailInvalid: 'Enter a valid email address, for example name@example.com.',
      emailTooLong: 'The email address cannot exceed 320 characters.',
      passwordRequired: 'Enter your password.',
      passwordRejected: 'This password is not accepted. Check it, then try again.',
    },
    validationUnknown: 'Check the highlighted fields, then try again.',
    submitting: 'Signing in…',
    submittingStatus: 'Signing in.',
    reveal: 'Show',
    conceal: 'Hide',
    revealLabel: 'Show password',
    concealLabel: 'Hide password',
    revealedStatus: 'Your password is visible.',
    concealedStatus: 'Your password is hidden.',
    invalidCredentialsTitle: 'Incorrect email address or password.',
    invalidCredentialsBody: 'Check both fields, then try again.',
    rateLimitedTitle: 'Too many attempts.',
    rateLimitedBody: ({ duration }) => `Try again in ${duration}.`,
    rateLimitedFallback: 'Try again in a minute.',
    rateLimitedHint: ({ remaining }) => `Available in ${remaining}`,
    rateLimitedReady: 'You can try again.',
    unreachableTitle: 'Unable to reach the service.',
    unreachableBody: 'Check your network, then try again.',
    serviceErrorTitle: 'The service could not process the sign-in.',
    serviceErrorBody: 'Try again in a moment. If the problem persists, give the trace ID to support.',
    traceIdLabel: 'Trace ID:',
    serviceErrorBodyWithoutCode: 'Try again in a moment.',
    sessionExpiredTitle: 'Your session has expired. Sign in again.',
    sessionExpiredBody: 'Expiry does not change any reservation, loan or operation in progress.',
    sessionInvalidTitle: 'Your session is no longer valid. Sign in again.',
    sessionInvalidBody: 'No reservation, loan or operation was changed.',
    signedOutTitle: 'You are signed out.',
    roleHeading: 'Access reserved for administrators',
    roleBody: 'Aegis Manager is reserved for administrator accounts. No data was loaded and the session was closed.',
    technicianAccount: 'This technician account is used in the Aegis app.',
    roleUnknownTitle: 'This account cannot use Aegis Manager.',
    roleAccountUsed: 'Account used:',
    roleRetry: 'Sign in with another account',
  },

  equipment: {
    heading: 'Equipment',
    pendingTitle: 'The equipment list arrives with CAT-01.',
  },

  notFound: {
    heading: 'Page not found',
    body: 'This address does not match any Aegis Manager page.',
    home: 'Back to home',
  },
}
