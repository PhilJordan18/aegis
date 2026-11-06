# Recette humaine : point d'entrée unique

Ce document est le seul point de départ de la recette humaine de Philippe et Jimmy. Il
renvoie aux recettes détaillées et ne les recopie pas.

État au **6 novembre 2026, 14 h 50 (Toronto)**. Avant de commencer, relevez le SHA réel :

```bash
git fetch origin dev && git rev-parse --short origin/dev
```

- **À la rédaction, `dev` est à `60ccc35`.**
- Si les PR ouvertes ci-dessous sont fusionnées, ce SHA change. Notez alors le SHA testé
  dans le compte rendu.

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
- **Dernier résultat consigné :** 36 sur 36 sur `dev` `60ccc35`, avec #136.
- **Ce que couvre ce script :** la pile réelle avec le hub simulé.
- **Ce qu'il ne couvre pas :** ni les écrans, ni le matériel.
- **Attention :** ce script occupe tous les compartiments du casier de démonstration. La
  suite Web en direct (`apps/admin-web`, `playwright.api.config.ts`) doit donc tourner
  **avant** lui, ou sur une base neuve. Sinon le test `#26 custody` s'arrête sur sa
  précondition explicite.

## Ce qu'un utilisateur peut faire sur `dev` (`60ccc35`)

| Parcours | Où | Preuve existante | À vérifier par l'humain |
|---|---|---|---|
| Connexion Manager, refus du technicien | Manager | Suite Web en direct 11 sur 11 (pile cloud) | Connexion, message de refus |
| Catalogue : créer, modifier et archiver un modèle et un exemplaire (#25) | Manager | Suite en direct CAT-01. Archivage répété conforme à 09 §12.1 | Formulaires FR/EN, archivage |
| Horaire hebdomadaire d'un casier (#28, #139) | Manager | Suite en direct CFG-02. Recette R3 | Modifier un jour, relire |
| Lecture du catalogue et réservation (#37, #38) | iOS | CI iOS. Recette R5 | Réserver un actif `READY`. Aucune ouverture de porte |
| Présence par scan, hub hors ligne (R4, R6) | API | Recette R4 et R6 (simulé) | Avec le vrai hub : couper le Wi-Fi plus de 30 s. L'actif passe à `UNKNOWN`, puis redevient `READY` seulement après un nouveau scan |
| Refus de déplacer un actif réservé (#133) | API | Recette R9 (réservation). Prêt et opération : **fixtures seulement** | — |

## En attente de fusion (Philippe fusionne)

| PR | Apporte | Vérification QA | Ordre proposé |
|---|---|---|---|
| #136 `0e52322` | Recette : lectures admin, garde R9, API toujours reconstruite | 36 sur 36 en 100 s | Indépendante |
| #140 `3f1d4d9` | Manager : identifiants et placement (#26) | Recette 36 sur 36. Live 11 sur 11 deux fois de suite sur la même base neuve ; exige un compartiment libre | 1 |
| #141 `a768561` | Manager : échéance de calibration sans glissement à l'heure d'été (#25) | Trou de printemps refusé. Deux occurrences d'automne stockées et relues sur l'API réelle | 2 (aucun conflit avec #140) |
| #142 `49bd8ff` | API : `deviceErrors` de la session courante du hub (#29) | MQTT vers API réel, hub simulé : regroupement, doublon stocké une fois, liste gardée hors ligne, vidée à la nouvelle session | Indépendante |
| #148 `98b98f9` | Manager : rendu des `deviceErrors` (#29) | Avec #142 : page égale au GET direct en 4 étapes (aucun signal, 2 groupes avec doublon, hors ligne, nouvelle session). Script Web W1/W2 réussi | Après #142 |
| #143 `0570b2c` | Tests iOS : ordre des audits, plus de reprise masquante | Run 42258729058 : 218 sur 218 en 22,8 min, 31 audits terminés, le plus lent 9,4 s. Une seule exécution : l'instabilité n'est **pas** prouvée corrigée | Prête. Puis resynchroniser #132 |
| #146 `ab1a597` | Manager : recherche `q` par graphèmes | **Non revue par QA** | À préciser par Web |
| #147 `6f11da6` | API : présence inconnue si deux démarrages partagent le compteur | **Non revue par QA** | À préciser par Backend |
| #144 `e8fb536` | CI : iOS sur un push `dev` seulement si un chemin iOS change | 59 tests de scripts CI | **Décision de Philippe** |
| #132 | iOS : recherche par graphèmes (#109) | Rouge iOS hérité, à resynchroniser après #143 | Après #131, ADR-014 et un iOS vert |

## Après chaque fusion

1. Relevez le nouveau SHA de `dev`.
2. Relancez `run.sh`.
3. Refaites seulement les lignes du parcours touchées par la fusion.
4. Sur #67, consignez le SHA, le résultat, et ce qui était réel ou simulé.

Une carte passe en **In Testing** seulement si elle est intégrée sur `dev` et vérifiée sur
ce SHA. Les cartes matérielles gardent leurs critères physiques.
