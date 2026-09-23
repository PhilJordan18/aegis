---
title: "Aegis"
subtitle: "Cahier de conception — Écosystème connecté"
author:
  - "Philippe Jordan Monfouayi Mba"
  - "Yoël Jimmy Razafindretsa"
date: "23 septembre 2026"
lang: fr-CA
toc: true
toc-depth: 2
aegis-primary: "#0F2C46"
aegis-accent: "#58A6FF"
aegis-dark: "#111827"
---

# Identification

**Tableau 1 — Identification du projet et de l’équipe.**

| Élément | Information |
|---|---|
| Projet | Aegis — plateforme de disponibilité opérationnelle et de chaîne de possession |
| Cours | 420-5X7-SO — Écosystème connecté |
| Session | Automne 2026 |
| Établissement | Cégep de Sorel-Tracy |
| Équipe | Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa |
| Enseignants | Alexandre Vovan, Jean-Philippe Hébert et Jordan Rioux-Leclair |
| Date du document | 23 septembre 2026 |
| Remise du cahier | Semaine 4, le 23 septembre 2026 au soir, selon l’échéance confirmée par l’équipe |
| Statut | Conception du P0; choix matériels à confirmer après les POC |

> **Statut du document.** Ce cahier synthétise la conception du P0 avant le
> développement. Les décisions acceptées sont distinguées des propositions et
> des résultats encore attendus. Aucun POC non réalisé n’est présenté comme
> concluant.

# 1. Résumé du projet

Aegis est un prototype de **plateforme de disponibilité opérationnelle et de
chaîne de possession pour des équipements critiques partagés**. Il relie une
application iOS, une administration Web, un service central Spring Boot,
PostgreSQL, un courtier MQTT et un casier connecté composé d’un concentrateur
avec écran et de deux cellules
indépendantes.

Le système ne cherche pas seulement à indiquer où se trouve un équipement. Il
doit déterminer si cet équipement est réellement prêt, conforme, disponible et
autorisé pour une personne donnée au moment de la demande. La réponse du service
central est une **disponibilité opérationnelle** (*readiness*) explicite :
`READY`, `BLOCKED` ou `UNKNOWN`, accompagnée d’une raison compréhensible.

Le P0 démontre un parcours complet et traçable : configuration d’un actif,
évaluation de sa disponibilité opérationnelle, réservation, contrôle local par
QR, ouverture du bon
compartiment, confirmation physique du retrait, création du prêt, retour et fin
de la chaîne de possession. Les actions sensibles sont auditables et résistent
aux doublons, aux expirations et aux événements désordonnés.

Le laboratoire du Cégep sert de terrain de validation. Le marché de référence
est celui des petites et moyennes équipes de maintenance, d’inspection et de
services techniques qui partagent des appareils coûteux, spécialisés ou soumis
à des règles de calibration.

# 2. Problématique et contexte

Un inventaire classique peut déclarer un outil disponible alors qu’il est
emprunté, absent de son compartiment, endommagé, non calibré ou inaccessible au
technicien qui le demande. L’écart entre l’état informatique et la réalité
physique crée plusieurs risques : déplacement inutile, intervention retardée,
utilisation d’un appareil non conforme et perte de traçabilité sur le dernier
détenteur.

Aegis aborde ce problème par trois distinctions fondamentales :

1. la présence physique n’est pas la disponibilité opérationnelle;
2. une intention utilisateur n’est pas une preuve de mouvement;
3. une réservation n’est pas un prêt.

Le service central combine donc les faits connus sur l’actif, l’utilisateur, la
calibration, l’état opérationnel, les réservations, les prêts et le casier. Il
autorise une opération seulement si les gardes applicables sont satisfaites. Il
ne confirme ensuite le retrait ou le retour qu’à partir d’observations physiques
cohérentes et corrélées à cette opération.

Le projet s’inscrit dans le cours Écosystème connecté, qui exige l’intégration de
l’Internet des objets, d’une application mobile et d’une application Web ou d’un
service. Le cahier prépare le prototype fonctionnel qui sera développé et
présenté au cours de la session.

# 3. Objectifs et limites du P0

## 3.1 Objectifs obligatoires

Le P0 doit permettre de :

- gérer des comptes de démonstration pour les techniciens et administrateurs;
- configurer deux actifs et leur affectation aux cellules A1 et A2;
- calculer la disponibilité opérationnelle selon la présence, la disponibilité, l’état, la
  calibration et le niveau d’accès;
- réserver un actif admissible dans une plage d’exploitation valide;
- exiger un QR temporaire affiché localement avant chaque ouverture métier;
- cibler uniquement le compartiment attendu;
- créer un prêt après un retrait physiquement confirmé;
- terminer un prêt après un retour physiquement confirmé;
- traiter les expirations, doublons, pertes de connexion et incohérences;
- fournir une piste d’audit permettant de reconstruire chaque opération;
- fonctionner avec un simulateur IoT afin de ne pas bloquer le logiciel sur les
  POC matériels;
- être lancé et démontré à partir d’une procédure reproductible.

## 3.2 Invariants structurants

- La disponibilité opérationnelle est calculée; elle n’est jamais modifiée comme un simple booléen.
- Un actif possède au plus une réservation active et un prêt actif.
- Un technicien possède au plus une réservation active.
- Une réservation ou un QR ne commande jamais seul une ouverture.
- Un ACK du hub ne prouve ni un retrait ni un retour.
- Une commande ou un événement dupliqué ne produit pas un second effet métier.
- Une opération expirée, consommée ou destinée à une autre cellule est refusée.
- Un prêt en retard garde l’actif indisponible.
- Le retour d’un actif emprunté reste possible même si cet actif n’est plus
  `READY` pour un nouvel emprunt.
- Une anomalie n’est résolue qu’avec une preuve corrective cohérente.

## 3.3 Limites assumées

Le P0 couvre un casier, deux cellules, deux actifs principaux et quelques
comptes préparés. Il ne prétend pas démontrer une fiabilité industrielle, une
disponibilité 24/7 ou un gain financier mesuré chez un client réel.

L’autorisation métier hors ligne, Android, AI Vision, le multi-site, les
intégrations ERP/CMMS, les analyses prédictives, les réservations récurrentes et
une garantie anti-relais du QR sont hors périmètre. Ces limites protègent le parcours
central et la date de livraison.

# 4. Scénario de démonstration

## 4.1 Préparation

Deux équipements comparables sont configurés :

**Tableau 2 — Conditions initiales du scénario de démonstration.**

| Actif | Situation initiale | Résultat attendu |
|---|---|---|
| A1 | Présent, disponible, fonctionnel, calibré et accessible | `READY` |
| A2 | Présent et disponible, mais calibration expirée | `BLOCKED` avec `CALIBRATION_EXPIRED` |

Un administrateur prépare les actifs, les tags, les cellules, l’horaire et les
comptes. Le hub est en ligne, l’écran fonctionne et les deux cellules sont
fermées.

## 4.2 Démonstration nominale

1. Le technicien se connecte à Aegis Mobile.
2. Il voit A1 prêt et A2 bloqué avec une raison explicite.
3. Il réserve A1 jusqu’à une heure permise par l’horaire.
4. Il prépare le retrait; aucune serrure ne s’ouvre à cette étape.
5. Le hub affiche un QR temporaire propre à l’opération.
6. Le technicien scanne le QR avec l’iPhone.
7. Le service central revalide les droits et consomme le défi une seule fois.
8. Une commande MQTT cible uniquement la cellule A1.
9. Le hub accuse la commande, ouvre A1 et remonte les observations de porte et
   d’actif.
10. Après une séquence cohérente, le service central confirme le retrait et crée le prêt.
11. Le technicien exécute un nouveau parcours local pour le retour.
12. La présence de l’actif attendu et la fermeture de porte terminent le prêt.

## 4.3 Refus et robustesse démontrés

La présentation inclut au minimum :

- le refus de réserver A2 en raison de sa calibration;
- le refus d’un QR expiré, rejoué ou soumis par un autre compte;
- l’absence de double effet lors de la rediffusion d’un message MQTT;
- le ciblage exclusif de A1 ou A2;
- une anomalie ou une perte de connexion visible et auditable;
- le maintien de l’indisponibilité d’un actif dont le prêt est en retard.

L’objectif final de répétabilité est de réussir **10 retraits et 10 retours
consécutifs**, sans modification manuelle de PostgreSQL et sans double traitement
causé par un rejeu.

# 5. Utilisateurs et principaux parcours

**Tableau 3 — Acteurs et parcours couverts par le P0.**

| Acteur | Besoin principal | Parcours P0 |
|---|---|---|
| Technicien | Obtenir rapidement un équipement prêt et autorisé | Connexion, consultation, réservation, scan QR, retrait, suivi du prêt et retour |
| Administrateur | Maintenir les données fiables et traiter les situations anormales | Catalogue, calibration, placements, horaires, supervision, audit et reconnaissance d’anomalie |
| Aegis Control | Appliquer une interprétation unique des règles | Disponibilité opérationnelle, autorisation, transactions, corrélation, audit et publication des commandes |
| Casier connecté | Exécuter une commande limitée et produire des observations | Affichage, ciblage de cellule, serrure, porte, RFID, signal de vie et erreurs |

## 5.1 Parcours du technicien

Le P0 dessert **une seule institution par déploiement**. Le technicien se
connecte avec un compte préparé et retrouve le parc de la même institution que
l'administrateur Web. Le backend applique les rôles, niveaux d'accès et règles
de propriété des opérations : appartenir au même parc ne permet pas de gérer
les actifs ni de consulter les prêts privés d'un autre technicien.
Il n'y a ni inscription publique, ni sélection d'institution, ni approbation à
chaque connexion. La gestion de plusieurs institutions dans une même instance
est reportée à une évolution ultérieure, hors P0.

Le mobile présente l’état fourni par le service central, mais ne décide jamais qu’un
actif est prêt. Une réservation peut être effectuée à distance; l’ouverture exige
ensuite la preuve locale. Pendant une opération, l’application consulte l’état de
`LockerOperation` et affiche la décision serveur plutôt qu’un succès anticipé.

## 5.2 Parcours de l’administrateur

L’administration Web prépare le catalogue, les règles de calibration, les
affectations physiques et les horaires. Elle permet d’observer les casiers, les
prêts, les anomalies et l’audit. Un administrateur peut reconnaître une anomalie
et documenter son intervention, mais ne peut pas la marquer arbitrairement comme
résolue.

## 5.3 Aperçu des interfaces

![Parcours essentiels des interfaces iOS et Web](../design/aegis-parcours-ui.svg)

**Figure 1 — Maquettes fonctionnelles du P0.** L’application iOS privilégie
l’action immédiate du technicien : comprendre pourquoi un actif est disponible
ou bloqué, réserver, scanner puis suivre l’opération. L’administration Web
privilégie la densité utile : état des casiers, anomalies, prêts et actions de
configuration. La couleur n’est jamais l’unique porteur d’information; chaque
statut comporte un libellé et un symbole. Cette illustration historique n'est
pas une maquette approuvée pour l'implémentation; la navigation retenue et les
écrans détaillés doivent être distingués de sa présentation exploratoire.

## 5.4 Navigation et identité visuelle

La structure de navigation retenue le 23 septembre 2026 comprend trois sections
sur iOS — **Équipements**, **Mon activité**, **Compte** — et six sections sur le
Web — **Vue d'ensemble**, **Équipements**, **Réservations et prêts**, **Casiers**,
**Anomalies**, **Audit**. Le scan QR appartient au parcours guidé de retrait ou de
retour; il ne constitue pas une section indépendante. Cette organisation ne
rajoute pas de gestion complète des utilisateurs au P0.

L'identité partagée s'appuie sur le bleu, le bleu sombre et l'indigo, avec des
dégradés lumineux, des surfaces vitrées mesurées et des formes arrondies. Les
deux plateformes doivent disposer d'un thème clair et d'un thème sombre
cohérents. Les contrôles restent adaptés à chaque plateforme; l'identité commune
n'impose pas une disposition identique sur téléphone et ordinateur.

La transparence et le mouvement soutiennent la hiérarchie sans masquer les
statuts, les raisons de blocage ou les consignes physiques. Des surfaces opaques
et une présentation sans animation doivent préserver l'usage lorsque ces effets
sont réduits. La famille typographique, les valeurs de couleurs et les maquettes
détaillées restent à valider. Le [brief de direction visuelle](../design/asset-lifecycle/direction-validee.md)
consigne les références, les limites et les écrans à préciser avant réalisation.

# 6. Architecture globale et frontières de confiance

```mermaid
flowchart TD
    TECH["Technicien"]:::persona
    ADMIN["Administrateur"]:::persona
    IOS["Aegis Mobile<br/>SwiftUI"]:::software
    WEB["Aegis Manager<br/>React"]:::software
    API["Aegis Control<br/>Spring Boot"]:::software
    DB[("PostgreSQL")]:::infra
    BROKER["Broker MQTT"]:::infra
    NODE["Aegis Locker Node<br/>ESP32"]:::hardware

    TECH -->|utilise| IOS
    ADMIN -->|utilise| WEB
    IOS -->|HTTPS| API
    WEB -->|HTTPS| API
    API -->|transactions| DB
    API <-->|MQTT sécurisé| BROKER
    BROKER <-->|commandes et événements| NODE

    classDef persona fill:#2B2440,stroke:#9F91F0,color:#EDE9FE
    classDef software fill:#0F2C46,stroke:#58A6FF,color:#D6E8FB
    classDef infra fill:#2A2A2E,stroke:#9CA3AF,color:#E6EDF3
    classDef hardware fill:#3A2A0E,stroke:#D9A441,color:#FCEACD
```

**Figure 2 — Architecture logique du P0.** Le service central Spring Boot est l’unique
autorité métier. Les interfaces et le casier transmettent des intentions ou des
faits; ils ne confirment pas seuls une transition métier.

## 6.1 Responsabilités

**Tableau 4 — Responsabilités et limites de confiance des composantes.**

| Composante | Responsabilité | Limite de confiance |
|---|---|---|
| Aegis Mobile | Authentification, consultation, réservation, scan et suivi | Aucun accès direct à MQTT, PostgreSQL ou au casier |
| Aegis Manager | Configuration et supervision | Aucun contournement des autorisations serveur |
| Aegis Control | Décisions métier, transactions, contrats et audit | Ne transforme pas une intention en fait physique |
| PostgreSQL | Contraintes, atomicité, historique, déduplication et boîte d’envoi transactionnelle | Ne décide pas qu’un mouvement a eu lieu |
| Broker MQTT | Authentification, ACL et transport | Ne transforme pas les messages et n’accorde aucun droit |
| Hub ESP32 | Affichage, contrôles techniques, ciblage et acquisition | N’évalue ni l’utilisateur ni la disponibilité opérationnelle |
| Cellule | Actionnement et observation locale | Aucun réseau IP, MQTT ou droit métier |

## 6.2 Frontières et flux interdits

Les frontières principales sont le réseau HTTPS des clients, l’entrée de l’API,
la connexion privée à PostgreSQL, le courtier MQTT et la liaison physique entre le
hub et chaque cellule.

Les flux suivants sont interdits :

- iOS ou React vers PostgreSQL;
- iOS ou React vers MQTT ou une serrure;
- hub ou cellule vers PostgreSQL;
- cellule vers Internet;
- création d’une commande avant la validation du contrôle local;
- confirmation d’un prêt à partir d’un ACK ou d’un simple délai;
- exposition du secret du QR dans une réponse REST, une trace ou une vue Web.

# 7. Modèle de données et machines à états essentielles

## 7.1 Vue logique avec attributs essentiels

```mermaid
erDiagram
    USER {
        uuid id PK
        string displayName
        string role
        string maximumAccessLevel
        string status
    }
    ASSET_MODEL {
        uuid id PK
        string name
        string manufacturer
        string modelNumber
        boolean defaultCalibrationRequired
    }
    ASSET {
        uuid id PK
        uuid assetModelId FK
        string assetCode
        string operationalStatus
        string requiredAccessLevel
        datetime calibrationDueAt
    }
    ASSET_IDENTIFIER {
        uuid id PK
        uuid assetId FK
        string identifierType
        string identifierValue
        datetime revokedAt
    }
    LOCKER {
        uuid id PK
        string code
        string timeZone
        string status
    }
    COMPARTMENT {
        uuid id PK
        uuid lockerId FK
        string code
        string doorStatus
        string lockStatus
    }
    ASSET_PLACEMENT {
        uuid id PK
        uuid assetId FK
        uuid compartmentId FK
        datetime validFrom
        datetime validTo
    }
    RESERVATION {
        uuid id PK
        uuid assetId FK
        uuid userId FK
        string status
        datetime reservedUntil
    }
    LOAN {
        uuid id PK
        uuid assetId FK
        uuid holderUserId FK
        string status
        datetime dueAt
        datetime returnedAt
    }
    LOCKER_OPERATION {
        uuid id PK
        string type
        string status
        uuid userId FK
        uuid assetId FK
        uuid compartmentId FK
        datetime expiresAt
    }
    PHYSICAL_OBSERVATION {
        uuid id PK
        uuid lockerOperationId FK
        string type
        string value
        datetime observedAt
    }
    ANOMALY {
        uuid id PK
        uuid lockerOperationId FK
        string type
        string status
        datetime resolvedAt
    }
    AUDIT_EVENT {
        uuid id PK
        uuid actorUserId FK
        string eventType
        string entityType
        uuid entityId
        datetime occurredAt
    }
    USER ||--o{ RESERVATION : cree
    ASSET_MODEL ||--o{ ASSET : decrit
    ASSET ||--o{ ASSET_IDENTIFIER : possede
    LOCKER ||--|{ COMPARTMENT : contient
    ASSET ||--o{ ASSET_PLACEMENT : a_pour_historique
    COMPARTMENT ||--o{ ASSET_PLACEMENT : recoit
    ASSET ||--o{ RESERVATION : concerne
    RESERVATION o|--o{ LOCKER_OPERATION : checkout_tente
    RESERVATION ||--o| LOAN : produit
    USER ||--o{ LOAN : detient
    ASSET ||--o{ LOAN : est_prete
    USER ||--o{ LOCKER_OPERATION : initie
    ASSET ||--o{ LOCKER_OPERATION : attend
    LOCKER ||--o{ LOCKER_OPERATION : orchestre
    COMPARTMENT ||--o{ LOCKER_OPERATION : cible
    LOAN o|--o{ LOCKER_OPERATION : retour_tente
    LOCKER_OPERATION o|--o{ PHYSICAL_OBSERVATION : rassemble
    LOCKER_OPERATION o|--o{ ANOMALY : peut_declencher
    USER o|--o{ AUDIT_EVENT : peut_agir
```

**Figure 3 — Relations et attributs métier essentiels.** Le diagramme rend le
cahier autonome pour comprendre les identifiants, états et échéances qui portent
le parcours. Les types SQL, contraintes et attributs techniques complets sont
précisés dans le modèle PostgreSQL détaillé.

Le modèle sépare notamment :

- l’actif physique (`Asset`) de sa catégorie (`AssetModel`);
- l’emplacement attendu (`AssetPlacement`) de la présence observée;
- la réservation (`Reservation`) de la possession réelle (`Loan`);
- l’opération orchestrée (`LockerOperation`) des faits physiques reçus;
- l’anomalie active (`Anomaly`) de l’historique immuable (`AuditEvent`).

## 7.2 Reservation

```mermaid
stateDiagram-v2
    [*] --> ACTIVE : demande admissible
    ACTIVE --> FULFILLED : retrait confirmé
    ACTIVE --> CANCELLED : annulation sûre
    ACTIVE --> EXPIRED : échéance sans retrait
    FULFILLED --> [*]
    CANCELLED --> [*]
    EXPIRED --> [*]
```

**Figure 4 — Cycle de vie d’une réservation.** Une réservation demeure une
intention exclusive; elle ne devient accomplie qu’avec le retrait confirmé.

Une réservation active ne devient `FULFILLED` que dans la transaction qui crée
le prêt. Elle n’expire pas pendant une opération de retrait déjà autorisée ou
physiquement incertaine.

## 7.3 Loan

```mermaid
stateDiagram-v2
    [*] --> ACTIVE : retrait confirmé
    ACTIVE --> RETURN_PENDING : retour autorisé
    RETURN_PENDING --> COMPLETED : retour confirmé
    RETURN_PENDING --> ACTIVE : échec sûr avant ouverture
    COMPLETED --> [*]
```

**Figure 5 — Cycle de vie d’un prêt.** L’état `RETURN_PENDING` protège la chaîne
de possession pendant une restitution en cours ou physiquement incertaine.

Le dépassement de `dueAt` ne modifie pas le statut. Il produit une information
de retard, tandis que l’actif demeure `BORROWED` jusqu’à un retour confirmé.

## 7.4 LockerOperation

```mermaid
stateDiagram-v2
    [*] --> REQUESTED : action utilisateur
    REQUESTED --> AWAITING_LOCAL_PROOF : défi créé
    AWAITING_LOCAL_PROOF --> AUTHORIZED : QR consommé et gardes revalidées
    AUTHORIZED --> COMMAND_SENT : commande publiée
    COMMAND_SENT --> COMMAND_ACKNOWLEDGED : hub accepte
    COMMAND_ACKNOWLEDGED --> DOOR_OPENED : porte ouverte observée
    DOOR_OPENED --> OBSERVATION_RECEIVED : preuve physique reçue
    OBSERVATION_RECEIVED --> CONFIRMED : séquence cohérente
    REQUESTED --> FAILED : demande refusée
    AWAITING_LOCAL_PROOF --> EXPIRED : défi expiré
    COMMAND_SENT --> ANOMALY : exécution incertaine
    DOOR_OPENED --> ANOMALY : preuve incohérente
```

**Figure 6 — Chemin principal d’une opération de casier.** Les sorties anormales
complètes sont résumées au tableau 5.

Le diagramme montre le chemin nominal et les sorties anormales les plus
représentatives. Toute étape non terminale peut être interrompue selon les règles
suivantes :

**Tableau 5 — Sorties anormales d’une opération de casier.**

| Situation | État terminal | Condition de sûreté |
|---|---|---|
| Refus métier avant une commande | `FAILED` | Aucune ouverture n’a pu se produire |
| Défi local arrivé à échéance | `EXPIRED` | Aucune commande de serrure n’a été créée |
| Délai après commande, porte certainement restée fermée | `EXPIRED` | Le casier est joignable, la situation physique est connue et aucune interaction ambiguë n’a eu lieu; une simple porte fermée au dernier instant ne suffit pas |
| Appareil hors ligne ou résultat physique incertain | `ANOMALY` | Une ouverture a pu se produire ou la preuve est incomplète |
| Mauvais actif ou porte non refermée | `ANOMALY` | Une intervention et une nouvelle preuve sont nécessaires |

`CONFIRMED`, `FAILED`, `EXPIRED` et `ANOMALY` sont terminaux pour une opération.
Une nouvelle tentative crée un nouvel identifiant; elle ne réactive jamais une
ancienne opération.

**Repères temporels du P0.** Les délais métier ne définissent pas la durée
d’alimentation de la serrure.

| Repère | Début et durée | Conséquence |
|---|---|---|
| Réservation | Immédiate, jusqu’à `reservedUntil` choisi dans la plage d’exploitation | Expire sans retrait confirmé, sauf retrait déjà autorisé ou physiquement incertain; au retrait, cette heure devient `Loan.dueAt` |
| Défi QR | À sa création; maximum retenu de 60 s, borné par l’horaire et la réservation applicable | Sans validation avant l’échéance, aucune commande de serrure; le prêt reste inchangé |
| Fenêtre physique | **120 s à partir de `authorizedAt`**, après validation du QR | Aucun essai ne prolonge la fenêtre; à échéance, `EXPIRED` si la situation est sûre, `ANOMALY` si elle est incertaine |
| Impulsion du verrou | À l’actionnement; limite à déterminer à partir de la fiche du verrou et des essais | Limitation locale indépendante des 120 s métier; sortie inactive au démarrage |
| Échéance du prêt | `dueAt` reprend `reservedUntil` lors du retrait confirmé | Son dépassement indique un retard, sans rendre l’actif disponible |

## 7.5 Anomaly

Une anomalie peut passer de `OPEN` à `ACKNOWLEDGED` lorsque l’administrateur en
prend connaissance. Elle passe de `OPEN` **ou** de `ACKNOWLEDGED` à `RESOLVED`
seulement lorsqu’une observation corrective cohérente est disponible : la
reconnaissance n’est donc pas une étape obligatoire avant la résolution. Une
récidive crée une nouvelle anomalie. L’historique précédent n’est ni rouvert ni
supprimé.

# 8. Flux de données et parcours retrait/retour

## 8.1 Diagramme de flux de données de niveau 0

```mermaid
flowchart LR
    TECH["Technicien"]:::external
    ADMIN["Administrateur"]:::external
    HUB["Hub du casier"]:::external
    AEGIS(("0 — Plateforme Aegis")):::process
    DATA[("D1 — Données métier et audit")]:::store

    TECH -->|connexion, réservation, QR, retrait et retour| AEGIS
    AEGIS -->|disponibilité, décisions et progression| TECH
    ADMIN -->|configuration, reconnaissance et consultation| AEGIS
    AEGIS -->|états, anomalies et audit| ADMIN
    AEGIS -->|QR, résultat et commande ciblée| HUB
    HUB -->|accusés, porte, verrou, RFID et signal de vie| AEGIS
    AEGIS <-->|transactions, contraintes et historique| DATA

    classDef external fill:#2B2440,stroke:#9F91F0,color:#EDE9FE
    classDef process fill:#0F2C46,stroke:#58A6FF,color:#D6E8FB
    classDef store fill:#2A2A2E,stroke:#9CA3AF,color:#E6EDF3
```

**Figure 7 — DFD-0 du P0.** Tous les échanges métier passent par Aegis Control.
Les interfaces humaines et le hub ne communiquent jamais directement avec le
magasin de données et ne s’accordent aucune transition métier.

## 8.2 Données échangées

**Tableau 6 — Canaux, données et protections.**

| Canal | Flux principal | Protections attendues |
|---|---|---|
| HTTPS | Intentions, lectures métier et scan QR entre clients et API | Authentification, autorisation, validation DTO, idempotence et erreurs stables |
| PostgreSQL | État métier, contraintes, audit, déduplication et boîte d’envoi transactionnelle | Accès privé, transactions, contraintes uniques et migrations Flyway |
| MQTT | Affichage, commandes, ACK, observations, signal de vie et erreurs | TLS, identité par appareil, ACL, QoS adapté, expiration et `messageId` |
| RS-485 local | Commandes et observations entre le hub et une cellule | Segment dédié, ciblage, contrôle d’intégrité et paramètres issus du POC |
| Optique | QR temporaire affiché par le hub et lu par l’iPhone | Secret éphémère, usage unique, liaison à l’opération et à l’initiateur |

## 8.3 Retrait

```mermaid
sequenceDiagram
    actor T as Technicien
    participant M as Aegis Mobile
    participant A as Aegis Control
    participant D as PostgreSQL
    participant B as Broker MQTT
    participant H as Hub et cellule A1

    T->>M: Préparer le retrait réservé
    M->>A: POST checkout avec clé d’idempotence
    A->>D: Créer opération, défi et instruction d’écran
    A-->>M: 202 AWAITING_LOCAL_PROOF et référence de suivi
    A->>B: Publier l’affichage
    B->>H: QR temporaire
    H-->>B: ACCESS_CHALLENGE_DISPLAYED
    B-->>A: Accusé d’affichage corrélé
    A->>D: Enregistrer displayedAt
    M->>A: GET opération
    A-->>M: Affichage confirmé, scan possible
    T->>M: Scanner le QR affiché
    M->>A: POST authorize-local
    A->>D: Revalider, consommer et autoriser atomiquement
    A-->>M: 202 AUTHORIZED, fenêtre physique de 120 s
    A->>B: Commander A1
    B->>H: UNLOCK_COMPARTMENT A1
    H-->>B: COMMAND_ACKNOWLEDGED
    B-->>A: Accusé de commande, pas une preuve de retrait
    H-->>B: Porte ouverte, actif retiré, porte refermée
    B-->>A: Observations physiques corrélées
    A->>D: Confirmer et créer Loan ACTIVE atomiquement
    loop Lecture périodique jusqu’à l’état terminal
        M->>A: GET opération
        A-->>M: État métier courant
    end
    M->>A: Rafraîchir prêt et actif
    A-->>M: Prêt actif et disponibilité mise à jour
```

**Figure 8 — Séquence de retrait.** Le courtier transporte les commandes et les
observations; PostgreSQL porte la décision durable et la déduplication.

Le suivi REST se poursuit pendant les phases d’attente et d’exécution; la boucle
est regroupée en bas pour la lisibilité. Les publications sont asynchrones :
aucune transaction SQL ne reste ouverte en attendant le hub. L’intervalle retenu
est d’environ une seconde, avec ralentissement sur erreur et arrêt au terminal.
L’application obtient le résultat en lecture, sans notification push ajoutée.
Une seule lecture de suivi est en vol à la fois. Le suivi s’arrête en arrière-plan
et reprend par une lecture immédiate au retour; les délais serveur continuent.

Le QR et l’accusé de commande sont des étapes nécessaires, mais insuffisantes.
Le prêt est créé avec la confirmation de l’actif attendu, dans la bonne cellule,
après la séquence de porte requise.

## 8.4 Retour

```mermaid
sequenceDiagram
    actor T as Technicien
    participant M as Aegis Mobile
    participant A as Aegis Control
    participant D as PostgreSQL
    participant B as Broker MQTT
    participant H as Hub et cellule attendue

    T->>M: Préparer le retour
    M->>A: POST return avec clé d’idempotence
    A->>D: Créer opération et défi
    A-->>M: 202 AWAITING_LOCAL_PROOF, prêt inchangé
    A->>B: Publier l’affichage
    B->>H: QR temporaire
    H-->>B: ACCESS_CHALLENGE_DISPLAYED
    B-->>A: Accusé d’affichage corrélé
    A->>D: Enregistrer displayedAt
    M->>A: GET opération
    A-->>M: Affichage confirmé, scan possible
    T->>M: Scanner puis soumettre le défi
    M->>A: POST authorize-local
    A->>D: Consommer, autoriser et passer Loan à RETURN_PENDING
    A-->>M: 202 AUTHORIZED, fenêtre physique de 120 s
    A->>B: Commander la cellule attendue
    B->>H: UNLOCK_COMPARTMENT
    H-->>B: COMMAND_ACKNOWLEDGED
    B-->>A: Accusé de commande, pas une preuve de retour
    H-->>B: Porte ouverte, actif présent, porte refermée
    B-->>A: Événements corrélés
    alt Preuve cohérente
        A->>D: Opération CONFIRMED et Loan COMPLETED
    else Preuve incertaine
        A->>D: Opération ANOMALY et prêt maintenu ouvert
    end
    loop Lecture périodique jusqu’à l’état terminal
        M->>A: GET opération
        A-->>M: État métier courant et consigne
    end
    M->>A: Rafraîchir prêt et actif
    A-->>M: Retour confirmé ou intervention requise
```

**Figure 9 — Séquence de retour.** Le prêt n’est terminé que lorsque les
événements corrélés prouvent le retour de l’actif attendu et la fermeture.
Comme au retrait, le mobile consulte l’opération pendant l’attente et l’exécution;
la réponse `202` accepte la demande, elle ne confirme pas le retour.

Un actif endommagé ou non calibré peut être retourné. Après la restitution, sa
non-conformité continue toutefois de bloquer un nouvel emprunt.

## 8.5 Contrats de service essentiels

Le contrat REST utilise le préfixe `/api/v1`. Les mutations sensibles exigent
une clé `Idempotency-Key`; les erreurs suivent `application/problem+json` avec un
code métier stable. Les routes suivantes suffisent à comprendre le parcours sans
consulter le catalogue complet :

**Tableau 7 — Routes REST essentielles au scénario.**

| Intention | Route principale | Autorisation et résultat |
|---|---|---|
| Ouvrir une session | `POST /auth/login` | Compte préparé; retourne un jeton expirant |
| Consulter les actifs | `GET /assets` | Technicien; disponibilité contextualisée |
| Réserver | `POST /reservations` | Technicien; crée une réservation `ACTIVE` ou refuse |
| Préparer le retrait | `POST /reservations/{id}/checkout` | Titulaire; crée une opération en attente de preuve locale |
| Autoriser localement | `POST /locker-operations/{id}/authorize-local` | Initiateur; consomme le défi QR et retourne `202` |
| Suivre une opération | `GET /locker-operations/{id}` | Initiateur; état serveur jusqu’au terminal |
| Préparer le retour | `POST /loans/{id}/return` | Titulaire; crée une opération de retour |
| Superviser les anomalies | `GET /admin/anomalies` et `POST /admin/anomalies/{id}/acknowledge` | Administrateur; lecture et reconnaissance seulement |

Trois données serveur rendent ces parcours utilisables sans déplacer les règles
métier dans les interfaces. Le statut du casier expose la plage ouverte, sa fin
et la prochaine ouverture calculées dans son fuseau. La réservation et le prêt
exposent une référence de suivi permettant de retrouver leur dernière tentative
après reconnexion : reprendre l’affichage ne redéclenche jamais la serrure.
Enfin, la vue administrative expose les faits de disponibilité, conformité et
présence, sans calculer un `READY` universel ni prêter à l’administrateur les
droits d’un technicien. Les DTO sont précisés dans le contrat REST, §8.

Le rail MQTT est versionné sous `aegis/v1/lockers/{lockerId}`. QoS 1 autorise
des doublons : le service central et le micrologiciel dédupliquent avec
`messageId`, `operationId`, l’expiration et l’état courant.

**Tableau 8 — Sujets MQTT du P0.**

| Suffixe du sujet | Sens | QoS / rétention |
|---|---|---|
| `/commands` | `UNLOCK_COMPARTMENT` du service central vers le hub | 1 / non retenu |
| `/events` | Accusés, porte, verrou, RFID et erreurs du hub | 1 / non retenu |
| `/display` | Défi QR et résultat temporaire vers l’écran | 1 / non retenu |
| `/status` | Signal de vie, `ONLINE` et Last Will `OFFLINE` | 0 pour le signal de vie; 1 et retenu pour la disponibilité |

Exemple abrégé d’une commande après consommation valide du défi QR :

```json
{
  "schemaVersion": "1.0",
  "messageId": "55c71961-21a3-4b2e-8b92-7f237e881a20",
  "type": "UNLOCK_COMPARTMENT",
  "operationId": "2f38d3b6-c18f-4a74-aa9a-2d574286013f",
  "lockerId": "d46a74ae-39dc-460b-8af0-38fc791b376a",
  "compartmentId": "1ae77ae3-8490-4f09-9412-a7816b77bff9",
  "issuedAt": "2026-09-16T14:31:00Z",
  "expiresAt": "2026-09-16T14:33:00Z"
}
```

Chaque hub possède une identité et des listes de contrôle d’accès limitées à son
propre casier. TLS est obligatoire pour le hub réel. Un acquittement MQTT ou une
confirmation d’affichage ne constitue jamais une preuve de retrait ou de retour.

# 9. Architecture physique du prototype

## 9.1 Forme du prototype

![Vue avant et arrière du hub et des deux cellules](../diagrams/architecture-physique/architecture-physique-vues.svg)

**Figure 10 — Prototype P0.** Le concentrateur porte l’écran, le calcul et la connexion
réseau. Chaque cellule correspond à un compartiment complet et ne possède ni
écran ni client MQTT.

## 9.2 Topologie retenue

![Topologie physique en étoile](../diagrams/architecture-physique/architecture-physique-topologie-etoile.svg)

**Figure 11 — Étoile à deux départs indépendants.** ADR-002 accepte deux ports,
deux câbles et deux segments RS-485 indépendants. Le brochage, les protections,
le protocole local et le budget de puissance restent soumis au POC.

## 9.3 Composition d’une cellule

![Composition fonctionnelle d’une cellule](../diagrams/architecture-physique/architecture-physique-cellule.svg)

**Figure 12 — Responsabilités locales.** Le M12 codé A à 5 contacts est la
recommandation actuelle pour la revue d’équipe. Il n’est pas accepté tant que la
référence, le courant, le câble, le brochage et les protections ne sont pas
validés. Le RJ45 propriétaire demeure une option initiale de repli économique,
avec un risque de confusion Ethernet/PoE à maîtriser.

# 10. Choix technologiques et ADR importants

## 10.1 Technologies

Les technologies ne sont pas justifiées par préférence. Pour chaque décision,
l’équipe part du besoin observable du P0, relève les contraintes qui empêchent
une solution plus simple, compare les options, puis fixe une preuve capable de
réfuter le choix. Les termes « retenu » et « proposé » conservent ici le statut
des ADR : une solution proposée doit encore réussir son arbitrage ou son POC.

**Tableau 9 — Besoins, alternatives et solutions techniques.**

| Besoin à satisfaire | Contraintes du P0 | Options examinées et limites | Solution retenue ou proposée | Preuve attendue |
|---|---|---|---|---|
| Guider le technicien lors d’une opération physique et lire le QR du hub | L’équipement de démonstration est un iPhone; Android est hors P0; le jeton doit être protégé; caméra, taille dynamique et accessibilité doivent rester cohérentes | Une PWA serait une autre réalisation possible, à qualifier sur les iPhone ciblés. SwiftUI est retenu pour intégrer directement les API iOS et Keychain; le bénéfice multiplateforme de Flutter n’est pas nécessaire au P0 | **Swift et SwiftUI**, base technique du client iOS | Scan sur l’iPhone réel, refus de caméra géré, jeton dans Keychain, états lisibles avec taille de texte agrandie |
| Administrer un catalogue et superviser les anomalies depuis un poste courant | Parcours denses, clavier, navigateur et accessibilité Web; aucune connexion directe à PostgreSQL ou MQTT | Des vues servies par Spring pourraient aussi respecter les règles métier. React est retenu pour un client interactif séparé consommant l’API; cette séparation impose en contrepartie sa propre construction et ses tests | **React et TypeScript**, base technique du client Web | Parcours réalisables au clavier, focus visible, erreurs nommées et accès uniquement par l’API |
| Appliquer une seule décision métier aux clients et au casier | Réservation, prêt, autorisation, audit et idempotence doivent rester cohérents et transactionnels; équipe de deux personnes | Des règles dans iOS, React ou le firmware seraient contournables et divergentes. Des microservices ajouteraient des pannes et déploiements distribués sans besoin de charge démontré | **Spring Boot en monolithe modulaire**, retenu par l’ADR-001 | Un client contourné reste refusé par le serveur; les gardes et transitions sont testées atomiquement |
| Conserver contraintes, historique et concurrence sans perte silencieuse | Une seule réservation et un seul prêt actifs par actif; migrations reproductibles; historique non destructif | Une base embarquée pourrait servir un petit backend; le choix privilégie ici un serveur relationnel distinct, les transactions concurrentes et les contraintes d’intégrité. Un stockage documentaire reste possible mais demanderait une autre démonstration des invariants | **PostgreSQL avec Flyway** | Migrations sur base vierge et existante, contraintes d’unicité et test de concurrence sur deux réservations |
| Échanger commandes, événements et disponibilité avec un hub qui peut se déconnecter | Communication bidirectionnelle, reconnexion, messages tardifs, doublons et identité propre au hub; le téléphone n’est jamais le canal d’ouverture | Un transport BLE pourrait conserver une autorité serveur, mais utiliser le téléphone comme relais ajouterait une dépendance exclue de notre architecture. Aucun besoin de longue portée ne justifie ici une liaison LoRa et sa passerelle. HTTP avec interrogation périodique reste possible; MQTT est retenu pour le modèle commandes/événements et la signalisation de disponibilité | **Wi-Fi, Mosquitto local et MQTT 3.1.1**, identité/secret par hub, TLS et ACL retenus par l’ADR-004 | ACL et TLS, Last Will, reconnexion, message expiré et rediffusion QoS 1 sans second effet |
| Relier le hub aux deux cellules en transportant données et alimentation sur un câble dédié | Un départ direct par cellule, environnement câblé, diagnostic A1/A2 et absence de radio ou d’autorité dans une cellule | BLE ou Wi-Fi imposeraient radio, configuration et alimentation dans chaque cellule sans transporter la puissance. I²C ou UART logique sont plus sensibles hors carte. Une étoile RS-485 passive avec A/B réunis crée un seul bus et ne fournit pas l’isolation attendue | **Deux segments RS-485 point à point indépendants**, topologie retenue par l’ADR-002; connectique et protection proposées | A1 n’actionne jamais A2; mesures d’erreurs, chute de tension, déconnexion et reprise sur chaque départ |
| Contrôler l’écran, le réseau et les E/S sans système d’exploitation généraliste | Sorties sûres, Wi-Fi, affichage du QR et E/S dans un prototype limité | Un Raspberry Pi serait capable d’assurer ces fonctions, mais aucun besoin applicatif de Linux n’est établi ici. L’ESP32 limite la pile à maintenir, sous réserve de vérifier mémoire, interfaces et broches disponibles | **ESP32**, référence exacte conditionnée aux broches et aux essais | Sorties inactives au démarrage, QR affiché, deux liaisons locales disponibles et reconnexion réseau maîtrisée |
| Exiger un défi lu sur le hub avant l’ouverture | Un code statique ne suffit pas; le hub ne décide jamais du droit; aucun canal téléphone–serrure | Un QR statique serait recopiable durablement. BLE et NFC demanderaient une autre intégration radio ou de proximité à qualifier. Le QR utilise l’écran et la caméra déjà prévus, sans promettre d’empêcher un relais par photo ou vidéo | **Défi QR éphémère lié à l’opération, à usage unique, 60 s maximum et 5 secrets erronés**, retenu par l’ADR-009; fréquence des préparations à qualifier | Mauvais utilisateur, expiration et rejeu refusés; lecture mesurée sur l’écran et l’iPhone réels |
| Identifier automatiquement l’actif observé dans la bonne cellule | L’utilisateur ne doit pas pouvoir confirmer librement la présence; la cellule voisine et un tag extérieur ne doivent pas être confondus avec la cible | QR ou NFC sur l’actif exigent une lecture manuelle. Un tag BLE exige pile et gestion radio. Un lecteur UHF global identifie des tags, mais localise mal le compartiment | **RFID UHF local par cellule à éprouver**, proposé par l’ADR-003; repli QR/NFC d’identité avec mesure de présence | POC avec orientations, matériaux, cellule voisine, tag extérieur, faux positifs, faux négatifs et seuils fixés avant l’essai |
| Reproduire l’environnement sur les deux postes et le jour de la démonstration | PostgreSQL, courtier et service doivent démarrer avec des versions et secrets contrôlés | Les installations manuelles dérivent entre postes et rendent le diagnostic de la démonstration dépendant de la machine | **Docker Compose** pour les services de développement et de démonstration | Démarrage documenté depuis un poste préparé, migrations appliquées et vérifications de santé réussies |
| Faire évoluer ensemble les contrats et leurs consommateurs | Les tranches traversent API, Web, iOS, firmware, tests et documentation; petite équipe | Des dépôts séparés multiplient les versions de contrat, les dépendances entre revues et les changements synchronisés | **Monorepo Git**, retenu par l’ADR-010 | Un changement transversal reste révisable dans un même historique avec tests et documentation associés |

## 10.2 Décisions acceptées

**Tableau 10 — Décisions d’architecture acceptées.**

| ADR | Décision | Conséquence principale |
|---|---|---|
| ADR-001 | Spring Boot est l’unique autorité métier | Les clients et le casier n’accordent aucun droit |
| ADR-002 | Hub et deux cellules en étoile avec segments RS-485 indépendants | Un port et un câble par cellule; composants et réalisation électrique à qualifier |
| ADR-004 | Mosquitto local, MQTT 3.1.1, QoS 1 critique et identité par hub | TLS et ACL; les doublons restent possibles et doivent être traités |
| ADR-005 | Outbox PostgreSQL et traitement idempotent | Une tâche Spring reprend les messages persistés après interruption |
| ADR-006 | Lecture REST environ chaque seconde pendant une opération | Une lecture en vol, pause en arrière-plan, reprise et arrêt au terminal |
| ADR-007 | JWT signé de 60 minutes, sans refresh token au P0 | Keychain sur iOS, mémoire Web; reconnexion après expiration |
| ADR-008 | Réservation et durée réelle de possession sont distinctes | Un retard ne termine pas un prêt et ne libère pas l’actif |
| ADR-009 | Défi QR lié à l’opération, 60 s maximum et 5 secrets erronés | Préparer devant le casier; la fenêtre physique de 120 s commence après autorisation |
| ADR-010 | Monorepo pour le P0 | Les changements transversaux restent révisables dans un même historique |

Les choix logiciels des ADR-004 à 007 et 009 ont été explicitement approuvés par
Philippe le 23 septembre 2026. Cette consignation ne vaut ni signature de Jimmy
ni preuve que leur implémentation est déjà testée.

## 10.3 Paramètres ouverts et preuves à produire

L’arbitrage logiciel principal est fermé; ses tests restent à réaliser. Les
références matérielles, le dimensionnement et les seuils dépendant du terrain ne
sont pas présentés comme validés par une décision documentaire.

**Tableau 11 — Conditions de réalisation et de validation restantes.**

| Référence | Ce qui reste à fixer ou vérifier | Moment de validation |
|---|---|---|
| ADR-002/003 | Composants, brochage, protections, localisation RFID, seuils de lecture et repli | POC avec Jimmy, avant dépendance au matériel réel |
| ADR-004/005 | Certificats et identités réelles; doublons, reconnexion, ACL et reprise de l’outbox après panne | Première intégration backend/hub |
| ADR-006 | Latence observée, ralentissement sur erreur, arrière-plan et reprise | Première interface de suivi |
| ADR-007 | Algorithme et gestion des clés documentés; jeton falsifié/expiré et droits retirés refusés | Bootstrap de la connexion réelle |
| ADR-009 | Taille et lecture du QR sur écran réel; seuil de fréquence des préparations | Avant intégration du contrôle local et répétition des cycles |
| Déploiement | Hôte compatible, réseau autorisé, signature et confiance TLS sur les iPhone | Première tranche sur appareils réels |

Le plafond antérieurement proposé de trois préparations en quinze minutes est
abandonné, car il peut interrompre une série normale. La limitation des
préparations reste obligatoire et configurable; son seuil devra laisser passer
les cycles représentatifs tout en refusant une rafale abusive. Aucun essai de
démonstration ne désactive les contrôles de propriétaire, de secret, d’expiration
ou d’usage unique. Les résultats des POC ne sont pas un prérequis à la remise de
ce cahier : celui-ci expose la méthode et les critères, pas des succès supposés.

# 11. Sécurité, fiabilité et gestion des anomalies

## 11.1 Défense en profondeur

- Le service central vérifie l’identité, le rôle, la propriété et les gardes métier.
- HTTPS protège les échanges des clients; TLS protège le hub réel sur MQTT.
- Chaque appareil possède une identité MQTT et des ACL limitées à son casier.
- Les secrets ne sont jamais versionnés. Les clés de signature, secrets MQTT et
  secrets QR ne sont jamais retournés par REST; seul le jeton d’accès du compte
  authentifié est remis au client lors de sa connexion.
- Le QR est éphémère, lié à une opération et consommé atomiquement.
- Le firmware refuse une mauvaise cible, une commande expirée ou déjà exécutée.
- Les sorties de serrure restent inactives au démarrage.
- Le circuit de commande et les protections électriques empêchent de piloter directement le
  verrou depuis un GPIO.

Le QR réduit l’utilisation d’un code ancien, mais ne garantit pas qu’une photo
ou une vidéo ne soit jamais relayée. Cette limite est assumée pour le P0.

## 11.2 Idempotence et cohérence

Les appels sensibles utilisent une clé d’idempotence. Les messages IoT portent
un `messageId`, une cible, une opération et une expiration. PostgreSQL impose les
unicités finales, tandis que le service central effectue la transition dans la même
transaction que la déduplication et l’audit.

MQTT QoS 1 permet une rediffusion. Le système ne suppose donc jamais une
livraison « exactement une fois ». La boîte d’envoi transactionnelle est retenue
(ADR-005). La décision, le message à
envoyer et l’audit sont enregistrés ensemble. Une tâche du monolithe publie
ensuite le message et reprend après interruption, sans garder de transaction
SQL ouverte pendant l’attente réseau. Un arrêt après publication peut entraîner
un doublon : les mêmes identifiants et les protections du hub empêchent une
seconde action. L’outbox n’ajoute ni service distribué ni nouveau broker.

Pour la connexion, le JWT ne remplace pas la vérification des droits courants.
La déconnexion efface le jeton local, sans révoquer immédiatement une copie déjà
obtenue; celle-ci expire au plus tard à l’échéance du jeton. Ce compromis est
accepté pour le P0. Un rechargement du Web demande une reconnexion; une expiration
pendant une opération ne termine ni le prêt ni le traitement serveur.

## 11.3 Gestion d’une réalité incertaine

Une panne avant toute possibilité d’ouverture peut terminer l’opération en
`FAILED` ou `EXPIRED`. Si une commande a pu être exécutée, si la porte s’est
ouverte ou si l’appareil disparaît pendant l’opération, le résultat devient
`ANOMALY`. Le système conserve alors le prêt ou la réservation dans un état
protecteur plutôt que d’inventer un succès.

L’administrateur peut reconnaître le problème. La résolution exige cependant
une observation cohérente : actif attendu présent ou absent selon le parcours,
porte refermée et nouvelle opération si nécessaire.

## 11.4 Déploiement de développement et de démonstration

Le déploiement P0 vise une démonstration reproductible, pas une exploitation
publique. Un ordinateur de l’équipe exécute PostgreSQL, le courtier MQTT et
Aegis Control dans Docker Compose. Aegis Manager est servi localement; l’iPhone
et le hub rejoignent les services par une adresse réseau documentée. Les secrets
réels proviennent de variables locales non versionnées et les migrations Flyway
s’exécutent au démarrage contrôlé du service central.

Le Wi-Fi du Cégep constitue un risque à valider : un réseau WPA2-Enterprise peut
demander une configuration de certificat au hub et l’isolation des clients peut
empêcher les échanges directs nécessaires à la démonstration. Avant de dépendre
de ce réseau, l’équipe doit vérifier avec le personnel autorisé que l’ESP32 peut
s’y authentifier et atteindre le courtier. Le repli est un réseau de laboratoire
ou un routeur de voyage autorisé par le Cégep, préconfiguré et testé; un partage
de connexion improvisé le jour de la démonstration n’est pas le plan principal.

La procédure de démonstration précisera les versions, les commandes de démarrage,
les comptes préparés, l’adresse des services, la remise à zéro des données de
démonstration et la vérification de santé. Aucune dépendance à un service
infonuagique non testé n’est introduite sur le chemin critique.

**Installation mobile et accès réseau.** Le Mac avec Xcode sert à compiler,
signer et installer l’application sur les iPhone; il peut être distinct de
l’ordinateur hébergeant les services. La proposition P0 est une installation de
développement sur les appareils autorisés, sans publication App Store requise.
Le compte de signature, les versions compatibles et l’échéance des profils
seront vérifiés avant les essais. Sur l’iPhone, l’adresse du backend est celle
de l’hôte accessible sur le réseau, jamais `localhost`.

HTTPS et MQTT/TLS doivent être testés avec une chaîne de confiance autorisée sur
les appareils réels. Le réseau local et la caméra nécessitent les déclarations
et permissions iOS appropriées. Aucun contournement de vérification des
certificats n’est prévu. PostgreSQL n’est pas exposé au réseau des téléphones.
La [fiche de déploiement P0](../research/deploiement-p0-et-validations.md)
détaille les étapes, les sources Apple/Docker et les preuves de validation.

## 11.5 Stratégie de vérification

**Tableau 12 — Niveaux de vérification et preuves attendues.**

| Niveau | Cible | Preuves attendues |
|---|---|---|
| Unitaire | Calcul de disponibilité, gardes et transitions | Cas nominal, limites, refus et états terminaux |
| Base de données | Contraintes, migrations et concurrence | Deux réservations simultanées, unicités actives et reprise Flyway |
| Contrat REST | Autorisation, idempotence et erreurs | Mauvais rôle, autre titulaire, clé rejouée et réponse stable |
| Contrat MQTT | ACL, expiration, doublons et reconnexion | Mauvaise cible refusée, rediffusion sans second effet et Last Will |
| Micrologiciel | Sorties sûres, ciblage et redémarrage | A1 n’actionne jamais A2; sortie inactive après coupure |
| Interface | États d’attente, erreur et accessibilité | Texte avec statut, focus visible, taille dynamique et reprise réseau |
| Intégration | Retrait et retour complets | Simulateur d’abord, puis matériel réel sans modification manuelle de la base |
| Acceptation | Scénario de cours | 10 retraits et 10 retours consécutifs, refus et anomalie consignés |

Un contrôle n’est déclaré réussi qu’avec la commande, le résultat et
l’environnement consignés. Une compilation seule ne prouve ni l’autorisation,
ni la cohérence transactionnelle, ni le mouvement physique.

# 12. POC matériels et critères de validation

**Tableau 13 — POC matériels, critères de décision et replis.**

| POC | Mesures ou essais | Critère de décision | Repli prévu |
|---|---|---|---|
| RFID local | Orientations, matériaux, voisin, tag extérieur, répétitions, faux positifs/négatifs, délai | Changement attendu identifié de manière répétable dans la bonne cellule, selon des seuils fixés avant l’essai | QR/NFC d’identité + porte + présence ou poids |
| Verrou rotatif | Courant, durée d’impulsion, ouverture, échauffement et repos sans tension | Actionnement répétable dans les limites de la fiche et sans commande GPIO directe | Changer le verrou ou son circuit de commande avant intégration |
| Alimentation et connecteur | Courant par cellule, chute de tension, contacts, polarité, court-circuit et protection par départ | Deux cellules alimentées sans surcharge; un défaut ne crée pas d’action sur l’autre | Simplifier la réalisation et réviser la connectique |
| RS-485 et ciblage | A1/A2, erreurs, délais, déconnexion, reprise, doublon et redémarrage | A1 n’actionne jamais A2; reprise sans ancienne impulsion | Un ESP32 pilote directement les deux compartiments |
| Écran et QR | Contraste, taille, éclairage, angle, expiration, effacement et caméra iPhone | QR lisible sur le matériel réel et inutilisable après expiration ou redémarrage | Changer l’écran ou sa disposition; aucun contournement du contrôle local |
| Nomenclature complète | Deux cellules, écran, RFID, câbles, interfaces, alimentation, protections, mécanique, taxes et livraison | Chaque fonction possède une quantité et un coût; les provisions sont identifiées; l’inventaire et les paniers réels remplacent les hypothèses avant achat | Ajuster les références ou l’architecture seulement après comparaison des POC, du matériel fourni, du coût et du délai |

## 12.1 Estimation avant sélection

La nomenclature candidate complète, conservée dans
`docs/research/nomenclature-materielle-candidate.md` et datée du 23 septembre
2026, couvre le hub, les deux cellules, les tags, les pilotes de serrure, les
protections, la conversion de tension, le câblage interne et la mécanique. Elle
totalise **714,02 $ CA avant taxes et livraison** : 622,02 $ de lignes sourcées
et 92,00 $ de provisions encore à remplacer. Avec les taxes québécoises
indicatives, le total avant livraison est de **820,94 $**. Une provision de
40,00 $ pour la livraison porte l’enveloppe de planification à **860,94 $**.

Ces montants sont une vue de travail, pas un devis ni une limite d’acceptation.
La liste complète figure en **annexe E** : elle ne suppose pas que le lecteur
ouvre un autre document. Le coût d’achat changera selon les pièces fournies par
le laboratoire et la sélection des références réelles. Aucun montant n’est ici
présenté comme une exigence financière du cours.

Les deux lecteurs UHF candidats représentent 225,72 $ et annoncent une portée de
1,5 à 2 m. Le point à démontrer n’est pas seulement leur prix : il faut surtout
prouver qu’ils distinguent la bonne cellule de sa voisine. Le loquet candidat
n’est pas non plus le verrou rotatif décrit initialement. Sa mécanique, son
courant, son échauffement et son accès de secours doivent être comparés sur le
banc d’essai.

Avant tout achat, Philippe et Jimmy inventorieront le matériel disponible,
remplaceront chaque provision par une référence, exécuteront les POC qui peuvent
changer l’architecture, puis consolideront les paniers avec taxes et livraisons
réelles. Un repli sera retenu s’il répond mieux au besoin technique, au délai et
aux ressources disponibles.

## 12.2 Bancs d’essai et preuves

![Banc d’essai du verrou](../diagrams/architecture-physique/architecture-physique-test-verrou.svg)

**Figure 13 — Banc de caractérisation du verrou.** Le schéma illustre la méthode;
les valeurs finales proviendront de la fiche du composant et des mesures réelles.

Chaque rapport de POC consignera la date, les références, le montage, les
conditions, le nombre de répétitions, les données brutes, les échecs et la
décision. Un essai non effectué restera indiqué « non mesuré ».

Les validations à préparer avec Jimmy portent précisément sur la localisation
RFID, le verrou et la porte, l’alimentation/connectique, le ciblage RS-485, le
scan sur les iPhone et la connectivité sécurisée. Une première campagne de dix
essais par condition pertinente est proposée dans la fiche de déploiement et
de validations. Le délai et le taux de lecture RFID admissibles doivent être
fixés avant mesure; les limites électriques proviennent des fiches et du
dimensionnement. Aucune fausse attribution de cellule ni ouverture non commandée
n’est acceptable dans la campagne. Ces essais préparatoires ne sont pas
présentés comme réalisés pour la remise du cahier.

# 13. Organisation de l’équipe et plan de réalisation

## 13.1 Répartition

**Tableau 14 — Responsabilités principales et revues croisées.**

| Domaine | Responsable principal | Revue ou collaboration |
|---|----------------------|---|
| Backend, contrats, PostgreSQL et simulateur | Philippe             | Revue de Jimmy sur l’intégration physique |
| Administration Web et application iOS | Philippe             | Validation des parcours par les deux membres |
| Mécanique, composants, câblage et mesures | Jimmy                | Revue de Philippe sur les événements produits |
| Pilotes serrure, porte, RFID et liaison locale | Jimmy                | Interfaces firmware définies ensemble |
| MQTT, affichage logique et corrélation | Équipe               | Essais sur le hub avec Jimmy |
| Intégration, ciblage A1/A2 et démonstration | Équipe               | Exécution et explication par les deux membres |

La responsabilité principale indique qui prépare le travail, pas une zone que
l’autre membre peut ignorer. Philippe prend principalement le service central,
PostgreSQL, le Web, iOS et le simulateur. Jimmy prend principalement la
mécanique, le câblage et les pilotes matériels. Les contrats REST/MQTT,
l’intégration, les POC, les revues et la démonstration sont expliqués et validés
par les deux membres.

La capacité garantie est de **18 heures-personnes par semaine** : 7 heures de
cours communes pour deux personnes, soit 14 heures-personnes, auxquelles Philippe
ajoute 4 heures hors cours. Aucun temps supplémentaire de Jimmy n’est présumé.
Sur les semaines 4 à 14, cette base représente 198 heures-personnes; la semaine
15 ajoute 18 heures-personnes de présentation et de contingence. Cette capacité
est une limite de planification, pas une obligation de remplir toutes les heures.

## 13.2 Macro-itérations

**Tableau 15 — Objectifs des macro-itérations.**

| Période | Objectif | Porte de sortie |
|---|---|---|
| Semaines 4 à 7 | Réduire les risques et rendre un actif prêt/réservable | Environnement reproductible, POC décidés, A1 `READY`, A2 bloqué |
| Semaines 8 à 11 | Livrer la chaîne de possession complète | Réservation, retrait et retour de bout en bout |
| Semaines 12 à 15 | Geler, durcir, mesurer et présenter | Refus, anomalies, sécurité, 10 + 10 répétitions et démo maîtrisée |

Le travail avance par tranches verticales. Le maximum de travail en cours est de deux récits utilisateur,
une par personne. Chaque cycle se termine par une intégration, des tests, une
mini-démonstration et une entrée de journal. Les semaines 13 et 14 servent à la
stabilisation, pas à l’ajout tardif d’une fonctionnalité P1.

# 14. Risques, replis et éléments hors périmètre

## 14.1 Registre synthétique des risques

**Tableau 16 — Risques, signaux d’alerte et replis.**

| Risque | Signal d’alerte | Réduction ou repli |
|---|---|---|
| RFID mal localisé | Lectures voisines ou résultats instables | POC borné dans le temps, seuils préalables, repli QR/NFC + présence |
| Alimentation ou bus trop complexe | Surchauffe, chute de tension, commandes croisées | Protection par port; repli vers un contrôleur direct à deux compartiments |
| Écran ou caméra non compatible | QR illisible sur l’iPhone de démonstration | Essai anticipé du matériel réel; changement d’écran ou de disposition |
| Wi-Fi du Cégep incompatible avec le hub | WPA2-Enterprise, certificat ou isolation des clients | Validation avec le personnel autorisé; réseau de laboratoire ou routeur autorisé testé d’avance |
| Courbe d’apprentissage Spring et sécurité | Squelette exécutable ou autorisation en retard | Monolithe modulaire, tranches courtes, tests ciblés et usage du simulateur |
| Accès limité aux Macs | Compilation iOS non vérifiée hors cours | Réserver les séances à la compilation, à la caméra et aux tests sur appareil |
| Intégration tardive logiciel–matériel | Contrats ou événements encore instables en semaine 10 | Simulateur fidèle dès le départ et contrats versionnés avant intégration |
| Absence ou capacité réduite | Stories bloquées par une seule personne | Documentation continue, branches courtes, revue croisée et réduction de la finition |
| Écart entre l’estimation et le coût d’achat | Prix et stocks variables, provisions à remplacer, taxes, livraisons et matériel du laboratoire encore inconnus | Nomenclature complète versionnée, inventaire, POC RFID et paniers consolidés avant commande |
| Croissance du périmètre | Travail P1 alors qu’un jalon P0 manque | Porte de changement, gel semaine 12 et réduction de la finition non essentielle |

## 14.2 Replis approuvés en principe

- Si le RFID UHF ne localise pas suffisamment, utiliser une identification
  QR/NFC de l’actif avec porte et présence ou poids.
- Si l’étoile à contrôleurs locaux compromet la livraison, utiliser un ESP32 qui
  pilote directement deux compartiments en conservant A1/A2 et les contrats.
- Si un service matériel n’est pas disponible, poursuivre les parcours avec le
  simulateur sans présenter celui-ci comme une preuve de fonctionnement réel.

Tout déclenchement de repli matériel important produit un ADR de remplacement.

## 14.3 Éléments explicitement hors périmètre

- AI Vision, reconnaissance d’image et recommandations intelligentes;
- application Android;
- multi-site, ERP, CMMS et API publique d’intégration;
- notifications avancées, statistiques prédictives et maintenance complète;
- autorisation métier autonome lorsque le service central est indisponible;
- interface tactile complète sur le hub;
- industrialisation, certification et déploiement client réel;
- garantie absolue contre le relais visuel du QR.

# 15. Conclusion

Aegis propose une réponse cohérente à un problème qui dépasse l’inventaire :
savoir si un équipement critique est réellement prêt pour une personne et
maintenir une chaîne de possession vérifiable lorsqu’il quitte son compartiment.

La conception repose sur une autorité métier unique, des états explicites, des
contrats idempotents et une séparation stricte entre intentions numériques et
preuves physiques. Le prototype reste volontairement limité à deux cellules,
mais ses identifiants et frontières permettent d’envisager une extension sans
compromettre le P0.

La prochaine étape consiste à valider ce cahier en équipe, terminer les POC les
plus risqués, puis construire le produit par tranches verticales. La réussite ne
sera pas mesurée par le nombre de fonctionnalités, mais par la capacité des deux
membres à expliquer et répéter un retrait et un retour fiables, sécurisés et
traçables.

# Annexes

## Annexe A — Glossaire court

**Tableau 17 — Glossaire du cahier.**

| Terme | Définition |
|---|---|
| Disponibilité opérationnelle (*readiness*) | Décision contextuelle indiquant si un actif est prêt pour un utilisateur |
| Chaîne de possession | Historique vérifiable de la responsabilité d’un actif |
| Concentrateur (*hub*) | Contrôleur central avec écran, réseau et ports de cellules |
| Cellule | Compartiment physique indépendant relié au hub |
| Défi local | Secret QR temporaire requis avant une ouverture métier |
| Observation physique | Fait normalisé provenant de la porte, du verrou ou de l’identification d’actif |
| Idempotence | Propriété empêchant un doublon de produire un second effet |
| ADR | Trace d’une décision d’architecture, de ses alternatives et conséquences |
| POC | Expérience bornée qui produit une mesure avant un choix matériel |
| P0 | Périmètre obligatoire nécessaire à la démonstration évaluée |
| ACK | Accusé technique de réception ou d’acceptation; jamais une preuve de mouvement |
| ACL | Liste de contrôle limitant les sujets MQTT accessibles à une identité |
| QoS | Niveau de service de livraison MQTT; le niveau 1 peut produire des doublons |
| TLS | Chiffrement et authentification du canal réseau |
| RS-485 | Couche électrique différentielle utilisée entre le hub et une cellule |
| Boîte d’envoi (*outbox*) | Registre transactionnel des messages à publier après une décision SQL |
| DTO | Représentation validée utilisée à la frontière d’une API |

## Annexe B — Traçabilité documentaire

**Tableau 18 — Correspondance entre le cahier et ses sources normatives.**

| Sujet du cahier | Sources de référence |
|---|---|
| Périmètre, objectifs et acceptation | Document 02 — `docs/cahier-conception/02-scope.md` |
| Vocabulaire et modèle | Documents 03 et 04 — dictionnaire et modèle logique |
| États et algorithmes | Documents 05 et 06 — machines à états et flux fonctionnels |
| Flux et confiance | Document 07 — flux de données |
| PostgreSQL | Document 08 — modèle physique PostgreSQL |
| REST et MQTT | Documents 09 et 10 — contrats détaillés |
| Parcours et récits utilisateur | Document 11 — carte des récits du P0 |
| Matériel et POC | Document 12 et `docs/research/nomenclature-materielle-candidate.md` |
| Décisions | Document 13 et les ADR acceptés dans `docs/adr/` |
| Planification | Document 14 — semaines 4 à 15 |

## Annexe C — Références

- Vovan, Alexandre; Hébert, Jean-Philippe; Rioux-Leclair, Jordan. *Plan d’étude —
  420-5X7-SO Écosystème connecté*. Cégep de Sorel-Tracy, automne 2026.
- Équipe Aegis. [*Dépôt de travail et documents normatifs*](https://github.com/PhilJordan18/aegis),
  révision consultée le 23 septembre 2026. L’accès dépend des droits accordés au
  correcteur.
- Texas Instruments. [*The RS-485 Design Guide*](https://www.ti.com/lit/an/slla272d/slla272d.pdf),
  consulté le 23 septembre 2026.
- OWASP Foundation. [*Transaction Authorization Cheat Sheet*](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html),
  consulté le 23 septembre 2026.
- Internet Engineering Task Force. [RFC 8628, section 5.4](https://www.rfc-editor.org/rfc/rfc8628.html#section-5.4),
  consulté le 23 septembre 2026.
- TE Connectivity. [Connecteurs M12 à montage sur circuit imprimé](https://www.te.com/en/product-CAT-M1-B8722.html),
  consulté le 23 septembre 2026.
- Apple. [*Human Interface Guidelines*](https://developer.apple.com/design/human-interface-guidelines/),
  consulté le 23 septembre 2026.
- W3C. [*Web Content Accessibility Guidelines 2.2*](https://www.w3.org/TR/WCAG22/),
  consulté le 23 septembre 2026.

## Annexe D — Assistance par intelligence artificielle

Claude Code et Codex ont contribué à la recherche, à la structuration, à la
révision linguistique, à l’analyse de cohérence et à la production de diagrammes
et de maquettes. Claude Opus a été utilisé comme contre-relecteur du présent
cahier; ses remarques ont été vérifiées contre le scope, les ADR, les contrats et
le plan d’étude avant intégration. Aucune mesure matérielle ni réussite de test
n’a été inventée.

Philippe et Jimmy demeurent responsables des décisions, des sources, des
mesures, de la validation du contenu et de leur capacité à expliquer chaque
partie du projet. Les interventions matérielles et les changements significatifs
assistés par IA sont consignés dans le journal de bord. Pour cette remise,
l’équipe confirme que l’usage de l’IA est autorisé. Cette annexe déclare les
outils utilisés, la nature de leur contribution et la responsabilité humaine;
elle ne présente pas cette autorisation comme une question encore ouverte.


## Annexe E — Nomenclature matérielle complète du prototype

**Tableau 17 — Références candidates, quantités et estimation du 23 septembre 2026.**
Les prix et liens ci-dessous reprennent la [nomenclature de recherche](../research/nomenclature-materielle-candidate.md).
Ils n’ont pas été relevés à nouveau lors de cette intégration. Les références
restent candidates : leur présence dans le tableau ne vaut ni compatibilité
vérifiée, ni achat approuvé. « Sourcé » désigne un prix relevé dans cette fiche;
« provisionnel » désigne une estimation sans référence finale.

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

| Total de planification | Montant CA |
|---|---:|
| Articles avant taxes et livraison | 714,02 $ |
| Taxes indicatives reprises de l’estimation | 106,92 $ |
| Total indicatif avant livraison | 820,94 $ |
| Provision de livraison | 40,00 $ |
| **Enveloppe indicative** | **860,94 $** |

Le détail des taxes et du transport sera recalculé sur les paniers réels.
Les valeurs électriques des références candidates ne constituent pas des
consignes de câblage; le dimensionnement et les protections restent à qualifier.

**Moyens complémentaires à inventorier, hors total d’achat du prototype :**
les deux équipements de démonstration, les iPhone de test, le Mac avec Xcode,
l’ordinateur hébergeant les services et le réseau autorisé. Ils sont supposés
mis à disposition; tout achat nécessaire sera ajouté à l’estimation. Un routeur
de repli, les consommables de POC supplémentaires et le matériel d’un éventuel
repli RFID ne sont pas présumés acquis ni compris dans les 860,94 $. La
nomenclature couvre la variante candidate décrite, pas toutes ses alternatives.
