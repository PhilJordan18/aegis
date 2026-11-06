# Formulaires du Manager — proposition (CAT-01 #25)

> **Statut : proposition, non validée.** Aucune maquette de formulaire n'est
> approuvée. Ce lot de rendus sert à la validation visuelle de Philippe; il ne
> remplace pas une décision du `ui-ux-designer`.

## Ce qui est repris d'éléments approuvés

- Identité « Lumière du hub » v3 (`docs/design/manager-v3/`) : jetons, surfaces
  opaques, sans verre ni dégradé, thèmes clair, sombre et couleurs forcées.
- Champ de la connexion (`apps/admin-web/src/features/auth/sign-in.css`) :
  libellé au-dessus, aide et erreur sous le champ, `aria-invalid` et
  `aria-describedby`.
- Structure du dossier d'exemplaire (`docs/design/asset-lifecycle/sections.md`
  §5.2/5.4) : la section « Réglages » est la seule modifiable.

## Ce qui est proposé

| Élément | Proposition |
|---|---|
| Dialogue | `<dialog>` natif modal, 640 px (formulaire) ou 480 px (confirmation), corps défilant, titre et actions toujours visibles; presque pleine largeur (marge de 8 px) sous 480 px |
| Exemplaire | Modèle (liste des modèles actifs), code, numéro de série, niveau d'accès et état de service en boutons radio, calibration requise, échéance en date et heure du laboratoire |
| Modèle | Nom, fabricant, numéro de modèle, description, calibration exigée par défaut |
| Archivage | `alertdialog`, focus initial sur « Annuler », conséquence puis garde du serveur; un refus s'affiche dans le dialogue |
| Onglet Modèles | Liste paginée, archivés compris, actions « Modifier » et « Archiver » par ligne active |
| Textes | Tous [P] dans `src/i18n/messages/fr.ts` et `en.ts` (`catalogEdit`) |

## Lot de rendus

`captures/` contient 20 rendus produits par `npm run capture:forms` (faux
routés, aucune API) : formulaire d’exemplaire vide et en conflit (l’alerte
reçoit le focus, le champ porte l’erreur), refus
d'archivage, onglet Modèles et formulaire de modèle, chacun en 1280 px et
320 px, clair et sombre. Les mêmes états passent axe WCAG 2.x A/AA, le clavier
et l'absence de défilement horizontal (`npm run test:forms`).

## Décisions attendues

1. Dialogue modal plutôt que page ou panneau latéral pour créer et modifier.
2. Radios pour le niveau d'accès et l'état de service, plutôt que des listes.
3. Emplacement des commandes : en-tête de page pour créer, dossier ou ligne
   pour modifier et archiver.
4. Textes [P] du catalogue `catalogEdit`.
