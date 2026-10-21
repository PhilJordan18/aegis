# Glossaire Aegis — français et anglais

Termes métier partagés par le Web et iOS. Propriétaire : session API/Web, pour
Philippe (voir la [convention](convention.md)). Le code technique reste tel quel
dans les contrats; seule sa présentation est traduite.

**Statut** : « établi » quand le libellé français figure déjà dans un document de
conception cité; « proposé » quand il attend la validation de Philippe. Toutes les
traductions anglaises sont proposées.

## Produits

Aegis, Aegis Manager, Aegis Mobile et Aegis Control ne se traduisent pas.

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

## Session

| Français | English | Statut |
|---|---|---|
| Connexion (écran), Se connecter (action) | Sign in | établi (FR) |
| Déconnexion, Se déconnecter | Sign out | établi (FR) |
| Adresse courriel | Email address | établi (FR) |
| Mot de passe | Password | établi (FR) |
| Session expirée | Session expired | établi (FR) |
| Identifiant de suivi (libellé du `traceId`) | Trace ID | proposé |
