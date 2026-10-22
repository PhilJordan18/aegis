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
    signature: {
      ready: 'Ready.',
      authorized: 'Authorized.',
      proven: 'Proven.',
    },
    tagline: 'What matters, under control.',
    description: 'Equipment availability, compliance and traceability.',
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
    footerTechnician: 'Technician? Use Aegis Mobile on iPhone.',
  },

  signIn: {
    heading: 'Sign in',
    accountNote: 'Account provided by your administrator.',
    emailLabel: 'Email address',
    passwordLabel: 'Password',
    submit: 'Sign in',
    role: 'Administrator workspace',
    subtitle: 'Access Aegis Manager.',
    home: 'Home',
    footerProduct: 'Aegis Manager · Administration',
    footerTechnician: 'Technician? Use Aegis Mobile on iPhone.',
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
    technicianAccount: 'This technician account is used in Aegis Mobile.',
    roleUnknownTitle: 'This account cannot use Aegis Manager.',
    roleAccountUsed: 'Account used:',
    roleRetry: 'Sign in with another account',
  },

  equipment: {
    heading: 'Equipment',
    viewsLabel: 'Equipment views',
    unitsTab: 'Units',
    modelsTab: 'Models',
    selectedOverline: 'Selected unit',
    listTitle: ({ count: value }) => plural(value, { one: `${count.format(value)} unit`, other: `${count.format(value)} units` }),
    listMeta: 'Operational diagnostic',
    listFoot: ({ time }) => `Sorted by code · diagnostic evaluated at ${time}`,
    blockers: ({ count: value }) => plural(value, { one: `${count.format(value)} blocker`, other: `${count.format(value)} blockers` }),
    noBlockers: 'No blocker detected',
    archived: 'Archived',
    archivedOn: ({ date }) => `Archived on ${date}`,
    facts: ({ availability, presence, status }) => `${availability} · ${presence} · ${status}`,

    loading: 'Loading units…',
    loaded: ({ count: value, page, pages }) =>
      `List loaded: ${plural(value, { one: `${count.format(value)} unit`, other: `${count.format(value)} units` })}, page ${count.format(page)} of ${count.format(pages)}.`,
    selectedStatus: ({ name }) => `Unit selected: ${name}.`,
    detailLoading: 'Loading the unit…',

    paginationLabel: 'Unit pages',
    previousPage: 'Previous',
    nextPage: 'Next',
    pageOf: ({ page, pages }) => `Page ${count.format(page)} of ${count.format(pages)}`,

    emptyTitle: 'No units.',
    emptyBody: 'As soon as a unit is registered, it appears here with its operational diagnostic.',

    retry: 'Try again',
    backToList: 'Back to the list',
    unreachableTitle: 'Unable to reach the service.',
    unreachableBody: 'Check your network, then try again.',
    serviceErrorTitle: 'The service could not provide this data.',
    serviceErrorBody: 'Try again in a moment. If the problem persists, give the trace ID to support.',
    serviceErrorBodyWithoutCode: 'Try again in a moment.',
    traceIdLabel: 'Trace ID:',
    forbiddenTitle: 'Your account has no access to equipment.',
    forbiddenBody: 'The server refused the request. No data was loaded.',
    notFoundTitle: 'Unit not found.',
    notFoundBody: 'This unit no longer exists or is no longer accessible.',
    staleTitle: 'Data not refreshed.',
    staleBody: ({ time }) => `The data shown was evaluated at ${time}. The last refresh failed.`,

    diagnosticTitle: 'Operational diagnostic',
    diagnosticNote: ({ time }) =>
      `Known non-personal blockers (availability, service state, calibration, presence), evaluated at ${time}. An empty list grants no right to borrow and no way to open the locker.`,
    unknownNote: 'The physical state is not observed yet: neither presence nor absence is assumed.',
    derivedFacts: 'Derived facts',
    settings: 'Settings',
    readOnly: 'read-only',
    factAvailability: 'Availability',
    factPresence: 'Presence',
    factCalibration: 'Calibration',
    factPlacement: 'Placement',
    factSerialNumber: 'Serial number',
    settingAccessLevel: 'Required access level',
    settingServiceState: 'Service state',
    settingCalibrationRequired: 'Calibration required',
    settingCalibrationDue: 'Calibration due date',
    yes: 'Yes',
    no: 'No',
    notProvided: 'Not provided',
    noPlacement: 'No known placement',
    presenceUnknownHelp: 'No presence observation is available.',
    zoneNote: ({ zone }) => `Laboratory time zone: ${zone}`,

    reason: {
      NOT_PRESENT: 'Not in the locker',
      NOT_AVAILABLE: 'Not available',
      MAINTENANCE: 'In maintenance',
      DAMAGED: 'Damaged',
      CALIBRATION_EXPIRED: 'Calibration expired',
      UNKNOWN_PHYSICAL_STATE: 'Physical state unknown',
    },
    calibrationExpiredOn: ({ date }) => `Calibration expired on ${date}`,
    availability: {
      AVAILABLE: 'Available',
      RESERVED: 'Reserved',
      BORROWED: 'Borrowed',
      UNAVAILABLE: 'Unavailable',
    },
    presence: {
      PRESENT: 'Present',
      ABSENT: 'Not in the locker',
      UNKNOWN: 'Unknown',
    },
    presenceInline: {
      PRESENT: 'Present',
      ABSENT: 'Not in the locker',
      UNKNOWN: 'Presence unknown',
    },
    serviceState: {
      SERVICEABLE: 'In service',
      MAINTENANCE: 'In maintenance',
      DAMAGED: 'Damaged',
    },
    accessLevel: {
      STANDARD: 'Standard',
      RESTRICTED: 'Restricted',
    },
    calibrationStatus: {
      NOT_REQUIRED: 'Not required',
      UNKNOWN: 'Due date not provided',
    },
    calibrationValidUntil: ({ date }) => `Valid until ${date}`,
    calibrationExpiredSince: ({ date }) => `Expired on ${date}`,
  },

  notFound: {
    heading: 'Page not found',
    body: 'This address does not match any Aegis Manager page.',
    home: 'Back to home',
  },
}
