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
| Suite UI complète : 27 tests, combinaisons FR/EN × clair/sombre, grandes tailles, audits d'accessibilité | étendue = recette `standalone` actuelle, inchangée | PR qui touche un chemin visuel ; PR vers `main` (avant livraison) ; push sur `dev` et `main` ; `ci.yml` modifié ; lancement manuel | oui sur PR ; sur push, le rouge est signalé après fusion | idem |
| Pas de job iOS | — | PR sans impact iOS, sauf `ci.yml` ou `xcresult-summary.py` modifié | — | cloud |

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
