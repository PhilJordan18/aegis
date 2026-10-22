# Captures — parcours du technicien (proposition)

Rendus du prototype statique `../prototype/FlowsPrototype.swift`, compilé avec
le SDK iOS dans une copie temporaire de `apps/ios` : iPhone 17, simulateur
iOS 26.3.1, données fictives, aucune API ni caméra. Nom :
`<langue>-<écran>-<apparence>[-ax].png` (`ax` : taille de texte
d'accessibilité la plus grande).

| Parcours | Captures |
|---|---|
| Catalogue | `fr-catalogue-light`, `fr-catalogue-dark`, `en-catalogue-light`, `fr-catalogue-light-ax`, `fr-catalogue-chargement-light`, `fr-catalogue-vide-light`, `fr-catalogue-hors-ligne-dark` |
| Fiche équipement | `fr-fiche-prete-light`, `fr-fiche-bloquee-light`, `en-fiche-bloquee-dark` |
| Réservation | `fr-reserver-light`, `fr-reserver-casier-ferme-dark` |
| Mon activité | `fr-activite-vide-light`, `fr-activite-reservation-light`, `en-activite-reservation-dark`, `fr-activite-pret-retard-light`, `fr-activite-casier-hors-ligne-light` |
| Code du casier | `fr-operation-code-en-attente-light`, `fr-scan-dark`, `fr-scan-camera-refusee-light` |
| Progression physique | `fr-operation-autorisee-light`, `fr-operation-deverrouillage-dark`, `en-operation-deverrouillage-light`, `fr-operation-deverrouillage-light-ax`, `fr-operation-reseau-perdu-light`, `fr-operation-confirmee-light`, `fr-operation-expiree-light`, `fr-operation-anomalie-dark` |
| Retour | `fr-retour-porte-ouverte-light` |

Reproduire (depuis la racine du dépôt) :

```bash
docs/design/mobile-parcours/prototype/render.sh
```

Ces captures illustrent une **proposition** : elles ne prouvent aucune
intégration et ne remplacent pas l'essai sur le casier et l'iPhone réels.
