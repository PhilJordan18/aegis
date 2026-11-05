# Aegis Manager — textes proposés à valider

Liste des textes du Web qui ne sont pas encore marqués approuvés (`[A]`) dans
`apps/admin-web/src/i18n/messages/fr.ts`. Un texte non marqué est proposé
(convention du catalogue). Le critère « Philippe approuve les textes proposés »
de #13 n’est rempli qu’une fois cette liste tranchée.

État au 21 octobre 2026, sur `dev` après #88 : 105 textes, dont 22 approuvés
(décisions des 21 octobre comprises) et **83 proposés**. Les noms de produit
(« Aegis Manager », « Aegis Mobile ») ne se traduisent pas. L’anglais suit les
règles du [glossaire](glossaire.md), où toutes les traductions anglaises restent proposées.

Pour approuver : indiquer les clés acceptées, ou corrigées, dans #13. Le catalogue
reçoit alors la marque `[A]` dans le même changement.

## Marque (1)

| Clé | Français | English | Note |
|---|---|---|---|
| `brand.homeLabel` | `'Aegis Manager, accueil'` | `'Aegis Manager, home'` | Accessible name of the brand link; « aegis » and « Manager » are names and are never translated. |

## Langue (1)

| Clé | Français | English | Note |
|---|---|---|---|
| `language.legend` | `'Langue'` | `'Language'` |  |

## Apparence (4)

| Clé | Français | English | Note |
|---|---|---|---|
| `appearance.legend` | `'Apparence'` | `'Appearance'` |  |
| `appearance.system` | `'Système'` | `'System'` |  |
| `appearance.light` | `'Clair'` | `'Light'` |  |
| `appearance.dark` | `'Sombre'` | `'Dark'` |  |

## Titres de page (5)

| Clé | Français | English | Note |
|---|---|---|---|
| `pageTitle.landing` | `'Aegis Manager'` | `'Aegis Manager'` |  |
| `pageTitle.signIn` | `'Connexion — Aegis Manager'` | `'Sign in — Aegis Manager'` |  |
| `pageTitle.equipment` | `'Équipements — Aegis Manager'` | `'Equipment — Aegis Manager'` |  |
| `pageTitle.equipmentPreview` | `'Équipements — Aegis Manager'` | `'Equipment — Aegis Manager'` |  |
| `pageTitle.notFound` | `'Page introuvable — Aegis Manager'` | `'Page not found — Aegis Manager'` |  |

## Shell (16)

| Clé | Français | English | Note |
|---|---|---|---|
| `shell.skipLink` | `'Aller au contenu principal'` | `'Skip to main content'` |  |
| `shell.sectionsLabel` | `'Sections'` | `'Sections'` |  |
| `shell.accountLabel` | `'Compte'` | `'Account'` |  |
| `shell.administratorRole` | `'Administrateur'` | `'Administrator'` |  |
| `shell.openMenu` | `'Ouvrir le menu'` | `'Open menu'` |  |
| `shell.closeMenu` | `'Fermer le menu'` | `'Close menu'` |  |
| `shell.menuTitle` | `'Menu'` | `'Menu'` |  |
| `shell.signOut` | `'Se déconnecter'` | `'Sign out'` |  |
| `shell.soonLegend` | `'Section à venir'` | `'Section coming soon'` |  |
| `shell.soonSuffix` | `', à venir'` | `', coming soon'` |  |
| `shell.sections.overview` | `"Vue d'ensemble"` | `'Overview'` |  |
| `shell.sections.equipment` | `'Équipements'` | `'Equipment'` |  |
| `shell.sections.reservationsLoans` | `'Réservations et prêts'` | `'Reservations and loans'` |  |
| `shell.sections.lockers` | `'Casiers'` | `'Lockers'` |  |
| `shell.sections.anomalies` | `'Anomalies'` | `'Anomalies'` |  |
| `shell.sections.audit` | `'Audit'` | `'Audit'` |  |

## Accueil (20)

| Clé | Français | English | Note |
|---|---|---|---|
| `landing.signIn` | `'Se connecter'` | `'Sign in'` |  |
| `landing.seeGuarantees` | `'Voir les cinq garanties'` | `'See the five guarantees'` |  |
| `landing.mockCaption` | `"Diagnostic d'un exemplaire"` | `'Unit diagnostic'` |  |
| `landing.mockBadge` | `'Exemple illustratif'` | `'Illustrative example'` |  |
| `landing.blockers` | `({ count: value }: { count: number }) => plural(value, { one: `${count.format(value)} empêchement`, other: `${count.format(value)} empêchements` })` | `({ count: value }) => plural(value, { one: `${count.format(value)} blocker`, other: `${count.format(value)} blockers` })` |  |
| `landing.noBlockers` | `'Aucun empêchement détecté'` | `'No blockers detected'` |  |
| `landing.calibrationExpired` | `({ date }: { date: string }) => `Calibration expirée depuis le ${date}`` | `({ date }) => `Calibration expired on ${date}`` |  |
| `landing.guaranteesLabel` | `'Cinq garanties du P0'` | `'Five P0 guarantees'` |  |
| `landing.guarantees.readiness.title` | `'Disponibilité réelle'` | `'True readiness'` |  |
| `landing.guarantees.readiness.text` | ``Chaque équipement indique s'il peut servir; sinon, la raison précise : calibration expirée, maintenance, absence de sa cellule.`` | `'Each item of equipment shows whether it can be used; if not, the precise reason: expired calibration, maintenance, missing from its compartment.'` |  |
| `landing.guarantees.checkout.title` | `'Retrait conforme'` | `'Compliant checkout'` |  |
| `landing.guarantees.checkout.text` | `"Le serveur refuse un retrait non autorisé ou non conforme; l'interface l'explique, elle ne le décide pas."` | `'The server refuses an unauthorized or non-compliant checkout; the interface explains it, it does not decide it.'` |  |
| `landing.guarantees.compartment.title` | `'Bonne cellule'` | `'Right compartment'` |  |
| `landing.guarantees.compartment.text` | `"Seule la cellule attendue s'ouvre, après une autorisation valide. Une réservation ou un code affiché n'ouvre rien."` | `'Only the expected compartment opens, after a valid authorization. A reservation or a displayed code opens nothing.'` |  |
| `landing.guarantees.proof.title` | `'Preuve physique'` | `'Physical proof'` |  |
| `landing.guarantees.proof.text` | `'Retrait et retour sont confirmés par des observations cohérentes du casier, jamais par un simple clic.'` | `'Checkout and return are confirmed by consistent observations from the locker, never by a simple click.'` |  |
| `landing.guarantees.custody.title` | `'Chaîne de possession'` | `'Chain of custody'` |  |
| `landing.guarantees.custody.text` | `"Chaque action et chaque observation restent consultables dans l'audit, sans effacement."` | `'Every action and every observation remain available in the audit trail, with nothing erased.'` |  |
| `landing.footerPrototype` | `"Prototype académique en cours de validation en laboratoire, conçu pour les équipes de maintenance et d'inspection."` | `'Academic prototype under validation in the laboratory, designed for maintenance and inspection teams.'` |  |
| `landing.footerTechnician` | ``Technicien ? Utilisez Aegis Mobile sur iPhone.`` | `'Technician? Use Aegis Mobile on iPhone.'` |  |

## Connexion (31)

| Clé | Français | English | Note |
|---|---|---|---|
| `signIn.home` | `'Accueil'` | `'Home'` |  |
| `signIn.footerTechnician` | ``Technicien ? Utilisez Aegis Mobile sur iPhone.`` | `'Technician? Use Aegis Mobile on iPhone.'` |  |
| `signIn.fieldError.emailRequired` | `'Saisissez votre adresse courriel.'` | `'Enter your email address.'` |  |
| `signIn.fieldError.emailInvalid` | `'Saisissez une adresse courriel valide, par exemple nom@example.com.'` | `'Enter a valid email address, for example name@example.com.'` |  |
| `signIn.fieldError.emailTooLong` | `"L'adresse courriel ne peut pas dépasser 320 caractères."` | `'The email address cannot exceed 320 characters.'` |  |
| `signIn.fieldError.passwordRequired` | `'Saisissez votre mot de passe.'` | `'Enter your password.'` |  |
| `signIn.fieldError.passwordRejected` | `"Ce mot de passe n'est pas accepté. Vérifiez-le, puis réessayez."` | `'This password is not accepted. Check it, then try again.'` | Server violation on a password the client accepted (review R5). |
| `signIn.validationUnknown` | `'Vérifiez les champs indiqués, puis réessayez.'` | `'Check the highlighted fields, then try again.'` |  |
| `signIn.submitting` | `'Connexion…'` | `'Signing in…'` |  |
| `signIn.submittingStatus` | `'Connexion en cours.'` | `'Signing in.'` |  |
| `signIn.reveal` | `'Afficher'` | `'Show'` |  |
| `signIn.conceal` | `'Masquer'` | `'Hide'` |  |
| `signIn.revealLabel` | `'Afficher le mot de passe'` | `'Show password'` |  |
| `signIn.concealLabel` | `'Masquer le mot de passe'` | `'Hide password'` |  |
| `signIn.revealedStatus` | `'Votre mot de passe est visible.'` | `'Your password is visible.'` |  |
| `signIn.concealedStatus` | `'Votre mot de passe est masqué.'` | `'Your password is hidden.'` |  |
| `signIn.invalidCredentialsBody` | `'Vérifiez les deux champs, puis réessayez.'` | `'Check both fields, then try again.'` |  |
| `signIn.rateLimitedBody` | `({ duration }: { duration: string }) => `Réessayez dans ${duration}.`` | `({ duration }) => `Try again in ${duration}.`` | [A→P] T1: the one place the delay is shown, fixed when the 429 arrives; `duration` is already formatted (« 42 secondes »). |
| `signIn.rateLimitedReady` | `'Vous pouvez réessayer.'` | `'You can try again.'` |  |
| `signIn.serviceErrorTitle` | `"Le service n'a pas pu traiter la connexion."` | `'The service could not process the sign-in.'` |  |
| `signIn.serviceErrorBody` | `"Réessayez dans un instant. Si le problème persiste, transmettez l'identifiant de suivi au support."` | `'Try again in a moment. If the problem persists, give the trace ID to support.'` |  |
| `signIn.serviceErrorBodyWithoutCode` | `'Réessayez dans un instant.'` | `'Try again in a moment.'` | Not in states.md: same message when no traceId is available. |
| `signIn.sessionExpiredBody` | `"L'expiration ne modifie ni les réservations, ni les prêts, ni les opérations en cours."` | `'Expiry does not change any reservation, loan or operation in progress.'` | [A→P] T2. |
| `signIn.sessionInvalidTitle` | `"Votre session n'est plus valide. Reconnectez-vous."` | `'Your session is no longer valid. Sign in again.'` |  |
| `signIn.sessionInvalidBody` | `"Aucune réservation, aucun prêt ni aucune opération n'a été modifié."` | `'No reservation, loan or operation was changed.'` |  |
| `signIn.signedOutTitle` | `'Vous êtes déconnecté.'` | `'You are signed out.'` |  |
| `signIn.roleHeading` | `'Accès réservé aux administrateurs'` | `'Access reserved for administrators'` |  |
| `signIn.roleBody` | `"Aegis Manager est réservé aux comptes administrateur. Aucune donnée n'a été chargée et la session a été fermée."` | `'Aegis Manager is reserved for administrator accounts. No data was loaded and the session was closed.'` |  |
| `signIn.roleUnknownTitle` | `'Ce compte ne peut pas utiliser Aegis Manager.'` | `'This account cannot use Aegis Manager.'` |  |
| `signIn.roleAccountUsed` | ``Compte utilisé :`` | `'Account used:'` |  |
| `signIn.roleRetry` | `'Se connecter avec un autre compte'` | `'Sign in with another account'` |  |

## Équipements (2)

| Clé | Français | English | Note |
|---|---|---|---|
| `equipment.heading` | `'Équipements'` | `'Equipment'` |  |
| `equipment.pendingTitle` | `'La liste des équipements arrive avec CAT-01.'` | `'The equipment list arrives with CAT-01.'` | [P] Awaiting design approval; follows the preview bar wording « La liste réelle arrive avec CAT-01. » (states.md §4). |

## Page introuvable (3)

| Clé | Français | English | Note |
|---|---|---|---|
| `notFound.heading` | `'Page introuvable'` | `'Page not found'` | Not covered by the handoff: the sign-in panel layout, conservatively reused. Copy provisional. |
| `notFound.body` | `"Cette adresse ne correspond à aucune page d'Aegis Manager."` | `'This address does not match any Aegis Manager page.'` |  |
| `notFound.home` | `"Retour à l'accueil"` | `'Back to home'` |  |
