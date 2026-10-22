# Simulateur du hub Aegis (SIM-01, SIM-02)

Outil Node/TypeScript autonome qui se comporte comme le hub ESP32 d'un locker
(Aegis Locker Node) face au broker MQTT, afin de développer et tester le backend
sans le matériel. Il réimplémente le [contrat MQTT](../../docs/cahier-conception/10-contrats-mqtt.md)
à partir de la documentation, sans partager de code avec l'API Java : un écart
entre les deux lectures du contrat doit apparaître en intégration.

Il ne prend aucune décision métier : il valide techniquement, déduplique,
actionne la cellule simulée visée et rapporte ce qu'il observe. Le monde physique
(portes, tags, pannes) est scripté, jamais décidé par le hub.

La tranche SIM-02 (#39) ajoute les commandes, l'écran et les observations
physiques; voir [Commandes](#commandes-unlock_compartment),
[Journal de déduplication](#journal-de-déduplication), [Écran](#écran-du-hub) et
[Observations physiques](#observations-physiques). La tranche SIM-01 (P0.0,
issue #15, mise au schéma 2.0 par #63) couvre :

- `DEVICE_AVAILABILITY` `ONLINE` (`reason` `CONNECTED`) publié à chaque connexion,
  QoS 1, `retain=true` (§15.1);
- un Last Will `OFFLINE` (`reason` `CONNECTION_LOST`) préparé avant chaque
  connexion, QoS 1, `retain=true` (§15.2);
- un `OFFLINE` `SHUTDOWN` publié par le hub lui-même avant un `DISCONNECT` propre,
  QoS 1, `retain=true`; le broker ne publie alors pas le Last Will (§15.2). Rien
  n'est publié après `SHUTDOWN` sur cette connexion. Si son PUBACK n'arrive pas
  en 5 s, le message est abandonné et `DISCONNECT` part aussitôt; si le socket
  n'est pas fermé 5 s plus tard (broker qui le garde à demi ouvert), il est
  détruit. `DISCONNECT` étant déjà écrit, le broker qui le lit abandonne le
  Will : l'arrêt se termine toujours, sans Will;
- `DEVICE_RESTARTED` une seule fois par démarrage, sur `events`, QoS 1, sans
  retain, avec un `resetReason` de la liste contrôlée (§13.1);
- un `HEARTBEAT` immédiat après connexion puis toutes les 10 s, QoS 0, sans retain (§14);
- l'enveloppe commune du §8.1, schéma `2.0` (voir ci-dessous);
- MQTT 3.1.1, `cleanSession=false`, `keepAlive=30`, `clientId`
  `aegis-locker-<deviceKey>` (§4.1, §7.1);
- la reconnexion avec backoff 1, 2, 4, 8, 16 puis 30 s et gigue (§18), qui
  republie `ONLINE` et un heartbeat sans redéclarer de redémarrage;
- une étape de rejeu qui republie tel quel un message déjà émis (voir
  [Rejeu](#rejeu-dun-message-déjà-émis)).

Le simulateur prouve seulement ce qu'il émet. La projection de disponibilité
(ONLINE, OFFLINE, Will périmé sans effet, reprise du backend) relève de
l'ingestion backend (PHY-01, §15.3 et §23.5 points 5 à 12).

## Champs du schéma 2.0

| Champ | Messages | Règle appliquée par le simulateur |
|---|---|---|
| `schemaVersion` | tous | `"2.0"`; le segment `v1` des topics versionne l'arborescence et les ACL, pas le payload |
| `messageId` | tous | UUID neuf pour chaque fait; un rejeu le conserve |
| `deviceSessionId` | tous | UUID neuf à chaque démarrage |
| `bootCount` | tous | Entier de 1 à 4 294 967 295 (32 bits non signé), +1 à chaque démarrage, identique pour tous les messages d'un démarrage (voir ci-dessous) |
| `sequence` | tous | Croissante dans le démarrage sur tous les messages *préparés*, Last Will compris : le Will de la première connexion prend 0, son `ONLINE` 1 |
| `connectionId` | `DEVICE_AVAILABILITY`, `HEARTBEAT` | UUID neuf par connexion MQTT, partagé par son Will, son `ONLINE`, ses heartbeats et son `SHUTDOWN` |
| `timestamp` | tous | RFC 3339 UTC en secondes entières, terminé par `Z`; celui du Will est l'instant de sa préparation |
| `reason` | `DEVICE_AVAILABILITY` | `CONNECTED`, `CONNECTION_LOST` ou `SHUTDOWN` |
| `resetReason` | `DEVICE_RESTARTED` | `POWER_ON`, `EXTERNAL_RESET`, `SOFTWARE_RESET`, `WATCHDOG`, `PANIC`, `BROWNOUT` ou `UNKNOWN` |

Un nouveau `connectionId` et un nouveau Last Will (nouveau `messageId`, nouvelle
`sequence`) sont préparés avant **chaque** tentative de connexion : au démarrage,
puis à chaque fermeture, que la connexion ait été établie ou non. Aucun Will
n'est réutilisé, même après une tentative sans CONNACK : le broker enregistre le
Will dès qu'il accepte le CONNECT [MQTT-3.1.2-8], donc un CONNACK perdu peut
cacher un Will déjà armé, dont la publication fermerait ce `connectionId` pour
de bon.

Le simulateur refuse, à la configuration comme dans un scénario, un
`resetReason` hors liste. La tolérance du contrat (une valeur inconnue traitée
comme `UNKNOWN`) est une règle du consommateur; le simulateur, producteur,
n'émet que des valeurs contrôlées.

## `bootCount` et persistance

Le firmware conserve `bootCount` en NVS et l'incrémente au démarrage, avant tout
message. Le simulateur fait de même dans un fichier d'état **hors du dépôt**,
qui tient lieu de NVS :

- chemin par défaut, **un fichier par `deviceKey`** :
  `$XDG_STATE_HOME/aegis/hub-simulator/boot-count-<deviceKey>.json`, soit
  `~/.local/state/aegis/hub-simulator/boot-count-<deviceKey>.json` sans
  `XDG_STATE_HOME`. Des simulateurs de hubs différents n'écrivent donc jamais
  le même fichier : sans verrou, un fichier partagé pourrait perdre une mise à
  jour;
- `AEGIS_SIM_BOOT_COUNT_FILE` impose un fichier explicite. Il peut contenir
  plusieurs `deviceKey`, mais deux processus qui le partagent en même temps
  peuvent perdre une mise à jour : réservez-le à un seul processus à la fois;
- la valeur est réservée et écrite (écriture puis renommage) à chaque `start()`,
  donc aussi à chaque `restart()` et à chaque relance du processus; un fichier
  absent fait partir de 1;
- un fichier illisible ou mal formé arrête le simulateur au lieu de repartir à
  1, ce qu'un backend classerait comme un démarrage plus ancien;
- `AEGIS_SIM_BOOT_COUNT` (ou `firstBootCount` en API) impose la valeur du premier
  démarrage du processus, puis le compteur reprend à partir d'elle.

Comme pour un nouveau provisionnement qui efface la NVS, une remise à zéro
(supprimer l'entrée du fichier ou `AEGIS_SIM_BOOT_COUNT=1`) doit s'accompagner de
la remise à zéro de la référence de démarrage du backend pour ce device (§8.1);
sinon le backend traite les nouveaux messages comme une session ancienne, ou
signale une anomalie si deux `deviceSessionId` partagent le même `bootCount`. Le
compteur est indexé par `deviceKey` : changer `AEGIS_SIM_DEVICE_KEY` pour un même
locker équivaut à un nouveau device et repart à 1. Deux processus ne doivent pas
simuler le même `deviceKey` en même temps (ils partageraient aussi le `clientId`).

Le `.gitignore` du simulateur exclut `boot-count*.json` au cas où un chemin
relatif viserait le dépôt; les tests écrivent dans un répertoire temporaire.

## Commandes `UNLOCK_COMPARTMENT`

À chaque connexion, le hub s'abonne (QoS 1) aux seuls topics `commands` et
`display` de son locker (§6.1). Il s'abonne à chaque connexion plutôt que de se
fier à `sessionPresent` : une session persistante peut exister sans ces
abonnements (créée par SIM-01, par exemple). Une commande livrée avec le
drapeau `retain`, c'est-à-dire rejouée depuis le stock retenu du broker à
l'abonnement, n'est jamais exécutée (§7.2). Une publication `retain=true` faite
pendant que le hub est abonné lui parvient avec `retain=false`
[MQTT-3.3.1-9] : elle est traitée comme toute commande, et seul le backend
peut l'éviter en ne publiant jamais de commande retenue. Pendant un arrêt
propre (`stop()`), une commande reçue n'est ni traitée ni acquittée : le broker
la redélivre à la prochaine connexion de la session.

Validation, dans cet ordre (§9.1) :

| Étape | Résultat si elle échoue |
|---|---|
| Taille ≤ 16 Kio, JSON objet, `messageId`, `operationId` et `compartmentId` en UUID canonique | Ignorée et journalisée localement : un `COMMAND_REJECTED` exige ces trois champs (§20) |
| `messageId` déjà dans le journal | Résultat connu republié : `COMMAND_ACKNOWLEDGED` `ALREADY_APPLIED` ou le même `COMMAND_REJECTED`, sans actionnement |
| `schemaVersion` majeure 2 | `UNSUPPORTED_SCHEMA` (version absente ou mal formée : `INVALID_PAYLOAD`) |
| `type`, `lockerId`, `issuedAt`, `expiresAt` valides, `expiresAt` > `issuedAt` | `INVALID_PAYLOAD` |
| `lockerId` du hub | `WRONG_LOCKER` |
| `compartmentId` d'une cellule configurée | `UNKNOWN_COMPARTMENT` |
| Horloge synchronisée | `CLOCK_NOT_SYNCHRONIZED` |
| Maintenant < `expiresAt` | `COMMAND_EXPIRED` |
| `operationId` déjà exécuté par une autre commande | Résultat connu de cette opération, avec le nouveau `commandMessageId` |
| Aucune opération physique en cours sur le locker | `LOCAL_OPERATION_IN_PROGRESS` |
| Cellule `CONNECTED` | `CELL_UNREACHABLE` |
| Porte `CLOSED` | `DOOR_STATE_UNSAFE` |

Une commande acceptée est écrite `EXECUTING` dans le journal **avant**
l'actionnement, masque le QR de son opération, déverrouille la seule cellule
visée, puis le journal passe à `ACKNOWLEDGED` et le hub publie
`COMMAND_ACKNOWLEDGED` `ACCEPTED` puis `LOCK_UNLOCKED`. Tous ces événements
partent sur `events`, QoS 1, sans retain. Si `EXECUTING` ne peut pas être écrit
(fichier en erreur ou journal plein, voir ci-dessous), rien n'est actionné et le
hub répond `INTERNAL_DEVICE_ERROR`. Une seconde commande d'une opération déjà
exécutée qui vise une autre cellule est rejetée `INVALID_PAYLOAD`, sans
actionnement.

Le hub ne publie jamais `COMPARTMENT_DISABLED` ni `POWER_STATE_UNSAFE`, dont le
sens côté hub n'est pas défini.

## Journal de déduplication

Le journal (§16.1) est l'équivalent de l'anneau en flash du firmware. Il garde,
par commande, `messageId`, `operationId`, `compartmentId`, l'état `EXECUTING`,
`ACKNOWLEDGED` ou `REJECTED`, la raison, le détail, le `expiresAt` de la
commande lorsqu'il est lisible et l'horodatage. Il est
persisté comme `bootCount`, **hors du dépôt**, un fichier par `deviceKey` :
`$XDG_STATE_HOME/aegis/hub-simulator/command-journal-<deviceKey>.json` par défaut,
ou `AEGIS_SIM_COMMAND_JOURNAL_FILE`. Chaque écriture se fait par fichier
temporaire puis renommage; un fichier illisible, mal formé ou d'un autre
`deviceKey` arrête le démarrage plutôt que d'oublier les commandes consommées.

- Rétention : toute entrée de moins de 24 h et au moins les 64 dernières. Le
  journal garde aussi, quel que soit leur âge, les entrées dont une
  redélivrance pourrait encore actionner une serrure : `EXECUTING`, un rapport
  d'incertitude non acquitté, et toute commande non expirée, sauf un rejet dont
  la raison ne peut pas changer (`INVALID_PAYLOAD`, `UNSUPPORTED_SCHEMA`,
  `WRONG_LOCKER`, `UNKNOWN_COMPARTMENT`, `COMMAND_EXPIRED`).
- Plafond de 1024 entrées. Au-delà, le journal oublie d'abord, du plus ancien au
  plus récent, les rejets qui ne peuvent mener à aucun actionnement (raison
  stable ou commande expirée), même de moins de 24 h. Une commande exécutée
  n'est jamais oubliée avant son `expiresAt` ni dans les minimums de 24 h et de
  64 entrées. Si seules des entrées protégées restent, le journal est plein : la
  nouvelle commande est refusée `INTERNAL_DEVICE_ERROR` plutôt que d'oublier
  une entrée protégée. Une rafale de plus de 1024 rejets non expirés peut donc
  rendre le hub indisponible jusqu'à leur expiration; une commande déjà rejetée
  dont l'écriture est refusée n'est pas journalisée.
- Si l'écriture qui suit une décision échoue (`ACKNOWLEDGED`, `REJECTED`), le
  journal en mémoire suit quand même la décision : une redélivrance pendant ce
  démarrage reçoit la même réponse. La copie durable reste celle d'avant; après
  un redémarrage, une commande restée `EXECUTING` est déclarée incertaine.
- Après un redémarrage (`restart`, relance du processus), le journal est relu :
  une redélivrance ne rouvre jamais une serrure (§23.2 point 6).
- Une entrée restée `EXECUTING` au démarrage devient `REJECTED`
  `PREVIOUS_EXECUTION_UNCERTAIN`. Le hub publie ce rejet après `ONLINE`,
  `DEVICE_RESTARTED` et le premier heartbeat, puis à chaque démarrage tant que
  le broker ne l'a pas acquitté. Une redélivrance de cette commande, ou une
  autre commande de la même opération, reçoit la même réponse, sans
  actionnement.
- Un crash pendant le traitement n'envoie pas de PUBACK : le broker redélivre la
  commande à la reconnexion de la session persistante (§23.6 point 2).

Deux processus ne doivent pas partager le même fichier en même temps.

## Écran du hub

`DISPLAY_ACCESS_CHALLENGE` (§27.1) est affiché si son `targetDeviceSessionId`
est celui du démarrage courant, si l'écran est disponible et l'horloge
synchronisée, si l'échéance n'est pas passée et si `displayRevision` dépasse
la plus grande révision acceptée pendant ce démarrage. L'affichage dure au plus
60 s après `issuedAt` et au plus 60 s à partir de la réception, même si
`expiresAt` est plus tardif ou `issuedAt` dans le futur. Après le rendu, le
hub publie `ACCESS_CHALLENGE_DISPLAYED` (`displayMessageId`, `challengeId`,
`displayRevision`, `operationId`, `compartmentId`), sans le token ni
`commandMessageId`.

Le QR est masqué au début de l'exécution de la commande de cette opération, à
une perte de connexion, à l'échéance et à chaque démarrage. Un doublon est
acquitté de nouveau sans réafficher le QR. `DISPLAY_OPERATION_STATUS` (§27.3)
remplace l'écran pour 30 s au plus, sans accusé positif.

| Cas | `DISPLAY_REJECTED.reason` |
|---|---|
| Autre démarrage | `TARGET_SESSION_MISMATCH` |
| Échéance passée | `DISPLAY_EXPIRED` |
| Révision inférieure ou égale | `STALE_DISPLAY_REVISION` |
| Écran coupé ou horloge non synchronisée | `SCREEN_UNAVAILABLE` |
| Schéma, type, `lockerId`, cellule ou payload invalide | `INVALID_DISPLAY_PAYLOAD` |

Un message non corrélable (sans `messageId`, `operationId` ou `compartmentId`
valides) ou retenu est ignoré et journalisé localement. Le token et l'URI du QR
ne sont jamais journalisés ni publiés. Seul l'accesseur `screen` de l'API les
expose, pour qu'un test de bout en bout puisse « scanner » le QR.

## Observations physiques

Chaque cellule simulée garde son adresse, l'état de connexion, du lecteur, de
la porte et de la serrure (ceux du heartbeat) et les tags présents. Le monde
physique est scripté :

- `openDoor` publie `DOOR_OPENED`. Une porte verrouillée ne s'ouvre qu'avec
  `forced` (effraction, gâche défaillante);
- `closeDoor` publie `DOOR_CLOSED`. Si la serrure est encore ouverte, le hub la
  reverrouille et publie `LOCK_LOCKED`; dans une opération, il lance ensuite un
  scan RFID de 3 s (`AEGIS_SIM_RFID_WINDOW_MS`);
- `RFID_SCAN_COMPLETED` liste les tags présents à la fin de la fenêtre, avec
  leur `readCount` (3 par défaut, pour la preuve de retour §12.2). Un lecteur
  `FAULTED` donne `FAULTED` et une liste vide; une cellule déconnectée donne
  `UNKNOWN` et une liste vide;
- sans ouverture de porte, la serrure se reverrouille d'elle-même après
  `AEGIS_SIM_UNLOCK_WINDOW_MS` (15 s par défaut, §9.2). Cette durée continue de
  s'écouler pendant une coupure réseau.

Les événements portent l'`operationId` de l'opération en cours dans la cellule,
de l'actionnement jusqu'au scan qui suit la fermeture, ou jusqu'au
reverrouillage d'une ouverture inutilisée. Hors opération (porte forcée, scan
explicite, après un redémarrage), ils n'en portent pas (§20). Un événement
préparé pendant une coupure est mis en file (64 au plus) et publié après
`ONLINE` et le heartbeat, avec sa `sequence` d'origine. Le dépassement de la
file n'est pas signalé par `STORAGE_FAULT`. Un événement survenu hub éteint
est perdu. Au démarrage, les serrures reviennent à `LOCKED` et l'opération en
cours est oubliée.

## Prérequis

- Node 22.18 ou plus récent (exécution directe du TypeScript; vérifié avec Node 24.13 et npm 11.8);
- la pile locale démarrée depuis la racine du dépôt :

  ```bash
  docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml up -d --wait
  ```

## Lancer le simulateur

Depuis `tools/hub-simulator/` :

```bash
npm ci --ignore-scripts
export AEGIS_MQTT_DEVICE_PASSWORD="$(grep '^AEGIS_MQTT_DEVICE_PASSWORD=' ../../infra/docker/.env.example | cut -d= -f2)"
npm start
```

Le secret du device n'est lu que dans l'environnement, jamais en argument ni
dans un fichier versionné. En local, sa valeur est `AEGIS_MQTT_DEVICE_PASSWORD`
de `infra/docker/.env.example`, valable uniquement pour ce broker isolé.

Le processus écrit une ligne JSON par événement (`will_prepared`, `state`,
`delivered`, `reconnect_scheduled`...) sans jamais journaliser le secret.
`--log-payloads` ajoute le payload complet.

| Arrêt | Effet observé par le backend |
|---|---|
| `Ctrl+C` ou `SIGTERM` | `OFFLINE` `SHUTDOWN` sur la connexion courante, puis `DISCONNECT`; le broker abandonne le Last Will |
| `kill -9` | Fermeture brutale; le broker publie le Last Will `OFFLINE` `CONNECTION_LOST` de la connexion courante |

Pour observer les messages avec l'identité du backend (`aegis_api`, lecture de
`status` et `events` seulement), depuis la racine du dépôt :

```bash
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml exec mosquitto \
  mosquitto_sub -V mqttv311 -u aegis_api \
  -P "$(grep '^AEGIS_MQTT_API_PASSWORD=' infra/docker/.env.example | cut -d= -f2)" -q 1 \
  -t 'aegis/v1/lockers/+/status' -t 'aegis/v1/lockers/+/events' -F '%I %t qos=%q retain=%r %p'
```

## Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `AEGIS_MQTT_DEVICE_PASSWORD` | aucun, requis | Secret du device |
| `AEGIS_MQTT_URL` | `mqtt://127.0.0.1:1883` | Broker; `mqtt:` est refusé hors boucle locale |
| `AEGIS_MQTT_DEVICE_USERNAME` | le `lockerId` | Utilisateur MQTT du device |
| `AEGIS_MQTT_CA_FILE` | aucun | CA à valider pour `mqtts:` |
| `AEGIS_SIM_LOCKER_ID` | `d46a74ae-39dc-460b-8af0-38fc791b376a` | Locker fictif de `infra/mqtt/acl` |
| `AEGIS_SIM_DEVICE_KEY` | `sim-<lockerId>` | `clientId` = `aegis-locker-<deviceKey>` |
| `AEGIS_SIM_COMPARTMENTS` | `A1:1ae77ae3-…:1,A2:5c1d0b7e-…:2` | `code:compartmentId:cellAddress`, séparés par des virgules |
| `AEGIS_SIM_FIRMWARE_VERSION` | `0.1.0-sim` | `firmwareVersion` déclaré |
| `AEGIS_SIM_RESET_REASON` | `POWER_ON` | `resetReason` du premier `DEVICE_RESTARTED`, dans la liste contrôlée |
| `AEGIS_SIM_BOOT_COUNT_FILE` | `$XDG_STATE_HOME/aegis/hub-simulator/boot-count-<deviceKey>.json` | Fichier d'état de `bootCount`, hors du dépôt |
| `AEGIS_SIM_BOOT_COUNT` | aucun | `bootCount` imposé au premier démarrage (tests, remise à zéro délibérée) |
| `AEGIS_SIM_COMMAND_JOURNAL_FILE` | `$XDG_STATE_HOME/aegis/hub-simulator/command-journal-<deviceKey>.json` | Journal de déduplication des commandes, hors du dépôt |
| `AEGIS_SIM_UNLOCK_WINDOW_MS` | `15000` | Reverrouillage automatique après un déverrouillage (1000 à 120000) |
| `AEGIS_SIM_RFID_WINDOW_MS` | `3000` | Fenêtre du scan RFID après fermeture (100 à 10000) |
| `AEGIS_SIM_RSSI_DBM` | `-55` | `network.rssiDbm` du heartbeat |
| `AEGIS_SIM_ALLOW_INSECURE_REMOTE` | `false` | `true` autorise `mqtt:` vers un hôte non local, sur un réseau Docker isolé seulement (§4.2) |

Les identifiants complets par défaut sont A1 =
`1ae77ae3-8490-4f09-9412-a7816b77bff9` (exemple des documents 09 et 10) et
A2 = `5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10`. L'UUID de A2 provient d'une
fixture de conception (`docs/design/asset-lifecycle/prototype/data/fixture.js`) :
c'est une valeur de démonstration configurable, pas une donnée de référence
approuvée pour la base du backend. Aucun seed n'est encore défini; lorsqu'il le
sera, `AEGIS_SIM_COMPARTMENTS` doit reprendre ses identifiants, et non
l'inverse.

## Scénarios scriptables

`--scenario <fichier.json>` (un fichier `.json` d'au plus 256 Kio, situé sous le
répertoire courant) exécute une suite d'étapes, puis le processus
s'arrête si la dernière étape est `stop` ou `crash`, sinon il continue jusqu'au
signal d'arrêt :

```bash
npm start -- --scenario scenarios/heartbeats-then-crash.json
npm start -- --scenario scenarios/reconnect-restart-stop.json
npm start -- --scenario scenarios/late-messages-replay.json
npm start -- --scenario scenarios/checkout-with-backend.json
```

Les scénarios `*-local.json` fabriquent eux-mêmes leurs commandes
(`receiveCommand`) et tournent sans backend :

| Fichier | Couvre |
|---|---|
| `checkout-return-local.json` | Retrait (scan sain, vide) puis retour (tag lu 3 fois) |
| `negative-commands-local.json` | Mauvaise cellule, mauvais locker, commande expirée, redélivrance et seconde commande de la même opération (`ALREADY_APPLIED`), rejeu d'un accusé |
| `missing-tag-reader-fault-local.json` | Retour sans l'actif (scan vide), lecteur en panne, rejeu d'un scan |
| `restart-mid-operation-local.json` | Crash pendant l'actionnement puis `PREVIOUS_EXECUTION_UNCERTAIN`, redémarrage porte ouverte |
| `checkout-with-backend.json` | Attend le déverrouillage décidé par un vrai backend, puis retire l'actif et referme |

| Étape | Effet |
|---|---|
| `{ "wait": 21000 }` | Attendre en millisecondes |
| `{ "do": "waitOnline", "timeoutMs": 10000 }` | Attendre la connexion |
| `{ "do": "publishHeartbeat" }` | Heartbeat immédiat, hors cadence |
| `{ "do": "dropConnection" }` | Perte réseau : Last Will, puis reconnexion dans la même session |
| `{ "do": "restart", "resetReason": "WATCHDOG" }` | Arrêt brutal puis nouveau démarrage et `DEVICE_RESTARTED` |
| `{ "do": "updateCompartment", "code": "A2", "patch": { "connectionStatus": "DISCONNECTED" } }` | État de cellule rapporté par les heartbeats suivants |
| `{ "do": "replay", "type": "DEVICE_AVAILABILITY", "reason": "CONNECTION_LOST", "connectionsAgo": 1 }` | Republie tel quel un message déjà émis (voir ci-dessous) |
| `{ "do": "stop" }` / `{ "do": "crash" }` | Arrêt propre (`SHUTDOWN`) ou brutal (Last Will) |
| `{ "do": "restart", "offlineMs": 30000 }` | Hub éteint 30 s avant de redémarrer; les commandes publiées entre-temps attendent dans la session |
| `{ "do": "openDoor", "code": "A1", "forced": true }` | Ouverture de porte; `forced` pour une porte verrouillée |
| `{ "do": "closeDoor", "code": "A1" }` | Fermeture, reverrouillage, puis scan dans une opération |
| `{ "do": "putTag", "code": "A1", "identifier": "E200…", "readCount": 3 }` / `{ "do": "takeTag", … }` | Un tag entre dans la cellule ou en sort |
| `{ "do": "scanRfid", "code": "A2", "windowMs": 3000 }` | Scan explicite, terminé avant l'étape suivante |
| `{ "do": "updateCompartment", "code": "A1", "patch": { "readerStatus": "FAULTED" } }` | Panne de lecteur ou de cellule, sans événement |
| `{ "do": "setClock", "synchronized": false }` / `{ "do": "setScreen", "available": false }` | Horloge non synchronisée, écran coupé |
| `{ "do": "armFault", "fault": "CRASH_DURING_ACTUATION" }` | La prochaine commande valide fait planter le hub après l'actionnement (ou `LOCK_ACTUATION_FAILED`) |
| `{ "do": "waitUnlocked", "code": "A1", "timeoutMs": 600000 }` | Attendre qu'une commande déverrouille la cellule |
| `{ "do": "receiveCommand", "ref": "c1", "compartment": "A1", "operation": "op1", "expiresInMs": 120000 }` | Commande fabriquée localement, livrée comme par le broker; options `compartmentId` (UUID brut), `lockerId`, `issuedInMs`, `schemaVersion` |
| `{ "do": "redeliverCommand", "ref": "c1" }` | Redélivrance des mêmes octets |

`restart` passe par un arrêt brutal : le broker publie le Will de la connexion
interrompue, puis le nouveau démarrage prend `bootCount` + 1. Une étape qui suit
un `restart` ou un `dropConnection` et qui publie doit attendre `waitOnline`.

Les mêmes actions existent en API pour des tests TypeScript
(`src/index.ts`) : `new HubSimulator(defineConfig({ password }))`, puis
`start()`, `waitUntilOnline()`, `dropConnection()`, `restart()`,
`updateCompartment()`, `replay()`, `stop()`, `crash()`, `openDoor()`,
`closeDoor()`, `putTag()`, `takeTag()`, `scanRfid()`, `setClockSynchronized()`,
`setScreenAvailable()`, `armFault()`, `waitUntilUnlocked()` et `deliver()`; les
accesseurs `bootCount`, `deviceSessionId`, `connectionId`, `screen` et
`compartment(code)`; les événements `sent`, `delivered`, `willPrepared`,
`replayed`, `subscribed`, `inbound`, `actuated`, `screen` et `journalError`. Le
transport, l'horloge, le compteur de démarrages (`MemoryBootCounter` en test)
et le journal (`MemoryCommandJournal`) sont injectables. Le CLI journalise
`inbound`, `actuated` et `screen` sans token ni URI de QR.

### Rejeu d'un message déjà émis

`replay` republie, sur la connexion courante, le corps exact d'un message déjà
émis, Last Will compris : même `messageId`, même `sequence`, même `timestamp`,
même `connectionId` et même `bootCount`, avec son topic, sa QoS et son retain
d'origine. Il sert à piloter les tests d'ingestion du backend (PHY-01) : Will
tardif, heartbeat retardé, ancien `DEVICE_RESTARTED`, doublon.

| Champ | Rôle |
|---|---|
| `type` | Requis : tout type publié par le hub (`HEARTBEAT`, `DEVICE_AVAILABILITY`, `DEVICE_RESTARTED`, `COMMAND_ACKNOWLEDGED`, `DOOR_OPENED`, `RFID_SCAN_COMPLETED`...) |
| `reason` | `DEVICE_AVAILABILITY` seulement; `CONNECTION_LOST` désigne un Last Will préparé |
| `bootsAgo` | 0 = démarrage courant, 1 = précédent |
| `connectionsAgo` | Connexions établies seulement (celles qui ont publié `ONLINE`), comptées sur toute l'exécution, démarrages compris : 0 = la dernière (la connexion courante une fois connecté), 1 = la précédente. Une tentative échouée ne compte pas, même si la reconnexion en a demandé plusieurs. Réservé à `HEARTBEAT` et `DEVICE_AVAILABILITY`, seuls types porteurs d'un `connectionId` |

Sans `bootsAgo` ni `connectionsAgo`, le message le plus récent du type est
choisi; les deux ensemble sont refusés. Le simulateur garde, par connexion, le
Will, `ONLINE`, `SHUTDOWN` et le dernier heartbeat, et par démarrage
`DEVICE_RESTARTED`, sur les 32 dernières connexions établies et les 16 derniers
démarrages, ainsi que les 64 derniers événements opérationnels (accusés, porte,
serrure, RFID, écran). Les Wills des tentatives sans `ONLINE` sont gardés à part (32 au
plus), si bien qu'une longue panne n'évince aucune connexion établie; ils ne
sont pas désignables par `connectionsAgo`. Le rejeu exige d'être connecté et
échoue si rien ne correspond.

Exemples, dans `scenarios/late-messages-replay.json` :

- Will de la connexion précédente après une reconnexion :
  `{ "do": "replay", "type": "DEVICE_AVAILABILITY", "reason": "CONNECTION_LOST", "connectionsAgo": 1 }`;
- heartbeat d'une connexion fermée : `{ "do": "replay", "type": "HEARTBEAT", "connectionsAgo": 1 }`;
- `DEVICE_RESTARTED` du démarrage précédent : `{ "do": "replay", "type": "DEVICE_RESTARTED", "bootsAgo": 1 }`;
- doublon du dernier heartbeat : `{ "do": "replay", "type": "HEARTBEAT" }`.

Un message retenu rejoué (un ancien Will par exemple) remplace aussi le statut
retenu du broker, comme le ferait un Will livré en retard. Le rejeu ne fabrique
pas de message non conforme (valeur hors liste, champ manquant) : ces cas de
rejet relèvent des tests de l'ingestion.

## Vérification

```bash
npm run typecheck
npm test
AEGIS_MQTT_DEVICE_PASSWORD="$(grep '^AEGIS_MQTT_DEVICE_PASSWORD=' ../../infra/docker/.env.example | cut -d= -f2)" \
AEGIS_MQTT_API_PASSWORD="$(grep '^AEGIS_MQTT_API_PASSWORD=' ../../infra/docker/.env.example | cut -d= -f2)" \
  npm run test:integration
```

`npm test` vérifie la construction des messages contre le schéma 2.0 (champs,
types, topics, QoS, retain, `sequence`, `bootCount`, `connectionId`, `reason`,
`resetReason`, cadence de 10 s, backoff), la persistance de `bootCount` dans un
répertoire temporaire et le rejeu, avec un transport simulé et une horloge
contrôlée. Il couvre aussi chaque validation et chaque rejet de commande et
d'écran, la déduplication (redélivrance, seconde commande d'une opération,
redémarrage, nouveau processus), le crash pendant l'actionnement, les
événements de porte, serrure et RFID, le journal et les scénarios `*-local.json`.
Désactiver l'une ou l'autre des deux déduplications fait échouer ces tests.

`npm run test:integration` utilise le broker local, observé comme `aegis_api`,
fichier par fichier. Chaque test de commande efface au début et à la fin la
session persistante de son propre `clientId` :

- le CLI publie `ONLINE`, `DEVICE_RESTARTED` et trois heartbeats espacés de
  10 s, avec le même `bootCount` et le même `connectionId` que son Will; après
  `SIGKILL`, le broker publie ce Will `CONNECTION_LOST`, retenu;
- après une perte réseau, le Will publié porte l'ancien `connectionId`, distinct
  de celui du nouvel `ONLINE` et des heartbeats suivants; un arrêt propre donne
  un `SHUTDOWN` retenu et aucun Will;
- `restart()` augmente `bootCount` sur le fil, et un rejeu arrive octet pour
  octet avec son `messageId` d'origine;
- un mauvais secret est refusé;
- une commande publiée par `aegis_api` est acquittée une fois, sa redélivrance
  reçoit `ALREADY_APPLIED`; mauvaise cellule, mauvais locker, commande expirée
  et opération concurrente sont rejetées sans actionnement;
- un défi d'écran est affiché et acquitté sans son token; une instruction pour
  un autre démarrage est refusée;
- un crash pendant l'actionnement laisse la commande sans PUBACK : le broker la
  redélivre après le redémarrage et le hub répond
  `PREVIOUS_EXECUTION_UNCERTAIN`, sans second actionnement;
- le compte du device ne reçoit pas les commandes d'un autre locker.

Tous les simulateurs du locker fictif partagent son topic `commands`, et une
session persistante hors ligne garde les commandes publiées entre-temps. Les
tests SIM-01 ne vérifient donc que les faits de statut.

Sans les deux mots de passe dans l'environnement, ces tests sont ignorés.

## Points de contrat

Les points relevés par SIM-01 (liste de `resetReason`, raison `SHUTDOWN`,
`sequence` du Will, QoS de `DEVICE_RESTARTED`) sont tranchés par #63 (D1 à D7)
et appliqués ici. Restent hors du simulateur :

- les cas de rejet de l'ingestion (message 1.0, `resetReason` hors liste, champ
  manquant), que le simulateur n'émet pas;
- un silence de heartbeats sans Will sur une connexion ouverte (§23.5 point 10) :
  le simulateur ne sait pas suspendre ses heartbeats en gardant la connexion;
- `DEVICE_ERROR` (§13.2), dont `STORAGE_FAULT` après débordement de la file.

Choix faits par SIM-02 là où le document 10 ne tranche pas :

- un message non corrélable n'est pas publié. Pour une commande,
  `COMMAND_REJECTED` exige `operationId` et `compartmentId` (§20). Pour l'écran,
  le §20 exige bien un `DEVICE_ERROR` expurgé; il ne manque que l'`errorCode`
  correspondant dans la liste du §13.2, ce qui laisse ce cas non implémenté;
- une commande ou une instruction d'écran livrée avec le drapeau `retain` est
  ignorée sans réponse;
- la déduplication passe avant l'expiration : une redélivrance tardive reçoit le
  résultat connu, pas `COMMAND_EXPIRED`;
- un rejet est rejoué à l'identique, même si sa cause a disparu : le backend
  doit émettre une nouvelle commande;
- une autre commande d'une opération déjà exécutée reçoit le résultat de cette
  opération (`ALREADY_APPLIED` si elle a été acquittée) lorsqu'elle vise la même
  cellule; si elle vise une autre cellule, elle est rejetée `INVALID_PAYLOAD`,
  faute de raison dédiée, car `ALREADY_APPLIED` nommerait une cellule jamais
  ouverte. Une opération n'est « consommée » qu'une fois `EXECUTING` atteint;
  un rejet antérieur ne la consomme pas;
- le §16.1 ne fixe que des minimums de rétention; le plafond de 1024 entrées et
  le refus `INTERNAL_DEVICE_ERROR` d'un journal plein sont des choix du
  simulateur;
- le scan RFID après fermeture est lancé par le hub; sa fin clôt l'opération
  dans la cellule;
- un mauvais `lockerId`, un schéma non pris en charge ou une horloge non
  synchronisée sur l'écran sont rendus par `INVALID_DISPLAY_PAYLOAD` ou
  `SCREEN_UNAVAILABLE`, faute de raison dédiée;
- une révision ancienne reçoit `STALE_DISPLAY_REVISION` plutôt qu'un silence.
