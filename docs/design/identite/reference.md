# Identité Aegis — référence commune Web et iOS

Direction « Lumière du hub », révision v3 **sans illustration du matériel**,
retenue par Philippe le 21 octobre 2026, avec le logo provisoire Aegis Core. Les
versions finales du logo viendront du designer de Philippe. Issue : #79.

**Propriété.** Cette référence et le dossier `assets/` appartiennent à la
session API/Web, pour Philippe, comme le [glossaire](../../localisation/glossaire.md) de la localisation.
La session iOS propose ses ajouts ou corrections par message ou dans l'issue
concernée. Chaque plateforme garde ses propres maquettes : `docs/design/manager-*`
pour le Web, `docs/design/mobile-*` pour iOS.

## Sources

| Fichier | Rôle |
|---|---|
| `v3/aegis-design-v3-sans-hub.html` | Aperçu sombre, clair et présentation du logo |
| `v3/aegis-lumiere-du-hub-v3.html` | Source de la maquette mobile |
| `v3/web/aegis-web-v3-pour-claude.html` | Maquette Web interactive : thèmes et langues simulés, aucun appel au backend; police chargée depuis Google Fonts pour l'aperçu seulement |
| `v3/web/aegis-web-v3.html` | Source de la maquette Web |
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

Ces valeurs viennent de la maquette. Mesurées sur les rendus Web, la bordure des
champs (1,60 / 1,39:1) et l'anneau de focus translucide (1,39 / 1,21:1) n'atteignent
pas le contraste de 3:1 exigé pour les composants (WCAG 2.2, 1.4.11). Philippe a
adopté, le 21 octobre 2026, les corrections suivantes :

| Rôle ajouté | Sombre profond | Clair minéral | Mesure |
|---|---|---|---|
| Bordure des contrôles | `#5B6F88` | `#7A8BA1` | 3,53 / 3,48:1 |
| Focus : anneau plein de 2 px, décalé de 2 px | `#8CAEFF` | `#234BCE` | 6,29 à 8,98:1 sur les rendus |
| Élément sélectionné ou survolé | `#13213A` | `#E8EEFC` | Navigation |
| Contrôle désactivé : fond, texte | `#1A2437`, `#8A99AF` | `#E3E8F1`, `#52627A` | Bouton verrouillé après 429 |

Le halo translucide peut accompagner le focus, jamais le remplacer. Sur iOS, la
bordure passe à la couleur de texte secondaire avec « Augmenter le contraste ».

**Couleurs métier.** Les statuts (prêt, bloqué, à vérifier, en cours, anomalie)
gardent leur sens et leurs rôles de chaque plateforme; ils sont revérifiés sur les
nouveaux fonds. L'information utilise un bleu lisible, distinct des états de
succès, d'avertissement et d'erreur, sans teinte indigo (décision de Philippe,
21 octobre 2026). Le cyan du noyau est
décoratif : il ne signifie jamais « disponible », « connecté » ni « sécurisé ».

## Règles d'usage du logo

- Utiliser les fichiers fournis, sans les redessiner, les recolorer, les étirer
  ni leur ajouter ombre, halo ou contour. Garder les proportions (signature
  4 : 1, symbole 1 : 1).
- Dans les applications : symbole clair (`aegis-core-mark.svg`) sur fond clair,
  symbole sombre (`aegis-core-mark-dark.svg`) sur fond sombre, suivi du mot
  « aegis » en texte; le symbole seul quand la place manque. Les signatures
  complètes restent des références de présentation.
- Rendre l'asset remplaçable : un seul composant ou une seule ressource par
  plateforme, sans copie du tracé dans le code.
- Limite connue : dans les deux signatures, « aegis » et « CORE » sont du texte
  SVG en police Inter (Arial à défaut). Leur rendu varie selon l'appareil tant
  que le designer n'a pas converti ce texte en tracés. Le symbole seul, sans
  texte, n'a pas cette limite.
- Tailles mesurées sur les rendus Web : le A reste lisible dès 16 px et le noyau
  se lit comme un losange dès 20 px; 24 px est la taille minimale recommandée du
  symbole (iOS fait la même recommandation, rendu vérifié à 34 pt). Dans l'en-tête
  Web, le symbole mesure 28 px, 24 px en format compact.
- Le nom et le logo ne se traduisent pas.

## Marque commune et noms d'application

**Décisions de Philippe, 21 octobre 2026.** Aegis Studio est le collectif de
Jimmy et Philippe; Aegis est le produit. L'harmonisation des crédits « Aegis
Studio » est reportée à une tâche ultérieure, qui conserve les auteurs identifiés
et les ADR acceptés. La marque commune est « Aegis »,
portée par le symbole. Chaque application garde son nom : Aegis Manager (Web),
Aegis Mobile (iOS), Aegis Control (API). Sur les écrans d'entrée des deux
plateformes, la signature temporaire est le symbole suivi de « aegis » seul,
**sans « CORE »**, écrit dans la police de la plateforme. « Aegis Core » ne
renomme ni les applications, ni les modules, ni les routes. Les signatures SVG
complètes (`aegis-core-logo*.svg`) ne sont pas utilisées dans les applications.

## Typographie et logo sur le Web (décision de Philippe, 21 octobre 2026)

- Le Web conserve Geist, déjà autohébergé, sans nouvelle police; iOS garde la
  police du système et Dynamic Type. Les plateformes partagent la hiérarchie, les
  couleurs et le symbole, pas la police.
- Échelle Web : texte courant et champs 16 px, texte secondaire environ 14 px;
  graisse 400 pour le texte, 500 pour les libellés, 600 pour les titres; la grande
  promesse s'adapte à la largeur.
- Logo Web temporaire : `assets/aegis-core-mark.svg` (ou sa version sombre) suivi
  du mot « aegis » composé en Geist, dans un composant unique et remplaçable. Pas
  d'Inter ajouté pour les signatures SVG, pas de géométrie du symbole recopiée en
  CSS.
- À demander au designer pour les versions finales, attendues sous deux à sept
  jours : signatures vectorisées, versions mono, claire et sombre, petite taille et
  règles d'espacement.

## Composition Web

- En-tête : identité « Aegis » et « Manager », choix « Français / English ».
- Bureau : promesse typographique à gauche, formulaire à droite.
- Petit écran : le formulaire passe en premier.
- Aucun hub, coffre, orbite, console simulée ni métrique décorative; pas de
  lavande omniprésente.

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

Les termes métier suivent le [glossaire](../../localisation/glossaire.md).
Textes de marque retenus par Philippe le 21 octobre 2026 :

- signature commune « Prêt. Autorisé. Prouvé. » / « Ready. Authorized. Proven. »
  (« Prêt » au sens de `READY`);
- accroche secondaire « L’essentiel, sous contrôle. » / « What matters, under
  control. »;
- description « Disponibilité, conformité et traçabilité de vos équipements. » /
  « Equipment availability, compliance and traceability. ».

« Espace technicien » / « Technician access » reste une proposition d'iOS.

## Décisions ouvertes

- Versions finales du logo par le designer (attendues sous deux à sept jours) :
  signatures vectorisées, versions mono, claire et sombre, petite taille et
  règles d'espacement.
- Imposer ou non les formats `fr-CA` et `en-CA` sur iOS.
