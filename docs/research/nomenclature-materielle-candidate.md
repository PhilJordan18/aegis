# Aegis — Nomenclature matérielle candidate et estimation complète

**Date des prix :** 23 septembre 2026
**Devise :** dollars canadiens
**Statut :** étude préparatoire — aucune référence n’est approuvée pour achat

## 1. But et méthode

Cette fiche transforme la nomenclature fonctionnelle du document 12 en une
estimation complète du prototype à un hub et deux cellules. Elle sert à comparer
les variantes, à préparer les POC et à discuter avec Yoël, Philippe et Jimmy.
Elle ne remplace ni les fiches techniques, ni les mesures, ni une approbation
d’achat.

Le montant de 500 $ utilisé au début du projet était un ordre de grandeur de
planification, pas un critère technique d’acceptation. Le choix final sera fait
après l’inventaire du laboratoire et les POC. Une architecture ne sera donc ni
acceptée parce qu’elle passe sous 500 $, ni rejetée uniquement parce qu’une
première estimation dépasse ce repère.

Les prix marqués **sourcés** proviennent d’une page de fournisseur consultée à la
date ci-dessus. Les montants marqués **provisionnels** sont des enveloppes à
remplacer par une référence et un devis. Une pièce fournie par le laboratoire
sera comptée à 0 $ dans le coût d’achat, mais restera inscrite avec sa référence,
son état et sa valeur de remplacement.

## 2. Nomenclature candidate complète

| Sous-ensemble | Référence candidate ou base d’estimation | Qté | Prix unitaire | Sous-total | Nature et validation requise |
|---|---|---:|---:|---:|---|
| Hub avec écran | [Makerfabs ESP32S3SPI35 — MaTouch ESP32-S3, TFT 3,5 po](https://ca.robotshop.com/products/matouch-esp32-s3-spi-tft-capacitive-touch-display-35-inch-ili9488-rgb) | 1 | 61,14 $ | 61,14 $ | Sourcé; confirmer GPIO, deux liaisons série, bibliothèque QR et lisibilité sur l’iPhone réel |
| Contrôleurs de cellules | [Seeed Studio 102010572 — XIAO ESP32-C3, paquet de trois](https://ca.robotshop.com/products/seeedstudio-xiao-esp32c3-unsoldered-3x) | 1 paquet | 20,00 $ | 20,00 $ | Sourcé; deux unités utilisées et une de rechange; confirmer UART, broches et alimentation |
| Interfaces RS-485 | [Waveshare 4777 — SP3485 3,3 V](https://ca.robotshop.com/products/waveshare-rs485-board-33v) | 4 | 5,70 $ | 22,80 $ | Sourcé; une interface à chaque extrémité des deux segments; terminaison et polarisation à mesurer |
| Lecteurs RFID UHF | [M5Stack U107 — JRD-4035 avec antenne](https://ca.robotshop.com/products/m5stack-uhf-rfid-unit-jrd-4035) | 2 | 112,86 $ | 225,72 $ | Sourcé; la portée annoncée de 1,5 à 2 m rend la localisation par cellule incertaine; POC obligatoire |
| Tags d’actifs UHF | [PuriLite PL4-WRL-14151 — EPC Gen2 / ISO 18000-6C, paquet de cinq](https://shoppurilite.ca/products/pl4-wrl-14151) | 1 paquet | 9,99 $ | 9,99 $ | Sourcé; compatibilité avec le lecteur, le matériau et l’orientation à vérifier |
| Verrous | [SparkFun ROB-15324 — solénoïde de verrouillage 12 V](https://ca.robotshop.com/fr/products/solenoide-12v-verrouillage) | 2 | 22,79 $ | 45,58 $ | Sourcé; 600 mA et impulsion limitée; la mécanique doit être comparée au verrou rotatif étudié |
| Pilotes de verrou | [DFRobot DFR0457 — contrôleur de puissance MOSFET](https://www.digikey.ca/fr/products/detail/dfrobot/DFR0457/7087194) | 2 | 5,72 $ | 11,44 $ | Sourcé; niveau logique, courant, état au démarrage et dissipation à valider |
| Diodes de roue libre | [Diotec 1N5408 — diode axiale 3 A](https://www.digikey.ca/fr/products/detail/diotec-semiconductor/1N5408/21380548) | 2 | 0,53 $ | 1,06 $ | Sourcé; montage au plus près de chaque charge inductive à confirmer sur le schéma électrique |
| Capteurs de porte | [SparkFun COM-13247 — contact magnétique](https://ca.robotshop.com/products/magnetic-door-switch-set) | 2 | 6,43 $ | 12,86 $ | Sourcé; montage, aimant et détection d’une rupture de fil à tester |
| Voyants et résistances | [Plusivo — assortiment de DEL avec résistances](https://ca.robotshop.com/products/plusivo-diffused-led-assortment-kit-w-bonus-resistor-pack) | 1 | 14,27 $ | 14,27 $ | Sourcé; deux voyants requis, le reste sert aux POC et au remplacement |
| Connecteurs M12 côté panneau | [Stewart SS-12000-004 — M12 A mâle, 5 contacts](https://www.digikey.ca/en/product-highlight/s/stewart-connector/harsh-environment-m12-circular-connectors-ss-12000-series) | 2 | 11,92 $ | 23,84 $ | Sourcé; courant admissible, montage et détrompage à valider |
| Connecteurs M12 côté câble | [Stewart SS-12000-020 — M12 A femelle, 5 contacts](https://www.digikey.ca/en/product-highlight/s/stewart-connector/harsh-environment-m12-circular-connectors-ss-12000-series) | 2 | 12,98 $ | 25,96 $ | Sourcé; presse-étoupe, section et assemblage à valider |
| Câbles dédiés hub–cellule | [Tensility 30-01586 — 5 conducteurs, 22 AWG, blindé](https://www.digikey.ca/en/product-highlight/t/tensility-intl/m12-flange-and-assembly-type-connectors) | 2 unités | 11,33 $ | 22,66 $ | Sourcé à titre budgétaire; longueur et conditionnement exacts à confirmer |
| Alimentation principale | [Phidgets PSU4018_0 — 12 V c.c., 5 A](https://ca.robotshop.com/products/power-supply-12vdc-5a) | 1 | 30,36 $ | 30,36 $ | Sourcé; bilan de puissance, connecteur de sortie et comportement en surcharge à vérifier |
| Conversion locale | [DFRobot DFR1015 — abaisseur 3,3/5/9/12 V](https://ca.robotshop.com/products/dfrobot-dc-dc-multi-output-buck-converter-33v-5v9v12v) | 3 | 7,57 $ | 22,71 $ | Sourcé; un au hub et un par cellule dans cette estimation; tension, courant et échauffement à mesurer |
| Porte-fusibles | [3M 972-A — porte-fusible en ligne](https://www.digikey.ca/en/products/detail/3m/972-A-BULK/3837461) | 3 | 2,95 $ | 8,85 $ | Sourcé; un départ principal et un par cellule, sous réserve du schéma final |
| Fusibles de départ | [Littelfuse ATOF — 2 A et 5 A, 32 V c.c.](https://www.digikey.ca/en/products/filter/fuses/139?s=N4Ig7CBcoIYE5QIwA5GIDQhgFygFkwAcBLKAZjwCYwAGGxAXwaA) | 3 | 0,66 $ | 1,98 $ | Sourcé; calibres définitifs calculés après mesure des courants et de l’appel du verrou |
| Fils internes, gaine et attaches | [Plusivo — trousse 18 AWG, six couleurs, gaine thermorétractable](https://ca.robotshop.com/products/plusivo-18awg-hook-up-wire-kit-6-colors-4m-each) | 1 | 28,56 $ | 28,56 $ | Sourcé; section des conducteurs de puissance à confirmer par le bilan de courant |
| Cartes de prototypage soudables | [PTSolns Proto-Half — carte de 450 points](https://ca.robotshop.com/products/ptsolns-proto-half-basic-prototyping-breadboard) | 3 | 3,43 $ | 10,29 $ | Sourcé; une carte par bloc; implantation et dégagement électrique à concevoir |
| Borniers internes | Borniers à vis adaptés aux sections retenues | 1 lot | 12,00 $ | 12,00 $ | Provisionnel; nombre de pôles, pas et courant à fixer après le schéma électrique |
| Câbles USB-C de programmation | Câbles de données pour le hub et les contrôleurs | 1 lot | 20,00 $ | 20,00 $ | Provisionnel; compter 0 $ si des câbles vérifiés sont disponibles au laboratoire |
| Barrettes et petits connecteurs | Barrettes, cosses et connecteurs internes | 1 lot | 2,00 $ | 2,00 $ | Provisionnel; à remplacer par les références du montage final |
| Structure | MDF ou contreplaqué pour un hub et deux cellules | 1 lot | 40,00 $ | 40,00 $ | Provisionnel; dimensions, découpe, rigidité et accès de secours à valider |
| Charnières | [Everbilt 2 po, paquet de deux](https://www.homedepot.ca/product/everbilt-2-inch-zinc-plated-narrow-hinge-fixed-pin-2-pack-/1000773732) | 2 paquets | 5,98 $ | 11,96 $ | Sourcé; deux charnières par porte dans cette estimation |
| Visserie de structure | [Gladiator — paquet de 32 vis de 2 po](https://www.homedepot.ca/product/whirlpool-gladiator-2-in-smoke-head-screws-for-garage-geartrack-channels-and-gearwall-panels-32-pack-/1001714660) | 1 | 9,99 $ | 9,99 $ | Sourcé à titre budgétaire; diamètre et longueur à adapter au matériau réel |
| Passe-fils et protection des arêtes | Passe-fils adaptés aux ouvertures de câble | 1 lot | 6,00 $ | 6,00 $ | Provisionnel; à dimensionner après la conception mécanique |
| Entretoises et fixations électroniques | Entretoises, vis et écrous pour les cartes | 1 lot | 12,00 $ | 12,00 $ | Provisionnel; à remplacer par les références et quantités finales |
| Outillage d’assemblage et de mesure | Fer et consommables de soudure, multimètre, alimentation de laboratoire, pinces et outils de coupe | 1 ensemble | 0,00 $ | 0,00 $ | Hypothèse de matériel fourni par le laboratoire; inventorier avant de figer le coût |
| Moyens de fabrication | Perceuse, scie ou découpe, équipement de protection et, si requis, impression 3D | 1 ensemble | 0,00 $ | 0,00 $ | Hypothèse d’accès au laboratoire; tout achat ou service externe doit être ajouté |
| **Total des articles** |  |  |  | **714,02 $** | **Inclut 622,02 $ de lignes sourcées et 92,00 $ de provisions** |

## 3. Total de planification

| Élément | Montant | Interprétation |
|---|---:|---|
| Articles avant taxes et livraison | 714,02 $ | Total de la nomenclature ci-dessus |
| TPS et TVQ indicatives, 14,975 % | 106,92 $ | Calculées sur les articles; le montant réel dépendra des factures |
| Total indicatif avant livraison | **820,94 $** | Total comparable une fois les taxes ajoutées |
| Provision de livraison | 40,00 $ | Hypothèse de planification à remplacer par les paniers fournisseurs |
| **Enveloppe d’achat indicative** | **860,94 $** | **Estimation, pas un devis ni une limite d’acceptation** |

Les taxes utilisent les [taux publiés par Revenu Québec](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/perception-de-la-tps-et-de-la-tvq/calcul-des-taxes/),
soit 5 % pour la TPS et 9,975 % pour la TVQ. La livraison réelle, les variations
de prix et les taxes applicables aux frais de transport seront recalculées au
moment des paniers.
Aucune contingence supplémentaire n’est ajoutée : le contrôleur de cellule de
rechange et les surplus de plusieurs trousses couvrent déjà une partie des
petites pertes, mais pas le remplacement d’un lecteur RFID ou d’un écran.

## 4. Lecture technique de l’estimation

Cette estimation ne constitue pas encore une liste d’achat. Elle met surtout en
évidence les validations qui peuvent modifier l’architecture :

- les deux lecteurs UHF représentent 225,72 $ et leur portée annoncée est plus
  grande qu’une cellule; leur coût n’est pas le problème principal, leur capacité
  à localiser l’actif dans le bon compartiment l’est;
- le loquet à solénoïde est une référence candidate et non le verrou rotatif
  décrit dans la première architecture; la mécanique, le courant et le mode de
  secours doivent trancher;
- les références de connectique, de câblage, de protection et de structure
  dépendent des mesures et du matériel déjà disponible au laboratoire;
- le repli vers un hub contrôlant directement les deux compartiments ou vers une
  autre preuve de présence reste une décision d’architecture, pas une réduction
  automatique déclenchée par le total.

## 5. Décisions à obtenir avant achat

1. **Inventaire du laboratoire.** Relever chaque pièce disponible, sa référence,
   son état et sa valeur de remplacement; remplacer ensuite son coût d’achat par
   0 $ sans la retirer de la nomenclature.
2. **RFID.** Mesurer la cellule attendue, la cellule voisine, les orientations,
   les matériaux et un tag à l’extérieur. Déclencher le repli seulement si la
   preuve de présence n’est pas suffisamment localisée et répétable.
3. **Architecture locale.** Comparer deux contrôleurs de cellule avec un ESP32
   pilotant directement deux compartiments selon le câblage, les pannes isolées,
   le diagnostic et le temps d’intégration — pas selon le prix seul.
4. **Connectique.** Conserver M12 si le courant, le brochage, la disponibilité et
   la robustesse répondent au besoin. Sinon, documenter une autre connectique,
   son détrompage et le risque de confusion.
5. **Serrure.** Choisir la mécanique à partir des mesures de courant, de la durée
   d’impulsion, de la répétabilité, de l’échauffement et de l’accès de secours.
6. **Devis final.** Remplacer toutes les provisions, consolider les paniers,
   calculer taxes et livraisons réelles, puis faire approuver la commande par
   Philippe et Jimmy.

## 6. Informations à rapporter de la validation avec Yoël

Pour chaque composant retenu : fabricant, numéro de pièce, quantité disponible,
prix ou valeur fournie, lien vers la fiche technique, tension, courant maximal,
interface, dimensions utiles et responsable du POC. Toute inconnue demeure
marquée « à mesurer » ou « à décider »; elle n’est pas remplacée par une valeur
supposée.
