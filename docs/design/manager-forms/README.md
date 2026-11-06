# Formulaires du Manager (CAT-01 #25, CFG-02 #28, #26)

> **Statut : direction approuvée pour P0 par Philippe le 6 novembre 2026**
> ([décision sur #25](https://github.com/PhilJordan18/aegis/issues/25#issuecomment-6689754663)).
> Il s'agit d'une acceptation visuelle humaine de la direction et des six points
> ci-dessous, avec les corrections de textes listées; elle n'approuve pas les
> autres textes [P] du produit.

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
| Horaire (CFG-02 #28) | Bouton « Modifier l’horaire » dans l’en-tête de la fenêtre du casier; dialogue 640 px : fuseau IANA, puis un groupe par jour (lundi à dimanche) avec « Ouvert » et deux heures, ou « Fermé toute la journée » |
| Garde (#26) | Dans le dossier, après les réglages : « Placement attendu » avec « Modifier le placement », puis « Identifiants physiques » avec « Attribuer un identifiant » et l’historique (actifs d’abord, révoqués conservés); révocation par `alertdialog`, focus initial sur « Annuler » |
| Placement | Dialogue 640 px : casier, cellule (libre, placement actuel, occupée par X ou désactivée, à titre indicatif : le serveur juge), motif obligatoire |
| Textes | Tous [P] dans `src/i18n/messages/fr.ts` et `en.ts` (`catalogEdit`, `schedule`, `custody`) |

## Lot de rendus

`captures/` contient 40 rendus produits par `npm run capture:forms` (faux
routés, aucune API) : formulaire d’exemplaire vide et en conflit (l’alerte
reçoit le focus, le champ porte l’erreur), refus
d'archivage, onglet Modèles et formulaire de modèle, horaire lu du serveur puis
avec une erreur locale sur son jour, section garde, conflit d’identifiant et
conflit de cellule, chacun en 1280 px et
320 px, clair et sombre. Les mêmes états passent axe WCAG 2.x A/AA, le clavier
et l'absence de défilement horizontal (`npm run test:forms`).

## Décisions (approuvées le 6 novembre 2026)

1. **Dialogue modal : approuvé.** `<dialog>` natif, 640/480 px, corps
   défilant, nom accessible, focus contenu puis rendu à l'ouvreur; « Annuler »
   toujours disponible, erreurs associées aux champs.
2. **Radios : approuvées** pour les petits ensembles finis (niveau d'accès,
   état de service), en groupes étiquetés avec texte visible. Aucun état inventé.
3. **Emplacement des commandes : approuvé.** Créer dans l'en-tête de page;
   modifier et archiver dans le dossier ou la ligne du modèle. Archiver et
   révoquer restent des actions secondaires nommées, avec leur conséquence et
   le focus initial sur « Annuler ».
4. **Textes FR/EN : catalogues `catalogEdit`, `schedule` et `custody` acceptés**
   avec ces corrections, appliquées :
   - `custody.placed` : « Placement attendu de ${code} enregistré : … » —
     enregistrer un placement ne prouve ni le déplacement ni la présence;
   - `custody.fieldValueHelp` : respecter la casse lue, espaces de début et de
     fin retirés, 255 caractères (09); la valeur RFID n'est pas mise en
     majuscules;
   - `custody.placementDescription` : l'occupation a pu changer depuis
     l'affichage, la disponibilité est vérifiée à l'enregistrement;
   - `schedule.description` : « Définissez les heures d'ouverture dans le
     fuseau horaire du casier. », sans détail de versionnage;
   - `catalogEdit.assetFormDescription` : « La disponibilité, la présence et
     le diagnostic sont déterminés automatiquement. »
   Une panne réseau garde son message d'issue inconnue et la même clé
   d'idempotence et le même corps à la reprise; « Rien n'a été modifié » est
   réservé à un refus confirmé.
5. **Horaire : approuvé.** Sept groupes de jours empilés, un créneau par jour
   (09 §13); ni créneaux multiples, ni créneau de nuit. Fuseau IANA explicite;
   horaire non configuré distinct d'un casier inconnu.
6. **Garde : approuvée.** Sections dans le dossier après les réglages, sans
   nouvel onglet. Cellules libre, actuelle, occupée et désactivée nommées en
   clair; le choix reste possible car l'occupation affichée est un instantané,
   l'API reste l'autorité et ses refus à l'écriture s'appliquent. Cela
   n'autorise jamais à écraser un autre placement ni à utiliser une cellule
   désactivée. Motif et historique des identifiants révoqués conservés.
