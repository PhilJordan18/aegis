# Aegis Control — démarrage local

Ce socle couvre FND-01, FND-02A, la partie backend d'IAM-01/02 et la partie
API de CAT-01. Il fournit PostgreSQL, un broker MQTT local authentifié pour le
simulateur, Spring Boot, Flyway, `GET /api/v1/system/health`, la connexion par
comptes préparés (`POST /api/v1/auth/login`, `GET /api/v1/auth/me`), les
contrôles de rôle et de niveau d'accès côté serveur et l'administration des
modèles et des actifs (document 09, sections 12.1 et 12.2), dont les mutations
sont auditées (AUD-00). Il n'implémente pas
encore les identifiants physiques, les placements ni l'ingestion MQTT. Les
clients Web et iOS ont leur propre dossier sous `apps/`.

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
export AEGIS_DEMO_LOCKER_ENABLED=true
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

## Catalogue administratif (CAT-01)

Les routes `/api/v1/admin/asset-models` et `/api/v1/admin/assets` sont
réservées au rôle `ADMIN`. Un modèle ou un actif n'est jamais supprimé :
l'archivage le conserve, le laisse lisible et interdit sa modification
(`409 ASSET_MODEL_ARCHIVED` ou `ASSET_ARCHIVED`). Un modèle utilisé par un
actif non archivé ne peut pas être archivé (`409 ASSET_MODEL_IN_USE`).

Les index uniques de `V002` restent la garde finale : code d'actif sans casse,
numéro de série et nom de modèle actif sans casse donnent respectivement
`409 ASSET_CODE_ALREADY_EXISTS`, `ASSET_SERIAL_NUMBER_ALREADY_EXISTS` et
`ASSET_MODEL_NAME_ALREADY_EXISTS`. Une création ou une modification d'actif verrouille
le modèle en partage, et l'archivage d'un modèle le verrouille en exclusif :
un actif non archivé ne peut donc jamais référencer un modèle archivé.

Chaque création, modification effective et premier archivage écrit un seul
événement dans `audit_events`, dans la transaction de la mutation et avec
l'instant qu'elle enregistre : `ASSET_CREATED`, `ASSET_UPDATED` ou
`ASSET_ARCHIVED`, avec `subject_type` `ASSET_MODEL` ou `ASSET` et le compte
authentifié comme acteur. `details` contient l'instantané des champs créés,
les champs modifiés avec leurs valeurs avant et après, ou `archivedAt`. Un
archivage répété avec une nouvelle clé écrit `ASSET_ARCHIVED` avec le
résultat `ALREADY_APPLIED`; un rejeu de même clé, un `PUT` identique ou un
refus n'écrit rien. `audit/AuditTrail` exige une transaction existante et
refuse d'écrire hors de celle de la mutation. Les lignes antérieures à
`V002_2` n'ont aucun événement reconstitué. `CatalogAuditTests` et
`CatalogConcurrencyTests` le vérifient.

La vue `AdminAssetView` ne contient aucune readiness. Sa disponibilité et sa
présence viennent des mêmes sources que le catalogue technicien (voir
« Catalogue technicien et readiness »). Tant qu'aucune observation n'existe, la
présence vaut `UNKNOWN` et le diagnostic contient donc toujours
`UNKNOWN_PHYSICAL_STATE`. Son champ `placement`
présente le placement actif, lu dans la même requête que l'actif.

## Identifiants physiques et placement (CAT-02)

`V003` crée `lockers`, `compartments`, `locker_devices` et `asset_placements`
tels que le document 08, sections 4.4 et 5.1, les définit. Aucune route ne crée
de locker en P0 : le casier de démonstration est provisionné au démarrage
(section suivante).

`POST /admin/assets/{assetId}/identifiers` et
`POST /admin/assets/{assetId}/identifiers/{identifierId}/revoke` exigent une
`Idempotency-Key`. Une paire `type + valeur` active n'appartient qu'à un actif
(`409 IDENTIFIER_ALREADY_ASSIGNED`, index `ux_asset_identifiers_active_value`
en garde finale); un type hors `RFID_UHF`, `NFC` et `QR` reçoit
`422 IDENTIFIER_TYPE_UNSUPPORTED`. La révocation conserve la ligne; une
révocation répétée est auditée `ALREADY_APPLIED`. Une attribution écrit
`ASSET_IDENTIFIER_ASSIGNED` et une révocation `ASSET_UPDATED`, faute de type
de révocation dans le document 08.

`PUT /admin/assets/{assetId}/placement` termine le placement précédent au lieu
de le supprimer et écrit `ASSET_PLACEMENT_CHANGED`. Il verrouille l'actif, puis
les compartiments visé et quitté dans l'ordre de leur identifiant. Il refuse un
actif archivé, un compartiment inconnu (violation `COMPARTMENT_NOT_FOUND`),
désactivé (`409 COMPARTMENT_DISABLED`) ou occupé par un autre actif
(`409 COMPARTMENT_ALREADY_OCCUPIED`). Un `PUT` vers le compartiment actuel ne
change rien. L'archivage d'un actif termine son placement actif dans sa
transaction. Les nouveaux codes sont proposés dans le document 09 et attendent
leur approbation. Les refus liés aux réservations, prêts et opérations
viendront avec les tranches qui les créent. `AssetIdentifierApiTests`,
`AssetPlacementApiTests` et `PhysicalCatalogConcurrencyTests` le vérifient.

## Idempotence REST

`shared/idempotency` applique le document 09, sections 6.2 et 20, et le
document 08, section 8.1. Une route de la section 20.1 déclare un paramètre
`IdempotentRequest`, ce qui rend `Idempotency-Key` obligatoire, puis confie sa
mutation à `IdempotencyService.execute`. La clé, la mutation et la réponse
enregistrée partagent une transaction : une répétition rejoue la réponse avec
`Idempotency-Replayed: true`, une autre intention reçoit 409
`IDEMPOTENCY_KEY_REUSED` et une clé encore tenue après 5 secondes reçoit 409
`IDEMPOTENCY_REQUEST_IN_PROGRESS` avec `Retry-After`. Pour le catalogue, un
refus métier n'est pas enregistré : la clé est annulée avec la mutation.

Les quatre mutations du catalogue (`POST /admin/asset-models`,
`POST /admin/asset-models/{modelId}/archive`, `POST /admin/assets` et
`POST /admin/assets/{assetId}/archive`) utilisent ce service : leurs services
métier rejoignent sa transaction et n'en ouvrent jamais une nouvelle.
`CatalogIdempotencyTests` les vérifie sur les vraies routes;
`IdempotencyApiTests` garde son contrôleur de test pour la concurrence,
l'attente de verrou et l'expiration.

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

## Casier de démonstration

Avec `AEGIS_DEMO_LOCKER_ENABLED=true`, le démarrage crée le casier
`AEGIS-DEMO-01` (`d46a74ae-39dc-460b-8af0-38fc791b376a`, topologie
`HUB_CELL`) et ses cellules `A1` (`1ae77ae3-8490-4f09-9412-a7816b77bff9`) et
`A2` (`5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10`), aux adresses et ports 1 et 2.
Ce sont les identifiants des documents 09 et 10 et du simulateur de hub. Le
provisionnement crée seulement les lignes absentes et ne modifie jamais une
ligne existante; aucun device n'est enregistré. Sans la variable, rien n'est
créé.

## Horaire d'exploitation (CFG-02)

`V004` crée `operating_schedules` et `operating_windows` tels que le document
08, sections 4.5 et 5.1, les définit. `GET` et `PUT
/admin/lockers/{lockerId}/operating-schedule` (document 09, section 13) sont
réservés à `ADMIN`. Le `PUT` valide les sept jours, le fuseau IANA et les
heures, verrouille le locker, archive la version active et en insère une
nouvelle avec ses sept plages; il écrit un événement `SCHEDULE_UPDATED` par
version. Un `PUT` identique ne crée rien. Un locker sans horaire actif
retourne `404 OPERATING_SCHEDULE_NOT_CONFIGURED`. Ce code et les codes de
violation de la section 13.2 sont proposés et attendent leur approbation.

Le casier de démonstration n'a pas d'horaire au démarrage : sa version doit
être créée par un administrateur, l'administrateur de démonstration par
exemple, avec ce `PUT`. `OperatingHours.requireOpenOperatingWindow` porte la
règle de réservation du document 06, section 5.1, y compris les changements
d'heure; aucune route ne l'appelle encore. `OperatingScheduleApiTests`,
`OperatingScheduleConcurrencyTests`, `OperatingHoursTests` et
`OperatingScheduleMigrationTests` le vérifient.

## Catalogue technicien et readiness (RDY-01, RDY-02)

`GET /api/v1/assets` et `GET /api/v1/assets/{assetId}` sont réservés au rôle
`TECHNICIAN` : un `ADMIN` reçoit `403 FORBIDDEN`, un appel anonyme `401`.
Chaque élément est un `AssetView` (document 09, §8.2) dont la `readiness` est
calculée pour le compte authentifié, au même instant pour toute la réponse, par
`asset/ReadinessEvaluator` (document 06, §4.3 à §4.5) : un blocage certain
donne `BLOCKED` avec toutes ses raisons distinctes; une preuve physique
insuffisante donne `UNKNOWN` / `UNKNOWN_PHYSICAL_STATE` seulement sans blocage;
`READY` exige la présence `PRESENT`.

Avant PHY-02, aucune observation n'est stockée : `asset/NoPhysicalProofPresence`
répond `UNKNOWN` pour tout actif, donc un actif conforme est `UNKNOWN` et jamais
`READY`. PHY-02 remplace ce composant derrière l'interface `PhysicalPresence`.
La disponibilité vient de `asset/AssetCustodyRepository` (document 03, §5.2) :
un prêt `ACTIVE` ou `RETURN_PENDING` donne `BORROWED`, même en retard; sinon une
réservation `ACTIVE` donne `RESERVED`, y compris pour son titulaire hors de son
retrait (`BLOCKED` / `NOT_AVAILABLE`); sinon l'archivage donne `UNAVAILABLE`.
La vue administrative lit les mêmes sources : un administrateur et un
technicien voient toujours la même disponibilité et la même présence.

La liste exclut les actifs archivés, que l'archivage retire du catalogue actif
(document 03, §4.4). Lu par son identifiant, un actif archivé retourne `200`
avec `availability` `UNAVAILABLE` et `BLOCKED` / `NOT_AVAILABLE` (document 06,
§4.4). Les filtres
`readiness` et `availability` s'appliquent après l'évaluation de tout le
catalogue correspondant, puis la page est découpée : `totalItems` et
`totalPages` restent exacts. Ce choix vise la taille du catalogue P0. Un
identifiant inconnu donne `404 ASSET_NOT_FOUND`.

Avec l'API lancée comme ci-dessus et `AEGIS_DEMO_TECHNICIAN_PASSWORD` exporté :

```bash
TOKEN="$(curl -s -X POST http://127.0.0.1:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"technician@aegis.demo\",\"password\":\"$AEGIS_DEMO_TECHNICIAN_PASSWORD\"}" \
  | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')"
curl -s 'http://127.0.0.1:8080/api/v1/assets?size=20&sort=assetCode,asc' \
  -H "Authorization: Bearer $TOKEN"
curl -s 'http://127.0.0.1:8080/api/v1/assets?q=A2&readiness=BLOCKED' \
  -H "Authorization: Bearer $TOKEN"
curl -s "http://127.0.0.1:8080/api/v1/assets/<assetId>" -H "Authorization: Bearer $TOKEN"
```

`TechnicianCatalogApiTests`, `CatalogCustodyApiTests` et
`ReadinessEvaluatorTests` vérifient ce comportement.

### Jeu de démonstration

`scripts/seed-demo-catalog.py` (Python 3, bibliothèque standard) crée quatre
modèles et cinq actifs par l'API administrative : les règles du catalogue
s'appliquent et l'audit est réel. L'API doit tourner avec
`AEGIS_DEMO_ACCOUNTS_ENABLED=true` et `AEGIS_DEMO_LOCKER_ENABLED=true`. Le
script peut être relancé : il réutilise ce qui existe déjà.

```bash
set -a; . ~/.config/aegis/local-api.env; set +a
python3 -I scripts/seed-demo-catalog.py
```

Avec `AEGIS_DEMO_TECHNICIAN_PASSWORD` défini, il relit le catalogue technicien
et échoue sur tout écart. Résultat attendu pour le technicien STANDARD, sans
preuve physique avant PHY-02 :

| Actif | Readiness | Placement |
|---|---|---|
| `AEG-DEMO-001` | `UNKNOWN` / `UNKNOWN_PHYSICAL_STATE` | A1 |
| `AEG-DEMO-002` | `BLOCKED` / `CALIBRATION_EXPIRED` | A2 |
| `AEG-DEMO-003` | `BLOCKED` / `ACCESS_DENIED` (niveau `RESTRICTED`) | aucun |
| `AEG-DEMO-004` | `UNKNOWN` / `UNKNOWN_PHYSICAL_STATE` (sans calibration) | aucun |
| `AEG-DEMO-005` | `BLOCKED` / `MAINTENANCE` | aucun |

Aucun actif n'est `READY` tant qu'aucune preuve de présence n'existe
(décision du 28 octobre 2026).

## Rôles PostgreSQL

Le document 08, section 12.1, sépare le propriétaire des migrations du rôle
applicatif. En local et en CI, rien ne change : l'API et Flyway utilisent le
même compte `aegis`, et le rôle applicatif n'existe pas.

| Variable | Défaut | Rôle |
|---|---|---|
| `AEGIS_DB_USER`, `AEGIS_DB_PASSWORD` | `aegis`, aucun | Compte de la source de données de l'API |
| `AEGIS_DB_MIGRATION_USER`, `AEGIS_DB_MIGRATION_PASSWORD` | ceux de la source de données | Compte de Flyway, propriétaire du schéma |
| `AEGIS_DB_APPLICATION_ROLE` | `aegis_app` | Rôle qui reçoit les droits applicatifs |

Après chaque migration, le callback Flyway accorde au rôle applicatif, s'il
existe : `USAGE` sur `aegis`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` sur les
tables métier, et seulement `SELECT` et `INSERT` sur `audit_events`; jamais
`TRUNCATE`, `REFERENCES` ni `TRIGGER`. Il échoue si ce rôle est
superutilisateur ou membre d'un propriétaire du schéma, même sans héritage. Le trigger
append-only de `audit_events` n'est qu'une défense en profondeur : le
propriétaire de la table peut le désactiver et un superutilisateur le
contourne. Seuls les droits du rôle applicatif protègent l'audit.

Mise en place par un opérateur sur un environnement cible, sans l'appliquer
aux environnements partagés dans cette carte :

1. créer les rôles, en superutilisateur, sans mot de passe dans la commande :

   ```bash
   psql -v ON_ERROR_STOP=1 -v app_role=aegis_app -v migration_role=aegis_migrator \
     -d aegis -f infra/postgres/provision-roles.sql
   ```

2. dans `psql`, fixer les mots de passe avec `\password aegis_app` et
   `\password aegis_migrator`; le client n'envoie qu'un vérificateur SCRAM,
   alors qu'un `ALTER ROLE ... PASSWORD '...'` peut finir dans les journaux;
3. redémarrer l'API avec le compte propriétaire actuel : le callback accorde
   les droits à `aegis_app`;
4. basculer `AEGIS_DB_USER` et `AEGIS_DB_PASSWORD` vers `aegis_app`, en
   plaçant le compte propriétaire dans `AEGIS_DB_MIGRATION_USER` et
   `AEGIS_DB_MIGRATION_PASSWORD`;
5. vérifier en tant que `aegis_app` que `UPDATE`, `DELETE` et `TRUNCATE` sur
   `aegis.audit_events` échouent avec `42501`;
6. facultatif : transférer la propriété du schéma `aegis`, de ses objets et de
   `public.flyway_schema_history` à `aegis_migrator`, puis migrer avec lui
   plutôt qu'avec un superutilisateur.

Retour arrière : remettre `AEGIS_DB_USER` sur le compte propriétaire. Les tests
utilisent toujours le compte du serveur de test pour Flyway et ignorent
`AEGIS_DB_MIGRATION_*` et `AEGIS_DB_APPLICATION_ROLE`; `FlywayMigrationTests` vérifie les droits accordés et
le trigger sur une base et un rôle jetables.

## Arrêt et reprise

Depuis la racine du dépôt :

```bash
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml down
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml up -d --wait
```

`down` conserve les volumes. Ne pas ajouter `--volumes` si les données locales
doivent être conservées. Chaque démarrage de l'API applique les migrations
en attente (`V001`, `V002` pour l'identité et le catalogue, `V002_1` pour les
clés d'idempotence REST, puis `V002_2` pour `audit_events`) et valide
l'historique dans `public.flyway_schema_history` sans rejouer une migration
déjà appliquée. Les tables métier sont dans le schéma `aegis`. Le callback
`afterMigrate__grant_application_role.sql` s'exécute ensuite à chaque
démarrage (voir « Rôles PostgreSQL »).

PostgreSQL et Mosquitto sont publiés uniquement sur `127.0.0.1`. Le broker
non chiffré est réservé au simulateur local isolé. Un hub réel, même au labo,
exigera TLS avec certificat vérifié et ses propres identifiants. Les ACL de
cette étape autorisent seulement l'identité fictive du contrat MQTT.

## Limites connues de cette étape

- IAM-01 n'est pas terminé de bout en bout tant que les clients Web et iOS
  n'utilisent pas ces routes; CORS sera configuré avec le client Web.
- La connexion n'est pas encore auditée, et aucune route ne lit encore
  `audit_events` (AUD-01).
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
