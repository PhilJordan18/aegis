# Aegis - Guide de travail avec les agents et les skills

## 1. Pourquoi ce guide existe

Ce guide explique comment Philippe et Jimmy utilisent Claude Code et Codex sans
confondre agent, sous-agent, skill, outil, contexte et session. Il complète les
fichiers techniques; il ne remplace ni le plan de cours, ni les consignes d'une
évaluation, ni les décisions humaines de l'équipe.

L'objectif n'est pas de faire produire le projet par une armée d'agents. Le but
est de rendre le travail plus explicite, traçable, vérifiable et économique en
tokens, tout en permettant aux deux étudiants d'expliquer ce qu'ils soumettent.

## 2. Modèle mental

| Élément | Définition pratique | Exemple Aegis |
|---|---|---|
| Modèle | Moteur qui génère et raisonne | Un modèle Claude ou GPT |
| Agent | Modèle + instructions + contexte + outils + boucle d'action | La session Claude Code ou Codex qui traite une story |
| Sous-agent | Agent délégué avec un contexte séparé et une tâche bornée | QA vérifie une réservation concurrente |
| Skill | Procédure ou expertise réutilisable chargée au besoin | `aegis-postgres` |
| Outil | Capacité d'agir ou d'observer | Lire un fichier, lancer les tests, interroger Git |
| Contexte | Informations actuellement visibles par le modèle | Demande, instructions, fichiers lus, résultats de tests |
| Session | Historique de travail conservé autour d'un sujet | Une conversation sur FND-02A |
| Token | Unité de texte traitée par le modèle | Fragments de prose, code, ponctuation et sorties d'outils |

Claude Code et Codex sont des environnements agentiques. Dans une session
normale, ils jouent le rôle d'agent principal. Une instance qu'ils délèguent
devient un sous-agent relativement à cette session. « Agent » et « sous-agent »
décrivent donc une relation, pas deux catégories de logiciels.

## 3. Où vit chaque règle

| Besoin | Emplacement |
|---|---|
| Règles durables communes à Claude et Codex | `AGENTS.md` |
| Routage propre à Claude Code | `CLAUDE.md` |
| Rôles Claude spécialisés | `.claude/agents/` |
| Rôles Codex équivalents | `.codex/agents/` |
| Procédures et expertise du projet | `.claude/skills/` |
| Découverte des mêmes skills par Codex | `.agents/skills/` |
| Limite de parallélisme Codex | `.codex/config.toml` |
| Préférences personnelles non partagées | fichiers locaux ignorés par Git |

Les skills Claude sont la copie canonique. Les entrées `.agents/skills/` sont
des liens, pas une deuxième version à maintenir. Une correction faite dans le
skill canonique est donc visible par les deux outils.

`CLAUDE.md` importe `AGENTS.md`. Il ne répète que le routage spécifique à
Claude. Cette séparation évite que les règles métier divergent quand l'équipe
passe d'un outil à l'autre.

## 4. Skill, sous-agent ou simple instruction?

Utiliser ce test:

- Une règle ne concerne que la tâche actuelle: la mettre dans la demande.
- Une règle doit s'appliquer à presque toutes les tâches du dépôt: `AGENTS.md`.
- Une expertise ou une procédure revient souvent: skill.
- Une enquête bruyante ou une revue doit rester isolée: sous-agent.
- Une règle doit être garantie mécaniquement: test, linter, CI, permission ou hook.

Exemples:

| Besoin | Bon mécanisme |
|---|---|
| Toujours garder Spring comme autorité métier | `AGENTS.md` + tests d'architecture |
| Concevoir une migration Flyway | `aegis-postgres` |
| Faire relire un diff sans influencer le reviewer | sous-agent QA en lecture seule |
| Vérifier la syntaxe JSON/TOML et les liens locaux | script de validation |
| Interdire un push automatique | permission + instruction durable |
| Corriger une faute dans une page précise | demande courante, sans nouvel agent |

## 5. Rôles Aegis

| Rôle | Quand l'utiliser | Ce qu'il ne doit pas faire |
|---|---|---|
| `solution-architect` | Limites, ADR, contrats, plan vertical | Implémenter tout le système par défaut |
| `backend-security-engineer` | Spring, sécurité, états, MQTT backend | Posséder seul les migrations |
| `database-engineer` | Schéma, Flyway, verrous, index | Affaiblir un invariant pour passer un test |
| `web-engineer` | React admin et TanStack Query | Recalculer la readiness dans le navigateur |
| `ios-engineer` | SwiftUI, Keychain, async/await | Parler directement à MQTT ou au locker |
| `firmware-engineer` | ESP32, capteurs, serrures, reconnexion | Autoriser un utilisateur |
| `ui-ux-designer` | Parcours, états, accessibilité, handoff | Modifier la logique métier |
| `diagram-engineer` | Diagrammes ciblés et sources éditables | Présenter un choix POC comme déjà validé |
| `qa-reliability-engineer` | Revue indépendante et preuves | Corriger silencieusement le code évalué |

L'agent principal reste l'orchestrateur. Il n'est généralement pas utile de
créer un autre rôle « expert général » qui orchestre les mêmes spécialistes:
cela ajoute une couche et des tokens sans clarifier la responsabilité.

## 6. Utiliser un reviewer sans créer de faux problèmes

Un reviewer doit tenter de réfuter la correction. Il ne doit pas supposer que
les tests qui passent prouvent tout. Il vérifie notamment les chemins négatifs,
les doublons, l'expiration, la concurrence, le redémarrage et les permissions.

Chaque constat doit avoir:

- une sévérité;
- une preuve ou un chemin de code précis;
- un scénario reproductible quand c'est possible;
- le comportement attendu et le risque observé;
- le bon propriétaire pour la correction;
- un niveau de confiance si l'environnement empêche la reproduction.

« Aucun problème démontré » est une conclusion valide. Forcer un agent à
trouver absolument un défaut crée le biais inverse et produit du bruit.

## 7. Économie de contexte et de tokens

### À faire

1. Commencer une tâche avec son identifiant, son résultat attendu et ses critères.
2. Lire `README.md`, puis uniquement les sections normatives touchées.
3. Rechercher un titre ou un symbole avant d'ouvrir un gros document.
4. Utiliser le skill spécialisé au lieu de recopier ses règles dans la demande.
5. Déléguer seulement une enquête qui produit beaucoup de lectures ou de logs.
6. Demander au sous-agent un résumé avec preuves, pas son journal complet.
7. Lancer d'abord le test le plus proche du changement.
8. Changer de session entre deux grands sujets sans relation.
9. Conserver les décisions durables dans un ADR ou la documentation, pas dans la mémoire du chat.
10. Faire respecter mécaniquement les règles répétitives.

### À éviter

- « Lis tout le dépôt et améliore-le. »
- Charger les documents 02 à 14 pour une correction locale.
- Lancer neuf spécialistes sur une petite modification.
- Donner le même fichier à deux agents qui écrivent en parallèle.
- Faire relire indéfiniment un résultat sans nouvel indice.
- Coller une sortie de test énorme quand seules quelques erreurs sont utiles.
- Transformer `AGENTS.md` ou `CLAUDE.md` en manuel de framework.

Un sous-agent protège parfois le contexte principal, mais il consomme sa propre
entrée et sa propre sortie. Il peut économiser du contexte sans réduire le coût
total. Pour Aegis, deux ou trois sous-agents constituent une limite normale;
un seul agent reste préférable pour une tâche séquentielle.

## 8. Workflow recommandé pour une story

### Cadrage

1. Choisir une story P0 et confirmer son propriétaire humain.
2. Lire ses critères dans le document 11 et les contrats directement touchés.
3. Écrire les invariants, les fichiers probables et les preuves attendues.
4. Décider si un spécialiste est réellement nécessaire.

### Implémentation

1. Attribuer un seul propriétaire par fichier partagé ou migration.
2. Réaliser la plus petite tranche verticale démontrable.
3. Tester les cas nominal, refus, doublon, expiration et concurrence pertinents.
4. Mettre à jour le contrat normatif dans le même changement.

### Revue

1. Donner au reviewer les exigences, le diff et les résultats bruts.
2. Ne pas lui donner une longue défense de l'implémentation.
3. Corriger les constats prouvés avec le propriétaire approprié.
4. Relancer uniquement les vérifications affectées, puis la suite élargie.

### Handoff

Résumer le résultat, les fichiers, contrats, migrations, commandes exécutées,
résultats observés, limites, risques et prochain propriétaire.

## 9. Exemple de bonne demande

```text
Implémente RES-01 dans services/api.

Lis la story RES-01, les sections réservation de 02, 06, 08 et 09, puis
propose une courte tranche verticale. Préserve l'unicité d'une réservation
active au niveau PostgreSQL. Teste le cas READY, le refus BLOCKED et deux
créations concurrentes. Ne modifie pas MQTT. Ne commit pas.
```

Cette demande borne le résultat, les sources, les invariants, les scénarios et
les actions interdites. Elle ne dicte pas chaque ligne de code.

## 10. Commentaires dans le code

Un commentaire utile explique une raison invisible:

- invariant métier;
- contrainte de compatibilité;
- sécurité ou sûreté matérielle;
- choix de niveau d'isolation;
- comportement surprenant d'une API;
- compromis mesuré;
- contournement temporaire avec condition de retrait.

Un commentaire inutile répète l'instruction suivante. Le critère n'est pas
« un senior comprend-il la syntaxe? », mais « une personne peut-elle retrouver
la raison sans refaire toute l'enquête? ».

## 11. Responsabilité académique

Le plan de cours autorise l'IAG seulement selon les modalités précisées dans les
consignes de l'activité ou de l'évaluation. L'équipe doit donc:

- confirmer la permission applicable avant chaque remise;
- documenter l'assistance matérielle de l'IAG dans le journal de bord;
- conserver les décisions et vérifications humaines;
- citer l'outil selon les consignes du Cégep lorsque requis;
- être capable d'expliquer et de modifier chaque partie soumise;
- ne jamais présenter une sortie générée ou un POC non exécuté comme une preuve.

Le système agentique aide à apprendre et à vérifier. Il ne transfère pas la
responsabilité du travail, de la sécurité, de l'intégrité ou de l'évaluation.

## 12. Vérifier la configuration

Après une modification aux agents, skills ou instructions:

```bash
python3 .claude/skills/aegis-delivery/scripts/validate_agent_setup.py
```

Le script vérifie les formats JSON/TOML, l'identité des skills, les références
des rôles, l'exposition des skills à Codex et les liens Markdown locaux. Les
avertissements sur le cahier de conception nécessitent une décision humaine;
ils n'autorisent pas une restauration automatique de contenu.

## 13. Références officielles

- [Claude Code - bonnes pratiques](https://code.claude.com/docs/en/best-practices)
- [Claude Code - skills](https://code.claude.com/docs/en/skills)
- [Claude Code - sous-agents](https://code.claude.com/docs/en/sub-agents)
- [Codex - AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Codex - skills](https://learn.chatgpt.com/docs/build-skills)
- [Codex - sous-agents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
