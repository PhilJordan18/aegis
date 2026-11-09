# Landing publique — directions visuelles (issue #153)

Mode : Prototype, porte B du workflow de conception. Date : 9 novembre 2026.
Deux compositions statiques, matériellement différentes, à l'intérieur de l'identité
« Lumière du hub » v3; une recommandation; les rejets restent documentés. Aucun code
applicatif. Les compositions sont en français; l'anglais arrive à l'implémentation.

**Ce que les rendus montrent, et ne montrent pas.** Ils prouvent la composition, la
hiérarchie, la typographie, les deux apparences et le comportement à 1440, 768 et
390 px (aucun défilement horizontal, mesuré par `verify/render.mjs`). Le casier est un
**substitut dessiné** (`directions/device.js`, vue trois quarts, proportions du rendu
d'intention 300 × 260 × 340 mm), marqué comme tel sur chaque page. Le rendu 3D de
Jimmy et les captures de barres de navigation et d'appels à l'action n'avaient pas été
reçus : rien ici ne prétend les avoir inspectés. Les mouvements sont décrits, pas
rendus : une capture ne montre pas une transition.

Fichiers : `directions/a-mise-en-scene.html`, `directions/b-dossier-technique.html`
(`?theme=dark|light`), `directions/proto.css` (jetons copiés de
`apps/admin-web/src/styles/tokens.css`), polices autohébergées de
`../manager-v3/prototype/fonts/`, rendus dans `directions/renders/`, maquettes
filaires dans `wireframes/`. Régénération : `node docs/design/public-landing/verify/render.mjs`
après `npm ci --ignore-scripts` dans `apps/admin-web`.

## 1. Ce que les deux directions partagent

- Le flux et les sept sections de `states.md` §2, les ancres, la copie de `claims.md`.
- L'en-tête : marque (symbole + « aegis » + « Manager »), navigation de sections,
  « Français / English », « Se connecter » toujours visible; sous 1024 px, la
  navigation se replie en feuille et le bouton reste.
- La signature typographique « Prêt. Autorisé. Prouvé. » en `h1`, le troisième mot
  en accent, le halo localisé derrière elle et nulle part ailleurs; surfaces opaques;
  aucun verre, aucun dégradé de surface, aucun indigo.
- Les statuts par forme + symbole + texte (pastilles existantes); le marqueur
  magenta « Exemple illustratif » sur toute donnée fictive; les étiquettes
  « Disponible » / « En conception » sur les étapes, pour ne jamais présenter le
  parcours QR comme livré.
- Le schéma « Qui parle à qui » (SVG, libellés mono), les cinq garanties, la section
  Aegis Studio avec l'état du prototype en quatre lignes (intégré, simulé, en
  conception, non mesuré).

## 2. Direction A — « Mise en scène »

**Concept.** Le casier est le fil conducteur. Il entre en scène dès le héros, à
droite de la signature, sur un sol et une lumière localisée; puis il **suit la
lecture** : dans la section Parcours, il reste collé à droite pendant que les six
étapes défilent à gauche, et change d'état à chaque étape (écran en attente → QR →
vérification → porte A1 ouverte → voyant A1 → résultat). Le visiteur comprend la
relation téléphone / serveur / casier en regardant la même machine réagir.

- **Hiérarchie et agencement.** Héros pleine hauteur, grille 5/7 (texte / scène).
  Sections à filets, colonnes 5/7; Parcours avec colonne collante; garanties en
  grand livre numéroté (numéro mono en accent, titre, texte) plutôt qu'en cartes.
- **Typographie et densité.** Display 48 → 84 px, titres de section 28 → 44 px,
  texte secondaire 15–16 px; densité moyenne, beaucoup d'air autour de la scène.
- **Couleur et statuts.** Sombre profond par défaut (la scène porte mieux la
  lumière), clair minéral identique en structure; pastilles de statut existantes;
  l'étape active porte une barre d'accent et une surface sélectionnée.
- **Signature Aegis.** La machine qui obéit à la lecture : un seul objet, un seul
  état à la fois, jamais deux portes ouvertes, jamais une porte ouverte sans
  commande dans le texte voisin. C'est l'invariant « une commande, une cellule »
  rendu visible.
- **Mouvement.** Défilement natif. Un `IntersectionObserver` sur chaque étape
  choisit l'état du casier; la transition d'état dure 200–240 ms (jetons
  `--ag-motion-base/slow`). Les sections apparaissent sans translation, par
  opacité seulement. Avec `prefers-reduced-motion`, le casier change d'état sans
  transition et la colonne cesse d'être collante : les six états deviennent six
  vignettes alignées sur les étapes. Aucune animation d'introduction; le CTA est
  cliquable au premier rendu.
- **Adéquation plateforme.** Page Web publique de bureau et de mobile; sur mobile,
  la scène passe sous la signature (vue avant, hauteur bornée), le casier du
  parcours n'est plus collant et prend la place d'une vignette sous les étapes.
- **Risques.** (1) La colonne collante peut ressembler à un défilement détourné si
  les états changent trop vite : seuil d'intersection à 60 % et un seul changement
  par étape. (2) **Six états du casier** : si le rendu de Jimmy ne fournit qu'une
  vue, les états doivent venir soit de six rendus, soit d'un modèle 3D animable,
  soit du substitut dessiné; la décision conditionne l'implémentation. (3) Coût :
  une séquence d'images ou un modèle, chargés après la première peinture.
- **Rendus.** `renders/a-mise-en-scene-{dark,light}-{1440,768,390}.png`.

## 3. Direction B — « Dossier technique »

**Concept.** La page est une fiche produit éditoriale, comme une planche de dossier
technique : un sommaire numéroté, une colonne de faits, des planches annotées
(« Fig. 01 » casier, « Fig. 02 » système) avec règle graduée et légende, et la
signature du produit écrite en **équations de readiness** tirées du scope §7.2
(`PRÉSENT + CALIBRATION EXPIRÉE = BLOQUÉ`). Le casier est présenté une fois,
immobile, de face trois quarts; le parcours est une frise de six vignettes.

- **Hiérarchie et agencement.** Héros typographique 7/5 (signature / fiche);
  planche pleine largeur sous le héros; sections ouvertes par un numéro mono et un
  titre; frise à six colonnes qui devient trois puis une; garanties en grille à
  deux colonnes avec filets.
- **Typographie et densité.** Display plus grand (52 → 104 px), Geist Mono très
  présente (sommaire, faits, équations, légendes, numéros); densité plus forte,
  rythme de filets fins et d'un filet noir d'ouverture par bloc.
- **Couleur et statuts.** Clair minéral par défaut (lecture de fiche), sombre
  profond équivalent; les résultats des équations sont colorés **et** symbolisés
  (octogone bloqué, cercle prêt).
- **Signature Aegis.** Les équations de readiness : la règle métier devient le
  motif graphique, lisible sans image. Personne d'autre ne peut l'écrire.
- **Mouvement.** Minimal : apparition par opacité des planches et de la frise à
  l'entrée dans la fenêtre (200 ms), compteur mono qui s'écrit sur les numéros de
  section; le casier de la planche peut tourner légèrement au glisser (facultatif).
  Reduced motion : rien ne bouge, rien ne manque.
- **Adéquation plateforme.** Très robuste au reflow; la frise verticale sur mobile
  garde une vignette par étape; les planches gardent leur légende sous l'image.
- **Risques.** (1) Moins spectaculaire : le casier n'est pas « mis en scène » au
  sens de l'issue; la 3D se limite à une vue (tournable) et à des vignettes. (2) La
  densité mono peut paraître austère au jury si les planches ne sont pas assez
  grandes. (3) Les équations exigent une traduction anglaise soignée.
- **Rendus.** `renders/b-dossier-technique-{light,dark}-{1440,768,390}.png`.

## 4. Technique du casier 3D (décision 3 du brief)

| Option | Dépendance | Poids estimé | Repli statique | États multiples (A) | Évaluation |
|---|---|---|---|---|---|
| **Séquence d'images pré-rendues** par Jimmy (24–36 vues WebP/AVIF par état, chargées après la première peinture, lues au glisser ou à l'étape) | aucune | 30–60 Ko par vue, à mesurer | la première vue, déjà dans la page | oui si Jimmy rend chaque état | **Recommandée** : aucune dépendance, fidèle au rendu réel, déterministe, mesurable |
| WebGL avec `three` autohébergé + glTF compressé fourni par Jimmy | `three` (~150 Ko gz pour le cœur) | modèle à ramener sous 300 Ko (`casier-p0.stl` fait 1,08 Mo) | image statique si WebGL ou le chargement échoue | oui, par animation du modèle | Dépendance majeure : approbation humaine requise (`aegis-delivery`); plus lourd, plus de surface d'échec |
| `<model-viewer>` | composant Web embarquant three (~1 Mo) | lourd | oui | limité | Non recommandée |
| Substitut dessiné (SVG, `device.js`) | aucune | ~8 Ko | lui-même | oui | Repli honnête tant que le rendu de Jimmy n'est pas disponible; ne remplace pas « la représentation fidèle de l'appareil » exigée |

La séquence d'images demande à Jimmy : une vue trois quarts avant et, pour la
direction A, les cinq autres états (QR affiché, vérification, porte A1 ouverte,
voyant A1, résultat), à fond transparent, en clair et en sombre si la lumière de la
scène change. Le repli statique et la version reduced-motion utilisent les mêmes
fichiers : aucun second jeu d'assets.

## 5. Références étudiées et principes retenus

Références de principes, pas de produits à copier :

- MDN, `prefers-reduced-motion`
  (developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) :
  la version réduite doit rester complète; on retire les transitions, pas le contenu.
- MDN, Intersection Observer API
  (developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) : choisir
  l'état du casier d'après la section visible, sans écouter le défilement ni le
  détourner.
- W3C, WCAG 2.2, critère 2.3.3 « Animation from Interactions » et 1.4.10 « Reflow »
  (w3.org/WAI/WCAG22/Understanding/) : désactivation du mouvement déclenché par
  l'interaction; aucun défilement horizontal à 320 px.
- Chrome Developers, « Scroll-driven animations »
  (developer.chrome.com/docs/css-ui/scroll-driven-animations) : si une liaison au
  défilement est retenue plus tard, la faire en CSS (`animation-timeline`), avec repli
  sans animation; non requis par les deux directions.
- Maquette Web v3 de Philippe (`../identite/v3/web/aegis-web-v3.html`) et captures
  intégrées (`../manager-v3/captures-integration/`) : la hiérarchie marque →
  signature → une action, le halo localisé, Geist, FR/EN dans l'en-tête.

## 6. Recommandation

**Direction A, « Mise en scène », sous deux conditions.**

Elle répond le plus directement au mandat : le casier réel est mis en scène, le
mouvement explique le produit (le même objet réagit à chaque étape), et la relation
Manager / application technicien / hub et cellules se lit sans schéma. Sa signature
est un invariant métier rendu visible.

Conditions :

1. **Les états du casier existent.** Jimmy fournit la séquence d'images pour les six
   états (option recommandée de la section 4), ou Philippe approuve WebGL avec un
   modèle glTF léger. Sans états multiples, A perd sa raison d'être et **B devient la
   direction par défaut** : elle n'a besoin que d'une vue du casier et tient sa
   promesse avec des vignettes.
2. **Reduced motion et repli statique sont la même page.** La colonne collante est
   un enrichissement progressif; la version sans mouvement (six vignettes alignées
   sur les étapes) est conçue et testée en premier.

Ce que A perd par rapport à B : les équations de readiness et le ton de fiche
technique. Si Philippe les souhaite, les équations peuvent remplacer le panneau
d'exemple de la section Readiness de A sans changer sa direction visuelle; c'est un
choix de contenu, pas un mélange de styles. Il est proposé, pas appliqué.

Ce que B perd par rapport à A : la mise en scène demandée et la lecture « une
commande, une cellule » par le mouvement; elle compense par une robustesse totale
au reflow et au mouvement réduit, et par une signature typographique propre à Aegis.

## 7. Après la décision (porte C)

- Aligner la composition retenue sur le rendu de Jimmy et les captures de
  références dès leur réception; remplacer le substitut dessiné.
- Produire les maquettes haute fidélité dans `mockups/` : nominal, état sans média
  3D, reduced motion, 320 / 390 / 768 / 1440 px, zoom 200 %, FR et EN, clair et
  sombre, copie anglaise la plus longue.
- Écrire `handoff.md` : jetons, anatomie des composants, comportement de la colonne
  collante ou de la frise, chargement progressif, textes FR/EN avec statut,
  accessibilité, liste d'acceptation; puis seulement le code applicatif.
