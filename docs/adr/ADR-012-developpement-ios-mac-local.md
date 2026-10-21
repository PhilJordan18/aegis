# ADR-012 — Développement iOS sur le Mac local

**Statut :** ACCEPTED — Philippe Jordan Monfouayi Mba, le 21 octobre 2026, dans le périmètre proposé : le Mac local permet les builds et les essais iOS en simulateur; les validations physiques restent à organiser.

**Date de consignation :** 21 octobre 2026

**Date d’acceptation :** 21 octobre 2026

**Remplace :** dans l’[ADR-010](ADR-010-architecture-monorepo.md), section « Validation et accès aux Macs de l’école », uniquement la phrase qui planifie les builds iOS, les tests caméra et les essais nécessitant Xcode sur les Macs de l’école. Le monorepo commun, l’organisation des dossiers, les validations adaptées au composant et le reste de l’ADR-010 demeurent acceptés. Le fichier de l’ADR-010 n’est pas modifié.

## Décision antérieure

L’ADR-010 prévoit : « Les builds iOS, les tests caméra et les essais nécessitant Xcode sont planifiés sur les Macs disponibles à l’école. » Le Mac de Philippe ne disposait alors que des outils en ligne de commande, sans Xcode. Le développement iOS dépendait donc des séances du mercredi.

## Raison du changement

- La séance prévue le 7 octobre 2026 n’a pas eu lieu (changement d’horaire), et aucun travail iOS n’a pu être fait ce jour-là (#16).
- Xcode est maintenant installé sur le Mac de Philippe. Versions confirmées par la session iOS le 21 octobre 2026 : macOS 15.7.9 (24G830), Intel x86_64; Xcode 26.3 (17C529); compilateur Swift 6.2.4, mode de langage Swift 6; SDK iOS 26.2 et iOS Simulator 26.2; runtimes de simulateur iOS 17.5, 18.0, 18.1, 18.3.1, 18.4, 18.5, 26.0 et 26.3.1.
- Le même jour, sur ce Mac, la recette autonome de #16 donne 24 tests réussis sur 24, aucun ignoré, sur iPhone 17 (iOS 26.3.1) et sur iPhone SE de 3e génération (iOS 17.5); la recette contre l’API locale donne 2 réussis sur 2 sur iPhone 17. Les runtimes 18.x et 26.0 et tout iPhone réel n’ont pas été testés.
- La cible minimale reste iOS 17.0 (framework Observation). Elle n’est pas elle-même testée : aucun runtime 17.0 n’est installé.

## Nouvelle décision

- Les builds iOS, ainsi que les tests unitaires et UI en simulateur, se font sur le Mac de Philippe, avec la version d’Xcode consignée dans `apps/ios/README.md`. Le projet utilise des groupes synchronisés avec le système de fichiers : il exige Xcode 16 ou plus récent.
- Les Macs de l’école deviennent un recours. Ils ne conditionnent plus le calendrier iOS.
- Les essais sur un iPhone réel (caméra, scan du QR, réseau du laboratoire) restent à organiser. Ils demandent un iPhone de démonstration, une équipe de signature et une adresse HTTPS de l’API joignable depuis l’appareil; cet ADR ne les règle pas.
- Une vérification iOS en CI sur un runner macOS de GitHub est préparée dans #67. Sa version d’Xcode y sera fixée explicitement et consignée comme une configuration testée distincte de ce Mac; elle ne compte qu’après une exécution réelle.

## Conséquences

- FND-02B et les stories iOS ne dépendent plus des séances à l’école; le README et le document 11 sont mis à jour en conséquence.
- Un seul poste de l’équipe peut compiler l’application iOS. Jimmy ne peut pas le faire sans Mac; la CI macOS réduirait ce risque.
- Xcode et ses simulateurs occupent un espace important sur un disque déjà chargé. Aucun nettoyage n’est fait sans accord de Philippe.
- Aucun contrat, aucune migration ni le périmètre du P0 ne changent.

## Vérification

- `xcodebuild -version` sur le Mac de Philippe : Xcode 26.3, build 17C529 (observé le 14 octobre 2026, confirmé le 21 octobre 2026 par la session iOS).
- Recettes de #16 : `apps/ios/scripts/ios-test.sh standalone` et `apps/ios/scripts/ios-test.sh live`, consignées dans `apps/ios/README.md` une fois #16 intégrée.
