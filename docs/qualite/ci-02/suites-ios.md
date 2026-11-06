# Suites iOS : rapide et étendue (proposition, CI-02 #67)

Rédigé le 3 novembre 2026, avant toute modification des déclenchements iOS. Le
déclenchement n'est pas encore changé : il le sera dans `ci.yml` quand la session iOS
aura livré les deux recettes et leurs nombres attendus.

## Répartition

- **Session iOS :**
  - possède la sélection des tests ;
  - possède les recettes de `apps/ios/scripts/ios-test.sh` ;
  - fixe le nombre attendu de chaque suite ;
  - fournit la liste des chemins « visuels ».
- **Session cloud :**
  - possède le déclenchement (`ci.yml`, `changed-components.sh`) ;
  - possède le reporting CI (résumés, `CI result`).
- Aucun fichier n'est édité par les deux.

## Matrice

| Contrôle | Suite | Déclencheur | Bloquant | Propriétaire |
|---|---|---|---|---|
| Compilation de l'app et des deux bundles de test | rapide et étendue | toute PR qui touche `apps/ios/` | oui | iOS (recette), cloud (déclenchement) |
| Tests unitaires et de contrat : 222 cas, sans backend, `Live*` exclus par nom | rapide et étendue | idem | oui | idem |
| Contrôle du String Catalog FR/EN (`check-strings.py`) | rapide et étendue | idem | oui | idem |
| Petite suite UI : connexion, catalogue, navigation et retour, reprise après erreur réseau (sélection ci-dessous) | rapide | PR iOS sans changement visuel | oui | iOS (sélection), cloud (déclenchement) |
| Suite UI complète : 27 tests, combinaisons FR/EN × clair/sombre, grandes tailles, audits d'accessibilité | étendue = recette `standalone` actuelle, inchangée | PR qui touche un chemin visuel ; PR vers `main` (avant livraison) ; push sur `dev` dont la plage touche un chemin iOS (voir ci-dessous) ; tout push sur `main` ; `ci.yml` modifié ; lancement manuel | oui sur PR ; sur push, le rouge est signalé après fusion | idem |
| Pas de job iOS | — | PR sans impact iOS, sauf `ci.yml` ou `xcresult-summary.py` modifié ; push sur `dev` sans chemin iOS dans sa plage | — | cloud |

**Push sur `dev` (proposition du 6 novembre 2026, à décider par Philippe).**

- Les jobs Linux tournent tous, comme avant. Seule la suite iOS devient conditionnelle.
- Elle tourne si la plage poussée (`github.event.before..github.sha`) touche :
  - `apps/ios/`, ce qui couvre le projet Xcode, `xcconfig`, `Package.resolved` et les recettes ;
  - le corpus partagé `docs/cahier-conception/09-corpus-recherche-q.json` ;
  - le contrat REST `docs/cahier-conception/09-contrats-rest.md` ;
  - n'importe quel fichier de `.github/`.
- Une suppression ou un renommage compte des deux côtés (`--no-renames`). Un fichier sorti d'`apps/ios/` déclenche donc la suite.
- **Sécurité par défaut :** sans plage prouvée, la suite tourne quand même. C'est le cas d'un `before` absent ou nul, d'un commit inconnu, ou d'une plage qui n'est pas une avance rapide.
- **Sauts visibles :** un push qui saute iOS l'écrit dans le résumé du job « Changed components ».
- **Inchangés :**
  - `main` et le lancement manuel (`workflow_dispatch`) restent complets : c'est le chemin de qualification ;
  - iOS n'est pas dans `CI result`, si bien que le check requis ne change pas.
- **Preuves :** les tests de `test_ci_scripts.py` couvrent l'exécution, le saut, les renommages, les plages non prouvées et le câblage de `ci.yml`.
  - La preuve hébergée du saut viendra du premier push `dev` sans chemin iOS après la fusion.

Règles :

- **Toutes les suites, de la rapide à l'étendue :**
  - le nombre attendu est vérifié exactement ;
  - un test ignoré ou absent fait échouer la recette.
- **La suite étendue reste la recette `standalone` complète.**
  - Elle ne perd ni test, ni langue, ni apparence, ni audit.
  - Aucun test n'est supprimé pour créer la suite rapide : elle en sélectionne une partie
    par nom.
- **La suite rapide :**
  - elle n'est jamais présentée comme la recette `standalone` ;
  - son résumé de job porte son propre nom et son propre nombre.
- **Les chemins « visuels »** sont fournis par la session iOS. Candidats :
  - les vues SwiftUI ;
  - `Assets.xcassets/` ;
  - `Localizable.xcstrings` ;
  - `AegisMobileUITests/` ;
  - les recettes elles-mêmes.

  Un chemin inconnu du filtre déclenche la suite étendue.

## Petite suite UI : candidats mesurés

Durées du run vert 41629351716, issues du code iOS de `dev`. La session iOS fait la
sélection finale.

| Parcours exigé | Test candidat | Durée |
|---|---|---:|
| Connexion | `SignInUITests/testSignInAndSignOutInFrench`, `…InEnglish` | 31,4 s + 33,5 s |
| Catalogue | `CatalogUITests/testEveryCardStatesItsStatusInWords` | 15,7 s |
| Navigation et retour | `CatalogUITests/testRemovedAssetOffersTheWayBack` | 16,8 s |
| Reprise après erreur réseau | `HealthScreenUITests/testUnreachableServiceShowsErrorAndRetryInFrench` ; variante une seule combinaison de `testOfflineRefreshKeepsTheLastListThenTryAgainRecovers` (178 s pour 4 combinaisons), à créer par la session iOS | 11,7 s ; environ 45 s, estimé |

Durée estimée du job rapide, en phases successives qui ne se chevauchent pas :

| Phase | Durée |
|---|---:|
| Préparation et outils | 30 à 65 s |
| Démarrage du simulateur | 108 s |
| Compilation | 52 à 124 s |
| Premier lancement | 96 s |
| Tests unitaires | 17 s |
| Environ 155 s de tests UI, plus les lancements | environ 170 s |
| Résumé | 25 s |
| **Total** | **8 à 10 min** |

Cette durée est une estimation, à confirmer par un run mesuré de la suite rapide. Si
elle dépasse 10 minutes, la couverture n'est pas réduite pour atteindre ce chiffre.

## Risque résiduel, et critères modifiés

**Risque résiduel.** Une PR iOS classée « non visuelle » peut quand même dégrader
l'accessibilité, par exemple en changeant un libellé produit par un modèle de vue.

- Sur sa PR, seule la suite rapide la vérifierait.
- La suite étendue la détecterait au push sur `dev`, après la fusion.
- La PR `dev` → `main` exige de nouveau la suite étendue, et elle est bloquante.

Trois parades réduisent ce risque :

- une liste de chemins visuels large, qui sélectionne au moindre doute ;
- un filtre qui reste fail-safe ;
- la promotion de l'iOS dans `CI result` (#111), pour qu'un job iOS sélectionné puis
  `skipped` bloque.

**Critères normatifs signalés.**

1. **Déjà appliqué dans #120.** Avant, toute modification sous `.github/scripts/`
   relançait tout (#110). Désormais, un script connu ne relance que ses tests et les
   jobs qui l'exécutent ; `ci.yml` modifié ou un script inconnu relance toujours tout.
2. **Déjà appliqué dans #120.** `infra/mqtt/` sélectionne aussi le job API, dont les
   tests de broker de #115 lisent l'ACL et les comptes.
3. **Proposé, non appliqué.** Une PR iOS sans changement visuel exécuterait la suite
   rapide au lieu de la recette `standalone` complète. La matrice de `README.md` sera
   mise à jour au moment de l'application.

Aucun ADR ni document normatif 02 à 10 n'est modifié.

**Nombre de tests.** La recette `standalone` ne fixe pas de nombre attendu : son appel
à `check_results` n'en passe aucun. Les deux comptes du run 41629351716 diffèrent :

- le résumé `xcresulttool` annonce 160 tests ;
- la base du bundle compte 249 exécutions de cas, soit 222 unitaires et 27 UI.

La session iOS doit fixer, pour chaque suite, le nombre attendu et l'unité comptée.

## Câblage prévu (4 novembre)

**Recettes annoncées par la session iOS**, transmises par la session d'intégration et QA :

| Recette | Contenu | Nombre annoncé |
|---|---|---:|
| `ios-test.sh pr` | 181 tests unitaires non live, puis 14 tests UI critiques, puis `check-strings.py` | 195 |
| `ios-test.sh extended` | les autres tests UI : langues et apparences, très grandes tailles, audits d'accessibilité (feuille de filtres, réserver et annuler, connexion en sombre, AX5) | 22 |
| `ios-test.sh standalone` (inchangée) | union des deux | 217 |

Les 14 tests UI critiques couvrent :

- santé du service et nouvel essai ;
- connexion : acceptée, refusée, administrateur refusé, jeton stocké refusé ;
- catalogue : statut, pagination, rafraîchissement hors ligne avec un seul appui sur
  « Réessayer », bien retiré ;
- réservation : refus en production, réponse perdue rejouée comme la même intention,
  casier fermé, réservation personnelle, annulation refusée.

**Ce qui bloque le câblage.**

- Le commit annoncé (`dc4b8a8`) n'est pas encore sur `origin`.
- La liste des chemins visuels n'est pas fournie.
- L'unité des nombres n'est pas confirmée : tests du résumé `xcresulttool` ou exécutions
  de cas du bundle. Sur `fbf866a`, `standalone` donne 160 tests de résumé et 249
  exécutions.

**Câblage prévu**, dans `ci.yml` et `changed-components.sh` (propriété CI-02) :

- **PR iOS sans chemin visuel :** `pr`, nombre exact 195.
- **Cas qui exécutent `standalone` (nombre exact 217) :**
  - une PR qui touche un chemin visuel, une recette, `ci.yml` ou `xcresult-summary.py` ;
  - une PR vers `main` ;
  - un push sur `dev` ou `main` ;
  - un lancement manuel.

  La suite étendue n'est jamais exécutée sans la rapide.
- **Fail-safe :** un chemin iOS inconnu du filtre est traité comme visuel.
- **Résumé de job :** il porte le nom de la recette et son nombre. Un run `pr` n'est
  jamais présenté comme `standalone`.
- **Condition :** les recettes doivent être sur `dev` avant le câblage. Sinon, la voie
  rapide appellerait une recette absente.

**Risque relevé par la session iOS.** L'audit de la feuille de filtres, qui a échoué
sur #116 `07da342`, est dans `extended`. Une PR non visuelle ne le rencontrerait qu'au
push sur `dev`, puis avant `main`.

## Câblage livré (branche `67-ci-ios-suite-selection`, 4 novembre)

**Filtre.** `changed-components.sh` ajoute la sortie `ios_fast`. Elle vaut `true` seulement
quand trois conditions sont réunies :

- la PR vise `dev` ;
- elle modifie `apps/ios/` ;
- chaque fichier iOS modifié est sous un chemin non visuel :
  - `AegisMobile/Networking/` ;
  - `AegisMobileTests/` ;
  - `docs/` ;
  - `README.md`.

Tout le reste exécute `standalone` (= `pr` + `extended`, sans perte de couverture) :

- vues, `Session/`, ressources, `Localizable.xcstrings`, tests UI, recettes, projet,
  `Config/`, chemin inconnu ;
- push, lancement manuel, PR vers `main` ;
- `ci.yml` ou `xcresult-summary.py` modifié.

La liste non visuelle est volontairement étroite. La session iOS peut l'élargir.

**Job.**

- Le job s'appelle désormais « iOS tests » et son artefact `ios-test-results`.
- Après le démarrage du simulateur, l'étape « Choose the recipe » écrit la recette dans
  le résumé, puis « iOS recipe » exécute `scripts/ios-test.sh "$IOS_RECIPE"`.
- Le résumé `xcresult-summary.py` liste le bundle par son nom (`pr.xcresult` ou
  `standalone.xcresult`). Un run `pr` n'est donc jamais présenté comme `standalone`.

**Activation.**

- Tant que `scripts/ios-test.sh` de la branche testée n'a pas de recette `pr`, l'étape
  garde `standalone` et l'annonce par un `::notice::`.
- La voie rapide s'active donc d'elle-même quand #121 apporte les recettes sur `dev`,
  quel que soit l'ordre de fusion.

**Rejeu local de l'étape.**

| Script | `FAST=true` | `FAST=false` ou vide |
|---|---|---|
| `ios-test.sh` de `dev` | `standalone` | `standalone` |
| `ios-test.sh` de `c575c27` (#121) | `pr` | `standalone` |

**Tests.**

- 6 nouveaux tests du filtre et du câblage.
- Deux mutations vérifiées :
  - `ios_fast` toujours vrai : 11 échecs ;
  - condition « vers `dev` » retirée : 1 échec.

**Nombres.** Aucun nombre n'est fixé dans la CI. La recette échoue déjà sur un test ignoré,
sur un échec ou sur zéro test. Les nombres observés sont :

- `standalone` : 217 sur #121 (run 41876632897) ;
- `pr` : 195 et `extended` : 22, d'après la session iOS.

Un nombre exact par recette demanderait une modification de la CI à chaque test ajouté.
Ce n'est pas proposé.

**Reste à prouver.** Le premier run hébergé de la voie `pr` aura lieu sur la première PR
iOS non visuelle après la fusion de #121. Sa durée et son nombre de tests sont à consigner
sur #67.
