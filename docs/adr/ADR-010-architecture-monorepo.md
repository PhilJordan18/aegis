# ADR-010 — Monorepo pour le développement d’Aegis

**Statut :** ACCEPTED  
**Date de consignation :** 17 septembre 2026  
**Décideurs :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Fondement :** organisation du dépôt déjà retenue et utilisée par l’équipe.  
**Périmètre :** sources, contrats, documentation et configuration de développement du projet.  

## Contexte

Le P0 associe Spring Boot, PostgreSQL, React, SwiftUI, firmware ESP32 et infrastructure MQTT. Une même évolution, comme le contrôle QR avant ouverture, peut modifier plusieurs de ces composants et leurs contrats.

Deux étudiants se partagent le projet : Philippe principalement au logiciel et Jimmy principalement au matériel. Ils utilisent des agents et skills Claude communs et travaillent sur des postes différents, avec accès à Xcode principalement sur les Macs de l’école.

Des dépôts séparés imposeraient la coordination de plusieurs historiques pour chaque changement transversal. L’équipe a choisi de conserver le produit dans un dépôt Git commun.

## Décision

**Maintenir un seul monorepo Git pour les composants du P0, les contrats et les documents de référence d’Aegis.** Chaque composant conserve son propre environnement de compilation, ses dépendances et ses tests.

| Emplacement | Contenu et responsabilité |
|---|---|
| `apps/admin-web/` | Administration React/TypeScript |
| `apps/ios/` | Application Swift/SwiftUI |
| `services/api/` | Backend Spring Boot, tests et migrations Flyway |
| `firmware/locker-controller/` | Firmware du hub et des cellules |
| `infra/docker/` | Environnement reproductible |
| `infra/mqtt/` | Configuration du broker et règles d’accès sans secrets réels |
| `docs/cahier-conception/` | Scope, modèles, contrats, story map et synthèses |
| `docs/adr/` | Fichiers de décisions architecturales détaillées |
| `docs/architecture/`, `docs/diagrams/`, `docs/research/` | Dessins, sources éditables et preuves de POC |
| `docs/journal/`, `docs/meetings/` | Travail effectué et comptes rendus |
| `.claude/agents/`, `.claude/skills/` | Définitions partagées des agents et procédures |
| `.github/` | Configuration des workflows de validation lorsqu’ils sont mis en place |
| `README.md`, `CLAUDE.md`, `CONTRIBUTING.md` | Entrée du projet, instructions et conventions communes |

La structure peut être précisée dans chaque composant sans transformer un répertoire en service supplémentaire. AI Vision reste hors P0, qu’un ancien répertoire `services/vision/` existe encore ou non.

## Ce que le monorepo garantit — et ne garantit pas

Un même commit peut porter une évolution cohérente des contrats, du backend, des clients et du firmware. Une PR permet d’en examiner les impacts ensemble. Les agents et skills versionnés sont disponibles à chacun après synchronisation du dépôt.

En revanche, le monorepo n’impose ni un build unique, ni un déploiement simultané, ni un gestionnaire de paquets commun aux différentes technologies. Une modification Git atomique ne rend pas automatiquement atomique le déploiement de l’API, de l’application iOS et du firmware.

Partager les fichiers Claude ne partage pas automatiquement les conversations, les sessions en cours ou l’état d’exécution des agents. Les décisions et résultats utiles doivent être consignés dans les fichiers, les issues ou les revues.

## Règles de collaboration

1. Chaque membre utilise son propre clone sur chaque poste de travail. Le dépôt complet constitue la base simple retenue pour ce prototype.
2. Les changements sont réalisés sur des branches courtes, avec revue de l’autre membre avant fusion selon les conventions du projet. Une branche partagée n’est pas réécrite sans coordination.
3. Une personne ou un agent possède l’édition d’un fichier donné à un instant donné, particulièrement pour les migrations, contrats et paramètres du firmware.
4. Chaque évolution transversale identifie les composants concernés et les incompatibilités éventuelles. Des changements compatibles et progressifs sont privilégiés lorsque les composants ne peuvent pas être livrés ensemble.
5. Les dépendances et versions d’outils sont documentées par composant. Le monorepo n’autorise pas des couplages directs entre les données internes des clients, du serveur et du firmware.
6. Les sources et petits éléments nécessaires à la reproduction sont versionnés. Les caches, dépendances téléchargées, sorties de build, secrets et réglages personnels ne le sont pas.
7. Les credentials de démonstration et de déploiement sont fournis hors dépôt. Les exemples de configuration restent sans secret réel; aucun code QR actif ou token d’accès n’est committé.

## Validation et accès aux Macs de l’école

Les contrôles sont adaptés au composant modifié : tests Spring et migrations, vérification TypeScript, tests Swift, compilation firmware et essais d’intégration concernés. Un filtre par dossier peut accélérer une validation, mais ne doit pas ignorer l’impact d’un changement de contrat partagé.

Le backend et le Web peuvent avancer hors cours. Les builds iOS, les tests caméra et les essais nécessitant Xcode sont planifiés sur les Macs disponibles à l’école. Chaque reprise utilise le dépôt synchronisé et une configuration locale documentée, sans dépendre de fichiers non sauvegardés sur le poste précédent.

Les commandes et workflows ne sont considérés opérationnels qu’après exécution réelle. Cet ADR ne prétend pas qu’une CI complète ou qu’un environnement de développement a déjà été installé.

## Alternatives considérées

| Option | Analyse |
|---|---|
| Monorepo commun | Retenu : cohérence des changements, visibilité et configuration partagée adaptées à deux membres |
| Un dépôt par plateforme | Écarté pour le P0 : coordination des contrats, versions et revues plus coûteuse |
| Un dépôt logiciel et un dépôt matériel/firmware | Écarté : les observations, commandes et preuves physiques restent fortement liées au domaine |

## Conséquences

Le monorepo facilite les tranches verticales et la traçabilité. Il réduit la dispersion documentaire et permet aux agents de consulter le contexte du produit.

Il expose aussi davantage de fichiers à chaque développeur et augmente le risque de conflits sur les contrats. Des revues disciplinées, une répartition claire et des validations ciblées restent nécessaires. Aucun orchestrateur de monorepo supplémentaire n’est imposé au P0 sans besoin concret démontré.

## Suivi du travail

Jimmy prend en charge la mise en place de Linear, conformément à la répartition confirmée par l’équipe. Linear suit les tâches, responsables, dépendances et cycles; GitHub conserve le code et son historique. Cette responsabilité opérationnelle ne donne pas à Jimmy seul l’autorité sur toutes les décisions architecturales.

Les issues sont reliées aux PR, aux contrats et aux ADRs concernés. Les statuts des tâches ne sont pas maintenus en double dans un second backlog GitHub. Le document de conception résume les décisions; les fichiers de `docs/adr/` en conservent le détail normatif.

## Critères de vérification et évolution

- Les deux membres peuvent reprendre la même version du produit depuis leurs clones et des instructions écrites.
- Les chemins des documents et des contrats sont cohérents et leurs références accessibles.
- Une évolution transversale possède une revue identifiant ses effets sur chaque composant.
- Les résultats de compilation et de test correspondent aux environnements réellement disponibles.
- Les fichiers personnels et les secrets restent hors de l’historique Git.

Une future séparation de dépôt exige un ADR indiquant les responsabilités devenues indépendantes, la stratégie de versionnement des contrats et la migration de l’historique utile.

- [Autorité métier du backend](ADR-001-backend-autorite-metier.md)
- [Scope](../cahier-conception/02-scope.md)
- [Story Map et backlog](../cahier-conception/11-user-story-map-p0.md)
- [Plan d’itérations](../cahier-conception/14-plan-iterations-semaines-4-a-15.md)
