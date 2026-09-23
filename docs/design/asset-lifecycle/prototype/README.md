# Aegis — prototype : comparaison A/B et jeu du cahier (traitement A)

Mode : Prototype. Date : 23 septembre 2026.

**Sélection (23 septembre 2026, décision humaine consignée dans
`../sections.md` et `../direction-validee.md`) :** traitement **A — Verre
lumineux** pour iOS et pour le Web.

- **Trace :** le traitement B et les rendus sombres des pivots restent comme
  trace de la comparaison. Rien n'est supprimé.
- **Contrat :** les illustrations sont alignées sur `09` v1.3 (voir
  « Alignement sur `09` v1.3 »). Les propositions restantes (reste de C4,
  C5 à C8) ne sont pas ratifiées.
- **Non validés :** les tokens définitifs et la police Web.

Contenu :

1. **Trace de comparaison :** 8 rendus pivots (iOS catalogue, Web
   équipements; A et B; clair et sombre) et deux planches A/B.
2. **Jeu du cahier (A, clair seulement) :** iOS 03, 05 et 06; Web 03 et 04;
   deux planches. Les pivots A clair (iOS 02, Web 02) y sont réutilisés. Ce
   sont des illustrations, pas une couverture complète ni une spécification
   prête à implémenter. Texte pour le cahier : `../jeu-cahier.md`.

Le programme de 40 écrans reste annulé; voir « Hors périmètre ».

## Arborescence

```text
prototype/
  index.html                 hub : planches et écrans du jeu, puis trace A/B
  cahier.html                planches du cahier (?sheet=ios|web)
  compare.html               planche A/B des pivots (?platform=ios|web)
  tokens/brand.css           sémantique de marque partagée, clair/sombre
  tokens/scales.css          échelles par plateforme × traitement
  components/base.css        verre, statut, raison, marqueur fictif, boutons, faits, focus
  components/ios.css         chrome iOS, recherche, puces, segmenté, cartes, liste groupée, barre d'onglets
  components/web.css         shell, barre latérale, barre supérieure, onglets, liste, table, inspecteur, champs
  data/fixture.js            source unique des données, champs étiquetés
  data/screens.js            manifeste des écrans, viewports, légende des marqueurs
  lib/aegis.js               runtime : paramètres, formats fr-CA, textes, statuts, icônes, composants
  screens/ios/02-catalogue.html            pivot A/B, clair/sombre
  screens/ios/03-detail-reserver.html      jeu A clair
  screens/ios/05-retrait-scanner.html      jeu A clair
  screens/ios/06-pret-actif.html           jeu A clair
  screens/web/02-equipements.html          pivot A/B, clair/sombre
  screens/web/03-reservations-prets.html   jeu A clair
  screens/web/04-anomalie.html             jeu A clair
  tools/render.py            rendu Chrome headless
  tools/contrast.py          contraste WCAG (tokens + fonds rendus)
  tools/fonts.mjs            polices réellement rendues (DevTools)
  renders/{ios,web}/{a,b}/{light,dark}/NN-slug.png   (jeu : a/light seulement)
  renders/compare/{ios,web}.png
  renders/cahier/{ios-parcours-technicien,web-administration}.png
```

## Rendre et vérifier

```bash
cd docs/design/asset-lifecycle/prototype
python3 tools/render.py                                   # pivots (A/B × clair/sombre) + jeu (A clair)
python3 tools/render.py --cahier                          # planches du cahier
python3 tools/render.py --screen ios-02 --treatment a --theme dark
python3 tools/render.py --compare                         # planches (après les pivots)
python3 tools/render.py --screen web-02 --query transparency=reduce --out-dir /tmp/aegis-reduce
python3 tools/contrast.py                                 # code 1 si un contraste échoue
node tools/fonts.mjs                                      # polices rendues, par écran et traitement
node tools/check.mjs                                      # syntaxe JS, chronologie (09 v1.3), aucun instant futur affiché
python3 tools/check_files.py                              # références locales, espaces, dimensions des PNG
```

- **iOS :** 393 × 852 pt (iPhone 16), rendu à 2×, soit 786 × 1704 px.
- **Web :** 1440 × 900 px, rendu à 1×, identique pour tous les écrans Web.
- **Moteur :** Chrome 153 local (`/Applications/Google Chrome.app`, surcharge
  possible avec `CHROME=`). Aucun accès réseau.
- **Nommage :** `renders/<plateforme>/<traitement>/<thème>/<NN>-<slug>.png`.
- **Paramètres d'URL :** `?treatment=a|b&theme=light|dark[&transparency=reduce]`.
  Le thème est un attribut explicite (`data-theme`), pas
  `prefers-color-scheme`, pour des rendus déterministes.

## Fondation (API pour la passe suivante)

### Tokens

`brand.css` contient les rôles partagés, avec un bloc par thème :

- **Surfaces :** `--ag-canvas`, `--ag-surface`, `--ag-surface-raised`,
  `--ag-surface-sunken`, `--ag-surface-selected`.
- **Texte :** `--ag-text`, `--ag-text-2`, `--ag-text-3`,
  `--ag-text-on-accent`, `--ag-text-disabled`.
- **Bordures :** `--ag-border`, `--ag-border-strong`, `--ag-separator`,
  `--ag-control-border`.
- **Accent :** `--ag-accent`, `--ag-accent-text`, `--ag-accent-soft`,
  `--ag-focus`.
- **Verre :** `--ag-glass-bg`, `--ag-glass-bg-strong`, `--ag-glass-border`,
  `--ag-glass-fallback` (repli opaque).
- **Statut :** `--ag-{ready,blocked,unknown,mine,neutral,progress}-{fg,bg,icon}`,
  `--ag-glyph`.
- **Marqueur fictif :** `--ag-mock-{fg,bg,border}`.
- **Profondeur :** `--ag-glow-1..3`, `--ag-shadow-color`, `--ag-inset-hi`.
- **Mouvement :** `--ag-motion-*`.

`scales.css` contient les rôles `--t-*`, pilotés par `data-platform` ×
`data-treatment` :

- **Typographie :** `--t-font-{display,text,mono}`,
  `--t-title-{lg,md,sm}-{size,track,weight}`, `--t-body-size`, `--t-sub-size`,
  `--t-caption-size`, `--t-label-{size,weight}`, `--t-id-{font,size}`.
- **Rayons :** `--t-r-{sheet,panel,card,control,chip,small}`.
- **Densité :** `--t-row-h`, `--t-cell-pad-x`, `--t-control-h`, `--t-gutter`.
- **Profondeur :** `--t-shadow-*`, `--t-glass-{blur,sat}`.

Un écran n'écrit jamais une taille ou une couleur en dur : il compose ces
rôles.

### Composants

Chaque composant existe comme fonction de `lib/aegis.js` (HTML) et comme
classe CSS.

| Fonction | Classe | Usage |
|---|---|---|
| `AG.c.status(kind, label, {size, variant, icon})` / `AG.c.statusOf(p)` | `.ag-status--{kind}` | Symbole, forme et texte. `kind` ∈ `ready`, `blocked`, `unknown`, `mine`, `neutral`, `available`, `overdue`, `sev-*`, `progress`, `success`, `failed`, `expired`, `online`, `offline`. `variant` : `pill` ou `plain`. |
| `AG.c.reason(text, {more, action})` | `.ag-reason` | Raison principale, « + N autres raisons », suite actionnable. |
| `AG.c.mock(ref)` | `.ag-mock` | Marqueur de donnée fictive : `C4`…`C8`, `F` ou `SIM` (C1 à C3 sont normatifs et n'ont plus de marqueur). |
| `AG.c.btn(label, {variant, size, icon, disabled})` | `.ag-btn--*` | Variantes `primary`, `secondary`, `tertiary`, `destructive`. |
| `AG.c.fact(label, html, {mock, wide})` | `.ag-fact` | Paire libellé/valeur, dans un `dl.ag-facts`. |
| `AG.c.wordmark(sub)` | `.ag-wordmark` | Mot-symbole texte « Aegis », provisoire (aucun logo proposé). |
| `AG.ios.statusBar(iso)`, `tabBar(active)`, `toolbarButton(icon, label)`, `homeIndicator()` | `.ios-*` | Chrome iOS. Barre d'onglets Équipements, Mon activité, Compte. |
| `AG.web.sidebar(active, view)`, `lockerChip(view)` | `.web-*` | Barre latérale aux six sections dans l'ordre approuvé, libellé d'institution C6, compte. |
| — | `.web-table`, `.web-list`/`.web-item`, `.web-inspector`, `.web-field`, `.web-tabs` | Table dense, liste maîtresse, inspecteur et champs. |
| — | `.ag-glass`, `.ag-decor`, `.is-focus` | Couche de verre avec replis opaques, décor masqué en transparence réduite, anneau de focus rendu statiquement. |
| `AG.ios.sheet(html, {title, leading, trailing})` | `.ios-sheet`, `.ios-dim`, `.ios-inset`, `.ios-timepill` | Feuille flottante avec poignée. Surface opaque pour les formulaires; voile allégé (le contexte et la barre d'état restent lisibles). Position par `style.top`. |
| `AG.c.countdown(s, total)` | `.ag-countdown` | Anneau et « Expire dans 0:47 », chiffres tabulaires. |
| `AG.c.chrono(items)` | `.ag-chrono__row--{done,success,anomaly,pending}` | Chronologie en lecture seule. |
| `AG.c.evidence(items)` | `.ag-evidence`, `.is-key` | Observations normalisées, sans message brut. |
| `AG.c.scanner()` | `.ag-scanner` | Viseur de caméra, **toujours en simulation** : motif décoratif sans repère QR et sans jeton. |
| `AG.c.dialog({title, body, actions})` | `.ag-dialog` | Dialogue modal sur surface opaque. |
| — | `.ag-callout`, `.web-linkcard`, `.web-dossier-*`, `.web-textarea` | Rappel permanent, lien vers un objet lié, en-tête de dossier, zone de note. |

Le manifeste accepte `treatments` et `themes` par écran : le jeu est limité
à `a` et `light`.

Correspondance domaine → présentation :

- `AG.status.technician(asset, view)` : `sections.md` §1.2. Un actif
  `BORROWED` n'est jamais affiché « Prêt ».
- `AG.status.operationalDiagnostic(asset)` : `AdminAssetView.operationalDiagnostic`
  (`09` §8.9). L'affichage dérive seulement de `reasons` : liste vide →
  « Aucun empêchement détecté » (neutre, symbole d'information, jamais vert
  ni coché); sinon « N empêchement(s) » et les raisons en français. Jamais
  « Prêt », « Bloqué » ni « Aucun blocage »; aucune autorisation calculée.
- `AG.status.availabilityAdmin(asset, view)` : disponibilité côté
  administration.
- `AG.copy.*` : textes de `sections.md` §1.2–1.4 et §5, `reasonShort` pour
  les cellules denses.
- `AG.fmt.*` : dates et heures fr-CA dans America/Toronto, avec espaces
  insécables (« 10 h 30 », « 8 sept. 2026 », « 1er déc. 2026 »).

### Fixture

`data/fixture.js` est la seule source de données des écrans.

- **Entités :** `locker`, `schedule`, `institutionLabel`, `users`, `models`,
  `assets`, `reservation`, `currentWindow`, `checkoutOperation`, `loan`,
  `anomaly`, `observations`.
- **Moments :** `moments` (10:29 → 11:21).
- **États dérivés :** `snapshots[moment]`, qui donnent readiness,
  disponibilité, statuts, `operationalDiagnostic` et `currentOperationId` à
  chaque moment.
- **Étiquettes :** chaque objet porte une carte `$src`.
  - `N:<§>` : valeur normative;
  - `N~:<§>` : règle normative appliquée à un instant choisi;
  - `C4`…`C8` : champ ou valeur non exposé par `09` v1.3 (proposition
    restante), affiché avec le marqueur;
  - `F:<raison>` : hypothèse de la fixture.

`AG.at("10:30")` fusionne entités et instantané.

**Limite de `AG.at` (relevée par la revue du 23 septembre) :** la fusion
reprend les entités statiques complètes dans chaque instantané. Des champs
peuvent donc porter un instant postérieur au moment, par exemple
`reservation.fulfilledAt` (10 h 42) à 10 h 32 ou `authorizedAt` à 10 h 39.
Les écrans n'affichent que des faits accomplis à leur moment et des
échéances (`reservedUntil`, `closesAt`, `localProofExpiresAt`).
`tools/check.mjs` le vérifie sur le texte rendu. La sémantique de fusion est
volontairement inchangée : ces fixtures ne sont pas des réponses d'API
réutilisables en test d'intégration.

Pour ajouter un écran :

1. Ajoutez sa ligne au manifeste `data/screens.js` (`status: "built"`).
2. Créez `screens/<plateforme>/<NN>-<slug>.html` en copiant l'en-tête d'un
   écran existant.
3. Lisez `AG.at(<moment>)` et composez `composeA()` et `composeB()`.
4. Ajoutez toute donnée manquante à la fixture, avec son étiquette, et jamais
   dans l'écran.

Le rendu, l'index et la planche suivent automatiquement.

## Traitements

| | A — Verre lumineux | B — Opérationnel précis |
|---|---|---|
| Composition iOS | Cartes généreuses (rayon 28), puces de filtre à symbole, dégradé bleu→blanc ou nuit→indigo derrière le titre seulement | Liste groupée native (rayon 14), contrôle segmenté, fond plat |
| Composition Web | Shell flottant sur fond à profondeur optique; barre latérale en verre détachée; liste maîtresse et dossier large | Shell ancré, barre latérale et barre supérieure sobres; table dense et inspecteur ancré de 384 px |
| Typographie | Grands titres serrés : iOS 40 pt à −0,035 em, Web 34 px; identifiants en proportionnel tabulaire | Tailles système : iOS 34 pt, Web 22 px; identifiants en monospace |
| Densité | Rangée Web de 84 px, marges de 20 pt sur iOS | Rangée de table de 52 px, marges de 16 pt, contrôles de 32 px |
| Rayons | 28 / 22 / capsule | 14 / 12 / 8 sur iOS; 10 / 6 / 5 sur Web |
| Profondeur | Ombres teintées, reflet intérieur, verre sur le chrome, bouton principal en dégradé bleu→indigo | Surfaces plates superposées, bordures fines, verre limité à la barre d'onglets, à la barre latérale et à la barre supérieure |

**H1 (place du statut) :**

- **A :** le statut ouvre la carte ou la rangée, au-dessus de l'identité, qui
  reste en grand.
- **B :** l'identité ouvre la rangée, avec le code et le modèle dans les
  premières colonnes; le statut suit en fin de ligne ou dans les colonnes
  suivantes; sur iOS, la raison occupe une ligne pleine largeur.

**H2 (composition Web, section Équipements) :**

- **A :** liste maîtresse à deux lignes et dossier large dominant, en deux
  colonnes (faits dérivés, réglages).
- **B :** table à colonnes dans l'ordre de §5.2 et inspecteur ancré en
  sections.

Les deux traitements partagent la même sémantique : libellés, symboles,
tokens de couleur, marqueur fictif et mot-symbole.

## Marqueurs de données fictives

Un seul schéma, identique dans A et B : une étiquette « Fictif · Cx » au
trait tireté magenta avec un losange, placée juste après la donnée. La
légende figure dans `compare.html`. Le magenta est hors palette de marque et
de statut, pour ne jamais se lire comme un statut produit.

| Écran | Donnée | Marqueur |
|---|---|---|
| Web 02 | Diagnostic opérationnel (`AdminAssetView`, `09` §8.9) | — (normatif) |
| Web 02 | Identifiant RFID | Non affiché : absent de `AdminAssetView`, aucune route de lecture |
| Web 02, 03, 04 | « Laboratoire de démonstration » dans la barre latérale | Fictif · C6 |
| iOS 02 | Aucune : tout vient de `GET /assets` (`09` §11.1) | — |
| iOS 03 | Heure de fermeture 17 h 00 (`currentWindow`, `09` §8.6) | — (normatif) |
| iOS 05 | Viseur et code du scanner (aucun jeton) | Simulation |
| iOS 06 | Aucune | — |
| Web 03, Web 04 | Nom du titulaire « Technicien Démo » : illustratif, non exposé par `LoanView` (`holderUserId` seulement) | Fictif · C4 |
| Web 04 | Forme des preuves normalisées (non définie par `09` §18.1) | Fictif |

Les hypothèses de valeur dans un champ défini par `09` restent étiquetées
dans la fixture, sans marqueur à l'écran : code `MM-002`, modèle Fluke 117 de
MM-002, date d'échéance du 8 sept. 2026, nom « Administrateur Démo ».

## Données, chronologie et anomalie

Les instants de la fixture couvrent tout le parcours. Sont rendus :
10 h 30 (iOS 02, Web 02), 10 h 31 (iOS 03), 10 h 39 min 50 s (iOS 05),
10 h 43 (iOS 06) et 11 h 20 (Web 03, Web 04). Mercredi 16 septembre 2026,
America/Toronto (HAE, UTC−4) :

- **Casier :** `AEGIS-DEMO-01`, cellules A1 et A2; horaire lun.–ven.
  9 h – 17 h (`09` §13.2).
- **10 h 30 :** MM-001 (Fluke 117, calibration valide jusqu'au 1er déc.
  2026) est Prêt; MM-002 est Bloqué, calibration expirée (`02` §10.1).
  `evaluatedAt` est 14:30Z (`09` §8.2).
- **Réservation :** créée à 10 h 31 min 40 s; `reservedUntil` 16 h 30, soit
  20:30Z (`09` §14.1). La fermeture à 17 h vient de
  `LockerStatusView.currentWindow` (`09` §8.6) : `open=true`,
  `closesAt` 21:00Z, `nextOpensAt` null.
- **Retrait :** préparation à 10 h 39 min 37 s; code affiché 2 s plus tard;
  défi de 60 s depuis sa création (`09` §15.5), d'où « Expire dans 0:47 » à
  10 h 39 min 50 s; autorisation à 10 h 40 min 05 s; `expiresAt` +120 s;
  `CONFIRMED` à 10 h 42.
- **Prêt :** `ACTIVE`; `dueAt` = `reservedUntil` = 16 h 30, règle normative
  (`03` §4.13, `04`, `05` §8).
- **Identifiants :** ceux de `09` §15.1 et §14.1 sont réutilisés. Les heures
  d'exemple de `09` §15.1 et `10` §10.1 (14:31–14:32Z) sont illustratives et
  incompatibles avec ce parcours; elles sont décalées.
- **Anomalie :** `ASSET_PRESENT_WITH_ACTIVE_LOAN` sur A1/MM-001, détectée à
  11 h 04 min 18 s (`03` §5.11; `06` §12.4; `08`, type distinct).
  - Déclencheur : une lecture RFID saine hors opération (`10` §20 : un
    événement hors opération est permis, `operationId` absent) voit le tag
    de MM-001 alors que le prêt est actif.
  - Effet : le prêt reste `ACTIVE` et l'actif `BORROWED`.
  - Hypothèses de la fixture : gravité `MEDIUM`, libellé du résumé.
  - Note de reconnaissance : exemple de `09` §18.2.
  - `INCONSISTENT_PHYSICAL_STATE` sur A2 a été écarté : `05` §5.4 ne le
    définit qu'à l'intérieur d'une opération, en `OBSERVATION_RECEIVED`.
- **Administrateur :** aucun compte de démonstration n'est défini (`02`
  §10.1 dit seulement qu'il est préparé). « Administrateur Démo »,
  admin@aegis.demo, est une hypothèse de la fixture.

**Diagnostic administrateur (`09` v1.3 §8.9) :** Web 02 affiche le
« Diagnostic opérationnel », avec l'explication suivante : « Empêchements non
personnels connus (disponibilité, état de service, calibration, présence),
évalués à 10 h 30. Une liste vide ne donne ni droit d'emprunt ni possibilité
d'ouvrir le casier. » Le libellé du cas vide, « Aucun empêchement détecté »,
reste à valider. L'ancien libellé « Aucun blocage » et le « technicien
habilité » de référence sont abandonnés.

## Polices

`node tools/fonts.mjs` relève les polices rendues. Aucune n'est une police
Web (`isCustomFont=false`) : aucun fichier de police, aucun chargement
réseau.

| Rendu | Source | Usage |
|---|---|---|
| SF Pro Text (Regular, Medium, Semibold, Bold) | `/Library/Fonts/SF-Pro-Text-*.otf`, téléchargement développeur Apple installé localement | Texte courant, libellés |
| SF Pro Display Bold | `/Library/Fonts/SF-Pro-Display-*.otf` | Grands titres, mot-symbole |
| Menlo (Regular, Bold) | macOS, `/System/Library/Fonts/Menlo.ttc` | Identifiants monospaces (B, valeurs RFID) |

Écart constaté : Chrome ignore `ui-monospace` et ne voit pas SF Mono par son
nom; Menlo s'affiche donc à la place de SF Mono.

**Licences, à confirmer sur les textes officiels avant implémentation :**

- **iOS :** la police système (SF Pro, SF Mono via `.monospaced()`) est
  fournie par l'OS; aucun enjeu de licence dans l'app.
- **SF Pro sur le Web :** la licence Apple des polices SF limite leur usage
  aux interfaces des plateformes Apple. Elle ne permet pas de les héberger
  comme police Web d'une console publique.
- **Menlo :** livrée avec macOS, non redistribuable. Elle dérive de
  Bitstream Vera et DejaVu Sans Mono, qui sont libres.
- **Options Web :**
  - une pile système sans fichier distribué, dont le rendu varie selon l'OS;
  - une famille libre auto-hébergée, par exemple Inter (OFL) pour A, ou
    IBM Plex Sans et Plex Mono (OFL) pour B.

  Aucune de ces familles libres n'est installée localement; elles n'ont donc
  pas été rendues. Une comparaison sur le même texte français reste à faire
  (`../sections.md` §11).
- **Référence 4 :** sa police n'est pas identifiée.

## Accessibilité vérifiée

- **Contraste :** `python3 tools/contrast.py` → ALL PASS.
  - 53 paires de tokens × 2 thèmes. Minimum texte : 4,91:1 (placeholder
    iOS B, clair). Minimum UI : 3,38:1 (piste d'interrupteur, sombre).
    Bordure de champ : 3,74:1 en clair et 3,52:1 en sombre (WCAG 1.4.11).
  - 36 échantillons de fonds réellement rendus : dégradé du titre A, horloge,
    barre d'onglets en verre, barre latérale en verre, barre supérieure B.
  - Le bouton désactivé est exempté mais reste lisible : 3,73:1 et 4,83:1.
- **Couleur :** chaque statut a un symbole de forme distincte (cercle coché,
  octogone, losange, carré) et un texte.
- **Focus :** l'anneau de focus clavier est montré sur la rangée
  sélectionnée (Web), 5,40:1 sur fond sélectionné.
- **Transparence réduite :** `prefers-reduced-transparency` ou
  `?transparency=reduce` rendent le verre opaque (`--ag-glass-fallback`) et
  masquent le décor. Même repli pour `@supports not (backdrop-filter)`.
  Vérifié par rendu (iOS A clair, Web A sombre).
- **Mouvement réduit :** `prefers-reduced-motion` ramène les transitions à
  0 ms. Aucun état n'est porté par le mouvement.

## Journal d'inspection (constat → correction)

Tous les rendus ont été vus un par un à leur taille d'usage, puis refaits
après chaque correction.

1. Chrome headless écrit le PNG sans se terminer → `render.py` attend un
   fichier stable, puis arrête le processus.
2. iOS A : la puce « À vérifier » passait à la ligne et était coupée au bord
   droit → puces compactées et `nowrap`. La marge droite (12 pt) différait
   de la gauche (20 pt) → padding de 11 px.
3. iOS A : la note « État évalué à 10 h 30 » passait sous la barre
   d'onglets → rythme vertical resserré.
4. iOS A et B : la date se coupait avant « 2026 » → espaces insécables dans
   les formats de date et d'heure.
5. iOS A sombre : le reflet intérieur des cartes était trop lumineux → token
   thématique `--ag-inset-hi`.
6. iOS B : « Tirez pour actualiser » passait inutilement à la ligne → texte
   retiré (le comportement reste).
7. Web A et B : le nom de l'administrateur chevauchait le bouton du menu →
   retour à la ligne, bouton de taille fixe.
8. Web A : l'aide du champ de date était coupée par le pied collant → aide
   raccourcie, espacement resserré.
9. Web B : la table débordait sur l'inspecteur (« Cellule » coupée) et la
   calibration tenait sur 3 lignes rognées → colonnes rééquilibrées,
   inspecteur de 384 px, calibration sur deux lignes (état, date).
10. Web B : l'en-tête abrégeait « tech. habilité » → libellé complet sur
    deux niveaux (historique : remplacé par « Diagnostic opérationnel » lors
    de l'alignement sur `09` v1.3).
11. Web B : « Prése… » était tronqué → colonne unique « Présence ·
    cellule ».
12. Web B : le pied de l'inspecteur passait sur 3 lignes → lien Historique
    déplacé dans sa propre section.
13. Web B : la raison de la cellule était codée en dur → table
    `copy.reasonShort`.
14. Bordures de champ sous 3:1 → token `--ag-control-border`.
15. Un échantillon de contraste tombait sur les glyphes → point déplacé dans
    la marge.
16. Planches : titres de groupe et légendes passaient à la ligne; notes Web
    rognées → `nowrap`, hauteur de rendu augmentée.
17. Rapport de polices : Menlo au lieu de SF Mono → documenté (Polices).

## Limites

- **Rendu :** images statiques de Chrome (moteur Blink), et non UIKit ou
  SwiftUI. La barre d'onglets et les boutons imitent le style Liquid Glass
  avec `backdrop-filter`; l'effet est rendu par Chrome headless (flou visible
  sur les rendus), mais la réfraction et la dynamique de Liquid Glass ne sont
  pas reproduites. Les icônes sont des substituts SVG aux SF Symbols.
- **Horloge :** la barre d'état affiche 10:30, un élément système cohérent
  avec le moment; le moment n'apparaît dans aucun élément du produit.
- **Ce qu'une maquette statique ne prouve pas :** l'ordre et les annonces de
  VoiceOver, Dynamic Type jusqu'aux tailles d'accessibilité, l'augmentation
  du contraste, la navigation clavier réelle (l'anneau de focus est dessiné,
  pas exercé), le zoom Web à 200 %, les états défavorables (chargement,
  erreur, hors ligne, vide), et les performances de flou sur appareil.
- **Jeu du cahier :** thème clair seulement, par choix; la preuve
  clair/sombre repose sur les pivots.
- **Données :** deux actifs seulement, conformes à la démonstration. La
  densité de A n'est pas éprouvée sur un parc plus grand.
- **Polices :** seules les polices Apple locales ont été rendues. Aucune
  famille Web licenciable n'a été comparée.

## Jeu du cahier (traitement A, clair)

| Écran | Moment | Rendu |
|---|---|---|
| iOS 03 — Détail de MM-001 et feuille « Réserver » | 10 h 31 | `renders/ios/a/light/03-detail-reserver.png` |
| iOS 05 — Retrait guidé, code affiché, scanner (simulation) | 10 h 39 min 50 s | `renders/ios/a/light/05-retrait-scanner.png` |
| iOS 06 — Mon activité, prêt actif | 10 h 43 | `renders/ios/a/light/06-pret-actif.png` |
| Web 03 — Réservations et prêts, onglet Prêts | 11 h 20 | `renders/web/a/light/03-reservations-prets.png` |
| Web 04 — Dossier d'anomalie, dialogue « Reconnaître » | 11 h 20 | `renders/web/a/light/04-anomalie.png` |

Web 03 et Web 04 sont au **même instant** (11 h 20) et forment un seul état
simultané. La clé `11:21` de la fixture n'est plus utilisée.

**Adaptation de figure (Web 04) :** le dialogue est ancré au-dessus de la
liste, avec un voile allégé, pour garder lisibles les preuves et le rappel
permanent. Une implémentation peut le centrer. Le texte derrière le voile
reste au-dessus de 4,5:1 (échantillons mesurés).

### Journal d'inspection du jeu (constat → correction)

Chaque rendu du jeu et les deux planches ont été vus un par un à leur
taille d'usage, puis refaits après chaque correction.

1. iOS 03 : le bouton « Confirmer la réservation » était écrasé par le
   débordement de la feuille → libellé « Équipement » redondant retiré,
   enfants de la feuille non compressibles, feuille remontée. Double espace
   dans « Multimètre 1 · MM-001 » corrigé.
2. iOS 05 : le titre obligatoire « Scannez le code affiché sur le casier »
   passait sur deux lignes à côté du bouton de fermeture → titre déplacé en
   tête du contenu, bouton de fermeture à droite.
3. iOS 05 : l'étiquette « Simulation » du viseur était rognée → cadre
   ancré en haut du viseur.
4. iOS 06 : « après la fermeture de la porte » décrivait mal la preuve
   (porte fermée et absence RFID) → « à partir des observations du
   casier ».
5. Web 03 : la chronologie était coupée après 6 étapes sur 8, la carte
   d'anomalie rognée et les faits passaient à la ligne mot par mot → liste
   plus étroite, statut dans le surtitre, 4 faits, détails sur une ligne,
   carte verticale, pied raccourci. Deux retours à la ligne corrigés ensuite
   (méta de la carte d'anomalie, pied de liste).
6. Web 04 : le dialogue centré masquait les preuves et le rappel permanent
   → dialogue ancré au-dessus de la liste, voile allégé.
7. Web 04 : un retour à la ligne tombait avant « : » → espace insécable.
8. iOS 03 et 05 : l'horloge de la barre d'état sous le voile mesurait
   4,06:1 → voile iOS allégé (rgba 0,22), 5,02:1.
9. Planche iOS : les téléphones étaient décalés selon la longueur des
   titres (2 ou 3 lignes) → en-têtes d'étape de hauteur fixe; « Étape 1 et
   4 » corrigé en « Étapes 1 et 4 ».
10. Planche Web : la légende était rognée → hauteur de rendu augmentée.

`tools/contrast.py` passe (ALL PASS), avec 8 nouveaux échantillons de fonds
rendus : textes derrière les voiles, légende sur teinte.

## Alignement sur `09` v1.3 (23 septembre 2026)

**Trois niveaux :**

1. **Besoins approuvés le 23 septembre :** P1, C1 à C8, §7.1.
2. **Champs devenus normatifs :**
   - P1 (§11.1);
   - C1 sous la forme `AdminAssetView.operationalDiagnostic {evaluatedAt,
     reasons}` (§8.9, §12.2), sans résultat, sans technicien de référence,
     jamais `ACCESS_DENIED`;
   - C2 `LockerStatusView.currentWindow {timeZone, open, closesAt,
     nextOpensAt}` (§8.6);
   - C3 `currentOperationId` (§8.3–8.4, §15.4);
   - C4 en partie : `AssetSummary {id, assetCode, model, placement}` et
     `UserSummary {id, displayName}` (§8.8); `AnomalyView.acknowledgedBy` est
     un `UserSummary`.
3. **Propositions restantes :** le nom du titulaire dans `LoanView` et
   `ReservationView` (qui ne portent que `holderUserId` / `userId`), C5 à C8,
   §7.1, et la forme détaillée des preuves.

**C3, reprise :**

- `currentOperationId` désigne la dernière tentative de retrait d'une
  réservation `ACTIVE`, ou la dernière tentative de retour d'un prêt
  `ACTIVE` ou `RETURN_PENDING`.
- Elle peut être terminale tant que la ressource parente est ouverte, pour
  expliquer un échec ou une anomalie.
- Une tentative non terminale est prioritaire; la référence vaut `null` sans
  tentative ou quand le parent est clos.
- `returnOperationId` désigne seulement le retour confirmé.
- Reprendre, c'est relire, jamais redéclencher.

**Changements d'illustration :**

- Web 02, A et B :
  - « Diagnostic opérationnel » dérivé de `reasons`;
  - explication ajoutée;
  - marqueurs C1 retirés;
  - identifiant RFID remplacé par le numéro de série (`serialNumber`, §8.9,
    non renseigné dans la fixture).
- iOS 03 : fermeture 17 h 00 sans marqueur (`currentWindow`).
- Fixture :
  - `currentWindow.nextOpensAt` passe à null;
  - `operationalDiagnostic` remplace `adminDiagnostic`;
  - `currentOperationId` est ajouté par instantané.
- Planches et légendes mises à jour; comparaisons A/B étiquetées comme
  historiques.

### Journal d'inspection de l'alignement (constat → correction)

1. Web 02 B : « Aucun empêchement détecté » était tronqué dans la cellule
   de table (libellé non sécable) → retour à la ligne permis dans les
   cellules à deux lignes.
2. Planche Web : la légende, plus longue, était rognée en bas → hauteur de
   rendu portée à 1600 px.

## Hors périmètre (conservé)

- `data/fixture.js` : la clé de moment `11:21` n'est plus utilisée.
  L'instantané `11:20` sert à Web 03 et Web 04.
- `data/screens.js` : 3 entrées `deferred` (iOS 01 Connexion, iOS 04 Mon
  activité avec réservation, Web 01 Vue d'ensemble), ni construites ni
  liées. Voir la liste des écrans restants dans `../jeu-cahier.md`.
