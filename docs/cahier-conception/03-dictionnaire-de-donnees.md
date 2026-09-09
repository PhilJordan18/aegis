# Aegis — Dictionnaire de données métier

**Version :** 0.1  
**Statut :** Proposition de conception — à valider avec le modèle de domaine  
**Source principale :** `scope.md` v0.3 (9 septembre 2026)

## 1. Rôle du document

Ce document définit le vocabulaire canonique d’Aegis avant la création :

- du modèle de domaine;
- des diagrammes de flux de données et d’architecture;
- du schéma relationnel PostgreSQL;
- des contrats REST et MQTT;
- des stories et tests.

Il décrit les concepts logiques du produit. Il **ne constitue pas encore** un schéma SQL, des DTO Java ou des payloads MQTT définitifs. Une même notion métier peut devenir plusieurs tables, événements ou objets techniques lors de l’implémentation.

## 2. Conventions communes

| Convention | Règle |
|---|---|
| Identifiant interne | UUID stable, nommé `id` ou `<concept>Id` dans les échanges externes. |
| Horodatage | Instant UTC avec suffixe `At` (`createdAt`, `observedAt`, `expiresAt`). |
| Statuts | Valeurs d’énumération écrites en majuscules avec `_`. |
| Soft delete | Les objets traçables sont archivés/désactivés; ils ne sont pas supprimés physiquement par défaut. |
| État attendu | État que le backend prévoit ou autorise. |
| État observé | Fait signalé par le matériel; il ne modifie jamais seul un prêt ou une réservation. |
| État dérivé | Décision recalculée à partir de données source; il ne devient pas une vérité modifiable manuellement. |
| `operationId` | Identifiant unique d’un workflow physique de retrait ou de retour. |
| `messageId` | Identifiant unique d’un message MQTT provenant ou destiné à un device. |

## 3. Carte des concepts

```text
Utilisateur ── réserve ──> Actif ── est attendu dans ──> Compartiment ── appartient à ──> Locker
     │                        │                                      │                         │
     └── détient ──> Prêt <───┘                                      └── contrôlé par ──> Device

LockerOperation ── concerne ──> Actif + Compartiment + Utilisateur
LockerOperation ── est confirmée par ──> Observations physiques
Message IoT ── transporte ──> Observations / accusés / heartbeats

ReadinessAssessment = décision dérivée à partir de l'actif, de sa présence,
de son état opérationnel, de sa calibration, de sa disponibilité et de l'utilisateur.
```

## 4. Référentiel des concepts

### 4.1 Utilisateur (`User`)

Une personne pouvant se connecter à Aegis et initier ou administrer des opérations.

| Attribut logique | Description | Règle P0 |
|---|---|---|
| `id` | Identifiant unique de l’utilisateur. | Immuable. |
| `displayName` | Nom affiché dans les interfaces et l’audit. | Requis. |
| `email` | Identifiant de connexion. | Unique, normalisé. |
| `role` | Rôle applicatif. | `ADMIN` ou `TECHNICIAN`. |
| `maximumAccessLevel` | Niveau maximal d’accès matériel autorisé. | `STANDARD` ou `RESTRICTED`. |
| `status` | Possibilité de se connecter et d’agir. | Au minimum `ACTIVE` ou `DISABLED`. |
| `createdAt`, `archivedAt` | Dates de création et d’archivage. | Pas de suppression de l’historique. |

**À ne pas confondre :** le rôle (`ADMIN`, `TECHNICIAN`) définit ce que la personne peut faire dans l’application; le niveau d’accès définit les actifs qu’elle peut utiliser.

### 4.2 Niveau d’accès (`AccessLevel`)

Classification simple utilisée pour comparer un utilisateur et un actif.

| Valeur | Sens |
|---|---|
| `STANDARD` | Actif accessible à un technicien standard. |
| `RESTRICTED` | Actif nécessitant une autorisation plus élevée. |

Règle P0 : un utilisateur est admissible si son `maximumAccessLevel` est au moins égal au `requiredAccessLevel` de l’actif.

### 4.3 Modèle d’actif (`AssetModel`)

Description générique d’une catégorie d’équipement, par exemple « Multimètre Fluke 117 ».

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique du modèle. |
| `name` | Nom commercial ou fonctionnel. |
| `manufacturer`, `modelNumber` | Informations de référence facultatives. |
| `description` | Usage et caractéristiques utiles. |
| `defaultCalibrationRequired` | Valeur proposée lors de la création d’un exemplaire. |
| `archivedAt` | Archive le modèle sans effacer les exemplaires historiques. |

Un modèle n’est pas physiquement emprunté : c’est un **exemplaire d’actif** qui l’est.

### 4.4 Actif (`Asset`)

Exemplaire physique individuel suivi par Aegis, par exemple « Multimètre 1 — numéro de série X ».

| Attribut logique | Description | Règle P0 |
|---|---|---|
| `id` | Identifiant unique de l’exemplaire. | Immuable. |
| `assetModelId` | Modèle auquel l’exemplaire appartient. | Requis. |
| `assetCode` | Code humain affichable et scannable. | Unique. |
| `serialNumber` | Numéro de série manufacturier. | Facultatif mais recommandé. |
| `requiredAccessLevel` | Niveau minimal nécessaire pour l’utiliser. | Requis. |
| `operationalStatus` | État administratif/technique courant. | Voir 5.2. |
| `calibrationRequired` | Indique si la conformité dépend d’une calibration. | Requis. |
| `calibrationDueAt` | Échéance de calibration, si requise. | Obligatoire quand applicable. |
| `archivedAt` | Retire l’actif du catalogue actif sans supprimer son passé. | Nullable. |

L’actif ne possède pas une colonne éditable appelée `ready`. Sa readiness et sa présence sont évaluées à partir de données source.

### 4.5 Identifiant physique d’actif (`AssetIdentifier`)

Identifiant lisible ou observable associé à un actif : tag RFID UHF, NFC, QR code ou autre méthode validée par le POC.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant interne. |
| `assetId` | Actif concerné. |
| `type` | `RFID_UHF`, `NFC`, `QR` ou technologie documentée ultérieurement. |
| `value` | Valeur exacte de l’identifiant physique. |
| `active` | Indique si l’identifiant est encore associé à l’actif. |
| `assignedAt`, `revokedAt` | Trace l’affectation. |

Invariant : la paire `(type, value)` ne peut appartenir qu’à un seul identifiant actif.

### 4.6 Locker (`Locker`)

Unité physique logique mise à disposition par Aegis. Dans le P0, il existe un seul locker de démonstration.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant stable utilisé dans les APIs et topics MQTT. |
| `code` | Code humain, par exemple `AEGIS-DEMO-01`. |
| `name` | Nom affiché. |
| `status` | État de disponibilité du locker, dérivé des heartbeats et erreurs device. |
| `lastSeenAt` | Dernier heartbeat reçu du contrôleur. |
| `topology` | `MONOLITHIC` ou `HUB_CELL`; valeur finalisée après POC. |

Le locker est le concept métier exposé aux utilisateurs. La topologie hub/cellule est une décision d’architecture physique qui ne doit pas changer la logique de réservation ou de prêt.

### 4.7 Compartiment (`Compartment`)

Cavité verrouillable d’un locker, liée à une serrure, une porte et des capteurs. Le P0 comporte deux compartiments indépendants.

| Attribut logique | Description | Règle P0 |
|---|---|---|
| `id` | Identifiant unique. | Immuable. |
| `lockerId` | Locker parent. | Requis. |
| `code` | Référence lisible, par exemple `A1`. | Unique dans un locker. |
| `enabled` | Indique si le compartiment peut être utilisé. | `false` bloque une opération. |
| `doorState` | Dernier état physique connu de la porte. | État observé, voir 5.7. |
| `lockState` | Dernier état de serrure connu. | État observé, voir 5.8. |
| `lastObservedAt` | Date de la dernière observation liée au compartiment. | Sert à détecter l’incertitude. |

Un compartiment n’est pas automatiquement la preuve de présence d’un actif. Il contient une **affectation attendue**, ensuite validée ou contredite par les observations physiques.

### 4.8 Affectation attendue (`AssetPlacement`)

Relation entre un actif et le compartiment où il est censé se trouver lorsque l’actif n’est pas emprunté.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant de la relation. |
| `assetId` | Actif attendu. |
| `compartmentId` | Compartiment attendu. |
| `assignedAt` | Début de l’affectation. |
| `removedAt` | Fin de l’affectation, si l’actif est déplacé ou archivé. |
| `reason` | Justification d’un changement d’affectation. |

Invariants P0 : un actif ne possède qu’une affectation active; un compartiment ne possède qu’un actif attendu actif. Cette affectation est une attente administrative, pas une observation physique.

### 4.9 Contrôleur du locker (`LockerDevice`)

Identité logique du contrôleur ESP32 qui communique avec le broker MQTT et pilote le locker.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant interne. |
| `lockerId` | Locker contrôlé. |
| `deviceKey` | Identité technique stable, par exemple l’identifiant MQTT du device. |
| `firmwareVersion` | Version déclarée par le device. |
| `connectionStatus` | État dérivé des heartbeats. |
| `lastSeenAt` | Date du dernier heartbeat valide. |
| `registeredAt`, `disabledAt` | Cycle de vie du device. |

Le `LockerDevice` est le contrôleur réseau. Une cellule passive hub/cellule n’est pas automatiquement un device MQTT distinct.

### 4.10 Réservation (`Reservation`)

Intention temporaire d’un technicien d’obtenir un actif donné.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique. |
| `assetId` | Actif réservé. |
| `userId` | Technicien bénéficiaire. |
| `status` | Voir 5.4. |
| `createdAt` | Création de la réservation. |
| `expiresAt` | Échéance après laquelle elle n’autorise plus l’ouverture. |
| `cancelledAt`, `fulfilledAt` | Dates de conclusion selon le résultat. |

Invariant : un actif ne peut pas avoir deux réservations `ACTIVE` simultanées. Une réservation ne vaut pas preuve de retrait.

### 4.11 Prêt / chaîne de possession (`Loan`)

Période pendant laquelle un actif est officiellement attribué à un utilisateur après un retrait physiquement confirmé.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique du prêt. |
| `assetId` | Actif prêté. |
| `holderUserId` | Utilisateur responsable. |
| `checkoutOperationId` | Opération qui a confirmé le retrait. |
| `returnOperationId` | Opération qui a confirmé le retour, lorsque terminée. |
| `status` | Voir 5.5. |
| `checkedOutAt` | Moment de confirmation du retrait. |
| `returnRequestedAt` | Moment où un retour est commencé. |
| `returnedAt` | Moment de confirmation du retour. |

Invariant : un actif ne peut avoir qu’un prêt `ACTIVE` ou `RETURN_PENDING` à la fois.

### 4.12 Opération physique (`LockerOperation`)

Workflow temporaire et corrélé qui relie une intention utilisateur, une décision backend, une commande IoT et des observations physiques.

| Attribut logique | Description |
|---|---|
| `id` / `operationId` | Identifiant unique exposé dans les échanges. |
| `type` | `CHECKOUT` ou `RETURN`. |
| `status` | Voir 5.6. |
| `userId` | Utilisateur ayant initié l’action. |
| `assetId` | Actif attendu. |
| `compartmentId` | Compartiment à ouvrir. |
| `reservationId` | Réservation concernée pour un retrait. |
| `loanId` | Prêt concerné pour un retour. |
| `createdAt`, `authorizedAt`, `expiresAt`, `confirmedAt` | Jalons temporels du workflow. |
| `failureReason` | Raison technique ou métier en cas d’échec. |
| `anomalyId` | Anomalie liée, lorsque créée. |

Une opération est la seule racine autorisée d’une commande de déverrouillage. Une fois `CONFIRMED`, `FAILED`, `EXPIRED` ou `ANOMALY`, elle ne peut plus être rejouée.

### 4.13 Message IoT reçu (`InboundDeviceMessage`)

Enveloppe brute d’un message MQTT reçu du locker, conservée pour déduplication, diagnostic et audit technique.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant interne. |
| `lockerDeviceId` | Device émetteur reconnu. |
| `messageId` | Identifiant unique fourni par le device. |
| `topic` | Topic MQTT source. |
| `messageType` | Type déclaré : heartbeat, accusé, événement de porte, observation d’actif, etc. |
| `operationId` | Corrélation facultative à une opération. |
| `schemaVersion` | Version du contrat MQTT. |
| `occurredAt` | Horodatage déclaré par le device. |
| `receivedAt` | Horodatage de réception backend. |
| `rawPayload` | Corps original, préservé pour diagnostic. |
| `processingStatus` | Reçu, traité, ignoré comme doublon ou rejeté. |

Invariant : `(lockerDeviceId, messageId)` est unique. Un message dupliqué ne déclenche pas une deuxième transition métier.

### 4.14 Observation physique (`PhysicalObservation`)

Fait normalisé rapporté par le matériel après validation minimale du message source. Une observation peut confirmer, contredire ou ne pas suffire à conclure une opération.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique. |
| `inboundMessageId` | Message MQTT source. |
| `lockerId`, `compartmentId` | Emplacement observé. |
| `operationId` | Opération corrélée, lorsqu’elle est connue. |
| `type` | Voir 5.9. |
| `observedAt` | Moment physique déclaré/normalisé. |
| `identifierValue` | Tag ou valeur reconnue lorsque pertinent. |
| `value` | Valeur complémentaire : état, poids, booléen ou mesure. |
| `confidence` | Niveau de confiance si la technologie le fournit. |

L’observation est un fait; elle ne décide pas elle-même qu’un prêt est créé ou terminé. Le backend évalue sa cohérence avec l’opération attendue.

### 4.15 Heartbeat et état du device (`DeviceHeartbeat` / `DeviceStatus`)

Un heartbeat est un type de message IoT indiquant que le contrôleur est joignable. L’état en ligne/hors ligne est dérivé d’un seuil documenté.

| Terme | Sens |
|---|---|
| `DeviceHeartbeat` | Événement reçu avec `lockerId`, `messageId`, `timestamp`, version firmware et informations techniques minimales. |
| `ONLINE` | Un heartbeat valide a été reçu dans la fenêtre de tolérance. |
| `OFFLINE` | Le délai sans heartbeat dépasse cette fenêtre. |
| `UNKNOWN` | Aucune information suffisante ou redémarrage en cours. |

La durée exacte du timeout est une décision à formaliser dans le contrat MQTT ou un ADR.

### 4.16 Évaluation de readiness (`ReadinessAssessment`)

Décision calculée par le backend pour un **actif et un utilisateur donnés** à un instant donné.

| Attribut logique | Description |
|---|---|
| `assetId` | Actif évalué. |
| `userId` | Utilisateur pour lequel l’évaluation est faite. |
| `result` | `READY`, `BLOCKED` ou `UNKNOWN`. |
| `reasons` | Raisons de blocage ou d’incertitude, voir 5.1. |
| `evaluatedAt` | Moment du calcul. |
| `inputsVersion` | Référence logique aux données/événements utilisés si un audit détaillé est nécessaire. |

Cette structure est dérivée. Elle peut être renvoyée par l’API et enregistrée comme snapshot d’audit lors d’une décision, mais elle ne doit pas être modifiée directement par un écran d’administration.

### 4.17 Anomalie (`Anomaly`)

Écart visible qui empêche une conclusion silencieuse ou exige une intervention humaine.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique. |
| `type` | Nature de l’écart, voir 5.10. |
| `severity` | Importance pour la démonstration et le suivi. |
| `status` | Au minimum `OPEN`, `ACKNOWLEDGED`, `RESOLVED`. |
| `lockerOperationId` | Opération concernée si applicable. |
| `assetId`, `compartmentId` | Éléments physiques/métier concernés. |
| `detectedAt`, `resolvedAt` | Cycle de vie. |
| `details` | Explication lisible et données techniques utiles. |

### 4.18 Événement d’audit (`AuditEvent`)

Trace métier lisible qui explique ce qu’Aegis a décidé ou modifié.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique. |
| `eventType` | Par exemple réservation créée, ouverture autorisée, retrait confirmé, anomalie créée. |
| `actorUserId` | Utilisateur à l’origine de l’action, si applicable. |
| `subjectType`, `subjectId` | Objet principal concerné. |
| `operationId` | Corrélation facultative. |
| `occurredAt` | Moment de l’événement métier. |
| `details` | Contexte de lecture et données utiles. |

L’audit métier n’est pas un doublon du payload MQTT brut : le premier raconte la décision Aegis, le second conserve la preuve technique reçue.

### 4.19 Commande MQTT (`LockerCommandEnvelope`)

Objet de contrat envoyé du backend vers le locker. Ce n’est pas nécessairement une table indépendante : son historique peut être couvert par `LockerOperation`, les messages bruts et l’audit.

| Attribut logique | Description |
|---|---|
| `messageId` | Identifiant unique de la commande. |
| `operationId` | Opération autorisée source. |
| `lockerId`, `compartmentId` | Cible précise. |
| `type` | Au P0 : `UNLOCK_COMPARTMENT`. |
| `issuedAt`, `expiresAt` | Fenêtre de validité courte. |
| `schemaVersion` | Version du contrat. |

Le locker accuse réception ou rapporte un échec avec son propre message corrélé. Il refuse une commande expirée, invalide ou déjà consommée.

## 5. États et valeurs contrôlées

### 5.1 Résultat et raisons de readiness

| Catégorie | Valeurs |
|---|---|
| `ReadinessResult` | `READY`, `BLOCKED`, `UNKNOWN` |
| `ReadinessReason` | `NOT_PRESENT`, `NOT_AVAILABLE`, `MAINTENANCE`, `DAMAGED`, `CALIBRATION_EXPIRED`, `ACCESS_DENIED`, `UNKNOWN_PHYSICAL_STATE` |

Plusieurs raisons peuvent coexister. Les interfaces peuvent afficher une raison principale et conserver la liste complète.

### 5.2 État opérationnel de l’actif

```text
SERVICEABLE
MAINTENANCE
DAMAGED
```

### 5.3 État de calibration dérivé

```text
NOT_REQUIRED
VALID
EXPIRED
UNKNOWN
```

Règle P0 : si `calibrationRequired = true` et que `calibrationDueAt` est absente ou dépassée, la readiness ne peut pas être `READY`.

### 5.4 État de réservation

```text
ACTIVE
FULFILLED
CANCELLED
EXPIRED
```

### 5.5 État de prêt

```text
ACTIVE
RETURN_PENDING
COMPLETED
```

`RETURN_PENDING` signifie qu’une opération de retour valide est en cours; l’actif reste sous la responsabilité du titulaire jusqu’à la confirmation physique.

### 5.6 État de `LockerOperation`

```text
REQUESTED
AUTHORIZED
COMMAND_SENT
DOOR_OPENED
OBSERVATION_RECEIVED
CONFIRMED
FAILED
EXPIRED
ANOMALY
```

**Point à verrouiller avant l’implémentation :** le scope exige un accusé de réception de commande mais ne lui donne pas de statut distinct. Deux options cohérentes existent :

1. ajouter `COMMAND_ACKNOWLEDGED` entre `COMMAND_SENT` et `DOOR_OPENED`;
2. conserver le statut actuel et porter l’accusé dans un sous-état/audit technique.

La première option est plus lisible pour la démo et les tests; elle est recommandée.

### 5.7 État de porte observé

```text
OPEN
CLOSED
UNKNOWN
```

### 5.8 État de serrure observé

```text
LOCKED
UNLOCKED
UNKNOWN
```

### 5.9 Types d’observations physiques initiaux

```text
DOOR_OPENED
DOOR_CLOSED
LOCK_UNLOCKED
LOCK_LOCKED
ASSET_PRESENT
ASSET_ABSENT
ASSET_IDENTIFIER_DETECTED
DEVICE_RESTARTED
```

La méthode de détection (RFID, NFC, QR, poids ou présence) change le contenu de l’observation, pas le langage métier utilisé par le backend.

### 5.10 Types d’anomalies P0

```text
EXPECTED_ASSET_NOT_OBSERVED
UNEXPECTED_ASSET_OBSERVED
DOOR_NOT_CLOSED_BEFORE_EXPIRY
COMMAND_REJECTED
DEVICE_OFFLINE_DURING_OPERATION
INCONSISTENT_PHYSICAL_STATE
```

## 6. Invariants à représenter dans le modèle et les tests

1. Seul le backend peut créer une `LockerOperation` autorisée et produire une commande de déverrouillage.
2. Un actif n’a au plus qu’une réservation `ACTIVE`.
3. Un actif n’a au plus qu’un prêt actif ou en retour.
4. Un compartiment n’a au plus qu’une affectation attendue active dans le P0.
5. Une opération `CONFIRMED`, `FAILED`, `EXPIRED` ou `ANOMALY` est terminale.
6. Un message MQTT identifié par le même `(lockerDeviceId, messageId)` ne peut déclencher qu’un seul traitement métier.
7. Un prêt est créé uniquement après confirmation physique cohérente d’une opération `CHECKOUT`.
8. Un prêt est complété uniquement après confirmation physique cohérente d’une opération `RETURN`.
9. Un actif non `READY` ne peut être réservé ni ouvert.
10. Une commande ne peut viser qu’un compartiment, une opération et une fenêtre d’expiration valides.
11. L’état de readiness est toujours dérivé; il n’est jamais modifié directement.

## 7. Décisions encore nécessaires avant le schéma PostgreSQL

| Décision | Pourquoi elle compte | Porte de décision |
|---|---|---|
| Une cellule correspond-elle exactement à un compartiment? | Détermine le diagramme physique et la configuration de câblage, mais pas le cœur métier. | POC hub/cellule. |
| Statut `COMMAND_ACKNOWLEDGED` distinct ou audit seulement? | Clarifie les transitions et les tests IoT. | ADR / machine à états. |
| Quel est le timeout d’un heartbeat, d’une réservation et d’une opération? | Définit les états `OFFLINE` et `EXPIRED`. | Contrat MQTT + ADR. |
| Quelle preuve physique est suffisante pour `ASSET_PRESENT` ou `ASSET_ABSENT`? | Détermine la logique de confirmation et le payload d’observation. | POC RFID/fallback. |
| Plusieurs réservations par utilisateur sont-elles permises? | Impacte les règles métier et l’UX mobile. | Story map / règle P0. |
| L’administrateur peut-il résoudre une anomalie sans corriger l’état matériel? | Détermine le workflow d’exception. | ADR et stories P1/P0. |


Ce document doit évoluer lorsqu’un POC matériel ou un ADR change une hypothèse. Toute évolution doit conserver les principes : backend autoritaire, observation physique normalisée, idempotence et audit.
