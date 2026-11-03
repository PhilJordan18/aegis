# CI-02 : qualification des contrôles CI

Référence de #67. Relevé du 3 novembre 2026 sur `dev` `639ada8`, à partir de
l'historique GitHub Actions du workflow `CI` (runs `39711005595` à
`41577913719`, job iOS de ce dernier compris). Le détail par exécution est dans
[historique-runs.md](historique-runs.md).

Le texte de #67 (« prepared, not implemented ») est antérieur à #92 : les
quatre jobs existent déjà sur `dev` depuis `bef30df`. Ce bilan ne les recrée pas;
il durcit leurs scripts, mesure leurs preuves et propose une promotion.

## Distinguer les preuves

- **Local cloud** : exécuté dans le conteneur Linux de la session (Python 3.13,
  Node 22, aucun Xcode, aucun démon Docker). Ne prouve rien sur un runner GitHub.
- **GitHub hébergé** : un run GitHub Actions avec son identifiant. Seul ce type
  de preuve compte pour les critères de #67.
- Un `CI result` vert ne prouve pas qu'un job filtré a tourné : tant qu'un job
  est hors des `needs`, `CI result` se termine sans l'attendre (par exemple run
  `41577913719` : `CI result` vert à 04:26, iOS encore en cours). Les comptes
  ci-dessous portent sur la conclusion **du job**, jamais sur celle du workflow.

## Matrice des jobs (état de `dev`)

| Job | Déclenchement | Commande | Preuve disponible | Lacune |
|---|---|---|---|---|
| API tests (requis) | PR touchant `services/api/`, `infra/docker/`; tout push | `./mvnw -B -ntp test` sur PostgreSQL 17 jetable | 46 succès, 0 échec, 15 push `dev` | aucun compte de tests dans le log : ajouté (incrément 1) |
| Web checks (requis) | PR touchant `apps/admin-web/`, `docs/design/manager-entree/`; tout push | `npm ci`, typecheck, lint, `npm test`, build | 33 succès, 0 échec, 15 push `dev` | aucun compte de tests : ajouté (incrément 1) |
| Simulator tests | PR touchant `tools/hub-simulator/`, `infra/mqtt/`, `infra/docker/`; tout push | typecheck, `npm test`, broker Mosquitto isolé, `npm run test:integration`, `test-report.py` | 19 succès consécutifs, 5 branches, 12 push `dev`; comptes exacts (267 run, 0 skipped) | aucun échec volontaire hébergé |
| Agent setup validator | PR touchant `.claude/`, `.codex/`, `.agents/`, `AGENTS.md`, `CLAUDE.md`, `*.md`; tout push | `validate_agent_setup.py`, Python 3.12.15 | 47 succès consécutifs, 14 branches, 12 push `dev`; « 0 warning(s) » | aucun échec volontaire hébergé |
| Accepted ADR guard | **PR seulement**, touchant `docs/adr/`, le registre 13 ou le hook | `check-accepted-adrs.py` sur base..head de la PR | 5 succès sur 3 branches, tous sur des PR vers `dev` (#92, #94, #96) | critère 1 remplacé par « succès sur une PR vers `dev` » (décision ci-dessous); aucun échec volontaire hébergé |
| iOS standalone tests | PR touchant `apps/ios/`; tout push | `ios-test.sh standalone`, macos-26, Xcode 26.3 (17C529) | 19 succès, 10 push `dev` | **deux échecs consécutifs sur push `dev`** (`007c584`, `639ada8`, tests UI du catalogue); durée proche de 20 min; sélection du simulateur dupliquée (corrigé) |
| CI script tests (nouveau) | changement de `ci.yml` ou de `.github/scripts/`; tout push | `python3 -m unittest discover -s .github/scripts/tests` | 30 tests locaux, aucun run hébergé | tout est à faire : reste non requis |

Les jobs filtrés ne tournent que lorsque leur composant change : sur les PR
`37-feat-reservation` (runs `41577162962`, `41577565271`), seuls API et le
validateur ont tourné; simulateur, Web, iOS et la garde ADR sont `skipped`.
Sur un push, `changed-components.sh` lance tout (comportement fail-safe).

## Incrément 1 : scripts, filtres, rapports, sélection iOS

Branche `67-ci-qualify-controls`.

- **iOS** : l'étape « Choose a simulator » appelle
  `apps/ios/scripts/ios-destination.sh` (non modifié) au lieu du Python
  dupliqué. Le choix est vérifié (`platform=iOS Simulator,id=…`), écrit dans le
  résumé de l'étape et dans `build/results/destination.txt`, donc dans
  l'artefact `ios-standalone-results`, même en cas d'échec. Xcode reste fixé par
  `DEVELOPER_DIR`; aucune dépendance au Mac de Philippe ni secret.
- **`CI result`** : la règle passe dans `ci-result.py`. Nouveau : un indicateur
  « needed » absent ou invalide bloque, alors qu'il valait auparavant « non
  requis » et laissait passer un job `skipped`. Un job requis `failure`,
  `cancelled`, `skipped` ou sans résultat bloque; un job non requis en échec
  bloque toujours, comme avant.
- **Garde ADR** : son applicabilité aux seules PR est écrite dans
  `changed-components.sh` (`adrs=false` sur push et `workflow_dispatch`) au lieu
  d'une condition propre au job, pour que `CI result` puisse l'attendre sans cas
  particulier.
- **Rapports de tests** : `test-report.py` affiche les comptes observés par
  rapport JUnit et leur total, sans total attendu, et échoue si **un** rapport
  est vide (auparavant seul le total comptait). API et Web publient désormais
  leurs comptes (Surefire et JUnit vitest) avec la même règle; aucun test API ou
  Web n'est ignoré aujourd'hui (Web local : 549 run, 0 skipped).
- **Validateur et suppressions** : une PR qui supprime ou renomme un fichier,
  quel qu'il soit, lance le validateur, car il refuse tout lien Markdown vers un
  fichier absent. Avant, supprimer un fichier HTML lié depuis un document
  laissait le validateur `skipped` sur la PR puis rouge sur `dev` (constat de la
  revue indépendante, reproduit dans un clone de travail).
- **Tests des scripts** : `.github/scripts/tests/test_ci_scripts.py`
  (`unittest`, bibliothèque standard), exécuté par le job non requis « CI script
  tests ».

## Revue indépendante

Revue en lecture seule (rôle `qa-reliability-engineer`) de l'incrément 1 et du
commit de promotion :

- `>-`, sorties absentes de `changes`, étape iOS sous `bash -e`, rapports JUnit
  Web et Surefire, défauts injectés : vérifiés, sans défaut.
- Corrigés : validateur ignoré sur suppression ou renommage (ci-dessus); test de
  câblage qui ne vérifiait pas la ligne de commande de `ci-result.py`;
  commentaire périmé du filtre Web (le chemin `docs/design/manager-entree/` est
  conservé, il ne fait que lancer Web plus souvent).
- Restant : « CI script tests » n'est pas requis, donc une régression de
  `ci-result.py` qui renverrait toujours 0 ne serait pas bloquée. Voir son
  plan de qualification plus bas.

## Incrément 2 : promotion

Branche `67-ci-promote-qualified-jobs`, empilée sur l'incrément 1.

1. Commit de qualification (temporaire) : les quatre jobs dans les `needs` de
   `CI result`, et un défaut créé **sur le runner** dans chacun : un test vitest
   qui échoue, un lien Markdown cassé, une modification d'ADR accepté dans un
   dépôt-fixture jetable (aucun ADR du dépôt n'est touché, même dans la copie du
   runner), un test Swift qui échoue. Aucun fichier d'application n'est commité.
2. Commit suivant : retire tout le dispositif, garde **Simulator tests** et
   **Agent setup validator** dans les `needs`, ajoute un test vérifiant que
   chaque job des `needs` est bien transmis à `ci-result.py`.
3. Après la décision (a) sur la garde ADR : **Accepted ADR guard** rejoint les
   `needs`. Sur push et sur une PR qui ne touche aucun ADR, `adrs=false` et la
   garde `skipped` ne bloque pas.

### État rouge de `1ab1203` : à ne jamais fusionner

`1ab1203432a0c8f4ea9ab58973c988efbd545e40` est la fusion du commit de
qualification `78a8380b2979aeadff094b03de72848ecc8c6e9f` avec la documentation;
son `ci.yml` contient les quatre étapes `CI-02 deliberate …` :

| Job | Défaut créé sur le runner | Résultat attendu |
|---|---|---|
| Simulator tests | `tools/hub-simulator/test/unit/ci02-deliberate-failure.test.ts`, `expect(1).toBe(2)` | « Unit tests » rouge; « Test counts » : `1 failed` et rapport d'intégration absent |
| Agent setup validator | `docs/qualite/ci-02/ci02-broken-link.md`, lien vers un fichier absent | `Broken local link …`, `1 error(s)` |
| Accepted ADR guard | dépôt jetable `$RUNNER_TEMP/ci02-adr-fixture`, ADR-901 `ACCEPTED` modifié | `Accepted ADRs are immutable … ADR-901-fixture.md (accepted ADR)` |
| iOS standalone tests | `apps/ios/AegisMobileTests/CI02DeliberateFailureTests.swift`, `Issue.record` | `error: failures`, 1 échec de plus que la suite |
| CI result | quatre jobs dans `needs` | rouge, une ligne `::error::` par job |

Le commit `134db89a834a6d425b53cc3cbb7536db03096bce` retire ces quatre étapes
et ramène les `needs` à `changes, api, web, simulator, agents`. Seule la tête
de la branche est fusionnable, et seulement après les preuves.

Exécutions rouges attendues sur le commit 1 : simulateur (`1 failed`, rapport
d'intégration absent), validateur (`Broken local link`), garde ADR (`Accepted
ADRs are immutable`), iOS (`failures`), puis `CI result` en échec avec une ligne
d'erreur par job.

## Qualification

| Job | Statut | Raison |
|---|---|---|
| API tests | requis (inchangé) | hors de cette promotion; comptes ajoutés |
| Web checks | requis (inchangé) | hors de cette promotion; comptes ajoutés |
| Simulator tests | **non qualifié : une preuve manque** | critères 1, 2, 4, 5, 6, 7 satisfaits (médiane 0,8 min); critère 3 : run rouge hébergé du commit de qualification non exécuté |
| Agent setup validator | **non qualifié : une preuve manque** | critères 1, 2, 5, 6, 7 satisfaits (médiane 0,1 min); critère 4 adapté : sa preuve est « N error(s), N warning(s) » et la version Python, pas un nombre de tests; critère 3 : run rouge hébergé non exécuté |
| Accepted ADR guard | non qualifié : une preuve manque | critère 1 remplacé (décision ci-dessous) et satisfait : 5 succès sur des PR vers `dev`; critère 2 atteint juste (5 succès consécutifs, 3 branches, aucune relance); critère 4 adapté : sa preuve est le message « No accepted ADR changed », pas un nombre de tests; critère 3 : run rouge hébergé non exécuté |
| iOS standalone tests | non qualifié | critère 2 remis à zéro par deux échecs sur `dev` (`007c584`, `639ada8`); critère 6 dépassé sur la suite actuelle; critère 3 non exécuté |
| CI script tests | non qualifié | nouveau, aucun run hébergé |

Lorsque le run rouge du commit de qualification existe, simulateur, validateur et
garde ADR satisfont tous les critères; la PR de l'incrément 2 peut alors sortir du
brouillon.

## Plan de qualification de « CI script tests »

Ce job protège `ci-result.py`, `changed-components.sh` et `test-report.py`, donc
la règle même de `CI result`. Il ne peut pas rester non requis indéfiniment.

- **Déclenchement** : `ci=true` sur toute PR qui modifie `ci.yml` ou
  `.github/scripts/`, et sur tout push. Le filtre ne l'omet donc jamais
  lorsqu'un script qu'il protège change.
- **Critère 1** : après fusion de l'incrément 1, chaque push sur `dev` le lance;
  le premier succès sur `dev` compte.
- **Critère 2** : cinq succès consécutifs hébergés sur au moins deux branches
  (l'incrément 1, l'incrément 2 et `dev` en fournissent trois).
- **Critère 3** : un commit de qualification qui, sur le runner seulement,
  remplace `return 1 if errors else 0` par `return 0` dans `ci-result.py` avant
  `unittest`. Attendu : « CI script tests » rouge (tests `CiResultTests`), et
  `CI result` rouge lorsque le job est dans ses `needs`. Ce commit est retiré par
  le suivant, comme pour l'incrément 2.
- **Critère 4** : `unittest -v` affiche chaque test et `Ran N tests`; un nombre
  nul de tests fait échouer `unittest discover` (code 5).
- **Critères 5 à 7** : Python 3.12 par `setup-python` épinglé, moins d'une
  minute, bibliothèque standard, aucun secret.
- **En attendant** : toute PR qui modifie `.github/scripts/` ou `ci.yml` n'est
  fusionnée qu'avec « CI script tests » vert, vérifié à la revue et noté dans la
  PR.

## Points ouverts à décider

### Garde ADR et critère « push sur `dev` » : décidé

La garde compare une PR à sa base. Un push n'a pas de base de PR, et le job ne
tourne donc jamais sur `dev` : le critère 1 lui est inapplicable tel qu'écrit.

**Décision humaine du 3 novembre 2026 (Philippe), option (a)** : pour ce job
seulement, le critère 1 « succès sur un push `dev` » est remplacé par « succès
hébergé sur une PR vers `dev` ». L'option (b), un contrôle sur push avec
`github.event.before..github.sha`, est écartée : elle constaterait après coup un
ADR modifié sur `dev`, sans l'empêcher. Les autres critères de #67 restent
inchangés pour ce job, y compris le run rouge volontaire.

Preuve du critère remplacé : les runs listés dans
[l'historique](historique-runs.md#accepted-adr-guard) sont des PR vers `dev`
(#92, #94, #96), `run_attempt` = 1.

### iOS : tests UI du catalogue rouges sur `dev`

Les deux derniers pushs `dev` échouent; le code avait passé sur la PR
(`41507526895`, `12c8776`, 160/160). Les noms viennent des bundles
`standalone.xcresult` des artefacts `ios-standalone-results` :

| Run | SHA | Résultat | Test | Message |
|---|---|---|---|---|
| `41515528716` | `007c584` | 158/160 | `CatalogUITests/testCatalogueFilterSheetAndBackInBothLanguagesAndAppearances()` | `Audit failed to complete in time` (audit d'accessibilité, code -56) |
| `41515528716` | `007c584` | | `CatalogUITests/testOfflineRefreshKeepsTheLastListThenTryAgainRecovers()` | idem |
| `41577913719` | `639ada8` | 159/160 | `CatalogUITests/testOfflineRefreshKeepsTheLastListThenTryAgainRecovers()` | `Dynamic Type font sizes are partially unsupported` sur le libellé « Last known: Blocked » |

Le premier cas ressemble à une limite de temps du runner, le second à un vrai
constat d'accessibilité sur iPhone 17 iOS 26.5, la configuration hébergée
(distincte du Mac de Philippe, iOS 26.3.1). Détails, liens et logs pour la session iOS dans
[transmission-ios-catalog-ui-tests.md](transmission-ios-catalog-ui-tests.md).
Correction hors de ce périmètre, pour
la session iOS : `apps/ios/AegisMobileUITests/CatalogUITests.swift` et la vue du
libellé concerné. La règle « aucun test ignoré » ne doit pas être assouplie.
Le défaut ne dépend pas de l'incrément 1, qui ne change que le choix du
simulateur (même iPhone 17 iOS 26.5 attendu).

Durée : la médiane de tous les succès est 12,9 min, mais avec la suite actuelle
(159 à 170 tests) les jobs durent 16,6 à 21,4 min (médiane 19,6 min sur six
runs), au-delà de la limite de 20 min sur deux succès. Le
`timeout-minutes: 30` du job n'a pas été modifié.

### Hors mission

La recette iOS live, un runner sur le Mac de Philippe, la compilation firmware
et Sonar restent hors de cette mission (#67, rubriques « deferred »).

## Versions et coûts

| Élément | Valeur |
|---|---|
| Runners | `ubuntu-24.04`; `macos-26` (arm64) pour iOS |
| Java / Node / Python | Temurin 21; Node 24; Python 3.12.15 (validateur et tests des scripts) |
| Xcode | 26.3 (17C529) via `DEVELOPER_DIR`; simulateur iPhone 17 iOS 26.5, SDK 26.2 |
| Actions | `checkout` v7.0.1, `setup-java` v6.1.0, `setup-node` v7.1.0, `setup-python` v7.0.0, `upload-artifact` v7.0.2, toutes fixées par commit |
| Médianes observées | API 1,4 min; Web 0,7; simulateur 0,8; validateur 0,1; garde ADR 0,1; iOS 12,9 |
| Coût | dépôt public : minutes hébergées sans facturation; le run iOS est le seul long |
| Secrets | aucun; seulement `infra/docker/.env.example` et des valeurs jetables |

## Tests locaux exécutés (cloud, Linux)

| Commande | Résultat |
|---|---|
| `python3 -m unittest discover -v -s .github/scripts/tests` | 30 tests OK (31 sur l'incrément 2) |
| `actionlint` 1.7.7 sur `ci.yml` | seule remarque : l'étiquette `macos-26`, inconnue de cette version d'actionlint (déjà présente sur `dev`) |
| Étape « Choose a simulator » avec un faux `xcrun` | iPhone 17 iOS 26.5 choisi parmi deux runtimes; sans iPhone : échec explicite, rien dans `GITHUB_ENV` |
| Web `npm test` + reporter JUnit + `test-report.py` | 549 run, 549 passed, 0 skipped |
| Simulateur, intégration sans mot de passe broker | vitest sort en 0 avec 9 tests `skipped`; `test-report.py` échoue (« 9 skipped ») |
| Défauts du commit de qualification rejoués localement | garde ADR, validateur et simulateur échouent; iOS non rejouable sous Linux |

Limite locale : un test unitaire du simulateur (fichier illisible) échoue parce
que le conteneur tourne en root; il passe sur chaque run hébergé (non-root).

## Limite de cette session

Le push depuis la session cloud a d'abord été refusé (HTTP 403 : l'application
GitHub Claude n'était pas reliée au dépôt). L'accès a été rétabli le
3 novembre 2026; les branches ont été poussées sans force et les PR ouvertes
vers `dev` : #110 (incrément 1) et #111 (incrément 2, brouillon).

## Ordre de fusion

1. PR de l'incrément 1 (`67-ci-qualify-controls` vers `dev`).
2. PR de l'incrément 2 (`67-ci-promote-qualified-jobs` vers `dev`), après le
   run rouge du commit de qualification et un run vert du commit final.

Aucune règle de ruleset n'est à modifier : `CI result` reste le seul check
requis.
