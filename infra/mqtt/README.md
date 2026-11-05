# Broker MQTT Aegis (INF-01)

Configuration Mosquitto du P0 : un écouteur TLS pour le hub réel, un écouteur
non chiffré réservé au simulateur local, un compte backend distinct et un compte
par hub limité à son propre locker. Ce guide applique le
[contrat MQTT](../../docs/cahier-conception/10-contrats-mqtt.md) §4.2, §4.3 et §6
et l'ADR-004 du [registre](../../docs/cahier-conception/13-registre-adrs-proposes.md);
il ne modifie ni les topics, ni les payloads, ni les QoS.

Toutes les commandes se lancent depuis la racine du dépôt.

## Écouteurs

| Port | Transport | Publication sur l'hôte | Clients |
|---|---|---|---|
| 1883 | MQTT non chiffré | `127.0.0.1` seulement, jamais modifiable | Simulateur local, API sur la même machine ou le réseau Compose |
| 8883 | MQTT sur TLS 1.2 ou 1.3, certificat serveur vérifié | `AEGIS_MQTT_TLS_BIND`, `127.0.0.1` par défaut | Hub ESP32 réel; simulateur pour les essais TLS |

Le hub réel n'utilise **jamais** le port 1883, même au laboratoire (§4.2) :
le QR transporte un secret éphémère. Les deux écouteurs partagent le même
fichier de mots de passe et la même ACL : un compte a les mêmes droits en clair
et en TLS. Le mTLS n'est pas exigé au P0; le hub s'authentifie par son nom
d'utilisateur et son secret au-dessus de TLS.

| Fichier | Rôle |
|---|---|
| `mosquitto.conf` | Réglages communs et écouteur 1883 |
| `tls/listener-tls.conf` | Écouteur 8883, chargé seulement avec `compose.tls.yaml` |
| `no-tls/` | Dossier vide monté par défaut à la place de `tls/` |
| `acl` | ACL du §6 |
| `certs/generate-lab-certs.sh` | CA de labo et certificat du broker |
| `provision-device.sh` | Création, rotation et révocation d'un compte de hub |
| `verify-broker.sh` | Vérification reproductible TLS, authentification et ACL |

## Démarrer

Sans certificat, la pile reste celle du simulateur : rien ne change pour qui
n'a pas besoin du hub réel.

```bash
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml up -d --wait
```

Avec l'écouteur TLS, une fois les certificats générés (section suivante),
ajouter le fichier `compose.tls.yaml` à **toutes** les commandes Compose :

```bash
docker compose --env-file infra/docker/.env.example \
  -f infra/docker/compose.yaml -f infra/docker/compose.tls.yaml up -d --wait
```

Ce second fichier remplace le dossier vide `no-tls/` par `tls/`, publie 8883 et
ajoute `mqtt-tls-init`. Ce service copie le certificat et la clé dans le volume
`mqtt_tls` avec le propriétaire du processus Mosquitto (uid 1883) et le mode
`0400` : la clé reste en `0600` chez vous, sans devoir la rendre lisible par
tous. Si un fichier manque, `mqtt-tls-init` échoue avec un message explicite et
le broker ne démarre pas sans TLS par erreur.

Un fichier séparé plutôt qu'un profil Compose : un profil peut ajouter un
service, mais pas modifier les montages et ports de `mosquitto`.

## Certificats de labo

```bash
infra/mqtt/certs/generate-lab-certs.sh <nom-de-l-ordinateur>.local <ip-lan-de-l-ordinateur>
```

Le script crée une CA de labo lors du premier appel, puis émet le certificat du
broker signé par cette CA. Chaque argument devient une entrée
`subjectAltName` (IP ou DNS); `localhost`, `127.0.0.1` et `mosquitto` (nom du
service Compose) sont toujours ajoutés. Le hub vérifie le nom ou l'IP qu'il
utilise pour joindre le broker : il doit figurer dans cette liste.

| Choix | Valeur |
|---|---|
| Clés | RSA 2048, SHA-256 : vérification rapide par mbedTLS sur l'ESP32, acceptée par Mosquitto, Node, Java et iOS |
| CA | 1095 jours, `CA:TRUE`, `pathlen:0` |
| Certificat serveur | 397 jours, `extendedKeyUsage=serverAuth` |
| Version TLS | 1.2 minimum, 1.3 acceptée |

Fichiers produits dans `infra/mqtt/certs/lab/`, ignoré par Git (`--out` pour
un autre dossier) :

| Fichier | Contenu | Diffusion |
|---|---|---|
| `ca.crt` | Certificat public de la CA | Flashé sur le hub, donné aux clients (simulateur, API) |
| `private/ca.key` | Clé privée de la CA | Ne quitte jamais cet ordinateur |
| `broker/ca.crt`, `broker/server.crt`, `broker/server.key` | Matériel du broker | Monté en lecture seule par `mqtt-tls-init` seulement |

Seul `ca.crt` est flashé sur le hub; jamais une clé privée. Le script refuse de
remplacer une CA existante sans `--force-ca`, et refuse un `--out` situé dans le
dépôt mais non ignoré par Git (`--allow-unignored` pour passer outre en
connaissance de cause). Ne jamais contourner une erreur
TLS en désactivant la vérification du certificat.

## Exposer 8883 au hub sur le réseau local

Par défaut, 8883 n'écoute que sur `127.0.0.1`. Les mots de passe de
`.env.example` sont publiés dans Git : sur le réseau local, n'importe qui
pourrait se connecter comme `aegis_api` et publier des commandes. Pour le hub
réel :

1. créer le fichier local ignoré et y générer des mots de passe forts :

   ```bash
   cp infra/docker/.env.example infra/docker/.env
   sed -i.bak \
     -e "s/^AEGIS_MQTT_API_PASSWORD=.*/AEGIS_MQTT_API_PASSWORD=$(openssl rand -hex 32)/" \
     -e "s/^AEGIS_MQTT_DEVICE_PASSWORD=.*/AEGIS_MQTT_DEVICE_PASSWORD=$(openssl rand -hex 32)/" \
     infra/docker/.env && rm infra/docker/.env.bak
   ```

   Remplacer aussi `AEGIS_DB_PASSWORD` (voir `services/api/README.md`);
2. générer le certificat avec le nom `.local` de l'ordinateur (préféré, voir
   « Limites ») et, au besoin, son IP LAN;
3. dans `infra/docker/.env`, définir `AEGIS_MQTT_TLS_BIND=<ip-lan-de-l-ordinateur>`
   (ou `0.0.0.0` pour toutes les interfaces);
4. redémarrer avec ce fichier, puis vérifier :

   ```bash
   docker compose --env-file infra/docker/.env \
     -f infra/docker/compose.yaml -f infra/docker/compose.tls.yaml up -d --wait
   infra/mqtt/verify-broker.sh
   ```

   et autoriser le port 8883 dans le pare-feu de l'ordinateur pour ce réseau
   seulement;
5. configurer le hub avec `mqtts://<même nom ou IP>:8883`.

`mqtt-tls-init` refuse de démarrer si `AEGIS_MQTT_TLS_BIND` n'est pas une
adresse de boucle locale alors qu'un mot de passe MQTT finit encore par
`change-me`; `verify-broker.sh` échoue dans le même cas. Aucun des deux
n'affiche les mots de passe.

Si l'IP DHCP change, réémettre le certificat serveur avec la nouvelle IP
(rotation ci-dessous) ou utiliser le nom `.local`. Le port 1883 reste sur
`127.0.0.1` dans tous les cas : `verify-broker.sh` échoue s'il est publié
ailleurs.

## Comptes et ACL

| Compte | Création | Droits (§6) |
|---|---|---|
| `aegis_api` | `mqtt-auth-init`, `AEGIS_MQTT_API_PASSWORD` | Publie `commands` et `display`, lit `events` et `status` de tous les lockers |
| `d46a74ae-39dc-460b-8af0-38fc791b376a` | `mqtt-auth-init`, `AEGIS_MQTT_DEVICE_PASSWORD` | Locker fictif du simulateur |
| `<lockerId>` d'un hub | `provision-device.sh` | Lit `commands` et `display`, publie `events` et `status`, de son seul locker |

Le nom d'utilisateur d'un hub est son `lockerId` (UUID canonique en
minuscules). L'ACL utilise des règles `pattern` avec `%u` : un nouveau hub ne
demande donc aucune modification de l'ACL, et un hub ne peut ni lire ni écrire
les topics d'un autre locker, ni publier `commands` ou `display`.

Un abonnement par wildcard (`+`, `#`, `$SYS/#`) n'est **pas** refusé :
Mosquitto 2.1.2 l'accepte (SUBACK accordé), puis filtre chaque message selon
l'ACL, de sorte qu'il ne livre rien d'autre que les topics permis. Le §6.1 du
document 10 (« ne peut pas utiliser un wildcard ») est donc tenu par l'effet,
pas par un refus d'abonnement; sa formulation est à préciser dans DOC-03 (#63).

Mosquitto applique aussi les règles `pattern` à `aegis_api`, ce qui lui
donnerait `aegis/v1/lockers/aegis_api/...`. Quatre règles `topic deny` exactes
retirent ces droits : `aegis_api` ne peut publier ni sur `events` ou `status`
d'un locker, ni sur `aegis/v1/lockers/aegis_api/events` ou `status` (vérifié).
Un `deny` par wildcard (`aegis/v1/lockers/aegis_api/#`) a été écarté : sur
2.1.2 il bloquait aussi la livraison sur l'abonnement `+/events` du backend.
L'ingestion backend doit malgré tout rejeter tout `lockerId` de topic qui n'est
pas un UUID canonique (§5 règle 1).

`mqtt-auth-init` ajoute ou met à jour seulement ses deux comptes : un nouveau
lancement de la pile conserve les hubs provisionnés.

## Provisionner, faire tourner et révoquer un hub

La pile doit avoir été démarrée au moins une fois (volume `mqtt_auth`).

```bash
infra/mqtt/provision-device.sh <lockerId>            # création ou nouveau secret
infra/mqtt/provision-device.sh --revoke <lockerId>   # suppression du compte
```

Le script valide le `lockerId`, génère un secret aléatoire de 256 bits,
l'écrit avec `mosquitto_passwd` dans le volume du broker (transmis par l'entrée
standard, jamais en argument), recharge Mosquitto par `SIGHUP`, puis affiche le
secret **une seule fois** sur la sortie standard. Le copier directement dans le
stockage non volatil (NVS) du hub; ne jamais l'enregistrer dans le dépôt, un
ticket ou un journal. Les messages d'état vont sur la sortie d'erreur. Le
fichier Compose utilisé est `infra/docker/.env` s'il existe, sinon
`.env.example`; `AEGIS_ENV_FILE` force un autre fichier.

Le rechargement ne coupe pas les autres clients. Après une révocation ou un
nouveau secret, Mosquitto 2.1 déconnecte la session ouverte avec l'ancien
secret et refuse sa reconnexion (constaté avec la version épinglée).

## Rotation

| Élément | Procédure | Effet |
|---|---|---|
| Secret d'un hub | `provision-device.sh <lockerId>`, puis flasher le nouveau secret dans la NVS du hub | L'ancien secret est refusé immédiatement; le `lockerId` ne change pas (§4.3) |
| Secret `aegis_api` | Modifier `AEGIS_MQTT_API_PASSWORD` dans `infra/docker/.env`, lancer `docker compose … up -d --wait --force-recreate --no-deps mqtt-auth-init`, puis `docker compose … kill -s SIGHUP mosquitto`, puis redémarrer l'API avec le nouveau secret | L'ancien secret est refusé dès le rechargement |
| Secret du simulateur | Même procédure avec `AEGIS_MQTT_DEVICE_PASSWORD` | Idem |
| Certificat serveur | `generate-lab-certs.sh <noms>` (la CA est conservée), `docker compose … -f infra/docker/compose.tls.yaml up -d --no-deps --force-recreate mqtt-tls-init`, puis `docker compose … kill -s SIGHUP mosquitto` | Mosquitto 2.1 recharge le certificat sans redémarrer; aucun reflashage du hub |
| CA | `generate-lab-certs.sh --force-ca <noms>`, recréer `mqtt-tls-init` et `mosquitto`, puis flasher le nouveau `ca.crt` sur chaque hub et le redonner aux clients | Tous les clients qui gardent l'ancienne CA sont refusés : planifier un arrêt du hub |

Dans ce tableau, `docker compose …` désigne
`docker compose --env-file infra/docker/.env -f infra/docker/compose.yaml`,
complété par `-f infra/docker/compose.tls.yaml` quand TLS est actif.
`--force-recreate` sur `mosquitto` fonctionne aussi, mais perd les sessions et
les messages retenus (voir « Limites »).

## Vérifier

```bash
infra/mqtt/verify-broker.sh                     # CA par défaut : infra/mqtt/certs/lab/ca.crt
infra/mqtt/verify-broker.sh chemin/vers/ca.crt
```

La pile doit tourner avec `compose.tls.yaml`. Le script crée deux hubs
temporaires, exécute les clients Mosquitto dans un conteneur du réseau Compose,
puis révoque les deux hubs. Il vérifie :

- 1883 et 8883 publiés sur `127.0.0.1` (avertissement si 8883 est exposé);
- 8883 hors boucle locale seulement avec des mots de passe qui ne sont pas ceux
  de l'exemple;
- connexion TLS acceptée avec la CA de labo; refusée avec une autre CA, avec un
  nom absent du certificat et en clair sur 8883;
- poignée de main TLS 1.1 refusée par le broker (alerte `protocol_version`,
  sondée avec `openssl s_client` depuis l'hôte);
- connexion anonyme (1883 et 8883), mauvais secret et secret d'un autre hub refusés;
- le hub publie ses `events` et `status` et reçoit ses `commands` et `display`;
- le hub ne publie ni ses `commands` ni ses `display`, ni sur les topics d'un
  autre locker, et ne lit aucun topic d'un autre locker, même par `+`,
  `aegis/v1/lockers/#` ou `#`;
- `aegis_api` ne publie ni `events` ni `status`, y compris sur
  `aegis/v1/lockers/aegis_api/...`.

Mosquitto abandonne en silence une publication non autorisée et accorde même un
abonnement à `#` : un SUBACK ne prouve rien. Chaque refus est donc prouvé par
un message qui n'arrive jamais chez un observateur, à côté d'un message témoin
qui, lui, arrive.

Le simulateur se connecte aussi en TLS, depuis `tools/hub-simulator/` :

```bash
export AEGIS_MQTT_DEVICE_PASSWORD="$(grep '^AEGIS_MQTT_DEVICE_PASSWORD=' ../../infra/docker/.env.example | cut -d= -f2)"
export AEGIS_MQTT_API_PASSWORD="$(grep '^AEGIS_MQTT_API_PASSWORD=' ../../infra/docker/.env.example | cut -d= -f2)"
AEGIS_MQTT_URL=mqtts://localhost:8883 AEGIS_MQTT_CA_FILE=../../infra/mqtt/certs/lab/ca.crt npm start
AEGIS_MQTT_URL=mqtts://localhost:8883 AEGIS_MQTT_CA_FILE=../../infra/mqtt/certs/lab/ca.crt npm run test:integration
```

Sans `AEGIS_MQTT_CA_FILE`, le simulateur refuse la CA de labo
(`self-signed certificate in certificate chain`).

## Limites

- Linux avec Docker antérieur à 28 : sur un réseau bridge non `internal`, le
  port 1883 du conteneur peut être joignable depuis le LAN malgré la publication
  sur `127.0.0.1`. Docker Desktop (macOS, Windows) n'est pas concerné; utiliser
  Docker 28 ou plus récent sur Linux.
- ESP32 : préférer le nom `.local` aux entrées IP du certificat (l'IP DHCP
  change, et la vérification d'IP dépend de la bibliothèque). Si les dates du
  certificat sont vérifiées par mbedTLS, le hub doit obtenir l'heure par SNTP
  avant d'ouvrir la connexion TLS.

- `persistence false` : un redémarrage du broker perd les sessions
  `cleanSession=false` du hub (§7.1), les QoS 1 en attente et les messages
  `DEVICE_AVAILABILITY` retenus. Le hub se réabonne à la reconnexion (§7.1) et
  republie `ONLINE`, mais une commande publiée pendant le redémarrage est perdue
  et doit être reprise par l'outbox. Préférer les rechargements par `SIGHUP`
  ci-dessus à un redémarrage.
- Mosquitto avertit que `acl` est lisible par tous (montage en lecture seule
  du fichier versionné); une version future pourrait refuser ce mode.
- Le certificat et les secrets sont ceux d'un labo : pas de révocation par CRL;
  une CA compromise impose la rotation complète de la CA.
