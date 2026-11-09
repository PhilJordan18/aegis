# Landing publique — affirmations et sources (issue #153)

État audité : `dev` `023ab51`, 9 novembre 2026. Quatre statuts :

- **Logiciel implémenté** : code intégré sur `dev`, couvert par des tests ou la
  recette (`docs/qualite/recette-humaine.md`).
- **Validation simulée** : démontré avec le simulateur de hub
  (`tools/hub-simulator`), jamais avec le matériel.
- **Validation physique** : mesuré sur le prototype réel. Aucune ligne de la page
  ne peut encore porter ce statut : le dossier physique n'enregistre aucun résultat
  de POC (document 12, « aucun résultat de POC ajouté »; recette : « aucune preuve
  matérielle »).
- **Prévu** : décidé dans le scope, les ADR ou les contrats, non livré.

Formulation : une capacité « Prévu » s'écrit au futur ou avec « conçu pour » et
n'est jamais présentée comme démontrée. Les indicateurs du scope §19.1 ne sont pas
cités tant qu'ils ne sont pas mesurés; les bénéfices commerciaux §19.2 ne sont
jamais cités.

## 1. Positionnement et promesse

| # | Affirmation candidate (FR) | Statut | Source |
|---|---|---|---|
| P1 | Aegis est une plateforme de disponibilité opérationnelle et de traçabilité des équipements critiques partagés. | Positionnement établi | Scope §2, §3.1 |
| P2 | « Prêt. Autorisé. Prouvé. » / « Ready. Authorized. Proven. »; « L’essentiel, sous contrôle. »; « Disponibilité, conformité et traçabilité de vos équipements. » | Textes de marque établis | `identite/reference.md` « Vocabulaire », glossaire « Signatures de marque » (décision du 21 octobre 2026) |
| P3 | Un inventaire peut déclarer un équipement disponible alors qu'il est emprunté, absent, endommagé, non calibré ou interdit à la personne qui le demande. | Problématique établie | Scope §4; README « La valeur démontrée » |
| P4 | Aegis répond à la question : quel équipement est réellement prêt, conforme et autorisé pour cette personne, maintenant ? | Positionnement établi | Scope §2 |
| P5 | Conçu pour les équipes de maintenance, d'inspection et de services techniques; le laboratoire du Cégep de Sorel-Tracy est le terrain de validation, pas le marché. | Établi, à formuler ainsi | Scope §3.2, §5.2 |
| P6 | Prototype académique (420-5X7-SO, automne 2026) conçu et réalisé par Aegis Studio, Philippe Jordan Monfouayi Mba (logiciel) et Yoël Jimmy Razafindretsa (matériel). | Établi | README racine; `reference.md` « Marque commune » |
| P7 | Aegis garantit que chaque technicien reçoit un équipement disponible, conforme et traçable. | **À éviter tel quel** : la promesse est une direction, pas une preuve | Scope §3.5 (« sans prétendre prouver ») |
| P8 | Toute métrique de gain de temps, de réduction des pertes ou de retour sur investissement. | **Interdit** | Scope §14, §19.2 |
| P9 | Fiabilité industrielle, résistance à l'effraction, conformité réglementaire, clients, témoignages. | **Interdit** | Scope §14; issue #153 |

## 2. Readiness et catalogue

| # | Affirmation | Statut | Source |
|---|---|---|---|
| R1 | Chaque équipement a une readiness pour une personne donnée : `READY`, `BLOCKED` ou `UNKNOWN`, avec une raison explicite (calibration expirée, maintenance, endommagé, absent, accès non autorisé…). | Logiciel implémenté (API `GET /api/v1/assets`, iOS catalogue) | `services/api/README.md` « Catalogue technicien et readiness (RDY-01, RDY-02) »; #105, #107; glossaire « Raisons » |
| R2 | La readiness est dérivée des faits (présence, disponibilité, état opérationnel, calibration, niveau d'accès); personne ne la coche à la main. | Logiciel implémenté | Scope §7.2, §11.3; `aegis-core` invariant 8 |
| R3 | Un équipement présent mais non calibré est bloqué (`CALIBRATION_EXPIRED`); le jeu de démonstration A1 prêt / A2 bloqué existe. | Logiciel implémenté (jeu de démonstration API) | Scope §10.1; API README « Jeu de démonstration » |
| R4 | L'administrateur gère modèles et exemplaires, les archive sans effacer l'historique, attribue identifiants et placement attendu, règle l'horaire hebdomadaire du casier. | Logiciel implémenté (Manager + API) | Recette humaine « Ce qu'un utilisateur peut faire »; #96, #137, #140, #139 |
| R5 | La présence d'un équipement est déduite des lectures RFID normalisées; elle passe à `UNKNOWN` quand le hub se tait. | Validation simulée (API + simulateur) | API README « Présence RFID (PHY-02) »; recette R4, R6 |
| R6 | Le Manager affiche l'état du casier : en ligne / hors ligne, portes, erreurs signalées par l'appareil. | Logiciel implémenté, données simulées | #118, #142, #148; recette W1, W2 |

## 3. Réservation, retrait, retour

| # | Affirmation | Statut | Source |
|---|---|---|---|
| C1 | Le technicien réserve un équipement prêt jusqu'à une heure de la plage d'exploitation; il suit et annule sa réservation dans Aegis Mobile. | Logiciel implémenté (API + iOS) | #106, #114, #121; recette R5 |
| C2 | Une réservation, même à distance, n'ouvre aucune porte. | Invariant établi et implémenté (aucune commande émise à la réservation) | Scope §7.6; glossaire « La réservation n'ouvre aucune porte. » |
| C3 | Avant chaque retrait ou retour, le hub affiche un QR temporaire lié à l'opération et au compte; le technicien le scanne; le backend revérifie tout, puis autorise une seule commande pour une seule cellule. | **Prévu** : contrats écrits (doc 09, doc 10), schéma `V007`–`V009` créé, outbox de commandes et corrélation des accusés livrés; aucune route de préparation ni de scan sur `dev`; aucun scan dans iOS | Scope §11.7, §11.14; API README « Défis locaux… », « Outbox (IOT-01) »; #122, #123; `apps/ios/README.md` « État » |
| C4 | Le prêt commence et se termine uniquement après des observations physiques cohérentes (porte, lecture stable du bon tag), jamais par un clic. | **Prévu** (règle établie; observations ingérées côté API, prêt non créé automatiquement) | Scope §7.3, §11.5; API README « Lecture du prêt courant (lecture seule) » |
| C5 | Le hub exécute une commande autorisée; il n'accorde jamais un droit. | Établi; partiellement implémenté (firmware valide, journalise et accuse les commandes; aucun actionnement) | ADR-001; `firmware/locker-controller/README.md` « Not done yet » |
| C6 | Un retard ne rend jamais l'équipement disponible; un retour n'exige pas que l'équipement soit prêt. | Invariants établis | Scope §7.7, §11.4; `AGENTS.md` invariants |
| C7 | Une commande expirée, rejouée ou destinée à une autre cellule n'est pas exécutée une seconde fois. | Validation simulée (API et simulateur dédupliquent); firmware : journal NVS des commandes consommées | Doc 10 §16.1; #123; #138; simulateur « Journal de déduplication » |
| C8 | Objectif de la session : 10 retraits et 10 retours consécutifs sans intervention manuelle. | **Prévu** (cible d'acceptation, non atteinte) | Scope §18 |

## 4. Audit et chaîne de possession

| # | Affirmation | Statut | Source |
|---|---|---|---|
| A1 | Chaque mutation du catalogue est auditée dans sa transaction, dans une table en ajout seul. | Logiciel implémenté | #101; API README « Rôles PostgreSQL » |
| A2 | L'historique de possession, d'audit, de commandes et d'événements n'est jamais effacé. | Invariant établi; contraintes de base en place (le rôle applicatif ne peut ni supprimer ni vider ces tables) | `AGENTS.md`; API README « Réservations, opérations et prêts (DB-02) » |
| A3 | L'administrateur consulte une chronologie compréhensible et les anomalies. | **Prévu** (aucune route ne lit `audit_events`; sections « Audit » et « Anomalies » du shell « à venir ») | API README « Limites connues »; `shell.sections` |

## 5. Système et matériel

| # | Affirmation | Statut | Source |
|---|---|---|---|
| S1 | Trois logiciels : Aegis Mobile (technicien, iPhone), Aegis Manager (administration Web), Aegis Control (API Spring, seule autorité). Les clients parlent uniquement à l'API; PostgreSQL reste privé. | Établi et implémenté | ADR-001, ADR-010; README « Architecture » |
| S2 | Le casier : un hub avec écran et deux cellules indépendantes A1 et A2; une cellule par compartiment; chaque cellule rejoint le hub par son propre câble; les cellules n'ont ni écran, ni Wi-Fi, ni MQTT. | Architecture acceptée; **réalisation électrique à qualifier** | ADR-002; doc 12 §1, §2 |
| S3 | L'écran du hub affiche le QR, les consignes et le résultat fourni par le backend. | Prévu (contrat doc 10, simulateur « Écran du hub »; firmware : `display` non souscrit) | Doc 12 §6; simulateur; firmware README |
| S4 | Le hub ESP32 se connecte au broker MQTT en TLS avec sa propre identité, publie son état et ses battements. | Logiciel implémenté (firmware et broker), **validé sur banc logiciel seulement** | #126, #129, #138; `infra/mqtt/README.md` |
| S5 | RFID UHF par cellule comme détection de départ; repli QR/NFC + porte + présence si le POC échoue. | Prévu, POC requis | Scope §7.4, §11.8, §17; doc 12 §1.1 |
| S6 | Dimensions, connecteur (M12 recommandé, RJ45 étudié), verrou 12 V, composants : candidats. | Non approuvés : ne pas chiffrer sur la page | Doc 12 §1.1, §4, §8; ADR-011 |
| S7 | Le QR autorise l'accès local; les capteurs confirment le mouvement; un QR relayé par photo reste une limite connue. | Établi, à dire si la page détaille le QR | Scope §7.6; README |

## 6. Vocabulaire imposé

| Français | English | Source |
|---|---|---|
| casier, cellule (A1, A2), hub (écran) | locker, compartment, hub | Glossaire « Domaine »; doc 12 |
| disponibilité opérationnelle (readiness), empêchement | readiness, blocker | Glossaire |
| réservation, retrait, retour, prêt, chaîne de possession, anomalie | reservation, checkout, return, loan, chain of custody, anomaly | Glossaire |
| Aegis, Aegis Studio, Aegis Manager, Aegis Mobile, Aegis Control | inchangés | Glossaire « Produits » |

Note technique : le mot « hub » est aujourd'hui refusé par `identity.test.ts` dans
toute source de production du Web (brief §7.2). La page ne pourra l'écrire qu'après
la décision de Philippe; sinon « module central » ou « casier » le remplace.
