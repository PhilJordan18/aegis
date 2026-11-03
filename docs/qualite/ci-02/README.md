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
| Accepted ADR guard | **PR seulement**, touchant `docs/adr/`, le registre 13 ou le hook | `check-accepted-adrs.py` sur base..head de la PR | 5 succès sur 3 branches | critère « push sur `dev` » inapplicable en l'état (voir plus bas); aucun échec volontaire hébergé |
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
  `ci-result.py` qui renverrait toujours 0 ne serait pas bloquée; il sera
  promu selon les mêmes critères.

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
| Accepted ADR guard | non qualifié | critère 1 à clarifier (voir plus bas); critère 3 non exécuté; critère 2 atteint juste (5 succès, 3 branches) |
| iOS standalone tests | non qualifié | critère 2 remis à zéro par deux échecs sur `dev` (`007c584`, `639ada8`); critère 6 dépassé sur la suite actuelle; critère 3 non exécuté |
| CI script tests | non qualifié | nouveau, aucun run hébergé |

Lorsque le run rouge du commit de qualification existe, simulateur et validateur
satisfont tous les critères; la PR de l'incrément 2 peut alors sortir du
brouillon.

## Points ouverts à décider

### Garde ADR et critère « push sur `dev` »

Le critère 1 exige un succès sur un push `dev`. La garde compare une PR à sa
base; un push n'a pas de base de PR, et le job ne tourne donc jamais sur `dev`.
Ce critère est **inapplicable en l'état** et n'est pas simulé ici. Options :

- (a) décider par écrit dans #67 que, pour ce job, le critère 1 est remplacé par
  « succès sur une PR vers `dev` après fusion du job »;
- (b) faire tourner la garde sur push avec `github.event.before..github.sha` :
  elle détecterait après coup un ADR modifié sur `dev`, sans l'empêcher.

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
(distincte du Mac de Philippe, iOS 26.3.1). Correction hors de ce périmètre, pour
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

Le push depuis la session cloud est refusé (HTTP 403 : l'application GitHub
Claude n'est pas reliée à ce dépôt pour ce compte). Les deux branches existent
en commits locaux; aucun run hébergé de ces commits n'a donc eu lieu, et aucune
preuve de leurs runs n'est présentée. Un humain disposant du droit de push doit
pousser les branches et ouvrir les PR vers `dev`.

## Ordre de fusion

1. PR de l'incrément 1 (`67-ci-qualify-controls` vers `dev`).
2. PR de l'incrément 2 (`67-ci-promote-qualified-jobs` vers `dev`), après le
   run rouge du commit de qualification et un run vert du commit final.

Aucune règle de ruleset n'est à modifier : `CI result` reste le seul check
requis.
