# Aegis — Nomenclature matérielle candidate et estimation complète

**Mise à jour :** 1er octobre 2026 (version précédente : 23 septembre 2026)
**Devise :** dollars canadiens, avant taxes
**Statut :** étude préparatoire — aucune référence n’est approuvée pour achat (ADR-011)
**Issue :** #18 — HW-01

## 1. But et changements

Cette fiche chiffre le prototype à un hub et deux cellules à partir du matériel
du banc d’essai RS-485 déjà acheté. Elle sépare ce qui est en main de ce qui
reste à commander et donne un lien et un prix pour chaque ligne.

Changements depuis la version du 23 septembre :

- **Liaison hub–cellule en RJ45 Cat6 au lieu de M12.** Décision de Jimmy à
  valider conjointement avec Philippe et à consigner dans un ADR; le document 12
  présente encore M12 comme recommandation et RJ45 comme repli. Les connecteurs
  M12 et les câbles Tensility sont retirés.
- **Contrôleurs de cellule :** les deux cartes Freenove ESP32 en main remplacent
  le paquet de XIAO ESP32-C3.
- **Interfaces RS-485 :** modules DKARDU à direction automatique, testés au banc,
  au lieu des Waveshare SP3485.
- **Provisions remplacées :** borniers, barrettes, câbles USB-C, passe-fils et
  entretoises ont maintenant une référence Amazon.ca. Seule la structure reste
  une provision.

Les prix du 23 septembre (RobotShop, DigiKey, Home Depot, PuriLite) n’ont pas été
revérifiés; ceux du 1er octobre proviennent d’Amazon.ca. Une pièce fournie par
le laboratoire reste dans la liste à 0 $.

## 2. Liaison hub–cellule en RJ45

Un câble Cat6 **droit** par cellule, en étoile. Un câble croisé inverserait les
paires 1-2 et 3-6.

| Broches RJ45 | Paire | Banc actuel | Prototype P0 proposé |
|---|---|---|---|
| 1 · 2 | 1-2 | RS-485 A+ · B− | RS-485 A+ · B− |
| 3 · 6 | 3-6 | libre | libre (réserve) |
| 4 · 5 | 4-5 | +5 V sur la 4 seulement | +12 V sur 4 et 5 |
| 7 · 8 | 7-8 | masse sur la 7 seulement | masse sur 7 et 8 |

Constats du banc d’essai :

- **Le 5 V sur le câble n’a pas de marge.** Les bornes à vis et les cavaliers
  font chuter la tension; le prototype transporte du 12 V et régule dans chaque
  cellule.
- **Les prises 12 V doivent être étiquetées.** Le RJ45 n’a pas de détrompage :
  une cellule branchée sur un vrai port Ethernet y enverrait du 12 V.
- **UART sur GPIO 32/33.** Sur la carte WROVER, les GPIO 21, 22, 26 et 27 servent
  à la caméra et 16/17 à la PSRAM; GPIO 12 est une broche de démarrage.
- **DKARDU alimenté en 3,3 V.** Le module accepte 3 à 30 V; alimenté par le
  3,3 V de l’ESP32, sa sortie reste dans la tension tolérée par le GPIO.
- **Bornes à vis :** serrer un fil dénudé, pas une broche Dupont, et faire un
  test de traction avant la mise sous tension.

## 3. Nomenclature

État : **Acheté** (en main, compté à part), **À acheter**, **Provision**
(montant estimé) ou **Laboratoire** (supposé fourni).

### Calcul et communication

| Pièce | Référence et source | Qté | Prix unitaire | Sous-total | État | Notes |
|---|---|---:|---:|---:|---|---|
| Cellule 1 : Freenove ESP32 Kit, carte caméra ESP32-WROVER (Super Starter) | [Amazon.ca B0CJJH2C2C](https://www.amazon.ca/dp/B0CJJH2C2C) | 1 | 51,95 $ | 51,95 $ | Acheté (24 sept.) | Caméra branchée : UART sur GPIO 32/33. La trousse fournit plaque d’essai, cavaliers et résistances. |
| Cellule 2 : Freenove ESP32-WROOM (USB-C) + carte d’extension GPIO | — | 1 | — | — | Acheté (déjà en main) | Sert de hub sur le banc. Équivalent : [Freenove ESP32, paquet de 2](https://www.amazon.ca/dp/B0C9THDPXP), 27,95 $. |
| Hub avec écran : Makerfabs MaTouch ESP32-S3, TFT 3,5 po | [RobotShop ESP32S3SPI35](https://ca.robotshop.com/products/matouch-esp32-s3-spi-tft-capacitive-touch-display-35-inch-ili9488-rgb) | 1 | 61,14 $ | 61,14 $ | À acheter (23 sept.) | Affiche le QR. Confirmer deux UART libres pour les deux segments. |
| RS-485 : DKARDU TTL ↔ RS-485, direction automatique, 2 pièces | [Amazon.ca B0B6B4841P](https://www.amazon.ca/dp/B0B6B4841P) | 1 | 14,79 $ | 14,79 $ | Acheté (24 sept.) | Segment hub–cellule 1. |
| RS-485 : DKARDU, 2e paquet de 2 | [Amazon.ca B0B6B4841P](https://www.amazon.ca/dp/B0B6B4841P) | 1 | 14,79 $ | 14,79 $ | À acheter (1er oct.) | Segment hub–cellule 2 : 4 modules en étoile, 2 par segment. |

### Liaison RJ45

| Pièce | Référence et source | Qté | Prix unitaire | Sous-total | État | Notes |
|---|---|---:|---:|---:|---|---|
| Poyiccot : prise RJ45 femelle → 8 bornes à vis, paquet de 2 | [Amazon.ca B07WKKVZRF](https://www.amazon.ca/dp/B07WKKVZRF) | 1 | 15,59 $ | 15,59 $ | Acheté (24 sept.) | Segment 1, une à chaque bout. |
| Poyiccot : 2e paquet de 2 | [Amazon.ca B07WKKVZRF](https://www.amazon.ca/dp/B07WKKVZRF) | 1 | 15,98 $ | 15,98 $ | À acheter (1er oct.) | Segment 2. |
| Câble Cat6 droit | — | 1 | — | — | Acheté (déjà en main) | Segment 1. |
| Câbles Cat6 : Cable Matters, 0,9 m, paquet de 5 | [Amazon.ca B00C2CBBAM](https://www.amazon.ca/dp/B00C2CBBAM) | 1 | 17,99 $ | 17,99 $ | À acheter (1er oct.) | Segment 2 et rechanges, 24 AWG cuivre. |

### Détection

| Pièce | Référence et source | Qté | Prix unitaire | Sous-total | État | Notes |
|---|---|---:|---:|---:|---|---|
| Lecteurs RFID UHF : M5Stack U107, JRD-4035 avec antenne | [RobotShop U107](https://ca.robotshop.com/products/m5stack-uhf-rfid-unit-jrd-4035) | 2 | 112,86 $ | 225,72 $ | À acheter (23 sept.) | Portée annoncée 1,5 à 2 m : localisation par cellule à prouver (POC-01). |
| Tags UHF EPC Gen2 : PuriLite, paquet de 5 | [PuriLite PL4-WRL-14151](https://shoppurilite.ca/products/pl4-wrl-14151) | 1 | 9,99 $ | 9,99 $ | À acheter (23 sept.) | Compatibilité lecteur, matériau et orientation à vérifier. |
| Capteurs de porte : SparkFun, contact magnétique | [RobotShop COM-13247](https://ca.robotshop.com/products/magnetic-door-switch-set) | 2 | 6,43 $ | 12,86 $ | À acheter (23 sept.) | Détection d’une rupture de fil à tester. |

### Actionnement

| Pièce | Référence et source | Qté | Prix unitaire | Sous-total | État | Notes |
|---|---|---:|---:|---:|---|---|
| Verrous : SparkFun, solénoïde de verrouillage 12 V | [RobotShop ROB-15324](https://ca.robotshop.com/fr/products/solenoide-12v-verrouillage) | 2 | 22,79 $ | 45,58 $ | À acheter (23 sept.) | 600 mA, impulsion limitée; comparer au verrou rotatif (POC-03). |
| Pilotes de verrou : DFRobot, contrôleur MOSFET | [DigiKey DFR0457](https://www.digikey.ca/fr/products/detail/dfrobot/DFR0457/7087194) | 2 | 5,72 $ | 11,44 $ | À acheter (23 sept.) | Niveau logique, état au démarrage et dissipation à valider. |
| Diodes de roue libre : Diotec 1N5408, 3 A | [DigiKey 1N5408](https://www.digikey.ca/fr/products/detail/diotec-semiconductor/1N5408/21380548) | 2 | 0,53 $ | 1,06 $ | À acheter (23 sept.) | Au plus près de chaque solénoïde. |
| Voyants : Plusivo, assortiment de DEL avec résistances | [RobotShop](https://ca.robotshop.com/products/plusivo-diffused-led-assortment-kit-w-bonus-resistor-pack) | 1 | 14,27 $ | 14,27 $ | À acheter (23 sept.) | Deux voyants requis, le reste sert aux POC. |

### Alimentation et protection

| Pièce | Référence et source | Qté | Prix unitaire | Sous-total | État | Notes |
|---|---|---:|---:|---:|---|---|
| Alimentation principale : Phidgets, 12 V c.c., 5 A | [RobotShop PSU4018_0](https://ca.robotshop.com/products/power-supply-12vdc-5a) | 1 | 30,36 $ | 30,36 $ | À acheter (23 sept.) | Le 12 V passe par le RJ45 : conducteurs doublés, 4+5 et 7+8. |
| Conversion locale : DFRobot, abaisseur 3,3/5/9/12 V | [RobotShop DFR1015](https://ca.robotshop.com/products/dfrobot-dc-dc-multi-output-buck-converter-33v-5v9v12v) | 3 | 7,57 $ | 22,71 $ | À acheter (23 sept.) | Un au hub, un par cellule. |
| Porte-fusibles : 3M, en ligne | [DigiKey 972-A](https://www.digikey.ca/en/products/detail/3m/972-A-BULK/3837461) | 3 | 2,95 $ | 8,85 $ | À acheter (23 sept.) | Un départ principal et un par cellule. |
| Fusibles : Littelfuse ATOF, 2 A et 5 A, 32 V c.c. | [DigiKey ATOF](https://www.digikey.ca/en/products/filter/fuses/139?s=N4Ig7CBcoIYE5QIwA5GIDQhgFygFkwAcBLKAZjwCYwAGGxAXwaA) | 3 | 0,66 $ | 1,98 $ | À acheter (23 sept.) | Calibres après mesure de l’appel du verrou. |

### Câblage interne

| Pièce | Référence et source | Qté | Prix unitaire | Sous-total | État | Notes |
|---|---|---:|---:|---:|---|---|
| Fils internes : Plusivo, 18 AWG, 6 couleurs, gaine | [RobotShop](https://ca.robotshop.com/products/plusivo-18awg-hook-up-wire-kit-6-colors-4m-each) | 1 | 28,56 $ | 28,56 $ | À acheter (23 sept.) | Pour les bornes à vis : fil plein ou multibrin étamé. |
| Borniers internes : assortiment 5,08 mm, 2 à 5 pôles, 28 jeux | [Amazon.ca B0D2L53247](https://www.amazon.ca/dp/B0D2L53247) | 1 | 30,17 $ | 30,17 $ | À acheter (1er oct.) | Pas 5,08 mm : 24 à 12 AWG. |
| Barrettes et connecteurs : Glarks, trousse 635 pièces 2,54 mm | [Amazon.ca B01G0I0ZZK](https://www.amazon.ca/dp/B01G0I0ZZK) | 1 | 17,94 $ | 17,94 $ | À acheter (1er oct.) | |
| Câbles USB-C ↔ USB-C, paquet de 3, 30 cm | [Amazon.ca B0D21ZSGWM](https://www.amazon.ca/dp/B0D21ZSGWM) | 1 | 12,49 $ | 12,49 $ | À acheter (1er oct.) | Certaines cartes ne démarrent pas en C↔C : tester avant. |
| Cartes de prototypage : PTSolns Proto-Half, 450 points | [RobotShop](https://ca.robotshop.com/products/ptsolns-proto-half-basic-prototyping-breadboard) | 3 | 3,43 $ | 10,29 $ | À acheter (23 sept.) | Une carte par bloc. |

### Mécanique

| Pièce | Référence et source | Qté | Prix unitaire | Sous-total | État | Notes |
|---|---|---:|---:|---:|---|---|
| Structure : MDF ou contreplaqué, un hub et deux cellules | — | 1 | 40,00 $ | 40,00 $ | Provision | Seule provision restante; achat en magasin après la conception mécanique. |
| Charnières : Everbilt 2 po, paquet de 2 | [Home Depot 1000773732](https://www.homedepot.ca/product/everbilt-2-inch-zinc-plated-narrow-hinge-fixed-pin-2-pack-/1000773732) | 2 | 5,98 $ | 11,96 $ | À acheter (23 sept.) | Deux charnières par porte. |
| Visserie : Gladiator, 32 vis de 2 po | [Home Depot 1001714660](https://www.homedepot.ca/product/whirlpool-gladiator-2-in-smoke-head-screws-for-garage-geartrack-channels-and-gearwall-panels-32-pack-/1001714660) | 1 | 9,99 $ | 9,99 $ | À acheter (23 sept.) | À adapter au matériau réel. |
| Passe-fils : Vrupin, 188 œillets caoutchouc, 10 tailles | [Amazon.ca B094XY2GVR](https://www.amazon.ca/dp/B094XY2GVR) | 1 | 16,99 $ | 16,99 $ | À acheter (1er oct.) | Passage des câbles Cat6 dans les parois. |
| Entretoises : Lystaii, 320 pièces nylon M3 | [Amazon.ca B08LPYR49C](https://www.amazon.ca/dp/B08LPYR49C) | 1 | 16,99 $ | 16,99 $ | À acheter (1er oct.) | |

### Outillage

| Pièce | Référence et source | Qté | Prix unitaire | Sous-total | État | Notes |
|---|---|---:|---:|---:|---|---|
| Multimètre | — | 1 | — | — | Acheté (déjà en main) | Continuité, tensions et courant au banc. |
| Soudure, alimentation de laboratoire, découpe | — | 1 | 0,00 $ | 0,00 $ | Laboratoire | Supposé fourni; inventorier avant de figer le coût. |

## 4. Totaux

| Élément | Montant |
|---|---:|
| Déjà acheté (hors enveloppe) | 82,33 $ |
| Reste à acheter, dont 40,00 $ de provision | 690,10 $ |
| TPS 5 % + TVQ 9,975 % sur le reste à acheter | 103,34 $ |
| Total avant livraison | 793,44 $ |
| Provision de livraison | 40,00 $ |
| **Enveloppe restante indicative** | **833,44 $** |
| Valeur totale du P0, avant taxes | 772,43 $ |

Les taxes utilisent les [taux publiés par Revenu Québec](https://www.revenuquebec.ca/fr/entreprises/taxes/tpstvh-et-tvq/perception-de-la-tps-et-de-la-tvq/calcul-des-taxes/).
Les montants de la WROOM, du câble Cat6 et du multimètre déjà en main ne sont
pas connus et ne sont pas comptés.

## 5. Vérifications de l’issue #18

| Point | État |
|---|---|
| Interfaces du hub | MaTouch ESP32-S3 retenue pour l’écran; deux UART libres pour les deux segments RS-485 restent à confirmer sur son brochage. |
| Écran graphique | TFT 3,5 po; lisibilité du QR à mesurer (POC-04). |
| Lecteurs | M5Stack U107; localisation par cellule non prouvée (POC-01). |
| Pilotes | MOSFET DFR0457 + diode 1N5408 par solénoïde; état au démarrage à mesurer (POC-03). |
| Protections | Fusible principal et un fusible par cellule; calibres après mesure de l’appel du verrou. |

Informations manquantes pour approuver le brochage :

1. Validation conjointe du passage à RJ45 et ADR correspondant.
2. Courant d’appel et durée d’impulsion du solénoïde en 12 V, pour vérifier les
   conducteurs Cat6 doublés et choisir les fusibles.
3. Chute de tension mesurée sur le câble en 12 V avec la cellule en charge.
4. Brochage UART de la MaTouch.
5. Sens TXD/RXD du DKARDU et réception de l’accusé de réception sur le banc.

## 6. Conclusion

**Achat partiellement bloqué.** La liaison RJ45 et les contrôleurs en main sont
acceptables pour poursuivre le banc d’essai (POC-02). L’achat des lecteurs RFID
attend POC-01, celui des verrous et fusibles attend POC-03, et l’ensemble attend
la validation conjointe du passage à RJ45. Le devis final remplacera la provision
de structure, regroupera les paniers et recalculera taxes et livraison avant
l’approbation de Philippe et Jimmy.
