# Diagnostic mesuré du job iOS standalone (CI-02, #67)

Établi le 3 novembre 2026 à partir des résultats hébergés existants ; la section 7
ajoute le run de #120. Les mesures sont reproductibles avec les
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
| 4.4 | Le premier tap sur « Réessayer » ne fait pas disparaître le bandeau en 5 s : un deuxième tap est fait | 20 itérations sur 22 dans les runs 41620521054, 41620501772, 41588098193, 41586558351, puis 41622125076 et 41629351716 (8 taps de `catalog.retry` pour 4 itérations). Le commentaire du test dit pourtant « seen once ». | **Défaut produit possible ou fragilité de test, non tranché.** Cela contrevient à la décision « pas de taps répétés » : le deuxième tap peut masquer un premier tap ignoré par l'app, par exemple un rafraîchissement encore en cours (`ignoresADuplicateRefreshWhileOneIsInFlight`). |
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
   refait un audit interrompu. Ce n'est pas une suppression de constat, mais il
   augmente le coût et peut masquer une instabilité ; voir la section 7.
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

Budget d'expérience : le run de PR 41629351716 a exécuté la recette complète, et il
compte comme le run complet. Le run manuel identique mis en file derrière lui a été
annulé (section 7). Un nouvel essai macOS doit répondre à une hypothèse précise ; une
correction Python ou de documentation n'en justifie pas.

## 7. Résultat du run de #120 et concurrence observée

**Run 41629351716** (PR #120, 8a0aa6e) :

- Il exécute la recette `standalone` complète, car `ci.yml` modifié sélectionne tout
  le code iOS de `dev`. Il compte donc comme le run complet du budget.
- Résultat : succès, 249 exécutions de cas sur 249, sans échec ; le résumé
  `xcresulttool` annonce 160 tests sur 160.
- Le job iOS dure 21 min 51 s.

Ses phases sont successives et ne se chevauchent pas :

| Phase | Durée |
|---|---:|
| Préparation et outils | 28 s |
| Démarrage du simulateur (nouvelle étape) : « booted » en 4 s, puis prêt 102 s plus tard (« Waiting on Data Migration ») | 108 s |
| Recette | 1 137 s |
| … dont compilation | 124 s |
| … dont session → premier test unitaire | 96 s |
| … dont tests unitaires | 17 s |
| … dont fenêtre UI | 767 s |
| Résumé et artefact | 7 s |

Comparaison du coût de premier démarrage, du début de session au premier test
unitaire :

| Run | Code iOS | Étape de démarrage | Session → 1er test | Total |
|---|---|---:|---:|---:|
| 41622125076 (#116 4084695) | #116 | — | 242 s | 242 s |
| 41629351716 (#120) | `dev` | 108 s | 96 s | 204 s |
| Six runs de la section 2 | divers | — | 109 à 241 s | 109 à 241 s |

L'étape déplace le coût hors de la recette et le rend visible. Elle échouerait
proprement si le simulateur ne démarrait pas. **Aucun gain net n'est démontré** : le
total reste dans la plage observée sans l'étape, et sur un seul échantillon. Elle est
gardée pour la mesure et l'isolement de l'échec, pas pour la durée.

Elle n'agit pas sur les 767 s de tests UI ; c'est la suite rapide
([suites-ios.md](suites-ios.md)) qui vise cette durée.

**Concurrence**, en partie hébergée et en partie seulement testée :

- **Run manuel et run de PR identiques : vérifié en hébergé.**
  - Le run manuel 41629358068 a été créé à 11:40:02 et ses jobs ont commencé à
    12:02:00, après la fin du run de PR. Ils n'ont pas tourné en parallèle.
  - Mais la file a ensuite exécuté une recette identique, sur le même SHA : environ
    14 min de macOS, jusqu'à son annulation manuelle à 12:16:38.
  - **Une file d'attente sérialise les doublons, elle ne les supprime pas.** Règle
    retenue : pas de lancement manuel sur une branche qui a une PR ouverte ; relancer
    le run de la PR à la place.
- **Nouvelle révision d'une PR : non observé avec la nouvelle clé.**
  - `cancel-in-progress` n'est vrai que pour `pull_request`, ce que vérifie un test de
    configuration.
  - Avec l'ancienne clé de `dev`, le run 41633303702 de #119 a bien été annulé par le
    run 41634195510 de la révision suivante.
- **Deux branches : clé distincte par branche.** Ce point est vérifié par le test de
  configuration. Les runs de #118 et #119 ont tourné pendant ceux de #120 sans être
  annulés, mais ils utilisaient le `ci.yml` de `dev`.
- **Une demande en attente devenue obsolète n'est pas annulée seule** si elle n'est pas
  remplacée par une plus récente du même groupe. C'est le cas ci-dessus, d'où la règle.

**Tentative de #116 après un audit interrompu.** `performCompletedAccessibilityAudit`
(`apps/ios/AegisMobileUITests/StillScreen.swift`, commit 4084695) refait l'audit une
seule fois, et seulement sur l'erreur -56.

- **Ce n'est pas une suppression de constat** : un audit interrompu n'a rendu aucun
  constat, les constats d'un audit terminé échouent toujours, et un second -56 échoue.
- **Elle double le coût de l'audit concerné et peut masquer une instabilité.** Elle
  laisse une activité « Audit did not complete in time; auditing again » dans le
  bundle, mais rien dans le résumé du job.
- **Dans le run vert 41622125076, cette activité est absente** : la nouvelle tentative
  n'a pas servi, et ce run ne la valide donc pas.

C'est à la session iOS de la rendre visible dans le résumé, de la justifier et de la
traiter.

## 8. Limite du job portée à 45 minutes (22 novembre, branche `67-ci-ios-job-timeout`)

La limite de 30 minutes notée en section 6 ne tient plus. Avec les branches #46 et #50,
la suite `standalone` compte environ 312 tests, et des runs complets et verts étaient
annulés.

| Tête | Démarrage du simulateur | Étape « iOS recipe » | Job | Issue |
|---|---|---|---|---|
| #198 `f65f37b` | 2 min 25 s | **26 min 35 s** (312/312 réussis, chaînes 271/271) | 30 min 08 s | annulé à la limite |
| #199 `aee89f8` | 2 min 15 s | annulée après 27 min 06 s | 32 min 16 s | bundle non finalisé, aucun décompte |
| #199 `a3c0fac` | 1 min 30 s | annulée après 27 min 33 s | — | aucun décompte |
| #198 `d15aa52` | 1 min 37 s | annulée après 27 min 51 s | — | aucun décompte |

Décision de Philippe (#67, commentaire 7083109682) : porter `timeout-minutes` du job à
**45**, comme correctif de capacité, et ne rien changer d'autre :

- même sélection de tests, mêmes assertions, même couverture d'accessibilité ;
- aucune relance ni répétition de test, et aucun délai d'audit allongé.

Le test `test_ios_job_is_bounded_at_45_minutes_without_retries` vérifie trois choses :
- la limite du job est bien de 45 ;
- l'ancienne valeur de 30 a disparu ;
- ni le job ni `apps/ios/scripts/ios-test.sh` ne contiennent `retry`, `-test-iterations`
  ou `-run-tests-until-failure`.

Si 45 minutes expirent encore, il ne faut pas relever la limite une nouvelle fois. Il
faut proposer un découpage mesuré de la recette à partir des durées de chaque phase.

## 9. Échecs du premier test UI et mesure de la charge (24 novembre, branche `67-ci-ios-boot-diagnostics`)

### Constat

Depuis le 22 novembre, les dix runs iOS hébergés ont tous utilisé l'iPhone 17 sous
iOS 26.5. Trois d'entre eux ont échoué, chaque fois sur le même test.

| Run | Tête | Résultat | Démarré / prêt | Point d'échec |
|---|---|---|---|---|
| 45053104908 | #203 `7b338b8` | succès | 7 s / 179 s | |
| 45056107651 | dev `9215d8e` | succès | 8 s / 151 s | |
| 45056397509 | #198 `6c6a095` | succès | 5 s / 138 s | |
| 45056423543 | #199 `70d6bbd` | succès | 2 s / 114 s | |
| 45063759639 | dev `e36b816` | **échec** | 3 s / 133 s | attente de 10 s dépassée après le filtre « Bloqué » |
| 45065394579 | #199 `8cb0f70` | succès | 5 s / 207 s | |
| 45178849369 | dev `b4b69c6` | **échec** | 5 s / 83 s | audit 1 (à froid) abandonné à 15,1 s, code -56 |
| 45180074021 | #206 `bcc9ccc` | succès | 4 s / 163 s | |
| 45425852057 | dev `12053b8` | succès | 3 s / 167 s | |
| 45433389846 | #208 `a61c247` | **échec** | 3 s / 78 s | audit 4 abandonné à 32,2 s, code -56 ; audits 1 à 3 en 5,6, 3,4 et 4,5 s |

Le test en échec est `CatalogUITests/testCatalogueFilterSheetAndBackInBothLanguagesAndAppearances`.
C'est toujours lui qui s'exécute en premier parmi les tests UI, puisque sa classe et son
nom viennent en premier dans l'ordre alphabétique. Sur le run de #208, les 50 autres audits
ont duré au plus 7,2 s.

- **iOS 26.5 n'est pas la cause.** Les runs verts utilisaient la même version.
- **La préparation du simulateur donne un signal faible.** Deux des trois échecs ont eu
  la préparation la plus courte (78 et 83 s). En revanche, le troisième, à 133 s, se
  situe dans la plage des runs verts (114 à 207 s).
- **Hypothèse à vérifier.** `simctl bootstatus` rendrait la main alors que le premier
  démarrage du simulateur se poursuit, et le premier test UI absorberait cette charge.

### Mesure ajoutée

L'étape de démarrage lance `.github/scripts/simulator-load.sh` en arrière-plan, juste
après `bootstatus`. Toutes les 10 s, pendant au plus 45 minutes, le script note dans
`build/results/simulator-load.tsv` :
- la charge de la machine sur une minute ;
- le nombre de processus du simulateur ;
- leur part de processeur.

L'instant où le simulateur est prêt est noté dans `simulator-boot.txt`. Les deux fichiers
sont joints à l'artefact `ios-test-results`. Le résumé du job ajoute une ligne : charge
au premier échantillon, pic et instant du pic après la préparation, dernière valeur.

**Ce que la mesure ne change pas :**
- les tests démarrent immédiatement, sans attendre aucun signal ;
- aucune relance automatique, aucun test retiré, aucun délai modifié ;
- un échec de l'échantillonneur n'affecte pas le job.

Des tests vérifient que le lancement se fait en arrière-plan, sans `wait` ni `sleep`, et
qu'aucune étape suivante ne dépend de l'échantillonneur.

### Analyse prévue

Les mesures s'accumulent avec les runs iOS déjà nécessaires. Aucune suite n'est lancée
seulement pour accumuler des mesures.

Pour chaque run, on compare la charge au début du premier test UI, entre runs verts et
runs en échec. L'instant de ce début se lit dans le bundle, avec la commande `ui-tests`
de [mesures/xcresult_mesures.py](mesures/xcresult_mesures.py). Le bundle compte en
secondes depuis le 1er janvier 2001 : on ajoute 978 307 200 pour obtenir l'époque Unix.

**Décision selon le résultat :**
- **Charge nettement plus haute dans les échecs.** Proposer d'attendre, dans l'étape de
  démarrage et dans une limite fixée, que la charge retombe. Cette attente devra être
  mesurée et approuvée par Philippe.
- **Aucune différence.** L'hypothèse de démarrage est écartée, et l'échec reste à
  diagnostiquer avec #117.

## 10. Expériences ciblées #210 et cause probable (25 novembre)

La PR #210 était une expérience jetable : un workflow qui ne se déclenchait que sur sa propre PR.
Elle est fermée sans merge, et sa branche `67-ci-ios-first-audit-experiment` est conservée.
Ses deux exécutions sont les seules preuves de cette section.

### Exécution 1 (`930feb3`, run 45493019592)

Huit essais :
- deux blocs, chacun effacement et démarrage, puis 3 essais du test du catalogue,
  puis un redémarrage et un test de remise ;
- aucun échec.

Ce que les durées montrent :
- Le premier audit d'un nouveau processus de test coûte environ 7 s, quel que soit
  l'âge du simulateur.
- Les seuls audits lents (14,2 s ; une traîne à 19,2 s) tombent dans les dix minutes
  qui suivent le premier démarrage.
- Les essais lancés plus de 600 s après le démarrage restent sous 7,4 s.
- La charge `load1` ne sépare pas les essais lents des autres.

### Lecture des runs CI complets

Les bundles de cinq runs ont été relus activité par activité :
#209 (vert), #208 `2e8d0dd`, #208 `5335207`, #204 `03f9a93` et la première tentative de #208 `2e8d0dd`.

- Le premier test UI commence 215 à 535 s après que le simulateur est prêt.
- Lorsqu'un pas est lent, le tap qui ouvre la fiche bloquée attend 12 à 17,7 s
  que l'app soit inactive, au lieu d'environ 1 s. L'audit suivant dure 10,7 à 27,9 s,
  ou s'arrête sur -56 après 15,7 à 18,1 s.
- Un audit a réussi après 27,9 s : le -56 n'est donc pas un budget fixe de 15 s.

### Exécution 2 (`33f62c5`, run 45516470323)

Protocole :
- un démarrage après effacement, puis 4 essais du test du catalogue ;
- le CPU de chaque processus au-dessus de 5 %, relevé chaque seconde ;
- la pile de l'app, prise quand elle dépasse 50 % pendant 3 s.

Résultats :
- **Les 4 essais réussissent.** Un seul épisode lent apparaît, dans l'essai 1, de +306 à +341 s
  après le démarrage : le tap anglais en mode sombre dure 8,0 s et l'audit 8 dure 20,1 s.
- **L'app n'est pas occupée pendant cet épisode.** Elle est à 5 à 9 % de CPU.
- **Le simulateur exécute ses tâches de premier démarrage.**
  `AuthenticationServicesAgent` monte à 86–94 %. Les extensions de fonds d'écran
  (`*PosterExtension`), les widgets, `provjobd`, `diskimagesiod`, `MessagesBlastDoorService`
  et `BackgroundShortcutRunner` tournent aussi.
- **Les essais 2 à 4 (de +353 à +897 s) restent rapides.** Chaque tap dure au plus 2,1 s
  et chaque audit au plus 9,4 s ; ce maximum est l'audit 1, à froid.
- **Aucune pile ne montre une boucle de l'app.** Les trois piles prises montrent son fil
  principal dans `XCTElementQuery` (requêtes de XCTest servies dans l'app) ou en attente
  `mach_msg`, jamais dans du code d'Aegis.

### Conclusion

**Cause probable : le simulateur, pas l'app.** Le premier test UI d'un run hébergé tombe
pendant les tâches de premier démarrage du simulateur, sur un runner `macos-26`. Un
audit ou un tap qui coïncide avec une rafale de ces tâches attend que l'app redevienne
inactive. Ce n'est pas lié à un écran : la « passe anglaise claire » des runs CI n'était
que le pas qui coïncidait.

**Ce que ces données ne prouvent pas :**
- Il n'y a qu'un épisode lent mesuré processus par processus.
- Le moment des rafales varie : la moyenne du CPU système fluctue jusqu'à +900 s sans
  palier net.

**Ce que cela exclut :**
- **Découper le test du catalogue.** Le pas qui coïncide avec une rafale changerait,
  sans supprimer l'attente.
- **Attendre une « inactivité » du simulateur avant les tests.** Aucun seuil observé ne
  sépare un simulateur stabilisé d'un simulateur qui va encore lancer une rafale ; cette
  attente coûterait du temps sans garantie.
- **Les mesures interdites** restent exclues : relance, délai d'audit allongé, retrait d'audit.

**Options pour Philippe :**
1. **Capacité.** Un runner macOS plus grand, payant : il donne plus de cœurs aux mêmes
   tâches. C'est un changement de capacité, sans changement de test.
2. **Ordre.** Faire passer les tests UI audités après les tests UI sans audit. Ce changement
   est du ressort d'iOS (plan de test), sans perte de couverture, mais l'effet n'est pas
   démontré.
3. **Limite documentée.** Garder l'état actuel, et qualifier chaque rouge iOS contre la
   signature de #67 : premier test UI, attente d'inactivité ou -56, tous les autres tests verts.

## Limites

- La fenêtre d'audit est déduite des activités voisines ; XCTest n'horodate pas l'audit
  lui-même. Elle inclut le traitement des problèmes signalés, soit 0,1 à 8 s par audit.
- La fin des tests unitaires est estimée à partir de la somme de leurs durées.
- Six runs, sur des machines hébergées différentes : les écarts entre runs restent
  supérieurs à plusieurs des effets mesurés.
- Section 10 : un seul épisode lent observé processus par processus ; la cause est probable,
  non prouvée en général.
