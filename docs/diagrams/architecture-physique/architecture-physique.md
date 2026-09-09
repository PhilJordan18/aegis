# Architecture physique du locker (prototype)

Diagrammes conceptuels, niveau prototype — pas des plans côtés. Ils traduisent les décisions prises en discussion (voir journal / historique de conversation) sur le mécanisme de verrouillage, la fixation et la connectivité du hub/cellule.

### Vues (avant / profil / arrière)

![Vues avant, profil et arrière du hub et des cellules](architecture-physique-vues.svg)

### Fixation murale

![Fixation par rail French cleat, accrochage individuel](architecture-physique-fixation-murale.svg)

### Mécanisme de verrouillage

![Pêne à ressort et solénoïde à impulsion, capteur de porte sur le cadre](architecture-physique-mecanisme-verrouillage.svg)

### Connectivité

![Topologie étoile avec fusible réarmable PTC par port](architecture-physique-connectivite.svg)

## Décisions encodées

- **Verrouillage : solénoïde à impulsion, pêne à ressort biseauté (fail-secure).** Au repos, le pêne est maintenu en position verrouillée par le ressort, sans alimentation. Une impulsion brève du solénoïde le rétracte le temps de l'ouverture; la fermeture le reverrouille seule via le biseau, sans commande. Ceci satisfait l'invariant firmware « état sûr par défaut au redémarrage/perte de connexion » ([`aegis-esp32-mqtt`](../../../.claude/skills/aegis-esp32-mqtt/SKILL.md)) au niveau matériel, pas seulement logiciel.
- **Capteur de porte et voyant : montés sur le cadre, jamais sur la trappe.** Évite tout câblage traversant la charnière — point de fatigue et de panne classique.
- **Fusible réarmable (PTC), pas un fusible à usage unique.** Un solénoïde tire un courant d'appel bref (~0.5–1 A) à chaque impulsion; un fusible standard dimensionné trop juste déclencherait à chaque ouverture normale. Le PTC tolère l'appel et se réarme seul après un vrai défaut — pas de fusible à remplacer entre deux démonstrations.
- **Points de fixation inter-cubes intégrés à chaque face, bouchon amovible si inutilisés.** La bride (L-bracket) livrée avec la cellule est optionnelle; une face non utilisée reste visuellement finie. Un seul modèle de panneau latéral, réutilisé sur les quatre faces verticales de chaque cube.
- **Fixation murale par rail French cleat, accrochage individuel par gravité.** Chaque cube s'accroche seul, sans démonter les autres; des repères sur le rail donnent un espacement répétable pour une cellule ajoutée plus tard. La bride ne sert alors qu'à bloquer le jeu latéral, l'alignement venant déjà du rail.
- **Connectivité : topologie étoile inchangée** (un port et un câble dédiés par cellule, aucun câble partagé) — voir [`aegis-hardware-diagrams`](../../../.claude/skills/aegis-hardware-diagrams/SKILL.md) pour le style de référence.

## Statut

Prototype / exploratoire. Les sources `.drawio` éditables ont été retirées — elles ne s'affichent pas comme une image sur GitHub, seul le `.svg` rendu reste ici (conformément à la règle du skill [`aegis-hardware-diagrams`](../../../.claude/skills/aegis-hardware-diagrams/SKILL.md)). Le mécanisme physique n'est pas encore figé (voir [`scope.md` §17.5](../../cahier-conception/scope.md)) : si la conception change, régénérer le `.svg` directement plutôt que de maintenir une source XML séparée à ce stade.
