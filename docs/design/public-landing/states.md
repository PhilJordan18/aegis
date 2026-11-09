# Landing publique — flux, sections et matrice d'états (issue #153)

Mode : Discovery. Complète [`brief.md`](brief.md); les affirmations viennent de
[`claims.md`](claims.md). Ce document fixe ce que la page doit faire; la forme
visuelle vient de `directions.md`.

## 1. Flux

```text
Visiteur arrive sur /
  ├─ connaît le Manager ──► « Se connecter » (en-tête ou héros) ──► /connexion (inchangé)
  ├─ découvre le produit ──► lit les sections dans l'ordre ou saute par la navigation
  │     └─ fin de page ──► « Se connecter » ou « Technicien ? Aegis Mobile »
  └─ technicien ──► mention « Aegis Mobile sur iPhone » (aucun lien de téléchargement : l'app n'est pas publiée)
```

Rien ne bloque ni ne retarde la première action : l'en-tête et le héros portent
« Se connecter » dès le premier rendu, avant tout média.

## 2. Sections et ancres

| # | Ancre | Rôle | Contenu autorisé (`claims.md`) | Média |
|---|---|---|---|---|
| 0 | — | En-tête : marque, navigation de sections, langue, « Se connecter » | — | symbole de marque |
| 1 | `#produit` (héros) | Signature, description, action principale, casier en scène | P1, P2, P4, S1 (en une phrase) | casier (3D ou repli) |
| 2 | `#readiness` | Pourquoi : l'inventaire ment, Aegis dit prêt / bloqué / à vérifier avec la raison | P3, R1, R2, R3 | exemple A1 / A2 avec marqueur « Exemple illustratif » |
| 3 | `#parcours` | Comment : réservation → QR → scan → une commande, une cellule → observation → prêt → retour | C1 à C7 au statut exact; C3, C4 au futur | casier qui change d'état par étape; repli : six vignettes statiques |
| 4 | `#systeme` | Qui parle à qui : Mobile, Manager, Control, broker, hub, cellules | S1, S2, S3, S4 | schéma SVG (pas de carte-liste) |
| 5 | `#garanties` | Les cinq garanties (reprises de l'accueil actuel, textes [P]) | R2, C2, C5, C4, A2 | — |
| 6 | `#studio` | Aegis Studio : Philippe (logiciel), Jimmy (matériel); cours; laboratoire = terrain de validation; état du prototype | P5, P6; aucune métrique | — |
| 7 | — | Pied : « Aegis Manager · Administration », « Technicien ? Utilisez Aegis Mobile sur iPhone. », langue | textes établis | — |

Les ancres sont des liens natifs `<a href="#…">` vers des `<section id>` avec
`tabindex="-1"` : le routeur ne les intercepte pas, le focus suit le défilement.
Le défilement doux respecte `prefers-reduced-motion` (déjà coupé dans `base.css`).

## 3. Matrice d'états

| État | Déclencheur | Ce que le visiteur voit | Exigence |
|---|---|---|---|
| Nominal | chargement, médias disponibles | Page complète, casier rendu, transitions actives | action visible sans défilement à toutes les tailles |
| Média 3D en chargement | première peinture, avant le média | Image statique du casier (vue avant) déjà en place, aucun gabarit vide, aucun saut de mise en page | hauteur réservée; `loading="lazy"` hors héros |
| Média 3D en échec | WebGL absent, erreur, réseau | La même image statique reste; la narration du parcours affiche ses six vignettes | aucun message d'erreur alarmant; rien ne clignote |
| Média 3D non chargé | `prefers-reduced-data`, bloqué | identique à l'échec | — |
| Mouvement réduit | `prefers-reduced-motion: reduce` | Toute l'information est présente; les étapes du parcours sont posées; aucune transition de défilement; le casier change d'état instantanément ou reste à la vue avant | version utile, pas appauvrie |
| Sans JavaScript ou avant hydratation | SPA : la page dépend de JS | Rendu actuel (racine vide) : hors périmètre; noter la limite dans la fiche de livraison | — |
| Couleurs forcées | `forced-colors: active` | Filets `CanvasText`, halo masqué, statuts par forme + texte | règle déjà en place dans les CSS `ag-*` |
| Clair / sombre | `data-theme` (système ou choix mémorisé) | Même hiérarchie, deux apparences franchement différentes; le casier a une mise en lumière propre à chaque thème | contraste mesuré dans les deux |
| FR / EN | sélecteur de l'en-tête | Tout le texte, les libellés d'accessibilité et le titre changent; noms de produits et codes inchangés | `catalog.test.ts` étendu aux nouvelles clés |
| Clavier | tabulation | Ordre : marque → navigation de sections → langue → « Se connecter » → contenu; focus visible (anneau 2 px) sur chaque lien et bouton; ancre → focus sur la section | aucune action à la souris seule |
| 200 % de zoom | fenêtre 1280 × 800 à 200 % | Aucune coupure, aucun défilement horizontal; la navigation de sections se replie | évidence capturée |
| 320 / 390 / 768 / 1440 px | largeur | Une colonne sous 768 px; navigation de sections repliée ou en défilement horizontal propre; casier sous la signature | évidence capturée |
| Session active | administrateur déjà connecté visite `/` | La page publique s'affiche telle quelle; « Se connecter » mène à `/connexion`, qui conserve son comportement actuel | aucune nouvelle logique de session sur `/` |
| Rafraîchissement sur une ancre | `/#parcours` rechargé | La page s'ouvre sur la section; le titre reste « Aegis Manager » | `matchRoute` ignore déjà le `hash` |

## 4. Récit du parcours (section 3)

Six étapes, formulées au statut de `claims.md`. Le casier illustre chaque étape;
le texte reste lisible sans lui.

| Étape | Texte court FR (candidat) | Statut | État du casier illustré |
|---|---|---|---|
| 1 Réserver | Le technicien réserve A1 depuis Aegis Mobile. Aucune porte ne bouge. | C1, C2 | écran en attente, portes fermées |
| 2 Préparer | Il prépare le retrait : le hub affichera un QR lié à son compte et à cette opération. | C3 (futur) | QR sur l'écran du hub |
| 3 Scanner | Il scanne le QR avec son téléphone; le serveur revérifie droits, réservation et horaire. | C3 (futur) | écran « vérification » |
| 4 Ouvrir | Une seule commande, pour A1 seulement, à durée limitée. | C3, C7 | porte A1 ouverte, A2 fermée |
| 5 Prouver | Porte refermée, lecture stable : le serveur confirme le retrait et crée le prêt. | C4 (futur) | portes fermées, voyant A1 |
| 6 Retourner | Même parcours au retour; la readiness est recalculée, sans exiger que l'équipement soit prêt. | C4, C6 | écran « résultat » |

## 5. Ce que la page ne fait pas

- Aucune requête à l'API, aucune donnée réelle, aucun état de session affiché.
- Aucun indicateur « connecté », « sécurisé » ou « en ligne » avant authentification
  (`reference.md` « Hiérarchie » 4).
- Aucune métrique, aucun témoignage, aucun prix, aucune promesse chiffrée.
- Aucun défilement détourné, aucune introduction imposée, aucune vidéo autoplay
  avec son.
