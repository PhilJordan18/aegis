# Aegis Manager — revue de l'implémentation (accueil, connexion, shell, aperçu Équipements)

Mode : Usability review (Mode 4). Date : 30 septembre – 1er octobre 2026.
Relecteur : ui-ux-designer, qui est aussi l'auteur du handoff. **Cette revue
n'est donc pas indépendante.** La revue indépendante reste à
qa-reliability-engineer.

Porte évaluée : **« prêt pour la revue visuelle de Philippe »**.

## Verdict : REVISE

L'implémentation est fidèle au handoff : jetons, typographie, états, textes,
focus, couleurs forcées, reflow. Aucun défaut bloquant.

**Un défaut majeur doit être corrigé avant la revue de Philippe : R1, la
cellule allumée de la signature.** Elle est coupée ou masquée sur la
connexion à toutes les largeurs et sur l'accueil sous 640 px, et se lit
comme un défaut de rendu. **La cause est dans mon handoff** : l'index de la
cellule n'était juste qu'à 1440 px. La règle corrigée est ci-dessous, avec
de nouveaux jetons.

R2 à R6 sont mineurs. Les corriger dans la même passe est recommandé,
puisqu'ils sont peu coûteux, mais ils ne conditionnent pas la porte.

Préalable mécanique : recopier `tokens.css` à l'identique (voir §3, R0).

## 1. Preuves examinées

| Source | Révision et portée | Usage |
|---|---|---|
| `captures/` (16 PNG à 1×) | Ensemble retenu par le web-engineer | Lecture de chaque image |
| `apps/admin-web/test-results/captures/` (208 PNG, non versionnés) | 16 états × 1440 × 900, 1280 × 800, 390 × 844 (3×), 320 × 720 (2×), zoom 200 % (640 × 400 à 2×), clair et sombre; plus `forced-light`, `forced-dark` et `forced-colors` en bureau. Générés le 30 sept. à 20 h 36 | Priorité aux états défavorables, à 320, au zoom 200 %, au sombre et aux couleurs forcées. Lecture directe, plus planches contact |
| Build `apps/admin-web/dist-preview` (20 h 42, postérieur au dernier changement de source) | Copié dans le bloc-notes, servi en local, **sans écriture dans `apps/`** | Mesures DOM et pixels. Rendu **identique au pixel près** aux captures (0,00 % de pixels différents, `landing` en clair et `apercu-equipements` en sombre, 1440 × 900) |
| `apps/admin-web/src/**` | Lecture seule | Focus, live regions, `Retry-After`, correspondance des erreurs, stockage, exclusion de l'aperçu |
| `apps/admin-web/dist` | `node scripts/check-preview-excluded.mjs dist` → « no preview-only code in dist » | Exclusion de l'aperçu en production |
| Comparaison | `handoff.md`, `states.md`, `tokens.css`, `reference/renders/` | — |

**Non exécuté :**

- la suite `test:a11y` (axe) et les tests unitaires, qui relèvent du
  web-engineer;
- un lecteur d'écran;
- le clavier réel;
- le contraste élevé Windows réel (Chromium émulé seulement);
- Safari et Firefox.

## 2. Passes du protocole

1. **Hiérarchie en cinq secondes :** conforme.
   - Accueil : le titre, la promesse et **Se connecter** dominent.
   - Connexion : l'état courant (alerte) précède les champs.
   - Shell : la section courante et le diagnostic en tête de rangée sont
     lisibles immédiatement.
2. **Composition :** conforme au rendu de référence, mesures comprises (barre
   latérale de 264 px, liste de 440 et de 380 px, rangées). Écarts : R1, R2,
   R3 et R6.
3. **États :** les 13 états de connexion capturés reproduisent texte,
   variante et focus de `states.md` : les 12 slugs, avec `validation` scindé
   en `validation` (serveur) et `validation-client`.
   - La page introuvable est conforme à l'écart 6.
   - L'état `trop-de-tentatives` affiche le délai réel et l'indice « 0:55 ».
   - L'écran de mauvais rôle remplace le formulaire.
4. **Plateforme et accessibilité (source et rendu) :**
   - libellés liés, `aria-invalid` et `aria-describedby`;
   - live regions présentes avant leur contenu;
   - focus déplacé selon `states.md`;
   - lien d'évitement;
   - tiroir `<dialog>` modal;
   - menu du compte en divulgation;
   - le dossier défilant est focusable (`tabIndex=0`, `role=group`,
     étiqueté);
   - le bouton « Afficher » respecte « label in name » (WCAG 2.5.3);
   - aucun défilement horizontal à 320 px ni au zoom 200 %;
   - en couleurs forcées : alertes encadrées, section courante et sélection
     signalées par `Highlight`, interrupteur visible, symboles conservés.
5. **Cohérence système :** les jetons à une ligne sont identiques à
   `tokens.css` (comparaison faite avant l'ajout de R1). Polices Geist
   auto-hébergées, sous-ensemble latin. Seule la clé d'apparence est stockée
   (`aegis.manager.appearance`); le jeton reste en mémoire.

## 3. Constats (par gravité)

### R1 — Majeur : la cellule allumée paraît coupée ou égarée

- **Preuves :**
  - **Connexion**, toutes largeurs : cellule couverte à 57 % par le panneau
    de 1440 à 640 px. Elle n'est plus visible qu'à 28 % à 480 px, 22 % à
    390 px et 0 % à 320 px (coupée par le bord de la fenêtre).
    Captures : `connexion-*-desktop-*`, `*-zoom200-*`, `*-mobile-*`,
    `*-reflow-*`.
  - **Connexion en sombre :** le masque radial ternit la cellule en carré
    gris.
  - **Accueil :** couverte à 100 % par la figure à 480 px et à 29 % à 390 et
    320 px (`landing-defaut-mobile-*`, `-reflow-*`).
  - Mesures DOM sur le build servi, au rectangle près.
- **Exigence violée :** `brief.md`, signature (« une seule lumière par
  vue », lue comme intentionnelle); `visual-quality-bar.md`, « no visual
  flourish… obscures ».
- **Conséquence :** sur l'écran le plus vu de la démonstration, l'élément
  signature ressemble à un bug de rendu.
- **Responsable :** concepteur (le handoff donnait un index valable à
  1440 px seulement), puis web-engineer.
- **Correction** (déjà appliquée et vérifiée dans `reference/` et
  `tokens.css`) :
  1. **Deux couches.** `Cells` rend la grille de traits (masquée,
     inchangée), puis une **couche superposée de même géométrie** : même
     `grid-template`, même écart, même position, `aria-hidden`, **sans
     masque**. Elle ne contient que la cellule allumée; toutes les autres
     cellules y sont `visibility: hidden`. La cellule allumée n'est jamais
     soumise au masque.
  2. **Connexion :**
     - à partir de 768 px : index **38** (rangée 2, colonne 10 de la grille
       de 14). Cellule visible à 100 %, à 45 px du panneau, mesuré à 1440,
       1280, 1024 et 768 px;
     - **sous 768 px, aucune cellule allumée.** Le monogramme porte la
       signature. Le zoom à 200 % tombe dans ce cas;
     - fond de la cellule : nouveaux jetons `--ag-cell-lit-fill-page` et
       `--ag-cell-lit-glow-page`. En clair, dégradé `#8EABFF → #3366FF` et
       halo bleu, parce que le blanc disparaît sur l'atmosphère pâle; en
       sombre, identiques aux jetons de l'accueil.
  3. **Accueil :**
     - à partir de 768 px : index **15** (inchangé, de 92 à 104 px de la
       figure);
     - **sous 768 px :** index **9** (rangée 1);
     - la règle actuelle `@media (max-width: 479px)` de
       `pages/landing.css` (atmosphère avec `min-height: 0` et
       `padding: 120px 12px 12px`; figure en `position: relative`,
       `figcaption` en `flex-wrap`) **s'étend à `max-width: 767px`**.
       Mesuré : 44 px d'écart entre la cellule et la figure à 767, 700,
       640, 560, 480, 390 et 320 px, sans défilement horizontal;
     - l'accueil garde `--ag-cell-lit-fill` (blanc sur le panneau bleu).
  4. **Test d'acceptation à ajouter :** à 1440, 1280, 1024, 768, 640, 480,
     390 et 320 px, la cellule allumée est **soit absente, soit visible à
     100 %** :
     - entièrement dans son conteneur;
     - à 16 px au moins de la figure ou du panneau.

### R2 — Mineur : « Se connecter » passe sur deux lignes dans l'en-tête de l'accueil à 320 px

- **Preuve :** `landing-defaut-reflow-light/dark` montre un bouton
  « Se / connecter » sur deux lignes. `ui/button.css` n'a pas de
  `white-space: nowrap`.
- **Exigence violée :** handoff §6, Button (`white-space: nowrap` dans la
  référence).
- **Conséquence :** en-tête maladroit à la plus petite largeur.
- **Responsable :** web-engineer.
- **Correction :**
  - limiter le non-retour **à l'en-tête** :
    `.ag-landing__head .ag-btn { white-space: nowrap; flex: none; }` et
    `.ag-landing__head .ag-brand { min-width: 0; }`;
  - si l'espace manque encore sous 360 px, masquer `.ag-brand__sub`
    (« Manager ») dans cet en-tête seulement : le surtitre du héros le
    répète;
  - **ne pas** imposer `nowrap` à tous les boutons : « Se connecter avec un
    autre compte » doit continuer à passer à la ligne à 320 px.

### R3 — Mineur : le dossier coupe une ligne sous son pied, sans indice de défilement

- **Preuve :**
  - `apercu-equipements-nominal-laptop-*` (1280 × 800) : « Expirée depuis le
    8 sept. 2026 » est coupé à mi-hauteur sous le pied collant;
  - à 1440 × 900 avec la bande d'aperçu, l'aide « Fuseau du casier » est
    rognée.
- **Exigence violée :** passe 2 du protocole (troncature). Le défaut était
  aussi présent dans ma référence.
- **Conséquence :** rien n'indique qu'il reste du contenu et des réglages.
  Le défilement au clavier, lui, fonctionne.
- **Responsable :** web-engineer, d'après la référence corrigée.
- **Correction :** ombres de défilement sur `.ag-dossier__scroll`, avec
  quatre fonds :
  1. `linear-gradient(var(--ag-surface) 30%, transparent)` en haut, sur
     100 % × 28 px, `local`;
  2. son symétrique en bas, `local`;
  3. `linear-gradient(rgba(var(--ag-shadow-tint), .16), transparent)` en
     haut, sur 100 % × 12 px, `scroll`;
  4. son symétrique en bas, `scroll`;
  5. puis `var(--ag-surface)`.

  Copie exacte dans `reference/reference.css`, `.dossier__scroll`.

### R4 — Mineur : l'alerte « Réessayez dans 55 secondes. » reste affichée après l'échéance

- **Preuve (source) :** dans `features/auth/SignInPage.tsx`, l'intervalle
  remet `lockDeadline` à `null` et annonce « Vous pouvez réessayer. ».
  L'`outcome` reste `rateLimited`, donc l'alerte périmée reste visible au
  moment où le bouton se réactive. Ce n'est pas visible sur une capture
  statique.
- **Exigence violée :** `states.md` §3, `trop-de-tentatives`.
- **Conséquence :** message contradictoire avec le bouton actif.
- **Responsable :** web-engineer.
- **Correction :** à l'échéance, passer aussi `outcome` à `{ kind: 'idle' }`
  (l'alerte disparaît sans réannonce). Garder l'annonce polie « Vous pouvez
  réessayer. ». Le focus ne bouge pas.

### R5 — Mineur : une violation serveur sur le mot de passe affiche « Saisissez votre mot de passe. » alors qu'il est saisi

- **Preuve (source) :** `errorsFromViolations`
  (`features/auth/signInValidation.ts`) associe tout champ `password` au
  message de champ vide, et tout champ `email` à « courriel invalide », même
  pour une adresse bien formée (capture `connexion-validation-desktop-light`
  avec `revue@apercu.test`).
- **Exigence violée :** `states.md` §3 (texte choisi selon le champ, mais il
  doit rester vrai).
- **Conséquence :** consigne fausse.
- **Responsable :** web-engineer, avec le texte du concepteur.
- **Correction :**
  - pour chaque champ signalé par le serveur, réutiliser le message
    `validateSignIn` si le client détecte aussi l'erreur;
  - sinon, pour `email`, garder « Saisissez une adresse courriel valide… »;
  - pour `password`, utiliser le **nouveau texte [P]** « Ce mot de passe
    n'est pas accepté. Vérifiez-le, puis réessayez. » (ajouté à
    `states.md`).

### R6 — Mineur : l'onglet « Modèles » inerte a l'apparence d'un onglet disponible

- **Preuve :** `apercu-equipements-*` : « Modèles » est stylé comme un
  onglet inactif ordinaire, alors qu'il est non focusable et
  `aria-disabled`.
- **Exigence violée :** brief, critère 4 (rien de cliquable-mais-mort); même
  traitement que les sections à venir (handoff §6, SidebarNav).
- **Conséquence :** clic sans effet, sans explication visuelle.
- **Responsable :** web-engineer.
- **Correction :**
  - `.ag-tabs__tab[aria-disabled]` en couleur `--ag-text-3` (mesuré à
    5,21:1 et plus sur le verre), `cursor: default`;
  - ajouter après le libellé la cellule en tirets `.ag-soon`, réduite à
    10 × 10 px (rayon 3, écart de 8), `aria-hidden`;
  - garder le texte masqué « , à venir ».

  Exemple dans `reference/reference.css`, `.tabs .tab--soon`.

### R0 — Préalable : recopie des jetons

`tokens.css` gagne `--ag-cell-lit-fill-page` et `--ag-cell-lit-glow-page`
(R1). Il faut recopier `src/styles/tokens.css` **à l'identique** depuis
`docs/design/manager-entree/tokens.css`. Le test de dérive échoue tant que
ce n'est pas fait, et c'est voulu.

### Observations sans constat

- En couleurs forcées, le bouton « Se connecter » verrouillé et les actions
  inertes s'affichent dans le `GrayText` émulé par Chromium : rouge foncé en
  thème blanc, vert en thème noir. C'est la couleur système de l'état
  désactivé : **correct**.
- En couleurs forcées, l'accueil garde le cadre vide de l'atmosphère, puisque
  la grille est masquée. C'est acceptable : la figure reste lisible.
- Le sélecteur « État » de la bande d'aperçu affiche les slugs bruts, ce qui
  est acceptable pour un outil de revue. Il apparaît aussi sur l'accueil et
  la page introuvable, où il est sans effet. C'est un détail, pas un
  constat.

## 4. Écarts déclarés par le web-engineer

| # | Écart | Décision | Motif |
|---|---|---|---|
| 1 | Verrou du 429 : `aria-disabled` et apparence désactivée au lieu de `disabled`, pour garder le focus. Pas de verrou sans `Retry-After` | **Accepté** (le handoff §6 et `states.md` sont mis à jour) | Meilleur que la spécification : le focus n'est pas perdu et l'activation est ignorée par l'appelant (vérifié dans la source). Sans délai connu, un verrou serait arbitraire; le serveur refuse de toute façon |
| 2 | `<main id="contenu">` englobe l'en-tête de page et la barre « Aperçu visuel » | **Accepté** | Le lien d'évitement mène au `h1`. Plus conforme |
| 3 | Contenu d'aperçu inerte : rangées statiques, réglages en `dl`, « Modèles » onglet `aria-disabled` non focusable, « Historique dans Audit » bouton inerte au style de lien | **Accepté**, avec R6 pour l'apparence de « Modèles » | Les actions inertes sont décrites par la barre d'aperçu. En couleurs forcées, le bouton « Historique » montre son cadre : acceptable |
| 4 | « Compte utilisé » affiche le courriel saisi; violations `email` et `password` associées aux messages client; erreur de service sans `traceId` réduite à « Réessayez dans un instant. »; tiroir intitulé « Menu » avec bouton « Fermer le menu » | **Accepté**, sauf la correspondance du mot de passe (R5) | Textes ajoutés à `states.md` comme [P] |
| 5 | Sous 480 px, la figure d'exemple passe sous les cellules; de 768 à 1023 px, garanties sur deux colonnes | **Accepté et étendu :** le flux sous les cellules s'applique désormais **sous 768 px** (R1). Les deux colonnes de 768–1023 remplacent la ligne correspondante du handoff §5 | — |
| 6 | Page introuvable : mise en page du panneau de connexion, texte provisoire | **Accepté** | Texte [P] consigné dans `states.md` §4 : « Page introuvable », « Cette adresse ne correspond à aucune page d'Aegis Manager. », « Retour à l'accueil » |
| 7 | `lang="fr-CA"` | **Accepté** | Conforme au handoff §7 |

Clé d'apparence implémentée : `aegis.manager.appearance`. **Acceptée** et
reportée dans le handoff.

## 5. Contrastes mesurés sur l'implémentation (pixels rendus)

**Méthode :**

1. Le build `dist-preview` est servi tel quel; son rendu est identique au
   pixel près aux captures.
2. Chromium (Playwright), à 1× : 1440 × 900, 390 × 844 et 320 × 720.
3. Le thème est forcé par `aegis.manager.appearance`.
4. Pour chaque texte, la boîte est localisée dans le DOM et la couleur
   calculée est lue.
5. Le texte est rendu transparent, ainsi que les icônes et les cellules en
   tirets. On échantillonne le fond **sous** la boîte, sur une grille
   17 × 5 avec un retrait de 2 à 14 px selon le rayon.
6. On garde le **pire** ratio WCAG.

C'est la même méthode que pour `handoff.md`, annexe B (outil jetable, hors
dépôt). Les paires communes coïncident : section à venir 5,21 contre 5,20,
promesse 8,71 contre 8,71, légende 9,00 contre 8,99.

| Texte | Clair | Sombre |
|---|---|---|
| Barre latérale : section à venir (sur verre) | **5,21** | 5,45 |
| Légende « Section à venir » (sur verre) | 9,00 | 9,60 |
| Section courante | 6,97 | 7,88 |
| Marque « Manager » dans la barre latérale (verre) | 8,05 | 7,71 |
| Barre supérieure mobile, 390 px : « Manager » (verre) | 8,64 | 8,86 |
| Barre supérieure mobile, 390 px : « Aegis » (verre) | 15,75 | 12,72 |
| Onglet « Modèles » (verre, avant R6) | 8,76 | 9,16 |
| Méta du casier (atmosphère) | 8,24 | 8,03 |
| Barre « Aperçu visuel » | 7,30 | 8,42 |
| Bande « Mode aperçu » | 7,30 | 8,42 |
| Accueil : texte de promesse, 1440 et 390 px | 8,71 | 10,86 |
| Accueil : pied | 8,71 | 10,86 |
| Connexion : pied « Technicien ? » sur l'atmosphère, 1440 px | 6,01 | 7,66 |
| Connexion : pied, 320 px | 6,28 | 8,10 |
| Connexion : « Accueil » (verre fort) | 6,97 | 7,91 |

**Résultat :** tout passe AA. Minimum : 5,21:1 (section à venir sur le verre
clair), égal à la référence. Après R6, « Modèles » passera en `--ag-text-3` :
même rôle et même fond que la section à venir, donc environ 5,2:1, **à
remesurer**.

## 6. Ce qui reste à vérifier, hors de cette revue

- La suite axe de l'implémentation (`npm run test:a11y`), dont le résultat
  doit être joint par le web-engineer.
- Un lecteur d'écran (VoiceOver ou NVDA) : annonces d'alerte, compte à
  rebours, bascule du mot de passe, tiroir.
- Clavier réel, Safari et Firefox, contraste élevé Windows réel.
- Après correction : de nouvelles captures des états touchés par R1 à R3 et
  R6, à 1440, 1280, 390 et 320 px et au zoom 200 %, en clair et en sombre.

## 7. Questions pour Philippe

Elles sont inchangées et figurent dans `handoff.md` §14 (Q1–Q7). Cette revue
ajoute deux textes à approuver :

- « Ce mot de passe n'est pas accepté. Vérifiez-le, puis réessayez. » (R5);
- le texte de la page introuvable (écart 6).
