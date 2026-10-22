# SonarQube Cloud dans Aegis

Référence de #76. État relevé le 21 octobre 2026 sur `dev` `a18f981`.

## Ce qui tourne

- L'application GitHub **SonarQube Cloud** (projet `PhilJordan18_aegis`) lance
  une **analyse automatique** sur chaque pull request et sur la branche par
  défaut, `main`. Aucun workflow du dépôt ne la déclenche et aucun jeton n'y est
  stocké.
- `dev` n'est pas analysée comme branche. La dernière analyse de `main` date du
  6 octobre 2026; elle décrit un état ancien du code, pas `dev`.
- Le check « SonarCloud Code Analysis » n'est **pas obligatoire** : les rulesets
  n'exigent que « Source branch » et « CI result ».
- La seule configuration versionnée est `.sonarcloud.properties` (exclusions,
  plus bas).

## Ce qu'une porte « passed » prouve, et ce qu'elle ne prouve pas

Elle prouve que le **nouveau code** d'une PR ne déclenche aucune règle activée au
seuil de la porte : pas de nouvelle vulnérabilité ni de bug notés sous A, pas
plus de 3 % de lignes dupliquées, et tous les points sensibles relus.

Elle ne prouve ni le comportement, ni l'absence de défaut, ni la couverture :
l'analyse automatique ne reçoit **aucun rapport de couverture**, donc « Coverage
on New Code » vaut toujours 0,0 % et n'entre pas dans la porte. Les tests sont
prouvés par la CI, pas par Sonar.

## Lire un échec

1. Ouvrir le lien du check : la page liste les conditions en échec (sécurité,
   fiabilité, duplication…).
2. Lire chaque constat sur le **code actuel**. Un constat de `main` peut porter
   sur une version dépassée.
3. Corriger un défaut confirmé par un commit sur la branche de la PR.
4. Pour un faux positif ou un risque accepté : écrire le raisonnement dans cette
   page, puis le marquer dans SonarQube Cloud (« False positive » ou « Accept »).
   Ce marquage exige un accès au projet; il revient à Philippe.
5. Ne jamais exclure un dossier ni désactiver une règle pour faire passer la
   porte.

## Exclusions présentes

| Paramètre | Portée | Raison |
|---|---|---|
| `sonar.cpd.exclusions=apps/admin-web/src/i18n/messages/**` | Détection de duplication seulement | `fr.ts` et `en.ts` se répondent clé par clé par construction (convention de localisation); toutes les autres règles s'y appliquent |
| `sonar.exclusions=docs/design/identite/v3/**` | Analyse complète | Deux maquettes reçues du designer, conservées telles quelles et jamais servies par une application (`docs/design/identite/reference.md`). Elles portaient toute la duplication et les quatre alertes CSP de la première analyse de #88 |

Ces deux exclusions visent des fichiers nommés, avec une raison vérifiable. Aucune
autre n'existe.

## Constats et traitement

Source : analyses des PR #71, #73, #88 et #92, et analyse de `main` du 6 octobre.
Chaque ligne a été relue sur `dev` `a18f981`.

### Corrigés dans #76

| Règle | Emplacement | Correction |
|---|---|---|
| githubactions:S6505 | `ci.yml`, job Web, `npm ci` | `npm ci --ignore-scripts`. Aucune dépendance du Web ni du simulateur ne déclare de script d'installation (relevé sur `node_modules`); typecheck, lint, tests et build passent ainsi |
| tssecurity:S8707 | `tools/hub-simulator/src/cli.ts`, lecture de `--scenario` | `loadScenarioFile` n'accepte qu'un fichier régulier `.json` d'au plus 256 Kio, avec des erreurs explicites, avant toute connexion; tests unitaires dédiés. Le chemin reste fourni par l'utilisateur local, qui peut lire ce fichier de toute façon : aucune frontière de privilège |
| typescript:S7727 | `tools/hub-simulator/src/scenario.ts`, `.map(parseStep)` | `.map((step, index) => parseStep(step, index))` |
| typescript:S8786 | `apps/admin-web/src/app/routes.ts`, retrait des `/` finaux | Boucle linéaire; équivalence vérifiée sur 349 525 chemins générés |
| typescript:S8786 | `apps/admin-web/src/features/auth/signInValidation.ts`, forme du courriel | Fonction linéaire de même sens; équivalence vérifiée sur 2 396 745 entrées générées et des cas limites |
| python:S5850 | `docs/cahier-conception/pdf/build_cahier_pdf.py:116` | Groupes explicites `(?:^<p>)\|(?:</p>$)`; même résultat |
| Web:S5725 | `reference.html`, `specimen.html` (design), `casier-3d.html` (rendu 3D) | Intégrité SRI `sha384` et `crossorigin="anonymous"` sur les huit ressources CDN épinglées; les pages chargent toujours polices et three.js |

### Corrigés dans #92 (CI-02)

| Règle | Emplacement | Correction |
|---|---|---|
| githubactions:S6505, S8543 | Job simulateur, `npx vitest` | Scripts npm du dépôt (`npm test`, `npm run test:integration`) : seule la version verrouillée s'exécute |
| pythonsecurity:S8705 | `.github/scripts/xcresult-summary.py` | Le script ne prend plus d'argument : il lit seulement `apps/ios/build/results/*.xcresult` |

### Faux positifs (à marquer « False positive »)

| Règle | Emplacement | Raisonnement |
|---|---|---|
| yaml:S2068 ×3 | `.github/workflows/ci.yml`, mot de passe PostgreSQL du job API | Valeur jetable d'un conteneur de service détruit avec le runner; elle ne protège rien et n'existe nulle part ailleurs |
| typescript:S2068 | `apps/admin-web/e2e/support.ts:9`, `src/preview/previewRuntime.ts:24` | Valeurs fictives de l'aperçu (`valeur-fictive-apercu`); la passerelle d'aperçu ne contacte jamais l'API |
| typescript:S6845 | `src/preview/EquipmentPreviewPage.tsx`, `tabIndex` du dossier défilant | Une zone défilante doit être atteignable au clavier (WCAG 2.1.1, règle axe `scrollable-region-focusable`); elle porte `role="group"` et un nom |
| typescript:S6848 | `src/app/shell/ManagerShell.tsx`, `onKeyDown` du menu de compte | Le conteneur intercepte Échap venu de ses éléments focalisables pour fermer le menu sans fermer aussi le tiroir parent; il n'est pas lui-même interactif. Un écouteur sur `document` casserait cet ordre |
| javascript:S2245 | `docs/cahier-conception/pdf/cdp.mjs:55`, `casier-3d.html` | `Math.random` choisit un port local ou des positions de rendu; aucun usage de sécurité |

### Risques acceptés (outils locaux d'auteur)

| Règle | Emplacement | Raisonnement |
|---|---|---|
| python:S8786 ×13, pythonsecurity:S8707 | `docs/cahier-conception/pdf/build_cahier_pdf.py` | Générateur local du PDF du cahier, lancé par son auteur sur les Markdown du dépôt; aucune entrée externe |
| python:S8786, pythonsecurity:S8705 | `docs/design/asset-lifecycle/prototype/tools/contrast.py`, `render.py` | Outils locaux du prototype : expressions sur les CSS du dépôt, capture Chrome avec des arguments construits par le script, sans shell |
| javascript:S1523 ×3 | `docs/design/asset-lifecycle/prototype/tools/check.mjs` | `vm.Script` vérifie la syntaxe des scripts du prototype lui-même; aucun code externe |

### Laissés au propriétaire

| Règle | Emplacement | Note |
|---|---|---|
| javascript:S7767 | `casier-3d.html:125` (Jimmy) | `\| 0` au lieu de `Math.trunc`; lisibilité seulement |
| Web:S6853 | `specimen.html:151` | Spécimen statique d'un champ : le `label` décrit une maquette, pas un formulaire |

## Tests, couverture mesurée, couverture transmise

| Mesure | API | Web | Simulateur |
|---|---|---|---|
| Tests exécutés par la CI | Oui, job « API tests » | Oui, job « Web checks » | Oui, job « Simulator tests » (non obligatoire, #67) |
| Couverture mesurée en local le 21 octobre (lignes) | 96,0 % (722/752); branches 86,4 % (223/258); 110 tests, toutes les classes compilées | 94,5 % (698/739); branches 85,8 % (533/621); tests unitaires, fichiers chargés par les tests seulement | 95,4 % (500/524); branches 89,1 % (334/375); tests unitaires seulement, sans l'intégration broker |
| Couverture transmise à Sonar | Aucune | Aucune | Aucune |

La couverture locale a été mesurée sans rien ajouter au dépôt (JaCoCo 0.8.15 en
ligne de commande pour l'API; `@vitest/coverage-v8` installé sans sauvegarde pour
le Web et le simulateur). Elle n'est ni versionnée, ni contrôlée, ni transmise :
elle donne un ordre de grandeur, pas une garantie.

Limites : Vitest ne compte que les fichiers importés par au moins un test, donc un
fichier jamais importé n'apparaît pas dans le dénominateur; les parcours Playwright
et l'intégration broker ne sont pas inclus. JaCoCo, lui, compte toutes les classes
compilées de l'API.

## Décisions en attente (Philippe)

1. **Couverture.** Garder l'analyse automatique (aucune couverture dans Sonar) ou
   passer à une analyse par la CI qui transmet JaCoCo et la couverture Vitest. La
   seconde exige un secret de dépôt `SONAR_TOKEN`, la désactivation de l'analyse
   automatique dans SonarQube Cloud et un job de scan. Recommandation : décider
   après la stabilisation des jobs de #67.
2. **Porte obligatoire.** Rendre « SonarCloud Code Analysis » obligatoire seulement
   après les critères de #67 : analyses stables, échec démontré, configuration
   documentée.
3. **Marquage.** Marquer dans SonarQube Cloud les faux positifs et risques acceptés
   listés ci-dessus, avec le raisonnement de cette page.
