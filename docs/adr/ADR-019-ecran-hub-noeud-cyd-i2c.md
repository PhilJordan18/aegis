# ADR-019 — Écran du hub : nœud d’affichage ESP32 relié au hub en I2C

**Statut :** ACCEPTED — consigné à la demande de Jimmy le 25 novembre 2026 (confirmation de Philippe non consignée ici)  
**Amendement du 25 novembre 2026 :** le hub porte aussi tous les composants d’une cellule (RS-485, lecteur UHF, sortie et contact du verrou, dont GPIO 27). Les GPIO 26 et 27 du hub ne sont donc pas utilisés pour l’I2C : le hub utilise **SDA GPIO 21 et SCL GPIO 22**, 100 kHz, résistances de rappel 4,7 kΩ vers 3,3 V, module caméra retiré (21 et 22 sont des broches du connecteur caméra). Le tableau de la décision 2 est remplacé pour le côté hub; le côté CYD (IO32 SDA, IO25 SCL) est inchangé. Vérifié au banc le 25 novembre 2026 : lecture d’état du CYD sur le bus, QR version 9 affiché puis lu par l’iPhone.  
**Numérotation :** proposé le 11 novembre 2026 sous le numéro 016, renuméroté 019 le 25 novembre 2026 parce que l’ADR-016 de `dev` (session navigateur révocable) avait pris ce numéro.  
**Date de consignation :** 11 novembre 2026  
**Décideurs :** Yoël Jimmy Razafindretsa (proposition); Philippe Jordan Monfouayi Mba (acceptation)  
**Périmètre :** écran du hub pour FW-04 ([#45](https://github.com/PhilJordan18/aegis/issues/45)) et le contrat d’affichage du doc 10 §27. Aucun contrat MQTT n’est modifié.

## Contexte

Le doc 12 (§2, §6, §11) prévoit un écran graphique piloté par le contrôleur du hub. L’écran retenu
est un Freenove ESP32 Display 3,2 pouces (FNK0103, conception LCDWiki E32R32P) : un ESP32-WROOM-32E
avec son propre écran IPS 240 × 320 (ST7789, SPI), un tactile résistif XPT2046, 4 Mo de flash et
520 Ko de SRAM, sans PSRAM. Ce n’est pas un simple module d’affichage.

Le hub (Freenove ESP32-WROVER avec connecteur caméra) n’a plus de broches libres pour un écran SPI
de 5 à 6 signaux : ses trois UART servent au moniteur USB et aux segments RS-485 des ports 1 et 2
(ADR-002), GPIO 16/17 à la PSRAM, et les autres broches au connecteur caméra. Son image
firmware occupe déjà 78 % de la partition applicative, et la pile MQTT/TLS a besoin de sa mémoire.

## Décision

1. **Le CYD est un nœud d’affichage, pas le hub.** Le hub reste le seul device connu du broker :
   il reçoit `display`, applique les contrôles du doc 10 §27 et publie seul
   `ACCESS_CHALLENGE_DISPLAYED` et `DISPLAY_REJECTED`. Le CYD n’a ni Wi-Fi actif, ni MQTT, ni
   identité réseau (même principe que les cellules, doc 10 §5 règle 6).
2. **Liaison filaire I2C, point à point, à l’intérieur du boîtier du hub.** Le hub est maître,
   le CYD est esclave à l’adresse `0x42`, à 100 kHz.

   | Signal | Hub (WROVER) | CYD (connecteur I2C 4P) |
   |---|---|---|
   | SDA | GPIO 26 (SIOD du connecteur caméra) | IO32 |
   | SCL | GPIO 27 (SIOC du connecteur caméra) | IO25 |
   | GND | GND | GND |

   Une seule paire de résistances de rappel de 4,7 kΩ vers 3,3 V; câble de moins de 30 cm. La
   caméra n’est pas utilisée au P0 (AI Vision hors P0); si son module reste branché, son adresse
   SCCB (`0x30`) ne croise pas celle du CYD.
3. **Le CYD fait le travail d’affichage** : génération du QR à partir de l’URI du doc 10 §27.1,
   rendu, messages prédéfinis de statut, écran d’accueil.
4. **Le hub n’accuse l’affichage que sur preuve du CYD.** Le CYD signale « dessiné » pour une
   instruction précise (identifiant et révision) une fois le tracé terminé; le hub publie alors
   `ACCESS_CHALLENGE_DISPLAYED`. Un échec ou une absence de réponse dans le délai devient
   `SCREEN_UNAVAILABLE`.
5. **Le CYD efface seul**, sans attendre le hub : à l’échéance locale transmise par le hub, au
   démarrage, et après quelques secondes sans échange I2C (hub redémarré ou débranché).
6. **Le jeton ne sort jamais du boîtier par une autre voie** : il transite en clair sur la liaison
   I2C interne, n’est conservé qu’en RAM sur le CYD, n’est jamais journalisé et est effacé à
   l’effacement de l’écran.

Le format des trames I2C (commande, longueur, contrôle CRC-16/CCITT-FALSE comme les segments
RS-485, état lu par le hub) est spécifié dans le README du firmware avec son implémentation, comme
la trame des cellules.

## Options écartées

| Option | Raison |
|---|---|
| CYD comme hub | Refusée par l’équipe : il faudrait deux UART libres pour RS-485 et le CYD n’en a qu’une exposée; écran, QR, TLS et deux segments dans 520 Ko sans PSRAM |
| Écran SPI simple sur le hub | Pas de broches libres sur le hub sans retirer la caméra et ses signaux; QR et bibliothèque graphique dans une image déjà à 78 % |
| UART0 du hub vers le CYD | Perte du moniteur série USB en fonctionnement, dont dépendent les bancs et les diagnostics |
| Sans fil (ESP-NOW, ou client MQTT sur le CYD) | Le défi voyagerait par radio, et le CYD deviendrait un second device réseau, contraire au doc 10 §5 et à la frontière de confiance du doc 07 |

## Conséquences

- Deux firmwares pour le hub physique : `locker-controller` (hub) et un nouveau
  `display-node` (CYD). Le hub garde l’interface `Display` du firmware; seule son implémentation
  change (I2C au lieu d’un écran local).
- Le rendu effectif reste prouvé côté hub par la réponse du CYD, pas par un PUBACK ni par l’envoi
  I2C (doc 10 §27.2).
- Alimentation : le CYD est alimenté par le 5 V du hub, masse commune; sa consommation est à
  ajouter au budget du doc 12 §8 et à mesurer.
- Le doc 12 (§2, §6, §11, §12) et la nomenclature sont à mettre à jour **après acceptation** de cet ADR.
- Risque : un bus I2C long ou bruité peut bloquer le maître. La liaison reste courte et interne, le
  hub borne chaque transaction dans le temps et ne laisse jamais une erreur I2C bloquer les
  segments RS-485 ni MQTT.

## Validation

- Banc : défi fictif → QR visible sur le CYD → `ACCESS_CHALLENGE_DISPLAYED` seulement après le
  rendu; CYD débranché → `SCREEN_UNAVAILABLE`; échéance, redémarrage du hub et du CYD → écran vidé.
- Essai coordonné avec la session Railway de Philippe : préparation → QR → accusé reflété dans
  l’API → effacement à l’échéance; doublons, révisions périmées et mauvaise session refusés.
