# Recette humaine : point d'entrée unique

Ce document est le seul point de départ de la recette humaine de Philippe et Jimmy. Il
renvoie aux recettes détaillées et ne les recopie pas.

État au **6 novembre 2026, 15 h 40 (Toronto)**. Avant de commencer, relevez le SHA réel :

```bash
git fetch origin dev && git rev-parse --short origin/dev
```

- **À la rédaction, `dev` est à `d722ff9`.** Il contient #143, #136, #140 et #141.
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
- **Dernier résultat consigné :** 36 sur 36 en 101 s sur `dev` `d722ff9`.
- **Ce que couvre ce script :** la pile réelle avec le hub simulé.
- **Ce qu'il ne couvre pas :** ni les écrans, ni le matériel.
- **Attention :** ce script occupe tous les compartiments du casier de démonstration. La
  suite Web en direct (`apps/admin-web`, `playwright.api.config.ts`) doit donc tourner
  **avant** lui, ou sur une base neuve. Sinon le test `#26 custody` s'arrête sur sa
  précondition explicite.
- **Suite Web en direct sur `dev` `d722ff9`, base neuve :** 11 sur 11 en 80 s.

## Ce qu'un utilisateur peut faire sur `dev` (`d722ff9`)

| Parcours | Où | Preuve existante | À vérifier par l'humain |
|---|---|---|---|
| Connexion Manager, refus du technicien | Manager | Suite Web en direct 11 sur 11 sur `d722ff9` | Connexion, message de refus |
| Catalogue : créer, modifier et archiver un modèle et un exemplaire (#25) | Manager | Suite en direct CAT-01. Archivage répété conforme à 09 §12.1 | Formulaires FR/EN, archivage |
| Identifiants : attribuer, révoquer ; placement attendu (#26, #140) | Manager | Test en direct `#26 custody` sur `d722ff9` (base neuve) | Attribuer puis révoquer un identifiant, déplacer un placement |
| Échéance de calibration sans glissement à l'heure d'été (#25, #141) | Manager | **Sur branche** : API réelle, trou de printemps refusé, deux occurrences d'automne. Non refait sur `d722ff9` | Navigateur à l'heure de Toronto : saisir une échéance le 8 mars 2026 à 2 h 30 (refusée), puis le 1er novembre 2026 à 1 h 30 (deux choix) |
| Horaire hebdomadaire d'un casier (#28, #139) | Manager | Suite en direct CFG-02. Recette R3 | Modifier un jour, relire |
| Lecture du catalogue et réservation (#37, #38) | iOS | Recette R5. CI du push `dev` `70f4065` : iOS vert en 27 min ; celle de `d722ff9` en cours | Réserver un actif `READY`. Aucune ouverture de porte |
| Présence par scan, hub hors ligne (R4, R6) | API | Recette R4 et R6 (simulé) | Avec le vrai hub : couper le Wi-Fi plus de 30 s. L'actif passe à `UNKNOWN`, puis redevient `READY` seulement après un nouveau scan |
| Refus de déplacer un actif réservé (#133) | API | Recette R9 (réservation). Prêt et opération : **fixtures seulement** | — |

## En attente de fusion (Philippe fusionne) : preuves sur branche

| PR | Apporte | Vérification QA | Ordre proposé |
|---|---|---|---|
| #142 `49bd8ff` | API : `deviceErrors` de la session courante du hub (#29) | MQTT vers API réel, hub simulé : regroupement, doublon stocké une fois, liste gardée hors ligne, vidée à la nouvelle session | Indépendante |
| #148 `1943e60` | Manager : rendu des `deviceErrors` (#29) | QA a vérifié `98b98f9` avec #142 : page égale au GET direct en 4 étapes, script Web W1/W2 réussi. **Tête `1943e60` non revérifiée** (correctif Sonar par Web) | Après #142, puis revérification QA |
| #146 `60afdb5` | Manager : recherche `q` par graphèmes (#109, partie Web) | QA a vérifié `ab1a597` : « search q » 44 sur 44 d'accord avec l'API. Resynchronisée sur `dev` par Web ; **tête `60afdb5` non revérifiée par QA** | Après revérification QA |
| #147 `2466a45` | API : présence inconnue si deux démarrages partagent le compteur | QA a vérifié `6f11da6` : script jumeau 4 sur 4 ; sur `dev` le même script échoue T2 et T3. Nouveaux commits « règle approuvée » : **approbation non vue par QA**, tête non revérifiée | Philippe confirme la règle |
| #144 `e8fb536` | CI : iOS sur un push `dev` seulement si un chemin iOS change | **Approuvée par Philippe.** 59 tests de scripts CI sur l'arbre fusionné avec `d722ff9`. Sortie du brouillon | Indépendante |
| #132 `de0ee1b` | iOS : recherche par graphèmes (#109) | `dev` `d722ff9` fusionné sans conflit ; ADR-014 et corpus inchangés. Exécution unique 42285488109 : **rouge**, 219 sur 220. Ses propres tests passent (corpus 45, catalogue 34, modèle de vue 18). Échec : premier audit d'accessibilité à froid de `CatalogUITests`, abandonné après 15,2 s (-56) | Décision de Philippe. L'instabilité d'audit n'est pas corrigée |

## Après chaque fusion

1. Relevez le nouveau SHA de `dev`.
2. Relancez `run.sh`.
3. Refaites seulement les lignes du parcours touchées par la fusion.
4. Sur #67, consignez le SHA, le résultat, et ce qui était réel ou simulé.

Une carte passe en **In Testing** seulement si elle est intégrée sur `dev` et vérifiée sur
ce SHA. Les cartes matérielles gardent leurs critères physiques.

Sur `d722ff9`, sont intégrés et vérifiés :
- #26, partie Manager (identifiants et placement) ;
- #25, formulaires du catalogue ;
- #28, horaire.

Chacun ne passe en In Testing que pour cette portée. Le chemin heure d'été de #25 n'a
qu'une preuve sur branche.
