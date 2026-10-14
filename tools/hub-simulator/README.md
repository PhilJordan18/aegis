# Simulateur du hub Aegis (SIM-01)

Outil Node/TypeScript autonome qui se comporte comme le hub ESP32 d'un locker
(Aegis Locker Node) face au broker MQTT, afin de développer et tester le backend
sans le matériel. Il réimplémente le [contrat MQTT](../../docs/cahier-conception/10-contrats-mqtt.md)
à partir de la documentation, sans partager de code avec l'API Java : un écart
entre les deux lectures du contrat doit apparaître en intégration.

Cette tranche (P0.0, issue #15) couvre :

- `DEVICE_AVAILABILITY` `ONLINE` publié à chaque connexion, QoS 1, `retain=true` (§15.1);
- un Last Will `OFFLINE` enregistré avant chaque connexion, QoS 1, `retain=true` (§15.2);
- `DEVICE_RESTARTED` une seule fois par démarrage, sur `events`, QoS 1 (§13.1);
- un `HEARTBEAT` immédiat après connexion puis toutes les 10 s, QoS 0, sans retain (§14);
- l'enveloppe commune du §8.1 : `deviceSessionId` neuf à chaque démarrage,
  `sequence` croissante dans la session, `messageId` neuf pour chaque fait;
- MQTT 3.1.1, `cleanSession=false`, `keepAlive=30`, `clientId`
  `aegis-locker-<deviceKey>` (§4.1, §7.1);
- la reconnexion avec backoff 1, 2, 4, 8, 16 puis 30 s et gigue (§18), qui
  republie `ONLINE` et un heartbeat sans redéclarer de redémarrage.

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
| `Ctrl+C` ou `SIGTERM` | `OFFLINE` explicite puis `DISCONNECT`; le broker abandonne le Last Will |
| `kill -9` | Fermeture brutale; le broker publie le Last Will `OFFLINE` préparé au démarrage |

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
| `AEGIS_SIM_RESET_REASON` | `POWER_ON` | `resetReason` du premier `DEVICE_RESTARTED` |
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
```

| Étape | Effet |
|---|---|
| `{ "wait": 21000 }` | Attendre en millisecondes |
| `{ "do": "waitOnline", "timeoutMs": 10000 }` | Attendre la connexion |
| `{ "do": "publishHeartbeat" }` | Heartbeat immédiat, hors cadence |
| `{ "do": "dropConnection" }` | Perte réseau : Last Will, puis reconnexion dans la même session |
| `{ "do": "restart", "resetReason": "WATCHDOG" }` | Arrêt brutal puis nouveau démarrage et `DEVICE_RESTARTED` |
| `{ "do": "updateCompartment", "code": "A2", "patch": { "connectionStatus": "DISCONNECTED" } }` | État de cellule rapporté par les heartbeats suivants |
| `{ "do": "stop" }` / `{ "do": "crash" }` | Arrêt propre ou brutal |

Les mêmes actions existent en API pour des tests TypeScript
(`src/index.ts`) : `new HubSimulator(defineConfig({ password }))`, puis
`start()`, `waitUntilOnline()`, `dropConnection()`, `restart()`,
`updateCompartment()`, `stop()`, `crash()` et les événements `sent`,
`delivered` et `willPrepared`. Le transport et l'horloge sont injectables.

## Vérification

```bash
npm run typecheck
npm test
AEGIS_MQTT_DEVICE_PASSWORD="$(grep '^AEGIS_MQTT_DEVICE_PASSWORD=' ../../infra/docker/.env.example | cut -d= -f2)" \
AEGIS_MQTT_API_PASSWORD="$(grep '^AEGIS_MQTT_API_PASSWORD=' ../../infra/docker/.env.example | cut -d= -f2)" \
  npm run test:integration
```

`npm test` vérifie la construction des messages contre le contrat (champs,
types, topics, QoS, retain, séquence, cadence de 10 s, backoff) avec un
transport simulé et une horloge contrôlée. `npm run test:integration` utilise
le broker local : il lance le CLI, observe `ONLINE`, `DEVICE_RESTARTED` et trois
heartbeats espacés de 10 s comme `aegis_api`, tue le processus avec `SIGKILL`
et vérifie le Last Will `OFFLINE` retenu; il vérifie aussi la reconnexion
après perte réseau et le refus d'un mauvais secret. Sans les deux mots de passe
dans l'environnement, ces tests sont ignorés.

## Points de contrat à confirmer

- `resetReason` n'a pas de liste contrôlée; seul `WATCHDOG` apparaît au §13.1.
  `POWER_ON` est une valeur provisoire du simulateur.
- L'`OFFLINE` d'un arrêt propre n'a pas de `reason` dédiée; le simulateur
  réutilise `CONNECTION_LOST`, seule valeur `OFFLINE` du contrat.
- Le Last Will prend la `sequence` 0 car il est préparé avant la connexion;
  `ONLINE` prend donc 1, alors que les exemples du §15 montrent 0 pour les deux.
- `DEVICE_RESTARTED` n'apparaît pas dans le tableau QoS du §7; il suit la règle
  des autres faits du topic `events` (QoS 1, sans retain).
