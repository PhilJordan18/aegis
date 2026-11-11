# Console Manager : Vue d'ensemble, Réservations et prêts, Anomalies, Audit

**Statut : Proposition à valider par Philippe.** Aucune approbation n'est acquise.
Mode : Prototype. Date : 11 novembre 2026. Plateforme : Web (Aegis Manager). Issue : #158 (DES-02), mandat de nuit de Philippe (issue #67).
Ce prototype statique ne touche ni à `apps/admin-web/src`, ni aux contrats, ni à l'authentification. Un prototype statique n'est pas une implémentation et n'est pas prêt pour l'implémentation avant approbation.

## Ce qui est proposé

Les quatre sections de la barre latérale encore « à venir » (`manager-v3/README.md`) :

| Section | Composition (hypothèse H2 de `asset-lifecycle/sections.md`) | Issue |
|---|---|---|
| Vue d'ensemble | Modules prioritaires : anomalies, prêts en retard, casier, opération en cours, réservations actives. Aucun graphique, aucun total calculé sur une page. | DES-02 |
| Réservations et prêts | Onglets Réservations, Prêts, Opérations physiques; liste maîtresse et dossier; lecture seule | #48 |
| Anomalies | Liste et dossier; rappel permanent; « Reconnaître » avec note de 1 à 500 caractères; aucun « Résoudre » | #52 |
| Audit | Chronologie corrélée à curseur et détail à codes; historique non modifiable | #53 |

Identité : « Lumière du hub » v3 approuvée, jetons de `apps/admin-web/src/styles/tokens.css` copiés sans écart, composants (liste, dossier, puces, alertes, dialogue, champs) repris des feuilles de l'application. Rien n'est ajouté à P0.

## Ouvrir le prototype

Aucun serveur, aucun réseau, aucun CDN : ouvrir `prototype/index.html` dans un navigateur (liste de tous les écrans et états). Polices Geist et Geist Mono réutilisées par chemin relatif depuis `docs/design/manager-v3/prototype/fonts/`; symbole de marque depuis `docs/design/identite/assets/`.

| Page | Paramètres d'URL |
|---|---|
| `overview.html`, `reservations.html`, `anomalies.html`, `audit.html` | `lang` (`fr`, `en`), `theme` (`dark`, `light`, sinon le réglage du système), `state` (voir `states.md`), `notes=off` (masque les annotations de revue), `drawer=1` (tiroir ouvert sous 1024 px) |
| `reservations.html` | `tab` (`reservations`, `loans`, `operations`), `sel`, `status`, `asset`, `from`, `to`, `size`, `page` |
| `anomalies.html` | `sel`, `status` (`ALL` pour tout), `severity`, `type`, `dialog=1` (dialogue de reconnaissance ouvert), `note` |
| `audit.html` | `sel`, `from`, `to`, `eventType`, `subjectType`, `subjectId`, `operationId`, `actorUserId`, `limit`, `filters=1` |

Les données sont **fictives** (bandeau « Aperçu de revue » en tête de chaque page; casier, équipements et identifiants de démonstration, aucune personne réelle : le seul nom affiché est « Administrateur Démo », déjà utilisé dans le dépôt). Les formes suivent `09-contrats-rest.md`; deux hypothèses de forme sont signalées dans `prototype/js/fixtures.js` (G4, G5).
Les repères **G1 à G13** et les encadrés pointillés magenta marquent un manque de contrat; ce sont des annotations de revue, hors produit.

## Contenu du dossier

| Chemin | Rôle |
|---|---|
| `README.md` | Ce document : statut, ouverture, index, décisions demandées |
| `states.md` | Matrice des états par écran, avec déclencheur API et section du contrat |
| `handoff.md` | Pour l'ingénieur Web : composants, dispositions à 1440, 1024, 390 et 320 px, textes FR et EN, champ → contrat, manques de contrat (G1 à G13), accessibilité, recette |
| `prototype/` | Pages HTML, `css/` (feuilles de l'application copiées dans `css/app/`, `console.css`), `js/` (textes, fixtures, écrans) |
| `captures/` | 26 PNG à 1×, nommés `<écran>-<état>-<langue>-<apparence>-<taille>.png` |
| `verify/` | `captures.mjs` (rendus), `axe.mjs` (axe-core), `checks.mjs` (contrôles), sorties brutes `*-output.txt` |

Régénérer : depuis la racine du dépôt, après `npm ci` dans `apps/admin-web` (Playwright et axe de `apps/admin-web/node_modules`; Chromium préinstallé, ne pas lancer `playwright install`) :

```text
node docs/design/manager-console/verify/captures.mjs
node docs/design/manager-console/verify/axe.mjs
node docs/design/manager-console/verify/checks.mjs
```

## Index des écrans et états

| Écran | Page | États |
|---|---|---|
| Vue d'ensemble | `overview.html` | nominal, loading, all-clear, locker-offline, locker-unknown, partial, stale, unreachable, service-error, forbidden, unauthorized |
| Réservations et prêts | `reservations.html` | nominal, loading, empty, partial, stale, unreachable, service-error, forbidden, unauthorized, detail-404, join-failed (trois onglets) |
| Anomalies | `anomalies.html` | nominal, loading, empty, partial, stale, unreachable, service-error, forbidden, unauthorized, detail-404, join-failed, ack-resolved, ack-not-acknowledgeable, ack-validation, ack-unreachable |
| Audit | `audit.html` | nominal, loading, empty, partial, invalid-cursor, stale, unreachable, service-error, forbidden, unauthorized |

## Décisions demandées à Philippe

**A. Composition (hypothèse H2, `sections.md` §0, §5).**

1. Valider la liste maîtresse et le dossier pour Réservations et prêts, Anomalies et Audit, et les modules pour la Vue d'ensemble; ou demander une autre composition (ce prototype ne propose qu'une direction : l'identité v3 et les composants approuvés ne laissent pas de choix de fond distinct sur ces quatre écrans).
2. Valider les choix d'écart par rapport à `sections.md` (§ « Écarts » ci-dessous).

**B. Contrat (détail et recommandations dans `handoff.md` §7).** G1 nom du titulaire; G2 forme des preuves d'anomalie; G3 libellés d'équipement et de cellule; G4 acteur et détails de l'audit; G5 vocabulaires et ordre de l'audit; G6 enveloppe, tri et filtres des listes (C7); G7 opérations en cours; G8 lien réservation → prêt; G9 notes (unité, source de `resolutionNote`); G10 fuseau d'affichage; G11 `availableActions` sur les vues administrateur; G12 `summary` et `failureReason`; G13 signification d'un `404` sur une liste (traité ici comme erreur générique du service, jamais comme vide ni « pas encore disponible »).
Tant qu'elles ne sont pas tranchées, l'application affiche « identifiant seulement » ou l'absence de donnée; rien n'est inventé.

## Choix non tranchés (tous à valider par Philippe)

Ce prototype est une **proposition** : rien n'est approuvé. Choix du designer qui restent ouverts :

1. Composition H2 des quatre écrans (liste et dossier; modules; chronologie).
2. Casier en module pleine largeur sur la Vue d'ensemble, entre les prêts et les opérations.
3. Anomalies : filtre par défaut « Ouvertes »; reconnaissance par dialogue avec note obligatoire.
4. Audit : filtres repliés par défaut, puces des filtres actifs; ordre « plus récent d'abord » (hypothèse, G5).
5. Opérations physiques : dérivation de « Opération en cours » depuis `currentOperationId` (G7).
6. Mobile : liste puis dossier empilés (comme Équipements), plutôt qu'un dossier en page séparée.
7. Libellés : types d'anomalie, événements d'audit, « Commande acquittée par la cellule », textes FR et EN (`prototype/js/copy.js`), à valider avec le glossaire.
8. Contrat : G1 à G13 (`handoff.md` §7), dont G13 : un `404` de liste est traité comme erreur générique du service.

## Écarts par rapport à `sections.md`

| Sujet | `sections.md` | Ce prototype | Raison |
|---|---|---|---|
| Casier hors ligne | « hors ligne depuis 14 h 32 » (§5.1) | « hors ligne. Dernier signal : 14 h 11. » | Le contrat ne donne que `lastSeenAt`, pas l'instant du passage hors ligne (§8.6, §16.1) |
| Opération en cours | Lecture de `GET /admin/locker-operations` (§5.1) | Dérivée de `currentOperationId` des réservations et prêts actifs | `status` d'opération à valeur unique (§7.1, C7, G7) |
| Rangée d'anomalie | « résumé en français » (§5.5) | Libellé du type d'anomalie (catalogue du client); `summary` du serveur en citation dans le dossier | Langue et stabilité de `summary` non garanties (G12) |
| Anomalies : défaut | Non précisé | Filtre « Ouvertes » (« Toutes » si l'adresse porte `sel`) | Triage : ce qui demande une action d'abord |
| Audit : filtres | Filtres puis chronologie (§5.6) | Filtres dans une disclosure fermée, puces des filtres actifs visibles | Donner la hauteur à la chronologie à 1440 × 900 |
| Audit : détail | Détail à codes (§5.6) | Idem, avec « Preuves physiques » : absence dite explicitement | Aucune preuve ne doit être suggérée ni synthétisée (G4) |
| Prêts : opération liée | « opérations liées → anomalie liée » (§5.3) | Idem; le prêt lié à une réservation passe par l'opération | `ReservationView` n'a pas de `loanId` (G8) |
| Menu du compte | §5.7 | Bloc non interactif | Le menu du compte n'est pas redessiné par ce livrable |

## Preuves

Voir `verify/*-output.txt`.

- **axe-core** (`axe.mjs`, WCAG 2.0 à 2.2 A/AA et bonnes pratiques) : **218 pages analysées (109 sombres, 109 claires), 0 violation (0 nœud)**, et **88 règles « à vérifier » (incomplete)** que axe ne sait pas trancher : 60 `color-contrast` sur le fond du dossier (défilement à ombres, motif repris de l'application), 20 sur une flèche décorative `aria-hidden` de l'audit, 8 sur le texte du dialogue devant son fond. Ces 88 points restent à vérifier à la main; aucun n'est déclaré conforme. Matrice : chaque écran × chaque état × {FR sombre 1440, EN clair 1440, FR clair 390, EN sombre 390}, plus l'index, les onglets Prêts et Opérations, le dialogue (nominal et erreur de champ), les filtres de l'audit et le tiroir.
- **checks.mjs** : 12 contrôles passent (feuilles de l'application copiées sans écart, parité FR/EN de 445 clés, états déclarés, aucun défilement horizontal de 320 à 1440 px, aucune requête externe ni erreur sur les pages, aucun contrôle de garde, retard jamais « disponible », ordre de tabulation et contour de focus de 2 px, note de 1 à 500 graphèmes).
Limites : rendus inspectés dans Chromium seulement; pas de lecteur d'écran réel; pas de contraste mesuré sur une impression ou un écran à gamut étendu; la revue visuelle indépendante (`qa-reliability-engineer`) n'est pas faite. Verdict du designer sur ses propres rendus : **APPROVE pour revue par Philippe** (voir « Revue visuelle » ci-dessous); ce n'est ni une approbation humaine, ni une revue QA indépendante, et aucun rendu n'est déclaré prêt pour l'implémentation.

## Revue visuelle (protocole interne du designer)

Rendus inspectés à 1440 × 900, 390 et 320 px, en FR sombre et EN clair, nominal et états défavorables. Points relevés et corrigés pendant la passe : identifiants dupliqués dans les fixtures (hachage), tableau du casier illisible à 340 px (module pleine largeur, empilé sous 560 px), filtres trop hauts (barre sans cadre, une ligne), citations indentées par le style par défaut. Restent ouverts : onglets du mobile sur deux lignes, longueur de la page Vue d'ensemble à 390 px, lecture de la chronologie d'audit en dense (rangées de trois lignes). Aucun de ces points n'a été jugé bloquant.
