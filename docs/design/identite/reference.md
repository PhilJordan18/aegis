# Identité Aegis — référence commune Web et iOS

Direction « Lumière du hub », révision v3 **sans illustration du matériel**,
retenue par Philippe le 21 octobre 2026, avec le logo provisoire Aegis Core. Les
versions finales du logo viendront du designer de Philippe. Issue : #79.

**Propriété.** Cette référence et le dossier `assets/` appartiennent à la
session API/Web, pour Philippe, comme le glossaire de la localisation (`docs/localisation/glossaire.md`, issue #78).
La session iOS propose ses ajouts ou corrections par message ou dans l'issue
concernée. Chaque plateforme garde ses propres maquettes : `docs/design/manager-*`
pour le Web, `docs/design/mobile-*` pour iOS.

## Sources

| Fichier | Rôle |
|---|---|
| `v3/aegis-design-v3-sans-hub.html` | Aperçu sombre, clair et présentation du logo |
| `v3/aegis-lumiere-du-hub-v3.html` | Source de la maquette mobile |
| `assets/aegis-core-logo.svg` | Signature complète pour fond clair (400 × 100) |
| `assets/aegis-core-logo-dark.svg` | Signature complète pour fond sombre (400 × 100) |
| `assets/aegis-core-mark.svg` | Symbole seul (64 × 64) |
| `assets/aegis-core-mark-dark.svg` | Symbole seul pour fond sombre (64 × 64), extrait sans modification du groupe de `aegis-core-logo-dark.svg` par la session iOS |

Les fichiers fournis sont conservés tels quels; le symbole sombre en est extrait sans autre changement. La maquette mobile est une
référence d'identité : ni du code à reproduire au pixel près, ni une mise en page
à agrandir pour le Web.

## Ce qui définit l'identité

- le logo abstrait : un A géométrique ouvert avec un noyau central, sans lien
  avec le casier;
- la typographie, la composition resserrée et la lumière localisée;
- deux apparences franchement différentes qui partagent la même hiérarchie et
  les mêmes composants.

Sur les écrans d'entrée des applications : ni hub, ni cellules, ni illustration
3D, ni anneaux décoratifs. Les schémas matériels et la documentation du projet ne
sont pas concernés.

## Palettes sémantiques (valeurs de la maquette v3)

| Rôle | Sombre profond | Clair minéral |
|---|---|---|
| Fond | `#070C13` | `#F5F7FB` |
| Bandeau supérieur | `#070D17` | `#EDF2FA` |
| Surface, panneau | `#0D1520` | `#FFFFFF` |
| Champ | `#141F2D` | `#F3F5F9` |
| Texte | `#F1F5FC` | `#122339` |
| Texte secondaire | `#ABB9CD` | `#53647B` |
| Bordure | `#2B3B50` | `#D7DFE9` |
| Accent (liens, mise en valeur) | `#8CAEFF` | `#234BCE` |
| Bouton principal | `#315EE8`, texte `#FFFFFF` | `#234BCE`, texte `#FFFFFF` |
| Noyau du logo (décoratif) | `#64D8EB` | `#087A9B` |
| Halo (lumière localisée) | `#193E7355` | `#92B8F73A` |
| Anneau de focus | `#70A7FF30` | `#5B81C32B` |
| Erreur : fond, texte | `#3B2024`, `#FFC9CB` | `#FFF0F1`, `#9E2837` |

Ces valeurs viennent de la maquette et restent à vérifier en contraste sur
chaque plateforme. Les anneaux de focus de la maquette sont translucides : chaque
plateforme garantit un indicateur de focus conforme (WCAG 2.2 AA).

**Couleurs métier.** Les statuts (prêt, bloqué, à vérifier, en cours, anomalie)
gardent leur sens et leurs rôles de chaque plateforme; ils ne sont pas définis par
la v3 et doivent être revérifiés sur les nouveaux fonds. Le cyan du noyau est
décoratif : il ne signifie jamais « disponible », « connecté » ni « sécurisé ».

## Règles d'usage du logo

- Utiliser les fichiers fournis, sans les redessiner, les recolorer, les étirer
  ni leur ajouter ombre, halo ou contour. Garder les proportions (signature
  4 : 1, symbole 1 : 1).
- Signature claire sur fond clair, signature sombre sur fond sombre; symbole seul
  quand la place manque.
- Rendre l'asset remplaçable : un seul composant ou une seule ressource par
  plateforme, sans copie du tracé dans le code.
- Limite connue : dans les deux signatures, « aegis » et « CORE » sont du texte
  SVG en police Inter (Arial à défaut). Leur rendu varie selon l'appareil tant
  que le designer n'a pas converti ce texte en tracés. Le symbole seul, sans
  texte, n'a pas cette limite.
- Lisibilité (en-tête, deux fonds, petites tailles) et taille minimale : à
  mesurer dans les rendus de chaque plateforme avant d'être fixées ici.
- Le nom et le logo ne se traduisent pas.

## Marque commune et noms d'application (proposition)

« Aegis Core » est une proposition de signature graphique; rien n'est renommé
sans décision de Philippe.

- **Option A, recommandée pour le P0 :** la marque commune est « Aegis », portée
  par le symbole. Chaque application garde son nom : Aegis Manager (Web), Aegis
  Mobile (iOS), Aegis Control (API). L'en-tête d'une application montre le
  symbole suivi du nom de l'application en texte. La signature complète
  « aegis | CORE » ne s'affiche que là où la marque commune se présente seule,
  par exemple un écran d'entrée ou un document.
- **Option B :** « Aegis Core » devient le nom de la plateforme, et les
  applications des modules (« Aegis Core · Manager »). Cette option renomme des
  textes visibles, de la documentation et peut-être des identifiants : elle
  demande une décision explicite avant toute modification.

## Hiérarchie

1. Marque, puis signature texte, puis titre de l'écran.
2. Une seule action principale par écran.
3. La lumière localisée accompagne la marque; elle n'éclaire ni le formulaire ni
   les messages d'erreur.
4. Aucun faux indicateur « connecté » ou « sécurisé » avant l'authentification.

## Plateformes

- **Web :** adapté au bureau, au clavier et à l'administration (barre latérale,
  listes, dossiers); sélecteur d'apparence existant conservé.
- **iOS :** natif (HIG), apparence du système, sans sélecteur de thème dans cette
  tranche.

## Vocabulaire

Les termes métier suivent le glossaire de la localisation (`docs/localisation/glossaire.md`, issue #78). Textes
proposés, à valider par Philippe :

- signature « Prêt. Autorisé. Prouvé. » / « Ready. Authorized. Proven. »
  (« Prêt » au sens de `READY`);
- « Espace technicien » / « Technician access » (iOS).

## Décisions ouvertes

- Articulation de la marque et des noms d'application (option A ou B).
- Typographie : le Web utilise Geist (autohébergée), iOS la police du système,
  le texte des signatures SVG la police Inter.
- Conversion en tracés du texte des signatures par le designer.
- Tailles minimales du logo, après mesure dans les rendus.
- Validation des textes de signature en français et en anglais.
