# Aegis — Contrats MQTT détaillés

**Cours :** 420-5X7-SO — Écosystème connecté  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Date de révision :** 21 octobre 2026  
**Version documentaire :** 1.4 — schéma des messages 2.0 : connexions, ordre des démarrages et projection de disponibilité (#63); topics et ACL inchangés

---

## 1. Rôle du document

Ce document fixe le contrat MQTT entre :

- Aegis Control, le backend Spring Boot;
- le broker MQTT;
- Aegis Locker Node, le hub ESP32.

Les cellules ne sont pas des clients MQTT. Elles communiquent exclusivement avec le hub par RS-485 et un protocole local minimal. Le hub traduit leurs états techniques en événements MQTT sans prendre de décision métier.

Le contrat couvre :

- les topics;
- les droits de publication et d’abonnement;
- les niveaux QoS et la rétention;
- les enveloppes JSON;
- les commandes, accusés, observations et heartbeats;
- la déduplication;
- la reprise après déconnexion;
- la sécurité et les tests.

Il ne définit pas les trames RS-485 entre le hub et les cellules.

---

## 2. Autorités et responsabilités

| Composant | Responsabilité | Interdiction |
|---|---|---|
| Backend Spring Boot | Autoriser une opération, produire une commande, interpréter les observations, muter le métier | Ne suppose jamais qu’une publication MQTT équivaut à une exécution |
| Broker MQTT | Authentifier, appliquer les ACL et transporter les messages | Ne décide aucune readiness et ne transforme aucun payload |
| Hub ESP32 | Valider techniquement, dédupliquer, cibler une cellule, actionner et publier les observations | Ne valide jamais l’utilisateur, la réservation ou le prêt |
| Cellule | Actionner serrure, lire porte et RFID, rapporter au hub | Aucun réseau IP, MQTT ou droit métier |

Une commande MQTT est la conséquence d’une LockerOperation déjà autorisée. Elle ne constitue jamais l’autorisation elle-même.

---

## 3. Version et protocole

### 3.1 Version MQTT

Le P0 utilise MQTT 3.1.1 afin de maximiser la compatibilité des bibliothèques ESP32. Le contrat applicatif ne dépend pas des propriétés propres à MQTT 5. Le schéma 2.0 des messages (§3.2) ne change pas cette version du protocole.

### 3.2 Version du schéma

Tous les messages contiennent :

```json
{
  "schemaVersion": "2.0"
}
```

Règles :

- une major inconnue est rejetée;
- une minor plus récente peut ajouter des champs sans modifier le sens des champs existants;
- le consommateur ignore les champs JSON inconnus d’une minor compatible;
- un champ requis ne devient jamais facultatif dans la même major;
- un changement de type, de sens ou de valeur contrôlée exige une nouvelle major.

La version courante est **2.0** (#63, 21 octobre 2026). Elle remplace 1.0, qu’aucun
producteur ni consommateur n’avait déployée, pour trois changements :

- la valeur contrôlée `SHUTDOWN` s’ajoute aux raisons de disponibilité (§15);
- `bootCount` devient requis dans l’enveloppe du hub (§8.1);
- `connectionId` devient requis dans `DEVICE_AVAILABILITY` et `HEARTBEAT` (§14, §15).

Une nouvelle valeur contrôlée exige une nouvelle major (règle ci-dessus); un nouveau
champ requis aussi, car un producteur de l’ancienne version ne le fournirait pas. Le
simulateur passe à 2.0 dans le même changement que ce document, et le firmware et
l’ingestion backend s’écrivent directement en 2.0. Un message 1.0 est rejeté avec
`UNSUPPORTED_SCHEMA`.

### 3.3 Encodage

- UTF-8;
- JSON strict;
- noms en camelCase;
- content-type logique application/json;
- taille maximale P0 : 16 KiB par message;
- profondeur JSON et taille des tableaux bornées avant désérialisation;
- instants en chaînes RFC 3339 en UTC terminées par `Z` : la seconde est obligatoire,
  une fraction de seconde de 1 à 3 chiffres est facultative. Le backend accepte les
  deux formes et compare des instants analysés, jamais des chaînes.

---

## 4. Identité et sécurité du device

### 4.1 Identité

Chaque hub possède :

- un deviceKey stable;
- un clientId MQTT unique;
- un nom d’utilisateur propre;
- un secret propre, injecté hors du dépôt;
- un lockerId associé côté backend et broker.

Format recommandé du clientId :

```text
aegis-locker-<deviceKey>
```

L’identité authentifiée est la source de confiance. Un lockerId déclaré dans le payload ne permet jamais à un device d’usurper un autre locker.

### 4.2 Transport

| Environnement | Exigence |
|---|---|
| Broker distant | TLS 1.2 ou supérieur, validation du certificat serveur |
| Docker local isolé avec simulateur | Non chiffré seulement sur réseau privé sans hub réel ni exposition; tokens de test exclusivement |
| Hub réel, même au laboratoire | TLS validé obligatoire, car le QR transporte un secret éphémère |
| PostgreSQL | Aucun accès depuis le broker ou le hub |

Le P0 utilise un nom d’utilisateur et un secret uniques par device au-dessus de TLS. Le mTLS peut être ajouté ultérieurement sans changer les topics ni les payloads.

Le broker P0 retenu est Mosquitto, hébergé localement avec les services de
démonstration. Le compte backend est distinct de celui du hub. Un `clientId`
stable permet la gestion de session; il ne remplace jamais l’authentification
par le secret et les ACL. Voir ADR-004, accepté le 23 septembre.

### 4.3 Secrets

- jamais committés;
- identifiants MQTT et mots de passe jamais inclus dans un payload;
- le token QR est une donnée métier éphémère distincte, autorisée uniquement dans le message d’écran chiffré en transit décrit au §27;
- jamais journalisés;
- stockés par configuration externe côté backend et broker;
- provisionnés dans le stockage non volatil du hub;
- remplaçables sans changer lockerId.

---

## 5. Topics

Pour un locker donné :

```text
aegis/v1/lockers/{lockerId}/commands
aegis/v1/lockers/{lockerId}/events
aegis/v1/lockers/{lockerId}/status
aegis/v1/lockers/{lockerId}/display
```

| Topic | Producteur | Consommateur | Contenu |
|---|---|---|---|
| commands | Backend | Hub ciblé | UNLOCK_COMPARTMENT |
| events | Hub | Backend | ACK, rejet, porte, serrure, RFID, erreur, redémarrage (`DEVICE_RESTARTED`) |
| status | Hub ou broker via LWT | Backend | Heartbeat et disponibilité de connexion |
| display | Backend | Hub ciblé | QR temporaire et résultat backend |

Règles :

1. lockerId est un UUID canonique en minuscules dans le topic.
2. Aucun wildcard ne se trouve dans un topic publié.
3. Le backend compare le lockerId du topic, du payload et de l’identité device.
4. Un événement opérationnel publié sur status est rejeté.
5. Un heartbeat publié sur events est rejeté.
6. Les cellules ne possèdent aucun sous-topic MQTT propre.

### 5.1 Version des topics

Le segment `v1` versionne l’arborescence des topics et les ACL qui en dépendent, pas le
schéma des payloads. Il ne se déduit jamais de `schemaVersion` : le schéma 2.0 garde les
topics `aegis/v1/...` et ne modifie aucune ACL (§6). Seul un changement de
l’arborescence (niveau ajouté, topic renommé ou déplacé) créerait `aegis/v2/...`; il
exigerait de nouvelles ACL pour le hub et le backend, testées avant la démonstration,
et un basculement coordonné des deux côtés. Un consommateur choisit son décodeur
d’après `schemaVersion`, jamais d’après le topic.

---

## 6. ACL

### 6.1 Hub

Pour son propre locker, un hub peut :

- s’abonner à commands et display pour son seul locker;
- publier sur events;
- publier sur status.

Il ne peut pas :

- publier sur commands ou display;
- s’abonner aux events ou status d’un autre locker;
- utiliser un wildcard;
- accéder à un topic d’administration du broker.

### 6.2 Backend

Le backend peut :

- publier sur les topics commands et display autorisés par l’ACL `aegis/v1/lockers/+/...` (le topic réellement publié contient un lockerId, jamais `+`);
- s’abonner à aegis/v1/lockers/+/events;
- s’abonner à aegis/v1/lockers/+/status.

Le compte backend est distinct de tous les comptes device.

### 6.3 Principe de refus

Tout droit non explicitement accordé est refusé. Les ACL sont testées avec un compte device réel avant la démonstration.

---

## 7. QoS, retain et sessions

| Message | QoS | Retain | Justification |
|---|---:|---:|---|
| Commande | 1 | false | Livraison au moins une fois; déduplication obligatoire |
| Instruction d’écran | 1 | false | Expiration, session et révision vérifiées même après redélivrance |
| Accusé/rejet d’affichage | 1 | false | Ne constitue pas un ACK de serrure |
| Accusé ou rejet | 1 | false | La décision technique doit atteindre le backend |
| Porte, serrure, RFID, erreur | 1 | false | Les preuves peuvent être redélivrées sans double effet |
| Heartbeat périodique | 0 | false | Fréquent et remplacé après 10 secondes |
| Redémarrage `DEVICE_RESTARTED` | 1 | false | Fait unique par démarrage, dédupliqué par `messageId`; jamais retenu pour un nouvel abonné |
| Disponibilité ONLINE | 1 | true | État de connexion actuel visible au nouvel abonné |
| Last Will OFFLINE `CONNECTION_LOST` | 1 | true | Signal rapide de rupture anormale, publié par le broker |
| OFFLINE `SHUTDOWN` | 1 | true | Déconnexion propre annoncée par le hub; remplace le ONLINE retenu |

### 7.1 Session hub

- clientId stable;
- cleanSession=false;
- keepAlive=30 secondes;
- un nouveau `connectionId` et un nouveau Last Will préparés avant chaque connexion (§15.2);
- resubscription si le broker ne restaure pas la session;
- commandes expirées refusées après reconnexion.

Le backend ne compte jamais sur une livraison exactement une fois. Toute livraison QoS 1 peut être dupliquée.

### 7.2 Retain

Une commande ou une instruction d’écran `retain=true` est strictement interdite. Une ancienne commande ne doit jamais être livrée à un hub simplement parce qu’il vient de se reconnecter.

Seuls les messages DEVICE_AVAILABILITY sont retenus : ONLINE, OFFLINE `SHUTDOWN` et le Last Will OFFLINE `CONNECTION_LOST`. Un statut retenu ne remplace jamais la vérification de fraîcheur (§15.3).

---

## 8. Enveloppes et champs communs

### 8.1 Messages émis par le hub

| Champ | Type | Requis | Règle |
|---|---|---:|---|
| schemaVersion | string | oui | 2.0 |
| messageId | UUID | oui | Nouveau pour chaque fait logique |
| type | string | oui | Autorisé sur le topic |
| lockerId | UUID | oui | Concorde avec identité et topic |
| timestamp | instant UTC | oui | Horloge device synchronisée |
| deviceSessionId | UUID | oui | Nouveau à chaque démarrage |
| bootCount | entier de 1 à 4 294 967 295 | oui | Augmente de 1 à chaque démarrage; identique pour tous les messages d’un démarrage |
| sequence | entier >= 0 | oui | Croissant dans la session, attribué à la préparation du message, Last Will compris |
| operationId | UUID | selon type | Requis pour un événement opérationnel |
| compartmentId | UUID | selon type | Requis pour une cellule précise |

messageId est l’identité idempotente. sequence aide au diagnostic et à l’ordre local, mais ne remplace jamais messageId.

`deviceSessionId` identifie un démarrage; `bootCount` ordonne les démarrages d’un même
hub. Le firmware conserve `bootCount` en mémoire non volatile (NVS), sur un entier non
signé de 32 bits, et l’incrémente au démarrage, avant tout message; deux démarrages ne
partagent jamais la même valeur. Le compteur appartient à l’identité du hub
(`deviceKey`, §4.1) : un autre `deviceKey` est un autre device (`locker_devices`,
doc 08), dont le compteur et la référence backend partent de zéro. Un nouveau
provisionnement, qui efface la NVS, fait repartir le hub à 1 : la même procédure remet
à zéro la référence de démarrage du backend pour ce device. Le plafond n’est pas
atteignable en usage normal; s’il l’était, le hub devrait être reprovisionné.
`connectionId` (§15) identifie une connexion MQTT à l’intérieur d’un démarrage.

### 8.2 Commandes émises par le backend

| Champ | Type | Requis |
|---|---|---:|
| schemaVersion | string | oui |
| messageId | UUID | oui |
| type | UNLOCK_COMPARTMENT | oui |
| operationId | UUID | oui |
| lockerId | UUID | oui |
| compartmentId | UUID | oui |
| issuedAt | instant UTC | oui |
| expiresAt | instant UTC | oui |

La commande ne contient :

- ni identité utilisateur;
- ni rôle;
- ni readiness;
- ni réservation complète;
- ni jeton d’accès;
- ni secret;
- ni identifiant RFID attendu.

Le hub n’a pas besoin de connaître l’actif attendu. Il rapporte les identifiants physiques observés; le backend les compare au domaine.

---

## 9. Commande UNLOCK_COMPARTMENT

Le backend crée cette commande uniquement après consommation atomique du défi QR et revalidation des gardes métier. La préparation ne suffit jamais. Le hub masque le QR de cette opération au début de l’exécution; aucune logique locale ne remplace l’autorisation backend.


Topic :

```text
aegis/v1/lockers/{lockerId}/commands
```

Payload :

```json
{
  "schemaVersion": "2.0",
  "messageId": "55c71961-21a3-4b2e-8b92-7f237e881a20",
  "type": "UNLOCK_COMPARTMENT",
  "operationId": "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
  "issuedAt": "2026-09-16T14:31:00Z",
  "expiresAt": "2026-09-16T14:33:00Z"
}
```

### 9.1 Validation locale

Avant toute action, le hub vérifie :

1. JSON valide et taille acceptable;
2. schemaVersion supportée;
3. champs obligatoires présents;
4. lockerId identique à son identité;
5. compartmentId connu et adressable;
6. horloge synchronisée;
7. instant courant strictement antérieur à expiresAt;
8. messageId et operationId non déjà consommés;
9. aucune autre ouverture locale active;
10. cellule connectée;
11. porte dans un état sûr;
12. alimentation et actionneur disponibles.

Avant l’action irréversible, le hub persiste la commande dans un état local EXECUTING. Après l’actionnement, il enregistre son résultat final ACKNOWLEDGED ou REJECTED. Si le hub redémarre avec une commande restée EXECUTING, il ne réactive jamais la serrure : il publie PREVIOUS_EXECUTION_UNCERTAIN afin que le backend crée ou maintienne une anomalie.

### 9.2 Durée locale de déverrouillage

Le hub impose une durée maximale de déverrouillage indépendante de la connexion réseau. À son expiration, il tente de remettre la serrure dans son état sûr et publie l’état observé.

La valeur exacte dépend du mécanisme de serrure et doit être fixée dans l’ADR matériel. Elle ne peut pas dépasser la fenêtre de LockerOperation.

---

## 10. Accusé de commande

### 10.1 COMMAND_ACKNOWLEDGED

Un accusé positif signifie que le hub a validé la commande, que la cellule ciblée l’a acceptée et que l’actionnement a été engagé ou confirmé techniquement. Il ne prouve pas que la porte a été ouverte ni que l’actif a changé de présence.

```json
{
  "schemaVersion": "2.0",
  "messageId": "b7ce3d98-f78f-4c1a-a96f-36663bdcfe3c",
  "type": "COMMAND_ACKNOWLEDGED",
  "commandMessageId": "55c71961-21a3-4b2e-8b92-7f237e881a20",
  "operationId": "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
  "timestamp": "2026-09-16T14:31:01Z",
  "deviceSessionId": "a36e9e94-b690-4e41-a14c-3cf8032742b0",
  "bootCount": 3,
  "sequence": 41,
  "result": "ACCEPTED"
}
```

result vaut ACCEPTED ou ALREADY_APPLIED.

Pour une commande dupliquée, le hub republie l’accusé logique connu avec un nouveau messageId d’événement, le même commandMessageId et result=ALREADY_APPLIED. Il ne réactive pas la serrure.

### 10.2 COMMAND_REJECTED

```json
{
  "schemaVersion": "2.0",
  "messageId": "ac370f20-52a2-4e07-9791-f9f64dabdd93",
  "type": "COMMAND_REJECTED",
  "commandMessageId": "55c71961-21a3-4b2e-8b92-7f237e881a20",
  "operationId": "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
  "timestamp": "2026-09-16T14:31:01Z",
  "deviceSessionId": "a36e9e94-b690-4e41-a14c-3cf8032742b0",
  "bootCount": 3,
  "sequence": 41,
  "reason": "CELL_UNREACHABLE",
  "detail": "La cellule ciblée ne répond pas sur le bus local."
}
```

Raisons P0 :

- INVALID_PAYLOAD;
- UNSUPPORTED_SCHEMA;
- WRONG_LOCKER;
- UNKNOWN_COMPARTMENT;
- CLOCK_NOT_SYNCHRONIZED;
- COMMAND_EXPIRED;
- LOCAL_OPERATION_IN_PROGRESS;
- CELL_UNREACHABLE;
- COMPARTMENT_DISABLED;
- DOOR_STATE_UNSAFE;
- LOCK_ACTUATION_FAILED;
- POWER_STATE_UNSAFE;
- PREVIOUS_EXECUTION_UNCERTAIN;
- INTERNAL_DEVICE_ERROR.

detail est borné à 240 caractères et ne contient aucun secret.

---

## 11. Événements de porte et de serrure

Topic :

```text
aegis/v1/lockers/{lockerId}/events
```

### 11.1 Porte

```json
{
  "schemaVersion": "2.0",
  "messageId": "19dc9b16-b1db-4f26-a48a-073034ea35b8",
  "type": "DOOR_OPENED",
  "operationId": "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
  "timestamp": "2026-09-16T14:31:05Z",
  "deviceSessionId": "a36e9e94-b690-4e41-a14c-3cf8032742b0",
  "bootCount": 3,
  "sequence": 42,
  "doorState": "OPEN"
}
```

type vaut DOOR_OPENED ou DOOR_CLOSED. doorState doit concorder avec type.

### 11.2 Serrure

type vaut LOCK_UNLOCKED ou LOCK_LOCKED. Le payload remplace doorState par lockState, valant UNLOCKED ou LOCKED.

Un événement de serrure ne remplace pas un événement de porte. Une serrure déverrouillée ne prouve pas que la porte a été ouverte.

---

## 12. Observation RFID

### 12.1 RFID_SCAN_COMPLETED

Chaque cellule lit localement les tags. À la fin d’une fenêtre de stabilisation, le hub publie une preuve positive que la lecture a réellement été exécutée. Cette preuve contient l’état du lecteur et les identifiants observés, y compris un tableau vide lorsqu’aucun tag n’a été détecté.

```json
{
  "schemaVersion": "2.0",
  "messageId": "55bb8489-fe94-4d21-94df-84cb6fca134a",
  "type": "RFID_SCAN_COMPLETED",
  "operationId": "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
  "timestamp": "2026-09-16T14:31:09Z",
  "deviceSessionId": "a36e9e94-b690-4e41-a14c-3cf8032742b0",
  "bootCount": 3,
  "sequence": 45,
  "windowStartedAt": "2026-09-16T14:31:06Z",
  "windowEndedAt": "2026-09-16T14:31:09Z",
  "readerStatus": "HEALTHY",
  "observedIdentifiers": [
    {
      "identifierType": "RFID_UHF",
      "identifierValue": "E20034120123456789000001",
      "readCount": 3
    }
  ]
}
```

Règles :

- observedIdentifiers contient au maximum 32 entrées dans le P0;
- identifierValue est limité à 255 caractères;
- readCount est compris entre 1 et 65535;
- la fenêtre n’excède pas 10 secondes dans le P0;
- readerStatus vaut HEALTHY, FAULTED ou UNKNOWN;
- un scan FAULTED ou UNKNOWN ne confirme ni présence ni absence;
- le backend compare l’identifiant au tag actif attendu;
- le hub ne reçoit pas l’identifiant attendu dans la commande.

Un tableau vide avec readerStatus=HEALTHY atteste qu’un scan complet n’a observé aucun tag. L’absence de message MQTT ne constitue jamais une preuve d’absence.

`readerStatus` est le nom du champ dans les messages MQTT (`HEARTBEAT`,
`RFID_SCAN_COMPLETED`). Le backend le projette vers l’attribut `rfidReaderStatus`
(doc 03), persisté dans `compartments.rfid_reader_status` (doc 08) et exposé dans
`CompartmentStatusView` (doc 09 §8.6). Les valeurs sont identiques (`HEALTHY`,
`FAULTED`, `UNKNOWN`). Le champ MQTT n’est pas renommé.

### 12.2 Présence et absence normalisées

ASSET_IDENTIFIER_DETECTED, ASSET_PRESENT et ASSET_ABSENT sont des PhysicalObservation produites par le backend à partir de RFID_SCAN_COMPLETED. Le hub n’a pas à connaître l’actif attendu.

Pour le CHECKOUT, le backend exige après la fermeture de porte un RFID_SCAN_COMPLETED couvrant trois secondes, avec lecteur sain et sans le tag attendu dans observedIdentifiers.

Pour le RETURN, il exige un RFID_SCAN_COMPLETED sain contenant au moins trois lectures cohérentes du tag attendu dans la cellule ciblée.

Une détection du même tag dans plusieurs cellules produit une preuve ambiguë et ne confirme aucune opération.

---

## 13. Redémarrage et erreurs device

### 13.1 DEVICE_RESTARTED

Publié après restauration de la connectivité :

```json
{
  "schemaVersion": "2.0",
  "messageId": "ec491081-28bd-46d4-87b2-57da75f670bb",
  "type": "DEVICE_RESTARTED",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "timestamp": "2026-09-16T14:35:00Z",
  "deviceSessionId": "bd6a6594-09f7-4ff5-b0df-dae65da7c249",
  "bootCount": 4,
  "sequence": 0,
  "resetReason": "WATCHDOG",
  "firmwareVersion": "0.1.0"
}
```

`resetReason` est une valeur contrôlée : `POWER_ON`, `EXTERNAL_RESET`, `SOFTWARE_RESET`,
`WATCHDOG`, `PANIC`, `BROWNOUT` ou `UNKNOWN`. Le firmware convertit la cause matérielle
vers cette liste (ESP32 : `ESP_RST_POWERON` → `POWER_ON`, `ESP_RST_EXT` →
`EXTERNAL_RESET`, `ESP_RST_SW` → `SOFTWARE_RESET`, `ESP_RST_INT_WDT`/`ESP_RST_TASK_WDT`/
`ESP_RST_WDT` → `WATCHDOG`, `ESP_RST_PANIC` → `PANIC`, `ESP_RST_BROWNOUT` → `BROWNOUT`,
toute autre cause → `UNKNOWN`). Une valeur hors liste n’invalide pas le message : le
backend la traite comme `UNKNOWN` et conserve le payload brut.

`DEVICE_RESTARTED` est publié une fois par démarrage, sur `events`, QoS 1, sans retain.
Son `bootCount` situe le démarrage parmi les autres; un `DEVICE_RESTARTED` ancien,
livré tard, ne remplace jamais une session plus récente (§15.3).

Si une opération physique était en cours, le redémarrage est une preuve d’incertitude, quelle que soit sa cause. Le backend décide entre FAILED, EXPIRED ou ANOMALY selon les événements déjà reçus; le hub ne conclut rien.

### 13.2 DEVICE_ERROR

Champs additionnels :

- errorCode contrôlé;
- severity : WARNING ou CRITICAL;
- compartmentId facultatif;
- detail borné.

Codes initiaux :

- CELL_COMMUNICATION_LOST;
- RFID_READER_FAULT;
- DOOR_SENSOR_FAULT;
- LOCK_ACTUATOR_FAULT;
- POWER_FAULT;
- CLOCK_SYNC_LOST;
- STORAGE_FAULT.

---

## 14. Heartbeat

Topic :

```text
aegis/v1/lockers/{lockerId}/status
```

Fréquence nominale : toutes les 10 secondes.

```json
{
  "schemaVersion": "2.0",
  "messageId": "9445c92f-95da-4806-a911-ff60db45f713",
  "type": "HEARTBEAT",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "timestamp": "2026-09-16T14:31:10Z",
  "deviceSessionId": "a36e9e94-b690-4e41-a14c-3cf8032742b0",
  "bootCount": 3,
  "sequence": 46,
  "connectionId": "5b0f3c1e-7d2a-4c8e-9f61-2a4d8e7b9c03",
  "firmwareVersion": "0.1.0",
  "uptimeSeconds": 4821,
  "clockSynchronized": true,
  "network": {
    "rssiDbm": -57
  },
  "compartments": [
    {
      "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
      "cellAddress": 1,
      "connectionStatus": "CONNECTED",
      "readerStatus": "HEALTHY",
      "doorState": "CLOSED",
      "lockState": "LOCKED"
    }
  ]
}
```

Le backend :

- authentifie le device;
- déduplique messageId;
- enregistre le fait, même ancien ou d’une autre connexion (§15.3);
- met à jour lastSeenAt avec receivedAt;
- conserve timestamp pour diagnostic;
- ne recule pas une projection de compartiment avec une observation plus ancienne;
- calcule la disponibilité selon le §15.3 : ONLINE exige un heartbeat valide reçu depuis
  30 secondes ou moins, de la session courante et d’une connexion qui n’a pas été
  déclarée fermée; OFFLINE sinon.

`connectionId` est celui de la connexion qui publie le heartbeat (§15.2).

Le heartbeat ne produit aucune transition de prêt ou de réservation.

---

## 15. Disponibilité et Last Will

### 15.1 ONLINE

Après connexion et synchronisation de l’horloge, le hub publie avec QoS 1 et retain=true, avec le `connectionId` de la connexion et une `sequence` supérieure à celle du Last Will préparé avant elle :

```json
{
  "schemaVersion": "2.0",
  "messageId": "79adb482-4a28-4bef-8e7a-016574901eee",
  "type": "DEVICE_AVAILABILITY",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "timestamp": "2026-09-16T14:30:00Z",
  "deviceSessionId": "a36e9e94-b690-4e41-a14c-3cf8032742b0",
  "bootCount": 3,
  "sequence": 1,
  "connectionId": "5b0f3c1e-7d2a-4c8e-9f61-2a4d8e7b9c03",
  "status": "ONLINE",
  "reason": "CONNECTED"
}
```

`reason` vaut `CONNECTED` pour ONLINE, `CONNECTION_LOST` pour l’OFFLINE publié par le
broker au titre du Last Will et `SHUTDOWN` pour l’OFFLINE publié par le hub lui-même
avant une déconnexion propre. `reason` sert au diagnostic. Un ONLINE ne rend jamais le
locker ONLINE à lui seul (§15.3).

### 15.2 OFFLINE par Last Will

Un Last Will est préparé avant chaque connexion MQTT, pas seulement au démarrage, sur le
même topic, avec QoS 1 et retain=true. Il porte un nouveau `connectionId`, que
partagent le ONLINE et les heartbeats publiés sur cette connexion. Dès qu’un Will a pu
être consommé par le broker, c’est-à-dire dès qu’une connexion a été établie, le
suivant reçoit un nouveau `messageId` et un nouveau `connectionId`. Une tentative sans
CONNACK accepté, refusée ou interrompue, peut réutiliser le Will préparé : le broker ne
l’a jamais armé.

Sa `sequence` et son `timestamp` sont attribués à la préparation : ils peuvent être
inférieurs à ceux de messages livrés avant lui, car le broker ne le publie qu’à la
rupture. Le backend ne rejette jamais un `DEVICE_AVAILABILITY` pour sa `sequence` ou
son `timestamp`; il le déduplique sur `messageId` (§16.2) et date le signalement avec
`receivedAt`.

```json
{
  "schemaVersion": "2.0",
  "messageId": "e92228c7-91db-4831-ab79-21dd44f84550",
  "type": "DEVICE_AVAILABILITY",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "timestamp": "2026-09-16T14:29:59Z",
  "deviceSessionId": "a36e9e94-b690-4e41-a14c-3cf8032742b0",
  "bootCount": 3,
  "sequence": 0,
  "connectionId": "5b0f3c1e-7d2a-4c8e-9f61-2a4d8e7b9c03",
  "status": "OFFLINE",
  "reason": "CONNECTION_LOST"
}
```

Avant une déconnexion propre, le hub publie lui-même un OFFLINE `SHUTDOWN` avec QoS 1,
retain=true et le `connectionId` courant, puis envoie DISCONNECT; le broker ne publie
alors pas le Last Will.

Le Last Will et `SHUTDOWN` accélèrent la détection, mais la règle de référence reste
l’absence de heartbeat valide pendant plus de 30 secondes (ADR-004, §15.3).

### 15.3 Faits enregistrés et projection de disponibilité

Le backend sépare deux étapes, dans la transaction d’ingestion du message :

1. **Enregistrer le fait.** Tout message authentifié et conforme est réservé une fois
   par (`lockerDeviceId`, `messageId`) avec `receivedAt` (§16.2), même ancien, retenu,
   d’une autre connexion ou d’un démarrage précédent. Un ancien Last Will valide est
   enregistré et dédupliqué comme les autres : ni sa `sequence` faible ni son
   `timestamp` de préparation ne suffisent à le rejeter.
2. **Mettre à jour la projection** du locker selon les règles ci-dessous. Un fait
   périmé est conservé sans effet sur elle; il ne la fait jamais régresser.

Un heartbeat est **valide** s’il est authentifié, conforme, avec
`clockSynchronized=true` et un `timestamp` ni antérieur de plus de 30 secondes, ni
postérieur de plus de 5 secondes à `receivedAt` (§17.2).

**R1 — ONLINE vient seulement d’un heartbeat valide.** Le locker est ONLINE si et
seulement si la session courante a un heartbeat valide reçu depuis 30 secondes ou
moins, provenant d’une connexion non fermée (R3). Un `DEVICE_AVAILABILITY` ONLINE,
retenu ou non, ne rend jamais le locker ONLINE à lui seul.

**R2 — Session courante.** La session courante d’un device est le démarrage de plus
grand `bootCount` parmi ses faits enregistrés. L’ordre de réception ne compte pas : un
`DEVICE_RESTARTED`, un heartbeat ou une disponibilité d’un `bootCount` inférieur est
enregistré sans effet sur la projection, même reçu en dernier. Un fait d’un
`bootCount` supérieur fait de son démarrage la session courante, même avant l’arrivée
de son `DEVICE_RESTARTED`; le locker reste OFFLINE tant qu’aucun heartbeat valide de
cette session n’est reçu. Deux `deviceSessionId` différents pour le même `bootCount`
révèlent un compteur non conforme : les faits sont enregistrés, la projection ne
change pas et le backend signale une anomalie technique.

**R3 — Connexion fermée et OFFLINE accéléré.** Une connexion est fermée dès qu’un
`DEVICE_AVAILABILITY` OFFLINE de la session courante portant son `connectionId` est
enregistré, Last Will (`CONNECTION_LOST`) ou arrêt propre (`SHUTDOWN`). Elle ne
redevient jamais ouverte. L’OFFLINE de la connexion qui porte le dernier heartbeat
valide rend donc le locker OFFLINE immédiatement, sans attendre les 30 secondes, et un
heartbeat retardé de cette connexion fermée ne rétablit pas ONLINE. L’OFFLINE d’une
connexion plus ancienne est enregistré sans effet : un ancien Will livré après une
reconnexion ne dégrade pas l’état courant.

**R4 — Retour à ONLINE.** Après un OFFLINE accéléré, seul un heartbeat valide d’une
nouvelle connexion, ou d’un nouveau démarrage, rétablit ONLINE; le ONLINE de cette
connexion ne suffit pas. Sans Will ni `SHUTDOWN`, des heartbeats valides qui reprennent
sur une connexion non fermée après plus de 30 secondes de silence rétablissent ONLINE.

**R1 et R3 réconciliées.** La fraîcheur (R1) ne compte que les heartbeats des
connexions non fermées (R3) : un heartbeat récent ne rend pas ONLINE une connexion
depuis déclarée fermée. À l’inverse, l’absence de heartbeat valide pendant plus de
30 secondes rend toujours le locker OFFLINE, avec ou sans Will.

**Reprise du backend.** La projection dépend seulement des faits enregistrés et de
l’instant présent :

- dans la transaction qui enregistre le fait, le backend persiste pour le device la
  session courante (`deviceSessionId`, `bootCount`) et le dernier heartbeat valide pris
  en compte (`connectionId`, `receivedAt`) (doc 08 §4.4); les connexions fermées se
  lisent dans les faits `DEVICE_AVAILABILITY` OFFLINE enregistrés (doc 08,
  `inbound_device_messages`);
- après son propre redémarrage, il relit cet état; ONLINE est recalculé contre
  l’instant présent, donc après plus de 30 secondes d’arrêt le locker reste OFFLINE
  jusqu’au prochain heartbeat valide;
- la projection peut être reconstruite à tout moment en rejouant les faits enregistrés
  du device dans l’ordre de `receivedAt` avec R1 à R4; le résultat doit égaler la
  projection persistée;
- les messages retenus et les livraisons QoS 1 reçus au réabonnement sont des faits
  comme les autres : déjà enregistrés, ils sont des doublons sans effet (§16.2);
  nouveaux, ils suivent R1 à R4. Aucun ne rend le locker ONLINE sans heartbeat valide.

---

## 16. Idempotence

### 16.1 Commandes

L’identité d’une commande est messageId. operationId protège en plus contre deux commandes différentes visant le même workflow.

Le hub conserve durablement un journal borné des commandes consommées :

- messageId;
- operationId;
- état local EXECUTING, ACKNOWLEDGED ou REJECTED;
- résultat ACK ou REJECT lorsqu’il est connu;
- raison;
- horodatage.

Rétention P0 recommandée :

- au moins 24 heures;
- au moins les 64 dernières commandes;
- stockage en anneau afin de limiter l’usure de la mémoire flash.

L’état EXECUTING est persisté avant l’actionnement. Après redémarrage, un doublon ne peut pas rouvrir la serrure. Une entrée EXECUTING retrouvée au démarrage devient un rejet PREVIOUS_EXECUTION_UNCERTAIN; elle exige une réconciliation physique plutôt qu’une nouvelle action.

### 16.2 Messages entrants

Le backend réserve la paire lockerDeviceId + messageId dans PostgreSQL avant tout effet. Un conflit d’unicité :

- n’ajoute aucune nouvelle observation;
- n’avance aucune machine à états;
- peut produire une métrique de doublon;
- retourne le résultat technique déjà connu au consommateur interne.

### 16.3 Identifiants distincts

L’idempotence des messages d’écran est indépendante de celle des commandes : afficher un QR ne doit pas consommer le droit technique d’exécuter l’unique `UNLOCK_COMPARTMENT` de la même opération. Les clés sont le type de flux, `messageId` et, pour l’écran, `displayRevision`.


| Identifiant | Portée |
|---|---|
| displayMessageId | Instruction d’écran visée par un accusé; jamais commandMessageId |
| challengeId | Défi local, sans révéler son secret dans les événements |
| displayRevision | Ordre d’affichage monotone pour un locker |
| command.messageId | Intention backend stable, réutilisée à chaque republication |
| event.messageId | Fait device unique |
| commandMessageId | Commande dont un ACK ou REJECT décrit le résultat |
| operationId | Workflow physique complet |
| deviceSessionId | Démarrage courant du hub |
| bootCount | Ordre des démarrages d’un même hub |
| connectionId | Connexion MQTT à l’intérieur d’un démarrage |
| sequence | Ordre local de diagnostic dans la session |

---

## 17. Ordre, temps et horloge

### 17.1 Horloge

Le hub synchronise son horloge par NTP avant d’accepter une commande. CLOCK_NOT_SYNCHRONIZED provoque un COMMAND_REJECTED.

Le backend demeure l’autorité pour :

- authorizedAt;
- expiresAt;
- checkedOutAt;
- returnedAt;
- receivedAt.

### 17.2 Validation temporelle

- une commande est refusée lorsque now >= expiresAt;
- un événement opérationnel futur de plus de 5 secondes est rejeté;
- un événement opérationnel reçu avec plus de 30 secondes de retard est conservé mais n’avance pas automatiquement une opération sans réévaluation;
- un heartbeat dont timestamp est ancien ne rend pas le locker ONLINE (validité au §15.3);
- receivedAt permet le diagnostic même si l’horloge device est incorrecte.

### 17.3 Désordre réseau

Le backend ne suppose pas que les messages arrivent dans l’ordre. Il conserve les faits et réévalue :

- la même opération;
- le même locker;
- la même cellule;
- l’accusé de commande;
- l’ouverture puis la fermeture;
- la fenêtre RFID;
- l’absence de contradiction.

Une opération terminale ne régresse jamais.

---

## 18. Reconnexion

Le hub utilise un backoff exponentiel avec jitter :

```text
1 s, 2 s, 4 s, 8 s, 16 s, puis maximum 30 s
```

Avant chaque connexion, le hub prépare un nouveau `connectionId` et un nouveau Last Will
(§15.2). Après reconnexion :

1. vérifier si la session broker a été restaurée;
2. se réabonner à commands si nécessaire;
3. publier DEVICE_AVAILABILITY ONLINE avec le `connectionId` de la connexion;
4. publier DEVICE_RESTARTED lorsque le hub a réellement redémarré;
5. publier immédiatement un HEARTBEAT et l’état courant des cellules;
6. traiter les commandes reçues en vérifiant expiresAt et la déduplication;
7. ne jamais inventer une confirmation pour combler une période hors ligne.

Une déconnexion volontaire publie d’abord OFFLINE `SHUTDOWN` (§15.2).

Les événements non publiés peuvent être mis en file locale de taille bornée. Les événements de porte, de commande et d’erreur ont priorité sur les mesures de diagnostic. Si la file déborde, le hub publie STORAGE_FAULT après reconnexion et le backend considère toute opération touchée comme incertaine.

---

## 19. Traitement backend

### 19.1 Pipeline

```mermaid
sequenceDiagram
    participant H as Hub ESP32
    participant B as Broker MQTT
    participant A as Ingestion Spring
    participant D as PostgreSQL

    H->>B: Message QoS 1
    B->>A: Livraison possible en doublon
    A->>A: Valider identité, topic et schéma
    A->>D: Réserver deviceId + messageId
    alt Nouveau message
        A->>D: Message brut + observations
        A->>D: Au plus une transition métier
    else Doublon
        A->>A: Aucun nouvel effet
    end
```

### 19.2 Rejet

Un message lisible mais invalide est conservé avec processingStatus=REJECTED et une raison sûre. Aucun message rejeté ne crée de PhysicalObservation ni de transition métier.

Un payload trop volumineux ou impossible à parser est rejeté avant désérialisation complète. Lorsque messageId ne peut pas être extrait, il est journalisé techniquement sans fabriquer d’identifiant métier.

---

## 20. Matrice des types par topic

| Type | commands | events | status | operationId | compartmentId |
|---|---:|---:|---:|---:|---:|
| UNLOCK_COMPARTMENT | oui | non | non | requis | requis |
| COMMAND_ACKNOWLEDGED | non | oui | non | requis | requis |
| COMMAND_REJECTED | non | oui | non | requis | requis |
| DOOR_OPENED | non | oui | non | requis en opération | requis |
| DOOR_CLOSED | non | oui | non | requis en opération | requis |
| LOCK_UNLOCKED | non | oui | non | requis en opération | requis |
| LOCK_LOCKED | non | oui | non | requis en opération | requis |
| RFID_SCAN_COMPLETED | non | oui | non | requis en opération | requis |
| DEVICE_RESTARTED | non | oui | non | non | non |
| DEVICE_ERROR | non | oui | non | facultatif | facultatif |
| HEARTBEAT | non | non | oui | non | non |
| DEVICE_AVAILABILITY | non | non | oui | non | non |

Un événement de porte ou de RFID hors opération reste permis pour surveiller la réalité physique, mais operationId est alors absent. Il ne confirme aucun prêt. Le backend peut créer une anomalie si cette observation contredit l’état attendu.

---


Les types ajoutés pour l’écran sont exclus des trois topics de commande/état ci-dessus, sauf les accusés d’affichage qui utilisent `events` :

| Type | Topic | operationId | compartmentId |
|---|---|---|---|
| DISPLAY_ACCESS_CHALLENGE | display | requis | requis |
| DISPLAY_OPERATION_STATUS | display | requis | requis |
| ACCESS_CHALLENGE_DISPLAYED | events | requis | requis |
| DISPLAY_REJECTED | events | requis si le message est corrélable | requis si corrélable |

Un message impossible à corréler produit un `DEVICE_ERROR` expurgé, pas un faux `DISPLAY_REJECTED` sans identifiants obligatoires.

## 21. Codes de rejet backend

Lorsqu’un message device est rejeté par l’ingestion, processingError utilise une valeur contrôlée :

- DEVICE_UNKNOWN;
- DEVICE_DISABLED;
- TOPIC_NOT_AUTHORIZED;
- TOPIC_PAYLOAD_LOCKER_MISMATCH;
- PAYLOAD_TOO_LARGE;
- INVALID_JSON;
- REQUIRED_FIELD_MISSING;
- UNSUPPORTED_SCHEMA;
- MESSAGE_TYPE_NOT_ALLOWED_ON_TOPIC;
- INVALID_UUID;
- TIMESTAMP_INVALID;
- TIMESTAMP_OUT_OF_RANGE;
- OPERATION_NOT_FOUND;
- OPERATION_LOCKER_MISMATCH;
- OPERATION_COMPARTMENT_MISMATCH;
- COMMAND_CORRELATION_INVALID;
- TERMINAL_OPERATION_EVENT_IGNORED.

Les erreurs de parsing ne sont jamais publiées vers un topic de commande. Elles sont observées côté backend et dans l’administration lorsque pertinent.

---

## 22. Observabilité

### 22.1 Logs

Ne jamais tracer le token, l’URI QR ou le payload `DISPLAY_ACCESS_CHALLENGE`, y compris dans les logs broker, les callbacks MQTT et les dumps firmware. Les accusés ne recopient pas ce contenu. Si un message entrant illégitime contient un secret, le diagnostic est expurgé avant conservation; la politique d’événements bruts ne justifie pas une fuite de secrets.


Champs de corrélation :

- lockerId;
- lockerDeviceId;
- deviceSessionId;
- messageId;
- commandMessageId;
- operationId;
- compartmentId;
- schemaVersion;
- processingStatus.

Les logs n’incluent aucun secret, mot de passe ou payload complet par défaut.

### 22.2 Métriques

- mqtt_messages_received_total par type;
- mqtt_messages_rejected_total par raison;
- mqtt_duplicates_ignored_total;
- mqtt_command_publish_attempts_total;
- mqtt_command_ack_latency_seconds;
- mqtt_heartbeat_age_seconds;
- mqtt_reconnects_total;
- outbox_pending_count;
- outbox_oldest_pending_age_seconds;
- locker_operations_anomaly_total.

---

## 23. Tests contractuels minimaux

### 23.1 ACL et sécurité

- Le hub ne peut lire que son topic display, et ne peut y publier.
- Aucune ancienne instruction d’écran expirée ou d’un autre démarrage ne s’affiche.
- Les doublons d’écran ne provoquent aucune impulsion de serrure.
- Les révisions anciennes ne remplacent pas un résultat récent.
- L’accusé d’affichage ne fait pas avancer l’opération vers COMMAND_ACKNOWLEDGED.
- Le token n’apparaît ni dans les accusés ni dans les traces.
- Couper l’écran ou retarder son accusé empêche l’autorisation QR; aucun fallback logiciel ne contourne la preuve.


1. Un device peut publier uniquement sur ses topics events et status.
2. Il ne peut pas publier commands.
3. Il ne peut pas lire ou écrire les topics d’un autre locker.
4. Un secret invalide refuse la connexion.
5. Un certificat serveur invalide refuse la connexion distante.

### 23.2 Commande

1. Une commande valide ouvre uniquement la cellule ciblée.
2. retain=true n’est jamais utilisé.
3. Une commande expirée est rejetée.
4. Un lockerId différent est rejeté.
5. Une commande dupliquée republie son résultat sans nouvel actionnement.
6. Un redémarrage du hub n’efface pas immédiatement la déduplication.
7. Une cellule déconnectée produit CELL_UNREACHABLE.

### 23.3 Événements

1. Un ACK référence commandMessageId et operationId.
2. Une porte ouverte ne confirme pas un retrait.
3. Une lecture RFID isolée ne confirme pas une présence.
4. Un RFID_SCAN_COMPLETED sain contenant trois lectures cohérentes peut confirmer un retour après fermeture.
5. Seul un RFID_SCAN_COMPLETED sain et vide du tag attendu peut contribuer à confirmer un checkout après fermeture.
6. L’absence d’un message RFID ne confirme jamais l’absence de l’actif.
7. Une ambiguïté entre cellules produit une anomalie ou UNKNOWN.

### 23.4 Déduplication backend

1. Deux livraisons du même messageId créent une seule ligne canonique.
2. Elles ne créent qu’un ensemble d’observations.
3. Elles n’avancent la machine à états qu’une fois.
4. Deux consommateurs concurrents respectent la contrainte unique.

### 23.5 Heartbeat, connexions et reconnexion

Côté hub (vérifiables avec le simulateur) :

1. Le hub publie un heartbeat toutes les 10 secondes.
2. Chaque connexion reçoit un nouveau `connectionId` et un nouveau Last Will (nouveau
   `messageId`); son Will, son ONLINE et ses heartbeats portent ce `connectionId`.
3. Un arrêt propre publie OFFLINE `SHUTDOWN` sans Will; une rupture fait publier par le
   broker le Will `CONNECTION_LOST` de la connexion rompue.
4. La reconnexion republie ONLINE et un heartbeat courant; `bootCount` augmente de 1 à
   chaque démarrage et reste constant dans un démarrage.

Côté backend (ingestion PHY-01). Pour rejouer un message ancien, le simulateur
republie son corps exact; rejouer un Will retenu remplace aussi le statut retenu du
broker, comme le ferait un Will réellement tardif :

5. Un ancien Will livré après une reconnexion et un heartbeat de la nouvelle connexion
   est enregistré; le locker reste ONLINE.
6. Le Will de la connexion courante rend le locker OFFLINE immédiatement, malgré une
   `sequence` inférieure à son ONLINE; un heartbeat retardé de cette connexion ne
   rétablit pas ONLINE.
7. Un ONLINE retenu rejoué à l’abonnement, sans heartbeat frais, ne rend pas le locker
   ONLINE; un heartbeat dont le `timestamp` date de 45 secondes non plus.
8. Un `DEVICE_RESTARTED` ou un heartbeat d’un `bootCount` inférieur, reçu après la
   nouvelle session, est enregistré sans effet sur la projection.
9. Le même `messageId` livré deux fois donne un seul fait et aucun second effet.
10. Sans heartbeat pendant plus de 30 secondes, et sans Will, le locker passe OFFLINE.
11. Après `SHUTDOWN`, un nouveau démarrage et un heartbeat valide rendent le locker
    ONLINE.
12. Après un redémarrage du backend, l’état relu égale celui reconstruit à partir des
    faits, et ONLINE n’est rétabli que par un heartbeat valide reçu après la reprise.
13. Une commande mise en file mais expirée n’est pas exécutée.

### 23.6 Panne

1. Coupure après publication backend mais avant commit du dispatcher : la republication conserve messageId.
2. Coupure après actionnement mais avant ACK : le doublon ne réactive pas la serrure.
3. Redémarrage pendant une porte ouverte : l’opération devient incertaine.
4. Débordement de la file locale : erreur visible, aucune confirmation inventée.

---

## 24. Routes de communication interdites

Les flux suivants sont interdits :

- iOS vers MQTT;
- React vers MQTT;
- cellule vers MQTT;
- hub vers PostgreSQL;
- broker vers PostgreSQL;
- commande MQTT sans LockerOperation;
- commande générique d’ouverture sans compartmentId;
- commande retenue;
- payload contenant un jeton utilisateur;
- device déclarant un prêt terminé;
- device déclarant une readiness.

---

## 25. Limites P0

Le contrat ne couvre pas :

- plusieurs hubs pour un même locker;
- orchestration multi-lockers;
- OTA du firmware;
- commandes de maintenance à distance;
- MQTT 5;
- mTLS device;
- télémétrie haute fréquence;
- caméra ou AI Vision;
- plusieurs opérations physiques simultanées;
- protocole RS-485 détaillé.

---

## 26. Critères de conformité

Le contrat est respecté si :

1. chaque hub possède une identité et des ACL propres;
2. le transport distant est chiffré;
3. les commandes utilisent QoS 1 et retain=false;
4. chaque commande possède messageId, operationId et expiresAt;
5. chaque ACK référence commandMessageId;
6. le hub déduplique avant l’actionnement;
7. le backend déduplique avant tout effet;
8. le heartbeat est émis toutes les 10 secondes;
9. OFFLINE est dérivé après plus de 30 secondes sans heartbeat valide, ou dès l’OFFLINE de la connexion courante; ONLINE n’est dérivé que d’un heartbeat valide d’une connexion non fermée de la session courante (§15.3);
10. un fait ancien est enregistré sans faire régresser la projection;
11. les cellules n’utilisent jamais MQTT;
12. aucune observation ne décide seule d’un prêt;
13. une coupure réseau ne provoque ni double ouverture ni confirmation silencieuse;
14. les tests de doublon, expiration, reconnexion et ACL passent;
15. les payloads réels correspondent aux exemples et schémas de cette version.

## 27. Contrat de l’écran du hub

### 27.1 DISPLAY_ACCESS_CHALLENGE

Topic : `aegis/v1/lockers/{lockerId}/display`. QoS 1, `retain=false`, TLS et ACL requis. Exemple fictif :

```json
{
  "schemaVersion": "2.0",
  "messageId": "fd6c4a94-4ac4-4a91-9249-59347c3b648b",
  "type": "DISPLAY_ACCESS_CHALLENGE",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
  "operationId": "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
  "targetDeviceSessionId": "1b24299c-028f-4c9f-a942-1c1ce36be899",
  "displayRevision": 41,
  "issuedAt": "2026-09-16T14:31:00Z",
  "expiresAt": "2026-09-16T14:32:00Z",
  "payload": {
    "challengeId": "9d65cbae-4610-4e40-a314-3b93af07be9c",
    "action": "CHECKOUT",
    "compartmentCode": "A1",
    "token": "<base64url-de-32-octets-aleatoires>"
  }
}
```

Tous les champs montrés sont requis. `action` vaut CHECKOUT ou RETURN. Le hub construit le QR selon ce format :

```text
aegis://local-access?v=1&challengeId=<UUID>&operationId=<UUID>&lockerId=<UUID>&token=<base64url>
```

L’application lit ce format dans son scanner interne. Aucun site Web ni service tiers ne reçoit l’URI. Aucun nom de technicien, email, mot de passe ou jeton de connexion n’est affiché.

L’horloge du hub doit être synchronisée avant affichage. Il vérifie son locker, son `deviceSessionId`, l’échéance et la révision. Il n’étend jamais la durée maximale retenue de 60 secondes après création. Si la fermeture ou la fin de réservation intervient avant, le backend fournit cette échéance réduite. Un affichage tardif n’ouvre pas une nouvelle fenêtre de 60 secondes.

### 27.2 Accusé applicatif d’affichage

`ACCESS_CHALLENGE_DISPLAYED`, sur `events`, reprend l’enveloppe hub §8.1 et ajoute :

```json
{
  "displayMessageId": "fd6c4a94-4ac4-4a91-9249-59347c3b648b",
  "challengeId": "9d65cbae-4610-4e40-a314-3b93af07be9c",
  "displayRevision": 41
}
```

Cet extrait est ajouté à l’enveloppe complète, pas publié seul. Il est émis après rendu effectif du QR. Le backend valide le device, la session et la correspondance exacte du message et du défi avant de renseigner `displayedAt`. Un PUBACK MQTT ne suffit pas.

`DISPLAY_REJECTED` utilise la même corrélation (`challengeId` seulement pour un défi) et une raison : `SCREEN_UNAVAILABLE`, `TARGET_SESSION_MISMATCH`, `DISPLAY_EXPIRED`, `STALE_DISPLAY_REVISION` ou `INVALID_DISPLAY_PAYLOAD`. Aucun de ces événements ne contient le token ni `commandMessageId`.

### 27.3 DISPLAY_OPERATION_STATUS

Même enveloppe backend que §27.1, nouveau `messageId`, révision supérieure, échéance d’affichage de 30 secondes, et payload :

```json
{
  "action": "CHECKOUT",
  "compartmentCode": "A1",
  "status": "CONFIRMED",
  "reasonCode": null
}
```

`status` décrit un état backend validé, notamment CONFIRMED, FAILED, EXPIRED ou ANOMALY. Le hub utilise des messages d’interface prédéfinis selon ces codes. Un état local de porte ne produit jamais « retrait confirmé ». Après l’échéance d’affichage, l’écran revient à l’accueil; l’état métier persiste.

Ce message n’exige pas d’accusé applicatif positif au P0; sa distribution reste suivie par le dispatcher et QoS 1. Une erreur d’écran peut produire `DISPLAY_REJECTED` corrélé.

### 27.4 Ordre, reconnexion et purge

Le backend alloue `displayRevision` sous verrou du locker. Le hub conserve la plus grande révision acceptée pendant son démarrage; un doublon identique peut être acquitté à nouveau sans réafficher un QR masqué ou consommé. Une ancienne révision est ignorée.

Un nouveau démarrage efface tout QR et génère un nouveau `deviceSessionId`. Les anciennes instructions ciblant l’ancienne session sont rejetées, même si une session MQTT persistante les restitue. Avant autorisation, une perte de connexion invalide le défi côté backend et masque l’écran côté hub.

L’outbox écran conserve le token sous chiffrement applicatif uniquement jusqu’à consommation, expiration ou invalidation, puis le purge. Les délais et la consommation backend restent la protection finale si un paquet ancien est déjà en transit.

### 27.5 Portée de sécurité et compatibilité

Un code peut être relayé par photo ou vidéo. Ce mécanisme ajoute une barrière à l’ouverture distante; il n’est ni une preuve anti-relais ni un nouveau facteur d’identité indépendant.

Le topic display est séparé pour conserver le contrat UNLOCK_COMPARTMENT. Cette révision définit les nouveaux types avant leur implémentation : mettre à jour hub, simulateur, backend et clients ensemble. Un hub sans capacité d’affichage ne peut pas ouvrir dans ce parcours; aucun ancien chemin direct n’est conservé.
