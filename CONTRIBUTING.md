# Contribuer à Aegis

## Langue

- Le code, les identifiants, les commentaires techniques et les messages de
  commit sont en anglais.
- Les documents du cours et du produit sont en français, sauf indication
  contraire.
- Le backlog nous appartient : issues, pull requests et revues sont en anglais.

## Backlog

Le travail est suivi dans les [issues GitHub](https://github.com/PhilJordan18/aegis/issues)
et sur le tableau [Aegis P0](https://github.com/users/PhilJordan18/projects/2).

- Une issue porte un identifiant stable du document 11 dans son titre, par
  exemple `CAT-01 · Manage an asset model and its assets`.
- Étiquettes : un `type:` (`story`, `enabler`, `poc`, `chore`, `docs`), un ou
  plusieurs `area:` et `status: blocked` au besoin.
- Jalons : `P0.0` à `P0.3`, `HW · POC decisions` et `Stabilization and demo`.
- Une issue a un seul responsable. Deux personnes sur deux parties distinctes
  donnent deux issues, reliées comme sous-issues.
- Colonnes du tableau : `Todo`, `In Progress` (branche ouverte) et `Done`.

## Branches

| Branche | Rôle | Qui y écrit |
|---|---|---|
| `main` | Version validée et présentable | Uniquement une PR depuis `dev`, fusionnée par un humain |
| `dev` | Intégration commune | Uniquement des PR depuis des branches d'issue |
| `<issue>-<type>-<slug>` | Une issue, un changement | Son responsable |

Le nom d'une branche d'issue commence par le numéro de l'issue, suivi du type
Conventional Commits et d'un résumé court en kebab-case :

```text
25-feat-asset-catalog
13-fix-manager-entry-review
17-ci-api-web-checks
```

Le `#` et le `:` sont exclus : `:` est interdit dans un nom de branche Git et
`#` commence un commentaire dans le shell. Le numéro suffit à relier la branche
à l'issue.

Personne ne commit ni ne pousse directement sur `main` ou `dev`, humain comme
agent.

## Cycle d'une issue

1. Prendre une issue du jalon courant, s'assigner et la passer en `In Progress`.
2. Partir d'un `dev` à jour :

   ```bash
   git switch dev
   git pull --ff-only
   git switch -c 25-feat-asset-catalog
   ```

3. Lire les critères de l'issue et seulement les contrats touchés.
4. Réaliser la plus petite tranche verticale qui satisfait les critères, avec
   ses tests.
5. Petits commits Conventional Commits, cohérents et vérifiés, sur la branche
   d'issue, au fil du travail.
6. Passer la porte de livraison, puis ouvrir la PR vers `dev`.

## Porte de livraison « deliver »

Aucune PR n'est ouverte sans cette porte. Elle suit le skill
`aegis-delivery` et produit un rapport qui devient la description de la PR :

- **Outcome** : comportement obtenu et critères de l'issue couverts ou restants;
- **Files** : fichiers importants;
- **Contracts and migrations** : impact REST, MQTT, schéma, états, migration;
- **Verification** : commandes exactes et résultats observés, jamais la seule
  compilation;
- **Risks** : limites, hypothèses, tests non exécutés;
- **Next owner** : relecteur ou décision attendue.

Le rapport est relu par un humain. Sa réponse explicite **« deliver »** autorise
à pousser la branche et à ouvrir la PR. Sans ce mot, l'agent s'arrête au
rapport et ses commits restent locaux.

## Pull requests et fusion

- **Branche d'issue → `dev`** : titre au format Conventional Commits, corps
  basé sur le modèle de PR avec `Closes #<issue>`. Les vérifications doivent
  passer. Le second membre relit quand c'est possible. Fusion en **squash** :
  un commit par issue sur `dev`, puis suppression de la branche. La fusion
  ferme l'issue citée.
- **`dev` → `main`** : PR de livraison ouverte et fusionnée par un humain,
  après une démonstration stable depuis `dev`. Fusion par **merge commit**
  pour conserver l'historique de `dev`. La CI refuse toute PR vers `main` qui
  ne vient pas de `dev`.
- Un agent ne fusionne jamais et n'ouvre pas de PR vers `main` sans demande
  explicite.

## Hooks Git locaux

Les hooks versionnés de `.githooks/` bloquent un commit sur `main` ou `dev`,
un commit qui modifie, renomme ou supprime un ADR accepté, un push vers `main`
ou `dev` et un push de branche mal nommée. Le contrôle des ADR exige `python3`.
Les activer une fois par clone :

```bash
git config core.hooksPath .githooks
```

`--no-verify` reste réservé à une opération humaine exceptionnelle et
annoncée à l'autre membre.

## Garanties techniques et consignes

Une règle n'a pas la même force selon qu'un mécanisme la bloque ou qu'elle
repose sur la discipline des humains et des agents.

| Règle | Mécanisme | Limite connue |
|---|---|---|
| Aucun push direct, aucun force push ni suppression de `dev` et `main`; PR obligatoire | Rulesets GitHub « Protect dev » et « Protect main », sans contournement | Aucune approbation exigée : l'auteur peut fusionner sa propre PR |
| PR vers `dev` depuis une branche `<issue>-<type>-<slug>`; `main` ne reçoit que `dev` | Check obligatoire « Source branch » (`.github/workflows/branch-policy.yml`) | Vérifie le nom de la branche, pas son contenu |
| Aucun commit sur `main` ou `dev`; aucun push vers eux; nom de branche | Hooks locaux `pre-commit` et `pre-push` | Local : `core.hooksPath` à configurer par clone, contournable par `--no-verify` |
| ADR accepté jamais modifié | Hook local `pre-commit` (fichiers de `docs/adr/` et fiches acceptées du document 13) | Local, comme ci-dessus; aucun contrôle en CI pour l'instant |
| Push et PR seulement après « deliver » | Consigne des agents; case du modèle de PR | Aucun blocage technique |
| Fusion par un humain | Consigne | Un compte autorisé peut fusionner, y compris par `gh` |
| Petits commits vérifiés sur la branche d'issue, sans réécriture d'historique | Consigne | Un amend, un rebase ou un commit non vérifié restent possibles localement |

## Décisions d'architecture (ADR)

Un ADR accepté n'est jamais modifié, qu'il s'agisse d'un fichier de `docs/adr/`
ou d'une fiche acceptée du document 13. Pour faire évoluer une décision, créer
un nouvel ADR qui expose :

- la décision antérieure et sa référence;
- la raison du changement;
- la nouvelle décision;
- ses conséquences;
- les sections remplacées.

Mettre ensuite à jour le
[registre du document 13](docs/cahier-conception/13-registre-adrs-proposes.md)
(statut `SUPERSEDED` ou portée remplacée, lien vers le nouvel ADR) et les
références courantes. Un ADR `PROPOSED` reste modifiable jusqu'à son
acceptation. Les amendements déjà présents dans d'anciens ADR restent en l'état.

## Avant de modifier le dépôt

1. Lire `README.md`, `AGENTS.md` et les sections normatives liées à la tâche.
2. Vérifier l’état Git et préserver les changements des autres membres.
3. Définir un résultat mesurable, les invariants touchés et la vérification.
4. Préférer une petite tranche verticale démontrable.

## Conventional Commits

Aegis suit [Conventional Commits 1.0.0](https://www.conventionalcommits.org/fr/v1.0.0/).

Format :

```text
type(scope optionnel): description impérative courte
```

Types retenus :

| Type | Utilisation |
|---|---|
| `feat` | Nouvelle capacité ou nouveau comportement visible |
| `fix` | Correction d’un comportement incorrect, avec le refactoring nécessaire à la correction |
| `docs` | Documentation uniquement |
| `test` | Ajout ou correction de tests sans changement du comportement de production |
| `refactor` | Restructuration sans correction de défaut ni changement de comportement |
| `perf` | Amélioration de performance mesurée |
| `build` | Système de build ou dépendances de production |
| `ci` | Automatisation d’intégration continue |
| `chore` | Outillage, configuration du dépôt ou workflow de développement |
| `revert` | Annulation explicite d’un commit antérieur |

Scopes recommandés : `api`, `db`, `web`, `ios`, `firmware`, `mqtt`, `docs`,
`ai` et `infra`. Le scope est facultatif; il doit aider la lecture plutôt que
répéter le type.

Exemples :

```text
feat(api): add reservation creation endpoint
fix(db): prevent concurrent active reservations
fix(firmware): avoid duplicate lock actuation
docs: restore state-machine specification
test(api): cover expired checkout authorization
refactor(web): extract readiness status component
chore(ai): align Claude and Codex workflows
```

Une restructuration réalisée pour corriger un bug appartient au commit `fix`.
Utiliser `refactor` seulement lorsque le comportement observable reste
volontairement inchangé.

Pour un changement incompatible :

```text
feat(api)!: replace reservation response contract

BREAKING CHANGE: clients must now read the reservation from the data field.
```

La description est en anglais, à l’impératif, sans majuscule initiale imposée
et sans point final. Séparer les changements sans relation en plusieurs commits.
Ajouter un corps lorsque la raison, le compromis, la migration ou la preuve de
vérification n’est pas évidente.

## Vérification et livraison

- Exécuter les tests et validations pertinents avant le commit.
- Ne jamais présenter une compilation comme preuve suffisante.
- Consigner les commandes, résultats, limites et risques connus.
- Dans une tâche autorisée, un agent crée régulièrement de petits commits
  locaux vérifiés sur la branche d'issue, sans demander d'autorisation pour
  chacun.
- Il ne pousse pas, n'ouvre pas de PR, ne fusionne pas, ne déploie pas et ne
  réécrit pas l'historique (amend, rebase, squash, reset, force push) sans
  accord humain. Le push et la PR exigent la porte « deliver »; la fusion reste
  humaine.
