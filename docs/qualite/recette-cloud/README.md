# Recette cloud courte : PostgreSQL, Spring et Mosquitto réels

Cette recette vérifie le chemin P0 de bout en bout sur une pile réelle et jetable, en
environ 90 secondes. Elle ne s'exécute pas sur le Mac. Elle ne remplace ni la recette
matérielle (lecteur RFID, serrure, écran), ni la revue humaine de l'interface Manager.

```bash
docs/qualite/recette-cloud/run.sh   # depuis la racine du dépôt
```

**Prérequis :**

- Docker avec Compose ;
- Java 21 ;
- Node 22.18 ou plus récent ;
- `python3` et `openssl`.

Le JAR de l'API est **toujours reconstruit** depuis le commit extrait (`./mvnw -DskipTests clean package`), pour ne jamais tester un JAR périmé. Les tests
Maven restent ceux de la CI.

## Ce que fait `run.sh`

1. **Pile jetable.**
   - Elle démarre le projet Compose `aegis-recette`, distinct de `aegis-dev`, sur ses
     propres ports : PostgreSQL 55432, Mosquitto 51883, API 18080.
   - Elle part de volumes vides **de ce projet seulement** et les supprime à la fin.
     `RECETTE_KEEP=1` les garde.
   - Les images sont celles de `infra/docker/compose.yaml`, aux mêmes digests. Si
     Docker Hub refuse (429), elles viennent de `mirror.gcr.io` avec le même digest.
2. **Comptes.**
   - L'API démarre avec les identifiants d'exemple de `infra/docker/.env.example`.
   - Elle reçoit une clé JWT aléatoire et des mots de passe administrateur et technicien
     aléatoires, jamais affichés.
   - Le casier de démonstration `AEGIS-DEMO-01` (A1, A2) est provisionné et l'ingestion
     MQTT est active.
3. **Phase catalogue** (`checks.py`, `RECETTE_PHASE=catalog`) : contrôles R1 et R2.
4. **Hub simulé.** Le simulateur exécute `scenarios/presence-demo-local.json` : 30 s en
   ligne, puis les étiquettes de A1 et A2 sont posées et scannées.
5. **Phase physique** (`RECETTE_PHASE=physical`) : contrôles R3 à R6.
6. **Fin.** Le script affiche `RECETTE: all checks passed` ou le nombre d'échecs, et son
   code de sortie est ce nombre. Les journaux de l'API et du simulateur restent dans le
   dossier temporaire affiché.

## Contrôles

| # | Vérification | Attendu (contrat) |
|---|---|---|
| R1.1–R1.3 | Manager crée un modèle et deux actifs | `201` |
| R1.4 | le technicien lit l'actif créé | `200`, `UNKNOWN` / `UNKNOWN_PHYSICAL_STATE` sans preuve physique |
| R1.5 | Manager passe l'actif en `MAINTENANCE`, le technicien le relit | `BLOCKED` / `MAINTENANCE` |
| R1.6, R1.7 | séparation des rôles | `403 FORBIDDEN` dans les deux sens |
| R2.1–R2.3 | étiquette RFID liée, puis la même sur un autre actif | `201`, puis `409 IDENTIFIER_ALREADY_ASSIGNED` (doc 09, §12.3) |
| R2.4–R2.6 | placement en A1, puis un second actif en A1 | `200`, puis `409 COMPARTMENT_ALREADY_OCCUPIED` (§12.4) |
| R2.7 | lecture technicien après placement | placement `A1`, jamais `READY` sans scan |
| R4.1 | heartbeat du hub | casier `ONLINE`, portes et serrures exposées |
| R4.2 | scan de l'étiquette liée | `PRESENT` et `READY` |
| R3.1, R3.2 | horaire fermé, puis réservation | `422 OUTSIDE_OPERATING_HOURS` (§14.1, étape 6) |
| R3.3, R3.4 | horaire ouvert | `currentWindow.open = true` côté technicien |
| R3.5 | fin de réservation après la fermeture | `422 RESERVATION_END_AFTER_CLOSING` |
| R5.1 | réservation dans la plage | `201`, `ACTIVE` |
| R5.2 | aucune commande d'ouverture | `aegis.command_outbox` et `aegis.locker_operations` inchangés |
| R5.3 | lecture après réservation | `availability = RESERVED` |
| R6.1 | hub figé par `SIGSTOP` : plus de heartbeat, mais aucune déconnexion | casier `OFFLINE` après plus de 30 s |
| R6.2 | interruption de continuité | présence `UNKNOWN` : le scan antérieur est annulé |
| R8.1 | lecture P1 `GET /admin/lockers` (#134) | `AEGIS-DEMO-01` avec l'occupant de A1 et de A2 |
| R8.2, R8.5 | lectures P1 et P2 par le technicien | `403 FORBIDDEN` |
| R8.3 | lecture P2 `GET /admin/assets/{id}/identifiers` | l'étiquette liée, active |
| R8.4 | révocation, puis la même étiquette liée de nouveau | `200`, puis `201` ; l'historique garde la révoquée (`revokedAt`), l'active d'abord ; le scan R4.2 reconnaît ensuite l'étiquette liée de nouveau |
| R7 | corpus partagé de recherche `q` (#109), s'il est sur la branche | chaque cas donne `200` (`VALID`) ou `400` avec la violation `q` attendue (`SIZE`, `INVALID_VALUE`), document 09, §22.3 ; sinon `SKIP` |

## Preuve du 6 novembre 2026

- **Après #134, sur `dev` `644cced`** : 31 contrôles sur 31 réussis en 105 s, R8 compris.
  R7 est sauté, le corpus de #109 n'étant pas encore sur `dev`.

### Premier passage (avant #134)

- **Résultat :** 26 contrôles sur 26 réussis en 89 s.
- **Configuration :**
  - `dev` à `47f34ac` ;
  - conteneur cloud Linux, Docker 29.9.2 ;
  - PostgreSQL 17 et Mosquitto 2 aux digests de `compose.yaml` ;
  - Java 21.0.12, Node 22.23.
- **R7, corpus de #109, le même jour :**
  - sur la branche de #131 (`7d530f0`, fusionnée en local avec cette recette) : 44 cas
    sur 44 conformes, recette complète verte ;
  - sur `dev` (`47f34ac`), avec le corpus copié temporairement : **R7 échoue**, comme
    attendu. Par exemple, `e-combining-100`, `emoji-simple-100` et `emoji-zwj-100` donnent
    `SIZE` au lieu de `VALID`, puisque `dev` compte en UTF-16.
  - Le contrôle distingue donc l'ancienne règle de la nouvelle.
- **Correction de la recette elle-même :** le premier passage attendait `409` pour
  l'horaire fermé. L'API répond `422 OUTSIDE_OPERATING_HOURS`, ce que prévoit le document
  09 (§14.1). La recette a été corrigée ; l'API n'avait pas de défaut.

## Réel ou simulé

| Élément | Nature |
|---|---|
| PostgreSQL, migrations Flyway, Spring, authentification JWT, broker Mosquitto avec ACL et comptes | **réels** |
| Hub | **simulé** (`tools/hub-simulator`) : aucune preuve matérielle |
| Interface Manager | **non exercée** : la recette appelle les mêmes routes REST que le Manager. Les écrans restent à recevoir et à vérifier (#25, #26, #28) |

Les contrôles R4 et R6 prouvent le traitement serveur des messages du hub, pas le lecteur
RFID ni la serrure (#19, #30, #32, #42).

## Recette humaine (Philippe, Jimmy)

1. Lancer `run.sh` sur une machine avec Docker, ou lire le dernier résultat consigné sur #67.
2. Refaire R1, R2 et R3 depuis l'interface Manager quand ses écrans sont livrés, puis
   vérifier chaque résultat dans l'app iOS du technicien.
3. Pour R4 et R6 avec le vrai hub : poser une étiquette, fermer la porte, puis couper le
   Wi-Fi du hub plus de 30 s. L'actif doit passer à `UNKNOWN`, puis redevenir `READY`
   seulement après un nouveau scan.
