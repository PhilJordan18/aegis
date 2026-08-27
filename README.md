# Aegis

> **Connected Asset Management Platform**

Aegis est un projet d'écosystème connecté réalisé dans le cadre du cours **420-5X7-SO — Écosystème connecté** au Cégep de Sorel-Tracy.

Le projet vise à concevoir une plateforme permettant à une organisation de **gérer, localiser, prêter, retourner et suivre des actifs physiques**, tout en automatisant autant que possible la synchronisation entre l'inventaire numérique et la réalité physique.

Le projet intègre plusieurs composantes complémentaires :

- une application Web d'administration;
- une application mobile iOS;
- un backend central;
- une base de données relationnelle;
- un système de casiers connectés;
- une identification physique des actifs;
- une communication IoT;
- une composante d'intelligence artificielle pour assister certaines opérations.

---

## Vision

Dans plusieurs organisations, la gestion de matériel partagé dépend encore d'opérations manuelles :

- fichiers Excel;
- registres papier;
- interventions d'un responsable;
- vérifications manuelles;
- mises à jour d'inventaire effectuées après coup.

Cela peut créer un écart entre **l'inventaire informatique** et **la situation réelle**.

Aegis cherche à répondre à la question suivante :

> **Comment permettre à une organisation de connaître automatiquement la disponibilité et l'emplacement réel de ses actifs physiques, tout en automatisant le cycle de réservation, d'emprunt et de retour?**

Le casier intelligent n'est donc pas le produit complet.

Il constitue l'interface physique d'un système plus large de **gestion et de traçabilité d'actifs**.

---

## Cas d'utilisation cible

L'architecture d'Aegis est volontairement générique afin de pouvoir gérer différents types d'actifs :

- matériel informatique;
- outils;
- appareils électroniques;
- équipements de mesure;
- clés;
- livres;
- tablettes;
- appareils spécialisés;
- accessoires;
- équipements industriels.

Le prototype pourra être testé dans un contexte scolaire, mais le secteur cible envisagé pour la version finale est celui des **entreprises techniques, ateliers et environnements industriels**, où la disponibilité et la traçabilité d'équipements peuvent avoir un impact opérationnel important.

---

## Proposition de valeur

Aegis ne cherche pas simplement à remplacer une serrure par une serrure connectée.

Le système vise à automatiser l'ensemble du cycle :

```text
Inventorier
    ↓
Identifier
    ↓
Localiser
    ↓
Réserver
    ↓
Autoriser
    ↓
Déverrouiller
    ↓
Détecter physiquement
    ↓
Emprunter
    ↓
Tracer
    ↓
Retourner
    ↓
Synchroniser l'inventaire
```

La principale valeur recherchée est donc :

> **Réduire l'écart entre l'état numérique de l'inventaire et l'état physique réel des actifs.**

---

# Architecture envisagée

```text
                              AEGIS
                                │
       ┌────────────────────────┼────────────────────────┐
       │                        │                        │
       ▼                        ▼                        ▼
   WEB ADMIN                MOBILE APP              IoT LOCKER
React + TypeScript         Swift + SwiftUI         ESP32 + C++
       │                        │                        │
       │ HTTPS                  │ HTTPS                  │ MQTT
       └────────────────────────┼────────────────────────┘
                                │
                                ▼
                        Java + Spring Boot
                           REST API / Core
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
         PostgreSQL        MQTT Broker       AI / Vision
                                             optionnel
```

---

# Stack technique

## Web Administration

- React
- TypeScript
- Vite
- TanStack Query
- React Router ou TanStack Router

Responsabilités principales :

- gestion des actifs;
- gestion du catalogue;
- gestion des catégories;
- gestion des utilisateurs;
- gestion des casiers;
- consultation des prêts;
- consultation des anomalies;
- administration de l'inventaire;
- statistiques;
- intégration de nouveaux actifs.

---

## Application mobile

- Swift
- SwiftUI
- async/await
- URLSession
- caméra / QR
- notifications selon les besoins

Responsabilités principales :

- authentification;
- recherche d'actifs;
- consultation de disponibilité;
- réservation;
- emprunt;
- retour;
- consultation des prêts actifs;
- interaction avec les casiers.

---

## Backend

- Java
- Spring Boot
- Spring Web
- Spring Data JPA
- Hibernate
- Spring Security
- Bean Validation
- Flyway

Le backend constitue la source principale de logique métier.

Architecture envisagée :

```text
Controller
    ↓
Service
    ↓
Repository
    ↓
PostgreSQL
```

Le projet privilégiera un **monolithe modulaire** plutôt qu'une architecture en microservices.

---

## Base de données

- PostgreSQL

Domaines envisagés :

```text
Organization
User
Role

AssetCategory
AssetModel
Asset
AssetTag

Locker
Compartment

Reservation
Loan

DeviceEvent
AuditEvent
```

Des champs `JSONB` pourront éventuellement être utilisés pour les propriétés spécifiques à certaines catégories d'actifs.

---

## IoT

- ESP32
- C++ / Arduino Framework
- Wi-Fi
- MQTT

Responsabilités :

- ouverture et verrouillage des compartiments;
- lecture de capteurs;
- surveillance de l'état des portes;
- interaction avec les systèmes d'identification;
- réception de commandes;
- publication d'événements.

---

## Identification des actifs

Deux méthodes complémentaires sont actuellement envisagées.

### RFID UHF

Technologie principale étudiée pour permettre une détection automatique des actifs.

Objectifs :

- détecter la présence d'un actif;
- détecter son retrait;
- détecter son retour;
- limiter les opérations manuelles.

### QR Code

Utilisé comme méthode complémentaire :

- identification visuelle;
- scan manuel;
- onboarding;
- dépannage;
- fallback lorsqu'une lecture RFID n'est pas possible.

---

## Communication IoT

MQTT est actuellement envisagé pour la communication entre le backend et les contrôleurs de casiers.

Exemple :

```text
locker/{lockerId}/command
locker/{lockerId}/status
locker/{lockerId}/event
```

Exemple de commande :

```json
{
  "commandId": "cmd-001",
  "action": "UNLOCK",
  "compartment": "A3"
}
```

Exemple d'événement :

```json
{
  "eventId": "evt-001",
  "type": "ITEM_REMOVED",
  "compartment": "A3",
  "assetId": "AST-017"
}
```

---

# Intelligence artificielle

L'IA n'est pas considérée comme une dépendance critique au fonctionnement de base du système.

La principale fonctionnalité envisagée est l'**assistance à l'intégration d'un inventaire**.

```text
Photo
  ↓
Analyse Vision
  ↓
Identification probable
  ↓
Métadonnées proposées
  ↓
Validation humaine
  ↓
Création de l'actif
```

L'IA pourrait proposer :

- nom;
- catégorie;
- fabricant;
- modèle;
- description.

L'administrateur conserve toujours la validation finale.

D'autres utilisations pourront être étudiées uniquement si le cœur du produit est complété :

- analyse d'utilisation;
- détection d'anomalies;
- recommandations;
- assistance à la gestion de stock.

---

# Cycle d'emprunt envisagé

```text
Utilisateur
    ↓
Réservation
    ↓
Backend valide
    ↓
Compartiment attribué
    ↓
Autorisation d'ouverture
    ↓
Locker déverrouillé
    ↓
Actif retiré
    ↓
Détection physique
    ↓
Événement envoyé au backend
    ↓
Prêt créé
    ↓
Inventaire mis à jour
```

Le changement d'état dans la base de données devra idéalement être confirmé par un événement physique et non uniquement par une action utilisateur.

---

# Cycle de retour envisagé

```text
Utilisateur demande un retour
        ↓
Compartiment attribué
        ↓
Ouverture
        ↓
Actif déposé
        ↓
Identification physique
        ↓
Porte refermée
        ↓
Confirmation IoT
        ↓
Prêt terminé
        ↓
Actif disponible
```

---

# États envisagés pour un actif

```text
AVAILABLE
    ↓
RESERVED
    ↓
CHECKOUT_PENDING
    ↓
BORROWED
    ↓
RETURN_PENDING
    ↓
AVAILABLE
```

États exceptionnels possibles :

```text
LOST
DAMAGED
MAINTENANCE
UNAVAILABLE
```

---

# Écran du casier

La solution envisagée est d'utiliser **un écran central par unité de casiers**, plutôt qu'un écran par compartiment.

```text
┌─────────────────────────────────┐
│          ÉCRAN CENTRAL          │
├───────────┬───────────┬─────────┤
│    A1     │    A2     │   A3    │
├───────────┼───────────┼─────────┤
│    B1     │    B2     │   B3    │
└───────────┴───────────┴─────────┘
```

Chaque compartiment pourrait contenir :

- serrure;
- capteur de porte;
- indicateur LED;
- système de détection d'actif.

L'écran central pourrait éventuellement utiliser un Raspberry Pi exécutant une interface Web en mode kiosk.

---

# Organisation du dépôt

```text
aegis/
│
├── apps/
│   ├── admin-web/
│   └── ios/
│
├── services/
│   ├── api/
│   └── vision/
│
├── firmware/
│   └── locker-controller/
│
├── infra/
│   ├── docker/
│   └── mqtt/
│
├── docs/
│   ├── journal/
│   ├── cahier-conception/
│   ├── architecture/
│   ├── diagrams/
│   ├── adr/
│   ├── research/
│   └── meetings/
│
├── .github/
│
├── README.md
├── CONTRIBUTING.md
├── .gitignore
└── .editorconfig
```

---

# Méthode de travail

Le projet est réalisé par une équipe de deux personnes.

Le développement utilisera principalement :

- GitHub;
- GitHub Issues;
- branches courtes;
- Pull Requests;
- Conventional Commits;
- revue de code;
- documentation Markdown;
- ADR pour les décisions importantes.

Branches envisagées :

```text
main
feature/*
fix/*
docs/*
research/*
```

Exemples :

```text
feature/asset-onboarding
feature/rfid-poc
feature/loan-workflow
docs/week-01-journal
research/rfid-uhf
```

---

# Convention de commits

```text
feat: nouvelle fonctionnalité
fix: correction
docs: documentation
test: tests
refactor: restructuration interne
chore: maintenance
research: recherche / preuve de concept
```

Exemples :

```text
docs: add week 1 journal
research: document rfid identification options
feat: add asset creation endpoint
fix: prevent duplicate locker events
```

---

# Stratégie de développement

Le projet sera développé progressivement à travers des **vertical slices**.

Premier objectif technique :

```text
React
  ↓
Spring Boot
  ↓
PostgreSQL
```

Puis :

```text
Swift
  ↓
Spring Boot
  ↓
PostgreSQL
```

Puis :

```text
Spring Boot
  ↓
MQTT
  ↓
ESP32
```

Puis :

```text
ESP32
  ↓
RFID
```

Une fois ces blocs validés, un premier workflow complet sera intégré :

```text
Swift
  ↓
Spring
  ↓
MQTT
  ↓
ESP32
  ↓
RFID
  ↓
MQTT
  ↓
Spring
  ↓
PostgreSQL
  ↓
Swift
```

---

# Priorités

## P0 — Must Have

- gestion des utilisateurs;
- gestion des actifs;
- gestion des casiers;
- identification d'actifs;
- réservation;
- emprunt;
- retour;
- Web Admin;
- application iOS;
- backend Spring Boot;
- PostgreSQL;
- communication IoT;
- historique / audit.

## P1 — Should Have

- RFID UHF;
- QR fallback;
- écran central;
- AI Vision onboarding;
- notifications;
- anomalies;
- plusieurs méthodes d'accès.

## P2 — Nice to Have

- statistiques avancées;
- maintenance;
- calibration;
- import CSV avancé;
- multi-organisation;
- analyse prédictive;
- détection avancée d'anomalies.

---

# État actuel

**Phase : recherche et conception**

Travaux en cours :

- définition de la problématique;
- validation du secteur cible;
- comparaison RFID UHF / NFC / QR;
- définition du niveau d'automatisation;
- préparation des user stories;
- préparation du cahier de conception;
- définition de l'architecture;
- préparation d'un POC RFID.

---

# Documentation

Les documents de conception et le journal de bord sont versionnés directement dans le dépôt.

```text
docs/journal/
docs/cahier-conception/
docs/architecture/
docs/adr/
docs/research/
```

Le dépôt doit permettre de retracer non seulement le produit final, mais également **l'évolution des décisions techniques et du projet au cours de la session**.

---

## Équipe

- Philippe Jordan Monfouayi Mba
- Membre 2 : à compléter

---

## Cours

**420-5X7-SO — Écosystème connecté**  
Cégep de Sorel-Tracy  
Automne 2026
