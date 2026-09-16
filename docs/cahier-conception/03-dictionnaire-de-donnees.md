# Aegis — Dictionnaire de données métier

**Version :** 1.3 — contrôle local QR, étoile et cohérence du retour
**Date de révision :** 16 septembre 2026
**Statut :** Version de référence pour le cahier de conception  
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

| Domaine | Concepts reliés | Sens |
|---|---|---|
| Catalogue | AssetModel, Asset, AssetIdentifier | Modèle, exemplaire et identité physique |
| Matériel | Locker, LockerDevice, Compartment, AssetPlacement | Hub, cellules et emplacements attendus |
| Usage | User, Reservation, Loan | Réservation puis chaîne de possession confirmée |
| Accès local | LockerOperation, LocalAccessChallenge, HubDisplayMessage | Intention, code affiché, autorisation et commande |
| Preuves | InboundDeviceMessage, PhysicalObservation | Faits techniques puis interprétation backend |
| Traçabilité | AuditEvent, Anomaly | Transitions et écarts à corriger |

`ReadinessAssessment` est dérivée de l’actif, de sa présence, de son état opérationnel, de sa calibration, de sa disponibilité et du demandeur. Le QR intervient ensuite comme garde d’ouverture.

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
| `availabilityStatus` | Disponibilité transactionnelle dérivée des réservations, prêts et archivage. | Voir 5.2. |
| `operationalStatus` | État administratif/technique courant. | Voir 5.3. |
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
| `topology` | `HUB_CELL` en étoile retenu; `MONOLITHIC` est seulement le repli documenté. |
| `displayRevision` | Compteur croissant des instructions d’écran du locker. |

Le locker est le concept métier exposé aux utilisateurs. La topologie hub/cellule est une décision d’architecture physique qui ne doit pas changer la logique de réservation ou de prêt.

Dans l’architecture cible, un locker est composé d’un **hub maître** et d’une pile de **cellules**. Le hub contient l’écran, le contrôleur ESP32, la connectivité réseau et l’interface de communication locale avec les cellules. Il relaie les commandes et observations, mais n’évalue jamais la readiness, les droits d’accès ou les réservations : ces décisions appartiennent au backend Spring Boot.

Le P0 cible un hub et deux cellules. Si le POC hub/cellule échoue, le même concept `Locker` est réalisé par un ESP32 pilotant directement deux compartiments.

### 4.7 Compartiment / cellule (`Compartment`)

Cavité verrouillable et module physique empilable d’un locker, liée à une serrure, une porte, un lecteur RFID UHF local et des capteurs. Dans l’architecture hub/cellule, **une cellule représente exactement un compartiment**. `Compartment` demeure le nom canonique dans le domaine et les contrats; « cellule » décrit le module matériel. Le P0 comporte deux cellules indépendantes fixées au hub.

| Attribut logique | Description | Règle P0 |
|---|---|---|
| `id` | Identifiant unique. | Immuable. |
| `lockerId` | Locker parent. | Requis. |
| `code` | Référence lisible, par exemple `A1`. | Unique dans un locker. |
| `hubPort` | Port physique du hub dédié à cette cellule. | Unique dans le locker; ne change pas son `compartmentId`. |
| `cellAddress` | Adresse locale utilisée par le hub pour joindre la cellule. | Unique dans le locker si `HUB_CELL`. |
| `enabled` | Indique si le compartiment peut être utilisé. | `false` bloque une opération. |
| `connectionStatus` | État de communication de la cellule avec le hub. | `CONNECTED`, `DISCONNECTED` ou `UNKNOWN` si `HUB_CELL`. |
| `rfidReaderStatus` | Dernier état de santé connu du lecteur RFID UHF local. | `HEALTHY`, `FAULTED` ou `UNKNOWN`. |
| `doorState` | Dernier état physique connu de la porte. | État observé, voir 5.8. |
| `lockState` | Dernier état de serrure connu. | État observé, voir 5.9. |
| `lastObservedAt` | Date de la dernière observation liée au compartiment. | Sert à détecter l’incertitude. |

Un compartiment n’est pas automatiquement la preuve de présence d’un actif. Il contient une **affectation attendue**, ensuite validée ou contredite par les observations physiques.

Chaque cellule lit localement les tags des actifs présents dans sa zone. Elle transmet les identifiants observés et ses états au hub par sa liaison RS-485 point à point dédiée vers le hub. Elle ne possède ni Wi-Fi, ni client MQTT, ni autorité métier. Le hub est le seul contrôleur du locker à communiquer avec le backend.

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
| `deviceSessionId` | Identifiant du démarrage courant; invalide un ancien défi QR après redémarrage. |
| `firmwareVersion` | Version déclarée par le device. |
| `connectionStatus` | État dérivé des heartbeats. |
| `lastSeenAt` | Date du dernier heartbeat valide. |
| `registeredAt`, `disabledAt` | Cycle de vie du device. |

Le `LockerDevice` est le contrôleur réseau du hub. Une cellule possède son électronique locale et son lecteur RFID, mais n’est pas un device MQTT distinct.

### 4.10 Horaire d’exploitation (`OperatingSchedule`)

Configuration administrée qui regroupe les périodes pendant lesquelles une réservation, un retrait ou un retour peut être initié.

| Attribut logique | Description | Règle P0 |
|---|---|---|
| `id` | Identifiant unique de la configuration. | Immuable. |
| `lockerId` | Locker auquel l’horaire s’applique. | Un horaire actif par locker. |
| `timeZone` | Fuseau utilisé pour interpréter les heures locales. | `America/Toronto` pour la démonstration. |
| `active` | Indique si cet horaire est appliqué. | Un seul horaire actif par locker. |
| `updatedBy`, `updatedAt` | Administrateur et date du dernier changement. | Audit requis. |

### 4.11 Plage d’exploitation (`OperatingWindow`)

Période d’ouverture récurrente associée à un jour de la semaine.

| Attribut logique | Description | Règle P0 |
|---|---|---|
| `id` | Identifiant unique de la plage. | Immuable. |
| `operatingScheduleId` | Horaire hebdomadaire parent. | Requis. |
| `dayOfWeek` | Jour de la semaine. | `MONDAY` à `SUNDAY`. |
| `opensAt` | Heure locale d’ouverture. | Requise pour un jour ouvert. |
| `closesAt` | Heure locale de fermeture. | Strictement après `opensAt` dans le P0. |
| `enabled` | Indique si le service est ouvert ce jour-là. | Un jour fermé n’accepte aucune réservation. |

Le P0 autorise au maximum une plage continue par jour. Les jours fériés, exceptions datées, plages multiples et horaires de nuit traversant minuit sont reportés après le P0.

Les timestamps métier sont conservés en UTC. L’horaire est défini avec un fuseau IANA afin que les changements d’heure ne soient pas traités comme de simples décalages fixes.

### 4.12 Réservation (`Reservation`)

Intention temporaire d’un technicien d’obtenir un actif donné.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique. |
| `assetId` | Actif réservé. |
| `userId` | Technicien bénéficiaire. |
| `status` | Voir 5.5. |
| `createdAt` | Moment où la demande est enregistrée. |
| `reservedFrom` | Début demandé de la fenêtre d’utilisation. Dans le P0, il correspond au moment de création. |
| `reservedUntil` | Heure de retour attendue choisie par le technicien. |
| `expiredAt` | Moment où une réservation non utilisée est effectivement passée à `EXPIRED`. |
| `cancelledAt`, `fulfilledAt` | Dates de conclusion selon le résultat. |

Invariant : un actif ne peut pas avoir deux réservations `ACTIVE` simultanées. `reservedFrom` et `reservedUntil` doivent appartenir à une même plage ouverte et `reservedUntil` doit être postérieur à `reservedFrom`. Une réservation ne vaut pas preuve de retrait.

Invariant P0 supplémentaire : un technicien ne peut posséder qu’une seule réservation `ACTIVE`, tous actifs confondus.

Le technicien choisit sa durée en sélectionnant `reservedUntil`. La limite maximale est la fermeture de la plage d’exploitation courante. Une réservation demandée hors des heures d’exploitation ou se terminant après `closesAt` est refusée.

Une réservation non utilisée passe à `EXPIRED` lorsque `reservedUntil` est atteint. Si le retrait a déjà été confirmé, la réservation est déjà `FULFILLED` et son échéance ne modifie jamais la disponibilité de l’actif : le prêt actif devient alors la source de vérité.

### 4.13 Prêt / chaîne de possession (`Loan`)

Période pendant laquelle un actif est officiellement attribué à un utilisateur après un retrait physiquement confirmé.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique du prêt. |
| `assetId` | Actif prêté. |
| `holderUserId` | Utilisateur responsable. |
| `checkoutOperationId` | Opération qui a confirmé le retrait. |
| `returnOperationId` | Opération qui a confirmé le retour, lorsque terminée. |
| `status` | Voir 5.6. |
| `checkedOutAt` | Moment de confirmation du retrait. |
| `dueAt` | Heure de retour attendue, copiée depuis `Reservation.reservedUntil`. |
| `overdue` | Indicateur dérivé : `true` lorsque `dueAt` est dépassée et que le prêt n’est pas terminé. |
| `returnRequestedAt` | Moment où un retour est commencé. |
| `returnedAt` | Moment de confirmation du retour. |

Invariant : un actif ne peut avoir qu’un prêt `ACTIVE` ou `RETURN_PENDING` à la fois.

Dépasser `dueAt` ne complète jamais le prêt et ne rend jamais l’actif disponible. Tant que le retour physique n’est pas confirmé, l’actif demeure `BORROWED`, sa readiness est `BLOCKED` avec la raison `NOT_AVAILABLE`, et le prêt est présenté comme en retard.

### 4.14 Opération physique (`LockerOperation`)

Workflow temporaire et corrélé qui relie une intention utilisateur, une décision backend, une commande IoT et des observations physiques.

| Attribut logique | Description |
|---|---|
| `id` / `operationId` | Identifiant unique exposé dans les échanges. |
| `type` | `CHECKOUT` ou `RETURN`. |
| `status` | Voir 5.7. |
| `userId` | Utilisateur ayant initié l’action. |
| `assetId` | Actif attendu. |
| `compartmentId` | Compartiment à ouvrir. |
| `reservationId` | Réservation concernée pour un retrait. |
| `loanId` | Prêt concerné pour un retour. |
| `createdAt`, `authorizedAt`, `commandSentAt`, `acknowledgedAt`, `expiresAt`, `confirmedAt` | Jalons temporels du workflow. |
| `localAccessChallengeId` | Défi QR associé, sans exposer son secret. |
| `localProofValidatedAt` | Instant de validation et de consommation du défi; égal à `authorizedAt`. |
| `failureReason` | Raison technique ou métier en cas d’échec. |
| `anomalyId` | Anomalie liée, lorsque créée. |

Une réservation, même distante, ne déclenche aucune ouverture. Une demande de retrait ou de retour crée une opération `AWAITING_LOCAL_PROOF`. Son `authorizedAt` et son `expiresAt` restent nuls jusqu’à la validation du QR par le backend. Pendant cette attente, un prêt `ACTIVE` reste `ACTIVE`.

Une opération est la seule racine autorisée d’une commande de déverrouillage. Une fois `CONFIRMED`, `FAILED`, `EXPIRED` ou `ANOMALY`, elle ne peut plus être rejouée.

Dans le P0, `expiresAt` est fixé à **120 secondes après `authorizedAt`**. Si le délai expire après que la cellule a été déverrouillée ou ouverte, l’état physique est incertain et une anomalie est créée au lieu de rendre silencieusement l’opération réutilisable.

### 4.15 Message IoT reçu (`InboundDeviceMessage`)

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

### 4.16 Observation physique (`PhysicalObservation`)

Fait normalisé rapporté par le matériel après validation minimale du message source. Une observation peut confirmer, contredire ou ne pas suffire à conclure une opération.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique. |
| `inboundMessageId` | Message MQTT source. |
| `lockerId`, `compartmentId` | Emplacement observé. |
| `operationId` | Opération corrélée, lorsqu’elle est connue. |
| `type` | Voir 5.10. |
| `observedAt` | Moment physique déclaré/normalisé. |
| `identifierValue` | Tag ou valeur reconnue lorsque pertinent. |
| `value` | Valeur complémentaire : état, poids, booléen ou mesure. |
| `confidence` | Niveau de confiance si la technologie le fournit. |

L’observation est un fait; elle ne décide pas elle-même qu’un prêt est créé ou terminé. Le backend évalue sa cohérence avec l’opération attendue.

#### Preuve physique minimale du P0

Le RFID UHF est la méthode de détection principale du P0, avec un lecteur local dans chaque cellule. **Une lecture RFID isolée ne suffit pas** à confirmer une opération. La preuve combine une séquence de porte et l’observation stable de l’identifiant attendu :

- retrait : commande reconnue, porte ouverte, identifiant attendu devenu absent dans la bonne cellule, puis porte refermée;
- retour : commande reconnue, porte ouverte, identifiant attendu observé de manière stable dans la bonne cellule, puis porte refermée.

Le POC calibre la fenêtre de stabilisation et la puissance de lecture; il ne remet pas en question le choix initial sans preuve d’échec. La valeur de départ est une fenêtre de trois secondes après fermeture : `PRESENT` exige au moins trois lectures cohérentes du tag attendu dans la cellule concernée; `ABSENT` exige l’absence de ce tag pendant toute la fenêtre, un lecteur déclaré sain et une séquence de porte complète. Une lecture ambiguë entre deux cellules produit `UNKNOWN_PHYSICAL_STATE` ou une anomalie.

Si le RFID UHF ne localise pas suffisamment l’actif dans la bonne cellule après réglage et tests, le fallback combine QR ou NFC pour l’identité, capteur de porte et capteur de présence ou de poids pour la preuve physique.

### 4.17 Heartbeat et état du device (`DeviceHeartbeat` / `DeviceStatus`)

Un heartbeat est un type de message IoT indiquant que le contrôleur est joignable. L’état en ligne/hors ligne est dérivé d’un seuil documenté.

| Terme | Sens |
|---|---|
| `DeviceHeartbeat` | Événement reçu avec `lockerId`, `messageId`, `timestamp`, version firmware et informations techniques minimales. |
| `ONLINE` | Un heartbeat valide a été reçu depuis 30 secondes ou moins. |
| `OFFLINE` | Aucun heartbeat valide n’a été reçu depuis plus de 30 secondes. |
| `UNKNOWN` | Aucune information suffisante ou redémarrage en cours. |

Valeur P0 : le device publie un heartbeat toutes les **10 secondes** et le backend le considère `OFFLINE` après **30 secondes**, soit trois périodes manquées. Ces valeurs sont configurables et doivent être documentées dans le contrat MQTT.

### 4.18 Évaluation de readiness (`ReadinessAssessment`)

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

### 4.19 Anomalie (`Anomaly`)

Écart visible qui empêche une conclusion silencieuse ou exige une intervention humaine.

| Attribut logique | Description |
|---|---|
| `id` | Identifiant unique. |
| `type` | Nature de l’écart, voir 5.11. |
| `severity` | Importance pour la démonstration et le suivi. |
| `status` | Au minimum `OPEN`, `ACKNOWLEDGED`, `RESOLVED`. |
| `lockerOperationId` | Opération concernée si applicable. |
| `assetId`, `compartmentId` | Éléments physiques/métier concernés. |
| `detectedAt`, `resolvedAt` | Cycle de vie. |
| `details` | Explication lisible et données techniques utiles. |
| `resolutionEvidenceObservationId` | Observation physique prouvant que l’incohérence a été corrigée. |
| `resolutionNote` | Explication de la correction effectuée. |

Un administrateur peut reconnaître une anomalie en la passant à `ACKNOWLEDGED` et ajouter une note, mais il ne peut pas la déclarer résolue manuellement. Le backend applique `RESOLVED` uniquement après une nouvelle observation physique cohérente avec l’état attendu.

### 4.20 Événement d’audit (`AuditEvent`)

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

### 4.21 Commande MQTT (`LockerCommandEnvelope`)

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


### 4.22 Défi local d’accès (`LocalAccessChallenge`)

Secret éphémère affiché sur l’écran du hub pour une opération précise. L’utilisateur le scanne avec Aegis Mobile, puis l’API authentifiée le valide. Cette vérification établit l’accès au code récemment affiché, pas une preuve absolue de présence : une photo ou une vidéo relayée demeure un risque.

| Attribut logique | Description |
|---|---|
| `id` / `challengeId` | Identifiant public du défi. |
| `operationId` | Opération unique; fixe l’utilisateur, l’action, l’actif, le locker, la cellule et la réservation ou le prêt. |
| `lockerDeviceId`, `deviceSessionId` | Hub et démarrage autorisés à afficher ce défi. |
| `tokenHash` | Empreinte SHA-256 d’un secret aléatoire de 256 bits; jamais le secret en clair dans cette entité. |
| `status` | `PENDING`, `CONSUMED`, `EXPIRED` ou `INVALIDATED`. |
| `createdAt`, `expiresAt` | Fenêtre du défi : au plus 60 s, sans dépasser fermeture ni `reservedUntil` pour un retrait. |
| `displayedAt` | Accusé applicatif d’affichage émis par le bon hub. |
| `consumedAt` | Validation unique dans la transaction d’autorisation. |
| `closedAt` | Instant de consommation, d’expiration ou d’invalidation. |
| `failedAttempts` | Nombre de secrets erronés soumis par l’initiateur; maximum proposé : 5. |

Les **60 secondes et 5 essais sont des paramètres proposés dans cette révision**, à confirmer pendant le test d’usage. Le délai physique de 120 secondes reste inchangé et commence après validation.

Le secret est transmis uniquement au hub via MQTT chiffré, puis optiquement au téléphone. Il n’est jamais renvoyé par une route de lecture REST, un audit ou une page d’administration. Une nouvelle tentative après expiration crée une nouvelle opération et un nouveau défi.

### 4.23 Instruction d’écran (`HubDisplayMessage`)

Instruction du backend destinée à l’écran : `DISPLAY_ACCESS_CHALLENGE` ou `DISPLAY_OPERATION_STATUS`.

| Attribut logique | Description |
|---|---|
| `messageId` | Identifiant idempotent de l’instruction d’affichage. |
| `operationId`, `lockerId`, `lockerDeviceId` | Cible et contexte. |
| `targetDeviceSessionId` | Démarrage précis du hub destinataire. |
| `displayRevision` | Ordre croissant par locker; empêche un ancien QR de remplacer un résultat récent. |
| `expiresAt` | Date après laquelle l’instruction ne doit plus être affichée. |
| `challengeId` | Présent uniquement pour le QR. |
| `encryptedPayload` | Charge utile chiffrée dans l’outbox d’écran, distincte de celle des commandes de serrure. |

Le hub efface le QR à l’expiration, au redémarrage ou au début de l’exécution de la commande correspondante. Il affiche un succès métier seulement sur instruction backend. Le QR d’accès ne remplace ni le tag RFID de l’actif ni les capteurs de porte.

## 5. États et valeurs contrôlées

### 5.1 Résultat et raisons de readiness

| Catégorie | Valeurs |
|---|---|
| `ReadinessResult` | `READY`, `BLOCKED`, `UNKNOWN` |
| `ReadinessReason` | `NOT_PRESENT`, `NOT_AVAILABLE`, `MAINTENANCE`, `DAMAGED`, `CALIBRATION_EXPIRED`, `ACCESS_DENIED`, `UNKNOWN_PHYSICAL_STATE` |

Plusieurs raisons peuvent coexister. Les interfaces peuvent afficher une raison principale et conserver la liste complète.

### 5.2 Disponibilité transactionnelle de l’actif

```text
AVAILABLE
RESERVED
BORROWED
UNAVAILABLE
```

La disponibilité est dérivée selon la priorité suivante :

1. un prêt non terminé produit `BORROWED`, même après son échéance;
2. sinon, une réservation `ACTIVE` produit `RESERVED`;
3. sinon, un actif archivé ou administrativement désactivé produit `UNAVAILABLE`;
4. sinon, l’actif produit `AVAILABLE`.

La présence physique, la calibration, l’état opérationnel et l’accès ne sont pas fusionnés dans cette valeur : ils participent séparément au calcul de readiness.

### 5.3 État opérationnel de l’actif

```text
SERVICEABLE
MAINTENANCE
DAMAGED
```

### 5.4 État de calibration dérivé

```text
NOT_REQUIRED
VALID
EXPIRED
UNKNOWN
```

Règle P0 : si `calibrationRequired = true` et que `calibrationDueAt` est absente ou dépassée, la readiness ne peut pas être `READY`.

### 5.5 État de réservation

```text
ACTIVE
FULFILLED
CANCELLED
EXPIRED
```

### 5.6 État de prêt

```text
ACTIVE
RETURN_PENDING
COMPLETED
```

`RETURN_PENDING` signifie qu’une opération de retour valide est en cours; l’actif reste sous la responsabilité du titulaire jusqu’à la confirmation physique.

Le retard est représenté par la propriété dérivée `overdue`; il ne termine pas le prêt et ne remplace pas son statut.

### 5.7 État de `LockerOperation`

```text
REQUESTED
AWAITING_LOCAL_PROOF
AUTHORIZED
COMMAND_SENT
COMMAND_ACKNOWLEDGED
DOOR_OPENED
OBSERVATION_RECEIVED
CONFIRMED
FAILED
EXPIRED
ANOMALY
```

`COMMAND_ACKNOWLEDGED` confirme que le hub a accepté la commande avant toute observation d’ouverture. Il ne constitue pas une preuve que la porte a été ouverte ou que l’actif a été retiré/retourné.

### 5.8 État de porte observé

```text
OPEN
CLOSED
UNKNOWN
```

### 5.9 État de serrure observé

```text
LOCKED
UNLOCKED
UNKNOWN
```

### 5.10 Types d’observations physiques initiaux

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

### 5.11 Types d’anomalies P0

```text
EXPECTED_ASSET_NOT_OBSERVED
UNEXPECTED_ASSET_OBSERVED
ASSET_PRESENT_WITH_ACTIVE_LOAN
DOOR_NOT_CLOSED_BEFORE_EXPIRY
COMMAND_REJECTED
DEVICE_OFFLINE_DURING_OPERATION
INCONSISTENT_PHYSICAL_STATE
```

## 6. Invariants à représenter dans le modèle et les tests

1. Seul le backend peut créer une `LockerOperation` autorisée et produire une commande de déverrouillage.
2. Un actif n’a au plus qu’une réservation `ACTIVE`.
3. Un technicien n’a au plus qu’une réservation `ACTIVE` dans le P0.
4. Une réservation doit commencer et se terminer dans une même plage d’exploitation ouverte.
5. Une réservation expirée sans retrait libère uniquement la réservation; la disponibilité complète de l’actif est toujours recalculée.
6. Une réservation déjà `FULFILLED` ne peut jamais rendre un actif disponible lorsque son heure de fin est dépassée.
7. Un actif n’a au plus qu’un prêt actif ou en retour.
8. Un prêt dépassant `dueAt` demeure ouvert et l’actif demeure `BORROWED` jusqu’au retour physiquement confirmé.
9. Un compartiment n’a au plus qu’une affectation attendue active dans le P0.
10. Une cellule physique représente exactement un compartiment dans l’architecture hub/cellule.
11. Une opération `CONFIRMED`, `FAILED`, `EXPIRED` ou `ANOMALY` est terminale.
12. Une `LockerOperation` expire 120 secondes après son autorisation.
13. Un message MQTT identifié par le même `(lockerDeviceId, messageId)` ne peut déclencher qu’un seul traitement métier.
14. Un prêt est créé uniquement après confirmation physique cohérente d’une opération `CHECKOUT`.
15. Un prêt est complété uniquement après confirmation physique cohérente d’une opération `RETURN`.
16. Un actif non `READY` ne peut être réservé ni retiré; la readiness du retrait tient compte de la réservation valide du titulaire. Le retour d'un prêt ouvert applique ses propres gardes d'autorisation et de sécurité, sans exiger que l'actif soit `READY`.
17. Une commande ne peut viser qu’un compartiment, une opération et une fenêtre d’expiration valides.
18. L’état de readiness est toujours dérivé; il n’est jamais modifié directement.
19. Une anomalie ne passe à `RESOLVED` qu’après réception d’une preuve physique cohérente; l’administrateur peut seulement la reconnaître et documenter la correction.
20. Une cellule ne dialogue jamais directement avec MQTT : ses observations RFID, de porte et de serrure transitent par le hub.
21. Un actif observé dans sa cellule alors qu’un prêt reste ouvert demeure `BORROWED` et produit `ASSET_PRESENT_WITH_ACTIVE_LOAN`; seul un retour corrélé et confirmé peut terminer le prêt.

## 7. Décisions d’équipe intégrées

| Décision | Résultat retenu |
|---|---|
| Relation cellule / compartiment | Une cellule est un compartiment physique empilable. Le P0 cible un hub et deux cellules. |
| RFID par cellule | Chaque cellule possède son propre lecteur RFID UHF et effectue la lecture localement. Tous les actifs P0 possèdent un tag actif unique. |
| Bus local | Étoile validée : un câble Cat5e/Cat6 terminé en RJ45 par cellule. Proposition de réalisation : une liaison RS-485 half-duplex indépendante par port; Modbus RTU minimal à confirmer au POC. Aucun raccordement Ethernet/PoE. |
| Accusé de réception | `COMMAND_ACKNOWLEDGED` est un état distinct de `LockerOperation`. |
| Réservations du technicien | Une seule réservation `ACTIVE` par technicien dans le P0. |
| Fenêtre de réservation | Durée personnalisée choisie par le technicien, obligatoirement comprise dans les heures d’exploitation configurées par l’administrateur. |
| Expiration et disponibilité | L’expiration d’une réservation non utilisée libère la réservation. Après retrait, seul le retour physique confirmé termine le prêt et permet de retrouver `AVAILABLE`. |
| Durée d’opération | 120 secondes à partir de `authorizedAt`. |
| Détection principale | RFID UHF local, combiné obligatoirement à la séquence de porte. Fenêtre initiale : trois lectures cohérentes en trois secondes. |
| État hors ligne | Heartbeat toutes les 10 secondes; `OFFLINE` après 30 secondes sans heartbeat valide. |
| Résolution d’anomalie | Pas de fermeture administrative directe; une nouvelle preuve physique cohérente est requise. |

### Compléments de la révision QR

- Une seule opération non terminale par locker, y compris `AWAITING_LOCAL_PROOF`.
- L’autorisation, la consommation du défi, le passage éventuel du prêt à `RETURN_PENDING`, la commande durable et l’audit sont atomiques.
- Sans QR valide : aucune commande de serrure. Un refus ou une expiration avant autorisation n’introduit pas d’incertitude physique.
- L’écran de guidage QR devient nécessaire au P0; aucun écran de réservation autonome n’est ajouté.
- La réservation distante reste permise. Empêcher également la réservation distante constituerait une autre règle produit.
