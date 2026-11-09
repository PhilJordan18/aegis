# Landing publique Aegis — brief (issue #153)

Mode : **Discovery, puis Prototype** (skill `aegis-product-design`). Date : 9 novembre 2026.
Plateforme : Web, route publique `/` d'Aegis Manager. Branche : `153-feat-public-landing`
depuis `origin/dev` `023ab51`. Aucun code applicatif n'est modifié à ce stade.

Ce dossier est possédé par la session Claude Cloud Web de l'issue #153. Les fichiers
d'hébergement de #151 / PR #152 (`apps/admin-web/Dockerfile`, `.dockerignore`,
`deploy/`, `scripts/check-hosting*.py`, la section « Hébergement staging » du
`README.md` Web, `docs/journal/2026-11-09-web-staging.md`) ne sont pas touchés.

## 1. Mandat

Une page promotionnelle publique à `/` pour Aegis Manager, marque **Aegis**, signée
**Aegis Studio** (Philippe et Jimmy). Elle explique la disponibilité opérationnelle
(readiness), la traçabilité (chaîne de possession) et la relation entre Manager,
l'application technicien et le casier physique (hub et deux cellules). Elle conserve
la route de connexion, les routes protégées et les liens profonds.

Classification : **amélioration de présentation demandée explicitement**, hors
capacité métier P0, sans substitution à la recette staging. Le mouvement avancé
reste de la présentation (scope §12 : « amélioration avancée des interfaces et
animations » est P1; la demande du 9 novembre 2026 l'autorise ici sans élargir le
périmètre fonctionnel).

## 2. Utilisateur, contexte, tâche

| Élément | Contenu |
|---|---|
| Visiteurs | 1. Administrateur connu qui vient se connecter (tâche : atteindre `/connexion` en un geste). 2. Évaluateur ou invité (enseignant, jury, partenaire) qui découvre le produit. 3. Technicien arrivé par erreur (à renvoyer vers Aegis Mobile). |
| Contexte | Bureau et mobile; démonstration projetée en classe ou en laboratoire; lecture possible sur téléphone pendant la présentation. |
| Tâche dominante | Comprendre en moins d'une minute ce qu'Aegis garantit et comment le casier, le téléphone et le Manager se répondent, puis se connecter. |
| Information qui doit dominer | La signature « Prêt. Autorisé. Prouvé. », le casier réel (hub, A1, A2), le parcours retrait et retour, et l'action « Se connecter ». |
| Ce qui n'y a pas sa place | Métriques inventées, témoignages, fiabilité industrielle, budgets, coûts internes, gestion de projet, copie obsolète du cahier HTML, « CORE ». |

## 3. État actuel (audit du code intégré, `dev` `023ab51`)

### 3.1 Accueil existant

`apps/admin-web/src/pages/LandingPage.tsx` et `landing.css` : en-tête (marque,
choix de langue, bouton « Se connecter »), héros typographique (`BrandPromise`
en `h1`, action principale, lien d'ancre `#garanties`, mention du compte), figure
« Diagnostic d'un exemplaire » marquée **Exemple illustratif** (MM-002 bloqué,
MM-001 sans empêchement), cinq garanties numérotées, pied de page. Captures de
référence : `../manager-v3/captures-integration/landing-default-*.png`.

Critique au regard du mandat (hiérarchie, composition, contenu, caractère) :

- **Flux** : un seul écran, une seule ancre; aucune navigation de sections, aucun
  récit du parcours physique, aucune mention du casier ni d'Aegis Mobile hors du
  pied de page. Le visiteur ne voit pas la relation Manager / mobile / casier.
- **Hiérarchie** : la figure d'exemple, pourtant « illustrative », pèse autant que
  la signature; les cinq garanties sont un bandeau de cartes égal, sans ordre de
  lecture.
- **Contenu** : la copie est juste et traçable (table des affirmations §5), mais
  parle au Manager, pas au produit : « Compte fourni par votre administrateur »
  précède toute explication.
- **Caractère** : conforme à l'identité v3, sobre, mais sans élément mémorable
  propre à Aegis au-delà de la typographie; aucune présence du matériel.
- **Technique** : `landing.css` et `sign-in.css` sont les deux seuls fichiers
  autorisés à porter un `radial-gradient` (`src/styles/identity.test.ts`).

### 3.2 Routage et session (à préserver tels quels)

- `src/app/routes.ts` : `/` `landing`, `/connexion` `signIn`, `/equipements` et
  `/casiers` protégés, `/apercu/equipements` en aperçu seulement, sinon introuvable.
  Les chemins restent français dans les deux langues.
- `src/app/router.ts` : routeur History minimal; `navigate()` conserve le `hash`
  de l'URL, mais ne fait pas défiler vers une ancre : les ancres de sections
  devront être des `<a href="#…">` natifs (non interceptés) ou un défilement
  explicite.
- `src/app/RequireAdminSession.tsx` : sans session administrateur, remplacement
  par `/connexion` avec la raison d'arrivée (expiration, 401, déconnexion).
  La landing n'interagit pas avec ce garde.
- `SignInPage` : lien « Accueil » vers `/`; après connexion, `/equipements`.
  `NotFoundPage` : bouton « Retour à l'accueil ».
- Titre de document par route et langue (`pageTitle.landing` = « Aegis Manager »).
  Au premier chargement, aucun déplacement de focus; après navigation, focus sur
  le `h1` (`PageHeading`).

### 3.3 Identité et contraintes de production

- Jetons : `src/styles/tokens.css` (clair minéral, sombre profond, rôles de statut,
  mouvement 120 / 200 / 240 ms, rayons, Geist et Geist Mono autohébergées).
- `src/styles/identity.test.ts` interdit dans toute source de production
  (`src/**/*.{css,ts,tsx}` hors `preview/` et `assets/`) : `backdrop-filter`,
  les classes ou jetons `ag-cell*`, `ag-glass`, `ag-atmos`, `ag-decor`, le mot
  « indigo », les anciennes valeurs bleu-indigo, tout `linear-gradient` ou
  `conic-gradient` hors l'ombre de défilement du dossier, et **les mots `hub`,
  `orbit`, `lit-cell`, `is-lit`**. Le `radial-gradient` n'est admis que dans
  `sign-in.css` et `pages/landing.css`, liste exacte.
- `docs/design/identite/reference.md` (décision de Philippe du 21 octobre 2026) :
  « Sur les écrans d'entrée des applications : ni hub, ni cellules, ni illustration
  3D, ni anneaux décoratifs. »
- Tests existants qui couvrent `/` : `App.test.tsx`, `App.i18n.test.tsx`,
  `routes.test.ts`, `catalog.test.ts`, `format.test.ts`, `Brand.test.tsx`;
  Playwright `entry.spec.ts` et `language.spec.ts` (matrice 5 tailles × thèmes,
  axe WCAG A/AA, aucun défilement horizontal, un seul `h1`), `identity.spec.ts`,
  `evidence.spec.ts` et `integration.spec.ts` (captures curatées).
- CI Web (`.github/workflows/ci.yml`) : `npm ci --ignore-scripts`, `typecheck`,
  `lint`, `test`, `build`. Les projets Playwright ne tournent pas en CI.
- Dépendances de production : React, React DOM, TanStack Query, deux polices.
  Aucune bibliothèque 3D, d'animation ni d'icônes.

### 3.4 Matériel de référence disponible dans le dépôt

- `docs/diagrams/architecture-physique/rendu-3d/casier-p0-vues.png` : rendu
  Three.js d'intention du P0 (hub à écran au-dessus de A1 et A2, portes ouvertes,
  vue arrière avec deux câbles dédiés), fond sombre.
- `casier-motifs.png` : motifs à trois et quatre modules, **hors P0**
  (`docs/research/rendu-3d-motifs.md`); ils ne fixent pas le périmètre matériel.
- `casier-3d.html` : page interactive Three.js r128 chargée depuis des CDN
  (fonts Google, cdnjs, jsdelivr) avec `backdrop-filter`; **référence
  d'intention seulement**, inutilisable telle quelle dans le produit (CDN, verre,
  police étrangère à Geist).
- `casier-p0.stl` : 1,08 Mo, trop lourd pour un chargement Web direct.
- `architecture-physique-vues.svg` et `-topologie-etoile.svg` : vues avant /
  arrière et étoile à deux départs, palette dessin (vert, gris, bleu, ambre).

**Références attendues de Philippe, non reçues au moment de ce brief** : le rendu
3D fourni par Jimmy et les captures de barres de navigation et d'appels à l'action.
Rien dans ce dossier ne prétend les avoir inspectées; les compositions utilisent un
substitut dessiné du casier et seront alignées sur le rendu réel à sa réception.

## 4. Sources normatives consultées (ordre `AGENTS.md`)

| Source | Ce qu'elle fixe pour la landing |
|---|---|
| `02-scope.md` §2, §3.1, §3.5, §4, §5.2, §6, §7, §10, §11, §12, §14, §19 | Catégorie, promesse (direction, non preuve), problématique, laboratoire = terrain de validation et non marché, objectifs du MVP, principes d'autorité et de preuve physique, démonstration de référence A1/A2, P0, P1, hors scope (pas de promesse chiffrée, pas de garantie anti-relais), indicateurs non prouvés |
| ADR-001, ADR-002, ADR-011 | Backend seule autorité; étoile à deux segments RS-485 indépendants, qualification électrique à réaliser; aucun budget contraignant à afficher |
| `12-architecture-physique.md` §1, §2, §6, §7 | Un hub avec écran et deux cellules A1, A2; rôle de l'écran (QR, consignes, résultat); parcours matériel et logiciel; dimensions et composants non approuvés |
| `README.md` racine | Vocabulaire des composantes (Aegis Mobile, Aegis Manager, Aegis Control), parcours en six étapes, prototype académique « sans prétendre » |
| `docs/design/identite/reference.md`, `manager-v3/README.md` | Identité « Lumière du hub » v3, palettes, logo provisoire, textes de marque, règles de composition et d'usage |
| `docs/localisation/glossaire.md`, `convention.md`, `textes-proposes-manager.md` | Termes établis et proposés, formats `fr-CA` / `en-CA`, pluriels, noms non traduits |
| Code intégré (`services/api`, `apps/ios`, `firmware`, `tools/hub-simulator`, `apps/admin-web`) et `docs/qualite/recette-humaine.md` | Ce qui est réellement implémenté, simulé ou validé (table §5) |

## 5. Affirmations et sources

La table complète est dans [`claims.md`](claims.md). Règle : la page n'affirme
que ce que la colonne « Statut » autorise, dans la formulation prévue. Les
affirmations « Prévu » s'écrivent au futur ou avec « conçu pour », jamais au
présent de l'accompli.

## 6. Contraintes de conception

- **Identité** : étendre « Lumière du hub » v3 (typographie Geist, hiérarchie
  éditoriale, surfaces opaques, un seul halo localisé, accent `#234BCE` /
  `#8CAEFF`, aucun indigo, aucun verre) sans en faire un empilement de cartes.
  Aegis est le produit; Aegis Studio est le groupe; « CORE » ne revient pas.
- **Casier** : hub et exactement deux cellules; une cellule = un compartiment;
  l'écran est sur le hub; les cellules n'ont ni écran ni radio; câbles dédiés.
  Aucune variante à trois ou quatre modules.
- **Mouvement** : transitions sélectives qui expliquent le produit; défilement
  natif, jamais détourné; aucune introduction imposée; rien ne retarde ni ne
  masque l'action « Se connecter »; `prefers-reduced-motion` donne une version
  utile et complète, pas une page vidée; durées des jetons existants.
- **Médias** : chargement progressif; repli statique si la 3D échoue ou n'est pas
  chargée; aucune dépendance 3D lourde sans justification et approbation
  (`aegis-delivery`, « dépendance majeure »).
- **Accessibilité** : WCAG 2.2 AA; structure sémantique (`header`, `nav`,
  `main`, `section` nommées, un seul `h1`); clavier et focus visibles; contraste;
  aucune information portée par la couleur ou le mouvement seuls; 200 % de zoom;
  aucun défilement horizontal de 320 à 1440 px.
- **Routage** : `/` reste la seule route publique ajoutée ou modifiée; ancres de
  sections fonctionnelles; `/connexion`, routes protégées, rechargement,
  expiration et déconnexion inchangés.

## 7. Décisions à obtenir de Philippe

1. **Supersession partielle de la référence d'identité.** La décision du
   21 octobre 2026 exclut hub, cellules et 3D des écrans d'entrée. L'issue #153
   demande le casier en 3D sur `/`. Proposition : la landing publique devient une
   surface **promotionnelle** distincte des écrans d'entrée (connexion, introuvable),
   qui gardent la règle. La modification de `reference.md` appartient à son
   propriétaire; ce dossier propose le texte, ne l'applique pas.
2. **Adaptation de `identity.test.ts`.** Le test interdit le mot « hub » dans les
   catalogues et composants de production, et fixe la liste des fichiers à halo.
   Expliquer le casier impose soit d'admettre `hub` pour les sources de la landing
   (catalogue `landing.*`, composants `features/landing/**`), soit un autre mot
   (« module central »). Recommandation : admettre `hub` pour la landing seulement
   et garder l'interdiction ailleurs; décision humaine, car le test encode une
   décision d'identité.
3. **Technique du casier 3D** (voir `directions.md` §4) : séquence d'images
   pré-rendues par Jimmy sans dépendance (recommandé), ou WebGL avec `three`
   autohébergé et un modèle glTF léger fourni par Jimmy (dépendance majeure à
   approuver).
4. **Signature « Aegis Studio »** : pied de page uniquement, ou aussi dans la
   section « Qui » avec les deux prénoms et les rôles (logiciel / matériel).

## 8. Critères de réussite observables

- Un visiteur nomme la promesse, le rôle du casier et l'application du technicien
  après un parcours de la page, sans ouvrir une autre route.
- L'action « Se connecter » est visible sans défilement à 320, 390, 768 et
  1440 px, en clair et en sombre, dans les deux langues.
- Chaque section est atteignable par la navigation et par ancre, au clavier.
- La page reste lisible et complète avec `prefers-reduced-motion: reduce`, sans
  WebGL, sans média 3D chargé, et à 200 % de zoom, sans défilement horizontal.
- Chaque phrase de la page correspond à une ligne de `claims.md`.
- `typecheck`, `lint`, `test`, `build` et la matrice Playwright `a11y` passent;
  tailles d'assets, chargement différé et mesure navigateur consignés.
