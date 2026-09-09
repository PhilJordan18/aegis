# Connectivité

Topologie étoile : un port et un câble dédiés par cellule depuis le hub, un fusible réarmable (PTC) par port.

![Topologie étoile avec fusible réarmable PTC par port](architecture-physique-connectivite.svg#gh-light-mode-only)
![Topologie étoile avec fusible réarmable PTC par port](architecture-physique-connectivite-dark.svg#gh-dark-mode-only)

## Légende des catégories

| Catégorie | Contenu |
|---|---|
| Hub (vert) | Écran + calcul + réseau MQTT |
| Cellule (gris) | Lock + sensor |
| PTC (ambre) | Fusible réarmable, un par port |
| Câble (bleu) | `power + data`, un par cellule, aucun câble partagé |

## Décisions encodées

- Topologie étoile inchangée : un port et un câble dédiés par cellule, aucun câble partagé — voir [`aegis-hardware-diagrams`](../../../.claude/skills/aegis-hardware-diagrams/SKILL.md) pour le style de référence.
- Fusible réarmable (PTC), pas un fusible à usage unique : le solénoïde tire un courant d'appel bref (~0.5–1 A) à chaque impulsion; le PTC tolère l'appel et se réarme seul après un vrai défaut.

## Statut

Prototype / exploratoire — voir [`architecture-physique.md`](architecture-physique.md) pour le contexte complet.
