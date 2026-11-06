# Matrice des cartes en cours (QA d'intégration)

État au **6 novembre 2026, 08 h 55 (Toronto)**, sur `dev` à `47f34ac`.

**Sources :** corps et commentaires des issues, corps des PR #61 à #129, et `git grep`
sur `origin/dev`. Les relevés de l'inventaire ont été revérifiés sur `dev`.

**Nature des preuves :**

- **matériel** : carte, lecteur ou serrure réels ;
- **pile réelle** : PostgreSQL et Mosquitto réels, API réelle, hub **simulé** ;
- **CI** : GitHub Actions hébergé ; le job API a un vrai Mosquitto depuis #120 ;
- **fixture** : tests unitaires ou données de test ;
- **humain** : parcours manuel de Philippe.

**Statuts proposés.** Ce sont des propositions : cette session ne peut ni lire ni écrire le
board. « In Review » est réservé à un périmètre livré et vérifié qui n'attend plus qu'une
revue ou une recette humaine. Aucune carte n'est à fermer.

## Synthèse

| Carte | Fait (preuve) | Reste (propriétaire) | Statut proposé |
|---|---|---|---|
| #37 RES-01 | Les cinq critères. CI : `639ada8`, run 41890245789 (463/0/0). Humain : 5 nov. sur `decb9c6`. Recette cloud R3 et R5 sur `47f34ac` | Revue de Jimmy | **In Review** (inchangé) |
| #38 RES-02 | Les trois critères (CI). L'expiration pendant un retrait ou un prêt n'est prouvée qu'en fixture. Humain : 5 nov. | Revue de Jimmy. Expiration réelle après #46/#47 | **In Review** (inchangé) |
| #35 DES-01 | Les quatre critères : parcours, matrice d'états, direction approuvée les 21 et 22 oct., handoff | Philippe décide si Q1/Q2 bloquent. `asset-lifecycle/states.md` dit encore « non approuvée » (Design/iOS) | **In Review** |
| #25 CAT-01 | API création, édition et archivage (#96 `5ec4af2`), audit (#101 `32eb1ce`). Recette cloud R1 | **Formulaires Manager** modèle et actif (Web). Fuseau de la date de calibration (Philippe) | In Progress |
| #26 CAT-02 | Unicité de l'étiquette et du placement, refus `409` (#102 `b740bdc`, CI avec PostgreSQL). Recette cloud R2 | **Écrans étiquette et placement** (Web) | In Progress |
| #27 CFG-01 | Champs modifiables par `PUT /admin/assets` et audités. Données A2 expirées (script) | Formulaire de règles, séparé ou intégré à #25 (Web) | Todo |
| #28 CFG-02 | Horaire avec fuseau (#103 `71d1f81`), refus `422` (#106). Recette cloud R3 : refus hors plage et après fermeture **sur la pile réelle**, une première | **Éditeur d'horaire** Manager (Web) | In Progress |
| #29 PHY-01 | `ONLINE` en 30 s ou moins, déduplication, aucun effet sur les prêts (#115 `5ce22b9`, run 41868105338). Portes visibles côté Web (#118 `84a0133`). Recette cloud R4.1 et R6.1 | **Erreurs d'appareil non exposées** : proposition de contrat (Backend), décision (Philippe). Validation avec un vrai hub (#30) | In Progress |
| #31 PHY-02 | Payload brut conservé, scans stables seulement, absence jamais déduite (#113, #119 `e6f405b`). Recette cloud R4.2 et R6.2 (pile réelle, hub simulé) | **Validation avec le vrai lecteur** (#19, Jimmy) | Blocked (matériel) |
| #34 RDY-02 | Même résultat Web et iOS, A2 `CALIBRATION_EXPIRED`, aucune étiquette exposée (API #105, iOS #107, contrôle humain du 5 nov.). iOS hébergé 218/218 (run 41908148728) | Réconciliation QA publiée sur #34. #117 est dépassée par #116 (`891702d`), fermeture recommandée sur #67, sans merge. Revue de Jimmy | In Progress, puis In Review après la réconciliation |
| #48 LOAN-01 | Lecture technicien (#127 `0f96b53`, iOS #128 `decb9c6`). Prêt en retard jamais disponible, un seul prêt ouvert (fixture) | **`GET /admin/loans` autorisé mais sans handler** (Backend). Vue Manager (Web). Démonstration impossible sans #47, exclu | In Progress |
| #41 IOT-02 | Ingestion idempotente des ACK (#123 `1a1c26a`, Mosquitto). Chaîne prouvée par simulateur sur `af3729f` | Trois critères matériels, via #42 (Jimmy) | Blocked (matériel) |
| #109 FIX-01 | `dev` compte encore en UTF-16. **API et contrat : #131** (`7d530f0`, ADR-014 `PROPOSED`) : la recette cloud R7 donne 44/44 sur la pile réelle ; le même R7 échoue sur `dev`, comme attendu. **iOS : #132** (`8bb720c`, empilée sur #131), en attente du macOS hébergé | Acceptation d'ADR-014 (Philippe). PR Web (Web). Vert du job iOS de #132 (QA) | In Progress |
| #19 POC-01 | Aucun critère rempli. Le banc (PR #124) n'a lu aucune vraie étiquette | Étiquettes, seuils, essais d'orientation, faux positifs et faux négatifs, ADR-003 (Jimmy, Philippe) | Blocked |
| #20 POC-02 | Une liaison RS-485 qualifiée sur le matériel (#62 `248fba9`) | Tension T1, seconde liaison A2, actionnement (avec #21), ADR du connecteur (Jimmy, Philippe) | In Progress |
| #23 FW-00 | Squelette compilé (#126 `47f34ac`) et tests sur hôte | Jamais flashé, jamais lancé contre le broker TLS (#129 `cf023ed`), bus de cellules non commencé (Jimmy). Revue indépendante de #126 (QA) | In Progress |
| #30 FW-01 | Code de heartbeat dans #126, testé sur hôte seulement | Flash, capteurs de porte, bus, scénarios SIM-01 (Jimmy) | Todo |
| #32 FW-02 | — | Toute la carte, après #19 et #23 (Jimmy) | Todo |
| #42 FW-03 | — | Toute la carte, après #21 et #23 (Jimmy) | Todo |

## Défauts de preuve relevés

- Le run 41907093850 est cité sur #38 comme un run de `dev`. C'est un run de PR (#127,
  `6e48819`, `pull_request`). La preuve de `decb9c6` sur `dev` est le run de push
  41912577504.
- `docs/design/asset-lifecycle/states.md` dit « proposition non approuvée », alors que #35
  a été approuvée.
- Le corps de #109 renvoie à un « ADR-014 (proposed) » qui n'existe ni dans `docs/adr/`
  ni dans le registre 13 sur `dev`.

## Bloquants transverses

- **Matériel non qualifié** :
  - lecteur RFID et étiquettes (#19, PR #124) ;
  - banc de serrure (#21) ;
  - firmware jamais flashé (#23) ;
  - seconde liaison RS-485 (#20).

  Cela bloque #19, #20, #23, #30, #31 (critère 4), #32, #41 (trois critères) et #42.
  Responsable : Jimmy.
- **Revue par les pairs.** Chaque story attend la revue de Jimmy (document 11, §9).
- **Décisions de Philippe :**
  - erreurs d'appareil dans `LockerStatusView` (#29) ;
  - ADR-003 (#19) ;
  - connecteur et étoile ou repli (#20) ;
  - Q1/Q2 (#35) ;
  - ADR-014 (#109) ;
  - fuseau de la date de calibration (#25).
- **Hors périmètre de la nuit.** #43 à #47 sont exclus. La démonstration de bout en bout
  de #48 et l'expiration réelle de #38 en dépendent.
- **Manager.** Aucun formulaire sur `dev` pour #25, #26, #27 et #28. À 08 h 55, aucune
  branche Web ou Backend de la nuit n'est publiée sur `origin`.
