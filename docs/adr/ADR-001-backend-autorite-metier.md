# ADR-001 — Backend comme unique autorité métier

**Statut :** ACCEPTED  
**Date de consignation :** 17 septembre 2026  
**Décideurs :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Périmètre :** toutes les décisions métier et ouvertures applicatives du P0.

## Contexte

Aegis associe une application iOS, une administration React, un backend Spring Boot, PostgreSQL et un locker composé d’un hub avec écran et de deux cellules. Une réservation, une commande de serrure et une observation physique sont des événements différents, susceptibles d’être retardés, répétés ou interrompus.

Le produit doit maintenir une chaîne de possession cohérente. Un actif présent peut être non conforme; un clic ne prouve pas un retrait; l’échéance d’un prêt ne prouve pas son retour. Distribuer ces décisions entre interfaces, contrôleurs et serveur introduirait plusieurs interprétations concurrentes de l’état métier.

## Décision

**Le backend Spring Boot est la seule autorité qui accorde les droits métier et confirme les transitions de réservation, de prêt et d’opération.** Il est organisé comme un monolithe modulaire par fonctionnalité, avec PostgreSQL pour la persistance et les garanties transactionnelles.

L’expression « autorité maximale » désigne cette responsabilité métier. Elle ne signifie ni accès illimité à l’infrastructure, ni suppression des contraintes de base, ni possibilité de contourner les protections matérielles.

| Composante | Responsabilité autorisée | Limite |
|---|---|---|
| Spring Boot | Authentifier, autoriser, calculer la readiness, orchestrer et confirmer | Ne transforme pas une intention en preuve physique |
| PostgreSQL | Garantir contraintes, unicité, relations et atomicité | Ne décide pas qu’une porte s’est ouverte ou qu’un actif est revenu |
| iOS et React | Présenter l’état serveur et transmettre une intention | Ne fixent ni readiness finale ni statut définitif du prêt |
| Hub ESP32 | Afficher le défi, vérifier la validité technique d’une commande, cibler une cellule | Ne choisit pas qui a le droit d’emprunter |
| Cellule | Actionner et mesurer selon son interface locale | Peut refuser techniquement une commande, jamais accorder un droit métier |

### Règles d’application

1. Web et iOS utilisent uniquement l’API HTTPS. Aucun accès direct aux données PostgreSQL, aux topics MQTT ou aux serrures n’est exposé aux clients.
2. Le serveur vérifie les autorisations pour chaque action sensible. Un bouton désactivé ne constitue pas un contrôle de sécurité suffisant.
3. Une réservation ne commande aucune ouverture. La préparation d’une opération et l’affichage d’un QR ne l’autorisent pas non plus.
4. Le serveur valide le défi local, son titulaire, son contexte et les gardes actuelles avant de permettre une commande ciblée. Le QR ne remplace pas les preuves de mouvement de l’actif.
5. Le prêt est créé ou terminé seulement après des observations cohérentes et corrélées à l’opération, incluant la fermeture de porte.
6. Une commande reçue ou acquittée n’est pas une opération métier confirmée. Les doublons et événements tardifs ne produisent aucun second effet métier.
7. Une échéance dépassée ne libère pas un actif emprunté. Son retour suit une opération dédiée, sans exiger la readiness d’emprunt d’un actif déjà `BORROWED`.
8. L’administrateur utilise les mêmes services métier. Il ne dispose pas d’un bouton permettant de résoudre une anomalie sans correction vérifiable.

### Sécurité locale et déconnexion

Une autorisation serveur permet une exécution sous conditions; elle n’oblige pas le firmware à actionner une serrure malgré une cible incorrecte, une expiration ou un défaut matériel. Les délais d’impulsion, la prévention du rejeu et l’état sûr au démarrage restent locaux.

Sans backend joignable, aucune nouvelle ouverture métier n’est autorisée. Une opération déjà autorisée respecte ses limites; les observations et l’état incertain sont traités selon les contrats et la procédure de reprise. Un redémarrage n’invente jamais une confirmation. Le secours mécanique manuel reste distinct du parcours applicatif et exige une réconciliation de toute divergence physique.

## Options considérées

| Option | Motif de non-sélection ou de sélection |
|---|---|
| Autorité centralisée Spring, monolithe modulaire | Retenue : règles cohérentes, transactions et diagnostic centralisés |
| Autorisation décidée dans le mobile ou le Web | Rejetée : clients contournables et règles dupliquées |
| Autorisation métier dans le hub | Rejetée au P0 : synchronisation des droits et résolution des conflits hors ligne supplémentaires |
| Plusieurs services métier autonomes | Écartée au P0 : coût de coordination disproportionné pour deux étudiants |

## Conséquences

Le domaine peut être testé indépendamment des interfaces et de la technologie de détection. Un changement de capteur conserve les règles métier si l’adaptateur respecte les observations normalisées.

En contrepartie, le backend est une dépendance de disponibilité et concentre une part importante du développement. Il faut protéger ses accès, observer les échecs et maintenir des transactions correctes. Le monolithe ne dispense pas de frontières entre modules et de contrôle de concurrence.

La publication fiable, l’outbox et leurs paramètres relèvent des décisions et contrats associés; leur détail n’est pas implicitement approuvé par le présent ADR.

## Vérification attendue

- Une tentative d’accès à l’actif d’un autre technicien est refusée par l’API.
- Une réservation et une préparation QR n’émettent aucune commande de serrure.
- Un ACK seul ne crée aucun prêt; les preuves incomplètes ou incohérentes ne confirment pas l’opération.
- Le rejeu d’un message et deux requêtes concurrentes ne créent pas de transitions supplémentaires.
- Un actif emprunté reste indisponible après son échéance, même si son tag réapparaît hors du retour prévu.
- Un retour d’actif endommagé reste possible par le parcours autorisé; un nouvel emprunt demeure bloqué.
- Une coupure réseau ou un redémarrage ne provoque pas d’ouverture autonome.

Ces tests sont des critères d’implémentation, pas des résultats déjà obtenus.

## Références et évolution

- [Scope — principes et exigences](../cahier-conception/02-scope.md)
- [Machines à états](../cahier-conception/05-machines-a-etats.md)
- [Algorithmes et transactions](../cahier-conception/06-algorithmes-et-flux-fonctionnels.md)
- [Contrat REST](../cahier-conception/09-contrats-rest.md) et [contrat MQTT](../cahier-conception/10-contrats-mqtt.md)

Une future autorisation métier hors ligne ou une distribution des décisions entre services exige un nouvel ADR et une révision explicite du scope. Cet ADR développe la décision 001 déjà présente au registre; il ne change pas son identifiant.
