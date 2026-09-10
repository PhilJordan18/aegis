# Architecture physique du locker (prototype)

Diagrammes conceptuels, niveau prototype — pas des plans côtés. Ils traduisent les décisions prises en discussion sur le hub/cellule : vues, mécanisme de verrouillage et connectivité.

## Vues du hub et des cellules

Vue avant (écran + hub + cellule avec voyant de disponibilité) et arrière (connecteurs + alimentation) du prototype, niveau conceptuel — pas de plan coté.

![Vues avant et arrière du hub et d'une cellule](architecture-physique-vues.svg)

| Catégorie | Contenu |
|---|---|
| Hub (vert) | Écran (bleu, encart) + calcul + réseau |
| Cellule (ambre) | Trappe + voyant de disponibilité |
| Connecteur (gris) | Connecteurs et alimentation en face arrière |

- Points de fixation inter-cubes intégrés à chaque face, bouchon amovible si inutilisés — un seul modèle de panneau latéral, réutilisé sur les quatre faces verticales de chaque cube.

## Mécanisme de verrouillage

Coupe conceptuelle du verrou : pêne à ressort biseauté maintenu fermé au repos, solénoïde à impulsion pour l'ouverture, capteur de porte et voyant montés sur le cadre fixe.

![Pêne à ressort et solénoïde à impulsion, capteur de porte sur le cadre](architecture-physique-mecanisme-verrouillage.svg)

| Catégorie | Contenu |
|---|---|
| Trappe (ambre) | Pêne, biseau |
| Cadre (gris) | Fixe — capteur de porte, voyant |

- Solénoïde à impulsion, pêne à ressort biseauté (fail-secure) : au repos le ressort maintient le pêne verrouillé sans alimentation; une impulsion brève le rétracte le temps de l'ouverture, la fermeture le reverrouille seule via le biseau. Satisfait l'invariant firmware « état sûr par défaut » ([`aegis-esp32-mqtt`](../../../.claude/skills/aegis-esp32-mqtt/SKILL.md)) au niveau matériel.
- Capteur de porte et voyant montés sur le cadre, jamais sur la trappe — évite tout câblage traversant la charnière.

## Connectivité

Topologie étoile : un port et un câble dédiés par cellule depuis le hub, un fusible réarmable (PTC) par port.

![Topologie étoile avec fusible réarmable PTC par port](architecture-physique-connectivite.svg)

| Catégorie | Contenu |
|---|---|
| Hub (vert) | Écran + calcul + réseau MQTT |
| Cellule (gris) | Lock + sensor |
| PTC (ambre) | Fusible réarmable, un par port |
| Câble (bleu) | `power + data`, un par cellule, aucun câble partagé |

- Topologie étoile inchangée : un port et un câble dédiés par cellule, aucun câble partagé — voir [`aegis-hardware-diagrams`](../../../.claude/skills/aegis-hardware-diagrams/SKILL.md) pour le style de référence.
- Fusible réarmable (PTC), pas un fusible à usage unique : le solénoïde tire un courant d'appel bref (~0.5–1 A) à chaque impulsion; le PTC tolère l'appel et se réarme seul après un vrai défaut.

## Statut

Prototype / exploratoire. Le mécanisme physique n'est pas encore figé (voir [`scope.md` §17.5](../../cahier-conception/scope.md)) : si la conception change, régénérer le `.svg` (ou le `.drawio` source, pour les vues) plutôt que de garder un historique séparé. Palette dark-only (fixe, pas de variante claire) définie dans le skill [`aegis-hardware-diagrams`](../../../.claude/skills/aegis-hardware-diagrams/SKILL.md).
