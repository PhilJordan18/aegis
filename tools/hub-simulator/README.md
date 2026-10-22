# Simulateur du hub Aegis (SIM-01)

Outil Node/TypeScript autonome qui se comporte comme le hub ESP32 d'un locker
(Aegis Locker Node) face au broker MQTT, afin de développer et tester le backend
sans le matériel. Il réimplémente le [contrat MQTT](../../docs/cahier-conception/10-contrats-mqtt.md)
à partir de la documentation, sans partager de code avec l'API Java : un écart
entre les deux lectures du contrat doit apparaître en intégration.

Cette tranche (P0.0, issue #15, mise au schéma 2.0 par #63) couvre :

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

Hors périmètre, prévus par SIM-02 (#39) : commandes `UNLOCK_COMPARTMENT`,
accusés, écran (`display`), porte, serrure et RFID. Le simulateur ne s'abonne
encore à aucun topic et ne prend aucune décision métier.

## Prérequis

- Node 22.18 ou plus récent (exécution directe du TypeScript; vérifié avec Node 24.13 et npm 11.8);
- la pile locale démarrée depuis la racine du dépôt :

  ```bash
  docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml up -d --wait
  ```

## Lancer le simulateur

Depuis `tools/hub-simulator/` :

```bash
npm ci
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

`--scenario <fichier.json>` exécute une suite d'étapes, puis le processus
s'arrête si la dernière étape est `stop` ou `crash`, sinon il continue jusqu'au
signal d'arrêt :

```bash
npm start -- --scenario scenarios/heartbeats-then-crash.json
npm start -- --scenario scenarios/reconnect-restart-stop.json
npm start -- --scenario scenarios/late-messages-replay.json
```

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

`restart` passe par un arrêt brutal : le broker publie le Will de la connexion
interrompue, puis le nouveau démarrage prend `bootCount` + 1. Une étape qui suit
un `restart` ou un `dropConnection` et qui publie doit attendre `waitOnline`.

Les mêmes actions existent en API pour des tests TypeScript
(`src/index.ts`) : `new HubSimulator(defineConfig({ password }))`, puis
`start()`, `waitUntilOnline()`, `dropConnection()`, `restart()`,
`updateCompartment()`, `replay()`, `stop()`, `crash()`, les accesseurs
`bootCount`, `deviceSessionId` et `connectionId`, et les événements `sent`,
`delivered`, `willPrepared` et `replayed`. Le transport, l'horloge et le
compteur de démarrages (`MemoryBootCounter` en test) sont injectables.

### Rejeu d'un message déjà émis

`replay` republie, sur la connexion courante, le corps exact d'un message déjà
émis, Last Will compris : même `messageId`, même `sequence`, même `timestamp`,
même `connectionId` et même `bootCount`, avec son topic, sa QoS et son retain
d'origine. Il sert à piloter les tests d'ingestion du backend (PHY-01) : Will
tardif, heartbeat retardé, ancien `DEVICE_RESTARTED`, doublon.

| Champ | Rôle |
|---|---|
| `type` | Requis : `HEARTBEAT`, `DEVICE_AVAILABILITY` ou `DEVICE_RESTARTED` |
| `reason` | `DEVICE_AVAILABILITY` seulement; `CONNECTION_LOST` désigne un Last Will préparé |
| `bootsAgo` | 0 = démarrage courant, 1 = précédent |
| `connectionsAgo` | Connexions établies seulement (celles qui ont publié `ONLINE`), comptées sur toute l'exécution, démarrages compris : 0 = la dernière (la connexion courante une fois connecté), 1 = la précédente. Une tentative échouée ne compte pas, même si la reconnexion en a demandé plusieurs. Interdit pour `DEVICE_RESTARTED`, qui n'a pas de `connectionId` |

Sans `bootsAgo` ni `connectionsAgo`, le message le plus récent du type est
choisi; les deux ensemble sont refusés. Le simulateur garde, par connexion, le
Will, `ONLINE`, `SHUTDOWN` et le dernier heartbeat, et par démarrage
`DEVICE_RESTARTED`, sur les 32 dernières connexions établies et les 16 derniers
démarrages. Les Wills des tentatives sans `ONLINE` sont gardés à part (32 au
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
contrôlée. `npm run test:integration` utilise le broker local, observé comme
`aegis_api` :

- le CLI publie `ONLINE`, `DEVICE_RESTARTED` et trois heartbeats espacés de
  10 s, avec le même `bootCount` et le même `connectionId` que son Will; après
  `SIGKILL`, le broker publie ce Will `CONNECTION_LOST`, retenu;
- après une perte réseau, le Will publié porte l'ancien `connectionId`, distinct
  de celui du nouvel `ONLINE` et des heartbeats suivants; un arrêt propre donne
  un `SHUTDOWN` retenu et aucun Will;
- `restart()` augmente `bootCount` sur le fil, et un rejeu arrive octet pour
  octet avec son `messageId` d'origine;
- un mauvais secret est refusé.

Sans les deux mots de passe dans l'environnement, ces tests sont ignorés.

## Points de contrat

Les points relevés par SIM-01 (liste de `resetReason`, raison `SHUTDOWN`,
`sequence` du Will, QoS de `DEVICE_RESTARTED`) sont tranchés par #63 (D1 à D7)
et appliqués ici. Restent hors du simulateur :

- les cas de rejet de l'ingestion (message 1.0, `resetReason` hors liste, champ
  manquant), que le simulateur n'émet pas;
- un silence de heartbeats sans Will sur une connexion ouverte (§23.5 point 10) :
  le simulateur ne sait pas suspendre ses heartbeats en gardant la connexion.
