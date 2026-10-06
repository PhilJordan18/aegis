# Aegis Manager — handoff : accueil, connexion, shell, aperçu Équipements

## En bref (pour Philippe)

- **Direction :** traitement A « Verre lumineux » étendu. Verre réservé à la
  navigation; formulaires, alertes et données sur surfaces opaques.
- **Signature :** la *cellule attendue*, une grille de compartiments dont
  une seule cellule est allumée, toujours entière.
- **Typographie :** **Geist** (rôles d'affichage, de titre, de texte,
  d'identifiant tabulaire) et **Geist Mono** (surtitres, codes machine).
  Licence OFL 1.1, auto-hébergée (`@fontsource-variable` 5.3.0). Inter est
  écartée : I et l identiques dans le build livrable, plus large, plus
  lourde. Titre de 40 à 72 px; le texte produit ne descend pas sous 12 px.
  Les codes d'actif s'écrivent en Geist Sans tabulaire, jamais en Mono.
- **Familles de jetons** (`tokens.css`, clair et sombre) :
  - surfaces, texte, bordures, accent et dégradé;
  - focus;
  - statuts `ready`, `blocked`, `unknown`, `progress`, `anomaly`, `info`,
    `neutral` (toujours symbole, forme et texte);
  - annotation `mock`;
  - verre, avec ses replis opaques;
  - atmosphère et cellule allumée;
  - ombres teintées;
  - typographie, espacement, rayons, tailles, mouvement (240 ms au plus).
- **Composants :**
  - Button (principal, secondaire, fantôme; occupé, verrouillé, désactivé);
  - TextField et PasswordField;
  - Alert (erreur, avertissement, information);
  - StatusChip;
  - GlassPanel et Surface;
  - SidebarNav (courant, à venir);
  - Cells (signature);
  - AccountMenu, AppearanceSwitch;
  - marque, SkipLink;
  - bande et barre d'aperçu;
  - figure d'exemple.

**Comportement adaptatif :**

| Largeur | Accueil | Connexion | Manager |
|---|---|---|---|
| 1440 | Héros 7/12 et atmosphère 5/12, 5 garanties | Panneau de 440 px centré sur l'atmosphère, cellule allumée à côté | Barre latérale de verre de 264 px, liste de 440 px et dossier |
| 1280 | Idem | Idem | Liste de 380 px; dossier défilant avec ombres |
| 1024 | Garanties sur 3 colonnes | Idem | Idem |
| 768 | Héros sur 1 colonne, garanties sur 2 | Idem | Barre supérieure de verre et tiroir; liste, puis dossier |
| 390 | Pile; figure sous les cellules | Panneau pleine largeur, sans cellule allumée | Idem 768 |
| 320 | Aucun défilement horizontal | Idem | Idem |
| Zoom 200 % | Dispositions de 640 à 720 px (tablette et mobile) | | |

État : implémenté dans `apps/admin-web`; revue `review.md` : **REVISE**
(R1 à corriger avant ta revue visuelle).

---

Mode : Prototype, puis handoff pour l'implémentation. Date : 30 septembre
2026, révisé le 1er octobre après la revue d'implémentation. Plateforme :
Web (React). Destinataire : web-engineer (`apps/admin-web/`).

**Statut.** Traitement A étendu, sous l'autonomie accordée par Philippe. La
police, les jetons et les textes [P] sont **proposés**. La porte
d'approbation est la revue visuelle de Philippe sur l'implémentation rendue
(captures dans `captures/`). Ce document ne vaut pas approbation.

**Sources, par ordre de priorité :**

1. `02-scope.md` §11.1 et §11.10;
2. ADR-007 (registre `13`);
3. `09` §4, §7, §10.2–10.3, §21 et §23.4;
4. `../asset-lifecycle/sections.md` §1, §3, §5 et U6;
5. `services/api/README.md`.

**Artefacts liés :**

- `tokens.css` : **source unique des valeurs**, à transcrire;
- `states.md` : états, textes, focus et annonces;
- `typographie/typographie.md` : choix de la police;
- `wireframes/` : filaires;
- `reference/` : rendu de référence, non normatif; ses classes ne sont pas
  une API de composants.

## 0. À ne pas rater

1. **Jeton :** en mémoire seulement. Jamais dans `localStorage` ni
   `sessionStorage`, jamais dans l'URL. La préférence d'apparence est la
   seule chose persistée (`localStorage`, clé `aegis.manager.appearance`, lecture et
   écriture dans un `try/catch`).
2. **Rôle :** `user.role !== 'ADMIN'` après un 200. On efface le jeton
   **avant** tout rendu, on n'appelle aucune route et on affiche
   `role-non-autorise`. Le client ne décide rien d'autre : le serveur reste
   juge (403 `FORBIDDEN`).
3. **Messages serveur :** on n'affiche jamais `detail` ni `title`. Les textes
   sont ceux du client, choisis selon `code` et `violations[].field`.
4. **Identifiants :** en **Geist Sans + `tabular-nums`**, jamais en Geist
   Mono, dont le 0 et le O se confondent.
5. **Débordement à 320 px :**
   - l'`<input>` placé à côté de « Afficher » déborde sans
     `flex: 1 1 0; width: 0; min-width: 0`;
   - tout conteneur grille ou flex d'un formulaire prend
     `grid-template-columns: minmax(0, 1fr)` ou `min-width: 0`;
   - un panneau centré avec `place-items: center` impose aussi
     `minmax(0, 1fr)`.

   Défaut constaté puis corrigé sur le rendu de référence.
6. **Verre :** jamais derrière un formulaire, une alerte ou une donnée. Les
   champs, alertes, listes et dossiers sont sur `--ag-surface`, opaque.
7. **Couleurs forcées :** les règles du §9.9 sont obligatoires. Sans elles,
   l'alerte perd sa boîte, l'interrupteur disparaît et la sélection devient
   invisible (constaté).
8. **Une seule lumière par vue :** au plus une cellule allumée, **toujours
   visible à 100 % ou absente**, jamais coupée ni recouverte. Règle de
   placement au §6 (« Cells »), corrigée par la revue (R1). Elle ne porte
   jamais d'état, elle est `aria-hidden` et disparaît en transparence
   réduite et en couleurs forcées.
9. **Mode aperçu :** jamais dans le build de production (code éliminé).
   Visuellement, il ne ressemble jamais au produit.
10. **Données de l'aperçu :** l'aperçu Équipements affiche la bande « Aperçu
    visuel » tant que les données ne viennent pas de l'API.

## 1. Polices

Installer `@fontsource-variable/geist` et `@fontsource-variable/geist-mono`
(5.3.0), puis importer `index.css` une fois à la racine. Les familles
exposées sont `"Geist Variable"` et `"Geist Mono Variable"`, en
`font-display: swap`. Les piles complètes sont `--ag-font-sans` et
`--ag-font-mono` (`tokens.css`). Il s'agit d'une nouvelle dépendance, à
signaler dans la PR. La licence OFL 1.1 est incluse dans les paquets. Aucun
CDN.

Réglages globaux :

- `-webkit-font-smoothing: antialiased`;
- `font-optical-sizing: auto` (sans effet sur Geist, inoffensif);
- `tabular-nums` sur toute heure, date, durée, compte à rebours, code
  d'actif et de casier.

## 2. Jetons de couleur

Toutes les valeurs sont dans `tokens.css`. Le thème clair est défini sur
`:root`, le sombre sur `[data-theme="dark"]`. L'application pose
`data-theme` (résolu) et `data-appearance` (préférence) sur `<html>` avant la
première peinture, avec un script en ligne dans `index.html` et un
`try/catch` autour de `localStorage`.

### 2.1 Surfaces, texte, bordures, accent

| Rôle | Clair | Sombre |
|---|---|---|
| `--ag-canvas` | `#F3F5FA` | `#050A1C` |
| `--ag-surface` / `-raised` | `#FFFFFF` / `#FFFFFF` | `#0C1430` / `#111B3D` |
| `--ag-surface-sunken` | `#EDF1F8` | `#080F26` |
| `--ag-surface-selected` | `#E7EDFF` | `#16255A` |
| `--ag-text` / `-2` / `-3` | `#0A1330` / `#3A4563` / `#56627F` | `#EDF1FF` / `#B6C0DE` / `#939FC4` |
| `--ag-text-disabled` sur `--ag-disabled-bg` | `#6B7591` sur `#E3E8F2` | `#8791B0` sur `#1A2447` |
| `--ag-border` / `-strong` / `--ag-separator` | `rgba(10,19,48,.12)` / `.24` / `.09` | `rgba(170,190,255,.14)` / `.28` / `.12` |
| `--ag-control-border` | `#7A849E` | `#5F6C96` |
| `--ag-accent` / `-hover` / `-pressed` | `#1F4FE6` / `#1A45CC` / `#1A3FB8` | `#2F5CF0` / `#3F6BFF` / `#1F4FE6` |
| `--ag-accent-text` | `#1A45CC` | `#93B1FF` |
| `--ag-accent-soft` | `#E7EDFF` | `#16255A` |
| `--ag-accent-gradient` (bouton principal) | `135deg, #1F4FE6 → #4B3BD9` | `135deg, #2F5CF0 → #4B3BD9` |
| `--ag-focus` / `--ag-focus-halo` | `#1F4FE6` / `rgba(31,79,230,.22)` | `#93B1FF` / `rgba(147,177,255,.28)` |

### 2.2 Rôles de statut (fg texte · bg fond · icon symbole)

Chaque statut associe **symbole, forme et texte**. La couleur seule ne porte
jamais un statut. `--ag-glyph` (`#FFFFFF` en clair, `#06102A` en sombre)
dessine le glyphe intérieur.

| Rôle | Forme du symbole | Clair fg / bg / icon | Sombre fg / bg / icon | Usage dans cette tranche |
|---|---|---|---|---|
| `ready` | cercle coché | `#0B6B3F` / `#E1F4EA` / `#12824D` | `#6FE3A8` / `#0E2E2A` / `#4ED393` | « En ligne » (casier) |
| `blocked` | octogone (barre, ou « ! » pour une erreur) | `#A3161A` / `#FCE7E6` / `#C8262B` | `#FFA59E` / `#3A1424` / `#FF7A70` | « 1 empêchement », alerte d'erreur, erreur de champ |
| `unknown` | losange (« ? », horloge, signal barré) | `#7A4B00` / `#FFF0D1` / `#A86400` | `#FFD27A` / `#33280F` / `#FFC247` | Alerte d'avertissement : trop de tentatives, service injoignable, mauvais rôle |
| `progress` | cercle avec arc | `#1A45CC` / `#E7EDFF` / `#1F4FE6` | `#A9C0FF` / `#16255A` / `#93B1FF` | « Disponible » (disponibilité administrative, reprise du prototype); opérations futures |
| `anomaly` | triangle avec « ! » | `#9A2F00` / `#FFE9DE` / `#CC4A0A` | `#FFB08A` / `#3A1C12` / `#FF8A57` | Réservé à Anomalies; non utilisé ici |
| `info` | cercle « i » | `#1A45CC` / `#EEF3FF` / `#1F4FE6` | `#A9C0FF` / `#111F4D` / `#93B1FF` | Alerte d'information : session expirée ou invalide, déconnecté |
| `neutral` | cercle « i », gris | `#3A4560` / `#E7EBF3` / `#58627C` | `#C8CFE6` / `#1A2447` / `#A4AFCC` | « Aucun empêchement détecté » (jamais vert, `09` §8.9) |
| `mock` (annotation) | losange au trait, tirets | `#8E1277` / `#FCEAF8` / bordure `#B8349B` | `#FF9CE8` / `#3A1336` / bordure `#E57AD0` | Marqueurs fictifs, bande et barre d'aperçu |

### 2.3 Verre, atmosphère, signature, ombres

| Jeton | Clair | Sombre |
|---|---|---|
| `--ag-glass-bg` / `-strong` | `rgba(255,255,255,.64)` / `.82` | `rgba(18,28,64,.58)` / `rgba(14,22,52,.82)` |
| `--ag-glass-border` / `-edge` | `rgba(255,255,255,.80)` / `rgba(10,19,48,.08)` | `rgba(170,190,255,.16)` / `rgba(0,0,0,.40)` |
| `--ag-glass-blur` / `-sat` | `28px` / `180%` | idem |
| `--ag-glass-fallback` (opaque) | `#F7F9FE` | `#0F1838` |
| `--ag-atmos-page` | 2 halos radiaux et un dégradé à 160° `#DCE6FF → #EEF2FC → #F3F5FA → #ECEEFF` | Halos bleu et indigo; dégradé `#0B1847 → #060C24 → #050A1C → #0B0B33` |
| `--ag-atmos-panel` (accueil) | Halo `#DCE6FF`, halo `#4B3BD9`; dégradé `#8EABFF → #3366FF → #3B2DB0` | Halos bleu et indigo; dégradé `#0F2160 → #0A1440 → #1A1566` |
| `--ag-cell-line` / `-line-page` | `rgba(255,255,255,.30)` / `rgba(31,79,230,.16)` | `rgba(169,192,255,.18)` / `rgba(147,177,255,.10)` |
| `--ag-cell-lit-fill` / `-glow` (panneau de l'accueil) | `#FFFFFF → #DCE6FF`; halos blanc puis indigo | `#DCE6FF → #8EABFF`; halos bleu puis indigo |
| `--ag-cell-lit-fill-page` / `-glow-page` (atmosphère de la connexion; ajout de la revue R1) | `#8EABFF → #3366FF`; filet blanc, halo bleu `rgba(51,102,255,.45)` puis indigo | Identiques à `--ag-cell-lit-fill` / `-glow` |
| `--ag-shadow-panel` / `-float` / `-chrome` / `-primary` | Teinte `22,49,138` (bleu profond) | Teinte noire |

Le verre ne sert qu'à la **barre latérale**, au **sélecteur d'onglets** et à
la **barre supérieure compacte** (< 1024 px). Repli opaque
(`--ag-glass-fallback`, sans `backdrop-filter`) dans trois cas :
`@supports not (backdrop-filter)`, `prefers-reduced-transparency: reduce`,
et `forced-colors: active`. Dans les deux derniers cas, l'atmosphère et la
grille disparaissent (`display: none`).

## 3. Typographie (Geist)

Toutes les tailles sont en rem : le zoom du texte les agrandit. Les valeurs
entre parenthèses sont en px pour une racine à 16 px.

| Rôle | Taille | Interligne | Graisse | Approche | Autre |
|---|---|---|---|---|---|
| `display` (titre de l'accueil) | `clamp(2.5rem, 1.35rem + 3.9vw, 4.5rem)` (40 → 72) | 0,98 | 600 | −0,045 em | Points finaux en `--ag-accent-text` |
| `title-xl` (« Connexion », titre de page) | 2rem (32) | 1,1 | 600 | −0,03 em | |
| `title-lg` (titre du dossier) | 1,625rem (26) | 1,15 | 600 | −0,025 em | |
| `title-md` (garantie, titre de panneau) | 1,0625rem (17) | 1,3 | 600 | −0,01 em | |
| `lead` | 1,0625rem (17) | 1,55 | 400 | 0 | `--ag-text-2`, mesure 38 em au plus |
| `body` | 0,9375rem (15) | 1,5 | 400 | 0 | |
| `label` (libellé de champ) | 0,8125rem (13) | 1,3 | 600 | 0 | |
| `caption` (aide, méta) | 0,8125rem (13) | 1,4 | 400 | 0 | `--ag-text-2` |
| `small` (minimum pour le texte produit) | 0,75rem (12) | 1,35 | 400–500 | 0 | |
| `overline` | 0,75rem (12), **Geist Mono** | 1,2 | 500 | 0,06 em | Capitales, `--ag-text-2` |
| `status` (pastille) | 0,8125rem (13) | 18 px | 600 | 0 | Grande pastille : 15 px |
| `id` (code d'actif ou de casier) | 0,875rem (14) | 1,3 | 500 | 0 | Geist Sans, `tabular-nums`, `white-space: nowrap` |
| `code` (`traceId`, codes) | 0,8125rem (13), **Geist Mono** | 1,35 | 450 | 0 | `word-break: break-all` |
| `brand` | 20 / 15 px | 1 | 650 / 500 | −0,035 / −0,01 em | « Aegis » `--ag-text`, « Manager » `--ag-text-2` |
| Marqueur fictif | 11 px | 1 | 650 | 0,01 em | Seul texte à 11 px |

### 3.1 Densité d'Équipements (liste maîtresse et dossier)

| Élément | Spécification |
|---|---|
| Rangée de liste (élément) | Padding 14 × 16 px, rayon 18. Hauteur mesurée au rendu : 111 px sans raison, 135 px avec raison (1440 px, largeur de liste 440). Écart de 6 px entre rangées |
| Ordre dans la rangée | Pastille de statut (13/600) → raison (`--ag-eq-reason-size` 14/1,35/500, +6 px) → nom (18/1,25/600/−0,015 em, +8 px) et code (13/500 tabulaire, `--ag-text-2`) → faits (13/1,35/400, `--ag-text-2`, +4 px) |
| Rangée sélectionnée | `--ag-surface-selected`, bordure `--ag-border`, `aria-current="true"` (couleurs forcées : bordure 2 px `Highlight`) |
| En-tête de liste | 15/600 à gauche (« 2 exemplaires »), méta 12 px à droite; padding 18/20/10 |
| Pied de liste | 12 px `--ag-text-2`, filet `--ag-separator` |
| Dossier | Padding 24 × 32 px; surtitre (overline) → titre `title-lg` → sous-titre 14 px |
| Bloc de diagnostic | Rayon 20, padding 16 × 20, fond `--ag-blocked-bg` (ou `--ag-surface-sunken` s'il est vide); raison 16/1,35/600; note 13/1,45 `--ag-text-2` |
| Deux colonnes | Écart de 32 px; faits en `dl` (libellé 13 `--ag-text-2`, valeur 15/500); réglages en champs de 44 px |
| Zone défilante du dossier | `tabIndex=0`, `role=group`, étiquetée par le titre. **Ombres de défilement** en haut et en bas (revue R3) : fonds `local` `--ag-surface` sur 28 px et ombres `scroll` `rgba(var(--ag-shadow-tint), .16)` sur 12 px (copie dans `reference/reference.css`, `.dossier__scroll`) |
| Pied de dossier | Padding 14 × 32 px; lien « Historique dans Audit » à gauche, action à droite. En dessous de 1440 px, l'indice « Aucune modification » devient un `aria-describedby` masqué |

## 4. Espacement, rayons, tailles, élévation, mouvement

- **Espacement :** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80
  (`--ag-space-1…11`). Gouttière : `clamp(16px, 2.2vw, 32px)`.
- **Rayons :**

  | Jeton | Valeur | Usage |
  |---|---|---|
  | `--ag-r-atmos` | 32 | Panneau d'atmosphère |
  | `--ag-r-panel` | 28 | Barre latérale, liste, dossier, panneau de connexion (20 sous 768 px) |
  | `--ag-r-card` | 20 | Bloc de diagnostic, carte du compte, menu |
  | `--ag-r-item` | 18 | Rangée de liste |
  | `--ag-r-control` | 12 | Champ, bouton, alerte |
  | `--ag-r-small` | 8 | Petit bouton, élément de menu (marqueur fictif : 4) |
  | `--ag-r-cell` | 12 | Cellule de la signature |
  | `--ag-r-pill` | 999 | Pastille de statut, onglets |

- **Tailles :** contrôle 44 px, 36 px en petit, 48 px en grand. Barre
  latérale 264 px, panneau de connexion 440 px au plus. Cible pointeur d'au
  moins 24 × 24 px (WCAG 2.5.8), 44 px pour les contrôles principaux.
- **Élévation :**
  - `--ag-shadow-panel` pour les panneaux;
  - `--ag-shadow-float` pour la connexion, le menu et la figure d'exemple;
  - `--ag-shadow-chrome` pour la barre latérale;
  - `--ag-shadow-primary` pour le bouton en dégradé;
  - `--ag-inset-hi` pour le reflet intérieur.

  Aucune autre ombre.
- **Mouvement :**

  | Durée | Usages |
  |---|---|
  | `--ag-motion-fast` 120 ms | Survol, appui, focus |
  | `--ag-motion-base` 200 ms | Apparition d'alerte (opacité et −4 px), menu, fondu de thème |
  | `--ag-motion-slow` 240 ms | Tiroir de navigation sous 1024 px |

  Courbes : `--ag-ease-out` `cubic-bezier(.2,.8,.2,1)` et `--ag-ease-in-out`.
  L'indicateur d'envoi tourne en 800 ms, en continu. En
  `prefers-reduced-motion: reduce`, toutes les transitions passent à 0 ms et
  l'indicateur s'arrête (anneau statique; le texte « Connexion… » porte
  l'état). Aucun état n'est porté par le mouvement; aucune animation
  d'entrée.

## 5. Points de rupture et comportement adaptatif

| Largeur | Accueil | Connexion | Shell | Aperçu Équipements |
|---|---|---|---|---|
| ≥ 1440 (bureau) | Héros sur 12 colonnes, texte 7/12 et atmosphère 5/12 (hauteur ≥ 540); titre à 72 px; 5 garanties en ligne | Atmosphère plein écran, panneau centré de 440 px; cellule allumée juste derrière le bord supérieur droit du panneau | Barre latérale en verre détachée (marge de 16 px) de 264 px; contenu sur la couche d'atmosphère | Liste de 440 px et dossier fluide; faits et réglages sur 2 colonnes |
| 1280–1439 (portable) | Idem; titre environ 71 px | Idem | Idem | Liste de 380 px; pied de dossier sans indice visible |
| 1024–1279 | Garanties sur 3 colonnes | Idem | Idem | Liste de 320–380 px; le dossier passe sur 1 colonne sous environ 700 px de largeur utile |
| 768–1023 (tablette) | Héros sur 1 colonne; atmosphère de 320 px sous les actions; garanties sur 2 colonnes (écart 5 accepté) | Idem | Barre latérale remplacée par une **barre supérieure en verre** (marque et bouton « Ouvrir le menu »), avec un **tiroir modal** (`<dialog>`, focus piégé, Échap, retour du focus) contenant les 6 sections et le compte | Liste pleine largeur, puis dossier en dessous (sélection par URL `/apercu/equipements/:code` dès que les routes existent) |
| < 768 et 390 (mobile) | Titre de 40 px sur 3 lignes; bouton principal pleine largeur; **la figure d'exemple passe dans le flux sous les cellules** (atmosphère `padding: 120px 12px 12px`, figure en `position: relative`), cellule allumée d'index 9; garanties en pile. Bouton « Se connecter » de l'en-tête en `nowrap` (R2) | Panneau pleine largeur, rayon 20, sans centrage vertical | Idem tablette | Idem tablette |
| 320 (reflow) | Aucun défilement horizontal (mesuré) | Aucun défilement horizontal (mesuré après correction) | Idem | Aucun défilement horizontal (mesuré) |
| Zoom à 200 % | Correspond à 720 px (1440) ou 640 px (1280) : dispositions tablette et mobile ci-dessus. Aucun `vh` fixe sur les contenus textuels (`min-height`, jamais `height`, sauf pour le shell ≥ 1024). Le focus n'est jamais masqué par un élément collant | | | |

## 6. Composants

| Composant | Anatomie et états |
|---|---|
| **Button** | Variantes : `primary` (dégradé, `--ag-shadow-primary`, texte `--ag-text-on-accent`), `secondary` (`--ag-surface`, texte `--ag-accent-text`, bordure `--ag-border-strong`), `ghost` (transparent, texte accent). Tailles : 36, 44 et 48 px; padding de 14, 18 et 22 px; rayon 12 (10 en petit); libellé 15/600 (16 en grand, 14 en petit); icône de 18 px, écart de 8. États : survol (dégradé plus sombre), appui (translation de 1 px), focus (§8), **occupé** (indicateur à gauche, libellé « Connexion… », `aria-disabled="true"`, `cursor: progress`, clic ignoré), **désactivé** (`disabled`, `--ag-disabled-bg` et `--ag-text-disabled`, sans ombre, avec une raison visible à côté). **Verrouillé** (429 avec `Retry-After`) : apparence désactivée, mais `aria-disabled="true"` au lieu de `disabled`, pour garder le focus; activation ignorée (écart 1 accepté). `white-space: nowrap` dans l'en-tête de l'accueil seulement; ailleurs, le libellé peut passer à la ligne à 320 px. Un seul `primary` par vue |
| **TextField** | Libellé 13/600 au-dessus (`<label for>`), contrôle de 44 px, rayon 12, bordure 1 px `--ag-control-border` (3,74:1). Focus : bordure et contour 2 px `--ag-focus` avec halo de 5 px. Erreur : bordure 1,5 px `--ag-blocked-icon`, `aria-invalid="true"`, message sous le contrôle (symbole de 16 px et texte 13/500 `--ag-blocked-fg`), relié par `aria-describedby`. `readOnly` pendant l'envoi : fond `--ag-surface-sunken`. Pas de texte indicatif (le libellé suffit) |
| **PasswordField** | TextField avec un bouton texte « Afficher »/« Masquer » à droite du contrôle (34 px de haut, 13/600 accent, survol `--ag-accent-soft`). `type="button"`, `aria-controls` vers le champ. Au basculement, annonce `role="status"` masquée : « Votre mot de passe est visible. » / « Votre mot de passe est masqué. » [P]. Retour à masqué avant chaque envoi. Le focus reste sur le bouton |
| **Alert** | Grille de 20 px + 1fr; padding 12 × 14; rayon 12; bordure 1 px transparente (visible en couleurs forcées). Titre 14/650 en couleur de rôle; corps 14/1,45 `--ag-text`; `code` optionnel en mono. Variantes : `error` (`blocked`, `role="alert"`), `warning` (`unknown`, `role="alert"`), `info` (`info`, `role="status"`). Jamais de fermeture manuelle à la connexion : l'alerte disparaît au prochain envoi |
| **Callout** | Rappel permanent, hors de cette tranche : `--ag-surface-sunken`, rayon 8, symbole accent (voir le prototype, `.ag-callout`) |
| **StatusChip** | Pastille : padding 3/10/3/4, écart de 6, symbole de 18 px en `--*-icon`, texte 13/600 en `--*-fg` sur `--*-bg`. Grande : 15 px, symbole de 20. Variante `plain` sans fond, pour les tables. `white-space: nowrap`; le texte ne se tronque jamais (la rangée passe à la ligne) |
| **GlassPanel ou Surface** | `GlassPanel` : `--ag-glass-bg`, flou de 28 et saturation de 180 %, bordure `--ag-glass-border`, trois replis opaques. Réservé à la navigation (barre latérale, barre supérieure, onglets). `Surface` : `--ag-surface`, bordure `--ag-border`, `--ag-shadow-panel`, rayon 28; tout le reste |
| **SidebarNav item** | 44 px, rayon 14, padding 0/10/0/12, icône de 20 px, écart de 10, libellé 15/500. **Courant** : `<a aria-current="page">`, `--ag-surface`, texte et icône `--ag-accent-text` 600, ombre douce, repère lumineux de 4 × 16 px à 4 px du bord gauche (`--ag-cell-lit-fill` et halo bleu); en couleurs forcées, contour 2 px `Highlight`. **À venir** : `<span aria-disabled="true">`, non focusable, texte et icône `--ag-text-3`, cellule en tirets de 12 × 12 px (rayon 3,5, 1,5 px `--ag-text-3`) à droite, texte masqué « , à venir ». Légende unique sous la liste : cellule et « Section à venir » (12 px). Aucune page vide « en construction ». **Onglet interne à venir** (« Modèles ») : même traitement (`aria-disabled`, non focusable, `--ag-text-3`, `cursor: default`, cellule en tirets de 10 × 10 px après le libellé, texte masqué « , à venir ») (R6). Ordre imposé : Vue d'ensemble, Équipements, Réservations et prêts, Casiers, Anomalies, Audit |
| **Cells (signature)** | Deux couches `aria-hidden` de **même géométrie** : (1) la grille de traits, masquée radialement; (2) une couche superposée **sans masque**, où seule la cellule allumée est visible (`visibility: hidden` pour les autres). La cellule n'est jamais rognée, recouverte ni ternie. **Connexion :** grille de 14 colonnes, cellules de 72 px, écart de 14, centrée; index **38** (rangée 2, colonne 10) à partir de 768 px, à 45 px du panneau, avec `--ag-cell-lit-fill-page` / `-glow-page`; **aucune cellule allumée sous 768 px** (zoom 200 % compris). **Accueil :** 6 colonnes; index **15** à partir de 768 px, **9** en dessous, avec `--ag-cell-lit-fill` / `-glow`. Test : à 1440, 1280, 1024, 768, 640, 480, 390 et 320 px, la cellule est absente ou entièrement visible, à 16 px au moins de la figure ou du panneau. Masquée en transparence réduite et en couleurs forcées |
| **AccountMenu** | Déclencheur : bouton pleine largeur (`aria-expanded`, `aria-controls`); avatar de 36 px aux initiales (dégradé accent, `aria-hidden`), nom 14/600 (passage à la ligne permis), rôle « Administrateur » 12 px, chevron. Panneau : `Surface` rayon 20, `--ag-shadow-float`, ouvert au-dessus du déclencheur, padding 14, écart de 12. Il contient le nom et le courriel, un filet, le fieldset « Apparence », un filet, puis « Se déconnecter » (bouton de 38 px, icône de sortie). Motif de divulgation, pas un `role="menu"` : Tab parcourt, Échap ferme et rend le focus, un clic extérieur ferme. Aucun libellé d'institution (C6 non normatif) |
| **AppearanceSwitch** | `<fieldset>` avec `<legend>` « Apparence », trois `input type=radio` natifs (Système, Clair, Sombre) en contrôle segmenté : piste `--ag-surface-sunken`, rayon 12, padding 3; option cochée sur `--ag-surface` avec ombre (couleurs forcées : contour `Highlight`). Flèches natives; application immédiate; Système suit `prefers-color-scheme` en direct |
| **Brand wordmark** | Monogramme de 26 px (carré de 24 à rayon 7, deux filets en croix, cellule inférieure droite en dégradé `#3366FF → #4B3BD9`), « Aegis » 20/650 et « Manager » 15/500. Lien vers `/` avec `aria-label` « Aegis Manager, accueil ». En couleurs forcées, le cadre utilise `currentColor` (constaté invisible sinon). **Provisoire** : aucun logo approuvé |
| **SkipLink** | Premier élément focusable du shell : « Aller au contenu principal », vers `#contenu` (`<main tabindex="-1">`). Masqué hors écran, visible au focus en haut à gauche sur `--ag-surface` avec `--ag-shadow-float` |
| **Preview switcher** | Bande **dans le flux**, en haut du document (ni fixe ni flottante) : hauteur ≥ 36 px, `--ag-mock-bg`, texte `--ag-mock-fg` 13/600, bordure inférieure en tirets `--ag-mock-border`, losange au trait. Texte : « Mode aperçu — aucune connexion réelle, données fictives ». Selects « État » et « Thème » à droite. `role="region"`, `aria-label` « Mode aperçu ». Rendue seulement si `import.meta.env.DEV` ou si un indicateur de build d'aperçu explicite est actif; éliminée du build de production. En mode aperçu, aucune requête réseau n'est émise |
| **Barre d'aperçu (Équipements)** | Sous l'en-tête de page : rayon 10, `--ag-mock-bg`, bordure en tirets, « Aperçu visuel » 13/600 `--ag-mock-fg`, puis texte `--ag-text`. Les boutons de la vue sont `aria-disabled="true"` et `aria-describedby` vers cette barre |
| **Figure d'exemple (accueil)** | `Surface` rayon 20 posée sur l'atmosphère. Surtitre « Diagnostic d'un exemplaire » et marqueur « Exemple illustratif ». Deux mini-rangées (MM-002 avec 1 empêchement et sa raison; MM-001 sans empêchement). `<figure>` avec `<figcaption>` |

## 7. Textes (français)

Les textes de la connexion, de tous les états et du shell sont dans
`states.md` §3–4, avec leur statut [A] ou [P]. Ceux de l'accueil, tous
**[P]**, sont les suivants.

- **En-tête :** marque à gauche; bouton secondaire « Se connecter » à droite.
- **Surtitre :** « Aegis Manager · console d'administration ».
- **Titre :** « Autorisé. Observé. Tracé. » : un mot par ligne à toutes les
  largeurs, avec `<br>`.
- **Promesse :** « Aegis montre si chaque équipement critique peut servir,
  n'ouvre que la cellule attendue et conserve une chaîne de possession
  complète, du retrait au retour. »
- **Actions :**
  - « Se connecter » (bouton principal, grand, flèche) vers `/connexion`;
  - lien « Voir les cinq garanties » vers `#garanties`.
- **Mention :** « Compte fourni par votre administrateur. » [A].
- **Garanties** (liste ordonnée, `aria-label` « Cinq garanties du P0 ») :
  1. **Disponibilité réelle** — « Chaque équipement indique s'il peut
     servir; sinon, la raison précise : calibration expirée, maintenance,
     absence de sa cellule. »
  2. **Retrait conforme** — « Le serveur refuse un retrait non autorisé ou
     non conforme; l'interface l'explique, elle ne le décide pas. »
  3. **Bonne cellule** — « Seule la cellule attendue s'ouvre, après une
     autorisation valide. Une réservation ou un code affiché n'ouvre rien. »
  4. **Preuve physique** — « Retrait et retour sont confirmés par des
     observations cohérentes du casier, jamais par un simple clic. »
  5. **Chaîne de possession** — « Chaque action et chaque observation
     restent consultables dans l'audit, sans effacement. »
- **Pied :**
  - « Prototype académique en cours de validation en laboratoire, conçu
    pour les équipes de maintenance et d'inspection. »
  - « Technicien ? Utilisez l'application Aegis sur iPhone. »
- **Titres de document :** « Aegis Manager », « Connexion — Aegis
  Manager », « Équipements — Aegis Manager ».
- **Langue :** `lang="fr-CA"`. Espace insécable avant « : ; ? ! » et dans
  « 10 h 30 » et « 8 sept. 2026 »; `white-space: nowrap` sur les dates et les
  codes.

## 8. Focus et clavier

- **Anneau de focus :** `outline: 2px solid var(--ag-focus);
  outline-offset: 2px`, avec un halo `0 0 0 6px var(--ag-focus-halo)`.
  Contraste mesuré : 5,41 à 6,33:1 en clair, 6,90 à 9,35:1 en sombre.
  L'anneau n'est jamais supprimé et jamais masqué par un élément collant.
- **Ordre de tabulation :**
  - accueil : marque → « Se connecter » (en-tête) → « Se connecter »
    (héros) → « Voir les cinq garanties »;
  - connexion : « Accueil » → marque → courriel → mot de passe →
    « Afficher » → « Se connecter »;
  - shell : lien d'évitement → marque → sections courantes → compte →
    contenu.
- **Changement de route :** le focus va au `h1` (`tabindex="-1"`), sauf pour
  les règles de connexion de `states.md`. Le titre du document est mis à
  jour.
- **Tout est opérable au clavier;** aucune action ne dépend du survol.

## 9. Accessibilité (à vérifier sur l'implémentation)

1. **Contraste mesuré sur les jetons :** 0 échec sur 59 paires × 2 thèmes.
   Minimums :
   - texte 5,37:1 (`--ag-text-3` sur `--ag-surface-sunken`, clair);
   - bordure de champ 3,52:1 (sombre);
   - symboles de statut 3,95:1 (`anomaly-icon` sur `anomaly-bg`, clair).

   Script jetable; les paires sont reproduites en annexe A.
2. **Contraste mesuré sur les fonds rendus** (texte masqué, pixels du fond
   échantillonnés sous la boîte du texte, pire cas retenu) : voir l'annexe B.
   Minimum : 5,20:1, pour « section à venir » sur le verre clair. À
   remesurer sur l'implémentation, en particulier le texte posé sur le verre
   et l'atmosphère.
3. **Landmarks :** `header`, `nav` (aria-label « Sections »), `main`,
   `footer`; un seul `h1` par vue; niveaux de titre ordonnés.
4. **Formulaire :**
   - libellés visibles liés aux champs;
   - erreurs liées par `aria-describedby`, avec `aria-invalid`;
   - annonces sans vol de focus (`states.md`);
   - aucun `maxlength` sur le mot de passe;
   - gestionnaires de mots de passe compatibles (`autocomplete`).
5. **Couleurs forcées (obligatoire) :**
   - `.alert`, `.chip` et les barres d'aperçu ont une bordure transparente
     de 1 px, qui devient visible;
   - alerte d'erreur et d'avertissement : 2 px `CanvasText`;
   - section courante : contour `Highlight`;
   - rangée sélectionnée : bordure 2 px `Highlight`;
   - piste de l'interrupteur : bordure 2 px `CanvasText` et fond
     `Highlight`, avec `forced-color-adjust: none`;
   - bouton désactivé : `GrayText`;
   - symboles de statut : `forced-color-adjust: none`, pour garder la forme
     et le glyphe;
   - atmosphère et grille : `display: none`.
6. **Transparence réduite et absence de `backdrop-filter` :** verre
   remplacé par `--ag-glass-fallback`; décor masqué. Vérifié sur le rendu
   `equipements-opaque-1440-dark.png`.
7. **Ce qu'une image ne prouve pas :**
   - la lecture par un lecteur d'écran (VoiceOver, NVDA) des alertes, du
     changement de mot de passe et du compte à rebours;
   - la navigation clavier réelle, dont le tiroir et le menu;
   - le zoom réel du navigateur;
   - le rendu Windows en contraste élevé;
   - les performances du flou.

   Ces points sont à exercer sur l'implémentation.

## 10. Icônes

- **Symboles de statut :** SVG en ligne, dessinés pour Aegis (repris du
  prototype, `lib/aegis.js`). La forme pleine est en `currentColor` et le
  glyphe en `--ag-glyph`.
- **Glyphes d'interface** (flèche, info, horloge, verrou, calendrier,
  chevrons, sortie, menu, plus, les 6 icônes de section) : même jeu en
  ligne, trait de 1,8 px, grille de 24 et `stroke-linecap: round`.
- **Dépendances :** aucune par défaut. Si le web-engineer préfère une
  bibliothèque, **Lucide** (ISC) est acceptable pour les glyphes
  d'interface, jamais pour les symboles de statut.
- **Accessibilité :** icônes décoratives en `aria-hidden="true"
  focusable="false"`; un bouton icône seul a un `aria-label`.

## 11. Liste d'acceptation

- [ ] Geist et Geist Mono servis depuis le bundle, sans aucune requête vers
      un CDN (onglet Réseau).
- [ ] Valeurs de `tokens.css` transcrites, avec les mêmes noms `--ag-*`,
      sans valeur en dur dans les composants.
- [ ] Les 12 états de `/connexion?apercu=` reproduisent textes, variante
      d'alerte, focus et annonce de `states.md` §3.
- [ ] 429 : délai issu de `Retry-After`, bouton désactivé, indice de
      décompte hors live region, réactivation annoncée une fois.
- [ ] Rôle technicien : jeton effacé, aucune requête après la connexion
      (onglet Réseau), écran de remplacement, retour au formulaire.
- [ ] 401 sur une route protégée : jeton effacé, `returnTo` interne validé,
      courriel prérempli, focus sur le mot de passe.
- [ ] Shell : 6 sections dans l'ordre; section courante avec
      `aria-current`; sections à venir non focusables avec « , à venir »;
      légende présente.
- [ ] Menu du compte : Échap, clic extérieur, retour du focus; Apparence
      appliquée immédiatement et persistée dans `aegis.manager.appearance`, jamais le
      jeton.
- [ ] Cellule allumée conforme à la règle « Cells » du §6, à toutes les
      largeurs testées (revue R1).
- [ ] `src/styles/tokens.css` recopié à l'identique de `tokens.css` (test de
      dérive au vert).
- [ ] Aperçu Équipements conforme à la densité du §3.1, avec la barre
      « Aperçu visuel » et les actions inactives décrites.
- [ ] Bande du mode aperçu absente du build de production (vérifier le
      bundle).
- [ ] Captures `captures/<route>-<state>-<viewport>-<theme>.png` à 1440, 1280,
      390, 320 et en zoom 200 % : aucun défilement horizontal, aucun
      chevauchement, aucune troncature.
- [ ] Couleurs forcées : les règles du §9.5 sont visibles sur une capture.
- [ ] Mouvement réduit : aucune transition; l'indicateur d'envoi est
      statique.
- [ ] Transparence réduite : verre opaque, décor absent.
- [ ] Contrastes remesurés sur les fonds rendus (texte sur verre et sur
      atmosphère).
- [ ] Aucun « Créer un compte », « Mot de passe oublié » ni libellé
      d'institution, nulle part.

## 12. Journal d'inspection du rendu de référence (constat → correction)

1. **Spécimen :** l'en-tête de la colonne Inter passait sur deux lignes et
   décalait toute la colonne → libellé raccourci.
2. **Filaire 390 px :** la page mesurait 456 px de large (panneau de 440 px
   centré avec `place-items`) → piste `minmax(0, 1fr)`.
3. **Accueil :** le mot « au retour. » restait seul sur sa ligne → mesure du
   texte de promesse portée à 38 em.
4. **Connexion :** la cellule allumée était cachée sous le panneau (signature
   absente) → déplacée pour luire derrière le bord supérieur droit.
5. **Connexion en sombre :** le masque radial ternissait la cellule allumée
   en gris → masque adouci.
6. **Connexion à 320 px :** les champs et l'alerte débordaient du panneau
   (largeur intrinsèque de l'`<input>`) → `width: 0; min-width: 0` et pistes
   `minmax(0, 1fr)`.
7. **Shell :** les étiquettes « À venir » faisaient passer « Vue
   d'ensemble » et « Réservations et prêts » sur deux lignes → cellule en
   tirets avec légende, barre latérale de 264 px.
8. **Dossier à 900 px de haut :** l'aide du champ de date était rognée →
   espacements verticaux resserrés.
9. **Pied de dossier à 1280 px :** passage sur deux lignes → indice masqué
   visuellement sous 1440 px.
10. **« Accueil » sur l'atmosphère claire :** contraste de 4,52:1 → pastille
    de verre fort, 6,95:1 mesuré.
11. **Couleurs forcées :** boîte d'alerte, interrupteur, section courante et
    sélection perdus → règles du §9.5. Une première règle a transformé les
    symboles de statut en disques → `forced-color-adjust: none` sur les
    symboles.

12. **Revue de l'implémentation (1er oct.) :** la cellule allumée n'était
    juste qu'à 1440 px → règle « Cells » à deux couches, index par largeur,
    jetons `-page`; ombres de défilement du dossier; bouton d'en-tête en
    `nowrap`; onglet « Modèles » à venir. Voir `review.md`.

**Auto-revue du rendu de référence (concepteur, non indépendante) : APPROVE**
pour la transmission à l'implémentation. Ce verdict ne vaut ni pour
l'implémentation, ni pour une approbation humaine.

## 13. Contrat et documentation

- **Aucune nouvelle route ni aucun nouveau champ.** Cette tranche n'utilise
  que `POST /auth/login` et, plus tard, `GET /auth/me`.
- **Défaut signalé (Q1) :** l'API envoie `Retry-After` sur le 429 de
  connexion (`LoginRateLimitedException`, testé à « 55 »), mais `09` §10.2
  et §21 ne documentent pas cet en-tête pour la connexion (il l'est pour
  `LOCAL_PROOF_RATE_LIMITED`). Le texte T1 en dépend; sinon, repli sur
  « Réessayez dans une minute. »
- **Défaut signalé :** ADR-007 est `ACCEPTED` dans le registre `13`, mais
  aucun fichier `docs/adr/ADR-007-*.md` n'existe. `CLAUDE.md` cite « Accepted
  ADRs in `docs/adr/` ».
- **Défaut signalé :** `09` ne précise pas si un compte désactivé qui détient
  encore un jeton reçoit `AUTH_TOKEN_INVALID` (401) ou `FORBIDDEN` (403). Le
  README de l'API dit « refusé immédiatement » sans code. Le client traite
  les deux (session invalide, ou `erreur-service` à la connexion).

## 14. Questions ouvertes pour Philippe

- **Q1.** Faut-il documenter `Retry-After` pour le 429 de `POST /auth/login`
  dans `09` et adopter T1 (« Réessayez dans 55 secondes. ») ?
- **Q2.** T2 : faut-il adopter, pour l'administrateur, « L'expiration ne
  modifie ni les réservations, ni les prêts, ni les opérations en cours. »,
  en gardant le texte iOS ?
- **Q3.** Le titre « Autorisé. Observé. Tracé. » et les cinq garanties de
  l'accueil conviennent-ils au ton du projet, y compris pour la
  démonstration devant l'enseignant ?
- **Q4.** Après un rechargement (jeton perdu), faut-il une note discrète
  « Pour votre sécurité, la session ne survit pas au rechargement de la
  page. » ? Elle exigerait un indicateur non secret en `sessionStorage`. Par
  défaut : aucune note.
- **Q5.** Faut-il reprendre la session sur la route d'origine (`returnTo`)
  après expiration, comme proposé ? Et, plus tard, conserver en mémoire un
  brouillon non enregistré ? Hors de cette tranche.
- **Q6.** Le monogramme à quatre cellules est provisoire. Faut-il le garder
  comme base d'un logo, ou revenir au mot-symbole seul ?
- **Q7.** Page d'arrivée après la connexion : `/apercu/equipements` dans
  cette tranche, puis Vue d'ensemble quand elle existera. D'accord ?

## Annexe A — contrastes des jetons (extrait)

| Paire | Clair | Sombre |
|---|---|---|
| `text` / `canvas` | 16,76 | 17,46 |
| `text-2` / `surface` | 9,50 | 10,00 |
| `text-3` / `surface-sunken` | 5,37 | 7,23 |
| `text-3` / `canvas` | 5,58 | 7,50 |
| `accent-text` / `surface-selected` | 6,49 | 6,90 |
| blanc / `accent` (bouton) | 6,33 | 5,37 |
| blanc / arrêt indigo `#4B3BD9` | 7,18 | 7,18 |
| `control-border` / `surface` | 3,74 | 3,52 |
| `focus` / `surface-selected` | 5,41 | 6,90 |
| `blocked-fg` / `blocked-bg` | 6,59 | 8,52 |
| `unknown-fg` / `unknown-bg` | 6,58 | 10,17 |
| `info-fg` / `info-bg` | 6,83 | 8,79 |
| `neutral-fg` / `neutral-bg` | 7,99 | 9,75 |
| `ready-fg` / `ready-bg` | 5,75 | 9,17 |
| `anomaly-icon` / `anomaly-bg` | 3,95 | 6,66 |
| `mock-fg` / `mock-bg` | 7,30 | 8,42 |
| `text-disabled` / `disabled-bg` (exempté) | 3,73 | 4,83 |

## Annexe B — contrastes mesurés sur les fonds rendus (1440 × 900)

| Texte (vue, thème) | Pire fond | Ratio |
|---|---|---|
| Texte de promesse (accueil, clair / sombre) | canevas | 8,71 / 10,86 |
| Mention (accueil, clair) | canevas avec halo | 8,48 |
| Bouton principal (accueil, clair / sombre) | dégradé | 6,42 / 5,59 |
| « Exemple illustratif » (accueil, clair / sombre) | marqueur | 7,30 / 8,42 |
| Pied « Technicien ? » (connexion, clair / sombre) | atmosphère | 5,69 / 7,36 |
| « Accueil » (connexion, clair / sombre) | verre sur atmosphère | 6,95 / 6,04 |
| Section à venir (shell, clair / sombre) | verre | 5,20 / 5,41 |
| Section courante (shell, clair) | surface | 6,28 |
| « Manager » (marque, clair / sombre) | verre | 8,05 / 7,63 |
| Onglet inactif (clair / sombre) | verre | 8,76 / 9,10 |
| Méta du casier (clair / sombre) | atmosphère | 8,32 / 10,39 |
| Barre d'aperçu (clair / sombre) | marqueur | 15,90 / 8,42 |
| Bouton principal (shell, clair / sombre) | dégradé | 6,43 / 5,53 |

## Rendus de référence (`reference/renders/`)

Nommage : `<vue>-<état>-<largeur>-<thème>.png`. Ensemble réduit le 1er octobre
2026 (18 fichiers, 5,6 Mo) aux équivalents de `captures/`, après les
corrections de la revue :

- **Accueil :** 1440 en clair et en sombre, 390 en clair.
- **Connexion :**
  - `inactif` : 1440 en clair et en sombre, 320 en clair;
  - `identifiants-refuses` : 1440 en clair, 390 en sombre, couleurs forcées;
  - `trop-de-tentatives` et `role-non-autorise` : 1440 en sombre;
  - `service-injoignable` et `session-expiree` : 1440 en clair.
- **Équipements :**
  - 1440 en clair;
  - menu ouvert, 1440 en sombre;
  - 1280 avec la bande d'aperçu;
  - opaque (transparence réduite), 1440 en sombre;
  - couleurs forcées.

Les autres états se rendent à la demande :
`reference.html?vue=…&etat=…&theme=…[&menu=1][&apercu=1][&transparency=reduce]`.
Le rendu passe par Chromium (Playwright). Les polices viennent de jsDelivr,
pour ce document seulement.
