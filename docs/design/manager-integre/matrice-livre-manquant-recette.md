# Parcours Manager intégré : matrice livré, manquant et recette

Mode : revue d'acceptation (aucun code modifié). Mandat : Philippe, #67, section Web
([commentaire 7062915593](https://github.com/PhilJordan18/aegis/issues/67#issuecomment-7062915593)),
étape 1. Cartes couvertes : #25, #26, #27, #28, #48, #52, #53, #159.
Date : 21 novembre 2026. Base : `origin/dev` `c6845e6` (branche `48-docs-manager-journey-matrix`).
Propriétaire : Web Manager. **Statut : proposition à relire par Philippe, qui choisit les tranches.**

Ce document ne change ni contrat REST ou MQTT, ni invariant, ni design approuvé. Il ne ferme aucune carte.

## 0. Lecture du document

### Statuts

| Statut | Sens |
|---|---|
| **Livré et vérifié** | Présent sur `dev`, prouvé par une preuve automatisée ou réelle, et aucune étape humaine n'est définie pour ce critère |
| **Livré, recette humaine en attente** | Présent sur `dev` et prouvé automatiquement ; le parcours humain (recette `docs/design/manager-forms/recette-humaine.md`, `docs/qualite/recette-staging` S5 à S8, `docs/qualite/manager-admin/README.md` §5) n'est pas fait |
| **Partiel** | Une partie du critère est livrée ; l'écart est décrit |
| **Manquant** | Rien n'existe sur `dev` alors que le critère ou le design approuvé le demande |
| **Bloqué par contrat non fusionné** | Dépend d'une PR Backend ouverte (#173 → #175 → #176 → #177, ou #180). **Ces routes et comportements ne sont pas déployés** ; rien n'est affirmé à leur sujet |
| **Hors périmètre Web** | Appartient à iOS, à l'API seule ou au matériel |

### Nature des preuves

| Mot | Sens |
|---|---|
| **réel** | API Spring et PostgreSQL 16 réels, lancés depuis ce checkout (§6) ; MQTT désactivé |
| **synthétique** | Lignes insérées par SQL sur la base jetable (`docs/qualite/manager-admin/seed-synthetic.sql` de QA, plus trois fixtures de cette revue, préfixe `5eed0000-…0f`). Elles valident la **lecture** et l'écran, jamais un retrait ou un retour physique |
| **unitaire** | Suite Vitest (63 fichiers, 1154 tests, tous passés sur `c6845e6`) |
| **QA** | Preuve publiée par QA sur la carte, non rejouée ici |

Aucune ligne de ce document ne vaut preuve matérielle ni preuve de retrait ou de retour réel : aucune route de `dev` ne crée de
prêt (`git grep "INSERT INTO aegis.loans" origin/dev -- services/api/src/main` ne renvoie rien ; la première occurrence est dans
`CheckoutConfirmation.java` de #175).

## 1. Synthèse

| Carte | Lignes | Vérifié | Recette humaine | Partiel | Manquant | Bloqué | Hors Web |
|---|---:|---:|---:|---:|---:|---:|---:|
| #25 CAT-01 | 5 | 3 | 2 | 0 | 0 | 0 | 0 |
| #26 CAT-02 | 5 | 4 | 1 | 0 | 0 | 0 | 0 |
| #27 CFG-01 | 4 | 0 | 3 | 1 | 0 | 0 | 0 |
| #28 CFG-02 | 4 | 2 | 2 | 0 | 0 | 0 | 0 |
| #48 LOAN-01 | 7 | 2 | 1 | 1 | 0 | 2 | 1 |
| #52 ANO-01 | 6 | 2 | 1 | 1 | 0 | 2 | 0 |
| #53 AUD-01 | 6 | 2 | 1 | 2 | 1 | 0 | 0 |
| #159 WEB-OV | 4 | 1 | 3 | 0 | 0 | 0 | 0 |
| **Critères** | **41** | **16** | **14** | **5** | **1** | **4** | **1** |
| Contrôles transverses du mandat (§3) | 16 | 8 | 0 | 4 | 2 | 2 | 0 |

Ce qui fait vraiment défaut, par ordre d'importance (détail au §4) :

1. **Le Manager ne montre pas les `details` d'audit des changements du catalogue et de l'horaire.** L'API envoie des objets
   imbriqués dont chaque feuille est une valeur scalaire autorisée ; le Web les prend pour des champs non scalaires et les masque.
   Un test d'intégration existant échoue sur ces données réelles (§2, ligne 53-4).
2. **La chaîne opération → anomalie → audit n'est pas navigable** : seuls des identifiants en clair relient ces trois écrans.
3. **Le dossier d'une réservation ou d'un prêt n'affiche pas l'état de sa tentative courante**, et une réservation « Active » dont
   l'échéance est passée ne dit pas que l'expiration est différée par une opération en cours.
4. **Rien n'actualise une opération en cours** ; seul le bouton « Actualiser » le fait.
5. **Aucune recette navigateur contre l'API réelle pour les quatre pages de la chaîne de garde** dans `e2e/api.spec.ts`.

Ce qui dépend de PR non fusionnées et doit être rejoué sur une référence d'intégration épinglée (§5) : toute donnée réelle de prêt, de
retour et d'anomalie, le rechargement de page, la déconnexion confirmée.

## 2. Matrice par critère

Les numéros de ligne renvoient à `origin/dev` `c6845e6`. « Sonde » désigne une des sondes réelles du §6.

### #25 CAT-01 : gérer un modèle d'équipement et ses exemplaires

| ID | Critère (source) | Statut | Preuve | Écart | Tranche proposée |
|---|---|---|---|---|---|
| 25-1 | « L'administrateur crée et modifie un modèle et ses exemplaires (A1 et A2 pour la démo) » | Livré, recette humaine en attente | PR #137 ; test en direct `CAT-01 forms` (`e2e/api.spec.ts:413`), 12/12 sur `c6845e6` ; `EquipmentPage.catalog.test.tsx` ; script `seed-demo-catalog.py` : A1 et A2 placés (sonde 7) | Recette humaine `manager-forms/recette-humaine.md` §1 non faite. La carte #25 rappelle le fuseau de la date de calibration : traité par #141 (`calibration-dst.md`) | Aucune |
| 25-2 | « Un exemplaire archivé garde son historique » | Livré et vérifié | Aucune route de suppression ; archivage refusé avec réservation active (`409 ASSET_ALREADY_RESERVED`) et prêt ouvert (`409 ASSET_HAS_OPEN_LOAN`) : sonde 7, réel ; événement `ASSET_ARCHIVED` ; un exemplaire archivé reste lisible (`GET /admin/assets/{id}` : 200 avec `archivedAt`, sonde 10) | La navigation de l'exemplaire vers son historique (prêts, audit) n'existe pas : voir T13 | Voir R2, R3 |
| 25-3 | « Les validations sont explicites et renvoient des erreurs stables » | Livré et vérifié | `400 VALIDATION_ERROR` avec `violations[{field, code, message}]` conforme à `api/problem.ts` (sonde 6, réel) ; `formFeedback.test.ts`, `mutationFailure.test.ts` ; conflit de code dans `CAT-01 forms` (live) | — | — |
| 25-4 | Tâche Web : « liste Équipements et formulaires modèle/exemplaire remplaçant l'aperçu statique » | Livré, recette humaine en attente | #96, #137, #146 ; protégée par session ; aperçu statique exclu du build de production (`scripts/check-preview-excluded.mjs`) | Recette humaine non faite | — |
| 25-5 | Refus d'archivage (réservation active, prêt ouvert, opération non terminale), commentaire du 22 oct. | Livré et vérifié | `409 ASSET_ALREADY_RESERVED`, `ASSET_HAS_OPEN_LOAN` (sonde 7, réel) ; `ASSET_OPERATION_IN_PROGRESS` pour placement et identifiant (sonde 9, réel) ; précédence des codes conforme à #133 : l'actif de l'opération en cours porte aussi une réservation, donc `ASSET_ALREADY_RESERVED` passe en premier | Messages Web testés en unitaire, non rejoués en navigateur sur ces codes | — |

### #26 CAT-02 : identité physique et placement

| ID | Critère | Statut | Preuve | Écart | Tranche |
|---|---|---|---|---|---|
| 26-1 | « Une étiquette active n'appartient qu'à un exemplaire » | Livré et vérifié | Index `ux_asset_identifiers_active_value` ; tests de concurrence Backend (commentaire #26 du 3 nov.) ; `409 IDENTIFIER_ALREADY_ASSIGNED` affiché sur le champ, test en direct `#26 custody` (`e2e/api.spec.ts:610`) | — | — |
| 26-2 | « Un placement courant lie un seul exemplaire à une seule cellule » | Livré et vérifié | Index `ux_asset_placements_one_current_per_*` ; `COMPARTMENT_ALREADY_OCCUPIED` sur la cellule, test en direct (même test) ; `GET /admin/lockers` donne l'occupation sans UUID codé en dur (réel) | — | — |
| 26-3 | « Une mutation conflictuelle est refusée avec une erreur stable » | Livré et vérifié | Les quatre refus de #133 (`ASSET_HAS_OPEN_LOAN`, `ASSET_ALREADY_RESERVED`, `ASSET_OPERATION_IN_PROGRESS` ×2) : sonde 9, réel | — | — |
| 26-4 | Tâche Web : gestion de l'étiquette et du placement | Livré, recette humaine en attente | #140 ; `EquipmentPage.custody.test.tsx` ; direction visuelle acceptée par Philippe le 6 nov. | Recette humaine §2 non faite | — |
| 26-5 | Historique des identifiants révoqués conservé et lisible | Livré et vérifié | `GET /admin/assets/{id}/identifiers` : actifs d'abord, puis historique, lu par la page Équipements et par le test en direct `#26 custody` ; un exemplaire archivé reste lisible, sans identifiant actif (réel) | — | — |

### #27 CFG-01 : règles de l'actif

| ID | Critère | Statut | Preuve | Écart | Tranche |
|---|---|---|---|---|---|
| 27-1 | « Statut opérationnel, échéance de calibration et niveau d'accès requis sont modifiables » | Livré, recette humaine en attente | `AssetFormDialog` ; `CAT-01 forms` (live) passe l'exemplaire en `MAINTENANCE` ; audit du 6 nov. sur la carte #27 | Revue d'un second membre (Definition of Done) et recette humaine 3 à 4 en attente | — |
| 27-2 | « Chaque changement est audité » | **Partiel** | L'API écrit `ASSET_UPDATED` avec `changes.operationalStatus.{from,to}` (sonde 2, réel) | **Le Manager n'affiche pas ce `changes`** : le détail d'audit annonce « 1 champ structuré n'est pas affiché ». La recette #27 doit lire l'audit en SQL | R1 |
| 27-3 | « Données de démonstration : A1 conforme, A2 à calibration expirée » | Livré, recette humaine en attente | `seed-demo-catalog.py` : `AEG-DEMO-002` en A2 `BLOCKED [CALIBRATION_EXPIRED]` (sonde 7, réel) ; `AEG-DEMO-001` en A1 `UNKNOWN` | `READY` en A1 exige un scan du simulateur : non rejoué (pas de broker). Le script échoue en `409 COMPARTMENT_ALREADY_OCCUPIED` sur une base où d'autres exemplaires occupent A1 ou A2, comportement attendu | — |
| 27-4 | Tâche Web : formulaire de règles | Livré, recette humaine en attente | Intégré au formulaire d'exemplaire (aucun doublon, décision de la carte) | — | — |

### #28 CFG-02 : horaires du casier

| ID | Critère | Statut | Preuve | Écart | Tranche |
|---|---|---|---|---|---|
| 28-1 | « L'horaire du casier est configurable avec un fuseau explicite » | Livré, recette humaine en attente | `GET/PUT /admin/lockers/{id}/operating-schedule` ; `CFG-02 schedule` (`e2e/api.spec.ts:513`, live) ; `scheduleDraft.test.ts`, `LockersPage.schedule.test.tsx` | Recette humaine §3 non faite | — |
| 28-2 | « Une période qui traverse une fermeture est refusée » | Livré et vérifié | Refus `422 RESERVATION_END_AFTER_CLOSING` et `OUTSIDE_OPERATING_HOURS`, tests Backend (commentaire #28 du 3 nov.) ; recette cloud R3 (QA) | **Non rejoué ici** : créer une réservation exige une présence `READY`, donc le simulateur MQTT | — |
| 28-3 | Tâche Web : éditeur d'horaire | Livré, recette humaine en attente | #139 ; sept jours, une plage par jour, fuseau affiché | — | — |
| 28-4 | Distinguer horaire non configuré et casier inconnu | Livré et vérifié | `404 OPERATING_SCHEDULE_NOT_CONFIGURED` pour un horaire absent, `404 RESOURCE_NOT_FOUND` pour un casier inconnu (sonde 0 et sonde 10, réel) ; `LockersPage.schedule.test.tsx` | — | — |

### #48 LOAN-01 : chaîne de garde active

| ID | Critère | Statut | Preuve | Écart | Tranche |
|---|---|---|---|---|---|
| 48-1 | « Titulaire, équipement et heure de début visibles pour l'administrateur » | Livré, recette humaine en attente | `/reservations-prets` (#163) ; G1 : `holder {id, displayName}` lu et affiché (sonde 3 : 3 prêts, 33 réservations, détails tous lus) ; recette staging S5 | Données **synthétiques** seulement : aucune route de `dev` ne crée un prêt | — |
| 48-2 | « … visibles pour le technicien » | Hors périmètre Web | API #127 (`GET /me/loan`), iOS #128 | — | iOS |
| 48-3 | « Un prêt en retard ne rend pas l'équipement disponible » | Livré et vérifié | `GET /admin/assets/{id}` : `availability = BORROWED`, `reasons = [NOT_AVAILABLE, …]` ; vue technicien `BLOCKED` (sonde 8, réel) ; le Web lit `overdue` tel quel (`ReservationsLoansPage.test.tsx:290`) ; texte « l'équipement reste emprunté » (navigateur) | — | — |
| 48-4 | « Un équipement n'a jamais deux prêts ouverts » | Livré et vérifié | Index partiel unique `ux_loans_one_open_per_asset` sur `ACTIVE` et `RETURN_PENDING` (lu dans la base) ; `CustodySchemaTests` (Backend) | — | — |
| 48-5 | Prêt créé par un retrait confirmé physiquement (#47) | Bloqué par contrat non fusionné | #175 (`CheckoutConfirmation`) | Aucun prêt réel sur `dev` | Rejouer §5 |
| 48-6 | Retour en cours puis terminé par un retour confirmé (#50, #51) | Bloqué par contrat non fusionné | #176 (`ACTIVE → RETURN_PENDING` à l'autorisation), #177 (`COMPLETED`) | Texte « Retour en cours » vérifié sur un prêt synthétique ; le parcours réel ne l'est pas | Rejouer §5 |
| 48-7 | Passer d'une réservation accomplie à son prêt | Partiel | La réservation `FULFILLED` renvoie vers les opérations de l'équipement, jamais vers ses prêts (`TransactionDossier.tsx:248`) ; décision G8 : aucun prêt n'est déduit | Le filtre `equipement` des prêts existe : un lien « Voir les prêts de cet équipement » est possible sans rien déduire | R2 |

### #52 ANO-01 : créer et traiter une anomalie

| ID | Critère | Statut | Preuve | Écart | Tranche |
|---|---|---|---|---|---|
| 52-1 | « Un écart entre l'attendu et l'observé crée une anomalie » | Bloqué par contrat non fusionné | Sur `dev`, seul `CommandAcknowledgements` écrit une anomalie. Les écarts physiques (`EXPECTED_ASSET_NOT_OBSERVED`, `UNEXPECTED_ASSET_OBSERVED`, `INCONSISTENT_PHYSICAL_STATE`, `DEVICE_OFFLINE_DURING_OPERATION`) viennent de #175 et #177 | Lecture prête côté Web, production non fusionnée | Rejouer §5 |
| 52-2 | « L'administrateur peut la reconnaître » | Livré, recette humaine en attente | Navigateur réel : note, `POST …/acknowledge`, état API `ACKNOWLEDGED` et `resolvedAt = null` (sonde navigateur, b11) ; `AnomaliesPage.acknowledge.test.tsx` (13 cas dont rejeu de clé et deux 409) ; staging S6 | Recette humaine non faite | — |
| 52-3 | « Elle n'est résolue qu'après une preuve correctrice ou une action métier vérifiable » (garde) | Livré et vérifié | Aucun bouton « Résoudre » (contrôles du dossier énumérés) ; `POST /admin/anomalies/{id}/resolve` : `404` (sonde 5, réel) ; le Web n'émet aucune écriture sur les anomalies hors `acknowledge` (§3, T12) | — | — |
| 52-4 | Mécanisme de résolution par nouvelle observation | Bloqué par contrat non fusionné | Aucune écriture de `RESOLVED` dans `src/main` de `dev` | Aucune anomalie ne peut être résolue sur `dev` ; #175 et #177 | Rejouer §5 |
| 52-5 | Dossier : « opération et prêt liés » (`sections.md` §5.5) | Partiel | L'opération liée est un identifiant en clair (`AnomalyDossier.tsx:225`) | Pas de lien vers l'opération ni vers l'audit | R2 |
| 52-6 | Types d'anomalie traduits en FR et EN (D5) | Livré et vérifié | Les sept types, les trois gravités et statuts ; type inconnu replié en français seulement ; `AnomaliesPage.test.tsx:92-125` ; EN sans reste de français (navigateur, 8 dossiers) | — | — |

### #53 AUD-01 : reconstituer la chronologie d'une opération

| ID | Critère | Statut | Preuve | Écart | Tranche |
|---|---|---|---|---|---|
| 53-1 | « La chronologie lie utilisateur, réservation ou prêt, commande, ACK, porte, RFID et résultat » | **Partiel** | Filtre `?operation=<id>` : huit événements ordonnés, du plus récent, avec acteur, de → vers, résultat (navigateur, opération 604, synthétique) ; chaque type d'événement de `dev` et des PR #173 à #177 a son libellé FR et EN (comparaison du catalogue avec `AuditEventType.java`) | L'écran Audit ne renvoie pas vers la réservation, le prêt ni l'opération (`AuditDossier.tsx:143-150` : filtres seulement). La preuve RFID n'est visible que par l'anomalie, et la forme des références physiques n'est pas définie : l'écran le dit | R2 |
| 53-2 | « Horodatage et corrélation lisibles par l'administrateur » | Livré, recette humaine en attente | Heures du laboratoire à la seconde, fuseau écrit ; `operationId` filtrable ; `AuditPage.test.tsx` (28 cas) ; staging S7 | Recette humaine non faite | — |
| 53-3 | « L'historique n'est jamais effacé de façon destructrice » | Livré et vérifié | Déclencheur : `UPDATE` et `DELETE` de `aegis.audit_events` refusés (« append-only », sonde 5, réel) ; le Web n'a aucune écriture d'audit | — | — |
| 53-4 | Détails d'événement (qui a changé quoi) | **Partiel** | Les `details` scalaires s'affichent (`ANOMALY_ACKNOWLEDGED`, `COMMAND_*`…). Les cinq types du catalogue et de l'horaire (`ASSET_CREATED`, `ASSET_UPDATED`, `ASSET_PLACEMENT_CHANGED`, `ASSET_IDENTIFIER_ASSIGNED`, `SCHEDULE_UPDATED`) envoient des objets imbriqués : « 2 champs structurés ne sont pas affichés » (navigateur, sonde 2) | `parseAuditDetails` (`features/audit/contractParsers.ts:17`) suppose un objet plat. `AuditDetailsFilter.java` implémente une liste de **chemins** complets (`changes.operationalStatus.to`, `windows[].opensAt`), ce que dit 09 §19.1 (« chemin complet »). `audit.integration.test.ts` échoue sur ces données (« sends details as an object of scalar values only ») | R1 |
| 53-5 | Libellés des nouveaux événements des PR #173 à #177 | Livré et vérifié | Onze types ajoutés par la pile (`OPERATION_AUTHORIZED`, `LOCAL_CHALLENGE_CONSUMED`, `LOAN_RETURN_STARTED`, …) tous présents dans `i18n/messages/{fr,en}.ts` ; un type inconnu s'affiche « Événement non reconnu · CODE » | Événements réels de la pile non rejoués | Rejouer §5 |
| 53-6 | Inspecteur : « anomalie liée → lien Audit filtré par `operationId` » (`sections.md` §5.3) | **Manquant** | Le dossier d'opération montre `anomalyId` en clair et n'a aucun lien vers l'audit (`TransactionDossier.tsx:426`) | Aucun lien Opération → Audit, ni Anomalie → Audit | R2 |

### #159 WEB-OV : vue d'ensemble

| ID | Critère | Statut | Preuve | Écart | Tranche |
|---|---|---|---|---|---|
| 159-1 | « Chaque bloc lit sa propre route ; si un bloc échoue, les autres restent lisibles » | Livré, recette humaine en attente | #170 ; `OverviewPage.test.tsx:304-405` ; navigateur réel : une lecture par question (anomalies, prêts ×2, opérations ×7, réservations, casiers, statut du casier), totaux égaux à l'API (anomalies 4, prêt en retard 1, opération en cours 1, réservations actives 2) | Staging S8 : après déploiement | — |
| 159-2 | « Route non servie (404 de liste), injoignable ou interdite : état explicite, jamais zéro » | Livré, recette humaine en attente | Navigateur : 404 de liste avec `traceId`, 403, injoignable, 500 avec `traceId` ; tests unitaires | S8 | — |
| 159-3 | « Fraîcheur visible ; casier hors ligne et données périmées suivent §5.1 » | Livré, recette humaine en attente | « Mis à jour à 08 h 14 HNE » ; bandeau « état inconnu » du casier (réel, MQTT désactivé) ; l'état `OFFLINE` n'est testé qu'en unitaire | Pas de heartbeat réel : `OFFLINE` non rejoué | — |
| 159-4 | « FR/EN, sombre/clair, clavier et petits écrans vérifiés sur le rendu » | Livré et vérifié | QA : revue rendue 35/0 sur `482714a` (#159, commentaire du 11 nov.). Ici : EN sans reste de français, 320 px sans défilement horizontal sur la vue d'ensemble | Clair/sombre et clavier non rejoués ici | — |

## 3. Contrôles transverses du mandat

| ID | Contrôle (mandat #67) | Statut | Preuve | Écart | Tranche |
|---|---|---|---|---|---|
| T1 | Lecture réservation → prêt → retour avec **données réelles** | Bloqué par contrat non fusionné | Aucun producteur de prêt, de retour ni d'anomalie physique sur `dev` (§0) | Tout est lu sur données synthétiques | Rejouer §5 |
| T2 | Actualisation manuelle, hors ligne, périmé | Livré et vérifié | « Actualiser » sur chaque page ; refus 403 retire les données ; échec de rafraîchissement garde la liste et dit « Données non actualisées » avec l'heure (navigateur : 08 h 18) | — | — |
| T3 | **Rechargement de page** | Bloqué par contrat non fusionné | Sur `dev` la session vit en mémoire (`features/auth/session.ts`) : un `reload` ramène à `/connexion`, puis à `/equipements` (`README.md` « returnTo », Q5) ; observé en navigateur | Le dossier consulté est perdu. #180 (cookie de session révocable, `POST /auth/session/refresh`) change ce comportement ; elle modifie 110 fichiers, dont 70 dans `apps/admin-web` | B1 |
| T4 | Changements de compte | Livré et vérifié | Réel : rôle ramené à technicien → `403 FORBIDDEN` sur les routes admin, `/auth/me` encore `200 TECHNICIAN` ; la page affiche « Votre compte n'a pas accès… », sans donnée. Compte désactivé ou archivé → `401 AUTH_TOKEN_INVALID` → retour à la connexion « Votre session n'est plus valide » (sonde 5, navigateur) ; technicien refusé à la connexion (live, test 2) | Après une baisse de rôle, le Manager reste dans sa coque (liens, déconnexion) jusqu'au prochain `/auth/me` (`staleTime` 5 min) : aucune donnée n'est montrée entre-temps | — |
| T5 | Opérations en attente, expirées, en échec | Partiel | Tous les états lus sans erreur de forme, dont `AWAITING_LOCAL_PROOF` avec défi, `COMMAND_ACKNOWLEDGED`, `DOOR_OPENED`, `EXPIRED`, `FAILED`, `ANOMALY` (sondes 3 et 4, synthétiques) | Le dossier d'une réservation ou d'un prêt ne donne que « Ouvrir l'opération 5eed0000… » : l'état de la tentative n'est visible qu'après un clic | R4 |
| T6 | Projection différée | Partiel | Une réservation `ACTIVE` dont `reservedUntil` est passé, avec une opération en cours : l'API la garde `ACTIVE` (expiration différée, 09 §8.10) ; le Web affiche « Active » et « Aucune issue : la réservation est active » sans l'expliquer (navigateur, fixture `f03`) | Aucun polling : après un changement serveur, le dossier garde « Commande acquittée » jusqu'au clic sur « Actualiser » (6 s sans changement, puis « Porte ouverte ») | R4, R5 |
| T7 | Vide, interdit, injoignable, 404 de liste, 5xx | Livré et vérifié | Navigateur : injoignable (« Connexion au service impossible »), 404 de liste → erreur du service avec identifiant de suivi, 403, 500, périmé ; `ReservationsLoansPage.test.tsx:385-448`, `AuditPage.test.tsx:362-404` | Une réponse d'erreur sans corps de problème complet (sans `traceId`, `instance`…) est lue « injoignable » : voulu (`api/problem.ts`) | — |
| T8 | Texte FR/EN cohérent | Livré et vérifié | `catalog.test.ts` (parité des clés) ; navigateur EN : 8 dossiers, audit, vue d'ensemble, sans mot de français | Les codes bruts restent visibles en détail technique (`failureReason`, types d'événement) : voulu (G12) | — |
| T9 | **ACK de commande ≠ achèvement physique** | Livré et vérifié | Pastille « Commande acquittée » (rôle progression), séquence « Commande acquittée par la cellule », note permanente « Un accusé de commande ne prouve ni le déverrouillage ni l'ouverture » ; « Retrait confirmé » n'existe que si `checkedOutAt` existe ; aucune étape n'est déduite de la suivante (navigateur) | — | — |
| T10 | **Aucun secret de QR exposé** | Livré et vérifié | La vue d'opération réelle a exactement les 25 clés de 09 §8.5 ; `localAccessChallengeId` est un identifiant seul (sonde 4, avec une ligne `local_access_challenges` : `token_hash` et session d'appareil absents) ; balayage de 56 réponses : ni valeur RFID, ni mot de passe, ni jeton ; le Web ne stocke que la langue et l'apparence | À revérifier sur #173 : raisons d'échec `LOCAL_PROOF_*` et détails d'audit | Rejouer §5 |
| T11 | **Reconnaissance ≠ résolution** | Livré et vérifié | Navigateur : « Anomalie reconnue. Elle n'est pas résolue. », pastille « Reconnue », API `ACKNOWLEDGED` / `resolvedAt = null` ; un second `acknowledge` d'une clé neuve donne `ANOMALY_NOT_ACKNOWLEDGEABLE` (test d'intégration, passe) | Texte « la vérification est engagée » : repris de 05 §6.2 (« correction physique engagée »), n'affirme aucune résolution | — |
| T12 | **Aucune action Résoudre ni Déverrouiller sans contrat approuvé** | Livré et vérifié | Les seules écritures du Web : `/auth/login`, catalogue (modèles, exemplaires, archivage), identifiants (assigner, révoquer), placement, horaire, `acknowledge`. Aucune sur prêts, opérations ou casiers. API : `resolve`, `unlock` (casier, cellule), `confirm`, `complete`, `force-return`, `mqtt/messages/raw` → `404` (sonde 5, réel) ; `availableActions` toujours `[]` en lecture admin et jamais affiché | — | — |
| T13 | Navigation de parcours (liens croisés) | Partiel | Existe : Vue d'ensemble → dossiers ; réservation ↔ opération ; prêt → opération ; opération → réservation et prêt. Manquent : opération ↔ anomalie, opération et anomalie → audit, audit → opération, réservation accomplie → prêts, Équipements → prêts, réservations, audit | Voir R2, R3 | R2, R3 |
| T14 | Lisibilité de la liste des opérations | Partiel | Une ligne montre « Équipement : identifiant seulement 5eed0000… » ; le dossier résout l'équipement et la cellule par `GET /admin/assets/{id}` | Conforme au design approuvé (G3, état `join-failed`), mais l'administrateur ne peut pas parcourir la liste sans ouvrir chaque ligne | R7 |
| T15 | Lien Casiers → opérations du casier (`sections.md` §5.4, U5) | Manquant | `console-handoff.md` §4.2 : « reste à ajouter dans Casiers » ; le gateway accepte `lockerId`, `readTransactionLocation` l'ignore | — | R3 |
| T16 | Régression navigateur contre l'API réelle pour Vue d'ensemble, Réservations et prêts, Anomalies, Audit | Manquant | `e2e/api.spec.ts` : 12 tests, aucun sur ces quatre pages. Seuls existent les tests de parseurs `src/integration/*` (qui n'appellent jamais `getLoan`, `getReservation`, `getLockerOperation`) et le script QA `web-review.mjs` | La preuve appartient à QA seul | R6 |

## 4. Écarts réels, classés

Ordre : ce que `dev` permet déjà, du plus important au moins important ; chaque tranche reste petite et liée à une carte.
« Refs » : aucune ne ferme sa carte.

### R1 : afficher les `details` d'audit à chemins imbriqués (Refs #53, #27, #25)

- **Constat.** Réel, §6 sondes 1 et 2. `GET /admin/audit-events` renvoie, pour `ASSET_CREATED`, `ASSET_UPDATED`,
  `ASSET_PLACEMENT_CHANGED`, `ASSET_IDENTIFIER_ASSIGNED` et `SCHEDULE_UPDATED`, des objets dont les feuilles sont les scalaires de
  la liste `AuditDetailsFilter` (par exemple `{"changes":{"operationalStatus":{"from":"SERVICEABLE","to":"MAINTENANCE"}}}`,
  `{"windows":[{"dayOfWeek":"MONDAY","opensAt":"07:00:00",…}]}`, `endedOperationIds[]`). Le Web compte ces valeurs comme « non
  scalaires » et ne montre rien. Un test d'intégration existant échoue sur ces données.
- **Fichiers.** `apps/admin-web/src/features/audit/contractParsers.ts` (aplatir en chemins pointés, profondeur et taille bornées,
  toute feuille non scalaire toujours comptée et masquée), `auditPresentation.ts` (`detailRows`), `contract.ts`,
  `i18n/messages/{fr,en}.ts` (`audit.detailKey` : `changes.<champ>.from`, `.to`, `from.*`, `to.*`, `windows[]`),
  `src/integration/audit.integration.test.ts` (l'assertion « objet plat » devient « feuilles scalaires »).
- **Contrat utilisé.** 09 §19.1 (« chemin complet… valeur scalaire ») et le code de `AuditDetailsFilter`. Aucun nouveau contrat.
  **Demande au Backend :** confirmer par une phrase de 09 §19.1 que les conteneurs imbriqués sont voulus ; sans cela, le texte reste
  ambigu (voir D3).
- **Plan de test.** Unitaire avec les échantillons réels de la sonde 2 ; `AuditPage.test.tsx` ; réel : exécuter les flux du
  catalogue puis ouvrir `/audit?type=ASSET_UPDATED` (attendu « Statut opérationnel : En service → En maintenance ») ;
  `AEGIS_IT_API_ORIGIN=… npx vitest run src/integration` doit passer en entier (13 tests, le 14e est ignoré sans `AEGIS_IT_ACK_ANOMALY_ID`) ; un champ non scalaire reste masqué et compté.

### R2 : relier opération, anomalie, audit, réservation et prêt (Refs #53, #52, #48)

- **Constat.** §2 lignes 48-7, 52-5, 53-1, 53-6 ; §3 T13. Aujourd'hui seuls des identifiants en clair relient ces écrans.
- **Fichiers.** `features/transactions/TransactionDossier.tsx` (anomalie liée → `anomaliesHref`, « Audit de cette opération » →
  `/audit?operation=`, réservation `FULFILLED` → `vue=prets&equipement=`), `features/anomalies/AnomalyDossier.tsx` (opération liée →
  dossier ; audit), `features/audit/AuditDossier.tsx` (opération → dossier d'opération), `i18n/messages/{fr,en}.ts` (trois ou quatre
  libellés à marquer [P] jusqu'à relecture).
- **Contrat utilisé.** Aucun nouveau : routes et paramètres d'adresse existants (`?anomalie=`, `?operation=`, `?vue=prets&equipement=`).
- **Plan de test.** Tests de page pour chaque lien et pour son absence quand l'identifiant est nul ; réel : de l'opération 604
  jusqu'à l'anomalie b04 puis à l'audit filtré, sans saisir d'identifiant ; clavier et ordre de tabulation.

### R3 : entrées de parcours depuis Casiers et Équipements (Refs #48, #53)

- **Constat.** T15 et T13. Le design approuvé note le lien Casiers → opérations du casier comme « à ajouter ».
- **Fichiers.** `features/transactions/transactionHref.ts` et `useTransactionQueries.ts` (paramètre `lockerId`, déjà accepté par
  `httpTransactionGateway.ts:7`), `features/transactions/TransactionFilters.tsx` (puce de filtre, pas de champ libre),
  `features/lockers/LockerStatusPanel.tsx`, `features/catalog/AssetDossier.tsx` (réservations, prêts, opérations et audit de
  l'exemplaire), i18n.
- **Contrat utilisé.** `GET /admin/locker-operations?lockerId=` (09 §17), `assetId`. Rien de nouveau.
- **Plan de test.** Requête envoyée exactement avec `lockerId` ; adresse relue après actualisation ; réel sur les opérations
  synthétiques du casier de démonstration.

### R4 : état de la tentative courante dans les dossiers de réservation et de prêt (Refs #48, #53)

- **Constat.** T5 et T6.
- **Fichiers.** `features/transactions/TransactionDossier.tsx`, `useTransactionQueries.ts` (lecture de l'opération par
  `currentOperationId`, comme `useAsset` le fait déjà pour l'équipement), i18n.
- **Contrat utilisé.** `currentOperationId` (09 §8.4, règle approuvée du 11 nov.) et `GET /admin/locker-operations/{id}`.
  L'explication d'une réservation « Active » après son échéance s'appuie sur l'état de la tentative lu au serveur, non sur
  l'horloge du navigateur ; sans tentative lisible, aucun texte n'est ajouté.
- **Plan de test.** Unitaire : tentative `FAILED`, non terminale, lecture en échec (retombée sur le lien) ; réel : fixtures
  `509` (échec) et `f03` (expiration différée).

### R5 : actualisation bornée des opérations non terminales (Refs #53, #48)

- **Constat.** T6. Seul l'état du casier est interrogé (toutes les 15 s, `useLockerStatus.ts:15`).
- **Fichiers.** `features/transactions/useTransactionQueries.ts`, `features/overview/useOverviewQueries.ts` (bloc « Opération en
  cours »).
- **Contrat utilisé.** Les mêmes lectures. **Décision à prendre :** période et périmètre (dossier sélectionné seulement, ou liste
  visible). Pas de changement visuel ; l'heure « Mis à jour à » existante suffit.
- **Plan de test.** `refetchInterval` conditionnel (arrêt quand l'opération est terminale, onglet masqué ou erreur 4xx) ; compter les
  requêtes sur 60 s ; réel : passer `f04` d'un état à l'autre par SQL et lire le changement sans clic.

### R6 : recette navigateur en direct des pages de la chaîne de garde (Refs #159, #48, #52, #53)

- **Constat.** T16.
- **Fichiers.** `apps/admin-web/e2e/` (nouveau fichier de spécification et un projet dans `playwright.api.config.ts`),
  `README.md` du Web. Le seed est celui de QA (`docs/qualite/manager-admin/seed-synthetic.sql`), référencé et non copié.
- **Contrat utilisé.** Aucun.
- **Plan de test.** Lecture des quatre pages, reconnaissance d'une anomalie synthétique, absence d'action de garde, retour à la
  connexion après désactivation du compte. Dépend de R1 pour l'audit.

### R7 : lignes de la liste d'opérations lisibles (Refs #53) — décision requise avant tout code

- **Constat.** T14. Soit des lectures `GET /admin/assets/{id}` groupées et mises en cache (une par ligne d'une page de 20), soit
  l'ajout additif de `asset` et `user` aux vues d'opération, option que le design (G3) préfère. **Le choix revient à Philippe et
  au Backend** : rien n'est inventé ici.

### R8 : documentation Web (Refs #158, #48)

- Voir §7 : D1, D2, D4. Documents seulement.

### Bloqué : à rejouer sur une référence d'intégration épinglée

- **B1 : #180** (`178-feat-manager-session-reload`). Rechargement, restauration, déconnexion confirmée, effacement du cache.
  La PR modifie 70 fichiers de `apps/admin-web`, dont `AcknowledgeDialog.tsx`, `AnomaliesPage.tsx`, `anomalyFailure.ts`,
  `AuditPage.test.tsx` et `auditPresentation.test.ts` : R1 et R2 recouvrent ces fichiers. Elles doivent attendre sa fusion, ou être
  rebasées dessus sans réécrire l'historique ; l'ordre est à fixer avec Philippe.
- **B2 : #173 → #175 → #176 → #177.** À rejouer, avec des données produites par la chaîne et un vrai broker jetable : défi affiché
  (`AWAITING_LOCAL_PROOF`, `SCAN_HUB_QR`), prêt réel puis `RETURN_PENDING` puis `COMPLETED`, anomalies physiques et leur résolution,
  les onze nouveaux types d'audit, les raisons d'échec `LOCAL_PROOF_*`, absence de tout secret.

## 5. Ce que `dev` ne livre pas encore

| Dépendance | Effet attendu sur le Manager | Vérification à refaire |
|---|---|---|
| #173 `79d19a0` (QR, autorisation) | Opérations `AUTHORIZED`, audits `OPERATION_AUTHORIZED`, `LOCAL_CHALLENGE_*`, échec `LOCAL_PROOF_ATTEMPTS_EXHAUSTED` | T10 (aucun secret), 53-5 |
| #175 `89af9f1` (retrait confirmé) | Premier prêt réel `ACTIVE`, réservation `FULFILLED`, anomalie `INCONSISTENT_PHYSICAL_STATE`, `OBSERVATION_RECEIVED` | 48-5, 52-1, T1 |
| #176 `fd25b3b` (préparation du retour) | Opération `RETURN`, prêt `RETURN_PENDING` dès l'autorisation | 48-6 |
| #177 `47dac78` (retour confirmé) | Prêt `COMPLETED`, anomalies `UNEXPECTED_ASSET_OBSERVED`, `EXPECTED_ASSET_NOT_OBSERVED`, résolution | 52-1, 52-4, T1 |
| #180 `e27baad` (session) | Rechargement sans reconnexion, déconnexion confirmée | T3 |
| #174 (outillage QA, indépendant) | Contrôles Q1 à Q9 et revue de la vue d'ensemble | Aucun effet sur `dev` |

Aucune de ces PR n'est fusionnée à la date de cette matrice (`gh api repos/PhilJordan18/aegis/pulls/<n>` : `open`, `merged=false`).
#178 et #179 n'existent pas comme PR : #180 porte #178.

## 6. Preuves réelles : commandes et résultats

Pile : API Spring de ce checkout (`services/api`, `c6845e6`), PostgreSQL 16.15 natif sur 127.0.0.1, MQTT désactivé, ni Docker ni
Mosquitto. Mots de passe aléatoires, écrits dans des fichiers `600` hors dépôt, supprimés en fin de revue. Aucun hub, aucun staging.

```bash
# Base jetable (initdb refuse root : utilisateur postgres, répertoire dédié sous /var/tmp)
runuser -u postgres -- /usr/lib/postgresql/16/bin/initdb -D <dir>/data -U aegis --auth=scram-sha-256 --pwfile=<fichier-mdp>
runuser -u postgres -- pg_ctl -D <dir>/data -o "-c listen_addresses=127.0.0.1 -p 55432" start      # puis CREATE DATABASE aegis
# API
cd services/api && ./mvnw -B -q -ntp -DskipTests package
AEGIS_DB_HOST=127.0.0.1 AEGIS_DB_PORT=55432 AEGIS_DB_PASSWORD=<aléatoire> AEGIS_JWT_SECRET=<base64 aléatoire> \
AEGIS_DEMO_ACCOUNTS_ENABLED=true AEGIS_DEMO_LOCKER_ENABLED=true AEGIS_DEMO_ADMIN_PASSWORD=<aléatoire> \
AEGIS_DEMO_TECHNICIAN_PASSWORD=<aléatoire> AEGIS_MQTT_ENABLED=false SERVER_PORT=18091 \
AEGIS_WEB_ALLOWED_ORIGINS=http://localhost:5181 java -jar target/aegis-control-0.1.0-SNAPSHOT.jar
# Web
cd apps/admin-web && npx vitest run                                             # 63 fichiers, 1154 tests : passés
AEGIS_API_ORIGIN=http://127.0.0.1:18091 npx playwright test -c playwright.api.config.ts --trace off   # 12/12
```

| Sonde | Commande ou méthode | Résultat |
|---|---|---|
| 0 | Listes admin et audit sur base vide ; `GET /admin/lockers` ; statut du casier ; horaire | Cinq listes `200`, `items: []`, `totalItems: 0` ; casier `UNKNOWN` ; horaire `404 OPERATING_SCHEDULE_NOT_CONFIGURED` |
| 1 | Suite en direct `playwright.api.config.ts` | 12 passés sur 12 (catalogue, horaire, identifiants, placement, recherche, casiers) |
| 2 | Après les flux réels et le seed synthétique : parcours de tout l'audit (74 événements), `vitest run src/integration` avec `AEGIS_IT_API_ORIGIN` | **12 passés, 1 échec, 1 ignoré** : « sends details as an object of scalar values only (D9) ». Les cinq types ci-dessus portent des objets imbriqués. Aucune valeur RFID, aucun mot de passe |
| 3 | `createHttpTransactionGateway` et `createHttpAnomalyGateway` de production contre l'API réelle, listes puis détail de chaque ligne | Réservations 33/33, prêts 3/3, opérations 9/9, anomalies 7/7 lus ; clés égales à 09 §8.3, §8.4, §8.5, §8.7 (plus `user` et `holder`) ; `availableActions` toujours `[]` ; balayage de 56 réponses sans valeur RFID, mot de passe, jeton ni témoin de fuite |
| 4 | Fixture synthétique `f01` à `f05` : une opération `CHECKOUT` poussée par SQL de `AWAITING_LOCAL_PROOF` à `EXPIRED`, lue par l'API et le gateway | Chaque état est lu sans erreur ; `requiredAction` = `SCAN_HUB_QR` puis `WAIT` puis `NONE` ; `localAccessChallengeId` renseigné, aucune colonne secrète du défi |
| 5 | Compte administrateur B jetable : rôle abaissé, désactivé, archivé ; jeton invalide ; huit routes interdites | `403 FORBIDDEN` (rôle) ; `401 AUTH_TOKEN_INVALID` (désactivé, archivé, jeton absent ou invalide) ; reconnexion refusée `AUTH_INVALID_CREDENTIALS` ; routes interdites `404 RESOURCE_NOT_FOUND` ; technicien `403` sur les cinq routes admin ; `UPDATE` et `DELETE` d'audit refusés |
| 6 | Filtres et identifiants invalides, curseur forgé, identifiant inconnu | `400 VALIDATION_ERROR` avec `violations[{field:"status", code:"INVALID_VALUE"}]`, `400 INVALID_CURSOR`, `404 RESOURCE_NOT_FOUND` ; corps de problème complets (`traceId`, `instance`, `timestamp`) |
| 7 | `seed-demo-catalog.py`, refus d'archivage | `AEG-DEMO-002` `BLOCKED [CALIBRATION_EXPIRED]` en A2 ; `409 ASSET_ALREADY_RESERVED` et `ASSET_HAS_OPEN_LOAN` |
| 8 | Disponibilité d'actifs prêtés | Prêt en retard et prêt `RETURN_PENDING` : `BORROWED` ; prêt terminé : `AVAILABLE` ; vue technicien `BLOCKED [NOT_AVAILABLE]` |
| 9 | Refus de placement et d'identifiant | `ASSET_HAS_OPEN_LOAN`, `ASSET_ALREADY_RESERVED`, `ASSET_OPERATION_IN_PROGRESS` ×2 |
| 10 | Horaire d'un casier inconnu ; exemplaire archivé | `404 RESOURCE_NOT_FOUND` ; archivé : `200`, `archivedAt` renseigné, aucun identifiant actif |
| Navigateur | Chromium, Manager de production servi par `vite preview` sur `127.0.0.1:5191`, API sur 18091, `fr-CA` et `en-CA`, `America/Toronto` | Pages Réservations, Prêts, Opérations, Anomalies, Audit, Vue d'ensemble lues sur l'API réelle ; reconnaissance de b11 ; liens, contrôles et textes relevés ; échecs simulés par routage navigateur (injoignable, 404 de liste, 403, 500, rafraîchissement en échec) ; 320 px : aucun défilement horizontal sur cinq écrans ; aucune erreur de page |

Limites assumées :

- Sans broker, aucune réservation ne peut devenir `READY` : `POST /reservations` n'a pas été rejoué, et `OFFLINE` du casier, un
  `OBSERVATION_RECEIVED` ou un prêt réel n'ont pas été produits. Les opérations et prêts lus sont **synthétiques**.
- `AEGIS_WEB_ALLOWED_ORIGINS` n'existe pas sur `dev` (`grep` de `services/api/src/main` : aucune occurrence, aucune configuration CORS). Il
  appartient à #180. Le Manager appelle l'API par le relais same-origin de `vite preview`, sans CORS.
- Clair/sombre, clavier et lecteur d'écran n'ont pas été rejoués ; la preuve est celle de QA (#159).

## 7. Défauts documentaires relevés

| ID | Défaut | Où | Effet | Correction proposée |
|---|---|---|---|---|
| D1 | `docs/design/manager-console/` est cité comme design approuvé le 11 novembre mais **n'existe pas sur `dev`**. Le commit `0371410` n'est que sur la branche **locale** `158-docs-manager-console-design` (`7186fda`) du dépôt partagé : aucune branche distante, la carte #158 reste ouverte | `README.md` du Web lignes 571 et 603 ; commentaires de `OverviewPage.tsx:28`, `ReservationsLoansPage.tsx:47`, `AnomaliesPage.tsx:50`, `overview/OverviewModule.tsx:34`, `i18n/messages/fr.ts` (lignes 466, 636, 905, 1187), `en.ts:827`, quatre feuilles CSS | Le design approuvé n'est pas durable ni vérifiable depuis `dev` ; le handoff G1 à G13 et la matrice d'états y sont seulement | Reprendre ces documents sur une branche d'issue (hors captures volumineuses si Philippe le préfère) ; sans cela, corriger les références |
| D2 | `asset-lifecycle/sections.md` §5.3, §7 (ligne « Réservations, prêts, opérations »), §9 (C4, C7) disent encore « nom du titulaire absent » et listent la pagination comme proposition | `docs/design/asset-lifecycle/sections.md` | Contredit G1 et les règles D1 à D10 de 09 §17 | Note de mise à jour datée, sans réécrire le document |
| D3 | 09 §19.1 écrit « liste explicite de champs scalaires » puis « chemin complet » ; le Backend renvoie des conteneurs imbriqués ; le Web et son test d'intégration lisent un objet plat | `09-contrats-rest.md` §19.1 ; `AuditDetailsFilter.java` ; `audit.integration.test.ts` | Les détails d'audit du catalogue sont invisibles (53-4) | Phrase de précision dans 09 par le Backend (propriétaire des contrats) ; Web aligné par R1 |
| D4 | La table « Ce qu'un utilisateur peut faire sur `dev` (`49bf5f8`) » ne contient aucune ligne pour réservations et prêts, opérations, anomalies, audit ni vue d'ensemble | `docs/qualite/recette-humaine.md` | Le point d'entrée unique ne guide pas ces parcours ; ils sont dans `recette-staging` S5 à S8 et `manager-admin/README.md` §5 | Ligne de renvoi (document de QA : à signaler, non modifié ici) |
| D5 | 09 §8.3 et §8.4 ne listent pas `user` et `holder` ; ils ne sont décrits qu'en prose au §17 | `09-contrats-rest.md` | Lecture facile à manquer ; le Web et la sonde 3 les confirment | Ajouter les deux lignes aux tableaux (Backend) |
| D6 | Le mandat #67 demande `AEGIS_WEB_ALLOWED_ORIGINS` pour l'API de `dev` ; la variable n'y existe pas | commentaire #67 7062915593 | Variable ignorée sans effet | Signaler : valable seulement avec #180 |

## 8. Suite

Aucune tranche n'est lancée. Philippe choisit parmi R1 à R8. Ordre proposé : **R1** (défaut réel, sans décision), puis **R2** et **R3**
(navigation, sans nouveau contrat), **R4**, puis **R5** et **R6** après sa décision sur la période d'actualisation. **R7** attend une
décision de contrat ; **B1** et **B2** attendent les fusions. Chaque tranche livrera sa propre preuve réelle et son rapport.
