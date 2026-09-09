# Mécanisme de verrouillage

Coupe conceptuelle du verrou : pêne à ressort biseauté maintenu fermé au repos, solénoïde à impulsion pour l'ouverture, capteur de porte et voyant montés sur le cadre fixe.

![Pêne à ressort et solénoïde à impulsion, capteur de porte sur le cadre](architecture-physique-mecanisme-verrouillage.svg#gh-light-mode-only)
![Pêne à ressort et solénoïde à impulsion, capteur de porte sur le cadre](architecture-physique-mecanisme-verrouillage-dark.svg#gh-dark-mode-only)

## Légende des catégories

| Catégorie | Contenu |
|---|---|
| Trappe (ambre) | Pêne, biseau |
| Cadre (gris) | Fixe — capteur de porte, voyant |

## Décisions encodées

- Solénoïde à impulsion, pêne à ressort biseauté (fail-secure) : au repos le ressort maintient le pêne verrouillé sans alimentation; une impulsion brève le rétracte le temps de l'ouverture, la fermeture le reverrouille seule via le biseau. Satisfait l'invariant firmware « état sûr par défaut » ([`aegis-esp32-mqtt`](../../../.claude/skills/aegis-esp32-mqtt/SKILL.md)) au niveau matériel.
- Capteur de porte et voyant montés sur le cadre, jamais sur la trappe — évite tout câblage traversant la charnière.

## Statut

Prototype / exploratoire — mécanisme non encore figé (voir [`scope.md` §17.5](../../cahier-conception/scope.md)); voir [`architecture-physique.md`](architecture-physique.md) pour le contexte complet.
