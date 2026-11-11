# Recette Manager : lectures administratives (#48, #52, #53)

Cette recette porte sur les routes du document 09, §17 à §19 : réservations, emprunts et opérations ; anomalies et reconnaissance ; audit. Elle tourne en cloud sur une pile jetable, avec PostgreSQL, Mosquitto et Spring réels.

Elle ne remplace ni la recette de staging ni la recette physique. Aucune commande n'est envoyée au matériel de Jimmy.

## 1. Lancer

```bash
docs/qualite/manager-admin/run.sh                                   # API de ce checkout
QA_API_DIR=../backend/services/api docs/qualite/manager-admin/run.sh  # API d'une autre branche
QA_KEEP=1 docs/qualite/manager-admin/run.sh                         # garde la pile pour la recette Web
```

**Isolation.** Le projet Compose est `aegis-admin-qa`, sur les ports 56432 (PostgreSQL), 51884 (MQTT) et 18081 (API). Il ne touche ni `aegis-dev` ni `aegis-recette`.

**Comptes.** Les comptes de démonstration reçoivent des mots de passe aléatoires. Ces mots de passe sont écrits dans `<logs>/credentials` (mode 600) et ne sont jamais affichés.

**Code de sortie.** Le code de sortie vaut le nombre de `FAIL` plus le nombre de groupes `ABSENT`. Une API partielle ne passe donc jamais pour acceptée.

| Verdict | Sens |
|---|---|
| `PASS` | Comportement observé |
| `FAIL` | Comportement contredit, avec la preuve |
| `ABSENT` | La route répond 404 : ses contrôles n'ont pas tourné. Ce n'est pas un succès |
| `INFO` | Point que le document 09 ne précise pas. La valeur observée est notée, sans verdict |

## 2. Données : réel ou synthétique

| Donnée | Origine | Comment la reconnaître |
|---|---|---|
| Modèle, actifs `REC-…`, étiquettes, placements A1/A2, horaire ouvert | **Flux réel** (API Manager) | Créés par `checks.py` en phase `setup` |
| Présence `PRESENT`, puis `READY` | **Flux réel** (simulateur MQTT, `presence-demo-local.json`) | Événements du simulateur |
| Réservation `CANCELLED` (actif 2) et réservation `ACTIVE` (actif 1) | **Flux réel** (technicien, `POST /reservations`) | Identifiants aléatoires |
| Technicien B (sans mot de passe utilisable), modèle et actifs `SYN-…` | **Synthétique** | Identifiants `5eed0000-…`, courriel `@synthetic.invalid` |
| 7 réservations terminales liées aux opérations, plus 25 pour la pagination, dont 6 au même `created_at` | **Synthétique** | `5eed0000-…` |
| 8 opérations : 3 retraits `CONFIRMED`, 1 retour `CONFIRMED`, 3 `ANOMALY`, 1 `FAILED` | **Synthétique** : aucun producteur avant #43–#47 et #51 | `5eed0000-…06xx` |
| Emprunts : `ACTIVE` à l'heure, `ACTIVE` en retard, `COMPLETED` | **Synthétique** | `5eed0000-…07xx` |
| Messages entrants et observations utilisés comme preuves | **Synthétique**, avec des témoins plantés | `5eed0000-…08xx` et `09xx` |
| Anomalies `OPEN` avec preuve, `ACKNOWLEDGED`, `RESOLVED`, et `OPEN` sans opération | **Synthétique** | `5eed0000-…0bxx` |
| Événements d'audit corrélés (`operation_id`) | **Synthétique**, ajoutés en append-only | `details.synthetic = true` |

Les états synthétiques valident la **lecture** et l'interface. Ils ne ferment jamais une histoire de bout en bout (#47, #51).

**Témoins de fuite.** `QA-RAW-SENTINEL` et `QA-SECRET-SENTINEL` sont plantés à quatre endroits :
- dans `raw_payload` et `parsed_payload` ;
- dans `anomalies.details` ;
- dans le `details` de l'audit, sous la clé `accessToken`.

Aucune réponse de l'API ne doit les contenir.

## 3. Matrice d'acceptation API

Les attentes viennent du document 09 : §17 à §19, §21 (erreurs) et §22.1 (tri stable par `id`). Elles viennent aussi du document 05, §6.2. « SQL » signifie que l'ensemble attendu est relu dans PostgreSQL au moment du contrôle.

| ID | Route et données | Résultat attendu |
|---|---|---|
| M0 | Les quatre listes et l'audit (`subjectType=ANOMALY`), base vide | 200 ; `items: []`, `totalItems: 0` ; page hors limite vide ; audit `hasMore: false`, `nextCursor: null` |
| M1–M3, M5, M7 accès | Toute route, sans jeton / technicien / détail absent / id `not-a-uuid` | 401 / 403 `FORBIDDEN` / 404 `RESOURCE_NOT_FOUND` / 400 |
| M1 filtres invalides | `status=BOGUS`, `assetId=xyz`, `userId=xyz`, `from=yesterday`, `to=2026-13-40…`, `page=-1`, `size=0`, `size=101` | 400 `VALIDATION_ERROR`, avec `violations[]` contenant le champ fautif et le code `INVALID_VALUE` (D3, #67 6800639533). Vaut pour tous les filtres invalides M1 à M7 |
| M1 pagination | Toutes les réservations en `size=4`, puis le technicien en `size=3` ; deux parcours | Ensemble égal à SQL, sans doublon ; `totalItems` exact ; même ordre aux deux parcours, malgré les 6 `created_at` égaux |
| M1 filtres | Technicien B, `EXPIRED`, `assetId` de `SYN-LOAN-ACTIVE` ; `from` = instant commun et `to` = instant + 1 s ; `from` = instant − 1 s et `to` = instant ; `from` = `to` | Ensembles égaux à SQL ; les 6 réservations ex æquo sont incluses par `from` inclusif et exclues par `to` exclusif ; un intervalle vide donne 400 `VALIDATION_ERROR` (choix Backend, #67 6799329882) |
| M1 détail | Réservation réelle `ACTIVE`, puis réelle `CANCELLED` | `status`, `userId`, `asset.assetCode` `REC-…-1` ; `cancelledAt` renseigné |
| M1 tentative échouée | Réservation synthétique `ACTIVE` 509 du technicien B, dont la seule tentative de retrait 609 est `FAILED` | Détail et liste : `currentOperationId` = 609 (§8.4). Exige le correctif Backend `a9142a7` ; échoue sur `2813288`, qui renvoyait `null` |
| M2 emprunts | Liste en `size=2` ; `status=ACTIVE` ; détails 701, 702, 703 | 701 `ACTIVE` avec `overdue=false` ; 702 `ACTIVE` avec `overdue=true` ; 703 `COMPLETED` avec `returnOperationId` = 613 ; `checkoutOperationId` correct |
| M3 opérations | `lockerId` en `size=3` ; `status=ANOMALY` ; détails 604 et 607 | {604, 605, 608} ; 604 porte `anomalyId` = b04 ; 607 a `failureReason=COMMAND_REJECTED` et `anomalyId=null` |
| M4 garde | `POST` vers `…/complete`, `…/force-return`, `…/confirm`, `/admin/reservations/{id}/cancel` | 404 ou 405, jamais 2xx |
| M4 lecture pure | Empreinte des réservations, emprunts, opérations, anomalies, actifs et placements, avant et après toutes les lectures | Identique |
| M4 retard | Actif de l'emprunt 702 en retard, vu par le Manager puis par le technicien | `BORROWED` ; jamais `READY` ; l'emprunt reste `ACTIVE` en base |
| M5 anomalies | Liste en `size=3` ; filtres `status`, `severity`, `type`, `lockerOperationId` ; détails | b04 a une `evidence` qui contient l'observation 901. b05 est `ACKNOWLEDGED`, avec auteur et note, sans `resolvedAt`. b06 garde `lockerOperationId=null`, sans corrélation inventée |
| M6 reconnaissance | `POST /admin/anomalies/b06/acknowledge` | Sans clé : 400 `IDEMPOTENCY_KEY_REQUIRED`. Note vide, blanche, de 501 caractères ou absente : 400 `VALIDATION_ERROR`. Technicien 403 ; anonyme 401 ; absente 404. L'anomalie reste `OPEN` |
| M6 succès | Clé K, note N | 200 `ACKNOWLEDGED`, `acknowledgementNote=N`, `acknowledgedBy` renseigné, `resolvedAt=null` |
| M6 idempotence | K + N rejoué ; K + autre note ; nouvelle clé ; anomalie b08 `RESOLVED` | Réponse identique ; 409 `IDEMPOTENCY_KEY_REUSED` ; 409 `ANOMALY_NOT_ACKNOWLEDGEABLE`* ; 409 `ANOMALY_ALREADY_RESOLVED` |
| M6 audit et sûreté | Base, après M6 ; `POST …/resolve` | Un seul `ANOMALY_ACKNOWLEDGED`, avec l'administrateur comme acteur ; statut `ACKNOWLEDGED`, jamais `RESOLVED`. `…/resolve` répond 404 ou 405 |
| M6 concurrence | 4 reconnaissances simultanées de b04, clés distinctes | Un 200, trois 409, un seul événement d'audit |
| M7 audit | `limit=0`, `limit=101`, `eventType`/`subjectType` inconnus, `operationId=xyz`, `from=x`, `cursor=not-a-cursor` | 400 `VALIDATION_ERROR` ; le curseur altéré donne 400 `INVALID_CURSOR` |
| M7 curseur | Parcours en `limit=7` avec `to` = instantané SQL | Ensemble égal à SQL, sans doublon ni omission |
| M7 arrivées tardives (D10) | Page 1 en `limit=5`, puis deux événements synthétiques insérés pendant le parcours : l'un antidaté de 400 jours, l'autre plus récent que la page 1 | Le parcours est sans doublon et contient tout l'existant. L'antidaté est lu, car il se trie après le curseur ; le plus récent ne l'est pas. Un nouveau parcours contient les deux. Ce n'est pas un instantané (D10 approuvé) |
| M7 filtres | `operationId=604`, `subjectType=ANOMALY`, `eventType=ANOMALY_ACKNOWLEDGED`, `subjectId=703`, sujet inconnu | Ensembles égaux à SQL ; sujet inconnu : page vide finale |
| M8 fuite | Toutes les réponses collectées | Aucun témoin, aucun hachage `$2a$`/`$2b$`, aucune valeur RFID brute hors des routes `/identifiers` |

\* Cette attente est une lecture du document 05, §6.2 : seule la transition `OPEN → ACKNOWLEDGED` existe. Le Backend doit la confirmer.

**Points non spécifiés, notés `INFO` et à trancher par le Backend et Philippe :**
- forme de `actor` dans l'audit ;
- liste des `details` autorisés ;
- forme de `evidence` ;
- sens du tri de l'audit ;
- tri par défaut des listes ;
- horodatage visé par `from`/`to` (dans le seed, `created_at` vaut l'horodatage métier pour éviter l'ambiguïté) ;
- `availableActions` dans une vue administrative.

## 4. Recette Web (#48, #52, #53 côté Manager)

Lancez la pile avec `QA_KEEP=1`, puis pointez le Manager sur `http://127.0.0.1:18081`. À vérifier pour chaque écran (réservations et emprunts, anomalies, audit) :

| Contrôle | Réussite visible |
|---|---|
| URL directe d'un détail, puis précédent, puis actualisation | Même contenu, filtres conservés dans l'URL, aucune page blanche |
| Chargement, vide (filtre sans résultat), erreur (API arrêtée), données périmées | Chaque état a un texte explicite ; l'erreur affiche l'identifiant de trace ; rien n'est inventé |
| FR et EN | Tous les libellés traduits, dates locales, états du contrat non traduits en dur |
| Clavier seul | Tous les filtres, la pagination, l'ouverture d'un détail et la reconnaissance sont atteignables ; focus visible ; focus rendu après la fermeture d'un dialogue |
| 320 et 390 px | Pas de défilement horizontal de page ; tableaux lisibles ou repliés |
| Corrélation manquante (b06) | « Aucune opération liée », jamais un lien vide ou fabriqué |
| Emprunt 702 | Marqué en retard, toujours emprunté ; aucune action de libération |
| Reconnaissance | Note obligatoire (1–500) ; aucune action « Résoudre » ; l'audit montre l'événement |

**Passe automatisée.** Une fois la matrice passée (elle reconnaît toutes les anomalies semées), appliquez `seed-web-review.sql`, qui ajoute trois anomalies synthétiques `OPEN` :

- b10, liée à l'opération 607 ;
- b11, sans opération ;
- b12, pour le conflit 409.

Lancez ensuite le Manager construit avec `npx vite preview` (`AEGIS_API_ORIGIN=http://127.0.0.1:18081`, port 4173), puis :

```
WEB_DIR=<checkout Web>/apps/admin-web QA_CREDS=<fichier credentials> OUT_DIR=<dossier de captures> node docs/qualite/manager-admin/web-review.mjs
```

Le scénario `anomalies` reconnaît b10 et b12 ; il ne passe donc qu'une fois par jeu de données. `ONLY=transactions,audit,…` limite les scénarios.

Deux contrôles reposent sur des pannes routées dans le navigateur, que le serveur réel ne produit pas :

- un 404 de liste ;
- une API injoignable.

Le curseur invalide est en revanche refusé par le vrai serveur.

Les erreurs de ressource 400, 404 et 409 que Chromium écrit dans la console sont attendues ; ce ne sont pas des erreurs de page.

## 5. Recette manuelle pour Philippe et Jimmy

**Préparation.** Lancez `QA_KEEP=1 docs/qualite/manager-admin/run.sh` dans une session cloud, jamais sur le Mac. Le script affiche le chemin du fichier `credentials`. Philippe transmet ces mots de passe à Jimmy en privé : jamais dans une issue, une PR ou un commit.

**Réinitialisation.** Arrêtez l'API et le simulateur (PID affichés), puis lancez `docker compose -p aegis-admin-qa … down -v`. Relancer `run.sh` repart de volumes vides ; le seed refuse de s'appliquer deux fois.

| Étape | Action | Réussi si |
|---|---|---|
| 1 | Se connecter avec `admin@aegis.demo` | La console s'ouvre |
| 2 | Réservations, filtre « Expirée » | Seules des réservations `EXPIRED`, sans doublon d'une page à l'autre |
| 3 | Ouvrir l'emprunt `SYN-LOAN-OVERDUE` | « En retard » et toujours emprunté |
| 4 | Ouvrir l'anomalie de `SYN-ANOM-OPEN` | Preuve affichée (observation), sans contenu brut |
| 5 | Reconnaître l'anomalie de `SYN-ANOM-TARGET` avec une note | Statut « Reconnue », pas « Résolue » ; le bouton disparaît |
| 6 | Audit, filtre sur cette anomalie | Un seul événement de reconnaissance, avec l'auteur |
| 7 | Se connecter avec `technician@aegis.demo` et ouvrir une URL Manager | Accès refusé |

**Échec.** Une seule étape non conforme suffit. Notez l'étape, la capture et l'heure sur #67.

**Portée.** Cette recette ne vaut ni acceptation de staging ni acceptation physique. Les lignes `5eed0000-` sont synthétiques.
