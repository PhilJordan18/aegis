# Recette humaine : point d'entrée unique

Ce document est le seul point de départ de la recette humaine de Philippe et Jimmy. Il
renvoie aux recettes détaillées et ne les recopie pas.

État au **6 novembre 2026, 16 h 25 (Toronto)**. Avant de commencer, relevez le SHA réel :

```bash
git fetch origin dev && git rev-parse --short origin/dev
```

- **À la rédaction, `dev` est à `e50ff08`.** Il contient #143, #136, #140, #141 et #146.
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
- **Dernier résultat consigné :** 36 sur 36 en 106 s sur `dev` `e50ff08`.
- **Ce que couvre ce script :** la pile réelle avec le hub simulé.
- **Ce qu'il ne couvre pas :** ni les écrans, ni le matériel.
- **Attention :** ce script occupe tous les compartiments du casier de démonstration. La
  suite Web en direct (`apps/admin-web`, `playwright.api.config.ts`) doit donc tourner
  **avant** lui, ou sur une base neuve. Sinon le test `#26 custody` s'arrête sur sa
  précondition explicite.
- **Suite Web en direct sur `dev` `e50ff08`, base neuve :** 12 sur 12 en 77 s, dont les 44 cas du corpus de recherche.
- **Vitest sur `e50ff08` :** fuseau, formulaires et recherche, 113 sur 113.

## Ce qu'un utilisateur peut faire sur `dev` (`e50ff08`)

| Parcours | Où | Preuve existante | À vérifier par l'humain |
|---|---|---|---|
| Connexion Manager, refus du technicien | Manager | Suite Web en direct 12 sur 12 sur `e50ff08` | Connexion, message de refus |
| Catalogue : créer, modifier et archiver un modèle et un exemplaire (#25) | Manager | Suite en direct CAT-01. Archivage répété conforme à 09 §12.1 | Formulaires FR/EN, archivage |
| Identifiants : attribuer, révoquer ; placement attendu (#26, #140) | Manager | Test en direct `#26 custody` sur `e50ff08` (base neuve) | Attribuer puis révoquer un identifiant, déplacer un placement |
| Échéance de calibration sans glissement à l'heure d'été (#25, #141) | Manager | Sur `e50ff08` : tests unitaires et de formulaires (vitest). **Sur branche seulement** : le contrôle sur l'API réelle | Navigateur à l'heure de Toronto : saisir une échéance le 8 mars 2026 à 2 h 30 (refusée), puis le 1er novembre 2026 à 1 h 30 (deux choix) |
| Recherche d'exemplaires par texte (#109, partie Web, #146) | Manager | Test en direct « search q » sur `e50ff08` : les 44 cas du corpus d'accord avec l'API | Rechercher « ` mm-001 ` » (seul MM-001), coller 101 « a » (refus, aucune requête), puis Tout afficher |
| Horaire hebdomadaire d'un casier (#28, #139) | Manager | Suite en direct CFG-02. Recette R3 | Modifier un jour, relire |
| Lecture du catalogue et réservation (#37, #38) | iOS | Recette R5. CI des pushs `dev` `70f4065` et `d722ff9` : iOS vert (27 min, 26,7 min). Instabilité d'audit non corrigée : 2 échecs sur 5 depuis #143, voir #149 | Réserver un actif `READY`. Aucune ouverture de porte |
| Présence par scan, hub hors ligne (R4, R6) | API | Recette R4 et R6 (simulé) | Avec le vrai hub : couper le Wi-Fi plus de 30 s. L'actif passe à `UNKNOWN`, puis redevient `READY` seulement après un nouveau scan |
| Refus de déplacer un actif réservé (#133) | API | Recette R9 (réservation). Prêt et opération : **fixtures seulement** | — |

## En attente de fusion (Philippe fusionne) : preuves sur branche

| PR | Apporte | Vérification QA | Ordre proposé |
|---|---|---|---|
| #142 `49bd8ff` | API : `deviceErrors` de la session courante du hub (#29) | Avec #148 sur `e50ff08` : MQTT vers API réel, hub simulé ; recette 36 sur 36 | **Prête.** 1 |
| #148 `1943e60` | Manager : rendu des `deviceErrors` (#29) | Tête finale vérifiée avec #142 sur `e50ff08` : scénario M0 à M3 réussi (aucun signal ; 2 groupes, doublon stocké une fois ; hors ligne ; nouvelle session vide, historique gardé). Sonar corrigé | **Prête.** 2, après #142 |
| #144 `e8fb536` | CI : iOS sur un push `dev` seulement si un chemin iOS change | Approuvée par Philippe. 59 tests de scripts CI | **Prête.** Indépendante |
| #147 `2466a45` | API : présence inconnue si deux démarrages partagent le compteur | Règle **approuvée** (#147, commentaire 6694553221). QA a vérifié `6f11da6` : script jumeau 4 sur 4, lacune reproduite sur `dev`. Contrôle iOS rouge : même audit à froid que #132, sans lien avec #147 | Après #149, ou décision de Philippe |
| #149 `2c6a51a` | Tests iOS : absorber le démarrage à froid avant le premier audit complet | Une exécution hébergée en cours. Une exécution verte ne prouve rien | Brouillon jusqu'à lecture du résultat |
| #132 `de0ee1b` | iOS : recherche par graphèmes (#109, partie iOS) | `dev` `d722ff9` fusionné ; ADR-014 et corpus inchangés. Exécution 42285488109 rouge (219 sur 220) sur l'audit à froid ; ses propres tests passent | À resynchroniser après #149 |

## Après chaque fusion

1. Relevez le nouveau SHA de `dev`.
2. Relancez `run.sh`.
3. Refaites seulement les lignes du parcours touchées par la fusion.
4. Sur #67, consignez le SHA, le résultat, et ce qui était réel ou simulé.

Une carte passe en **In Testing** seulement si elle est intégrée sur `dev` et vérifiée sur
ce SHA. Les cartes matérielles gardent leurs critères physiques.

Une PR partielle ne ferme pas sa story. Sur `e50ff08`, les parties suivantes sont intégrées et
vérifiées automatiquement. Elles sont candidates à In Testing **si** elles couvrent toute la
portée de leur carte :
- #26 : partie Manager, identifiants et placement ;
- #25 : formulaires du catalogue. Le chemin heure d'été est vérifié en tests unitaires ; sur
  l'API réelle, il n'a qu'une preuve sur branche ;
- #28 : horaire ;
- #109 : partie Web seulement. La partie iOS (#132) n'est pas fusionnée.
