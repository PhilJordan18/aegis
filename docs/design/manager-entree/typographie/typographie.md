# Aegis Manager — choix de la police Web

Date : 30 septembre 2026. Mode : Prototype.

**Décision de conception : Geist**, avec Geist Mono pour le détail technique.
Inter est écartée. Philippe approuvera le choix sur le rendu implémenté.

## Méthode

Le même contenu français est composé dans les deux familles, côte à côte,
dans `specimen.html` :

- titre d'affichage à 72 px;
- « Connexion »;
- texte courant;
- libellés de 12 à 14 px;
- identifiants;
- heures et dates en chiffres tabulaires;
- longue raison de blocage;
- messages d'erreur;
- rangées denses d'équipement;
- petites tailles;
- glyphes ambigus.

Les rendus viennent de Chromium (Playwright) à 1440 px de large, en 1×, page
entière, en clair et en sombre : `specimen-light.png` et `specimen-dark.png`.
Le moteur de rendu a confirmé le chargement réel de « Geist Variable »,
« Geist Mono Variable » et « Inter Variable ».

Les fichiers testés sont **ceux que le produit auto-hébergera** : les paquets
Fontsource épinglés en 5.3.0. Les fonctions OpenType ont été sondées par
comparaison de pixels, avec et sans chaque fonction. Les builds officiels
amont ont été sondés aussi : ils contiennent davantage de fonctions, mais ne
seront pas livrés (voir plus bas).

## Comparaison

| Critère | Geist (+ Geist Mono) | Inter |
|---|---|---|
| Licence vérifiée | SIL OFL 1.1 : texte lu dans `LICENSE` du paquet npm et dans `LICENSE.txt` du dépôt `vercel/geist-font` (« Copyright (c) 2023 Vercel, in collaboration with basement.studio »). Aucun nom de police réservé | SIL OFL 1.1 : texte lu dans `LICENSE` du paquet et dans `LICENSE.txt` du dépôt `rsms/inter` (« Copyright (c) 2016 The Inter Project Authors »). Aucun nom réservé |
| Source officielle | https://github.com/vercel/geist-font (distribuée aussi par Google Fonts) | https://github.com/rsms/inter (https://rsms.me/inter) |
| Paquet npm du produit | `@fontsource-variable/geist` 5.3.0 et `@fontsource-variable/geist-mono` 5.3.0. Le paquet officiel `geist` 1.7.2 n'exporte pas ses fichiers de police (exports limités à `next/font`) : inutilisable proprement avec Vite | `@fontsource-variable/inter` 5.3.0, fichier `opsz.css`, ou `inter-ui` 4.1.1 pour le build complet |
| Axes variables | `wght` 100–900 | `wght` 100–900, `opsz` 14–32 (coupe d'affichage automatique) |
| Français (É À Ç Œ œ « » ’, capitales accentuées, U+202F) | Complet dans le sous-ensemble latin (plage `U+0152-0153`, `U+2000-206F`) : vérifié au rendu | Complet (même plage) : vérifié au rendu |
| Chiffres tabulaires | Oui (`tnum` actif dans le build Fontsource) | Oui |
| I / l / 1 | **Distincts par défaut** : le `l` a une queue, le `1` un drapeau | **I et l identiques** (deux barres) dans le build Fontsource. La désambiguïsation (`ss02`, `cv05`, `cv08`) n'existe que dans le build amont complet (`inter-ui`, 99,7 Ko en latin) |
| 0 / O | Distincts par la chasse (0 étroit, O rond); zéro barré disponible seulement dans le build amont (`ss09`) | Distincts par la chasse; zéro barré seulement dans le build amont (`zero`) |
| Chasse fixe | Geist Mono, même dessin. **Attention : son 0 et son O se confondent**; réservée aux codes machine, jamais aux identifiants d'actif | Aucune : il faudrait une troisième famille |
| Poids woff2 mesuré (sous-ensemble latin variable) | Geist 29,4 Ko + latin-ext 16,5 Ko; Geist Mono 23,1 Ko | Inter `wght` 48,3 Ko, `opsz` 72,9 Ko; latin-ext `wght` 85,1 Ko |
| Petites tailles (11–12 px) | Nettes et plus étroites; œil un peu plus petit qu'Inter; lisible à 12 px, 11 px réservé aux marqueurs | Très lisibles (grand œil), mais plus larges |
| Largeur (texte français réel) | Plus compacte : la phrase de promesse tient sur 2 lignes dans la colonne du spécimen | Plus large : 3 lignes pour la même phrase et la même colonne; la raison de blocage frôle la largeur d'une rangée |
| Identifiants tabulaires (`MM-001`) | Serrés et homogènes | Chiffres tabulaires larges : `MM - 001` paraît espacé |
| Titre d'affichage à −0,045 em | Net, géométrique, sans heurt entre accents et lignes serrées | Excellent grâce à `opsz`, caractère plus neutre |

## Choix et compromis

**Geist**, pour quatre raisons observées sur les rendus :

1. **Désambiguïsation sans fonction OpenType :** elle survit au sous-ensemble
   Fontsource, qui retire les jeux stylistiques. Avec Inter, il faudrait
   livrer le build amont (99,7 Ko en latin) pour distinguer I et l.
2. **Compacité :** elle garde les longues phrases françaises et les raisons
   de blocage sur une ligne de moins dans les rangées denses.
3. **Chasse fixe de la même famille :** elle porte les surtitres et les codes
   machine, le principe « détail en chasse fixe » de la référence Next.js,
   sans troisième famille.
4. **Poids :** environ 69 Ko pour les deux familles et leurs sous-ensembles
   latins, contre au moins 121 Ko pour Inter `opsz` avec son latin-ext.

**Compromis accepté :**

- **Association à Vercel :** Geist est la police de Vercel et de Next.js,
  l'une des références. Le risque est d'avoir l'air d'une copie. On le
  compense par l'identité bleu–indigo, la signature de la cellule attendue et
  une composition différente : panneau opaque sur atmosphère, une seule
  action.
- **Petites tailles :** l'œil de Geist est plus petit à 11–12 px qu'avec
  Inter. Le texte produit ne descend donc pas sous 12 px (marqueurs fictifs :
  11 px, 650).
- **Zéro barré :** absent du build livré. Les identifiants restent
  distinguables par la chasse et par la règle ci-dessous.

**Règles qui en découlent (reprises dans `handoff.md`) :**

- Les identifiants d'actif et de casier (`MM-002`, `AEGIS-DEMO-01 · A2`)
  s'écrivent en **Geist Sans** avec `font-variant-numeric: tabular-nums`,
  jamais en Geist Mono.
- Geist Mono est réservé aux surtitres en capitales, aux numéros 01–05, au
  `traceId` et aux codes techniques d'audit.
- Aucune famille n'est chargée depuis un CDN dans le produit : import des
  paquets npm, `font-display: swap`, pile de repli système.

## Fichiers

- `specimen.html` : le spécimen. Les polices sont chargées depuis jsDelivr,
  pour le spécimen seulement, dans les versions épinglées.
- `specimen-light.png` et `specimen-dark.png` : les rendus inspectés.
- Sondage des fonctions (`tnum` seul dans les builds Fontsource; `ss01`–`ss10`
  pour Geist et `ss01`–`ss08`, `cv01`–`cv13`, `zero` pour Inter dans les
  builds amont) : scripts jetables hors dépôt; les résultats sont consignés
  ici.
