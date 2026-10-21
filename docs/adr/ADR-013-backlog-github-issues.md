# ADR-013 — Backlog suivi dans GitHub Issues

**Statut :** PROPOSED — consigne une décision déjà prise par Philippe le 5 octobre 2026; à accepter pour cette consignation

**Date de la décision :** 5 octobre 2026

**Date de consignation :** 21 octobre 2026

**Remplace, une fois acceptée :** dans l’[ADR-010](ADR-010-architecture-monorepo.md), section « Suivi du travail », le premier paragraphe, qui confie à Jimmy la mise en place de Linear et y place le suivi des tâches. Le monorepo et le reste de l’ADR-010 demeurent acceptés. Le fichier de l’ADR-010 n’est pas modifié.

## Décision antérieure

L’ADR-010 prévoyait que Jimmy mette en place Linear pour suivre les tâches, les responsables, les dépendances et les cycles, GitHub ne conservant que le code et son historique.

## Raison du changement

Linear n’a pas été mis en place. Le 5 octobre 2026, Philippe a choisi de réunir le suivi des tâches, les branches, les revues et le code dans GitHub, au moment où l’équipe accélérait le logiciel pendant les achats et les montages de Jimmy.

## Décision

- Le backlog est suivi dans GitHub Issues et sur le tableau `Aegis P0`, en anglais.
- Chaque issue reprend l’identifiant stable du document 11 dans son titre et a un seul responsable. Chaque membre complète les issues dont il est responsable; Jimmy suit notamment celles du matériel et du firmware.
- Le travail se fait sur une branche par issue, intégrée à `dev` par une PR; `main` reçoit seulement `dev`, par une PR fusionnée par un humain (`CONTRIBUTING.md`).

## Conséquences

- Linear n’est pas utilisé. Il n’existe pas de second backlog.
- Le README et le document 11 désignent déjà GitHub Issues depuis le 5 octobre 2026.
- La révision datée du 5 octobre 2026, ajoutée à l’intérieur de l’ADR-010 avant la règle d’immuabilité des ADR acceptés, reste en l’état. Le présent ADR en est désormais la consignation de référence.
- Aucun contrat, aucune migration ni le périmètre du P0 ne changent.

## Vérification

- Issues et tableau `Aegis P0` en usage depuis le 5 octobre 2026 (issues #6 à #75 au 21 octobre 2026).
- Workflow décrit dans `CONTRIBUTING.md` et contrôlé par les règles des branches `dev` et `main`.
