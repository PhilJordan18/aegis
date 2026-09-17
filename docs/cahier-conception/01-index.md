# Aegis — Index du cahier de conception

**Cours :** 420-5X7-SO — Écosystème connecté
**Session :** Automne 2026
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa
**Date de révision :** 17 septembre 2026

---

## 1. Rôle de l’index

Cet index oriente la lecture du cahier de conception. Il ne remplace pas les
documents normatifs et n’ajoute aucune exigence au P0.

Il faut lire uniquement les documents nécessaires à la décision ou à la tâche
en cours. Le [README du dépôt](../../README.md) présente d’abord le produit, la
démonstration de référence et l’organisation générale.

## 2. Ordre d’autorité

En cas de contradiction, appliquer l’ordre suivant :

1. [02 — Périmètre du projet](02-scope.md);
2. ADRs acceptés dans [`docs/adr/`](../adr/);
3. contrats et modèles approuvés des documents 03 à 10;
4. `README.md`;
5. tâche ou ticket courant;
6. hypothèses informelles.

Une entrée `PROPOSED` du document 13 ne devient pas une décision acceptée sans
validation explicite et, lorsque requis, sans ADR distinct.

## 3. Documents du cahier

| No | Document | Rôle principal | À consulter pour |
|---:|---|---|---|
| 02 | [Périmètre du projet](02-scope.md) | Engagements P0, P1, P2, limites et critères d’acceptation | Arbitrer le scope, les jalons et les exigences |
| 03 | [Dictionnaire de données métier](03-dictionnaire-de-donnees.md) | Vocabulaire, états, concepts et invariants | Nommer les données et éviter les synonymes métier |
| 04 | [Modèle de données logique](04-modele-de-donnees-logique.md) | Entités, relations et responsabilités | Concevoir les agrégats et leurs relations |
| 05 | [Machines à états métier](05-machines-a-etats.md) | Transitions de Reservation, Loan, LockerOperation et Anomaly | Implémenter ou tester un changement d’état |
| 06 | [Algorithmes et flux fonctionnels](06-algorithmes-et-flux-fonctionnels.md) | Décisions, transactions et parcours détaillés | Implémenter readiness, réservation, retrait, retour et récupération |
| 07 | [Diagrammes de flux de données](07-flux-de-donnees.md) | Producteurs, consommateurs, stockages et frontières de confiance | Tracer un échange de bout en bout |
| 08 | [Modèle physique PostgreSQL](08-modele-physique-postgresql.md) | Tables, contraintes, index, concurrence, outbox et Flyway | Modifier ou vérifier la persistance |
| 09 | [Contrats REST](09-contrats-rest.md) | Routes, DTO, erreurs, sécurité et idempotence HTTP | Modifier l’API ou un client Web/iOS |
| 10 | [Contrats MQTT](10-contrats-mqtt.md) | Topics, enveloppes, QoS, ACL, doublons et reconnexion | Modifier le backend IoT, le simulateur ou le firmware |
| 11 | [User Story Map et backlog P0](11-user-story-map-p0.md) | Stories, tranches verticales, dépendances et critères | Préparer et ordonner le travail |
| 12 | [Architecture physique](12-architecture-physique.md) | Hub, cellules, étoile, interfaces et essais matériels | Concevoir ou valider le prototype physique |
| 13 | [Registre des ADRs proposés](13-registre-adrs-proposes.md) | Statut des décisions et arbitrages ouverts | Vérifier ce qui est accepté, proposé ou à remplacer |
| 14 | [Plan d’itérations des semaines 4 à 15](14-plan-iterations-semaines-4-a-15.md) | Capacité, séquencement, limites de travail et alertes | Planifier les cycles et protéger l’échéance |

## 4. Documents complémentaires

- [`docs/adr/`](../adr/) : décisions d’architecture acceptées et leur justification;
- [`docs/diagrams/`](../diagrams/) : diagrammes visibles et sources éditables;
- [`docs/journal/`](../journal/) : preuves d’avancement, recherches et décisions datées;
- [`docs/meetings/`](../meetings/) : comptes rendus et décisions d’équipe;
- [`docs/research/`](../research/) : POC, mesures et recherches techniques;
- [Guide de travail avec les agents et les skills](../ai/agentic-workflow.md) : utilisation de Claude Code et Codex, responsabilités et économie de contexte.

## 5. Règle de mise à jour

Toute modification structurante doit mettre à jour, dans le même changement :

1. le document normatif concerné;
2. les contrats, états ou diagrammes touchés;
3. l’ADR requis;
4. les critères ou stories affectés;
5. cet index seulement si un document est ajouté, retiré ou renommé.
