# ADR-011 — Évolution de l’estimation matérielle

**Statut :** ACCEPTED — clarification du cadrage financier, sans approbation d’achat

**Date de consignation :** 23 septembre 2026

**Décideur de cette clarification :** Philippe Jordan Monfouayi Mba, instruction explicite lors de la préparation de la remise

**Portée :** remplace uniquement les mentions de plafond de 500 $ CA dans l’ADR-002; sa décision de topologie demeure acceptée.

## Contexte

Les 500 $ CA évoqués au début du projet constituaient une estimation de départ,
pas un montant imposé par le cours ni un critère d’acceptation du prototype.
L’ADR-002 les a présentés comme une limite, ce qui ne reflète pas le cadrage
confirmé par Philippe. La nomenclature détaillée fait apparaître les besoins
de l’ensemble hub, cellules, détection, actionnement, alimentation, protections
et mécanique; son évolution doit rester traçable sans devenir une discussion
budgétaire répétée dans le cahier.

## Décision

- Retirer le caractère contraignant du repère initial de 500 $ CA.
- Présenter la nomenclature candidate complète, les quantités et le total dans
  le cahier, en distinguant prix relevés, provisions et moyens supposés fournis.
- Ne pas approuver ou rejeter une architecture sur le seul franchissement de
  cette estimation. Les exigences de sûreté, de cohérence et de livraison restent
  applicables.
- Décider ultérieurement du montant d’achat et de son financement avec Jimmy,
  après inventaire, POC utiles et devis. Aucune dépense n’est autorisée par cet ADR.

## Alternatives et conséquences

Conserver un plafond fixe de 500 $ créerait une contrainte inexistante et pourrait
provoquer des coupes non justifiées. Ne plus chiffrer le matériel masquerait au
contraire des besoins réels. Une estimation versionnée permet de conserver la
visibilité sur le coût sans la confondre avec un budget approuvé.

Les lignes historiques de l’ADR-002 sont conservées avec un renvoi explicite vers
la présente décision. La liste d’achat reste à valider; une pièce fournie demeure
dans la nomenclature même si son coût d’acquisition est nul.

## Vérification et références

Vérifier que le total du cahier correspond à la somme de la nomenclature et que
chaque fonction du prototype y apparaît. Remplacer les provisions et confirmer
stocks, taxes et transport avant achat, sans prétendre avoir déjà effectué les POC.

- [ADR-002 — Topologie physique](ADR-002-etoile-rs485.md)
- [Nomenclature candidate datée](../research/nomenclature-materielle-candidate.md)
- [Cahier de conception, estimation et annexe matérielle](../cahier-conception/15-cahier-de-conception.md)
