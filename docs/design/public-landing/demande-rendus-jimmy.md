# Landing publique — demande de rendus à Jimmy (issue #153)

Direction retenue par Philippe : **A, « Mise en scène »** (`directions.md` §2). Le
casier suit la lecture et change d'état à chaque étape du parcours. Pour éviter
toute dépendance 3D dans le Web (`directions.md` §4, option recommandée), la page
utilise des **images pré-rendues** du casier réel, que la page compose avec le
contenu d'écran en HTML.

Tant que ces rendus ne sont pas livrés, les maquettes utilisent le substitut
dessiné (`directions/device.js`), marqué comme tel.

## 1. Ce qui est demandé, dans l'ordre

### 1.1 Indispensable : trois rendus, même caméra

Le contenu de l'écran du hub (attente, QR, vérification, résultat) est **composé
par la page**, pas rendu en 3D : il doit être traduit FR/EN, suivre le thème clair
ou sombre et rester du texte accessible. Il ne reste donc que trois géométries à
rendre :

| Fichier | Portes | Voyant A1 | Écran du hub | Sert aux étapes |
|---|---|---|---|---|
| `casier-ferme.png` | A1 et A2 fermées | éteint | éteint, surface neutre | héros, 1, 2, 3, 6 |
| `casier-a1-ouverte.png` | A1 ouverte, A2 fermée | éteint | éteint | 4 |
| `casier-ferme-voyant-a1.png` | A1 et A2 fermées | allumé | éteint | 5 |

Contraintes communes :

- **Caméra fixe et identique** pour les trois fichiers, au pixel près : vue trois
  quarts avant, légèrement plongeante, hub centré au-dessus des deux cellules, A1 à
  gauche et A2 à droite. Les trois images se superposent exactement; la page fond
  l'une dans l'autre.
- **Fond transparent** (PNG 32 bits), aucun décor, aucun dégradé. Une ombre de
  contact douce dans l'alpha est bienvenue; pas de sol rendu.
- **Un seul éclairage**, neutre, une source principale en haut à gauche, pour
  s'accorder avec le halo localisé de l'identité v3. Il doit tenir sur `#070C13`
  (sombre) et `#F5F7FB` (clair); on teste les deux sur place avant de demander une
  variante.
- **Écran du hub : surface uniforme, éteinte, sans reflet marqué**, pour que la
  page y superpose le contenu. Fournir en plus les **coordonnées en pixels des
  quatre coins de l'écran** dans l'image (mêmes pour les trois fichiers), ou un
  masque PNG de la zone écran.
- **Voyant A1 allumé** : vert proche de `#1E9E5A`, halo discret; éteint ailleurs.
- **Taille** : 2 400 px sur le grand côté, canevas identique pour les trois
  fichiers, marges d'au moins 5 % autour de l'objet. La conversion WebP/AVIF et
  les tailles réduites sont faites côté Web.
- **Fidélité** : seulement ce que le document 12 et le POC décrivent, un hub et
  deux cellules. Pas de troisième cellule, pas de logo, pas de texte imprimé, pas de
  marque inventée, pas de « CORE ».

### 1.2 Souhaitable, après 1.1 : une rotation du casier fermé

Pour permettre au visiteur de faire pivoter le casier dans le héros, sans WebGL :

- 24 vues de `casier-ferme`, rotation complète autour de l'axe vertical par pas de
  15°, mêmes éclairage, fond, taille et canevas qu'en 1.1;
- nommage `casier-ferme-000.png` … `casier-ferme-345.png` (angle en degrés);
- la vue 000 est la caméra de 1.1, pour que les trois états de 1.1 restent
  superposables à la position de repos.

Si l'effort est trop lourd pour l'itération, on garde la vue fixe : la direction A
fonctionne sans la rotation.

### 1.3 Références déjà annoncées

Les captures navbar et CTA que Philippe a évoquées : source (site ou produit) et,
en une phrase, ce qui plaît dans chacune. Elles orientent le détail de l'en-tête
et du bouton principal; elles ne sont pas copiées.

## 2. Ce qui n'est pas demandé

- Pas de nouvel export STL ou glTF, pas de scène three.js : la page n'embarque
  aucune bibliothèque 3D.
- Pas de vidéo ni d'animation : les transitions sont faites par la page.
- Pas de contenu d'écran rendu : il est composé en HTML pour FR/EN et les thèmes.
- Pas de planche « motifs » hors P0 (`casier-motifs.png`).

## 3. Livraison

- Déposer les PNG dans `docs/diagrams/architecture-physique/rendu-3d/landing/`
  (ou les transmettre à Philippe); les dérivés optimisés iront dans les assets du
  Web avec l'implémentation.
- Indiquer le logiciel et la version, et conserver le fichier source hors du
  dépôt s'il dépasse quelques Mo.
- À réception : remplacement du substitut dans les maquettes de la direction A,
  rendus haute fidélité (clair/sombre, FR/EN, 320/390/768/1440, reduced motion),
  puis approbation visuelle de Philippe avant tout code applicatif.

## 4. Mise à jour du 9 novembre 2026

Jimmy a transmis sa scène three.js (`source/casier-aegis-l-01.html`) plutôt que des
PNG. Elle suffit : `verify/render-device.mjs` produit les trois états de la
section 1.1 dans `assets/device/`, et pourra produire la rotation de la section
1.2 de la même façon. Les sections 1.1 et 1.2 sont donc **closes**. Il ne reste
que la section 1.3 (captures navbar et CTA). Points à signaler à Jimmy pour une
éventuelle retouche, non bloquants : liseré jaune du multimètre visible dans le
jeu supérieur des portes; dépendance à deux CDN pour three.js.
