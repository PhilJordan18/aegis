# Console Manager : handoff pour l'ingénieur Web

Mode : Prototype. Issue #158 (DES-02). Plateforme : Web (`apps/admin-web`). Statut : **proposition à valider par Philippe; ne pas intégrer avant son approbation écrite.**
Ce document accompagne `prototype/` (rendus : `captures/`; états : `states.md`; mesures : `verify/`). Un prototype statique n'est pas une implémentation.
Les écrans touchés : Vue d'ensemble, Réservations et prêts (#48), Anomalies (#52), Audit (#53).

## 1. Cadre et limites

- Structure et recommandations UX approuvées le 23 septembre 2026 (`asset-lifecycle/sections.md` §0, §5, §8); la **composition** de ces quatre écrans reste l'hypothèse H2 : liste maîtresse et dossier (Réservations et prêts, Anomalies, Audit), modules (Vue d'ensemble). Ce prototype la soumet à validation.
- Identité « Lumière du hub » v3 approuvée et intégrée (`manager-v3/README.md`) : barre latérale opaque de 280 px, barre supérieure et tiroir sous 1024 px, surfaces opaques, filets fins, aucun verre ni dégradé, anneau de focus plein de 2 px décalé de 2 px.
- Jetons : `apps/admin-web/src/styles/tokens.css`, **copié sans écart** (vérifié par `verify/checks.mjs`). Aucun jeton n'est ajouté. Le rôle `anomaly` (orange) existe déjà dans les jetons; `StatusChip` doit l'accepter (voir §2).
- Aucune route, aucun champ, aucune action n'est inventé. Les manques de contrat sont affichés comme tels et listés au §7.
- **Aucune action qui change l'état de garde** : pas de fin de prêt, de confirmation d'opération, de retour forcé, d'ouverture à distance, de « Résoudre ». Seule écriture : `POST /admin/anomalies/{id}/acknowledge` (note de 1 à 500 caractères).
- Un prêt en retard reste emprunté. Aucun prêt n'est déduit d'une réservation. Aucune readiness n'est calculée par le client.

## 2. Composants à réutiliser (et à ajouter)

Réutiliser tel quel (`apps/admin-web/src/…`) :

| Besoin | Existant |
|---|---|
| Coque, navigation, tiroir | `app/shell/ManagerShell.tsx` : passer `path` des quatre sections (aujourd'hui `null`, « à venir ») |
| Titre de page et focus | `app/PageHeading.tsx`, `app/page.css` |
| Liste maîtresse, rangée, pager, vide, squelettes | `features/catalog/AssetList.tsx` (`.ag-panel`, `.ag-list__*`, `.ag-item`, `.ag-pager`, `.ag-skel`), `equipment.css` |
| Dossier à défilement focalisable | `features/catalog/AssetDossier.tsx` (`.ag-dossier__scroll`, `tabIndex=0`, `role="group"`) |
| Onglets | `.ag-tabs` de `EquipmentPage.tsx` |
| Puce de statut | `ui/StatusChip.tsx` : **ajouter le rôle `anomaly`** (`--ag-anomaly-*`, déjà dans `tokens.css`) et l'icône `status-warn` (losange et point d'exclamation, même grammaire que `status-clock`) |
| Alertes et périmé | `ui/Alert.tsx`, `features/catalog/CatalogAlert.tsx`, `StaleNotice.tsx`, `catalogFailure.ts` (ajouter le cas « liste 404 = pas encore disponible », §3) |
| Dialogue | `ui/Dialog.tsx` (`DialogBody`, `DialogActions`), motif de `forms/ArchiveDialog.tsx` pour l'idempotence et le focus |
| Champs | `ui/FormField.tsx` (`SelectField`, `TextField`, `TextAreaField`) |
| Boutons | `ui/Button.tsx` (`busy`, `inert`) |
| Marque « lecture seule » | `ui/ReadOnlyMark.tsx` |
| Formats | `i18n/format.ts` (`time`, `dateTime`, `date`), fuseau du laboratoire (G10) |

Composants nouveaux (présentation seulement; classes `cs-…` du prototype comme point de départ, à renommer `ag-…`) :

| Composant | Rôle | Prototype |
|---|---|---|
| `ModuleCard` | Panneau de la Vue d'ensemble : titre, compteur, rangées-liens, pied « Voir … » | `.cs-mod`, `.cs-row` |
| `Callout` | Encadré de règle (rappel des anomalies, « une réservation n'ouvre aucune porte ») : neutre, information, avertissement, anomalie | `.cs-callout` |
| `Timeline` | Chronologie d'un objet (réservation, prêt) et séquence physique d'une opération; marqueur plein, creux (étape absente), losange (échéance, anomalie) **toujours accompagné d'un texte** | `.cs-tl` |
| `FilterBar` | Sélecteurs + dates + « Filtrer » / « Tout afficher » (comme la recherche des Équipements : barre sans cadre) | `.cs-filters` |
| `FilterDisclosure` | `<details>` « Filtres (n actifs) » + puces retirables (Audit) | `.cs-disclosure`, `.cs-chips` |
| `EventRow` | Rangée d'audit : heure à la seconde, événement, acteur, sujet, de → vers | `.cs-ev` |
| `CellTable` | Cellules du casier (porte, serrure, équipement attendu), empilé sous 560 px | `.cs-cells` |
| `IdText` | UUID abrégé (8 caractères + …) dans la liste, complet et sélectionnable dans le dossier | `.cs-id` |

Les repères **G1 à G12** et les encadrés pointillés magenta du prototype sont des **annotations de revue**, hors produit (masqués par `?notes=off`). Ne pas les porter dans l'application.

## 3. Comportements communs

- **Lecture par identifiant** : le dossier est lu par `GET …/{id}`, même hors du filtre de la liste (après « Reconnaître », l'anomalie sort du filtre « Ouvertes » mais reste affichée).
- **Liste 404** : sur une route de **liste**, `404 RESOURCE_NOT_FOUND` signifie « service pas encore disponible » et jamais « vide » (une liste vide répond `200`). Sur une route par identifiant, c'est « Dossier introuvable ».
- **Compteurs** : seulement `totalItems` du serveur quand l'enveloppe le fournit (G6); sinon « Au moins N » avec l'erreur partielle. Jamais la taille d'une page présentée comme un total. Audit : « N événements chargés ».
- **Retard** : lire `overdue` (serveur); ne jamais comparer `dueAt` à l'horloge du client. « En retard depuis » affiche l'heure de `dueAt`.
- **Sélection** : lien `<a href>` par rangée (clic modifié = nouvel onglet); côte à côte, le focus reste sur la rangée et une région `role="status"` annonce le dossier; empilé (< 1024 px), le focus passe au dossier et la vue défile vers lui, comme `EquipmentPage`.
- **Actualiser / Réessayer** : bouton secondaire `sm`, `aria-disabled` + indicateur d'occupation, focus conservé; un échec répété est annoncé une fois.
- **`availableActions`** : jamais lu ni affiché sur ces écrans (G11).
- **Reconnaissance** : générer l'`Idempotency-Key` à l'ouverture du dialogue (réutilisée pour tout nouvel essai après réseau coupé); bouton occupé et champs en lecture seule pendant la requête; Échap, fond et fermeture inactifs pendant l'attente; à `409`, alerte dans le dialogue + « Actualiser et fermer ».
  Focus : champ « Note » à l'ouverture; alerte du dialogue (`tabIndex=-1`) après une erreur; après succès, le dossier (le bouton a disparu).
- **Idempotence et audit** : aucun état local optimiste; l'état affiché après succès est celui de la réponse `AnomalyView`.

## 4. Disposition par écran et par largeur

Gabarit commun : titre (32 px), puis en dessous le rappel ou les onglets, puis les filtres, puis le contenu. À ≥ 1024 px le contenu remplit la hauteur et chaque panneau défile seul (dossier focalisable); sous 1024 px la page défile.

### 4.1 Vue d'ensemble (page qui défile; barre latérale collante)

| Largeur | Disposition |
|---|---|
| 1440 | Contenu 1072 px. Anomalies (7/12) et Prêts en retard (5/12); Casier pleine largeur (état et fenêtre à gauche, table des cellules à droite); Opération en cours (6/12) et Réservations actives (6/12) |
| 1024 | Contenu ≈ 684 px. Anomalies, Prêts, Casier : pleine largeur; Opération et Réservations : 6/12 chacun |
| 390 | Une colonne; modules dans le même ordre; cellules du casier empilées (étiquette devant chaque valeur); barre supérieure + tiroir |
| 320 | Idem; aucune troncature (texte long à la ligne, UUID `overflow-wrap: anywhere`) |

Ordre de lecture et de tabulation : anomalies, prêts, casier, opération, réservations (priorité §5.1 de `sections.md`). Chaque rangée est un lien vers le dossier concerné; le titre de chaque module est un `h2`.

### 4.2 Réservations et prêts

| Largeur | Disposition |
|---|---|
| 1440 | Liste 440 px + dossier 612 px; onglets sous le titre; filtres sur une ligne (statut, équipement, du, au, boutons) |
| 1024 | Liste 320–380 px + dossier; filtres sur une ligne si la place le permet, sinon deux |
| 390 | Filtres en colonne; liste puis dossier empilés; onglets qui passent à la ligne (« Opérations physiques » sur deux lignes) |
| 320 | Idem; chronologie : l'heure sous le libellé, marqueur à gauche |

Onglets : Réservations, Prêts, Opérations physiques (U5). Valeur par défaut : Réservations. Le lien depuis Casiers vers les opérations filtrées par `lockerId` reste à ajouter dans Casiers (hors de ce prototype).

### 4.3 Anomalies

| Largeur | Disposition |
|---|---|
| 1440 | Rappel permanent pleine largeur; filtres (statut, gravité, type); liste 440 px + dossier. Défaut : statut « Ouvertes » (ou « Toutes » quand l'adresse porte `sel`) |
| 1024 | Idem, liste plus étroite |
| 390 | Rappel, filtres en colonne, liste puis dossier; dialogue à 16 px des bords, actions à pleine largeur |
| 320 | Idem; le corps du dialogue défile, titre et actions restent visibles |

### 4.4 Audit

| Largeur | Disposition |
|---|---|
| 1440 | Titre + mention « Historique non modifiable »; « Filtres (aucun) » en disclosure fermé par défaut, puces des filtres actifs toujours visibles; chronologie 440 px + détail |
| 1024 | Idem |
| 390 | Heure au-dessus de l'événement; filtres en colonne dans la disclosure; détail sous la liste |
| 320 | Idem |

## 5. Textes FR et EN

Les chaînes complètes (FR et EN, mêmes clés, parité vérifiée) sont dans `prototype/js/copy.js`, à reporter dans `i18n/messages/fr.ts` et `en.ts` après validation. Le vocabulaire suit `docs/localisation/glossaire.md`. Principaux textes :

| Rôle | FR | EN |
|---|---|---|
| Rappel des anomalies (permanent) | Une anomalie se résout seulement lorsqu'une nouvelle observation du casier le confirme. Reconnaître une anomalie documente la prise de connaissance; cela ne la résout pas. | An anomaly is resolved only when a new observation from the locker confirms it. Acknowledging an anomaly records that someone took note of it; it does not resolve it. |
| Action | Reconnaître / Ne résout pas l'anomalie. | Acknowledge / Does not resolve the anomaly. |
| Dialogue | Reconnaître cette anomalie · Note de reconnaissance · Obligatoire, de 1 à 500 caractères. Elle est conservée avec votre nom et l'heure. | Acknowledge this anomaly · Acknowledgement note · Required, 1 to 500 characters. It is kept with your name and the time. |
| 409 résolue | Cette anomalie est déjà résolue. Aucune reconnaissance n'a été enregistrée. | This anomaly is already resolved. No acknowledgement was recorded. |
| 409 non reconnaissable | Cette anomalie ne peut pas être reconnue dans son état actuel. | This anomaly cannot be acknowledged in its current state. |
| Prêt en retard | Ce prêt est en retard et l'équipement reste emprunté. Il ne redevient disponible qu'au retour confirmé par le casier. | This loan is overdue and the equipment stays borrowed. It becomes available again only when the locker confirms the return. |
| Réservation | Une réservation n'ouvre aucune porte et ne crée aucun prêt. Un prêt n'existe qu'après un retrait confirmé par le casier. | A reservation opens no door and creates no loan. A loan exists only after a checkout confirmed by the locker. |
| Opération | Une opération n'est confirmée que lorsque le casier a observé le retrait ou le retour. Un accusé de commande ne prouve ni le déverrouillage ni l'ouverture. | An operation is confirmed only when the locker has observed the checkout or the return. A command acknowledgement proves neither unlocking nor opening. |
| Titulaire | Titulaire : identifiant seulement | Holder: identifier only |
| Étape absente | Non reçue / Pas encore reçue | Not received / Not received yet |
| Compteur partiel | Au moins 1 en retard · Lecture incomplète. | At least 1 overdue · Incomplete read. |
| 404 liste | Cette section n'est pas encore disponible. | This section is not available yet. |
| Audit, curseur | La liste a changé. Recommencez depuis le début. | The list has changed. Start again from the beginning. |
| Audit, immuable | Historique non modifiable : aucun événement ne peut être modifié ni supprimé. | Read-only history: no event can be modified or deleted. |
| Audit, preuve | Aucune preuve physique n'est référencée par cet événement. | No physical evidence is referenced by this event. |

Libellés de type d'anomalie : voir `an.types` de `copy.js` (sept valeurs de `03` §5.11). Un type inconnu : « Type non reconnu par cette version ». Libellés d'événements d'audit : hypothèses de fixture (G5).

## 6. Correspondance champ → contrat

Seuls des champs définis par `09-contrats-rest.md` sont affichés. « J » : obtenu par jointure d'identifiants avec une autre lecture définie.

| Écran | Affichage | Champ | Réf. |
|---|---|---|---|
| Réservations | Équipement, code, modèle | `asset.assetCode`, `asset.model.name`, `.manufacturer`, `.modelNumber` | §8.3, §8.8, §8.2 |
| Réservations | Placement attendu | `asset.placement.lockerCode`, `.compartmentCode` | §8.8, §8.2 |
| Réservations | Titulaire | `userId` (identifiant seulement) | §8.3, G1 |
| Réservations | Statut | `status` | §8.3, 03 §5.5 |
| Réservations | Chronologie | `createdAt`, `reservedFrom`, `reservedUntil`, `fulfilledAt`, `cancelledAt`, `expiredAt` | §8.3, §14.1 |
| Réservations | Opération liée | `currentOperationId` | §8.3, §8.4, G8 |
| Prêts | Statut, retard | `status`, `overdue` (serveur) | §8.4, 03 §5.6 |
| Prêts | Chronologie | `checkedOutAt`, `dueAt`, `returnRequestedAt`, `returnedAt` | §8.4 |
| Prêts | Titulaire | `holderUserId` (identifiant seulement) | §8.4, G1 |
| Prêts | Opérations liées | `checkoutOperationId`, `returnOperationId`, `currentOperationId` | §8.4 |
| Opérations | Type, statut | `type`, `status` | §8.5 |
| Opérations | Séquence | `createdAt`, `localProofDisplayedAt`, `localProofValidatedAt`, `authorizedAt`, `commandSentAt`, `acknowledgedAt`, `doorOpenedAt`, `observationReceivedAt`, `confirmedAt`, `terminalAt` | §8.5, sections.md §1.4 |
| Opérations | Action attendue, échéance | `requiredAction`, `expiresAt` | §8.5 |
| Opérations | Équipement, cellule (J) | `assetId`, `compartmentId` → `GET /admin/assets/{id}`, `GET /admin/lockers` | §8.5, §12.2, §16.2, G3 |
| Opérations | Réservation, prêt, anomalie liés | `reservationId`, `loanId`, `anomalyId` | §8.5 |
| Opérations | Détails techniques | `id`, `localAccessChallengeId`, `failureReason` (texte libre, G12) | §8.5 |
| Anomalies | Type, gravité, statut | `type`, `severity`, `status` | §8.7, 03 §5.11 |
| Anomalies | Cellule, équipement (J) | `compartmentId`, `assetId` → jointure | §8.7, G3 |
| Anomalies | Détection | `detectedAt` | §8.7 |
| Anomalies | Résumé | `summary` (affiché tel quel, source indiquée, G12) | §8.7 |
| Anomalies | Reconnaissance | `acknowledgedAt`, `acknowledgedBy.displayName`, `acknowledgementNote` | §8.7, §8.8 |
| Anomalies | Résolution | `resolvedAt`, `resolutionEvidenceObservationId` (identifiant seulement), `resolutionNote` (G9) | §8.7 |
| Anomalies | Preuves | section `evidence` du détail : **forme non définie, rien n'est affiché** | §18.1, G2 |
| Anomalies | Action | `POST /admin/anomalies/{id}/acknowledge` `{note}` + `Idempotency-Key` | §18.2, §20 |
| Audit | Événement, heure, acteur, sujet, de → vers, résultat, motif, détails | `eventType`, `occurredAt`, `actor`, `subjectType`, `subjectId`, `operationId`, `fromState`, `toState`, `result`, `reason`, `details` | §19.1, G4, G5 |
| Audit | Pagination | `limit` (1 à 100), `cursor`, `nextCursor`, `hasMore` | §19.1, §22.2 |
| Vue d'ensemble | Anomalies ouvertes | `GET /admin/anomalies?status=OPEN` | §18.1 |
| Vue d'ensemble | Prêts en retard | `GET /admin/loans?status=ACTIVE` puis `RETURN_PENDING`; filtre sur `overdue` | §17, §8.4, G6 |
| Vue d'ensemble | Casier | `connectionStatus`, `lastSeenAt`, `evaluatedAt`, `currentWindow`, `compartments[].doorState`, `.lockState`; `AdminLockerView.compartments[].currentAsset` | §8.6, §16.1, §16.2 |
| Vue d'ensemble | Opération en cours | `currentOperationId` des réservations `ACTIVE` et prêts non `COMPLETED`, puis `GET /admin/locker-operations/{id}`, statuts non terminaux | §8.3, §8.4, §17, G7 |
| Vue d'ensemble | Réservations actives | `GET /admin/reservations?status=ACTIVE` | §17 |

Instants : UTC dans le contrat, affichés au fuseau du laboratoire avec son abréviation dans le dossier (G10).

## 7. Manques de contrat : décisions demandées

Rien n'est inventé dans le prototype; les fixtures supposent seulement les deux formes signalées en tête de `prototype/js/fixtures.js` (G4, G5). Chaque décision relève de Philippe (contrat public : `AGENTS.md`, « Do not change public REST/MQTT contracts… without a documented human decision »). Les recommandations sont des ajouts compatibles (`09` §3 : les clients tolèrent les champs ajoutés).

| # | Manque | Références exactes | Recommandation |
|---|---|---|---|
| **G1** | Aucun nom pour le titulaire ou l'utilisateur : `userId`, `holderUserId` seuls (reste de C4) | `09` §8.3 (`userId`), §8.4 (`holderUserId`), §8.5 (`userId`); `UserSummary` défini §8.8; `sections.md` §5.3, §9 (C4) | Ajouter `user: UserSummary` (réservation, opération) et `holder: UserSummary` (prêt), en gardant les identifiants. D'ici là : « identifiant seulement » + UUID, comme le prototype. |
| **G2** | Forme de la section `evidence` du détail d'une anomalie non définie | `09` §18.1; `03` §4.16, §5.10; `sections.md` §5.5 (⚠) | Définir `evidence: [{observationId, type, observedAt, compartmentId, value}]`, sans charge brute, types de `03` §5.10. D'ici là : aucune preuve détaillée, seulement `resolutionEvidenceObservationId`. |
| **G3** | `AnomalyView` et `LockerOperationView` ne donnent que des UUID (`assetId`, `compartmentId`, `userId`) : ni code d'équipement ni code de cellule | `09` §8.5, §8.7; jointures possibles : §12.2, §16.2 | Préférer l'ajout de `asset: AssetSummary \| null` et `compartment: {id, code} \| null` (§8.8). Sinon, jointures côté client (une lecture par équipement, une lecture du casier) avec repli « identifiant seulement » (état `join-failed`). |
| **G4** | `AuditEventView` : types de `actor` et de `details` non définis; références aux preuves physiques non définies | `09` §19.1; `03` §4.20; `05` §10 (identifiants des preuves) | `actor: {userId, displayName} \| null` (null = aucun utilisateur associé), `details` : objet de valeurs scalaires aux clés documentées par `eventType`, `evidenceObservationIds: UUID[]`. D'ici là : affichage tolérant, « Aucune preuve physique n'est référencée… ». |
| **G5** | Vocabulaires et ordre de l'audit non définis : `eventType`, `subjectType`, `result`, `fromState`/`toState`; ordre de la liste (le curseur encode `occurredAt` et `id` sans direction) | `09` §19.1, §22.2; `06` §16.1 (liste non fermée); `03` §5 | Fermer les énumérations dans `03` (§5), documenter l'ordre `occurredAt` décroissant puis `id` décroissant. Valeur inconnue : « Événement non reconnu · CODE » (`09` §3). Les libellés d'événement du prototype sont des hypothèses. |
| **G6** | Listes §17 et §18 : enveloppe, taille maximale, tri principal et `status` multivalué non documentés (C7) | `09` §11.1, §16.2, §17, §18.1, §22.1; `sections.md` §7.1 | Même enveloppe que §11.1 (`items`, `page`, `size`, `totalItems`, `totalPages`), `size` ≤ 100, tri documenté (`createdAt`, `checkedOutAt`, `detectedAt` décroissants puis `id`), filtre `overdue=true`. D'ici là : compteur seulement si l'enveloppe est complète, sinon « Au moins N ». |
| **G7** | Opérations en cours : `status` d'opération à valeur unique, sept états non terminaux | `09` §17, §8.5; `sections.md` §7.1 | `status` multivalué (ou `active=true`). D'ici là : dériver de `currentOperationId` des réservations `ACTIVE` et prêts non terminés, une lecture de détail par identifiant; complet au P0 car toute opération non terminale est rattachée à l'un d'eux. |
| **G8** | Pas de lien réservation → prêt : `ReservationView` n'a pas de `loanId`, et `currentOperationId` est nul une fois la réservation close | `09` §8.3, §8.4, §8.5 (`reservationId`, `loanId`) | Ajouter `loanId: UUID \| null` à `ReservationView` (renseigné à l'accomplissement). D'ici là : lien vers les opérations de l'équipement; aucun prêt n'est déduit. |
| **G9** | Notes : source de `resolutionNote` et notes après reconnaissance (C5); unité de « 1 à 500 caractères » non précisée | `09` §18.2, §8.7; `sections.md` §5.5 (C5); ADR-014 (graphèmes pour `q`) | Compter en graphèmes (comme `q`), refuser vide ou espaces (`NOT_BLANK`, `SIZE`, §7.1); documenter qui écrit `resolutionNote`. Le prototype compte en graphèmes. |
| **G10** | Fuseau d'affichage des instants des listes et de l'audit : aucun `timeZone` hors de `LockerStatusView.currentWindow` | `09` §3, §8.6 (`currentWindow.timeZone`), §14.1 | Afficher au fuseau du laboratoire (celui du casier unique du P0), abréviation visible dans le dossier, mention « Heures du laboratoire : America/Toronto » sous les listes. À documenter pour l'audit. |
| **G11** | `availableActions` sur les vues administrateur : la sémantique est « pour le demandeur » | `09` §8.10 (règles 1 à 6), §8.3, §8.4, §25 | Ne jamais lire ni afficher cette liste dans Manager; préciser dans §8.10 qu'une lecture administrateur n'est pas actionnable. |
| **G12** | Langue et stabilité de `AnomalyView.summary` et de `LockerOperationView.failureReason` | `09` §8.7, §8.5; `docs/localisation/convention.md` (un texte du serveur n'est pas affiché tel quel) | Libellé principal = catalogue du client selon `type`; `summary` affiché **entre guillemets avec sa source** (« transmis par le serveur, affiché tel quel »); `failureReason` en détail technique. Définir ses valeurs ou le rendre optionnel. |

## 8. Accessibilité (WCAG 2.2 AA)

- Ordre de tabulation : lien d'évitement, sections de la barre latérale, (barre supérieure), titre de page, onglets, filtres, rangées de la liste, dossier (focalisable pour défiler), liens du dossier. Mesuré par `verify/checks.mjs` (ordres relevés).
- Focus : anneau plein de 2 px décalé de 2 px (`--ag-focus`), jamais retiré; vérifié à chaque arrêt de tabulation.
- Statut jamais porté par la couleur seule : chaque puce associe forme (octogone = erreur ou blocage, losange = à surveiller, cercle = information ou succès), symbole et texte. Retard : puce « En retard » + texte « En retard depuis … ». Frise : un texte accompagne chaque marqueur (« Non reçue »).
- Contrastes : jetons de l'application, déjà mesurés (`tokens.test.ts`); axe `color-contrast` actif sur toutes les pages du prototype.
- Erreurs de champ associées (`aria-describedby`, `aria-invalid`), alertes `role="alert"` (erreur, avertissement) et `role="status"` (information); annonces de sélection, de chargement de page et d'issue.
- Réflexion : aucun défilement horizontal à 320 px; texte à la ligne; UUID cassables.
- Cibles : boutons et sélecteurs ≥ 36–44 px; liens isolés ≥ 24 px de haut.
- Mouvement réduit : aucune animation requise; l'indicateur d'occupation est statique.
- Limite : le prototype n'a pas été testé avec un lecteur d'écran réel; un parcours VoiceOver/NVDA reste à faire sur l'implémentation.

## 9. Liste de recette

1. Les quatre sections de la barre latérale sont des liens; « à venir » disparaît pour elles.
2. Aucune route, aucun champ hors de `09` (revoir le tableau du §6).
3. Aucun bouton « Résoudre », ni fin de prêt, confirmation, retour forcé, ouverture à distance.
4. Un prêt en retard reste « Retour en cours » ou « Actif » + « En retard »; jamais « Disponible » ni « Prêt ».
5. Aucun compteur calculé sur une page; « Au moins N » quand la lecture est incomplète.
6. États du § `states.md` : chargement, vide par filtre, erreur partielle, périmé, 401, 403, 404 de liste, 409 ×2, 400 `INVALID_CURSOR`, réseau, 5xx avec `traceId`.
7. Note de reconnaissance de 1 à 500 caractères; `Idempotency-Key` stable pour un même dialogue.
8. FR et EN complets; thèmes clair et sombre; 1440, 1024, 390 et 320 px sans défilement horizontal.
9. Annotations de revue (G1 à G12, bandeau, encadrés pointillés) absentes de l'application.
10. Rendu réel comparé aux `captures/` (revue visuelle par `qa-reliability-engineer`).
