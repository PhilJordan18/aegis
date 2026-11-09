# Landing publique — handoff d'implémentation (direction A, issue #153)

Référence visuelle : `mockups/a-mise-en-scene.html` et ses rendus dans
`mockups/renders/`. La maquette est un prototype statique; ce document dit
comment la reproduire dans `apps/admin-web` sans rien inventer de plus.

Statut : **maquette approuvée visuellement par Philippe le 2026-11-09**
(direction A, rendus de `mockups/renders/`). L'intégration dans
`apps/admin-web` appartient à Web Manager.

## 0. Propriété, commits et statut des décisions

Répartition approuvée le 2026-11-09 (issue #153, commentaire de Philippe) :
cette session livre uniquement le design et ce handoff; **Web Manager** est
seul propriétaire de l'intégration dans `apps/admin-web`, après approbation
visuelle; **QA et intégration** vérifie l'implémentation approuvée.

Commits sur `153-feat-public-landing`, à partir de `origin/dev` `023ab51`,
non poussés :

| Commit | Contenu |
|---|---|
| `afd49cf` | brief, réclamations, états, maquettes basse fidélité, deux directions |
| `ff21718` | demande de rendus à Jimmy |
| `170d861` | scène source de Jimmy, `verify/render-device.mjs`, trois PNG du casier |
| `fe41db8` | maquette haute fidélité, `screen.json`, `verify/render-mockups.mjs`, ce handoff |

Emplacement des actifs : `assets/device/*.png` et `screen.json` (casier),
`mockups/` (prototype statique et rendus), `source/` (scène three.js de
référence, non modifiée).

Statut des décisions : **approuvé** par Philippe — la maquette direction A
(2026-11-09), retrait de l'inscription « L-01 », bloc d'alimentation masqué,
aucune métrique ni témoignage inventé, mot « hub » conservé avec exclusion
ciblée dans `identity.test.ts` (section 2.1), signature Studio en prénoms
seuls, sans rôles ni titres (section 2.3). **Proposé**, en attente — la note
de supersession partielle de la référence d'identité (section 2.2); elle ne
bloque pas l'intégration.

Composants Web existants à réutiliser, sans les dupliquer : `ui/Brand.tsx`,
`ui/Button.tsx` et `buttonClass.ts`, `ui/StatusChip.tsx`, `ui/Icon.tsx`,
`features/appearance` (thème) et `features/language` (langue), les catalogues
`i18n/messages/{fr,en}.ts` avec les clés `landing.*` déjà présentes, la route
`/` et `/connexion` existantes.

Vérifications d'acceptation restantes : celles de la section 8, exécutées par
Web Manager puis revues par QA et intégration, plus la vérification manuelle
par Philippe de la copie FR/EN de la section 6 avant publication.

## 1. Périmètre et fichiers

| Fichier | Action |
|---|---|
| `src/pages/LandingPage.tsx` | réécrire : sept sections de `states.md` §2, ancres `#produit #readiness #parcours #systeme #garanties #studio` |
| `src/pages/landing.css` | réécrire; reste le seul fichier de page autorisé à porter `radial-gradient` (halo du héros, ombre de contact du casier) |
| `src/features/landing/Device.tsx` + `device.css` | nouveau : composant casier (trois rendus superposés, écran composé, repli) |
| `src/features/landing/HubScreen.tsx` | nouveau : contenu de l'écran du hub pour les six états |
| `src/features/landing/Journey.tsx` | nouveau : étapes, colonne collante, `IntersectionObserver`, vignettes |
| `src/features/landing/SystemDiagram.tsx` | nouveau : schéma SVG avec `aria-label`, liste de repli sous 768 px |
| `src/assets/landing/casier-ferme.webp` (+ `-a1-ouverte`, `-ferme-voyant-a1`), `screen.json` | nouveaux : dérivés des PNG de `assets/device/` |
| `src/i18n/messages/fr.ts`, `en.ts` | étendre `landing.*` (section 6) |
| `src/pages/LandingPage.test.tsx`, Playwright `a11y`/`identity`/`capture` | tests de la section 8 |

Hors périmètre, à ne pas toucher : `routes.ts` (la route `/` existe déjà),
`router.ts`, `RequireAdminSession`, `/connexion`, l'API, la base, MQTT, le
firmware, les fichiers d'hébergement de #151 / #152.

## 2. Décisions humaines préalables à l'implémentation

1. **Mot « hub » dans les sources Web.** `src/styles/identity.test.ts` interdit
   `\bhub\b` dans toute source de production. La landing emploie « hub » dans la
   copie (catalogue) et dans les commentaires. Proposition : exclure du filtre
   `src/features/landing/**`, `src/pages/LandingPage.tsx`, `src/pages/landing.css`
   et les clés `landing.*` des catalogues, en gardant l'interdiction partout
   ailleurs; ajouter un test qui vérifie que ces exclusions restent les seules.
   Alternative sans changer le test : remplacer « hub » par « module central » dans
   toute la copie. **Décision de Philippe (2026-11-09) : garder « hub » et
   exclure les fichiers de la landing du test**, selon la proposition ci-dessus.
2. **Supersession partielle de la référence d'identité** (brief §7.1) : la page
   `/` montre le casier en 3D, contrairement à `reference.md` du 21 octobre. À
   consigner dans une courte note d'identité ou un ADR de design.
3. **Signature Aegis Studio** (brief §7.4) : la maquette montre le pied de page
   « Aegis Studio · Philippe et Jimmy » et une section Studio avec les deux noms
   et rôles. **Décision de Philippe (2026-11-09) : prénoms seuls.** À
   l'intégration, retirer les rôles et titres de la section Studio et du
   catalogue (`landing.studio.*`); le pied de page reste tel quel. La maquette
   n'a pas été re-rendue après cette décision.

## 3. Jetons et typographie

Tout vient de `src/styles/tokens.css`; aucun nouveau jeton de couleur. Valeurs
spécifiques à la page, déclarées dans `landing.css` :

| Variable | Clair | Sombre | Usage |
|---|---|---|---|
| `--landing-wrap` | 1280px | idem | largeur de colonne |
| `--landing-gutter` | `clamp(20px, 4vw, 56px)` ; 12px sous 360px | idem | gouttières |
| `--landing-floor` | `rgba(18,35,57,.22)` | `rgba(0,0,0,.7)` | ombre de contact sous le casier |
| écran du hub | `#0B0F16` fond, `#F1F5FC` texte, `#8CAEFF` surligne, `#6FE3A8` succès | identiques | l'écran est un appareil, il ne suit pas le thème |

Typographie : Geist et Geist Mono existants. Display du héros
`clamp(3rem, 1rem + 5.6vw, 5.25rem)`, graisse 500, interlettrage -0.06em; titres
de section `clamp(1.75rem, 1rem + 2.2vw, 2.75rem)`, graisse 600; numéros d'étape
et de garantie en mono.

Rayons, hauteurs de contrôle, ombres, mouvements : jetons `--ag-*` existants.
Aucun verre, aucun dégradé linéaire, aucune animation d'introduction.

## 4. Anatomie des composants

### 4.1 En-tête

`ag-brand` existant + « Manager » ; navigation de sections (6 liens) visible à
partir de 1024 px ; sous 1024 px, bouton « Sections » (`aria-expanded`,
`aria-controls`) ouvrant une feuille opaque sous l'en-tête avec les six liens et le
sélecteur de langue ; sous 768 px le sélecteur de langue quitte l'en-tête et reste
dans la feuille et le pied de page. « Se connecter » reste toujours dans
l'en-tête, lien vers `/connexion` via `Link` et `pathOf`.

### 4.2 Casier (`Device`)

```
<div class="lp-device" data-doors="closed|open-a1" data-led="off|a1" role="img" aria-label=…>
  [zoom]                       <!-- parcours seulement -->
  <div class="lp-device__box">   <!-- aspect-ratio 2400 / 2600 -->
    <img closed> <img open-a1> <img led-a1>   <!-- superposés, opacité 0/1, 240 ms -->
    <div class="lp-device__screen">…HubScreen…</div>  <!-- 300 × 200, matrix3d -->
    <div class="lp-device__fallback">…silhouette SVG + texte…</div>
    <svg class="lp-device__lead">  <!-- fil carte → écran, parcours seulement -->
  </div>
</div>
```

- Les trois images sont celles de `assets/device/`, converties en WebP (et AVIF
  si le gain est mesuré) à 1200 px de large pour le héros, 800 px pour le
  parcours, 2× pour les écrans denses ; PNG en `<picture>` de repli. Cible : moins
  de 120 Ko par image WebP, à mesurer dans la PR.
- L'écran est un `div` de 300 × 200 px transformé par `matrix3d` vers les quatre
  coins de `screen.json` (coordonnées dans l'image 2400 × 2600, mises à l'échelle
  de la largeur rendue). L'homographie est celle de `mockups/mockup.js`
  (`matrix3d()`), recalculée au redimensionnement (`ResizeObserver`).
- Héros : état `idle`, images `loading="eager"`, `fetchpriority="high"` sur la
  vue fermée, hauteur réservée par `aspect-ratio` ; aucun décalage de mise en page.
- Parcours : `loading="lazy"` ; la carte « Écran du hub, agrandi » reproduit le
  même `HubScreen` à 260 px (200 px en vignette) et un fil SVG relie son bord bas
  au centre de l'écran réel. C'est une loupe, pas un deuxième appareil.
- Repli : `onError` sur n'importe laquelle des trois images ajoute
  `lp-device--failed` : images, écran et fil masqués ; silhouette SVG (trois
  rectangles, écran plein) et texte « L'image n'a pas pu être chargée ». Même
  repli si `prefers-reduced-data`.
- `role="img"` et `aria-label` décrivent l'état courant (textes `steps[i].alt`).

### 4.3 Écran du hub (`HubScreen`)

Six états, grille `auto 1fr auto`, padding 16/18/14 px : barre haute (mot
« aegis » 14 px 600 + surligne mono 11 px), corps (titre 26 px 600, texte 14 px),
pied (mono 12 px). États et contenus dans la section 6 (`landing.screen.*`). Le
QR de l'état `qr` est un motif SVG 21 × 21 généré, **sans valeur encodée** : c'est
une illustration, pas un code lisible.

### 4.4 Parcours (`Journey`)

- ≥ 1024 px sans mouvement réduit : étapes à gauche, figure collante à droite
  (`top: 88px`, casier 560 px max). Un `IntersectionObserver` sur chaque étape,
  `threshold: 0.6`, `rootMargin: -10% 0 -10% 0`, applique l'état ; une seule
  transition d'opacité (jeton `--ag-motion-slow`), pas de translation, aucun
  détournement du défilement. Le rail sous la figure (`aria-live="polite"`)
  annonce « Étape 04 · porte A1 ouverte, A2 fermée · écran : consigne ».
- < 1024 px **ou** `prefers-reduced-motion: reduce` : la figure collante et le
  rail disparaissent ; chaque étape porte sa vignette (casier + carte d'écran),
  sans transition. Même composant, mêmes images.
- `aria-current="step"` sur l'étape active ; barre d'accent de 3 px et surface
  sélectionnée.
- Étiquettes : « Disponible » (`tag--live`) sur l'étape 1 seulement ; « En
  conception » sur 2 à 6, tant que `claims.md` C3 et C4 restent « Prévu ».

### 4.5 Readiness, Système, Garanties, Studio

- Readiness : panneau opaque `ag-surface`, trois lignes avec `StatusChip`
  existant (prêt, bloqué, à vérifier), marqueur « Exemple illustratif »
  (`landing.mockBadge`, déjà au catalogue).
- Système : SVG 1120 × 400 avec `role="img"` et `aria-label` complet ; sous
  768 px le SVG et ses trois notes disparaissent au profit d'une liste ordonnée de
  trois phrases (même information).
- Garanties : grand livre numéroté, cinq entrées ; réutiliser
  `landing.guarantees.*` existants.
- Studio : paragraphe de contexte, deux personnes (noms non traduits), liste
  « État du prototype » à quatre lignes datée. La date et les statuts sont à
  rafraîchir à chaque livraison ; ne jamais y mettre de métrique.

## 5. États et comportements

| Situation | Comportement |
|---|---|
| Première peinture | copie et CTA utilisables ; casier avec hauteur réservée |
| Image en échec ou `prefers-reduced-data` | silhouette + texte ; aucun message alarmant |
| Mouvement réduit | vignettes statiques, aucune transition |
| `forced-colors: active` | halo et ombre de contact masqués ; bordure `CanvasText` sur carte, panneau, écran ; étape active `Highlight` |
| Session administrateur active | page identique ; « Se connecter » mène à `/connexion`, qui redirige déjà |
| Rechargement avec `#ancre` | section ciblée en haut, `tabindex="-1"` et focus sur le titre via `PageHeading` existant |
| Clavier | ordre : lien d'évitement, marque, navigation, langue, « Se connecter », contenu ; feuille mobile fermée par Échap |
| Zoom 200 % (1440 → 720 px) | mise en page tablette, aucun défilement horizontal |

## 6. Catalogue FR / EN

Clés sous `landing` ; `fr.ts` fixe la forme, `en.ts` suit. Les textes exacts
sont dans `mockups/mockup.js` (`T.fr`, `T.en`) ; cette table résume.

| Clé | FR | EN | Statut de la revendication |
|---|---|---|---|
| `heroOverline` | L’essentiel, sous contrôle. | The essentials, under control. | P1 |
| `heroTitle` (3 lignes) | Prêt. / Autorisé. / Prouvé. | Ready. / Authorized. / Proven. | P1 |
| `heroDesc` | Disponibilité, conformité et traçabilité de vos équipements. | Availability, compliance and traceability of your equipment. | P2 |
| `heroSystem` | Aegis relie l’application du technicien… observé. | Aegis connects the technician’s app… observed. | P4, S1 |
| `seeJourney` | Voir le parcours | See the journey | — |
| `stageCaption` | Casier P0 · un hub avec écran · deux cellules indépendantes | P0 locker · one hub with a screen · two independent compartments | S5 |
| `readiness.title`, `p1`, `p2` | Un inventaire peut se tromper. Aegis dit pourquoi. … | An inventory can be wrong. Aegis says why. … | R1–R3 |
| `diagnostic.*` | Multimètre 1 / 2, Caméra thermique, faits et raisons | Multimeter 1 / 2, Thermal camera… | exemple illustratif |
| `journey.title`, `lead` | Six étapes, une seule porte. … | Six steps, one door. … | C1–C7 |
| `journey.steps[1..6].title/text/alt` | Réserver, Préparer, Scanner, Ouvrir, Prouver, Retourner | Reserve, Prepare, Scan, Open, Prove, Return | 1 : C1, C2 ; 2–6 : C3, C4, C7 « Prévu » |
| `journey.tagLive`, `tagPlanned` | Disponible / En conception | Available / In design | — |
| `journey.rail[1..6]` | portes fermées · écran en veille, … | doors closed · screen on standby, … | — |
| `screen.{idle,qr,verify,open,confirmed,result}.{over,title,text,foot}` | Veille / A1 · A2 …, Retrait · A1 / Scannez …, Vérification…, A1 ouverte …, Retrait confirmé …, Retour enregistré … | Standby…, Pickup · A1 / Scan…, Verifying…, A1 open…, Pickup confirmed…, Return recorded… | récit, états futurs |
| `system.*` | Qui parle à qui. + nœuds et trois notes + trois phrases de repli | Who talks to whom. … | S1–S4 |
| `guarantees.*` | existants | existants | — |
| `studio.*` | Deux personnes, un prototype. … rôles … état du prototype | Two people, one prototype. … | A1–A3, statut |
| `footer.*` | Aegis Manager · Administration ; Technicien ? … ; Aegis Studio · Philippe et Jimmy | … | — |

Règles : noms propres, « Aegis Mobile », « Aegis Manager », « Aegis Control »,
« A1 », « A2 », « MM-001 » ne sont pas traduits ; aucune métrique, aucun
témoignage, aucun budget, aucun « CORE ».

## 7. Chargement et performance

- Héros : une image WebP ≤ 120 Ko, `fetchpriority="high"`, `decoding="async"`.
- Les deux autres états du héros ne sont pas chargés (l'héros reste `idle`).
- Parcours : trois images `loading="lazy"`, partagées entre la figure collante et
  les six vignettes par le cache HTTP ; aucun script tiers ; aucune bibliothèque 3D.
- Budget indicatif de la page : CSS + JS de la landing ≤ 30 Ko gz ; à mesurer
  dans `npm run build`.

## 8. Vérification attendue

- Vitest : rendu FR et EN, un seul `h1`, six étapes, `aria-current` sur l'étape
  active, repli d'image (`onError` → silhouette), textes du catalogue présents,
  « Se connecter » pointe vers `/connexion`.
- `identity.test.ts` : passe après la décision de la section 2.1.
- Playwright `a11y` : axe sans violation à 390 et 1440, clair et sombre ;
  `identity` : aucun défilement horizontal à 320 / 390 / 768 / 1440 ; `capture` :
  évidences nominal, reduced motion, sans image, zoom 200 %.
- Revue indépendante `qa-reliability-engineer` sur rendu réel, sans édition.

## 9. Évidence de la maquette

`mockups/renders/` : `a-{dark,light}-fr-{1440,768,390,320}.png`,
`a-dark-en-1440.png`, `a-light-en-390.png`, `a-dark-fr-1440-reduced.png`,
`a-light-fr-1440-no-device.png`, `a-dark-fr-390-menu.png`,
`a-dark-fr-zoom200.png`, `a-*-1440-step{2,4,5,6}.png`. Produits par
`verify/render-mockups.mjs`, qui rapporte débordement horizontal, nombre de `h1`
et violations axe (WCAG 2.2 AA) pour chaque variante.
