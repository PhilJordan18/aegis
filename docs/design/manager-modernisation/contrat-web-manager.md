# Modernisation d'Aegis Manager — contrat de réalisation pour la session Web Manager

Mode : Conception. Date : 26 novembre 2026. Plateforme : Web (`apps/admin-web`).
Auteur : session Design (Claude, mandat de Philippe). Base inspectée : `dev` à `fe205ee`.
Statut : **chantiers approuvés par Philippe le 26 novembre 2026** (ordre : lisibilité, vue d'ensemble, dossiers et listes). Les décisions de présentation de ce document sont tranchées pour être exécutables; un écart demandé par la session Web passe par une question à Philippe, pas par une interprétation.

Ce document ne modifie ni le mandat iOS en cours, ni les contrats REST (`09-contrats-rest.md`), ni les invariants. Les dépendances réelles vers l'API sont listées au §5 et transmises à la session Backend; en leur absence, chaque lot livre son repli, défini ici.

## 0. Cadre commun aux trois lots

### 0.1 Ce qui ne change pas

- Identité « Lumière du hub » v3 (`docs/design/identite/reference.md`, `src/styles/tokens.css`) : aucun jeton ajouté sans décision, surfaces opaques, pas de verre ni de dégradé, anneau de focus plein de 2 px décalé de 2 px, thèmes clair et sombre, couleurs forcées.
- Composants existants réutilisés tels quels : `ManagerShell`, `PageHeading`, `StatusChip` (rôles `ready`, `blocked`, `unknown`, `progress`, `anomaly`, `info`, `neutral`), `Alert`, `Dialog`, `FormField`, `Button`, `StaleNotice`, `ReadOnlyMark`, `Timeline`, `AnomalyAlert`, `AcknowledgeDialog`, les dialogues approuvés de `manager-forms/`.
- Invariants affichés : un prêt en retard reste « Actif · En retard » et jamais disponible; une réservation n'ouvre aucune porte; une opération n'est confirmée que par l'observation du casier; « Reconnaître » une anomalie ne la résout jamais; le client ne calcule ni readiness, ni retard (`overdue` vient du serveur), ni total à partir d'une page.
- Aucune nouvelle action d'écriture. Les seules écritures du Manager restent : créer, modifier, archiver un modèle ou un exemplaire; placement; attribution et révocation d'identifiant; horaire; `POST /admin/anomalies/{id}/acknowledge`.
- Adresses : les paramètres d'URL existants (`exemplaire`, `vue`, `dossier`, `equipement`, `casier`, `anomalie`, `statut`, `gravite`, `type`, `page`, `evenement`, `du`, `au`, `sujetType`, `sujet`, `operation`) restent la source de vérité et restent compatibles avec les liens existants.
- FR et EN complets, parité des clés, glossaire `docs/localisation/glossaire.md`.
- Accessibilité : axe WCAG 2.x A/AA sur la matrice existante, cibles ≥ 44 px (32 px pour les boutons `sm` déjà approuvés), aucun défilement horizontal de 320 à 1440 px, mouvement réduit, lecteur d'écran (régions, `role="status"`, focus après navigation).

### 0.2 Vocabulaire des lectures (obligatoire dans les trois lots)

Chaque donnée affichée appartient à une **lecture** identifiée (une requête, son instant de succès). Les lots emploient ces quatre états, avec ces mots :

| État | Définition | Rendu |
|---|---|---|
| À jour | La dernière lecture a réussi | Valeur, et « lu à HH h MM » (instant de la dernière lecture réussie) |
| Partielle | La lecture a réussi mais ne couvre pas toute la collection (page tronquée, un statut sur plusieurs en échec) | « Au moins N » ou « N+ », et la mention « Lecture incomplète » accessible |
| Périmée | Une lecture a réussi auparavant, la dernière a échoué | Dernière valeur conservée, `StaleNotice` ou son équivalent compact, instant de la dernière réussite |
| En erreur | Aucune lecture n'a jamais réussi | Alerte de la famille `catalogFailure` avec « Réessayer » et identifiant de suivi; **jamais un zéro, jamais une liste vide** |

Plusieurs lectures ne forment jamais un instantané : quand une page combine des lectures, elle affiche l'instant de la plus ancienne réussie (`oldestRead`, déjà dans `overviewModel.ts`) et la mention « lectures distinctes » une seule fois, dans l'aide de la page (§1.4), pas dans chaque module.

### 0.3 Largeurs et ruptures

| Nom | Largeur | Coque | Contenu |
|---|---|---|---|
| Large | ≥ 1280 px | Barre latérale 280 px | Deux colonnes possibles (liste ou tableau + dossier) |
| Bureau | 1024 à 1279 px | Barre latérale 280 px | Une colonne : liste puis dossier empilés, sauf Équipements qui garde ses deux colonnes approuvées |
| Compact | 560 à 1023 px | Barre supérieure et tiroir | Une colonne |
| Étroit | < 560 px | Barre supérieure et tiroir | Une colonne; tableaux en blocs étiquetés (motif `.ag-ov__cells` existant) |

Les rendus de référence sont vérifiés à 1440 × 900, 1024 × 768, 390 × 844 et 320 × 720, dans les deux thèmes.

### 0.4 Livraison

- Un lot = une issue GitHub = une branche `<issue>-feat-<slug>` depuis `dev` = une pull request vers `dev`, après le delivery gate du skill `aegis-delivery`. Issues créées le 26 novembre 2026 : lot 1 [#239](https://github.com/PhilJordan18/aegis/issues/239) (`239-feat-manager-readability`), lot 2 [#240](https://github.com/PhilJordan18/aegis/issues/240) (`240-feat-manager-overview-band`), lot 3 [#241](https://github.com/PhilJordan18/aegis/issues/241) (`241-feat-manager-records-lists`); ce contrat est livré par [#242](https://github.com/PhilJordan18/aegis/issues/242).
- Chaque lot est vérifiable seul : ses critères d'acceptation (§1.8, §2.6, §3.8) ne dépendent pas du lot suivant.
- Preuves attendues par lot : `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:a11y`, les projets Playwright touchés (`forms`, `links`, `follow`), les nouveaux spécifications Playwright du lot, et un lot de captures (`npm run capture`, ou un projet `capture:modernisation` à créer sur le modèle de `capture:forms`) écrit dans `docs/design/manager-modernisation/captures/lot-N/` pour la revue visuelle indépendante par `qa-reliability-engineer`. Les captures de l'état initial sont dans `captures/etat-initial/`.

## 1. Lot 1 — Lisibilité

Issue : #239. Écrans : tous (coque, Vue d'ensemble, Équipements, Réservations et prêts, Casiers, Anomalies, Audit).
Objectif : l'administrateur lit des codes et des noms, jamais un UUID, sauf dans un bloc technique qu'il ouvre lui-même; il filtre par équipement sans connaître d'identifiant; les textes disent l'état et l'action, pas les limites de l'implémentation.

### 1.1 Index de libellés (`LabelIndex`)

Un module unique `features/labels/` fournit à toutes les pages la résolution d'un identifiant vers un libellé, à partir de lectures **déjà faites ou bornées**, jamais d'une requête par ligne.

| Identifiant | Libellé | Source | Repli |
|---|---|---|---|
| `compartmentId` | Code de cellule (« A2 ») et code du casier | `GET /admin/lockers?page=0&size=100` (`AdminLockerPage`, déjà lu par la Vue d'ensemble et le placement) | Identifiant abrégé |
| `lockerId` | Code du casier (« AEGIS-DEMO-01 ») | Même lecture | Identifiant abrégé |
| `assetId` | « Nom du modèle · CODE » | 1) `AssetSummary` quand la vue le porte (réservations, prêts, opérations); 2) sinon `GET /admin/assets?size=100&sort=assetCode,asc`, pages 0 à 4 au plus (500 exemplaires), lues une fois par session et à l'actualisation; 3) sinon le `currentAsset` des cellules de `/admin/lockers` **uniquement pour le code**, jamais pour en déduire l'emplacement | Identifiant abrégé |
| `userId`, `holderUserId`, `actor.id` | `displayName` fourni par la vue (`user`, `holder`, `actor`) | La vue elle-même | « Titulaire non nommé » (la liste des comptes n'existe pas, §5 B4) |
| `reservationId`, `loanId`, `lockerOperationId`, `anomalyId`, `subjectId` d'audit | Type en clair + lien vers le dossier (« Opération · ouvrir ») | Aucune jointure | Type + identifiant abrégé |

Règles :

- **Interdit** : déduire l'équipement d'une anomalie, d'une opération ou d'un événement d'audit à partir de l'équipement **actuellement** placé dans sa cellule. Le code d'un exemplaire vient de son `assetId`; le code d'une cellule vient de son `compartmentId`. Un placement actuel n'est jamais présenté comme le placement au moment du fait. Quand la page montre les deux (dossier d'opération : cellule de l'opération et placement actuel de l'exemplaire), elle les étiquette distinctement : « Cellule de l'opération » et « Placement actuel ».
- Exemplaire **archivé** (`archivedAt` non nul dans l'index) : libellé suivi de la puce `neutral` « Archivé », lien vers le dossier conservé (lisible par identifiant, `09` §12.2).
- Index **non chargé** (lecture en cours) : identifiant abrégé avec squelette de 8 caractères; aucun libellé n'apparaît avant la fin de la lecture; aucun décalage de mise en page quand le libellé arrive (largeur réservée).
- Index **en erreur** : la page affiche les identifiants abrégés et une note compacte « Libellés non chargés · Réessayer » (`StaleNotice` en variante compacte), sans bloquer la page.
- Index **tronqué** (`totalItems` > 500 exemplaires) : les exemplaires au-delà restent en identifiant; la note « Libellés partiels » apparaît dans l'aide de la page. Cette limite est une dépendance Backend (§5 B1).
- Fraîcheur : l'index est invalidé par toute mutation du catalogue, du placement et de l'horaire (clés `queryKeys.catalog.all`, `queryKeys.custody.all`), et relu par « Actualiser ».

### 1.2 Règle « libellé d'abord, identifiant replié »

| Écran | Avant (état initial) | Après |
|---|---|---|
| Anomalies, liste | « Cellule 6c0d7d3e… · Équipement aaaaaaaa… » | « Cellule A2 · Multimètre numérique · MM-002 » |
| Anomalies, dossier | UUID de cellule et d'équipement en premier | Codes en premier; les deux UUID dans « Détails techniques » |
| Anomalies, dialogue Reconnaître | UUID abrégés dans le sous-titre | Codes; aucun UUID dans le dialogue |
| Réservations, prêts, opérations, listes | « Titulaire : Marie Tremblay 0b1c2d3e… » | « Marie Tremblay » seul; identifiant dans le dossier, bloc technique |
| Opérations, dossier | Cellule en identifiant | « Cellule A1 · AEGIS-DEMO-01 » (index), « Placement actuel » séparé |
| Audit, liste | « Opération eeeeeeee… » | « Opération · MM-001 » quand l'index résout l'exemplaire de l'opération (via `asset` de l'opération si elle est déjà en cache, sinon type + identifiant abrégé) |
| Audit, détail | Trois UUID de 36 caractères en colonne « Faits » | Acteur, sujet (type + libellé), opération (libellé) en clair; tous les identifiants dans « Détails techniques » |
| Vue d'ensemble | « Équipement aaaaaaaa… » quand l'exemplaire n'est pas placé | Libellé par l'index |
| Casiers, table des cellules | Pas d'équipement attendu | Colonne « Équipement attendu » (code du `currentAsset` de `/admin/lockers`), comme la Vue d'ensemble |

**Bloc « Détails techniques »** (composant `TechnicalDetails`, nouveau, présentation seule) : un `<details>` natif replié par défaut, placé en dernière section de tout dossier et de tout détail d'audit, titre « Détails techniques », contenant une liste de définitions : chaque identifiant complet en `Geist Mono`, `user-select: all`, avec un bouton « Copier » (`navigator.clipboard`, confirmation `role="status"` « Identifiant copié », repli : la valeur reste sélectionnable si l'API presse-papiers échoue). Le bloc contient aussi l'identifiant de suivi des erreurs quand il existe. Il est accessible au clavier (`<summary>` focalisable) et ouvert par un paramètre `?technique=1` pour les liens de support.

**Identifiant abrégé** (`IdText`, nouveau) : 8 premiers caractères suivis de « … », `title` absent (pas d'info-bulle au survol seul), `aria-label` = identifiant complet, jamais seul dans une rangée quand un libellé existe.

### 1.3 Sélecteur d'équipement

Remplace le champ « Équipement (identifiant) » des Réservations et prêts (trois onglets) et sert de base au futur filtre d'anomalies par exemplaire (`assetId` existe dans `09` §18.1; le filtre est ajouté dans ce lot sur Anomalies aussi).

- Composant `AssetPicker` : un champ texte combiné à une liste (`role="combobox"` + `role="listbox"`, motif ARIA 1.2 « combobox avec liste », navigation flèches, Échap, Entrée, lecture d'écran annonçant le nombre de résultats).
- Source : `GET /admin/assets?q=<texte>&size=20&sort=assetCode,asc` (`q` cherche code et nom de modèle, `09` §12.2). Le catalogue paginé n'est jamais chargé en entier pour chercher : la recherche est **serveur**, 20 résultats, et « Affiner la recherche » quand `totalItems` > 20.
- Temporisation : 300 ms après la dernière frappe, 2 caractères minimum (en dessous : « Tapez au moins 2 caractères »), requête précédente annulée (`AbortSignal`), résultats mémorisés 60 s par texte.
- Valeur : l'exemplaire choisi (`{ id, label }`); l'adresse reste `?equipement=<uuid>` (compatibilité des liens). À l'ouverture d'une adresse portant un UUID inconnu de l'index, le champ affiche l'identifiant abrégé et la puce « Identifiant seulement ».
- Suppression : bouton « Retirer » dans la puce de filtre actif (§3.4), focus rendu au champ.
- Un exemplaire archivé est proposé avec sa puce « Archivé » : son historique reste consultable.
- États : chargement (indicateur dans la liste, texte « Recherche… »), aucun résultat (« Aucun exemplaire pour « xx » »), erreur (« Recherche indisponible · Réessayer », le champ reste utilisable), réseau coupé pendant la frappe (même erreur, pas de perte du texte saisi).

### 1.4 Textes de prudence et aide

Principe : **une page, un rappel**, placé près de l'action ou de la donnée qu'il protège; le reste va dans l'aide de page.

| Texte | Décision |
|---|---|
| « Lecture seule : aucune fin de prêt, confirmation, retour forcé ni ouverture à distance » (sous-titre Réservations) | Conservé une fois, sous le titre; retiré du dossier (le `ReadOnlyMark` « lecture seule » sous chaque titre de dossier est retiré sur ces pages) |
| `ReadOnlyMark` sur « Faits dérivés » (Équipements) | Conservé : il distingue le dérivé du modifiable, ce qui guide l'action |
| « Chaque statut est lu par une requête distincte… » (Vue d'ensemble, deux modules) | Retiré des modules; une seule phrase dans l'aide de page : « Les compteurs viennent de lectures distinctes, à l'instant indiqué sous chacun. » |
| « Cette lecture n'autorise aucune ouverture » (Casiers, Vue d'ensemble) | Conservé une fois par écran, sous le statut du casier |
| « Une réservation n'ouvre aucune porte… » (encadré bleu du dossier de réservation) | Conservé, encadré `Callout` information, car il protège une décision |
| « Ce prêt est en retard et l'équipement reste emprunté… » | Conservé, encadré `anomaly`/`unknown` selon le rôle actuel |
| Rappel permanent des anomalies (« Une anomalie se résout seulement lorsque… ») | Conservé sur la page Anomalies; retiré du dialogue Reconnaître, qui garde seulement « Reconnaître documente la prise de connaissance; cela ne résout pas l'anomalie » et la mention de conservation de la note |
| « Évalué par le serveur à … », « lu à … », « Heures du laboratoire : America/Toronto » répétés par panneau | Une seule ligne de pied de page par écran : « Lu à HH h MM HNE · heures du laboratoire » (l'instant de la plus ancienne lecture réussie); la zone de fuseau est rappelée dans chaque champ date (§3.4) |
| Sous-titres de page (« Comprendre un écart physique… », « Reconstituer qui a fait quoi… ») | Conservés : une phrase, verbe à l'infinitif |

**Aide de page** : un bouton `secondary sm` « Aide » à droite du titre, icône `info`, ouvrant un `<details>`/panneau en dessous du titre (pas une info-bulle au survol) : les caveats déplacés, le fuseau, le sens des puces. Accessible au clavier et au toucher, fermé par défaut, état mémorisé par page dans `sessionStorage` (préférence d'interface, autorisée par la politique de stockage existante).

### 1.5 Contrôle « Actualiser » harmonisé

Composant `RefreshControl` (nouveau, présentation seule), utilisé par la Vue d'ensemble, Réservations et prêts, Casiers, Anomalies, Audit, Équipements :

- Bouton `secondary md` avec icône `refresh` et libellé « Actualiser », identique partout (l'écran Anomalies le perd aujourd'hui sans icône).
- Pendant la lecture : `busy`, libellé « Actualisation… », `aria-disabled`, focus conservé, indicateur statique en mouvement réduit.
- Résultat : `role="status"` annonce « Données actualisées à HH h MM » ou « Actualisation échouée · données du HH h MM conservées »; l'instant affiché à côté du bouton est **toujours celui de la dernière lecture réussie**; après un échec il ne change pas et prend la puce `unknown` « Non actualisé ».
- Jamais d'état « à jour » après un échec : le libellé « Mis à jour à … » est remplacé par « Lu à … », et l'échec ajoute « Non actualisé depuis … ».
- Un double clic ne lance qu'une lecture (garde `refreshing` existante).

### 1.6 Badges de navigation

Deux badges dans la barre latérale et le tiroir, à droite de l'entrée :

| Entrée | Définition | Source | Fraîcheur | Partiel | Erreur |
|---|---|---|---|---|---|
| Anomalies | Anomalies **ouvertes** (`status=OPEN`), `totalItems` du serveur | `GET /admin/anomalies?status=OPEN&page=0&size=1` (clé partagée avec la Vue d'ensemble, `OPEN_ANOMALIES_QUERY`, même cache : une lecture pour les deux) | Au montage de la coque, puis toutes les 60 s quand l'onglet est visible, et à chaque « Actualiser » | Sans objet (`totalItems`) | Badge remplacé par un point `unknown` avec `aria-label` « Nombre d'anomalies indisponible » |
| Réservations et prêts | Prêts **en retard** observés (`overdue` serveur) parmi les prêts `ACTIVE` et `RETURN_PENDING` | Les deux lectures `useOpenLoanReads` (size 100), même cache que la Vue d'ensemble | Idem | « N+ » quand une des deux lectures échoue ou qu'une page est tronquée (`complete` faux), `aria-label` « Au moins N prêts en retard, lecture incomplète » | Point `unknown` si les deux lectures échouent |

Le badge vaut 0 → rien n'est affiché. Le badge est `aria-hidden` et son information est reprise dans le libellé accessible de l'entrée (« Anomalies, 2 ouvertes »). Rôle visuel : fond `--ag-anomaly-bg`, texte `--ag-anomaly-fg` pour les anomalies; `--ag-unknown-*` pour les retards; 20 px de haut, chiffres tabulaires. Jamais un badge d'erreur rouge pour un compteur indisponible : l'indisponibilité n'est pas une anomalie.

### 1.7 Corrections mineures incluses

- Chronologie d'une réservation : le marqueur losange (échéance) n'est utilisé que pour une échéance **dépassée ou expirée**; une réservation active affiche un marqueur creux pour « Réservée jusqu'à ».
- Champs date : `lang` sur le champ suit l'interface; la zone d'aide indique le format attendu quand le navigateur ne le suit pas (vérifier le rendu Chromium et Safari en `fr-CA` et `en-CA`).
- Casiers : colonne « Équipement attendu » (§1.2).
- Boutons d'action « Actualiser » et « Nouvel exemplaire » : même hauteur et même alignement sur toutes les pages (ligne d'en-tête commune, `ag-page__actions`).

### 1.8 États, responsive, acceptation, QA

États par composant : index (§1.1), sélecteur (§1.3), badges (§1.6), actualisation (§1.5). Les états de page existants (`states.md` des handoffs précédents) ne changent pas.

Responsive : les badges restent visibles dans le tiroir compact; le sélecteur d'équipement prend toute la largeur sous 560 px et sa liste s'affiche sous le champ (jamais en superposition hors écran); le bloc « Détails techniques » laisse les UUID se couper (`overflow-wrap: anywhere`).

Critères d'acceptation :

1. Aucune page n'affiche un UUID hors d'un bloc « Détails techniques » replié, sauf le repli explicite « Identifiant seulement » quand l'index ne connaît pas l'identifiant.
2. Sur une page d'anomalies de 20 lignes, le nombre de requêtes vers `/admin/assets` et `/admin/lockers` est borné et indépendant du nombre de lignes (au plus 5 pages d'exemplaires et 1 de casiers), vérifié par un test Playwright sur faux routés qui compte les requêtes.
3. L'équipement d'une anomalie dont la cellule contient aujourd'hui un autre exemplaire est affiché avec **son** code, pas celui de l'occupant actuel (test avec fixture contradictoire).
4. Le filtre équipement se fait par code ou nom; l'adresse produite reste `?equipement=<uuid>`; une adresse ancienne reste lisible.
5. Après un échec d'actualisation, l'instant affiché est celui de la dernière réussite, et un état « Non actualisé » est visible et annoncé.
6. Le badge Anomalies vaut `totalItems`; le badge Prêts affiche « N+ » quand une lecture manque; aucun badge n'affiche 0 ni ne masque une erreur en zéro.
7. L'aide de page et le bloc technique s'ouvrent au clavier et au toucher; axe A/AA sans violation sur la matrice.
8. Parité FR/EN des nouvelles clés; aucun texte français hors aperçu en EN.

Vérifications QA (indépendantes) : captures 1440/1024/390/320, clair et sombre, des six pages à l'état nominal, partiel, périmé et en erreur; revue du contraste des badges sur les deux fonds; parcours lecteur d'écran (NVDA ou VoiceOver) sur Anomalies : liste → dossier → Détails techniques → Copier; comptage des requêtes réseau sur Anomalies et Audit.

## 2. Lot 2 — Vue d'ensemble

Issue : #240. Écran : `/vue-d-ensemble`. Objectif : en une lecture, savoir s'il y a quelque chose à faire, quoi, et y aller en un clic; agir sur une anomalie sans quitter la page.

### 2.1 Bande de synthèse

Cinq tuiles en tête de page, sous le titre, au-dessus des modules existants. Chaque tuile est un lien (`<a>`) vers la page filtrée; aucune tuile n'est un simple chiffre décoratif.

| Tuile | Valeur | Définition et source | Lien | Partiel | Erreur |
|---|---|---|---|---|---|
| Anomalies ouvertes | `totalItems` | `GET /admin/anomalies?status=OPEN` (lecture existante) | `/anomalies` (défaut « Ouvertes ») | Sans objet | « — » et « Indisponible », puce `unknown` |
| Prêts en retard | Nombre d'`overdue` observés | `useOpenLoanReads` (existant) | `/reservations-prets?vue=prets&statut=ACTIVE` (paramètre existant; le filtre « en retard » n'existe pas côté serveur, §5 B3; la liste met les retards en tête de la page chargée, §3.3) | « N+ » et « Lecture incomplète » | Idem |
| Casier | État : « En ligne », « Hors ligne », « Inconnu » et « Ouvert jusqu'à HH h » ou « Fermé · ouvre à … » | `GET /lockers/{id}/status` (existant), un casier en P0; plusieurs casiers → une tuile par casier, puis « +N » vers Casiers | `/casiers` | Sans objet | « État indisponible », puce `unknown` |
| Opérations en cours | Nombre d'opérations distinctes non terminales | `useInProgressOperationReads` (existant, 7 lectures) | `/reservations-prets?vue=operations` | « N+ » quand un statut manque | Idem |
| Réservations actives | `totalItems` | `GET /admin/reservations?status=ACTIVE` (existant) | `/reservations-prets?statut=ACTIVE` (paramètre existant) | Sans objet | Idem |

Rendu : tuile `ag-panel` de 120 px de haut minimum; surligné 12 px (« ANOMALIES OUVERTES »), valeur en `title-xl` (32 px) chiffres tabulaires, ligne de détail 14 px (« 1 élevée · 1 moyenne » pour les anomalies, « depuis 25 nov. » pour le retard le plus ancien, « fermeture 17 h 00 » pour le casier), instant « lu à HH h MM » en 12 px. Couleur : la **valeur** reste en `--ag-text`; seule une puce de 8 px et le surligné portent le rôle (`anomaly` si > 0 anomalies, `unknown` si > 0 retards, `ready`/`blocked`/`unknown` pour le casier, `progress` pour les opérations, `info` pour les réservations). À zéro, la tuile est neutre avec « Aucune ». Jamais la couleur seule.

Fraîcheur : chaque tuile porte son propre instant (lectures distinctes); la page ne prétend pas à un instantané. « Actualiser » (§1.5) relance tout.

### 2.2 État « rien à signaler »

Quand anomalies = 0, retards = 0, et que les deux lectures sont à jour et complètes : une ligne sous la bande, puce `ready`, « Aucune intervention en attente · lu à HH h MM ». Cette ligne n'apparaît jamais en lecture partielle ou en erreur : dans ces cas la bande montre « N+ » ou « Indisponible » et la ligne est remplacée par « Lecture incomplète : l'absence d'intervention n'est pas confirmée ».

### 2.3 Modules et accès directs

Les modules existants (Anomalies, Prêts en retard, Casier, Opération en cours, Réservations actives) sont conservés dans leur ordre et leurs règles (`ROW_LIMIT` 5, `WIDE_PAGE_SIZE` 100, `oldestRead`). Changements :

- Chaque rangée est un lien vers le dossier (existant) **et** porte, pour les anomalies ouvertes, un bouton `secondary sm` « Reconnaître » à droite, qui ouvre l'`AcknowledgeDialog` existant en place (même composant, même `Idempotency-Key` générée à l'ouverture, mêmes `409`, même focus). Après succès, les lectures `anomalies.all` et la tuile sont invalidées; l'anomalie reconnue quitte le module, et un `role="status"` l'annonce (« Anomalie reconnue; elle reste ouverte jusqu'à une nouvelle observation »).
- Les prêts en retard affichent « Ouvrir le prêt »; aucune autre action (aucune fin de prêt).
- Le module Casier gagne le bouton « Modifier l'horaire » (dialogue existant `ScheduleDialog`) uniquement quand `currentWindow.timeZone` est nul ou que la fenêtre est fermée : c'est le seul cas où une action administrateur est attendue; sinon, le lien « Voir les casiers » suffit.
- Les notes « Chaque statut est lu par une requête distincte… » sont retirées des modules (§1.4).
- Le pied de module « Voir les … » devient un lien avec le compteur : « Voir les 2 anomalies ».

### 2.4 Disposition

| Largeur | Bande | Modules |
|---|---|---|
| ≥ 1280 | 5 tuiles sur une ligne | Comme aujourd'hui (7/12 + 5/12, casier pleine largeur, 6/12 + 6/12) |
| 1024–1279 | 3 + 2 | Pleine largeur chacun |
| 560–1023 | 2 + 2 + 1 | Pleine largeur |
| < 560 | 2 colonnes, dernière tuile pleine largeur | Pleine largeur; la table du casier en blocs étiquetés (existant) |

La bande n'est pas collante : la page reste une page qui défile; la barre latérale reste collante.

### 2.5 États

| État | Rendu |
|---|---|
| Chargement initial | Cinq tuiles squelettes (barre de valeur), modules squelettes existants; aucun chiffre tant qu'une lecture n'a pas réussi |
| Partiel | Tuile « N+ », mention accessible; module avec « Au moins N » (existant) |
| Périmé | Valeur conservée, instant de la dernière réussite, puce `unknown` « Non actualisé » sur la tuile, `StaleNotice` compact une seule fois sous la bande |
| En erreur | Tuile « — Indisponible » avec « Réessayer » dans le module correspondant; **jamais 0** |
| 401 / 403 | Comportement existant de `RequireAdminSession` et des alertes |
| Casier hors ligne | Tuile `blocked` « Hors ligne · dernier signal HH h MM »; la ligne « rien à signaler » ne s'affiche pas |

### 2.6 Acceptation et QA

1. Les cinq tuiles existent, chacune liée à sa page filtrée; l'adresse d'arrivée porte le filtre attendu (test Playwright par tuile).
2. « Reconnaître » depuis la Vue d'ensemble enregistre une reconnaissance avec une `Idempotency-Key` stable pour un même dialogue (test sur faux routé : deux clics, une requête), ne retire jamais le rappel « ne résout pas », et met à jour la tuile et le badge sans rechargement.
3. En erreur de lecture, aucune tuile n'affiche 0 et la ligne « Aucune intervention » est absente (fixture `serviceError` par lecture, une à une).
4. En lecture partielle (fixture `totalItems` 150 pour les prêts), la tuile affiche « N+ » et la mention accessible.
5. Instants : chaque tuile affiche l'instant de sa propre lecture; après un échec d'actualisation, aucun instant n'avance.
6. 1440/1024/390/320 sans défilement horizontal; axe sans violation; ordre de tabulation : titre, Aide, Actualiser, tuiles, modules.

QA : captures des états nominal, rien à signaler, partiel, périmé, erreur et casier hors ligne, dans les deux thèmes; revue de contraste des tuiles; parcours clavier complet « tuile → page filtrée → retour »; lecteur d'écran sur la reconnaissance en place.

## 3. Lot 3 — Dossiers et listes

Issue : #241. Écrans : Équipements, Réservations et prêts (trois onglets), Anomalies, Audit, Casiers. Objectif : les actions se trouvent en tête, les données tabulaires se lisent en tableau, les filtres s'appliquent sans bouton, et un dossier se lit de haut en bas sans chercher l'important.

### 3.1 Zone d'actions en tête de dossier

Chaque dossier commence par : surligné (« EXEMPLAIRE SÉLECTIONNÉ »), titre, sous-titre (référence), puis **une ligne d'actions** (`role="group"`, `aria-label` « Actions sur … »), puis le **bloc d'état** (§3.2). Les actions sont exactement les capacités existantes, dans cet ordre :

| Dossier | Primaire | Secondaires | Destructive (ghost, en dernier) |
|---|---|---|---|
| Exemplaire | Modifier | Modifier le placement · Attribuer un identifiant | Archiver |
| Modèle (rangée) | Modifier | — | Archiver |
| Anomalie ouverte | Reconnaître | Ouvrir l'opération · Audit de cette opération | — |
| Anomalie reconnue ou résolue | — (aucune action : « Reconnue le … par … » dans le bloc d'état) | Ouvrir l'opération · Audit | — |
| Casier | Modifier l'horaire | Voir les opérations de ce casier | — |
| Réservation, prêt, opération | — (lecture seule) | Liens croisés existants (prêts de cet équipement, audit, anomalie liée) | — |

Les dialogues, confirmations (`alertdialog` d'archivage et de révocation, focus initial sur « Annuler »), clés d'idempotence et gardes de double soumission restent ceux des formulaires approuvés. Les actions quittent le bas du dossier (sections « Placement attendu » et « Identifiants physiques » gardent leur contenu, mais leurs boutons remontent dans la ligne d'actions).

### 3.2 Bloc d'état en tête de dossier

Un encadré unique (`Callout`, nouveau, présentation seule : rôles `neutral`, `info`, `unknown`, `anomaly`, `blocked`, `ready`) qui résume l'état en une ligne de puces et une phrase :

| Dossier | Puces | Phrase |
|---|---|---|
| Exemplaire | Diagnostic (« Aucun empêchement » / « N empêchements »), disponibilité | Première raison en clair, « + N autres » (règle `sections.md` §1.3) |
| Réservation | Statut | Rappel « n'ouvre aucune porte » (une fois ici, retiré d'ailleurs) |
| Prêt | Statut, « En retard » | Retard : phrase existante; sinon « Retour prévu le … » |
| Opération | Statut | Phrase existante (« Un accusé de commande ne prouve ni… ») |
| Anomalie | Gravité, statut | « Non reconnue » / « Reconnue le … par … » / « Résolue le … » |
| Casier | Connexion, fenêtre | « Dernier signal … · Cette lecture n'autorise aucune ouverture » |

Puis les sections, en **deux niveaux seulement** : titre de section (`title-md`, 17 px, 600) et libellés de champ (14 px, 500). Les surlignés 12 px espacés sont réservés au surligné d'en-tête du dossier et aux tuiles; ils ne servent plus de titres de section. Les groupes **modifiables** (Réglages, Placement, Identifiants) sont des cartes `ag-r-card` avec filet; les groupes dérivés sont sans carte. Chronologie et « Détails techniques » (§1.2) ferment le dossier.

### 3.3 Tableaux pour les pages de chaîne de garde et l'audit

Décision : Réservations, Prêts, Opérations physiques et Audit passent de « liste de cartes » à **tableau** à partir de 1024 px. Équipements garde sa liste maîtresse et son dossier approuvés (H2 tranchée le 23 septembre 2026).

Colonnes (ordre fixe; le serveur impose l'ordre des lignes, **aucun tri par colonne** : un tri client ne porterait que sur la page chargée et mentirait sur la collection) :

| Onglet | Colonnes | Première colonne |
|---|---|---|
| Réservations | Statut · Équipement · Titulaire · Période (du → au) · Dernière tentative | Statut (puce) |
| Prêts | Statut (+ En retard) · Équipement · Titulaire · Retrait · Retour prévu ou effectif | Statut |
| Opérations | Statut · Type · Équipement · Utilisateur · Cellule (de l'opération) · Créée | Statut |
| Audit | Heure (à la seconde, groupée par jour comme aujourd'hui) · Événement · Acteur · Sujet (type + libellé) · Transition (de → vers) | Heure |

Règles :

- Les prêts en retard sont **mis en tête** de leur page par le client **uniquement** si la page entière est chargée et que le pied de liste l'indique (« Retards en tête sur cette page »); sinon l'ordre serveur est conservé. C'est un réordonnancement de la page chargée, jamais présenté comme un tri de la collection.
- Chaque ligne est un lien (`<a>` sur la cellule Équipement ou Événement, ligne entière cliquable par JavaScript, clic modifié = nouvel onglet), `aria-current="true"` sur la ligne sélectionnée (motif `.ag-item` existant).
- Le compteur de tête distingue la collection de la page : « 3 réservations » quand `totalItems` ≤ taille de page; « 20 sur 143 réservations · page 2 de 8 » sinon; Audit : « 5 événements chargés » (curseur, pas de total : règle D10 conservée).
- Dossier : à ≥ 1280 px, colonne de droite de 480 px, tableau à gauche (colonnes secondaires masquées sous 1440 px : « Dernière tentative », « Créée », « Transition » passent dans le dossier); à 1024–1279 px, tableau pleine largeur puis dossier **sous** le tableau, avec défilement vers le dossier et focus sur son titre à la sélection (motif de `EquipmentPage` sous 1024 px); sous 1024 px, le tableau devient des blocs étiquetés (en-têtes masqués, `data-label` par cellule, motif `.ag-ov__cells`).
- Pagination : contrôles existants (`.ag-pager`), remis à la page 1 à tout changement de filtre (§3.4).

### 3.4 Filtres cohérents

Un seul composant `FilterBar` pour Réservations et prêts, Anomalies et Audit (l'Audit garde sa `FilterDisclosure` fermée par défaut, avec la même barre à l'intérieur) :

- **Application immédiate** : un sélecteur (statut, gravité, type, type d'événement, type de sujet) applique à la sélection; un champ date applique à la validation du champ (`change`); le sélecteur d'équipement applique au choix d'un résultat; un champ texte libre (identifiant d'opération, de sujet, d'acteur en Audit) applique 300 ms après la dernière frappe et seulement si la valeur est un UUID valide (sinon aide « Identifiant attendu au format UUID », pas de requête).
- Les boutons « Filtrer » et « Tout afficher » disparaissent. Un bouton « Effacer les filtres » (`ghost sm`) apparaît quand au moins un filtre est actif, et une **puce par filtre actif** (« Statut : Actives ×», « Équipement : MM-001 ×», « Du 10 nov. ×») sous la barre; chaque croix est un bouton de 32 px avec `aria-label` « Retirer le filtre Statut ».
- Tout changement de filtre remet la pagination à la page 1 (et efface le curseur d'audit : « La liste a changé. Recommencez depuis le début. » n'est alors plus nécessaire sauf `400 INVALID_CURSOR`, conservé).
- L'adresse reste la source de vérité (paramètres existants); le bouton Précédent du navigateur annule le dernier filtre.
- Pendant la lecture déclenchée par un filtre : le tableau garde les lignes précédentes atténuées (`aria-busy="true"`), jamais un vide intermédiaire; une lecture annulée par un filtre plus récent n'affiche rien.
- Vide **par filtre** : « Aucune réservation pour ces filtres · Effacer les filtres »; vide **sans filtre** : « Aucune réservation enregistrée »; erreur : alerte existante, jamais le texte « Aucune ».
- Champs date : libellés « Du (inclus) » et « Au (inclus) » avec le fuseau du laboratoire en aide. Les deux champs nomment des **jours** du laboratoire, tous deux inclus; le client en dérive les instants de l'API, `from` inclusif et `to` exclusif (`09` §17, §18.1, §19.1), en envoyant pour `to` le début du jour suivant (`transactionQuery.ts`, `auditFilters.ts`). Aucun changement du contrat REST. Raccourcis `ghost sm` « Aujourd'hui », « 7 jours », « 30 jours » qui remplissent les deux champs.
- Équipements : la recherche existante (`q`) adopte la même temporisation de 300 ms et perd son bouton « Rechercher »; le champ garde son libellé.

### 3.5 Équipements

Liste maîtresse et dossier conservés. Changements : zone d'actions (§3.1), bloc d'état (§3.2), recherche instantanée (§3.4), colonne d'actions « Modifier · Archiver » des modèles alignée à droite (existant), et le dossier perd les surlignés multiples au profit de deux niveaux (§3.2).

### 3.6 Casiers

Dossier unique par casier : zone d'actions (« Modifier l'horaire », « Voir les opérations »), bloc d'état, table des cellules avec « Équipement attendu » (lot 1), erreurs signalées en section repliable quand il y en a zéro (« 0 erreur signalée » reste visible en une ligne).

### 3.7 États et responsive

Les états de chaque page restent ceux des `states.md` existants, avec les règles de §3.4 pour le vide par filtre et la lecture pendant un changement de filtre. Tableaux : 1440 (toutes colonnes + dossier), 1280 (colonnes secondaires masquées + dossier), 1024 (tableau pleine largeur, dossier dessous), 390 et 320 (blocs étiquetés). Aucune colonne ne tronque un code ou un nom : retour à la ligne (`overflow-wrap: anywhere`), largeur minimale de colonne 96 px.

### 3.8 Acceptation et QA

1. Chaque dossier commence par titre, ligne d'actions, bloc d'état; les actions présentes sont exactement celles du tableau §3.1 selon l'état de l'objet (test de rendu par état : anomalie ouverte, reconnue, résolue; exemplaire actif, archivé).
2. Archiver, révoquer et reconnaître conservent leur confirmation et leur `Idempotency-Key`; un double clic n'envoie qu'une requête (tests existants `forms` et nouveaux cas).
3. Les quatre tableaux rendent les colonnes définies, sans tri client sur la collection; le compteur distingue page et collection (fixtures `totalItems` 3 et 143).
4. Un changement de filtre applique sans bouton, remet à la page 1, met à jour l'adresse, et affiche la puce correspondante; « Effacer les filtres » ramène à l'adresse nue; Précédent annule le dernier filtre.
5. Un filtre texte non UUID n'envoie aucune requête (compteur de requêtes).
6. Le vide par filtre et le vide sans filtre ont des textes distincts; une erreur n'affiche jamais « Aucune ».
7. Sous 1024 px, la sélection d'une ligne défile vers le dossier et y porte le focus; à ≥ 1280 px, le focus reste sur la ligne et le dossier est annoncé (`role="status"`).
8. 1440/1280/1024/390/320 sans défilement horizontal; axe sans violation; tableaux avec `<th scope>` et `caption` visuellement masquée.

QA : captures des quatre tableaux et des dossiers (nominal, vide par filtre, erreur, périmé) en clair et sombre aux cinq largeurs; parcours clavier « filtre → ligne → dossier → action → dialogue → retour »; lecteur d'écran sur un tableau (en-têtes lus par cellule en blocs étiquetés); mesure de la hauteur des pages à 390 px avant et après (objectif : Vue d'ensemble et Réservations plus courtes qu'à l'état initial, captures `etat-initial/*-mobile-*`).

## 4. Décisions tranchées (rappel)

1. Libellés par un index client borné (lot 1), pas une requête par ligne; replis définis; aucune déduction d'un fait passé à partir d'un placement actuel.
2. UUID uniquement dans « Détails techniques », repliés, copiables, ouvrables par `?technique=1`.
3. Sélecteur d'équipement = combobox avec recherche serveur `q`, 300 ms, 2 caractères, 20 résultats.
4. Une page, un rappel; le reste dans une aide de page au clavier et au toucher.
5. Badges : Anomalies ouvertes et Prêts en retard seulement; « N+ » en partiel; point neutre en erreur; jamais 0.
6. Vue d'ensemble = bande de cinq tuiles liées + modules existants + « Reconnaître » en place; ligne « rien à signaler » seulement sur lectures complètes.
7. Tableaux pour Réservations, Prêts, Opérations, Audit; liste + dossier conservés pour Équipements; aucun tri client de la collection; retards en tête sur la page chargée, dit comme tel.
8. Filtres à application immédiate avec puces et « Effacer »; suppression des boutons « Filtrer » et « Tout afficher ».
9. Deux niveaux typographiques dans les dossiers; cartes pour les groupes modifiables.
10. « Actualiser » unique, instant de la dernière réussite, état « Non actualisé » après échec.

## 5. Dépendances vers la session Backend

Aucun endpoint n'est inventé ici. Chaque ligne décrit la donnée manquante, la limite du repli client livré par le lot, et le besoin à transmettre; les lots sont livrables sans ces évolutions.

| Réf. | Donnée manquante | Limite actuelle et repli du lot | Besoin à transmettre |
|---|---|---|---|
| B1 | `AnomalyView` ne porte ni `AssetSummary` ni code de cellule (`09` §8.7) | Lot 1 : index client borné à 500 exemplaires et 100 casiers; au-delà, identifiant seulement | Ajouter `asset: AssetSummary \| null` et `compartmentCode` (ou `compartment: {id, code, lockerCode}`) aux vues d'anomalie, sur le modèle de R7 (#48) pour les opérations |
| B2 | `AuditEventView` : `subjectId` sans libellé; `actor` nommé mais pas le sujet (`09` §19.1) | Lot 1 : libellé seulement pour `ASSET` (index) et pour `LOCKER_OPERATION` déjà en cache; les autres sujets restent « type + identifiant » | Un `subject: {type, id, label}` ou un `AssetSummary` quand le sujet est un actif, une opération ou une anomalie liée à un actif |
| B3 | `GET /admin/loans` n'a pas de filtre `overdue` ni de total des retards (`09` §17) | Lots 1 et 2 : lecture de 100 prêts par statut ouvert, compteur « N+ » au-delà; le lien de la tuile ne peut pas filtrer « en retard » | Filtre `overdue=true` sur `/admin/loans`, ou un `totalOverdue` dans l'enveloppe |
| B4 | Aucune liste des comptes | Pas de filtre par titulaire; `userId` du contrat non exposé dans l'interface | Décision produit avant tout endpoint : filtrer par titulaire est-il attendu en P0 ? Si oui, une lecture `GET /admin/users?q=` bornée |
| B5 | `GET /admin/locker-operations` prend un seul `status` (`09` §17) | Lot 2 : sept lectures pour « en cours », compteur « N+ » si l'une échoue | `status` à valeurs multiples ou un filtre `inProgress=true` |
| B6 | Index des exemplaires : pas de lecture « tous les codes » légère | Lot 1 : cinq pages de 100 avec les vues complètes | Si le parc dépasse 500 exemplaires : une lecture `GET /admin/assets/summaries` (id, code, modèle, `archivedAt`) ou une `size` plus grande pour cette route |

## 6. Hors périmètre

- Landing publique (Jimmy), application iOS (mandat en cours, inchangé), API et base de données (session Backend, §5).
- Toute action d'écriture nouvelle : fin de prêt, confirmation d'opération, ouverture à distance, résolution d'anomalie.
- Graphiques, statistiques, historique enrichi (P1).
- Refonte de l'identité, nouvelle police, nouveaux jetons de couleur.

## 7. Écarts acceptés à la livraison (26 novembre 2026)

Écarts signalés par la session Web Manager (PR #244, #245 et le lot 3) et tranchés par la session Design. Ils font partie du contrat; le texte des sections concernées n'est pas réécrit, cette liste prévaut.

| Lot | Section | Écart livré | Décision |
|---|---|---|---|
| 1 | §1.6 | Le badge Anomalies réutilise la lecture `status=OPEN&size=100` de la Vue d'ensemble au lieu d'une lecture `size=1` | Accepté : une seule requête partagée, c'était l'intention |
| 1 | §1.4, §1.5 | « Lu à … » est placé à côté du bouton « Actualiser », pas sur une ligne de pied séparée | Accepté : conforme à §1.5 |
| 1 | §1.4 | La plupart des notes « évalué à » par panneau sont conservées | Accepté quand l'instant est un fait serveur distinct (`evaluatedAt` du casier, du diagnostic); les doublons de l'instant de page seront retirés après les tests de Philippe |
| 1 | §1.2 | `IdText` nomme l'identifiant complet par un texte masqué (`sr-only`) plutôt que par `aria-label` | Accepté : équivalent pour le lecteur d'écran |
| 1 | §1.4 | Le texte `returnEffect` du dialogue Reconnaître est conservé | Accepté : il protège une décision (nouvelle tentative de retour) |
| 1 | §1.6 | Le badge Prêts affiche « indisponible » quand la lecture est incomplète et qu'aucun retard n'a été observé | Accepté : jamais un zéro non confirmé |
| 2 | §2.1 | Liens des tuiles avec `statut=ACTIVE` (paramètre existant) | Accepté; le contrat est corrigé |
| 2 | §2.1 | Une tuile pour le casier du P0, « +N casiers » au-delà | Accepté : conforme |
| 2 | §2.5 | Les modules gardent leur propre avis « périmé » en plus de celui de la bande | Accepté pour les tests; à consolider si Philippe le juge bruyant |
| 2 | §2.2 | La ligne « Aucune intervention » exige aussi des lectures complètes et fraîches des opérations, des réservations et du casier | Accepté : plus strict que le texte, dans le sens du critère 3 de §2.6 |
| 2 | §2.1 | « 0+ » possible pour les retards quand la lecture est tronquée sans retard observé | Accepté : « au moins 0, lecture incomplète » est la vérité |
| 3 | §3.4 | « Au (inclus) » au lieu de « Au (exclu) » | Accepté : erreur du contrat, corrigée; aucun changement REST |
| 3 | §3.3 | Colonne « Dernière tentative » des réservations réduite à « Opération en cours » ou « Aucune en cours » | Accepté : nommer la tentative demanderait une lecture par ligne (§1.1); le détail reste dans le dossier |
| 3 | §3.1 | Le dossier de prêt n'a pas de zone d'actions; ses liens (opérations de retrait, de retour, en cours) restent dans leur section | Accepté : un prêt est en lecture seule |
| 3 | §3.1 | La zone d'actions d'une réservation n'apparaît que pour une réservation honorée (seul cas où des liens croisés existent) | Accepté |
| 3 | §3.4 | « Effacer les filtres » sur Opérations retire aussi le filtre casier | Accepté : c'est un filtre; sa puce reste retirable seule |
| 3 | §3.3 | La puce de statut de l'Audit est conservée | Accepté |
| 3 | §3.2 | La première raison est la première dans l'ordre du serveur; le client ne réordonne pas | Accepté : cohérent avec la liste des exemplaires existante |

## 8. Décisions après la revue QA du 26 novembre 2026

Verdicts QA FAIL sur #244, #245 et #246 (règle de Philippe : aucun « pass with risks »). Les constats mécaniques sont corrigés par la session Web. Les décisions de présentation ci-dessous complètent et, en cas de conflit, remplacent §2.4, §3.3 et §3.7.

### 8.1 Vue d'ensemble sous 560 px (#245, constat 1)

Objectif mesurable : à 390 × 844 px, hauteur de page ≤ 2 300 px à l'état nominal (celle de #244) et ≤ 2 700 px à l'état périmé.

- Bande : grille de **2 colonnes**, cinquième tuile pleine largeur; tuile de 88 px de haut minimum; surligné 12 px, valeur 24 px (au lieu de 32), **une seule ligne de détail** (anomalies : « 1 élevée · 1 moyenne »; retards : « depuis 25 nov. »; casier : « fermeture 17 h 00 »; opérations et réservations : aucune); aucun « Lu à » par tuile.
- Pied de bande, une ligne : « Lu à HH h MM · lecture la plus ancienne », et « Non actualisé » quand une tuile est périmée. L'avis périmé (`StaleNotice`) apparaît **une seule fois**, sous la bande; sous 560 px les modules n'affichent plus le leur et portent seulement une puce `unknown` « Non actualisé » dans leur en-tête.
- Modules sous 560 px : **3 rangées** au lieu de 5 (`ROW_LIMIT` 3), le pied « Voir les N … » porte le total serveur; table des cellules du casier en **une ligne par cellule** : « A1 · Ouverte · Déverrouillée · MM-001 », retour à la ligne permis, sans blocs étiquetés.
- À 320 px : les puces de statut ne se coupent pas (`white-space: nowrap`); le détail d'une tuile se tronque par retour à la ligne, jamais par défilement.
- Surligné de la tuile Casier : le code du casier ne se coupe pas à l'intérieur (`overflow-wrap: normal` sur le code; le surligné passe à la ligne avant le code). Détail « fermeture 17 h 00 » quand la fermeture est le jour même, « fermeture lun. 17 h 00 » sinon; jamais la date complète.

### 8.2 Colonnes des tableaux (#246, constat 4)

Règle : **jamais de défilement horizontal dans un panneau**; le dossier garde 480 px (il porte les actions); les colonnes masquées restent lisibles dans le dossier. `table-layout: fixed`, retour à la ligne par `overflow-wrap: break-word` (jamais `anywhere` : pas de coupure au milieu d'un mot), codes en `word-break: normal`. Minimum de colonne 96 px; Statut 120 px.

| Tableau | ≥ 1440 px | 1280 à 1439 px |
|---|---|---|
| Réservations | Statut · Équipement · Titulaire · Période | Statut · Équipement · Période (du et au sur deux lignes) |
| Prêts | Statut · Équipement · Titulaire · Retrait · Retour prévu ou effectif | Statut · Équipement · Retour prévu ou effectif |
| Opérations | Statut · Opération (type et équipement sur une ligne) · Utilisateur · Cellule · Créée | Statut · Opération · Créée |
| Audit | Heure · Événement · Acteur · Sujet · Transition | Heure · Événement · Sujet |

La colonne « Dernière tentative » des réservations est supprimée : « Opération en cours » devient une seconde puce dans la cellule Statut quand `currentOperationId` est non nul. La puce « En retard » des prêts peut passer sous la puce de statut dans sa cellule.

### 8.3 Entre 1024 et 1279 px (#246, constat 3) et sous 1024 px (constats 6, 9, 16)

- **1024 à 1279 px : côte à côte**, comme Équipements : colonne de gauche de 320 à 380 px en **rangées-cartes** (le motif `.ag-item` existant : puces, équipement, une ligne de faits), dossier à droite sur le reste. Le tableau n'existe qu'à partir de 1280 px. Les faits de la rangée-carte sont ceux des colonnes de 1280 à 1439 px.
- **Sous 1024 px : rangées-cartes** empilées puis dossier dessous (comportement de `EquipmentPage`). Le motif « blocs étiquetés » (`data-label`, `::before`) est **retiré** pour les quatre tableaux : il double les libellés pour le lecteur d'écran et allonge les pages. Il reste réservé à la table des cellules du casier sur la page Casiers.
- Objectif mesurable : à 390 px, chaque page de liste n'est pas plus haute qu'à `95a29d6` (#245).

### 8.4 Confirmations (#246, constats 10 et 12)

- Puces de filtre actif **sous** la barre de filtres, sur leur propre ligne, « Effacer les filtres » en fin de ligne (§3.4).
- Sections Réglages, Placement attendu et Identifiants physiques de l'exemplaire rendues en cartes `ag-r-card` avec filet et rembourrage de 16 px (§3.2); le bloc d'édition de la fenêtre du casier reçoit le même rembourrage (constat 11).

### 8.5 Point non retenu comme défaut (#244, constat 7) — confirmé par Philippe le 26 novembre 2026

Le marqueur de chronologie d'une réservation suit le **statut serveur** : losange seulement quand la réservation est `EXPIRED` (ou le prêt `overdue`). Le client ne compare jamais `reservedUntil` à son horloge (même règle que `dueAt`, §3). Une réservation `ACTIVE` dont la fin est passée garde le marqueur creux jusqu'à ce que le serveur la marque expirée. Décision de Philippe : « garde le marqueur creux, le client ne compare jamais l'horloge ». Le constat 7 de #244 est clos sans correction.

### 8.6 Cibles de hauteur de la vue d'ensemble : jeu de référence et compaction (#245, deuxième revue, constat D3)

Le §8.1 fixait une cible sans nommer le jeu de données; la QA mesure 2 709 px à l'état nominal avec son jeu de revue, le test e2e de `70b5e1d` passe avec un jeu plus léger. Mesure de Design sur `70b5e1d`, même jeu, 390 × 844 px, mode aperçu : **2 740 px**, dont trois rangées d'anomalie de **211 px** chacune contre 100 à 119 px pour les rangées des autres modules, et un en-tête de page de 211 px (« Aide » seul sur une ligne, « Lu à » et « Actualiser » sur la suivante).

**Jeu de référence nommé** (toute mesure du §8.1 et du présent article s'y rapporte; le test e2e l'utilise) :

- 3 anomalies `OPEN` (1 `HIGH`, 2 `MEDIUM`), chacune avec cellule, équipement et date de détection;
- 1 prêt `ACTIVE` en retard;
- 1 casier `ONLINE`, fenêtre ouverte, 2 cellules occupées;
- 1 opération en cours (`COMMAND_ACKNOWLEDGED`);
- 2 réservations `ACTIVE`.

**Cibles restituées** à 390 × 844 px, mode aperçu compris : **≤ 2 500 px** à l'état nominal, **≤ 2 800 px** à l'état périmé (toutes les lectures de rafraîchissement en échec après une première lecture réussie). Les valeurs 2 300 et 2 700 du §8.1 sont retirées.

**Compaction exigée** (pas de contenu retiré) :

- Rangée d'anomalie sous 560 px : les deux puces (gravité, statut) sur **une seule ligne**, comme la rangée de prêt; le bouton « Reconnaître » passe **sous** le texte, aligné à gauche, au lieu d'une colonne latérale qui fait replier le titre et le détail. Objectif : rangée ≤ 140 px avec un titre sur deux lignes.
- En-tête de page sous 560 px : « Aide » et « Actualiser » sur **la même ligne**, la ligne « Lu à » en dessous; une seule ligne d'actions.
- Tuile Casier : « Ouvert · fermeture 17 h 00 » tient sur une ligne; si la largeur manque, le détail se réduit à « fermeture 17 h 00 » (le statut « En ligne » est déjà dans la valeur).

Rien d'autre ne change : 3 rangées par module, un seul avis périmé sous la bande, pieds « Voir les N … » avec le total serveur.

### 8.7 « Lecture incomplète » sous 560 px (#245, deuxième revue, constat D4)

La règle « une seule ligne de détail par tuile » du §8.1 ne supprime jamais l'honnêteté du compteur. Quand une lecture est partielle (`totalItems` au-delà de la page lue), la ligne de détail de la tuile est **remplacée** par « Lecture incomplète » à toutes les largeurs; sous 560 px c'est donc cette mention qui occupe l'unique ligne de détail, et le nom accessible de la tuile la contient (« Prêts en retard, 1+, lecture incomplète »). Masquer `.ag-tile__detail--strong` sous 560 px est un défaut; le test e2e de lecture partielle s'exécute aussi à 390 px.
