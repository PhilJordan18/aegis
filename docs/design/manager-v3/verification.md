# Aegis Manager v3 — vérifications du prototype

Mode : Prototype. Date : 21 octobre 2026. Issue : #79. Complète `README.md`.

**Portée.** Ces mesures valent pour le **prototype statique** (`prototype/`), rendu
dans Chromium (Playwright 1.63, Chromium headless, macOS), pas pour
`apps/admin-web`, qui n'est pas modifié. Elles ne remplacent ni la lecture par un
lecteur d'écran (VoiceOver, NVDA), ni un essai sous Windows en contraste élevé,
ni un navigateur Safari ou Firefox. Les scripts sont dans `verify/` et se
relancent avec `node verify/<script>.mjs` (Playwright vient de
`apps/admin-web/node_modules`, après `npm ci`, sans modifier de fichier suivi).
Les sorties brutes sont dans `verify/*-output.txt`.

Le prototype ne fait aucune requête réseau (mesuré : 0 requête hors `file://`
sur la connexion et sur le shell) et n'a eu aucune erreur de console.

## 1. Contraste WCAG 2.2 AA

### 1.1 Tous les textes visibles, mesurés sur les pixels rendus

`verify/contrast.mjs` rend le texte transparent, échantillonne les pixels sous la
boîte de chaque ligne (halo compris) et retient la pire paire. Seuil : 4,5:1
(3:1 pour un texte de 24 px ou plus).

- 56 pages (9 états de connexion × FR/EN × sombre/clair à 1440 px, connexion à
  390 px, shell à 1440 et 390 px, tiroir) : **1 276 textes mesurés, 0 échec**.
- Minimum global : **5,37:1 en sombre** et **5,04:1 en clair**; dans les deux cas
  il s'agit du libellé du bouton **verrouillé** (429, état d'apparence désactivée,
  exempté par WCAG mais gardé lisible). Bouton nominal : 5,39:1 sombre, 7,07:1 clair.

| Paire (pire cas mesuré sur le rendu) | Sombre | Clair |
|---|---|---|
| Texte courant sur la carte | 16,49 | 15,47 |
| Texte secondaire sur la carte / sur le champ | 9,02 / 8,44 | 6,05 / 5,69 |
| Texte secondaire sur le fond de page sous le halo | 8,61 | 5,10 |
| Promesse « Prouvé. » (accent) sous le halo | 7,94 | 5,96 |
| Libellé du bouton principal | 5,39 | 7,07 |
| Libellé du bouton verrouillé (état désactivé) | 5,37 | 5,04 |
| Lien « Afficher », « Accueil » (accent) | 7,79 | 6,54 |
| Libellé de champ | 16,49 | 15,47 |
| Texte d'erreur sur son fond (alerte, message de champ) | 10,32 / 12,48 | 6,75 / 7,47 |
| Alerte d'avertissement (titre et corps) | 10,17 | 6,58 |
| Alerte d'information (titre et corps) | 8,79 | 6,83 |
| Identifiant de suivi (`traceId`, Geist Mono) | 13,64 | 13,99 |
| Pastilles de statut (pire) | 9,17 | 5,75 |
| Navigation (élément courant sur fond sélectionné) | 7,36 | 5,25 |
| Annotation d'aperçu (hors produit) | 8,42 | 7,30 |

### 1.2 Éléments non textuels (1.4.11) et indicateurs de focus (2.4.11)

| Paire | Sombre | Clair | Verdict |
|---|---|---|---|
| **Bordure de champ de la maquette v3 (`--border`) / carte** | 1,60 | 1,39 | **Échec (< 3:1)** |
| Bordure de champ de la maquette v3 / champ | 1,49 | 1,30 | **Échec** |
| **Bordure de champ retenue (`--control-border`, ajout) / carte** | 3,53 | 3,48 | Réussite |
| Bordure de champ retenue / champ | 3,30 | 3,27 | Réussite |
| Bague translucide de la maquette (`--ring`) seule / carte | 1,39 | 1,21 | **Échec : jamais utilisée seule** |
| **Focus plein de 2 px (`--focus`, ajout) / carte** | 8,32 | 7,07 | Réussite |
| Focus / champ, fond de page, élément sélectionné | 7,79 / 8,98 / 7,36 | 6,65 / 6,54 / 6,08 | Réussite |
| Bordure d'un champ en erreur / carte | 12,48 | 7,47 | Réussite |
| Symbole d'erreur / fond d'alerte | 10,32 | 6,75 | Réussite |
| Symbole d'avertissement, d'information / fond | 10,17, 8,79 | 6,58, 6,83 | Réussite |
| Symbole « prêt » / fond de pastille | 7,67 | 4,24 | Réussite (≥ 3) |
| Bouton principal / carte (limite visuelle) | 3,37 | 7,07 | Réussite |
| Symbole du logo (A) / page, carte | 8,98, 8,32 | 6,54, 7,07 | Réussite |
| Noyau du logo / page, sous le halo, carte | 11,73, 10,38, 10,87 | 4,55, 4,15, 4,92 | Réussite |
| **Symbole clair fourni sur fond sombre** (raison de `aegis-core-mark-dark.svg`) | A 2,75, noyau 3,96 | | **Échec du A** |

La bague de focus de la maquette (translucide) et la bordure de champ de la
maquette ne suffisent pas sur le Web : le prototype ajoute `--control-border`
et `--focus` (voir README, jetons ajoutés).

### 1.3 Focus mesuré sur les pixels

`verify/keyboard.mjs` : pour chaque arrêt de tabulation, anneau de 2 px mesuré
dans la capture contre le fond uni voisin (meilleur de gauche, haut et bas, un côté
pouvant toucher un élément voisin). Résultat : **16 parcours sur 16 réussis**
(5 états de connexion et shell, sombre et clair, 1440 et 390 px), anneau de
**6,29:1 à 8,98:1**, jamais obscurci par la barre supérieure collante.
Un premier essai a révélé un défaut corrigé : dans le sélecteur FR/EN, l'anneau du
bouton « EN » chevauchait le bouton « FR » plein (1,98:1 sur ce côté); l'écart est
passé de 2 à 4 px et le décalage de l'anneau à 1 px.

## 2. Clavier

Ordre mesuré, connexion à 1440 px (identique en sombre et clair, FR et EN) :

1. lien d'évitement « Aller au contenu principal » (visible au focus, pas dans le
   parcours si la page commence au contenu);
2. marque (lien vers l'accueil, nom accessible « Aegis Manager, accueil »);
3. « Accueil »;
4. « Français », « English » (`aria-pressed`);
5. champ courriel, champ mot de passe, « Afficher » (`aria-controls`);
6. « Se connecter » (reste focusable, `aria-disabled="true"`, quand il est
   verrouillé par le 429);
7. à 390 px, « Accueil » n'existe plus (masqué sous 480 px; la marque mène à
   l'accueil).

Changement par rapport au validé (`manager-entree/handoff.md` §8) : l'ordre
est marque → Accueil (le lien « Accueil » précédait la marque), et deux
boutons de langue s'ajoutent (maquette de Philippe).

Rôle non autorisé : marque → Accueil → langues → « Se connecter avec un autre
compte ». Shell à 1440 px : marque → « Équipements » (seule section courante,
focusable) → menu du compte. Compact : marque → « Menu ». Tiroir : le focus va à
« Fermer le menu » à l'ouverture, **Échap ferme et rend le focus à « Menu »**
(`dialog` modal natif). Sélecteur de langue : Entrée applique la langue, garde
le focus sur le bouton, et retraduit l'alerte affichée.

Non couvert par le prototype : le menu du compte (ouverture, Échap, clic
extérieur), qui n'est pas dessiné.

## 3. Zoom à 200 %, 320 px, 390 px, FR et EN, deux apparences

`verify/reflow.mjs` inspecte **256 rendus** : 9 états de connexion et le shell (et
son tiroir) × FR/EN × sombre/clair × 6 tailles : zoom à 200 % d'une fenêtre de
1280 × 800 (soit 640 × 400 px CSS à 2x), 390, 320, 768, 1024 et 1440 px. Il
vérifie le défilement horizontal, le texte hors écran ou débordant de son
conteneur (bouton, alerte, pastille, champ, carte), le contenu masqué par
`overflow` et les cibles de moins de 24 px.

**Résultat : 0 problème sur 256 rendus** (aucun défilement horizontal, aucun
texte rogné, aucune cible sous 24 × 24 px). Longueurs critiques couvertes :
« Reservations and loans » (EN, 280 px de barre latérale, sur une ligne),
`traceId` de 32 caractères (coupure libre), message de champ de 66 caractères,
sélecteur de langue à 320 px.

Règles de repli retenues (maquette de Philippe) : sous 720 px la carte passe en
premier et la promesse disparaît; sous 480 px « Accueil » disparaît; sous
360 px, « Manager » disparaît de la marque (le symbole et « aegis » restent).

## 4. Axe-core (WCAG 2.0 A/AA, 2.1 A/AA, 2.2 AA, bonnes pratiques)

`verify/axe.mjs`, 84 pages (connexion et shell, FR/EN, sombre/clair, 1440 et
390 px, tiroir) : **0 violation**.

Un premier passage signalait 36 violations `region` (promesse hors repère) :
corrigé en plaçant la promesse dans un `aside` étiqueté « Aegis ».

Restent 40 points « à vérifier » (`incomplete`), que l'outil ne sait pas décider :
36 `color-contrast` (texte posé sur le dégradé du halo, couvert par la mesure sur
pixels du §1.1) et 4 `aria-valid-attr-value` (`aria-controls` du bouton « Menu »
vers un `dialog` fermé, à confirmer avec un lecteur d'écran).

## 5. Saut de mise en page à l'apparition d'une erreur

`verify/cls.mjs` mesure le déplacement vertical des deux champs, du bouton
« Afficher », du bouton principal et de la carte quand on passe de l'état nominal
à chaque état, avec l'alerte à deux emplacements :

| Transition vers… | Alerte **sous le bouton** (proposé) | Alerte **au-dessus du formulaire** (validé, `states.md`) |
|---|---|---|
| Identifiants refusés | **0 px** | 84,6 px (390 px : 125,2) |
| Trop de tentatives | **0 px** | 84,6 px |
| Service injoignable | **0 px** | 84,6 px |
| Erreur du service (avec `traceId`) | **0 px** | 164,4 px (390 px : 223,2) |
| Session expirée | **0 px** | 104,9 px (390 px : 145,5) |
| Envoi en cours | **0 px** | 0 px |
| Validation (adresse invalide de 2 lignes + mot de passe vide) | 19,2 px | 19,2 px |

Parcours réel (champ vide, correction, envoi, refus) avec l'alerte sous le
bouton : **0 px** à 1440 et 390 px. Le message de champ réserve une ligne ; il
ne reste qu'un saut d'une ligne (19 px), lorsque le message d'adresse invalide
passe sur deux lignes. L'animation d'apparition (fondu et 4 px) est une
transformation : elle ne décale pas la mise en page, et elle est supprimée en
mouvement réduit. La carte est ancrée en haut (pas de centrage vertical), donc sa
croissance ne déplace pas son bord supérieur.

## 6. Textes : aucune clé visible, aucun texte non traduit

`verify/i18n.mjs`, 44 pages (FR/EN × sombre/clair, tous les états, shell et
tiroir) : chaque texte visible, `aria-label`, titre et attribut `lang` appartient au
dictionnaire de la langue demandée; aucun texte du dictionnaire de l'autre
langue, aucune clé (`a.b`), aucun `undefined`, `null` ni `{{ }}`. **0 problème.**
Exceptions admises et nommées : « Français » et « English » (noms de langue dans
leur langue), « Aegis », « Manager », « Audit », « Anomalies », codes d'actif et
de casier, courriels de démonstration. Le sélecteur de langue du prototype ne
choisit ni ne retient la langue : cela relève de #78.

## 7. Lisibilité du logo

Mesures de `verify/logo.mjs` et de `captures/logo-legibilite-fr-dark-light-1400.png`
(symbole fourni de 12 à 48 px, composant de marque de 16 à 40 px, quatre fonds).

**Symbole** (`aegis-core-mark.svg` en clair, `aegis-core-mark-dark.svg` en sombre) :

| Taille | Constat à 1x | À 2x |
|---|---|---|
| 12 px | A reconnaissable, noyau de 3 px à peine distinct | noyau net |
| 16 px | **A lisible**; noyau de 4 px, visible comme un point | net |
| 20 px | **A et noyau losange distincts** (5 px) | net |
| 24 px | Plus petite taille retenue pour l'interface (noyau de 6 px) | net |
| 32 px et plus | Aucun défaut | net |

- Contraste noyau / fond mesuré sur pixels : 10,3 à 11,7:1 en sombre, **4,4 à 4,9:1 en
  clair** (le plus bas à 12 px), donc au-dessus de 3:1 à toutes les tailles.
- **Plus petite taille lisible du symbole : 16 px** (silhouette seule, noyau comme
  point), **20 px** pour voir le noyau comme un losange. **Recommandé : 24 px
  dans l'interface** (valeur que la session iOS propose aussi); l'en-tête du
  prototype utilise 28 à 32 px, l'écran de connexion 30 px.
- **Composant de marque** (symbole + « aegis » en Geist + « Manager »), mesuré de
  16 à 40 px de symbole : lisible partout, mais serré à 16 px (mot de 12,8 px,
  « Manager » de 11 px); rien n'a été essayé en dessous. Recommandé : symbole de
  28 px pour l'ensemble, 24 px en compact.

**Signatures SVG fournies** (non utilisées dans les rendus, décision de Philippe
du 21 octobre) :

- le texte « aegis » et « CORE » est du **texte SVG vivant**. Dans Chromium sur
  cette machine, **Inter n'est pas installée** : il s'affiche en **Arial
  (système)**, « aegis » en Arial gras. Position de la fin du mot dans le
  viewBox 400 × 100 : 223,1 (séparateur à 255, écart de 31,9) avec Arial; **245,4
  avec Verdana** (police de repli plus large), soit un écart de seulement 9,6 :
  une police de repli encore plus large heurterait le séparateur, parce que les
  positions x du texte sont fixes;
- « CORE » est composé en 18 unités sur 400 : à 200 px de large il mesure 9 px, à
  160 px 7,2 px, à 144 px 6,5 px (illisible dans le rendu). Limite de lisibilité
  observée : **signature d'au moins 200 px de large**; en dessous, symbole seul;
- le rendu du texte n'est pas fiable hors Chromium sans Inter (constat aussi fait
  par iOS dans Xcode) : à convertir en tracés par le designer.

## 8. Ce que ces mesures ne prouvent pas

- La lecture au lecteur d'écran des alertes, du compte à rebours (volontairement
  hors zone vivante), du changement de langue et du tiroir.
- Le zoom réel du navigateur (simulé par 640 × 400 px CSS à 2x), Safari, Firefox,
  Windows en contraste élevé (les règles `forced-colors` sont écrites, pas vues).
- Les polices de repli d'un poste sans Geist : Geist est servie par le bundle.
- La conformité des couleurs de statut au-delà des paires mesurées ici.
