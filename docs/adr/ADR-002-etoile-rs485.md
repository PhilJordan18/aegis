# ADR-002 — Hub et cellules en étoile avec liaisons RS-485 indépendantes

**Statut :** ACCEPTED — architecture; qualification électrique à réaliser  
**Date de consignation :** 17 septembre 2026  
**Décideurs :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Périmètre :** liaison entre un hub avec écran et deux cellules du prototype.

## Contexte

Une cellule Aegis correspond à un compartiment verrouillé indépendant. Les cellules peuvent être fixées ou empilées autour du hub. Le P0 comporte A1 et A2; cette modularité doit permettre des extensions sans imposer leur réalisation pendant la session.

L’équipe souhaite qu’une cellule dispose de son propre départ vers le hub, avec alimentation et communication dans un câble dédié. Les cellules ne doivent pas nécessiter de réseau IP ou de client MQTT. Le budget global du prototype est limité à 500 $ CA.

## Décision

Retenir une **étoile physique composée de liaisons RS-485 point à point indépendantes**, une par cellule. L’adoption de RS-485 ne transforme pas l’ensemble des départs en un seul bus électrique partagé.

| Liaison | Extrémité hub | Extrémité cellule | Usage |
|---|---|---|---|
| Segment 1 | Port 1 et son interface RS-485 | A1 et son interface RS-485 | Commandes et observations de A1 |
| Segment 2 | Port 2 et son interface RS-485 | A2 et son interface RS-485 | Commandes et observations de A2 |

Les lignes A/B des deux ports ne sont pas raccordées ensemble. Aucun câble ne traverse A1 pour desservir A2. Les deux départs peuvent partager la source d’alimentation dans le hub, sans être électriquement ou galvaniquement isolés pour autant.

Chaque cellule possède une capacité locale de réception des commandes et d’acquisition des observations; le composant exact reste à choisir. Le hub relie ces échanges au contrat MQTT. Les droits métier restent exclusivement dans le backend, conformément à [ADR-001](ADR-001-backend-autorite-metier.md).

## RS-485, protocole et câble : trois choix distincts

RS-485 définit les caractéristiques électriques des échanges; il ne définit pas à lui seul les commandes applicatives. Le routage, les réponses, les délais et le contrôle d’intégrité doivent être définis dans le protocole local. Modbus RTU est une option à évaluer, **pas une décision acquise par cet ADR**. Les règles de câblage et de terminaison doivent suivre les caractéristiques de chaque segment. [Guide de conception RS-485 de Texas Instruments](https://www.ti.com/lit/an/slla272d/slla272d.pdf)

Jimmy propose des câbles Cat5e/Cat6 à connecteurs RJ45/8P8C. Dans cette réalisation, la prise serait propriétaire Aegis : elle ne serait ni Ethernet ni PoE. Le brochage, la section, les contacts, la longueur admissible et la distribution de l’alimentation restent à dimensionner et valider avant mise sous tension.

Les ports doivent être identifiés pour éviter tout raccordement à un switch, ordinateur ou injecteur réseau. Si le risque de confusion n’est pas maîtrisé, la connectique doit être revue. Aucun numéro de broche ni courant admissible n’est inventé dans cet ADR.

## Pourquoi ce choix ?

- Chaque cellule possède un chemin direct et identifiable jusqu’au hub.
- Le retrait d’une cellule ne coupe pas le câble de l’autre.
- Les défaillances de communication peuvent être diagnostiquées par port.
- Les cellules restent dépourvues d’identité réseau IP et de configuration MQTT.
- Le montage mécanique peut évoluer sans imposer une liaison électrique en chaîne.

Le choix de deux segments indépendants est l’implémentation retenue par Aegis pour son étoile; il ne constitue pas une prescription générale du standard RS-485.

## Alternatives considérées

| Option | Analyse |
|---|---|
| Deux segments RS-485 indépendants | Retenue : compatible avec les départs dédiés, au prix d’interfaces supplémentaires |
| Bus RS-485 commun en chaîne | Non retenu : ne correspond pas à la topologie directe choisie |
| Étoile passive avec toutes les lignes A/B réunies | Non retenue : autre domaine électrique, ne répond pas à l’objectif d’indépendance des segments |
| Wi-Fi et MQTT dans chaque cellule | Écarté au P0 : davantage de configuration réseau, d’identités et de firmware |
| Un contrôleur commandant directement les deux compartiments | Repli prévu au scope si la réalisation modulaire ne tient pas dans les moyens disponibles |

## Conséquences et limites

Le hub doit disposer des ressources nécessaires à deux canaux indépendants, en tenant compte de l’écran et du réseau. Les interfaces série, transceivers, protections et ressources logicielles sont vérifiés dans la nomenclature, sans supposer que la carte choisie les fournit déjà.

Une troisième cellule demanderait un troisième port, une interface et un budget de puissance adaptés. La modularité n’est pas une extension illimitée ni une promesse de branchement à chaud. Le hot-plug n’est pas déclaré supporté sans conception et essais spécifiques.

Des câbles indépendants ne garantissent pas qu’un court-circuit de cellule laisse le hub et l’autre cellule alimentés. Les protections de départ et la réserve de puissance doivent limiter ce risque. Le logiciel interdit les ouvertures simultanées non prévues; cette règle ne remplace pas les protections électriques.

Le firmware conserve les limites d’actionnement, le ciblage, la prévention du rejeu et un état sûr au redémarrage. Une perte de liaison produit un état inconnu ou un défaut, jamais une fausse preuve de retour.

## Validation de réalisation

| Vérification | Preuve attendue |
|---|---|
| Interfaces du hub | Inventaire des canaux, GPIO et périphériques sans conflit avec l’écran |
| Alimentation | Mesures au hub et à chaque cellule, au repos et pendant l’actionnement |
| Câble et contacts | Brochage versionné, continuité et dimensionnement documentés |
| Communication | Échanges attribués au bon port, erreurs détectées, délais et reprises bornés |
| Ciblage | Une commande A1 n’actionne pas A2, et inversement |
| Déconnexion | Cellule absente signalée; aucune confirmation physique fabriquée |
| Rejeu et redémarrage | Aucune seconde impulsion ni réutilisation d’une ancienne commande |
| Budget | Nomenclature complète du hub et des deux cellules ≤ 500 $ CA |

Jimmy pilote les mesures et le dossier physique. Philippe vérifie leur traduction dans les événements et les parcours backend. Les essais finaux de ciblage sont réalisés ensemble. L’acceptation architecturale ne signifie pas que ces essais ont déjà réussi.

## Repli et traçabilité

Si le POC révèle un coût, une fiabilité ou un délai incompatible avec le P0, l’équipe peut activer le repli monolithique prévu au scope. Ce changement est consigné dans un ADR de remplacement; il préserve deux compartiments, le contrôle QR et la confirmation physique des mouvements.

Cet ADR développe la décision 002 existante et acte désormais RS-485, précédemment proposé dans les documents de conception. Les mentions anciennes « RS-485 proposé » doivent être alignées sur cette décision lors de l’intégration; les composants, le protocole applicatif et le brochage demeurent ouverts.

- [Architecture physique](../cahier-conception/12-architecture-physique.md)
- [Scope et porte de décision matérielle](../cahier-conception/02-scope.md)
- [Contrat MQTT du hub](../cahier-conception/10-contrats-mqtt.md)
