# Diagnostic mesuré du job iOS standalone (CI-02, #67)

Établi le 3 novembre 2026 à partir des résultats hébergés existants. Aucun nouveau
run n'a été lancé pour ce diagnostic. Les mesures sont reproductibles avec les
outils de [mesures/](mesures/README.md) sur les artefacts `ios-standalone-results` (conservés 7 jours).

Sources :

- le log du job 125864757472 (run 41620501772) ;
- les journaux de session xcodebuild et du runner, présents dans le bundle ;
- la base `database.sqlite3` des bundles xcresult : `Actions`, `TestCaseRuns`,
  `Activities` et `Attachments`.

Configuration commune : `macos-26-arm64` 20261026, Xcode 26.3 (17C529), iPhone 17,
iOS 26.5 (23F77).

## 1. Où vont les 20 min 51 s du run 41620501772

Le job a duré 21 min 34 s :

- 15 s pour la préparation et le checkout ;
- 1 251 s pour la recette `scripts/ios-test.sh standalone`, de 10:35:42 à 10:56:33 ;
- 16 s pour le résumé et l'envoi de l'artefact.

La recette se décompose ainsi :

| Phase | De → à (UTC) | Durée | Part |
|---|---|---:|---:|
| Démarrage de xcodebuild | 10:35:42 → 10:35:46 | 3 s | 0 % |
| Compilation (app + 2 bundles de test) | 10:35:46 → 10:36:38 | 52 s | 4 % |
| Démarrage du simulateur (état « booted » à 10:36:41, socket testmanagerd à 10:36:43) | 10:36:38 → 10:36:43 | 5 s | 0 % |
| Ouverture de la session de test | 10:36:43 → 10:37:14 | 30 s | 2 % |
| Installation de l'app sur le simulateur neuf | 10:37:14 → 10:38:14 | 60 s | 5 % |
| Lancement de l'hôte des tests unitaires | 10:38:17 → 10:38:37 | 20 s | 2 % |
| Attente que le processus de test soit prêt | 10:38:37 → 10:39:53 | 76 s | 6 % |
| Tests unitaires (222 cas) | 10:39:58 → ≈ 10:40:26 | 28 s | 2 % |
| Installation et démarrage du runner UI | ≈ 10:40:26 → 10:40:54 | 28 s | 2 % |
| **Tests UI (27 cas)** | 10:40:54 → 10:54:55 | **842 s** | **67 %** |
| Fin d'action après échecs (diagnostics, captures) | 10:54:55 → 10:56:10 | 75 s | 6 % |
| Résumé des résultats, vérification du String Catalog | 10:56:10 → 10:56:33 | 23 s | 2 % |

Quatre causes expliquent la durée.

1. **Les tests UI : 842 s.** En voici la répartition :
   - `testCatalogueFilterSheetAndBackInBothLanguagesAndAppearances` : 173 s. Il a
     échoué à la 3e itération sur 4 ; il dure 360 s quand il passe (run 41620521054).
   - `testOfflineRefreshKeepsTheLastListThenTryAgainRecovers` : 175 s.
   - `testEmptyCatalogueOffersNoFilterToClear` : 83 s, consommés par un timeout de
     lancement (voir 4.3). Il dure 8 à 15 s quand le lancement réussit.
   - Le reste du catalogue : 97 s, pour 5 tests.
   - `SignInUITests` : 284 s, pour 17 tests.
   - `HealthScreenUITests` : 20 s.
2. **Le premier lancement sur un simulateur neuf : environ 200 s.** Le simulateur est
   « booted » en 1,4 s, mais l'installation et le premier lancement de l'hôte de test
   prennent ensuite 156 s : le système de l'appareil termine encore son premier
   démarrage. Pendant ce temps, les tests unitaires durent 28 s, contre 1 à 8 s dans
   les autres runs, pour les mêmes 222 cas.
3. **Le traitement des échecs : environ 158 s.** Il comprend le timeout de lancement
   (83 s) et la collecte des diagnostics en fin d'action (75 s, contre 4 à 46 s dans
   les runs sans ce cumul).
4. **La compilation : 52 s.** Elle n'est pas un levier significatif.

## 2. Comparaison sur six runs hébergés

| Run | Code iOS testé | Résultat | Action xcodebuild | Compilation | Simulateur neuf → 1er test unitaire | Tests unitaires | Fenêtre des tests UI | Lancements de l'app |
|---|---|---|---:|---:|---:|---:|---:|---:|
| 41586558351 | `dev` 007c584 | échec `:72` | 862 s | 39 s | 128 s | 1 s | 639 s | 33 (158 s) |
| 41586555809 | `dev` 007c584 | échec -56 | 1 042 s | 56 s | 109 s | 3 s | 727 s | 32 (229 s) |
| 41588098193 | #116 0c15b61 | échec Dynamic Type | 1 076 s | 73 s | 151 s | 8 s | 779 s | 34 (208 s) |
| 41584155476 | `dev` 007c584 | échec Dynamic Type | 1 137 s | 48 s | 217 s | 7 s | 787 s | 34 (277 s) |
| 41620501772 | #117 27ee03f | échec -56 + timeout de lancement | 1 225 s | 52 s | 197 s | 28 s | 842 s | 34 (195 s) |
| 41620521054 | #117 27ee03f | succès 160/160 | 1 318 s | 64 s | 241 s | 3 s | 983 s | 35 (256 s) |

Pour un même code, la durée varie de 862 à 1 318 s. Le run vert est le plus long, car
il exécute jusqu'au bout les quatre itérations du test de filtre.

Le passage du simulateur neuf au premier test unitaire coûte entre 109 et 241 s selon
la machine. L'installation de l'app y prend à elle seule 42 à 63 s.

Le run 41620521054 était un `workflow_dispatch` sur le même SHA que le run de PR
41620501772. Les deux ont tourné en parallèle : c'est exactement la situation que
l'instruction du 3 novembre interdit désormais. La section 6 corrige la cause dans le
workflow.

## 3. Tests UI : lancements, attentes et audits

Les mesures portent sur les activités de premier niveau du run 41620501772, recoupées
avec 41620521054.

- **Lancements de l'app :** 34, pour un total de 195 s, soit 5,7 s en moyenne. Chaque
  test lance l'app au moins une fois. Le test de filtre et le test hors ligne la
  relancent à chaque couple langue × apparence, soit 4 fois chacun.
- **Attentes conditionnelles (`waitForExistence` et `waitForNonExistence`) :** 103
  attentes, pour un total de 148 s. Une seule est restée à son plafond sans échouer :
  `notice.waitForNonExistence(timeout: 5)` après le premier tap sur « Réessayer »
  (voir 4.4).
- **Changement d'apparence (`XCUIDevice.shared.appearance`) :** il prend normalement
  0,6 à 2 s, mais une fois 38,4 s dans le run 41620521054, et une fois 17,8 s dans le
  run 41588098193. Tout ce temps est passé dans « Wait for com.apple.springboard to
  idle ».
- **Audits d'accessibilité.** XCTest ne les enregistre pas comme activités. Leur
  fenêtre est donc mesurée entre la dernière requête qui précède l'audit et la capture
  qui le suit (`xcresult_mesures.py audits`) :

  | Variante | Runs | Écran catalogue | Fiche | Total |
  |---|---|---:|---:|---:|
  | Une passe (code de `dev`) | 41586558351, 41586555809 | 6,1 à 8,7 s | 2,6 à 4,2 s | 11 audits : 51 à 59 s |
  | Une passe après écran immobile (#116) | 41588098193 | 5,0 à 7,3 s, et une fois 46,1 s | 2,4 à 3,5 s | 14 audits : 114 s |
  | Trois passes (#117 27ee03f) | 41620521054, 41620501772 | 11,6 à 20,5 s | 5,6 à 7,6 s | 15 audits : 148 s |

  Le découpage en trois passes double environ la durée de chaque audit, sans empêcher
  le -56 (voir 4.1). Il doit être retiré, conformément à la décision du 3 novembre.

- **Pauses fixes :**
  - `waitUntilSettled` dort 0,5 s par tour jusqu'à ce que le bouton ne bouge plus ;
  - `waitForStillScreen` (#116) prend 3 instantanés à 0,4 s d'intervalle.

  Ces deux pauses sont bornées. Leur coût total reste inférieur à 10 s par run.

## 4. Classement des constats

| # | Constat | Preuve | Classement |
|---|---|---|---|
| 4.1 | « Audit failed to complete in time » (-56) | Runs 41515528716 et 41586555809 (test hors ligne, fenêtre de 17 s), et 41620501772 (EN clair, catalogue : 34 s sans aucune activité, puis -56 après 41 s de fenêtre) | **Hypothèse non prouvée.** Le -56 survient après 17 s comme après 41 s : ce n'est pas un simple budget de temps. Le découpage ne l'a pas évité. La cause reste inconnue : app jamais inactive pendant l'audit, simulateur saturé, ou limite interne de XCTest. |
| 4.2 | Dynamic Type « partially unsupported » sur « Last known: Blocked », cadre (51, 646, 172, 18) | Runs 41577913719, 41584155476 et 41588098193 ; zone visible mesurée (0, 0, 402, 671) | **Hypothèse non prouvée.** L'explication par le fondu de la barre d'onglets n'est pas démontrée, et la mise en page n'a pas été vérifiée. **Un défaut produit n'est pas exclu** : il peut s'agir d'un libellé tronqué ou rendu inaccessible en grande taille. La bande de tolérance de 60 pt est retirée de la proposition. |
| 4.3 | « Timed out while launching application via Xcode » sur `testEmptyCatalogueOffersNoFilterToClear` (83 s) | Run 41620501772. Le test précédent s'est terminé sur un -56, l'app encore active (pid 7561). La terminaison a été demandée à 10:43:47 ; xcodebuild n'en a reçu l'avis qu'à 10:44:11 ; le lancement a expiré à 10:44:53. Le même test dure 33 s et 50 s dans 41586555809 et 41584155476, contre 8 à 15 s ailleurs. | **Démarrage ou disponibilité du simulateur, consécutif à 4.1.** La corrélation est observée dans un seul run ; elle n'est pas prouvée en général. |
| 4.4 | Le premier tap sur « Réessayer » ne fait pas disparaître le bandeau en 5 s : un deuxième tap est fait | 12 itérations sur 14 dans les runs 41620521054, 41620501772, 41588098193 et 41586558351. Le commentaire du test dit pourtant « seen once ». | **Défaut produit possible ou fragilité de test, non tranché.** Cela contrevient à la décision « pas de taps répétés » : le deuxième tap peut masquer un premier tap ignoré par l'app, par exemple un rafraîchissement encore en cours (`ignoresADuplicateRefreshWhileOneIsInFlight`). |
| 4.5 | Tap « retour » perdu à `:72`, écran de fiche toujours affiché | Run 41586558351 (FR sombre). Bouton `BackButton` présent et touchable en (16, 62). | **Fragilité de test probable**, avec un tap pendant une transition. Non prouvé. Un run vert sur 27ee03f ne démontre pas la correction. |
| 4.6 | 150 à 240 s avant le premier test, sur un simulateur « booted » en 2 s | Tous les runs (section 2) | **Démarrage ou disponibilité du simulateur, prouvé par les horodatages.** Aucun lien avec le code de l'app. |
| 4.7 | Changement d'apparence de 17 à 38 s | Runs 41620521054 et 41588098193 | **Simulateur** (SpringBoard occupé). |
| 4.8 | Run manuel et run de PR identiques en parallèle | Runs 41620521054 et 41620501772 | **Workflow**, causé par la clé de concurrence. Corrigé dans la section 6. |

Le doublon push + PR redouté ne se produit pas. CI ne se déclenche sur `push` que pour
`dev` et `main`, et chaque fusion y produit un run voulu, qui qualifie la branche
fusionnée. Les doubles runs visibles sur une même PR viennent du workflow « Branch
policy », pas de CI.

## 5. Transmission à la session iOS

La session iOS est seule propriétaire de `apps/ios/**`. La session cloud ne modifie
plus ni `CatalogUITests` ni `StillScreen`. Les demandes ci-dessous découlent des
décisions du 3 novembre ; le détail se trouve dans
`transmission-ios-catalog-ui-tests.md`.

1. Vérifier la disposition réelle de la carte « Last known: Blocked », en FR et EN,
   en clair et en sombre, en grande taille et en AX5 : défilement, safe areas, et
   libellé lisible sans troncature. Corriger la mise en page si le texte est
   réellement masqué.
2. Retirer la bande `growthBand` et le découpage en trois passes du commit 27ee03f.
3. Expliquer le deuxième tap sur « Réessayer » (4.4) par une reproduction locale, avant
   de le garder ou de le retirer.
4. Ne garder l'attente d'écran immobile avant le tap « retour » que si un test prouve
   le comportement attendu.
5. Le commit 4084695 de #116 (« audit again when XCTest abandons the catalogue audit »)
   est une reprise d'audit. Il tombe sous l'interdiction des « retries cachant un
   défaut », sauf si une preuve montre que le -56 vient de XCTest et non de l'app.
6. Pistes de durée sans perte de couverture :
   - éviter de relancer l'app quand seule l'apparence change, en passant le changement
     d'apparence sur l'app déjà lancée et en vérifiant que l'écran suit ;
   - ne relancer qu'au changement de langue.

   Ce sont des hypothèses à mesurer, pas des allègements.

## 6. Changements CI proposés (branche `67-ci-ios-run-cost`)

Fichiers modifiés : `.github/workflows/ci.yml`, `.github/scripts/changed-components.sh`
et leurs tests.

- **Concurrence par branche.**
  - Les runs de PR et les runs manuels d'une même branche partagent un groupe : un run
    manuel attend la fin du run de PR au lieu de tourner à côté.
  - Un nouveau run de PR annule l'ancien ; un run en attente est remplacé par le plus
    récent.
  - Les pushes vers `dev` et `main` gardent leur propre groupe et ne sont jamais
    annulés.
  - Les autres branches ne sont pas touchées.
- **PR empilées.** Le diff est calculé entre la base et le commit de fusion de la PR :
  il montre exactement ce que la PR ferait entrer dans `dev`. Les commits d'un
  prérequis encore absent de `dev` y entrent donc avec la PR, et ignorer iOS pour eux
  permettrait de fusionner du code iOS non testé. Le filtre continue donc de
  sélectionner iOS dans ce cas. Le résumé du job « Changed components » nomme
  désormais les commits qui sélectionnent iOS, pour distinguer ceux du prérequis de
  ceux de la PR.

  État vérifié le 3 novembre sur les 11 PR ouvertes :
  - #117 contient le commit de #116 et le sien, tous deux iOS ;
  - #108 contient 10 commits iOS qui lui sont propres ;
  - aucune autre PR ne touche `apps/ios/`.

  Aucun faux positif n'a donc été constaté.
- **Démarrage explicite du simulateur (expérience).**
  - Une étape démarre le simulateur choisi s'il ne l'est pas déjà, puis attend
    `simctl bootstatus`. Elle est bornée par `timeout-minutes: 8`.
  - Elle inscrit dans le résumé du job la durée du démarrage et celle de l'attente.
  - Un simulateur qui ne finit pas de démarrer échoue dans cette étape, jamais comme
    un échec de test.
  - Rien ne garantit qu'elle réduise la durée totale. Elle sépare et mesure le coût,
    et peut raccourcir l'installation et le premier lancement (section 1, cause 2).
- **Rien d'autre n'est changé :**
  - le timeout du job reste à 30 minutes ;
  - pas de runner payant, pas de cache, pas de parallélisation ;
  - aucun test, aucune langue et aucune vérification ne sont retirés.

Budget d'expérience : un seul run hébergé de cette branche, puis, s'il passe, un run
complet sur le même code. Ce run complet n'est jamais lancé en parallèle d'un run de PR
identique. En cas d'échec, une analyse précède toute nouvelle tentative.

## Limites

- La fenêtre d'audit est déduite des activités voisines ; XCTest n'horodate pas l'audit
  lui-même. Elle inclut le traitement des problèmes signalés, soit 0,1 à 8 s par audit.
- La fin des tests unitaires est estimée à partir de la somme de leurs durées.
- Six runs, sur des machines hébergées différentes : les écarts entre runs restent
  supérieurs à plusieurs des effets mesurés.
