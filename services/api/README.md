# Aegis Control — démarrage local

Ce socle couvre FND-01, FND-02A et la partie backend d'IAM-01/02. Il fournit
PostgreSQL, un broker MQTT local authentifié pour le simulateur, Spring Boot,
Flyway, `GET /api/v1/system/health`, la connexion par comptes préparés
(`POST /api/v1/auth/login`, `GET /api/v1/auth/me`) et les contrôles de rôle et
de niveau d'accès côté serveur. Il n'implémente pas encore les actifs,
l'ingestion MQTT ni les clients Web et iOS.

## Prérequis

- Docker Desktop démarré et `docker compose` disponible;
- JDK 21 ou plus récent; le projet compile pour Java 21;
- ports locaux 5432, 1883 et 8080 libres.

Maven n'a pas besoin d'être installé : `./mvnw` télécharge sa version contrôlée.

## Essai immédiat, avec les identifiants fictifs de l'exemple

Depuis la racine du dépôt :

```bash
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml up -d --wait
cd services/api
AEGIS_DB_PASSWORD=local-demo-db-password-change-me ./mvnw test
```

Les tests se connectent à PostgreSQL : Docker doit donc être lancé avant
`./mvnw test`. Ils créent leurs propres bases temporaires (voir « Bases
PostgreSQL des tests ») et génèrent leur propre clé de signature et leurs
propres mots de passe de test.

Pour lancer l'API, choisir deux mots de passe de démonstration de 12 à 72
octets, jamais réutilisés ailleurs :

```bash
export AEGIS_DB_PASSWORD=local-demo-db-password-change-me
export AEGIS_JWT_SECRET="$(openssl rand -base64 48)"
export AEGIS_DEMO_ACCOUNTS_ENABLED=true
export AEGIS_DEMO_ADMIN_PASSWORD='choisir-un-mot-de-passe-admin'
export AEGIS_DEMO_TECHNICIAN_PASSWORD='choisir-un-mot-de-passe-technicien'
./mvnw spring-boot:run
```

Dans un autre terminal, où `AEGIS_DEMO_TECHNICIAN_PASSWORD` est aussi exporté :

```bash
curl http://127.0.0.1:8080/api/v1/system/health
curl -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"technician@aegis.demo\",\"password\":\"$AEGIS_DEMO_TECHNICIAN_PASSWORD\"}"
curl http://127.0.0.1:8080/api/v1/auth/me -H 'Authorization: Bearer <accessToken reçu>'
```

La santé doit contenir `status: UP`, `service: aegis-control`, `version:
0.1.0` et un instant UTC. La connexion retourne `accessToken`, `tokenType:
Bearer`, `expiresIn: 3600`, `expiresAt` et le profil minimal; `/auth/me`
retourne le même profil.

Pour un usage prolongé, copier `infra/docker/.env.example` vers
`infra/docker/.env`, remplacer les trois mots de passe et passer ce fichier à
`--env-file`. Exporter également `AEGIS_DB_PASSWORD` dans le terminal de
l'API. Ce fichier local est ignoré par Git. Un changement de mot de passe de
la base déjà initialisée ne modifie pas automatiquement le compte PostgreSQL
stocké dans son volume : planifier la rotation séparément.

## Bases PostgreSQL des tests

Garanties du harnais `src/test/java/ca/aegis/control/support/TestDatabases.java` :

- chaque exécution nomme ses bases `aegis_test_<identifiant aléatoire>_<usage><n>`;
- une base qui existe déjà n'est jamais réutilisée ni supprimée : sa création
  échoue et le test s'arrête;
- seules les bases créées par l'exécution en cours sont supprimées, après
  vérification du commentaire posé à leur création;
- la base partagée par les contextes Spring est supprimée à l'arrêt de la JVM,
  une fois ces contextes fermés;
- la base `aegis` de développement n'est jamais utilisée par les tests.

Le serveur est choisi uniquement par des variables propres aux tests;
`AEGIS_DB_HOST` et `AEGIS_DB_NAME` de l'application sont ignorés.

| Variable | Défaut |
|---|---|
| `AEGIS_TEST_DB_HOST` | `localhost` |
| `AEGIS_TEST_DB_PORT` | `5432` |
| `AEGIS_TEST_DB_USER` | `aegis` |
| `AEGIS_TEST_DB_PASSWORD` | valeur de `AEGIS_DB_PASSWORD` |

Garde-fou : seul un serveur en boucle locale (`localhost`, `127.0.0.1`, `::1`)
est accepté. Tout autre serveur est refusé avant toute connexion, sauf si
`AEGIS_TEST_DB_DISPOSABLE_SERVER=<hôte>:<port>` le déclare jetable en le
nommant exactement. Un tunnel SSH qui présente un serveur distant sur
`localhost` échappe à ce contrôle : ne pas lancer les tests à travers un tel
tunnel.

Le rôle de connexion doit pouvoir créer une base, ce qui est le cas du rôle de
`infra/docker/compose.yaml`. Le serveur du compose convient donc, mais un
serveur jetable dédié sépare complètement les tests des données de
développement :

```bash
docker run -d --rm --name aegis-test-postgres -e POSTGRES_USER=aegis \
  -e POSTGRES_PASSWORD=mot-de-passe-jetable -p 127.0.0.1:55432:5432 \
  --tmpfs /var/lib/postgresql/data postgres:17-alpine
AEGIS_TEST_DB_PORT=55432 AEGIS_TEST_DB_PASSWORD=mot-de-passe-jetable ./mvnw test
docker stop aegis-test-postgres
```

Une JVM arrêtée de force ou plantée peut laisser des bases `aegis_test_*`.
Leur commentaire indique l'exécution et son heure de début :

```bash
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml exec postgres \
  psql -U aegis -d postgres -c "SELECT datname, shobj_description(oid, 'pg_database') FROM pg_database WHERE datname LIKE 'aegis_test%'"
```

Ne supprimer une telle base à la main qu'après avoir vérifié que l'exécution
nommée dans son commentaire est terminée.

## Jeton d'accès (ADR-007)

Consigné ici avant la première connexion réelle, comme l'exige le document 09,
section 4.1. Les clients traitent le jeton comme une chaîne opaque.

| Élément | Valeur |
|---|---|
| Algorithme | HS256 uniquement; tout autre algorithme, dont `none`, est refusé |
| Clé | `AEGIS_JWT_SECRET`, Base64 d'au moins 32 octets aléatoires; absente, invalide ou trop courte, elle empêche le démarrage |
| Émetteur et destinataire | `iss = aegis-control`, `aud = aegis-api` |
| Durée | 60 minutes, sans tolérance d'horloge et sans refresh token |
| Claims | `sub` = identifiant utilisateur, `jti` = identifiant du jeton, `iat`, `exp`, `role`, `maximumAccessLevel` |

À chaque requête protégée, l'API relit le compte : un compte désactivé ou
archivé est refusé immédiatement, et le rôle et le niveau d'accès courants
priment sur les claims émis à la connexion. Changer `AEGIS_JWT_SECRET`
invalide tous les jetons émis. Le mot de passe, le jeton et la clé ne sont
jamais journalisés.

## Autorisation des routes

`identity/ApiRoutes.java` liste chaque route du document 09, section 9, avec
les appelants permis. La sécurité HTTP n'accorde l'accès que par cette table :

- santé et connexion sont publiques et ignorent un en-tête `Authorization`
  périmé;
- `GET /auth/me` et `GET /lockers/{lockerId}/status` sont ouvertes aux deux
  rôles, les autres routes à un seul;
- une route documentée appelée avec le mauvais rôle reçoit 403 `FORBIDDEN`;
- une route ou une méthode absente de la table reçoit 404
  `RESOURCE_NOT_FOUND`, même si un contrôleur existe, et ce contrôleur n'est
  pas exécuté;
- hors des routes publiques, un appelant sans jeton valide reçoit 401 avant
  qu'une route ne soit révélée;
- les chemins `/.well-known/**`, dont les métadonnées RFC 9728 que Spring
  Security publie par défaut, répondent 401.

Un nouvel endpoint reste donc inaccessible tant que sa route n'est pas
documentée et ajoutée à `ApiRoutes`, et un test échoue si un contrôleur de
l'application n'y figure pas.

Le document 09 ne fixe pas la réponse à une route ou à une méthode non
documentée. Le 404 ci-dessus, par exemple au lieu d'un 405 pour
`DELETE /auth/me`, est un choix d'implémentation à valider par l'équipe, pas
une règle du contrat.

Ces tests vérifient le filtre HTTP seulement : la plupart des routes
documentées appartiennent aux tranches suivantes et répondent 404 ou 405 une
fois le filtre franchi. Chaque tranche doit ajouter ses tests d'autorisation
sur les vrais endpoints :

- réservation, prêt et opération d'un autre technicien refusés (document 09,
  sections 14.3, 15.3, 15.4 et 26.2);
- `authorize-local` réservé à l'initiateur de l'opération (section 15.5);
- 403 `ASSET_ACCESS_DENIED` pour un compte `STANDARD` qui réserve un actif
  `RESTRICTED` (section 26.3);
- aucune route administrative ne confirme une opération ni ne résout une
  anomalie (section 26.2).

## Comptes de démonstration

Aucun compte n'est créé tant que `AEGIS_DEMO_ACCOUNTS_ENABLED` n'est pas
`true`. Le démarrage échoue alors si un des deux mots de passe manque ou ne
fait pas 12 à 72 octets. Les adresses par défaut sont `admin@aegis.demo` et
`technician@aegis.demo`; `AEGIS_DEMO_ADMIN_EMAIL` et
`AEGIS_DEMO_TECHNICIAN_EMAIL` les remplacent.

Le provisionnement est idempotent : un compte absent est créé avec un hachage
BCrypt, un mot de passe modifié est haché à nouveau, mais le rôle, le niveau
d'accès et le statut d'un compte existant ne sont jamais modifiés. Un compte
désactivé par un administrateur le reste donc après redémarrage. Aucun mot de
passe en clair n'est versionné.

## Arrêt et reprise

Depuis la racine du dépôt :

```bash
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml down
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml up -d --wait
```

`down` conserve les volumes. Ne pas ajouter `--volumes` si les données locales
doivent être conservées. Chaque démarrage de l'API applique les migrations en
attente (`V001`, puis `V002` pour l'identité et le catalogue) et valide
l'historique dans `public.flyway_schema_history` sans rejouer une migration
déjà appliquée. Les tables métier sont dans le schéma `aegis`.

PostgreSQL et Mosquitto sont publiés uniquement sur `127.0.0.1`. Le broker
non chiffré est réservé au simulateur local isolé. Un hub réel, même au labo,
exigera TLS avec certificat vérifié et ses propres identifiants. Les ACL de
cette étape autorisent seulement l'identité fictive du contrat MQTT.

## Limites connues de cette étape

- IAM-01 n'est pas terminé de bout en bout tant que les clients Web et iOS
  n'utilisent pas ces routes; CORS sera configuré avec le client Web.
- La connexion n'est pas encore auditée : `audit_events` arrive avec `V009`.
- La limite de 5 tentatives par minute, par adresse TCP et par compte, est
  tenue en mémoire : elle suppose le déploiement P0 à instance unique.
  Plusieurs instances multiplieraient la limite et un redémarrage l'efface.
  Au plus 10 000 combinaisons actives sont suivies : les fenêtres expirées
  sont libérées et, si toutes sont encore actives, une nouvelle combinaison
  reçoit 429 au lieu d'effacer une fenêtre en cours. Les en-têtes de proxy ne
  sont pas crus.
- Un jeton copié reste utilisable jusqu'à son expiration tant que le compte
  est actif (document 09, section 4.2); réactiver un compte redonne effet à
  ses jetons non expirés.

## Étape suivante

Selon le document 14, l'itération 2 se termine en connectant la connexion aux
clients Web et iOS, ce qui clôt IAM-01, et en ingérant le heartbeat du
simulateur pour finir FND-02. L'itération 3 ouvre CAT-01/02 et CFG-01 sur les
tables du catalogue déjà créées par `V002`.
