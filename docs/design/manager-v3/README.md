# Aegis Manager — identité « Lumière du hub » v3 (issue #79, premier livrable)

Mode : Prototype. Date : 21 octobre 2026. Plateforme : Web. Statut : **rendus à
faire approuver par Philippe avant toute modification de `apps/admin-web`**.
Ce dossier ne touche ni au code applicatif, ni aux contrats, ni à
l'authentification. Un prototype statique n'est pas une implémentation.

Références : `../identite/reference.md` (identité commune, décisions de
Philippe), `../identite/v3/web/aegis-web-v3.html` (maquette Web de Philippe),
`../manager-entree/` (parcours, états et textes validés de l'entrée, conservés).
Mesures : `verification.md`.

## Ouvrir le prototype

Aucun serveur ni réseau : ouvrir `prototype/index.html` dans un navigateur (la
page liste tous les états). Paramètres d'URL des pages :

| Page | Paramètres |
|---|---|
| `prototype/sign-in.html` | `state` (voir ci-dessous), `lang` (`fr`, `en`), `theme` (`dark`, `light`, sinon le réglage du système), `alert` (`bottom` par défaut, `top`), `retry` (secondes, 55), `still` (fige le décompte), `signature=off`, `notes=off` (masque l'annotation d'aperçu), `font=system`, `nofocus` |
| `prototype/shell.html` | `lang`, `theme`, `drawer=1` (tiroir ouvert, sous 1024 px), `specimen=off` |
| `prototype/logo-sizes.html` | symbole et composant de marque de 12 à 48 px, quatre fonds |

Les captures se régénèrent avec `node verify/captures.mjs` (Playwright de
`apps/admin-web/node_modules`, après `npm ci`).

**Polices :** Geist et Geist Mono, **autohébergées** dans `prototype/fonts/`
(`@fontsource-variable` 5.3.0, sous-ensembles latin et latin étendu, licence OFL
1.1 jointe), aucun CDN. Aucune Inter. `?font=system` montre la pile du système
pour comparaison.

**Logo :** composant de marque unique (`prototype/js/brand.js`) : symbole
`../identite/assets/aegis-core-mark.svg` (clair) ou `aegis-core-mark-dark.svg`
(sombre), référencés par chemin, suivis du mot « aegis » en Geist et de
« Manager ». Aucune signature SVG `aegis | CORE`, aucun tracé recopié.

## Écrans et états

### Connexion (`sign-in.html`, bureau, sombre et clair, FR et EN)

Composition de bureau : en-tête (marque, « Accueil », choix FR/EN), promesse
typographique à gauche avec une lumière localisée, carte de connexion à droite,
pied de page. Sous 720 px, la carte passe en premier et la promesse disparaît.
Aucun hub, cellule, illustration ni anneau; la grille de cellules allumée de
l'ancien Web a disparu.

| `state` | Déclencheur (API, `states.md`) | Focus | Alerte |
|---|---|---|---|
| `nominal` | arrivée | courriel | aucune |
| `sending` | envoi en cours | inchangé | aucune; bouton occupé, champs en lecture seule |
| `invalid-credentials` | 401 `AUTH_INVALID_CREDENTIALS` | mot de passe | erreur |
| `validation` | champ vide ou invalide, client | premier champ invalide | messages sous les champs |
| `rate-limited` | 429, `Retry-After` 55 s | inchangé | avertissement; bouton verrouillé, « Disponible dans 0:55 », réactivation annoncée |
| `unreachable` | réseau, délai de 15 s, 5xx sans corps | inchangé | avertissement, sans `traceId` |
| `service-error` | 5xx avec `traceId` | inchangé | erreur; `traceId` affiché tel quel, sélectionnable |
| `session-expired` | 401 `AUTH_TOKEN_EXPIRED` | mot de passe | information |
| `role-unauthorized` | 200 avec rôle autre que `ADMIN` | titre | avertissement; la carte est remplacée |

La demande nommait « service injoignable avec traceId » : le comportement validé
sépare `unreachable` (sans corps, donc sans `traceId`) de `service-error`
(avec `traceId`); le prototype montre les deux. Le formulaire est réellement
interactif (aucune requête) : un envoi vide donne `validation`, un envoi complet
donne `sending` puis `invalid-credentials`.

### En-tête et barre latérale (`shell.html`)

Barre latérale opaque de 280 px (≥ 1024 px) avec la marque, les six sections
(Équipements courante; les autres « à venir », non focusables), le compte; sous
1024 px, barre supérieure (marque, « Menu ») et tiroir modal. Contenu :
l'aperçu Équipements réduit (deux exemplaires de la fixture MM-001 et MM-002,
barre « Aperçu visuel »), et un **encadré d'annotation de revue, hors produit**
montrant les statuts métier (prêt, bloqué, à vérifier, aucun empêchement) à
côté du symbole : forme, symbole et texte portent le statut, jamais le cyan du
noyau.

## Jetons

Valeurs des palettes : maquette Web de Philippe (`aegis-web-v3.html`), proches de
celles de `reference.md` (écarts : surface sombre `#0E1621` au lieu de `#0D1520`,
champ `#111D2B`, fond clair `#F4F6FA`, bordure claire `#D3DCE7`, texte `#14253B`,
halo `#17386655` / `#7CA7EF20`). Toutes les valeurs sont dans
`prototype/css/aegis-v3.css`.

**Jetons ajoutés, absents de la référence** (marqués `[+]` dans le CSS), à
consigner dans `reference.md` par son propriétaire :

| Jeton | Sombre | Clair | Raison |
|---|---|---|---|
| `--ag-control-border` | `#5B6F88` | `#7A8BA1` | La bordure de la maquette n'atteint que 1,60 / 1,39:1 (1.4.11 exige 3:1) : 3,53 / 3,48:1 mesurés |
| `--ag-focus` | `#8CAEFF` | `#234BCE` | La bague translucide de la maquette (1,39 / 1,21:1) ne suffit pas; anneau plein de 2 px, décalé de 2 px, le halo translucide n'étant qu'un accompagnement |
| `--ag-selected` | `#13213A` | `#E8EEFC` | Élément de navigation courant, survol |
| `--ag-disabled-bg`, `--ag-disabled-text` | `#1A2437`, `#8A99AF` | `#E3E8F1`, `#52627A` | Bouton verrouillé (429) |
| rôles `warn`, `info`, `ready`, `neutral` | repris de `manager-entree/tokens.css` | idem | Les statuts gardent leur sens; seul `blocked` adopte la paire d'erreur v3 |
| `--ag-mock-*` | magenta en tirets | idem | Annotation d'aperçu, hors produit |

## Écarts entre le Web actuel et la v3

**Résolus par les rendus :**

- la grille de cellules et la « cellule allumée » de la connexion ont disparu,
  remplacées par une promesse typographique et un halo localisé;
- le monogramme provisoire (carré en croix, cellule en dégradé) est remplacé par le
  symbole fourni, sans tracé recopié;
- palette : le bleu `#1F4FE6`, l'indigo et les dégradés bleu-indigo sont
  remplacés par l'accent `#234BCE` / `#8CAEFF` et le bouton plein `#315EE8`;
  seule la couleur d'information garde une teinte indigo (voir décisions);
- le verre (`backdrop-filter`) est remplacé par des surfaces opaques;
- Geist conservée, 16 px aux champs, 14 px au texte secondaire;
- bordure de champ et focus conformes (voir `verification.md`).

**Laissés ouverts :** voir « Décisions ouvertes ».

## Comparaison avec la maquette Web de Philippe

**Conservé de ma direction :** les neuf états de connexion de `states.md` avec
leur traitement (alerte avec forme, symbole et texte; verrou et décompte du 429;
`traceId`; session expirée; rôle non autorisé), la barre latérale et le tiroir du
shell, les jetons de contraste ajoutés, la preuve par pixels, l'absence de texte
indicatif, le `h1` « Connexion » (la promesse n'est qu'un paragraphe).

**Repris de la maquette :** en-tête avec marque, « Manager » et choix FR/EN;
promesse typographique à gauche et carte à droite; palettes; textes de marque
(accroche, description, « Espace administrateur », « Accédez à Aegis
Manager. », pied « Aegis Manager · Administration » et « Technicien ? Utilisez
Aegis Mobile sur iPhone. »); formulaire d'abord sur petit écran; promesse
masquée sous 720 px; Geist, sans Inter.

**Abandonné de ma première version :** la zone de marque pleine hauteur et le
panneau plein côté, la signature `aegis | CORE` sur l'écran de connexion
(décisions de Philippe du 21 octobre).

**Conflits ou choix pour Philippe :** voir 2, 3, 5 et 6 ci-dessous.

## Décisions ouvertes

1. **Marque (option A) :** décidée par Philippe (symbole + « aegis » sans
   « CORE », noms d'application conservés). À confirmer : le mot s'écrit
   « aegis » en minuscules dans le composant (maquette et signature), alors que le nom
   d'application s'écrit « Aegis Manager »; l'en-tête de connexion garde
   « | Manager » à droite du mot (composition Web), à confirmer pour les écrans
   d'entrée où la décision dit « aegis seul ».
2. **Place de l'alerte (nouveau) :** la maquette de Philippe insère l'alerte
   entre le titre et les champs; c'est aussi l'état validé (`states.md`).
   Mesure : cela décale les champs et le bouton de 85 à 223 px à l'apparition
   d'une erreur. Le prototype place l'alerte **sous le bouton** (0 px de saut,
   carte ancrée en haut). `?alert=top` montre l'ancienne place. Choix de
   Philippe; si elle revient en haut, les deux états ci-dessus restent à régler
   autrement (par exemple réserver la hauteur).
3. **Textes de marque, FR et EN, non validés :** accroche « L'essentiel, sous
   contrôle. » / « Clarity. Control. Confidence. », description,
   « Espace administrateur ». Troisième mot de la promesse : « Prouvé. » / **« Verified. »**
   dans la maquette, contre « Proven. » dans `reference.md` (le prototype suit la
   maquette). Remarque de vocabulaire : « Disponibilité » seul désigne la
   disponibilité, pas la disponibilité opérationnelle (`READY`) du glossaire;
   « conformité » n'est pas un terme du domaine P0.
4. **Pied de page :** « Aegis Mobile » (maquette) remplace « l'application Aegis »
   (texte validé de l'entrée).
5. **« Accueil » :** la maquette n'a pas ce lien; le prototype le garde (parcours
   validé Accueil → Connexion) et le masque sous 480 px, la marque menant à
   l'accueil. Supprimer ce lien est possible, c'est un changement de parcours.
6. **Texte indicatif :** la maquette met des exemples (« nom@entreprise.ca ») dans
   les champs; le prototype n'en met pas (le libellé suffit, la valeur saisie ne
   se confond pas avec un exemple). À trancher.
7. **Tailles minimales du logo** (mesurées, `verification.md` §7) : symbole 16 px
   au plus bas, 20 px pour voir le noyau, 24 px recommandé; signature SVG, si elle
   revient, au moins 200 px de large; composant de marque 28 px de symbole.
8. **Signatures SVG :** texte Inter vivant, rendu en Arial ici; conversion en
   tracés par le designer; versions finales du logo à venir.
9. **Couleurs de statut :** le prototype reprend les rôles du Web actuel; la
   couleur d'information (`#111F4D`, `#A9C0FF` en sombre) garde une teinte
   indigo que « pas de lavande omniprésente » invite à revoir.
10. **Langue :** le choix FR/EN de l'en-tête est présent mais ne fait que changer
    le texte; langue par défaut et persistance relèvent de #78.
11. **Barre latérale :** le repère de la section courante est une barre pleine
    en accent (ancien repère « cellule allumée » supprimé); menu du compte et
    sélecteur d'apparence non redessinés dans ce livrable.
12. **Petit écran :** la promesse est masquée (maquette); l'alternative est de
    la placer sous le formulaire.

## Contenu du dossier

- `prototype/` : pages, `css/`, `js/` (copy.js : textes FR et EN), `fonts/`.
- `captures/` : 25 captures à 1x, nommées `<écran>-<état>-<langue>-<apparence>-<taille>.png`
  (connexion à 1440 px : 14; connexion à 390 px : 4, à 320 px : 1, zoom à 200 % : 1;
  shell : 4; lisibilité du logo : 1).
- `verify/` : scripts de mesure et sorties brutes (`*-output.txt`).
- `verification.md` : résultats.
