# Contribuer à Aegis

## Langue

- Le code, les identifiants, les commentaires techniques et les messages de
  commit sont en anglais.
- Les documents du cours et du produit sont en français, sauf indication
  contraire.

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
- Ne pas commit, pousser, fusionner ou déployer sans autorisation humaine
  explicite.
