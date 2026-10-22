# Captures — parcours du technicien (proposition)

Rendus du prototype `../prototype/FlowsPrototype.swift`, compilé avec le SDK
iOS dans une copie temporaire de `apps/ios` : données fictives, aucune API ni
caméra. Appareils : iPhone 17 (simulateur iOS 26.3.1) et, suffixe `-se`,
iPhone SE (3e génération, simulateur iOS 17.5). La langue et la région du
simulateur tiennent lieu des réglages de l'utilisateur. Nom :
`<langue>-<écran>-<apparence>[-ax][-se].png` (`ax` : taille de texte
d'accessibilité la plus grande, AX5).

| Parcours | Captures |
|---|---|
| Catalogue | `fr-catalogue-light`, `fr-catalogue-dark`, `en-catalogue-light`, `fr-catalogue-light-ax`, `fr-catalogue-chargement-light`, `fr-catalogue-vide-light`, `fr-catalogue-hors-ligne-dark`, `en-catalogue-hors-ligne-light` |
| Fiche équipement | `fr-fiche-prete-light`, `fr-fiche-bloquee-light`, `en-fiche-bloquee-dark`, `fr-fiche-bloquee-light-se` |
| Réservation | `fr-reserver-light`, `en-reserver-light`, `fr-reserver-casier-ferme-dark`, `fr-reserver-light-se` |
| Mon activité | `fr-activite-vide-light`, `fr-activite-reservation-light`, `en-activite-reservation-dark`, `fr-activite-pret-retard-light`, `fr-activite-casier-hors-ligne-light`, `en-activite-casier-hors-ligne-dark`, `fr-activite-retrait-a-reessayer-light`, `fr-activite-operation-en-cours-light` |
| Code du casier | `fr-operation-code-en-attente-light`, `fr-scan-dark`, `fr-scan-camera-refusee-light` |
| Progression physique | `fr-operation-autorisee-light`, `fr-operation-deverrouillage-dark`, `en-operation-deverrouillage-light`, `fr-operation-deverrouillage-light-ax`, `fr-operation-deverrouillage-light-se`, `fr-operation-reseau-perdu-light`, `en-operation-reseau-perdu-dark`, `fr-operation-reseau-perdu-light-ax`, `fr-operation-confirmee-light`, `fr-operation-expiree-light`, `fr-operation-anomalie-dark` |
| Retour | `fr-retour-porte-ouverte-light` |

Le dossier `interactions/` contient des captures prises pendant l'essai manuel
de la navigation (retour de la fiche, Fermer puis Reprendre, défilement en
très grand texte).

Reproduire (depuis la racine du dépôt) :

```bash
docs/design/mobile-parcours/prototype/render.sh
```

Ces captures illustrent une **proposition** : elles ne prouvent ni VoiceOver,
ni la caméra, ni le comportement réseau réel, et ne remplacent pas l'essai sur
le casier et l'iPhone réels.
