# Recette manuelle — présence simulée et réservation

Cette fiche rejoue, sur ton poste, le parcours présence → réservation →
annulation → expiration avec le vrai PostgreSQL, le vrai broker, l'API et
l'application iOS. Les observations RFID viennent du simulateur de hub : la
recette valide le logiciel, **elle ne qualifie ni le lecteur RFID réel ni le
casier**.

Coche chaque case toi-même, seulement après l'avoir observée. Note tout écart
dans la section « Écarts » avec l'heure et la commande.

## Préparation

- [ ] Docker Desktop est démarré.
- [ ] Ton fichier d'environnement local (hors Git, par exemple
  `infra/docker/.env`) contient `AEGIS_MQTT_TEST_DEVICE_PASSWORD`. Sans cette
  variable, le broker démarre sans le compte du hub de test et les tests du
  broker échouent.
- [ ] La pile est recréée une fois, sans supprimer de volume, depuis la racine
  du dépôt :
  `docker compose --env-file infra/docker/.env -f infra/docker/compose.yaml up -d --wait`
- [ ] Une base dédiée à la recette existe, distincte de `aegis` et
  `aegis_test` (par exemple `aegis_recette_jimmy`). Ne réutilise pas ta base
  personnelle.
- [ ] Les mots de passe des comptes de démonstration et du broker sont dans
  ton fichier local, chargé par `set -a; . <fichier>; set +a`. Ils ne
  s'affichent pas et ne vont jamais dans Git, une issue ou un message.

## API et données

- [ ] L'API démarre sur la base de recette, avec
  `AEGIS_DB_NAME=<base de recette>`, `AEGIS_DEMO_ACCOUNTS_ENABLED=true`,
  `AEGIS_DEMO_LOCKER_ENABLED=true`, `AEGIS_MQTT_ENABLED=true` et
  `AEGIS_MQTT_API_PASSWORD` (voir `services/api/README.md`, sections
  « Comptes de démonstration » et « Ingestion MQTT »).
- [ ] `GET /api/v1/system/health` répond `status: UP`.
- [ ] Le catalogue de démonstration est semé :
  `python3 -I scripts/seed-demo-catalog.py` depuis `services/api`.

## Présence simulée

- [ ] Aucun autre simulateur du casier de démonstration ne tourne : deux
  instances partagent le même identifiant client MQTT et se déconnectent
  l'une l'autre.
- [ ] Le simulateur publie le scénario de présence depuis
  `tools/hub-simulator` :
  `npm start -- --scenario scenarios/presence-demo-local.json`.
  Il reste 30 secondes en ligne sans scanner, pose et scanne le tag de A1
  puis celui de A2, publie ses heartbeats pendant 10 minutes, puis s'arrête.
  La présence ne vaut que pendant cette connexion : relance le scénario pour
  une nouvelle série.
- [ ] Dans les 30 premières secondes, avant tout scan :
  `python3 -I scripts/check-presence-reservation.py --phase before`
  affiche le hub `ONLINE`, A1 `UNKNOWN` et la réservation de A1 refusée
  (`422 ASSET_NOT_READY [UNKNOWN_PHYSICAL_STATE]`).
- [ ] Phase en ligne, après les scans, depuis `services/api`, avec
  `AEGIS_RECIPE_DB_NAME` et `AEGIS_API_URL` exportés :
  `python3 -I scripts/check-presence-reservation.py`
  Résultat attendu : chaque étape affiche `ok` et le script se termine par
  « Parcours conforme ». Il échoue si l'API, le broker ou PostgreSQL manque :
  rien n'est ignoré.

Le script vérifie, dans l'ordre :

| Étape | Attendu |
|---|---|
| Connexion du hub | `ONLINE` |
| A1 (`AEG-DEMO-001`) | `PRESENT`, `READY`, `AVAILABLE` |
| A2 (`AEG-DEMO-002`) | `BLOCKED`, `[CALIBRATION_EXPIRED]` |
| Réservation de A1 | `201 ACTIVE`, actions `[CANCEL]` |
| Annulation, puis rejeu de la même clé | `200 CANCELLED`, même réponse |
| Audit de la réservation | `RESERVATION_CREATED`, `RESERVATION_CANCELLED` |
| Réservation de 20 s | expirée par le serveur en moins d'une minute, sans changer l'heure du Mac |
| Réservation de A2 | `422 ASSET_NOT_READY [CALIBRATION_EXPIRED]` |

## Porte ouverte après le scan

- [ ] Le scénario de présence est arrêté. Je lance
  `npm start -- --scenario scenarios/presence-door-after-scan-local.json`,
  puis aussitôt, depuis `services/api` :
  `python3 -I scripts/check-presence-reservation.py --phase door`.
  Le scénario scanne A1 et A2, ouvre la porte de A1 de force, la referme,
  puis scanne A1 de nouveau. Le script suit la porte par l'état du casier.
- [ ] Porte ouverte : A1 `UNKNOWN` et sa réservation refusée
  (`422 ASSET_NOT_READY [UNKNOWN_PHYSICAL_STATE]`); A2 garde sa propre
  preuve (`PRESENT`, `BLOCKED [CALIBRATION_EXPIRED]`).
- [ ] Porte refermée, sans nouveau scan : A1 reste `UNKNOWN` et sa réservation
  reste refusée.
- [ ] Après le nouveau scan : A1 `PRESENT`, `READY`.

## Preuves MQTT (facultatif)

- [ ] `npm start -- --scenario scenarios/late-messages-replay.json` rejoue des
  messages déjà publiés. Chaque rejeu est ignoré et audité
  `MQTT_MESSAGE_DUPLICATE_IGNORED`, sans nouvelle ligne de message.

## Application iOS

Avec l'application pointée vers la même API, connecté comme technicien :

- [ ] A1 apparaît prêt; A2 apparaît bloqué pour calibration, sans bouton
  de réservation.
- [ ] Je réserve A1; la réservation apparaît dans « Mon activité ».
- [ ] J'annule; « Mon activité » n'affiche plus de réservation et A1 redevient
  disponible.
- [ ] Aucune action n'est proposée si le serveur ne l'a pas listée.

## Hub arrêté

- [ ] J'arrête le simulateur et j'attends au moins 35 secondes.
- [ ] `python3 -I scripts/check-presence-reservation.py --phase offline`
  affiche le hub hors ligne ou inconnu, A1 `UNKNOWN` et la réservation de A1
  refusée (`422 ASSET_NOT_READY [UNKNOWN_PHYSICAL_STATE]`).
- [ ] Dans Aegis Manager, la page « Casiers » affiche « Hors ligne ».
- [ ] Dans l'application iOS, A1 n'est plus réservable.

## Non couvert par cette fiche

- Le garde qui empêche une expiration de libérer un actif engagé dans un
  retrait incertain ou un prêt : testé sur fixtures seulement.
- Le RFID réel, le casier, la serrure et le firmware.

## Question pour le firmware

- [ ] Le firmware publie-t-il des lectures RFID hors d'une opération (inventaire
  périodique ou au démarrage) ? La présence observée en dépend. Réponse :

## Écarts

| Heure | Étape | Observé | Commande |
|---|---|---|---|
| | | | |
