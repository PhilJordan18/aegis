# Recette humaine : point d'entrée unique

Ce document est le seul point de départ de la recette humaine de Philippe et Jimmy. Il
renvoie aux recettes détaillées et ne les recopie pas.

État au **6 novembre 2026, 16 h 45 (Toronto)**. Avant de commencer, relevez le SHA réel :

```bash
git fetch origin dev && git rev-parse --short origin/dev
```

- **À la rédaction, `dev` est à `49bf5f8`.** Il contient #143, #136, #140, #141, #146, #144, #142 et #148.
- **CI du push `dev` `49bf5f8` : verte** (exécution 42295112103). iOS y est sauté, car aucun
  chemin iOS n'a changé : c'est le premier saut naturel depuis #144.
- **Versions réelles de la recette cloud :**
  - PostgreSQL 17.11 (`postgres:17-alpine`, digest épinglé) ;
  - Mosquitto 2.1.2 ;
  - OpenJDK 21.0.12.1 ;
  - Node 22.23.4.
- Si d'autres PR sont fusionnées, ce SHA change. Notez alors le SHA testé dans le compte
  rendu.
- Deux niveaux de preuve sont séparés ci-dessous :
  - **sur `dev`** : vérifié sur le SHA intégré ;
  - **sur branche** : vérifié sur un arbre local qui fusionne la PR. Cette preuve est à
    refaire après la fusion.

## Prérequis

| Pour | Il faut |
|---|---|
| API, PostgreSQL, Mosquitto | Docker avec Compose, Java 21. Pile `aegis-dev` : `services/api/README.md`, « Démarrage local » |
| Manager (Web) | Node 22.18+. Dans `apps/admin-web` : `npm ci`, puis `npm run dev:api` (relaie `/api` vers l'API locale) |
| App technicien (iOS) | Un Mac avec Xcode 26.3. `apps/ios/README.md`. **Hors de la session cloud :** la recette iOS est humaine ou CI |
| Hub | Simulateur `tools/hub-simulator` (aucune preuve matérielle) ou vrai hub ESP32 (#19, #30, #32, #42) |

## Comptes de test

- **Aucun mot de passe n'est écrit dans le dépôt, une issue ou une PR.**
- **Pile locale :** chacun choisit ses mots de passe dans son propre terminal :
  - `AEGIS_DEMO_ACCOUNTS_ENABLED=true` ;
  - `AEGIS_DEMO_ADMIN_PASSWORD` et `AEGIS_DEMO_TECHNICIAN_PASSWORD` ;
  - entre 12 et 72 octets.
  - Les comptes `admin@aegis.demo` et `technician@aegis.demo` sont créés au démarrage
    (`services/api/README.md`, « Comptes de démonstration »).
- **Environnement partagé :** Philippe transmet les mots de passe en privé, hors GitHub.
  Cette session ne les connaît pas et ne touche pas à Railway.
- **Mot de passe changé sur une base existante :** le provisionnement re-hache le mot de
  passe au démarrage suivant. Rien d'autre n'est modifié.

## Contrôle automatique d'abord (5 min)

Lancez `docs/qualite/recette-cloud/run.sh` depuis la racine, sur la machine qui a Docker.

- **Attendu :** `RECETTE: all checks passed`.
- **Dernier résultat consigné :** 36 sur 36 en 97 s sur `dev` `49bf5f8`.
- **Ce que couvre ce script :** la pile réelle avec le hub simulé.
- **Ce qu'il ne couvre pas :** ni les écrans, ni le matériel.
- **Attention :** ce script occupe tous les compartiments du casier de démonstration. La
  suite Web en direct (`apps/admin-web`, `playwright.api.config.ts`) doit donc tourner
  **avant** lui, ou sur une base neuve. Sinon le test `#26 custody` s'arrête sur sa
  précondition explicite.
- **Partie Manager sur `49bf5f8`, vérifiée par Web**
  ([#67, commentaire 6696012030](https://github.com/PhilJordan18/aegis/issues/67#issuecomment-6696012030)).
  PostgreSQL 16 local, broker et API réels, hub simulé :
  - `check-device-errors-live.sh` : W1 et W2 réussis ;
  - suite Web en direct (`playwright.api.config.ts`) : 12 sur 12 ;
  - formulaires et heure d'été : 28 sur 28 ;
  - vitest : 862 sur 862.
- **Recette humaine Web détaillée :** PR #150, `docs/design/manager-forms/recette-humaine.md`.
- Sur `e50ff08`, QA avait déjà obtenu 12 sur 12 en 77 s sur base neuve.
- **Scénario API `deviceErrors` sur `49bf5f8`** : broker et API réels, hub simulé, sans navigateur.
  - Avant toute session : `UNKNOWN`, liste vide.
  - Session 1 : 3 rapports et une redélivrance du même message. `ONLINE`, 2 groupes (2 et 1) ;
    3 lignes stockées, donc le doublon n'est compté qu'une fois.
  - Hub figé 35 s : `OFFLINE`, mêmes groupes.
  - Nouveau démarrage : liste vide, lignes de la session 1 conservées.
  - Administrateur et technicien reçoivent le même corps, sans clé interne.

## Ce qu'un utilisateur peut faire sur `dev` (`49bf5f8`)

| Parcours | Où | Preuve existante | À vérifier par l'humain |
|---|---|---|---|
| Connexion Manager, refus du technicien | Manager | Suite Web en direct 12 sur 12 sur `49bf5f8` (Web) | Connexion, message de refus |
| Catalogue : créer, modifier et archiver un modèle et un exemplaire (#25) | Manager | Suite en direct CAT-01. Archivage répété conforme à 09 §12.1 | Formulaires FR/EN, archivage |
| Identifiants : attribuer, révoquer ; placement attendu (#26, #140) | Manager | Test en direct `#26 custody` sur `49bf5f8` (Web) et `e50ff08` (QA, base neuve) | Attribuer puis révoquer un identifiant, déplacer un placement |
| Échéance de calibration sans glissement à l'heure d'été (#25, #141) | Manager | Sur `49bf5f8` : formulaires et heure d'été 28 sur 28 (Web). La conversion se fait dans le navigateur ; l'API ne reçoit que de l'UTC | Navigateur à l'heure de Toronto : saisir une échéance le 8 mars 2026 à 2 h 30 (refusée), puis le 1er novembre 2026 à 1 h 30 (deux choix) |
| Recherche d'exemplaires par texte (#109, partie Web, #146) | Manager | Test en direct « search q » (44 cas du corpus d'accord avec l'API) dans la suite 12 sur 12 sur `49bf5f8` (Web) | Rechercher « ` mm-001 ` » (seul MM-001), coller 101 « a » (refus, aucune requête), puis Tout afficher |
| Horaire hebdomadaire d'un casier (#28, #139) | Manager | Suite en direct CFG-02. Recette R3 | Modifier un jour, relire |
| Lecture du catalogue et réservation (#37, #38) | iOS | Recette R5. CI des pushs `dev` `70f4065` et `d722ff9` : iOS vert (27 min, 26,7 min). Instabilité d'audit : 2 échecs sur 5 depuis #143. Correctif #149 vert une fois, ce qui ne prouve rien | Réserver un actif `READY`. Aucune ouverture de porte |
| Présence par scan, hub hors ligne (R4, R6) | API | Recette R4 et R6 (simulé) | Avec le vrai hub : couper le Wi-Fi plus de 30 s. L'actif passe à `UNKNOWN`, puis redevient `READY` seulement après un nouveau scan |
| Erreurs signalées par le hub, session courante (#29, #142, #148) | API et Manager | Scénario API sur `49bf5f8` (ci-dessus, hub simulé). Sur `49bf5f8`, Web : W1 et W2 réussis. Le cas Web de 09 §22.3 n'a pas de test dédié | Avec le vrai hub : provoquer un message invalide, le voir dans Casiers ; redémarrer le hub, la liste se vide. **Le simulateur ne vaut pas preuve matérielle** |
| Refus de déplacer un actif réservé (#133) | API | Recette R9 (réservation). Prêt et opération : **fixtures seulement** | — |

## En attente de fusion (Philippe fusionne) : preuves sur branche

| PR | Apporte | Vérification QA | Ordre proposé |
|---|---|---|---|
| #147 `2466a45` | API : présence inconnue si deux démarrages partagent le compteur | Règle **approuvée** (#147, commentaire 6694553221). QA a vérifié `6f11da6` : script jumeau 4 sur 4, lacune reproduite sur `dev`. Contrôle iOS rouge : même audit à froid que #132, sans lien avec #147 | Après #149, puis resynchronisation et une vérification |
| #149 `2c6a51a` | Tests iOS : absorber le démarrage à froid avant le premier audit complet | Exécution 42294577453 : 328 sur 328, aucun problème, saut ni échec attendu. Préchauffage 1,1 s, premier audit complet 6,4 s, maximum 9,8 s. Une exécution verte ne prouve rien | **Prochaine fusion nécessaire** (prête) |
| #132 `de0ee1b` | iOS : recherche par graphèmes (#109, partie iOS) | `dev` `d722ff9` fusionné ; ADR-014 et corpus inchangés. Exécution 42285488109 rouge (219 sur 220) sur l'audit à froid ; ses propres tests passent | Après #149 : une seule synchronisation, puis les contrôles de la nouvelle tête |

## Après chaque fusion

1. Relevez le nouveau SHA de `dev`.
2. Relancez `run.sh`.
3. Refaites seulement les lignes du parcours touchées par la fusion.
4. Sur #67, consignez le SHA, le résultat, et ce qui était réel ou simulé.

Une carte passe en **In Testing** seulement si elle est intégrée sur `dev` et vérifiée sur
ce SHA. Les cartes matérielles gardent leurs critères physiques.

Une PR partielle ne ferme pas sa story. Sur `49bf5f8`, les parties suivantes sont intégrées
et vérifiées automatiquement. Elles sont candidates à In Testing **si** elles couvrent toute la
portée de leur carte :
- #26 : partie Manager, identifiants et placement ;
- #25 : formulaires du catalogue, heure d'été comprise (28 sur 28 sur `49bf5f8`) ;
- #28 : horaire ;
- #109 : partie Web seulement. La partie iOS (#132) n'est pas fusionnée ;
- #29 : partie logicielle. La partie physique demande le vrai hub.
