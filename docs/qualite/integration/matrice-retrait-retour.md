# Matrice de vérification cloud : préparation, retrait et retour

Cette matrice est la vérification QA **indépendante**, sur la pile cloud isolée : vrai
PostgreSQL, vraie API, vrai Mosquitto, et `tools/hub-simulator` à la place du hub. Elle
couvre #43/#46, puis #47 (et ensuite #50/#51), sur le SHA immuable livré par Backend.

- **Nature des preuves : simulée ou injectée, jamais réelle.** Elle ne remplace ni la
  partie C de [`../recette-staging/README.md`](../recette-staging/README.md), ni
  l'acceptation physique de Jimmy.
- **Statut.**
  - #43/#46 : P1 à P11 sont exécutées sur `dev` `c6845e6` par
    [`../hub-challenge/run.sh`](../hub-challenge/README.md), en complément de la recette Backend
    T0 à T7.
  - #44 : Q1 à Q4 sont couvertes par Q10 du même script, exécutable sur la branche Backend
    `44-feat-qr-authorization` (PR #173). Sur un commit sans la route `authorize-local`, Q10 est
    ignorée.
  - #47 : K1 à K9, K11 et K14 sont exécutées par
    [`../checkout-confirmation/run.sh`](../checkout-confirmation/README.md) sur la branche Backend
    `47-feat-checkout-confirmation` (PR #175). K10, K12 et K13 n'y sont pas démontrables (voir
    son README).
  - #50/#51 : planifiées. Aucune ligne n'est exécutée tant que la branche Backend
    correspondante n'est pas livrée.

  Chaque exécution consigne le SHA, la commande et le résultat.
- **Références normatives :**
  - doc 05 : §4.4, §5.3 à §5.7 et §11 ;
  - doc 06 : §10.2, §10.3 et §14.2 ;
  - doc 10 : §6, §12.1 et §12.2.
  Il faut y ajouter les deux règles #47 validées par Philippe le 11 novembre (section
  « #47 »), dont la précision normative revient à Backend.

Invariants vérifiés dans **chaque** ligne :

- aucun prêt hors d'un retrait `CONFIRMED` ;
- aucune commande de déverrouillage hors d'un défi consommé ;
- une opération terminale ne change plus d'état ;
- aucun secret QR ni clé dans la base, les journaux ou les réponses REST.

## #43 + #46 — Préparation et défi affiché

| ID | Scénario (simulé) | Attendu |
|---|---|---|
| P1 | Préparer un retrait valide | `AWAITING_LOCAL_PROOF`, défi `PENDING`, révision incrémentée, outbox d'affichage chiffrée ; **aucune** commande `UNLOCK_COMPARTMENT` publiée |
| P2 | Lire l'outbox en base et les journaux | Aucun secret QR en clair ; enveloppe AES-256-GCM (identifiant de clé, nonce, tag, AAD documentés) |
| P3 | Altérer le texte chiffré, le tag ou l'AAD | Déchiffrement refusé, rien n'est publié ; erreur auditée sans secret |
| P4 | Rotation : nouvelle clé active, un message encore dû sous l'ancienne | L'ancien message reste lisible ; l'ancienne clé n'est retirable qu'en l'absence de message dépendant non purgé |
| P5 | Configuration de clés absente ou invalide | Échec fermé au démarrage ou à la préparation ; aucun affichage en clair |
| P6 | Accusé d'affichage dupliqué | Un seul `displayedAt` ; aucune transition de l'opération (doc 05 §5.7) |
| P7 | Accusé d'affichage hors ordre, d'une ancienne révision, d'une autre session ou avec une mauvaise corrélation | Ignoré pour la transition, conservé comme preuve technique |
| P8 | Deux préparations concurrentes pour la même réservation | Une seule opération non terminale |
| P9 | Échéance du défi à `T−1 s`, `T`, `T+1 s` (au plus 60 s) | Valide avant `T` ; à partir de `T` : défi `EXPIRED`, opération `EXPIRED`, écran effacé, prêt inchangé |
| P10 | Nouvelle session du hub pendant `AWAITING_LOCAL_PROOF` | Défi `INVALIDATED`, opération `FAILED`, aucune commande |
| P11 | Annulation avant autorisation | Défi `INVALIDATED`, écran effacé, aucune commande |

## #44 — Scan et autorisation

| ID | Scénario | Attendu |
|---|---|---|
| Q1 | QR valide de l'initiateur | `AUTHORIZED`, `expiresAt = authorizedAt + 120 s`, exactement une commande |
| Q2 | Deux scans concurrents du même QR | Exactement une commande ; le second est refusé |
| Q3 | QR rejoué après consommation, d'un autre compte ou d'une autre opération | Refus, aucune commande |
| Q4 | Cinq secrets erronés | Défi `INVALIDATED`, opération `FAILED` |

## #47 — Retrait confirmé physiquement

Règles validées par Philippe le 11 novembre :

- **R1 — actif non retiré.** Au retrait, après un accusé, une ouverture et une fermeture
  valides, si le lecteur est sain et le tag attendu toujours présent : `INCOMPLETE` jusqu'à
  `expiresAt`, puis `ANOMALY` avec `INCONSISTENT_PHYSICAL_STATE`, sans prêt.
- **R2 — lecteur non sain.** Après un accusé, une ouverture et une fermeture valides, un scan
  d'évaluation `FAULTED` ou `UNKNOWN` donne `ANOMALY` avec `INCONSISTENT_PHYSICAL_STATE` dès ce
  constat, sans déduire présence ni absence.

Dans les deux cas, aucun prêt n'est créé au retrait, aucun prêt n'est clôturé au retour, et
la récupération suit les contrats.

| ID | Scénario (événements simulés) | Attendu |
|---|---|---|
| K1 | Nominal : accusé, `DOOR_OPENED`, `DOOR_CLOSED`, scan sain sans le tag pendant toute la fenêtre | `CONFIRMED`, réservation `FULFILLED`, **un** prêt `ACTIVE`, `dueAt = reservedUntil` |
| K2 | R1 : scan sain, tag toujours présent ; horloge à `expiresAt − 1 s` | Opération non terminale, aucun prêt, aucune anomalie |
| K3 | R1 : même état ; horloge à `expiresAt` | `ANOMALY` / `INCONSISTENT_PHYSICAL_STATE`, aucun prêt |
| K4 | R1 : même état ; horloge à `expiresAt + 1 s`, tâche planifiée rejouée deux fois | Une seule anomalie, une seule transition auditée |
| K5 | R2 : scan `FAULTED` après une séquence valide | `ANOMALY` / `INCONSISTENT_PHYSICAL_STATE` **immédiatement**, avant `expiresAt` ; aucun prêt |
| K6 | R2 : scan `UNKNOWN` après une séquence valide | Comme K5 |
| K7 | Scan `FAULTED` reçu **avant** l'accusé ou avant `DOOR_CLOSED` | Pas d'anomalie R2 ; conservé comme preuve, l'opération attend la séquence |
| K8 | Aucun message RFID après `DOOR_CLOSED` | Pas d'anomalie R2 : l'absence de message n'est pas une preuve. Non terminal avant `expiresAt` ; à `expiresAt` la classification de doc 06 §14.2 s'applique (porte ouverte ⇒ `ANOMALY`) |
| K9 | Événements dupliqués : accusé, porte et scan republiés avec le même `messageId` | Aucune transition répétée, un seul prêt (K1) ou une seule anomalie |
| K10 | Événements hors ordre : `DOOR_CLOSED` avant `DOOR_OPENED`, ou scan avant l'accusé | Aucun saut d'état (doc 05 §5.6) |
| K11 | Opération terminale (`ANOMALY`, `EXPIRED` ou `FAILED`), puis arrivée d'un scan sain sans le tag | **Aucune transition vers `CONFIRMED`**, aucun prêt ; événement conservé comme preuve |
| K12 | Opération `CONFIRMED`, puis scan `FAULTED` ou tag présent | Aucune transition, prêt inchangé |
| K13 | Événement portant un autre `operationId` ou une autre cellule | Ignoré pour la transition |
| K14 | Mauvais tag observé | `ANOMALY` / `UNEXPECTED_ASSET_OBSERVED`, aucun prêt |

## #50 / #51 — Retour (à détailler à la livraison)

| ID | Scénario | Attendu |
|---|---|---|
| T1 | Retour d'un actif non `READY` | Préparation acceptée |
| T2 | Nominal : au moins trois lectures cohérentes dans la cellule ciblée | Prêt `COMPLETED`, readiness recalculée |
| T3 | Actif non déposé, lecteur sain | `ANOMALY` / `EXPECTED_ASSET_NOT_OBSERVED`, prêt `RETURN_PENDING` |
| T4 | R2 au retour : `FAULTED` ou `UNKNOWN` après une séquence valide | `ANOMALY` / `INCONSISTENT_PHYSICAL_STATE` dès le constat, prêt non clôturé |
| T5 | Opération terminale, puis lectures cohérentes tardives | Aucune transition vers `CONFIRMED`, prêt non clôturé |
| T6 | Événements dupliqués ou hors ordre | Comme K9 et K10 |
