# Aegis — Algorithmes et flux fonctionnels

**Cours :** 420-5X7-SO — Écosystème connecté  
**Session :** Automne 2026  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Date :** 16 septembre 2026  
**Version :** 1.1  

---

## 1. Rôle du document

Ce document décrit comment Aegis prend ses décisions et exécute ses parcours P0.

Il transforme le périmètre, le dictionnaire de données, le modèle logique et les machines à états en règles d’exécution vérifiables. Il définit notamment :

- le calcul de la readiness;
- la création et l’expiration d’une réservation;
- l’autorisation d’un retrait ou d’un retour;
- l’émission fiable d’une commande d’ouverture;
- le traitement idempotent des messages MQTT;
- la validation des preuves physiques;
- la création et la fin de la chaîne de possession;
- le traitement du temps, des déconnexions et des anomalies.

Ce document reste indépendant des classes Java, des routes REST, des tables SQL et des payloads MQTT exacts. Ceux-ci devront implémenter les algorithmes présentés sans en affaiblir les gardes.

### 1.1 Sources de référence

Les règles proviennent, dans cet ordre, de :

1. `docs/cahier-conception/01-scope.md`, version 0.4;
2. `03-dictionnaire-de-donnees.md`;
3. `04-modele-de-donnees-logique.md`;
4. `05-machines-a-etats.md`;
5. `README.md`.

En cas de divergence, le scope prévaut et la divergence doit être corrigée dans les autres documents.

---

## 2. Frontières d’autorité

### 2.1 Règle centrale

Le backend Spring Boot est la seule autorité métier.

| Composant | Peut faire | Ne peut pas faire |
|---|---|---|
| Aegis Mobile | Demander, afficher, suivre une opération | Autoriser une ouverture ou confirmer un prêt |
| Aegis Manager | Administrer les données, reconnaître une anomalie | Forcer une readiness ou résoudre une anomalie |
| Backend Spring Boot | Valider, autoriser, transitionner, auditer | Considérer une intention comme une preuve physique |
| Broker MQTT | Transporter les messages autorisés | Interpréter les règles métier |
| Hub ESP32 | Valider techniquement et relayer une commande | Décider si un utilisateur ou un actif est admissible |
| Cellule | Actionner, mesurer et rapporter localement | Communiquer directement avec MQTT ou modifier un état métier |

### 2.2 Séparation des faits et des décisions

| Nature | Exemple | Traitement |
|---|---|---|
| Intention | « Je veux retirer cet actif » | Démarre une évaluation |
| Décision | « Cette ouverture est autorisée pendant 120 secondes » | Produite uniquement par le backend |
| Commande | « Déverrouiller A1 » | Exécutée par le hub et la cellule |
| Observation | « La porte A1 est fermée et le tag X est absent » | Conservée comme preuve |
| Transition métier | « Le retrait est confirmé; le prêt commence » | Appliquée uniquement par le backend |

Aucune observation isolée ne constitue automatiquement une transition métier.

---

## 3. Conventions algorithmiques

### 3.1 Résultat d’une décision

Chaque commande applicative retourne l’un des résultats suivants :

| Résultat | Signification |
|---|---|
| `ACCEPTED` | La demande a été appliquée et son nouvel état est connu |
| `IN_PROGRESS` | Une opération physique est autorisée ou en attente de preuves |
| `REJECTED` | Une garde métier ou de sécurité a échoué |
| `CONFLICT` | L’état a changé ou une opération concurrente existe |
| `ALREADY_APPLIED` | La même intention a déjà produit son effet; le résultat existant est retourné |
| `ANOMALY_REQUIRES_ACTION` | La réalité physique n’est pas suffisamment sûre pour conclure |

Les contrats REST pourront mapper ces résultats à des statuts HTTP, sans modifier leur sens métier.

### 3.2 Horodatage

- Tous les instants persistés sont en UTC.
- Les heures d’exploitation sont interprétées dans `America/Toronto` pour le P0.
- Le backend utilise son horloge comme référence pour `authorizedAt`, `expiresAt`, `fulfilledAt`, `checkedOutAt` et `returnedAt`.
- Un timestamp fourni par un device est une donnée de preuve; il ne remplace pas `receivedAt`.
- Les comparaisons temporelles utilisent un instant capturé une seule fois au début de la transaction.

### 3.3 Verrouillage et ordre d’accès

Les opérations concurrentes verrouillent toujours les objets dans un ordre stable afin de limiter les interblocages :

1. utilisateur;
2. actif;
3. réservation ou prêt;
4. locker puis compartiment;
5. LockerOperation;
6. anomalie, si nécessaire.

Les contraintes PostgreSQL demeurent la dernière barrière contre les doublons, même lorsque les vérifications applicatives ont déjà été exécutées.

### 3.4 Principe de nouvelle tentative

- Une requête applicative répétée avec la même clé d’idempotence retourne le résultat existant.
- Une nouvelle tentative physique après une opération terminale crée un nouvel `operationId`.
- Une republication technique d’une même commande conserve le même `messageId` et le même `operationId`.
- Aucun statut terminal n’est réactivé.

---

## 4. Algorithme de readiness

### 4.1 But

La readiness répond à cette question :

> Cet actif est-il réellement prêt, conforme et autorisé pour cet utilisateur maintenant?

Elle est recalculée à la lecture, à la réservation et immédiatement avant une ouverture. Elle n’est jamais modifiée par un administrateur.

### 4.2 Entrées

| Entrée | Données utiles |
|---|---|
| User | statut, rôle, maximumAccessLevel |
| Asset | archivage, état opérationnel, calibration, niveau requis |
| Disponibilité | réservation active, prêt non terminé |
| AssetPlacement | compartiment actuellement attendu |
| AssetIdentifier | identifiant physique actif attendu |
| État physique | présence localisée, santé du lecteur, porte, fraîcheur des observations |
| Contexte | lecture générale, nouvelle réservation ou retrait d’une réservation existante |

Le contexte sert uniquement à reconnaître qu’une réservation détenue par le même technicien est compatible avec son propre retrait. Elle demeure incompatible pour les autres utilisateurs.

### 4.3 Priorité des résultats

1. Une condition qui prouve que l’actif ne peut pas être utilisé produit `BLOCKED`.
2. En l’absence de blocage certain, une preuve physique insuffisante produit `UNKNOWN`.
3. `READY` est retourné uniquement si toutes les conditions sont satisfaites.

Cette priorité permet de retourner `BLOCKED` lorsqu’un actif est clairement endommagé, même si son lecteur RFID est momentanément indisponible : il est déjà certain que l’actif n’est pas prêt.

### 4.4 Matrice de décision

| Condition | Résultat ou raison ajoutée |
|---|---|
| Utilisateur désactivé ou rôle incompatible | Demande rejetée avant l’évaluation |
| Actif archivé ou administrativement indisponible | `BLOCKED / NOT_AVAILABLE` |
| Prêt `ACTIVE` ou `RETURN_PENDING` | `BLOCKED / NOT_AVAILABLE` |
| Réservation active incompatible avec l’utilisateur ou l’action | `BLOCKED / NOT_AVAILABLE` |
| Actif absent de sa cellule | `BLOCKED / NOT_PRESENT` |
| Actif en maintenance | `BLOCKED / MAINTENANCE` |
| Actif endommagé | `BLOCKED / DAMAGED` |
| Calibration obligatoire et échue | `BLOCKED / CALIBRATION_EXPIRED` |
| Niveau d’accès insuffisant | `BLOCKED / ACCESS_DENIED` |
| Locker hors ligne, cellule déconnectée, lecteur défaillant ou localisation ambiguë | `UNKNOWN / UNKNOWN_PHYSICAL_STATE` |
| Toutes les conditions satisfaites | `READY` |

Un actif actif dont `calibrationRequired = true` doit posséder une échéance de calibration. L’API d’administration refuse une configuration qui briserait cet invariant; un actif incomplet reste indisponible plutôt que d’être évalué comme prêt.

### 4.5 Pseudocode

```text
function evaluateReadiness(assetId, userId, context, now):
    user  = loadActiveUser(userId)
    asset = loadActiveAsset(assetId)

    require user.status == ACTIVE

    reasons = []
    physicalUnknown = false

    availabilityCompatible = isAvailabilityCompatible(asset, context, user)

    if not availabilityCompatible:
        reasons += NOT_AVAILABLE

    if asset.operationalStatus == MAINTENANCE:
        reasons += MAINTENANCE

    if asset.operationalStatus == DAMAGED:
        reasons += DAMAGED

    if asset.calibrationRequired and now >= asset.calibrationDueAt:
        reasons += CALIBRATION_EXPIRED

    if user.maximumAccessLevel < asset.requiredAccessLevel:
        reasons += ACCESS_DENIED

    physical = evaluateCurrentPresence(asset, now)

    if physical == ABSENT:
        reasons += NOT_PRESENT

    if physical == UNKNOWN:
        physicalUnknown = true

    if reasons is not empty:
        return BLOCKED with distinct(reasons)

    if physicalUnknown:
        return UNKNOWN with UNKNOWN_PHYSICAL_STATE

    return READY with no reason
```

### 4.6 Flux de consultation

```mermaid
sequenceDiagram
    actor T as Technicien
    participant M as Aegis Mobile
    participant A as API Spring
    participant D as PostgreSQL

    T->>M: Consulter un actif
    M->>A: Demander les détails
    A->>D: Lire les données métier et physiques
    A->>A: Calculer disponibilité et readiness
    alt Blocage certain
        A-->>M: BLOCKED et raisons
    else Preuve insuffisante
        A-->>M: UNKNOWN et raison
    else Toutes les règles satisfaites
        A-->>M: READY
    end
```

---

## 5. Création d’une réservation

### 5.1 Préconditions

Une réservation P0 est immédiate. `reservedFrom` correspond à l’instant d’acceptation et le technicien choisit `reservedUntil`.

La demande est admissible seulement si :

- l’utilisateur est actif et possède le rôle `TECHNICIAN`;
- le locker possède un horaire actif;
- l’instant courant appartient à une plage ouverte;
- `reservedUntil` est postérieur à l’instant courant;
- `reservedUntil` ne dépasse pas la fermeture de cette même plage;
- le technicien ne possède aucune autre réservation `ACTIVE`;
- l’actif ne possède aucune réservation `ACTIVE`;
- l’actif ne possède aucun prêt non terminé;
- la readiness vaut `READY` dans le contexte d’une nouvelle réservation.

### 5.2 Pseudocode transactionnel

```text
function createReservation(userId, assetId, requestedUntil, requestKey):
    now = clock.now()

    if requestKey already completed:
        return existing result

    begin transaction
        lock user then asset

        require active TECHNICIAN
        window = requireOpenOperatingWindow(asset.lockerId, now)
        require now < requestedUntil <= window.closesAt

        require no ACTIVE reservation for user
        require no ACTIVE reservation for asset
        require no non-completed loan for asset

        readiness = evaluateReadiness(asset, user, RESERVATION, now)
        require readiness.result == READY

        create Reservation(
            status = ACTIVE,
            reservedFrom = now,
            reservedUntil = requestedUntil
        )

        append AuditEvent(RESERVATION_CREATED)
        save requestKey result
    commit

    return ACCEPTED with reservation
```

### 5.3 Concurrence

La vérification préalable améliore le message retourné, mais elle ne garantit pas l’unicité. L’insertion doit être protégée par des contraintes PostgreSQL empêchant :

- deux réservations `ACTIVE` pour le même actif;
- deux réservations `ACTIVE` pour le même technicien.

Si deux demandes valides arrivent simultanément, une seule est acceptée. L’autre retourne `CONFLICT` après rollback, sans réservation partielle.

### 5.4 Flux de décision

```mermaid
sequenceDiagram
    actor T as Technicien
    participant M as Aegis Mobile
    participant A as API Spring
    participant D as PostgreSQL

    T->>M: Choisir l’actif et reservedUntil
    M->>A: Créer une réservation
    A->>D: Verrouiller utilisateur et actif
    A->>A: Vérifier horaire et readiness
    alt Demande valide
        A->>D: Créer Reservation ACTIVE et audit
        A-->>M: Réservation confirmée
    else Conflit concurrent
        A-->>M: Actif ou technicien déjà réservé
    else Règle non satisfaite
        A-->>M: Refus avec raison explicite
    end
```

### 5.5 Annulation

Une réservation peut être annulée uniquement par son titulaire tant qu’aucune opération `CHECKOUT` non terminale ou physiquement incertaine ne lui est liée.

```text
function cancelReservation(userId, reservationId):
    begin transaction
        lock user, asset, reservation
        require reservation.userId == userId

        if reservation.status == CANCELLED:
            return ALREADY_APPLIED

        require reservation.status == ACTIVE
        require no non-terminal or anomalous CHECKOUT

        reservation.status = CANCELLED
        reservation.cancelledAt = now
        append AuditEvent(RESERVATION_CANCELLED)
    commit
```

---

## 6. Autorisation d’une opération physique

### 6.1 Garde commune au locker

Avant toute commande d’ouverture, le backend vérifie :

- l’identité et le rôle de l’initiateur;
- la plage d’exploitation courante;
- l’état `ONLINE` du hub;
- l’état `CONNECTED` de la cellule;
- l’état `HEALTHY` du lecteur RFID local;
- une porte connue `CLOSED`;
- une serrure dans un état connu compatible;
- une affectation active de l’actif à la cellule;
- un identifiant physique actif pour l’actif;
- l’absence d’une anomalie bloquante non résolue;
- l’absence d’une autre opération physique non terminale sur le locker.

Le P0 sérialise les ouvertures au niveau du locker : un seul compartiment peut avoir une opération physique non terminale à la fois. Cette règle est volontairement plus stricte qu’un verrou par cellule et protège la démonstration contre deux séquences physiques concurrentes.

### 6.2 Garde propre au retrait

Une opération `CHECKOUT` exige aussi :

- une réservation `ACTIVE` appartenant au demandeur;
- le même actif que celui de la réservation;
- un instant antérieur à `reservedUntil`;
- aucun prêt non terminé pour l’actif;
- une readiness réévaluée comme `READY`, en considérant la réservation du titulaire comme compatible.

### 6.3 Garde propre au retour

Une opération `RETURN` exige aussi :

- un prêt `ACTIVE` appartenant au demandeur;
- aucun autre retour non terminal pour ce prêt;
- la même affectation physique attendue que celle utilisée pour l’actif;
- l’absence d’une opération précédente non terminale.

Si le prêt est déjà `RETURN_PENDING`, une nouvelle tentative est permise uniquement lorsque l’opération précédente est terminale et que la procédure de récupération autorise cette nouvelle tentative.

### 6.4 Création et autorisation

```text
function authorizeOperation(type, userId, sourceId, requestKey):
    now = clock.now()

    if requestKey already completed:
        return existing operation

    begin transaction
        load and lock all aggregates in the canonical order
        create LockerOperation(status = REQUESTED)

        verify common locker guards

        if type == CHECKOUT:
            verify checkout guards

        if type == RETURN:
            verify return guards
            change Loan from ACTIVE to RETURN_PENDING

        operation.status = AUTHORIZED
        operation.authorizedAt = now
        operation.expiresAt = now + 120 seconds

        create durable command intent with stable messageId
        append AuditEvent(OPERATION_AUTHORIZED)
        save requestKey result
    commit

    return IN_PROGRESS with operationId and expiresAt
```

Une garde refusée termine l’opération en `FAILED` et produit un audit lisible. Aucune intention de commande n’est alors créée.

---

## 7. Émission fiable de la commande MQTT

### 7.1 Risque traité

PostgreSQL et le broker MQTT ne partagent pas une transaction atomique. Aegis doit donc éviter deux états dangereux :

- une opération autorisée sans commande jamais publiée;
- une commande exécutée alors que le backend a perdu sa trace.

### 7.2 Règle de fiabilité

L’autorisation enregistre dans la transaction PostgreSQL une intention de commande durable contenant au minimum :

- un `messageId` stable;
- l’`operationId`;
- le locker et le compartiment cibles;
- le type `UNLOCK_COMPARTMENT`;
- `issuedAt`, `expiresAt` et `schemaVersion`;
- son état de publication.

Un worker publie ensuite cette intention. Le mécanisme recommandé est un **outbox transactionnel**. Une implémentation équivalente est acceptable seulement si elle garantit les mêmes propriétés.

### 7.3 Pseudocode du dispatcher

```text
function dispatchPendingCommand(commandId):
    command = claim pending command
    operation = load operation

    if operation is terminal or now >= operation.expiresAt:
        mark command CANCELLED
        expire operation safely if applicable
        return

    publish command using its existing messageId

    begin transaction
        lock operation and command
        if operation.status == AUTHORIZED:
            operation.status = COMMAND_SENT
            operation.commandSentAt = now
            append AuditEvent(COMMAND_SENT)
        mark command DISPATCHED
    commit
```

Si le worker s’arrête après la publication mais avant le commit, il peut republier exactement la même commande. Le hub doit reconnaître le `messageId` ou l’`operationId` déjà consommé et ne jamais déverrouiller deux fois pour la même commande.

Une commande d’ouverture est toujours publiée avec `retain = false`. Le hub refuse toute commande expirée, destinée à un autre locker ou déjà consommée.

### 7.4 Séquence de publication

```mermaid
sequenceDiagram
    participant A as API Spring
    participant D as PostgreSQL
    participant W as Dispatcher
    participant B as Broker MQTT
    participant H as Hub ESP32

    A->>D: Autoriser et enregistrer l’intention
    D-->>A: Transaction confirmée
    W->>D: Réclamer la commande en attente
    W->>B: Publier avec messageId stable
    B->>H: Livrer la commande
    H->>H: Vérifier cible, expiration et doublon
    H-->>B: Accusé corrélé
    B-->>A: COMMAND_ACKNOWLEDGED
    A->>D: Enregistrer accusé et transition
```

---

## 8. Exécution dans le hub et la cellule

### 8.1 Validation technique par le hub

Le hub accepte une commande seulement si :

- son identité correspond au `lockerId` ciblé;
- le contrat et `schemaVersion` sont supportés;
- `messageId`, `operationId` et `compartmentId` sont présents;
- l’instant d’expiration n’est pas dépassé;
- la commande n’a jamais été consommée;
- la cellule existe et répond sur le bus RS-485;
- aucune autre ouverture locale n’est en cours;
- les conditions électriques et matérielles permettent une exécution sûre.

Cette validation est technique. Le hub ne réévalue jamais l’utilisateur, la réservation, le prêt ou la readiness.

### 8.2 Exécution locale

```text
function handleUnlockCommand(command):
    validate envelope and local safety

    if duplicate command:
        republish previous acknowledgement
        do not unlock again
        return

    if invalid or unsafe:
        publish COMMAND_REJECTED with reason
        return

    send addressed unlock request to target cell over RS-485

    if cell accepts:
        persist command as consumed locally
        publish COMMAND_ACKNOWLEDGED
        enforce maximum unlock duration
        relay door, lock and RFID observations
    else:
        publish COMMAND_REJECTED with reason
```

### 8.3 Ciblage d’une cellule

```mermaid
sequenceDiagram
    participant B as Broker MQTT
    participant H as Hub ESP32
    participant C as Cellule ciblée
    participant O as Autre cellule

    B->>H: UNLOCK_COMPARTMENT pour A1
    H->>H: Valider et dédupliquer
    H->>C: Requête adressée via RS-485
    C-->>H: Serrure actionnée
    H-->>B: COMMAND_ACKNOWLEDGED
    C-->>H: Porte et RFID locaux
    Note over O: Aucune commande reçue
```

---

## 9. Réception idempotente des messages MQTT

### 9.1 Validation de l’enveloppe

Avant toute transition, le backend vérifie :

- que le device est reconnu et actif;
- que le topic autorisé correspond au device et au locker;
- que le payload et sa version sont supportés;
- que `messageId` est présent;
- que `operationId` est présent lorsque le type l’exige;
- que le locker, le compartiment et l’opération sont cohérents;
- que les horodatages respectent la tolérance définie par le contrat;
- que le type d’événement est permis sur ce topic.

Un message rejeté ne produit aucune transition métier. Lorsque son enveloppe est suffisamment lisible, il est conservé avec un statut de traitement `REJECTED` afin de faciliter le diagnostic.

### 9.2 Déduplication

La paire `(lockerDeviceId, messageId)` est réservée avant tout effet. Une contrainte unique PostgreSQL garantit qu’un seul traitement gagne en présence de consommateurs concurrents.

```text
function ingestDeviceMessage(deviceIdentity, topic, rawPayload):
    receivedAt = clock.now()
    envelope = minimallyParse(rawPayload)

    begin transaction
        validate device, topic and envelope

        inserted = insert InboundDeviceMessage
                   using unique(deviceId, messageId)

        if not inserted:
            return ALREADY_APPLIED without business transition

        observations = normalize(envelope)
        persist observations

        if envelope carries heartbeat:
            update lastSeenAt

        if envelope references operation:
            lock operation and affected aggregates
            evaluate all accumulated evidence
            apply at most one valid state advancement

        mark message PROCESSED
    commit
```

### 9.3 Événements retardés ou désordonnés

L’algorithme ne conclut pas uniquement selon l’ordre d’arrivée réseau. Il conserve les faits puis vérifie leur cohérence temporelle et causale :

- même `operationId`;
- même locker et même cellule;
- événements produits après l’autorisation;
- accusé de commande valide;
- ouverture puis fermeture de la bonne porte;
- preuve RFID stable dans la fenêtre attendue;
- aucun événement contradictoire.

Un événement arrivé tardivement peut compléter un ensemble de preuves encore valide. Il ne peut jamais modifier une opération déjà terminale.

### 9.4 Séquence idempotente

```mermaid
sequenceDiagram
    participant H as Hub ESP32
    participant B as Broker MQTT
    participant A as API Spring
    participant D as PostgreSQL

    H->>B: Événement avec messageId
    B->>A: Livrer le message
    A->>D: Insérer deviceId et messageId
    alt Première réception
        D-->>A: Clé réservée
        A->>D: Conserver message et observations
        A->>D: Appliquer au plus une transition
    else Doublon
        D-->>A: Conflit d’unicité
        A->>A: Retourner le résultat existant
    else Message invalide
        A->>D: Conserver le rejet si possible
    end
```

---

## 10. Évaluation de la preuve physique

### 10.1 Conditions communes

Une preuve de retrait ou de retour est admissible seulement si :

1. la commande a été reconnue par le hub;
2. la bonne porte a été observée ouverte;
3. la même porte a ensuite été observée fermée;
4. le lecteur RFID de la cellule est déclaré sain;
5. les observations concernent l’identifiant actif attendu;
6. la localisation n’est pas contredite par une autre cellule;
7. la fenêtre de stabilisation est complète;
8. tous les faits sont liés à la même opération non terminale.

### 10.2 Fenêtre RFID initiale

La valeur initiale du POC est une fenêtre de trois secondes après la fermeture de la porte.

| Type d’opération | Preuve stable exigée |
|---|---|
| `CHECKOUT` | Le tag attendu est absent pendant toute la fenêtre, le lecteur est sain et aucune autre cellule ne le localise de façon ambiguë |
| `RETURN` | Le tag attendu est lu au moins trois fois de façon cohérente dans la cellule ciblée pendant la fenêtre |

Le POC peut ajuster la puissance, le nombre de lectures et la durée. Il ne peut pas retirer les exigences de porte refermée, de lecteur sain et de localisation cohérente.

### 10.3 Pseudocode

```text
function evaluatePhysicalProof(operation, observations):
    require operation.status is non-terminal

    if no valid acknowledgement:
        return INCOMPLETE

    if no target-cell DOOR_OPENED after acknowledgement:
        return INCOMPLETE

    if no target-cell DOOR_CLOSED after opening:
        return INCOMPLETE

    if reader unhealthy or observations ambiguous:
        return INCONSISTENT

    window = observations during stabilization after door close

    if operation.type == CHECKOUT:
        if expected tag absent for the complete window:
            return COHERENT_CHECKOUT
        if wrong or conflicting identity observed:
            return INCONSISTENT
        return INCOMPLETE

    if operation.type == RETURN:
        if expected tag has at least 3 consistent target-cell reads:
            return COHERENT_RETURN
        if wrong or conflicting identity observed:
            return INCONSISTENT
        return INCOMPLETE
```

Une preuve `INCOMPLETE` avant `expiresAt` maintient l’opération en cours. Une preuve `INCONSISTENT` après une interaction physique produit une anomalie. À l’expiration, l’algorithme de la section 14 décide entre `EXPIRED` et `ANOMALY`.

---

## 11. Confirmation d’un retrait

### 11.1 Effets atomiques

Une preuve `COHERENT_CHECKOUT` provoque dans une seule transaction :

1. le verrouillage de l’opération, de la réservation et de l’actif;
2. une nouvelle vérification de l’état courant et de l’idempotence;
3. le passage de `LockerOperation` à `CONFIRMED`;
4. le passage de `Reservation` à `FULFILLED`;
5. la création d’un `Loan` à `ACTIVE`;
6. la copie de `Reservation.reservedUntil` dans `Loan.dueAt`;
7. l’enregistrement des références aux preuves physiques;
8. l’ajout des événements d’audit.

Tout échec annule l’ensemble.

### 11.2 Pseudocode

```text
function confirmCheckout(operationId):
    now = clock.now()

    begin transaction
        lock user, asset, reservation, locker, compartment, operation

        if operation.status == CONFIRMED:
            return ALREADY_APPLIED with existing loan

        require operation.type == CHECKOUT
        require operation is non-terminal
        require reservation.status == ACTIVE
        require no non-completed loan for asset

        proof = evaluatePhysicalProof(operation, stored observations)
        require proof == COHERENT_CHECKOUT

        operation.status = CONFIRMED
        operation.confirmedAt = now

        reservation.status = FULFILLED
        reservation.fulfilledAt = now

        loan = create Loan(
            status = ACTIVE,
            checkedOutAt = now,
            dueAt = reservation.reservedUntil,
            checkoutOperationId = operation.id
        )

        append audit events and proof references
    commit

    return ACCEPTED with loan
```

### 11.3 Flux nominal

```mermaid
sequenceDiagram
    participant M as Aegis Mobile
    participant A as API Spring
    participant D as PostgreSQL
    participant B as Broker MQTT
    participant H as Locker

    M->>A: Demander le retrait
    A->>D: Autoriser CHECKOUT pour 120 s
    A->>B: Commander la cellule attendue
    B->>H: UNLOCK_COMPARTMENT
    H-->>B: Accusé, porte et RFID
    B-->>A: Événements corrélés
    A->>D: Conserver et vérifier les preuves
    alt Preuve complète et cohérente
        A->>D: CONFIRMED, FULFILLED et Loan ACTIVE
        A-->>M: Retrait confirmé
    else Preuve encore incomplète
        A-->>M: Opération en cours
    else Preuve incohérente
        A->>D: ANOMALY et Anomaly OPEN
        A-->>M: Intervention requise
    end
```

### 11.4 Interdictions

- La disparition d’un tag sans porte ouverte ne crée pas de prêt.
- Une commande reconnue sans preuve RFID ne crée pas de prêt.
- Une réservation expirée avant l’autorisation ne peut pas être accomplie.
- Une opération terminale ne peut pas créer un second prêt.
- Une incertitude de retrait ne fabrique jamais une chaîne de possession par supposition.

---

## 12. Confirmation d’un retour

### 12.1 Effets atomiques

Une preuve `COHERENT_RETURN` provoque dans une seule transaction :

1. le verrouillage de l’opération, du prêt et de l’actif;
2. le passage de `LockerOperation` à `CONFIRMED`;
3. le passage de `Loan` à `COMPLETED`;
4. l’enregistrement de `returnedAt` et `returnOperationId`;
5. la résolution des anomalies que cette preuve corrige réellement;
6. l’ajout des événements d’audit;
7. le recalcul de la disponibilité et de la readiness.

### 12.2 Pseudocode

```text
function confirmReturn(operationId):
    now = clock.now()

    begin transaction
        lock user, asset, loan, locker, compartment, operation

        if operation.status == CONFIRMED:
            return ALREADY_APPLIED with completed loan

        require operation.type == RETURN
        require operation is non-terminal
        require loan.status == RETURN_PENDING

        proof = evaluatePhysicalProof(operation, stored observations)
        require proof == COHERENT_RETURN

        operation.status = CONFIRMED
        operation.confirmedAt = now

        loan.status = COMPLETED
        loan.returnedAt = now
        loan.returnOperationId = operation.id

        resolve only anomalies proven corrected by this evidence
        append audit events and proof references
    commit

    return ACCEPTED with completed loan
```

### 12.3 Flux nominal et refus

```mermaid
sequenceDiagram
    participant M as Aegis Mobile
    participant A as API Spring
    participant D as PostgreSQL
    participant B as Broker MQTT
    participant H as Locker

    M->>A: Demander le retour
    A->>D: Loan RETURN_PENDING et opération RETURN
    A->>B: Commander la cellule attendue
    B->>H: UNLOCK_COMPARTMENT
    H-->>B: Accusé, porte et RFID
    B-->>A: Événements corrélés
    alt Tag attendu stable et porte fermée
        A->>D: Operation CONFIRMED et Loan COMPLETED
        A-->>M: Retour confirmé
    else Mauvais tag ou localisation ambiguë
        A->>D: Operation ANOMALY et Anomaly OPEN
        A-->>M: Prêt maintenu RETURN_PENDING
    else Preuve encore incomplète
        A-->>M: Opération en cours
    end
```

### 12.4 Règle fondamentale

La simple présence de l’actif dans sa cellule ne termine jamais un prêt. Il faut une opération `RETURN` corrélée comprenant l’autorisation, l’ouverture, la présence stable de l’actif attendu et la fermeture de la porte.

Un actif observé présent alors que son prêt est encore ouvert demeure `BORROWED` et produit l’anomalie `ASSET_PRESENT_WITH_ACTIVE_LOAN`.

---

## 13. Échec d’un retour

### 13.1 Distinction obligatoire

Le résultat dépend de la certitude physique, pas uniquement du type d’erreur.

| Situation | LockerOperation | Loan | Anomaly |
|---|---|---|---|
| Refus avant publication | `FAILED` | Retour à `ACTIVE` | Aucune |
| Publication impossible et aucune exécution possible | `FAILED` ou `EXPIRED` | Retour à `ACTIVE` | Aucune |
| Rejet explicite du hub sans déverrouillage | `FAILED` | Retour à `ACTIVE` | Audit du rejet |
| Porte certainement restée fermée jusqu’à l’expiration | `EXPIRED` | Retour à `ACTIVE` | Aucune |
| Porte ouverte au moins une fois | `ANOMALY` | Reste `RETURN_PENDING` | `OPEN` |
| Hub perdu après l’envoi | `ANOMALY` | Reste `RETURN_PENDING` | `OPEN` |
| État physique contradictoire ou inconnu | `ANOMALY` | Reste `RETURN_PENDING` | `OPEN` |

### 13.2 Algorithme

```text
function concludeFailedReturn(operation, evidence, now):
    begin transaction
        lock loan and operation

        if operation is terminal:
            return existing result

        if evidence proves no unlock and no door opening:
            operation.status = FAILED or EXPIRED
            loan.status = ACTIVE
            append safe-failure audit
        else:
            operation.status = ANOMALY
            loan.status = RETURN_PENDING
            create Anomaly(status = OPEN, evidence = evidence)
            append uncertainty audit
    commit
```

### 13.3 Séquence de décision

```mermaid
sequenceDiagram
    participant M as Aegis Mobile
    participant A as API Spring
    participant D as PostgreSQL
    participant O as Observations

    A->>O: Évaluer les faits disponibles
    alt Aucune ouverture possible ou observée
        A->>D: Operation FAILED ou EXPIRED
        A->>D: Loan ACTIVE
        A-->>M: Nouvelle tentative permise
    else Ouverture ou incertitude physique
        A->>D: Operation ANOMALY
        A->>D: Loan RETURN_PENDING et Anomaly OPEN
        A-->>M: Correction physique requise
    end
```

---

## 14. Algorithmes temporels

Les règles temporelles sont exécutées par une tâche planifiée et réévaluées au début de chaque action sensible. Cette double vérification évite de dépendre uniquement du scheduler.

### 14.1 Expiration d’une réservation

```text
function expireReservation(reservationId, now):
    begin transaction
        lock asset and reservation

        if reservation.status != ACTIVE:
            return without effect

        if now < reservation.reservedUntil:
            return without effect

        operation = latest CHECKOUT for reservation

        if operation is non-terminal or physically uncertain:
            defer expiration
            return

        reservation.status = EXPIRED
        reservation.expiredAt = now
        append AuditEvent(RESERVATION_EXPIRED)
    commit
```

L’expiration libère uniquement une réservation non utilisée. Si le retrait a été confirmé, la réservation est déjà `FULFILLED`; le prêt continue jusqu’au retour physique confirmé.

### 14.2 Expiration d’une LockerOperation

```text
function expireOperation(operationId, now):
    begin transaction
        lock affected aggregates and operation

        if operation is terminal or now < operation.expiresAt:
            return without effect

        evidence = classifyExecutionEvidence(operation)

        if command never sent:
            conclude EXPIRED
        else if hub explicitly rejected without unlock:
            conclude FAILED
        else if device stayed online and door certainly stayed closed:
            conclude EXPIRED
        else:
            conclude ANOMALY and create Anomaly OPEN

        apply checkout or return consequences atomically
        append AuditEvent
    commit
```

### 14.3 Prêt en retard

```text
overdue = loan.status != COMPLETED and now > loan.dueAt
```

Le retard ne déclenche aucune transition. Le prêt reste `ACTIVE` ou `RETURN_PENDING`, et l’actif reste `BORROWED`.

### 14.4 État en ligne du locker

```text
if no valid heartbeat has ever been received:
    deviceStatus = UNKNOWN
else if now - lastSeenAt > 30 seconds:
    deviceStatus = OFFLINE
else:
    deviceStatus = ONLINE
```

Le hub publie un heartbeat toutes les 10 secondes. Un locker `OFFLINE` refuse toute nouvelle opération. Si la déconnexion survient après l’envoi d’une commande et que l’exécution est incertaine, l’opération passe à `ANOMALY`.

### 14.5 Évaluation coordonnée

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant A as API Spring
    participant D as PostgreSQL

    S->>A: Évaluer les échéances
    A->>D: Réclamer les objets échus
    alt Réservation sans retrait
        A->>D: Reservation EXPIRED
    else Opération physiquement sûre
        A->>D: Operation FAILED ou EXPIRED
    else Opération physiquement incertaine
        A->>D: Operation ANOMALY et Anomaly OPEN
    end
    A->>D: Ajouter les AuditEvent
```

---

## 15. Récupération d’une anomalie

### 15.1 Reconnaissance administrative

Un administrateur peut :

- consulter les preuves et la chronologie;
- passer l’anomalie de `OPEN` à `ACKNOWLEDGED`;
- documenter son intervention;
- corriger la réalité physique.

Il ne peut jamais sélectionner `RESOLVED`.

### 15.2 Résolution par preuve

Le backend résout une anomalie uniquement lorsqu’une nouvelle preuve physique cohérente démontre la correction.

| Contexte | Preuve requise | Conséquence métier |
|---|---|---|
| CHECKOUT incertain | Actif attendu de nouveau présent, porte fermée et localisation stable | Anomalie résolue; aucun prêt créé; réservation réévaluée |
| RETURN incertain sans dépôt | Actif attendu absent, porte fermée et état cohérent | Anomalie résolue; Loan revient à `ACTIVE` |
| RETURN incertain avec dépôt | Nouvelle opération RETURN complète et cohérente | Anomalie résolue; Loan passe à `COMPLETED` |
| Réalité toujours ambiguë | Preuve insuffisante ou contradictoire | Anomalie maintenue `OPEN` ou `ACKNOWLEDGED` |

Une détection spontanée de présence pendant un prêt ne remplace pas une nouvelle opération `RETURN`.

### 15.3 Pseudocode

```text
function evaluateAnomalyResolution(anomalyId, newEvidence):
    begin transaction
        lock anomaly and affected aggregates

        if anomaly.status == RESOLVED:
            return ALREADY_APPLIED

        resolution = classifyResolution(anomaly, newEvidence)

        if resolution == NOT_PROVEN:
            keep current status
            append diagnostic audit if relevant
            return ANOMALY_REQUIRES_ACTION

        apply the permitted Loan or Reservation consequence
        anomaly.status = RESOLVED
        anomaly.resolvedAt = now
        anomaly.resolutionEvidenceObservationId = newEvidence.id
        append AuditEvent(ANOMALY_RESOLVED_BY_EVIDENCE)
    commit
```

### 15.4 Séquence de récupération

```mermaid
sequenceDiagram
    actor AD as Administrateur
    participant A as API Spring
    participant D as PostgreSQL
    participant B as Broker MQTT
    participant H as Locker

    AD->>A: Reconnaître via Aegis Manager
    A->>D: Enregistrer sans résoudre
    AD->>H: Corriger la réalité physique
    H-->>B: Publier une nouvelle preuve
    B-->>A: Livrer la preuve
    A->>A: Vérifier la cohérence
    alt Correction prouvée
        A->>D: Résoudre et appliquer les effets permis
        A-->>AD: Anomalie RESOLVED
    else Preuve insuffisante
        A-->>AD: Anomalie maintenue
    end
```

---

## 16. Audit fonctionnel

### 16.1 Événements obligatoires

Les décisions suivantes produisent un `AuditEvent` :

- authentification acceptée ou refus sensible;
- calcul de readiness utilisé pour une décision;
- réservation créée, annulée, accomplie ou expirée;
- opération demandée, autorisée, refusée ou expirée;
- commande publiée, reconnue ou rejetée;
- ouverture et fermeture déterminantes;
- retrait ou retour confirmé;
- anomalie créée, reconnue ou résolue;
- doublon MQTT ignoré lorsqu’il est utile au diagnostic;
- changement `ONLINE` vers `OFFLINE` ou retour en ligne.

### 16.2 Contenu minimal

Chaque événement déterminant conserve :

- le type d’événement;
- l’acteur humain ou système;
- la cible et son identifiant;
- l’ancien et le nouvel état lorsque pertinent;
- `operationId` lorsqu’il existe;
- l’instant backend;
- le résultat et la raison;
- les identifiants des preuves utilisées.

Le payload MQTT brut reste dans `InboundDeviceMessage`. L’audit explique la décision métier sans recopier inutilement la preuve technique.

---

## 17. Invariants transactionnels

| Invariant | Protection algorithmique | Protection de données attendue |
|---|---|---|
| Une réservation active par actif | Vérification sous verrou | Contrainte unique conditionnelle |
| Une réservation active par technicien | Vérification sous verrou | Contrainte unique conditionnelle |
| Un prêt non terminé par actif | Vérification sous verrou | Contrainte unique conditionnelle |
| Une opération physique active par locker | Autorisation sérialisée | Verrou ou contrainte équivalente |
| Un message device traité une fois | Réservation de clé avant effet | Unique sur deviceId + messageId |
| Un retrait crée au plus un prêt | État attendu et idempotence | Unicité de checkoutOperationId |
| Un prêt est terminé une seule fois | État attendu et verrou du prêt | Unicité de returnOperationId |
| Une commande garde une identité stable | Réutilisation du même messageId | Persistance durable de l’intention |
| Une anomalie n’est pas fermée manuellement | Aucun cas d’usage de résolution manuelle | Preuve de résolution obligatoire |

Une vérification applicative seule n’est pas suffisante pour les invariants concurrents. Une contrainte SQL seule n’est pas suffisante pour produire un message métier compréhensible. Les deux niveaux sont complémentaires.

---

## 18. Résultats visibles par scénario

| Scénario | Résultat attendu côté utilisateur | État métier final |
|---|---|---|
| Actif conforme et autorisé | Réservation confirmée | Reservation `ACTIVE` |
| Calibration expirée | Raison visible | Aucune réservation |
| Niveau insuffisant | Accès refusé | Aucune réservation ou opération autorisée |
| Deux réservations concurrentes | Une réussite, un conflit | Une seule Reservation `ACTIVE` |
| Retrait complet | Confirmation et prêt actif | Reservation `FULFILLED`, Loan `ACTIVE` |
| Retour complet | Confirmation de restitution | Loan `COMPLETED` |
| Réservation non utilisée | Expiration visible | Reservation `EXPIRED` |
| Prêt après `dueAt` | Retard visible | Loan inchangé, `overdue = true` |
| Commande dupliquée | Aucun second déverrouillage | Opération inchangée |
| Événement dupliqué | Aucun second effet métier | Message reconnu comme doublon |
| Porte ouverte sans preuve cohérente | Intervention requise | Operation `ANOMALY` |
| Retour échoué avant ouverture | Nouvelle tentative permise | Loan `ACTIVE` |
| Retour incertain après ouverture | Intervention requise | Loan `RETURN_PENDING`, Anomaly `OPEN` |
| Correction administrative sans preuve | Anomalie non résolue | `OPEN` ou `ACKNOWLEDGED` |

---

## 19. Cas algorithmiques minimaux à tester

### 19.1 Readiness et réservation

- chaque raison de readiness séparément;
- plusieurs raisons simultanées sans doublon;
- priorité d’un blocage certain sur une incertitude physique;
- réservation du titulaire compatible avec son propre retrait;
- refus avant l’ouverture de la plage;
- refus après la fermeture ou au-delà de `closesAt`;
- changement d’heure dans `America/Toronto`;
- concurrence sur le même actif;
- concurrence sur le même technicien;
- répétition avec la même clé d’idempotence.

### 19.2 Commande et device

- reprise du dispatcher après arrêt entre publication et commit;
- republication avec le même `messageId`;
- refus d’une commande expirée;
- refus d’une commande pour un autre locker;
- ciblage exclusif de la cellule attendue;
- perte de la liaison RS-485;
- absence de second déverrouillage pour une commande dupliquée.

### 19.3 Preuve physique

- retrait nominal avec absence stable;
- retour nominal avec trois lectures cohérentes;
- fermeture absente;
- lecteur RFID défaillant;
- tag attendu lu dans deux cellules;
- mauvais tag;
- événements arrivés dans un ordre réseau différent;
- événement retardé après état terminal;
- expiration avant et après ouverture.

### 19.4 Chaîne de possession et anomalie

- atomicité de la confirmation du retrait;
- rollback si la création du prêt échoue;
- atomicité de la confirmation du retour;
- prêt en retard sans disponibilité libérée;
- retour sûr vers `ACTIVE` avant toute ouverture;
- maintien `RETURN_PENDING` après incertitude;
- refus d’une résolution administrative directe;
- résolution avec preuve cohérente;
- nouvelle tentative utilisant un nouvel `operationId`.

---

## 20. Propriétés de conformité du P0

L’implémentation est conforme à ce document si elle respecte simultanément les propriétés suivantes :

1. aucune interface ou aucun device ne peut écrire directement un état métier final;
2. aucune réservation n’est créée sans readiness `READY` et horaire valide;
3. toute ouverture provient d’une LockerOperation autorisée et non expirée;
4. toute commande et tout événement sont idempotents;
5. aucune lecture RFID isolée ne confirme un retrait ou un retour;
6. tout retrait confirmé accomplit la réservation et crée exactement un prêt dans une transaction;
7. tout retour confirmé termine exactement un prêt dans une transaction;
8. l’expiration d’une réservation ou l’échéance d’un prêt ne simule jamais un retour;
9. une interaction physique incertaine produit une anomalie au lieu d’un état optimiste;
10. aucune anomalie n’est résolue sans preuve physique cohérente;
11. les décisions et leurs preuves peuvent être reconstruites dans l’audit;
12. un message rejoué ne produit aucun effet métier supplémentaire.

---

## 21. Limites du document

Ce document ne fixe pas :

- les noms définitifs des routes et codes d’erreur REST;
- les schémas JSON et les topics MQTT détaillés;
- la structure exacte de l’outbox et des tables PostgreSQL;
- la stratégie de notification temps réel du Web et d’iOS;
- les tolérances d’horloge du device;
- les seuils RFID définitifs après le POC;
- les registres et trames Modbus RTU exacts;
- les composants électriques du hub et des cellules.

Ces choix techniques peuvent évoluer sans modifier les décisions métier, les preuves minimales, les effets atomiques et les comportements d’échec définis ici.
