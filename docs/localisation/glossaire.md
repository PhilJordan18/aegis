# Glossaire Aegis — français et anglais

Termes métier partagés par le Web et iOS. Propriétaire : session API/Web, pour
Philippe (voir la [convention](convention.md)). Le code technique reste tel quel
dans les contrats; seule sa présentation est traduite.

**Statut** : « établi » quand le libellé français figure déjà dans un document de
conception cité; « proposé » quand il attend la validation de Philippe. Toutes les
traductions anglaises sont proposées, sauf quand le statut cite une décision de
Philippe qui les inclut.

## Produits

Aegis Studio (le collectif de Jimmy et Philippe), Aegis (le produit), Aegis
Manager, Aegis Mobile et Aegis Control ne se traduisent pas. « Aegis Core » n'est
plus utilisé : la signature temporaire est le symbole suivi de « aegis ».

## Domaine

| Terme français | English | Statut | Note |
|---|---|---|---|
| Équipement (navigation), actif (texte) | Equipment, asset | établi | « Équipements » est l'entrée de navigation du Manager |
| Exemplaire | Unit | proposé | Un actif physique d'un modèle |
| Modèle | Model | établi | |
| Casier | Locker | établi | |
| Cellule | Compartment | établi (FR) | Le français suit les écrans (« cellule A2 »); le contrat dit `compartment` |
| Réservation | Reservation | établi | |
| Prêt | Loan | établi | Nom seulement : un actif emprunté n'est jamais « Prêt » (`states.md`) |
| Retrait | Checkout | établi | |
| Retour | Return | établi | |
| Anomalie | Anomaly | établi | |
| Chaîne de possession | Chain of custody | établi | |
| Disponibilité opérationnelle | Readiness | établi | Scope §3.1 |
| Diagnostic opérationnel | Operational diagnostic | établi | Vue administrateur, sans readiness |
| Technicien | Technician | établi | Rôle `TECHNICIAN` |
| Diagnostic d'un exemplaire | Unit diagnostic | proposé | Vue administrateur |
| Empêchement, empêchements | Blocker, blockers | proposé | Raison non personnelle qui bloque un actif |
| Vue d'ensemble | Overview | proposé | Navigation du Manager |
| À venir | Coming soon | proposé | Section non encore livrée |
| Administrateur | Administrator | établi | Rôle `ADMIN` |

## Readiness (`ReadinessStatus`)

| Code | Français | English | Statut |
|---|---|---|---|
| `READY` | Prêt | Ready | établi |
| `BLOCKED` | Bloqué | Blocked | établi |
| `UNKNOWN` | À vérifier | Needs checking | établi (FR, `states.md`) |

## Raisons (`ReadinessReason`)

| Code | Français | English | Statut |
|---|---|---|---|
| `CALIBRATION_EXPIRED` | Calibration expirée | Calibration expired | établi |
| `NOT_PRESENT` | Absent du casier | Not in the locker | proposé |
| `NOT_AVAILABLE` | Non disponible | Not available | proposé |
| `MAINTENANCE` | En maintenance | In maintenance | proposé |
| `DAMAGED` | Endommagé | Damaged | proposé |
| `ACCESS_DENIED` | Accès non autorisé | Access not permitted | proposé |
| `UNKNOWN_PHYSICAL_STATE` | État physique inconnu | Physical state unknown | proposé |

## Disponibilité (`availability`)

| Code | Français | English | Statut |
|---|---|---|---|
| `AVAILABLE` | Disponible | Available | établi |
| `RESERVED` | Réservé; « Déjà réservé » pour un tiers | Reserved; "Already reserved" for someone else | établi (FR) |
| `BORROWED` | Emprunté | Borrowed | établi; jamais « Prêt » |
| `UNAVAILABLE` | Indisponible | Unavailable | proposé |

## État de service et accès

| Code | Français | English | Statut |
|---|---|---|---|
| `SERVICEABLE` | En service | In service | établi (FR, aperçu Équipements) |
| `MAINTENANCE` | En maintenance | In maintenance | proposé |
| `DAMAGED` | Endommagé | Damaged | proposé |
| `STANDARD` | Standard | Standard | proposé |
| `RESTRICTED` | Restreint | Restricted | proposé |

## Réservation et échéances

L'heure choisie à la réservation (`reservedUntil`) borne le retrait, puis devient
l'heure de retour prévue du prêt (`dueAt`) : il n'y a qu'une échéance
(`09-contrats-rest.md` §14.1).

| Français | English | Statut | Note |
|---|---|---|---|
| Réserver jusqu'à | Reserve until | établi (décision de Philippe, 22 octobre 2026) | Libellé du choix de `reservedUntil`; remplace « Heure de retour » |
| Retirez l'équipement avant cette heure. Elle sera aussi l'heure de retour prévue. | Pick up the equipment before this time. It will also be the expected return time. | établi (décision de Philippe, 22 octobre 2026) | Sous le choix de l'heure |
| Heure de retour prévue | Expected return time | établi (terme de la phrase décidée le 22 octobre 2026) | Présentation de `dueAt` |
| La réservation n'ouvre aucune porte. | Reserving does not unlock the compartment. | établi (approuvé le 22 octobre 2026 selon le handoff iOS, #94 §8.1) | Rappel séparé dans la feuille de réservation |
| Échéance atteinte : en attente de confirmation du service. | Deadline reached: waiting for the service to confirm. | établi (décision de Philippe, 22 octobre 2026) | Décompte d'une opération (`expiresAt`) arrivé à zéro sans état terminal reçu |

## Actions et disponibilité du casier

Les valeurs de `availableActions` et leurs conditions sont fixées dans
`09-contrats-rest.md` §8.10. « Réserver » n'en fait pas partie : ce bouton suit
la readiness de l'actif.

| Français | English | Statut | Note |
|---|---|---|---|
| Réserver | Reserve | établi (FR, `sections.md` §4.1) | Création de la réservation; aucune valeur `availableActions` |
| Préparer le retrait | Prepare checkout | établi (FR, `sections.md` §4.2) | `CHECKOUT` |
| Annuler la réservation | Cancel reservation | établi (FR, `sections.md` §4.2) | `CANCEL` |
| Retourner l'équipement | Return equipment | établi (FR, `sections.md` §4.2) | `RETURN` |
| Retrait indisponible pour le moment. Actualisez pour vérifier à nouveau. | Checkout isn't available right now. Refresh to check again. | établi (décision de Philippe, 22 octobre 2026) | `CHECKOUT` absent d'une lecture fraîche, sans fait du statut du casier qui l'explique |
| Dernier état : … | Last known: … | établi (décision de Philippe, 22 octobre 2026) | Données non actualisées, en couleurs neutres, datées de l'heure locale de réception |

## Session

| Français | English | Statut |
|---|---|---|
| Connexion (écran), Se connecter (action) | Sign in | établi (FR) |
| Déconnexion, Se déconnecter | Sign out | établi (FR) |
| Adresse courriel | Email address | établi (FR) |
| Mot de passe | Password | établi (FR) |
| Session expirée | Session expired | établi (FR) |
| Identifiant de suivi (libellé du `traceId`) | Trace ID | établi (décision de Philippe, 21 octobre 2026) |
| Espace technicien | Technician access | proposé (iOS) |
| Accès réservé aux techniciens | Technicians only | proposé (iOS) |

## Technique

| Français | English | Statut |
|---|---|---|
| Service opérationnel | Service operational | proposé |
| Service injoignable | Service unreachable | proposé |
| Service indisponible | Service unavailable | proposé |
| Réessayer | Try again | proposé |
| Actualiser | Refresh | proposé |

## Aegis Manager

Textes de l'entrée du Manager, l'application Web d'administration. Décision de
Philippe du 21 octobre 2026.

| Français | English | Statut |
|---|---|---|
| Espace administrateur | Administrator workspace | établi |
| Accédez à Aegis Manager. | Access Aegis Manager. | établi |
| Aegis Manager · Administration (pied de page) | Aegis Manager · Administration | établi; nom de produit, non traduit |

## Signatures de marque

Décisions de Philippe du 21 octobre 2026; le nom et le logo ne se traduisent pas.

| Rôle | Français | English | Statut |
|---|---|---|---|
| Signature commune | Prêt. Autorisé. Prouvé. | Ready. Authorized. Proven. | établi; « Prêt » au sens de `READY` |
| Accroche secondaire | L’essentiel, sous contrôle. | What matters, under control. | établi |
| Description | Disponibilité, conformité et traçabilité de vos équipements. | Equipment availability, compliance and traceability. | établi |

L'ancienne accroche de l'accueil Web, « Autorisé. Observé. Tracé. », est remplacée
par la signature commune avec l'intégration de #79.
