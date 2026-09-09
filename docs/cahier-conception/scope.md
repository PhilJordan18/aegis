# Aegis — Périmètre du projet

**Cours :** 420-5X7-SO — Écosystème connecté  
**Session :** Automne 2026  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Date de révision :** 9 septembre 2026  
**Version :** 0.3 — architecture matérielle hub/cellule  
**Statut :** Proposition à valider en équipe et avec l'enseignant  
**Échéance :** Semaine 15, entre le 15 et le 23 décembre 2026

---

## 1. Rôle du document

Ce document établit les frontières fonctionnelles, techniques et commerciales du prototype Aegis pour la session d'automne 2026.

Il constitue la référence pour :

- décider ce qui doit obligatoirement être conçu et démontré;
- distinguer le P0 des améliorations secondaires et des évolutions futures;
- guider la User Story Map, le modèle de domaine et l'architecture;
- empêcher l'augmentation incontrôlée du périmètre;
- arbitrer les nouvelles idées pendant le développement;
- définir des critères objectifs de réussite;
- conserver une cohérence entre la promesse marketing et le produit réellement construit.

En cas de contradiction entre une idée informelle, le README et ce document, le présent scope prévaut jusqu'à ce qu'une modification soit approuvée et documentée.

---

## 2. Résumé exécutif

Aegis est un prototype de **plateforme de disponibilité opérationnelle et de chaîne de possession pour des équipements critiques partagés**.

Il combine :

- une application iOS destinée aux techniciens;
- une administration Web destinée aux gestionnaires;
- un backend central qui applique les règles métier;
- une base PostgreSQL;
- un broker MQTT;
- un casier connecté modulaire, composé d'un cube « hub » (écran, calcul, réseau) et d'un ou plusieurs cubes « cellule » dépourvus d'écran, contrôlé par ESP32;
- une méthode de confirmation physique du retrait et du retour.

Aegis ne se limite pas à répondre à la question :

> Où se trouve cet équipement?

Le produit cherche plutôt à répondre à la question :

> **Quel équipement est réellement prêt, conforme et autorisé pour cette personne au moment où elle en a besoin?**

Le MVP démontre cette promesse sur un locker de deux compartiments avec un parcours complet de réservation, de retrait, de prêt et de retour.

---

## 3. Positionnement produit

### 3.1 Catégorie

> **Critical Asset Readiness and Chain-of-Custody Platform**

En français :

> **Plateforme de disponibilité opérationnelle et de traçabilité des équipements critiques.**

### 3.2 Marché de référence

Le marché de référence est constitué de petites et moyennes équipes de maintenance, d'inspection, d'atelier ou de service technique qui partagent des équipements :

- coûteux;
- spécialisés;
- calibrés;
- réglementés ou soumis à des règles internes;
- nécessaires à la réalisation d'une intervention;
- fréquemment empruntés par plusieurs personnes.

Exemples :

- multimètres;
- caméras thermiques;
- détecteurs de gaz;
- clés dynamométriques;
- appareils de mesure;
- tablettes et radios;
- scanners;
- trousses d'inspection.

### 3.3 Client idéal théorique

Une organisation qui possède approximativement de 20 à 200 actifs techniques partagés, plusieurs utilisateurs ou quarts de travail et une gestion encore partiellement manuelle.

### 3.4 Acheteurs et utilisateurs

| Profil | Attente principale |
|---|---|
| Responsable des opérations | Réduire les interventions retardées faute d'équipement prêt |
| Responsable de maintenance | Connaître l'état et l'utilisation du parc |
| Responsable qualité | Empêcher l'usage d'un équipement non conforme |
| Gestionnaire d'atelier | Réduire les recherches, pertes et audits manuels |
| Technicien ou inspecteur | Accéder rapidement au bon équipement |

### 3.5 Promesse

> **Aegis garantit que chaque technicien reçoit un équipement disponible, conforme et traçable pour son intervention.**

Cette promesse représente la direction du produit. Le prototype académique doit en démontrer les mécanismes essentiels, sans prétendre prouver à lui seul un retour sur investissement industriel.

---

## 4. Problématique

Dans de nombreuses équipes techniques, un inventaire peut déclarer un actif disponible alors que celui-ci est :

- absent de son emplacement;
- déjà réservé ou emprunté;
- endommagé;
- en maintenance;
- non calibré ou expiré;
- inaccessible à l'utilisateur concerné;
- présent, mais non prêt pour une utilisation immédiate.

Cette différence entre existence administrative et disponibilité opérationnelle entraîne :

- du temps perdu à chercher un équipement;
- des retards au démarrage d'une intervention;
- une utilisation potentielle de matériel non conforme;
- une responsabilité floue en cas de perte ou de dommage;
- des inventaires manuels;
- des décisions d'achat fondées sur des données incomplètes.

La problématique retenue est :

> **Comment permettre à une équipe technique de mettre à disposition le bon équipement, conforme et autorisé, tout en automatisant son accès physique et en conservant une chaîne de possession fiable?**

---

## 5. Terrain de validation et marché

### 5.1 Terrain de validation

Le prototype sera construit et testé dans un laboratoire technique du Cégep de Sorel-Tracy avec du matériel accessible à l'équipe.

Ce terrain permet de reproduire :

- des actifs partagés;
- des utilisateurs distincts;
- des niveaux d'accès;
- une date de calibration ou de conformité;
- une réservation;
- un retrait et un retour physiques;
- une anomalie ou un refus.

### 5.2 Distinction obligatoire

Le laboratoire est le **lieu d'expérimentation**, pas le marché principal présenté.

```text
Terrain de validation
Laboratoire technique du Cégep

Marché de référence
Maintenance, inspection et services techniques
```

Cette distinction permet de tester avec des moyens réalistes sans affaiblir la pertinence opérationnelle du produit.

---

## 6. Objectifs du MVP

Le MVP doit prouver qu'Aegis peut :

1. représenter des équipements techniques individuels;
2. déterminer si un actif est prêt pour un utilisateur donné;
3. bloquer un actif présent mais non conforme;
4. réserver un actif admissible;
5. autoriser l'ouverture d'un seul compartiment;
6. corréler l'action mobile, la commande IoT et l'observation physique;
7. créer automatiquement une chaîne de possession après un retrait confirmé;
8. terminer automatiquement cette chaîne après un retour confirmé;
9. résister aux doublons et aux opérations expirées;
10. présenter un historique compréhensible à l'administrateur.

Le MVP ne doit pas chercher à reproduire toutes les fonctions d'un logiciel EAM, CMMS, ERP ou d'une solution industrielle de distribution d'actifs.

---

## 7. Principes de conception

### 7.1 Le backend est l'autorité métier

Le backend décide :

- si l'utilisateur est authentifié;
- s'il possède le niveau d'accès requis;
- si l'actif est prêt;
- si la réservation est valide;
- si une ouverture peut être commandée;
- si les observations reçues suffisent à confirmer un retrait ou un retour;
- si une anomalie doit être créée.

Le mobile, le Web et l'ESP32 ne modifient jamais directement l'état métier final.

### 7.2 Présence et readiness sont distinctes

Un actif physiquement présent n'est pas automatiquement prêt.

```text
PRESENT + CALIBRATION_EXPIRED = BLOCKED
PRESENT + DAMAGED = BLOCKED
PRESENT + ACCESS_DENIED = BLOCKED
PRESENT + COMPLIANT + AUTHORIZED + AVAILABLE = READY
```

### 7.3 Une action utilisateur ne constitue pas une preuve physique

Appuyer sur « Retirer » ou « Retourner » crée une intention et une opération. Le prêt ne change définitivement d'état qu'après des observations physiques cohérentes.

### 7.4 La détection est remplaçable

Le cœur métier consomme des observations normalisées. Il ne doit pas dépendre directement d'une technologie précise comme RFID UHF, NFC, QR, poids ou présence.

### 7.5 Le scope privilégie un parcours fiable

Un parcours complet, sécurisé et répétable possède plus de valeur que plusieurs écrans ou fonctionnalités partiellement intégrés.

---

## 8. Acteurs du MVP

### 8.1 Technicien

Utilisateur de l'application iOS qui peut :

- s'authentifier;
- consulter les actifs correspondant à ses droits;
- voir leur état de readiness;
- réserver un actif prêt;
- demander l'accès au compartiment attribué;
- retirer et retourner l'actif;
- consulter sa réservation et son prêt actifs.

### 8.2 Administrateur

Utilisateur de l'application Web qui peut :

- s'authentifier;
- gérer les modèles et exemplaires d'actifs;
- définir un niveau d'accès requis;
- définir l'état opérationnel et la calibration;
- associer un actif à un tag et à un compartiment;
- consulter les réservations et prêts;
- surveiller le locker;
- consulter les anomalies et événements d'audit.

### 8.3 Backend Aegis

Acteur système qui :

- applique les règles;
- orchestre les workflows;
- publie les commandes;
- reçoit et interprète les événements;
- garantit l'idempotence;
- maintient l'état métier.

### 8.4 Locker connecté

Acteur machine contrôlé par ESP32 qui :

- s'authentifie auprès du broker;
- signale son état de santé;
- reçoit une commande autorisée;
- déverrouille un compartiment précis;
- observe les portes et les actifs;
- publie des accusés de réception et des événements.

---

## 9. Concepts et états minimaux

### 9.1 Readiness

La readiness est une décision dérivée pour un actif et un utilisateur donnés.

Résultats minimaux :

```text
READY
BLOCKED
UNKNOWN
```

Raisons de blocage minimales :

```text
NOT_PRESENT
NOT_AVAILABLE
MAINTENANCE
DAMAGED
CALIBRATION_EXPIRED
ACCESS_DENIED
UNKNOWN_PHYSICAL_STATE
```

Le calcul P0 vérifie :

1. la dernière présence physique connue;
2. l'état de disponibilité;
3. l'état opérationnel;
4. la calibration, lorsqu'elle est requise;
5. le niveau d'accès du demandeur.

### 9.2 Disponibilité de l'actif

```text
AVAILABLE
RESERVED
BORROWED
UNAVAILABLE
```

### 9.3 État opérationnel

```text
SERVICEABLE
MAINTENANCE
DAMAGED
```

### 9.4 État de calibration

État dérivé d'un indicateur `calibrationRequired` et d'une échéance :

```text
NOT_REQUIRED
VALID
EXPIRED
UNKNOWN
```

Le P0 ne comprend pas un workflow complet de calibration. L'administrateur saisit les métadonnées nécessaires et Aegis applique la règle de blocage.

### 9.5 Niveau d'accès

Le MVP utilise un modèle simple :

```text
STANDARD
RESTRICTED
```

Chaque utilisateur possède un niveau maximal et chaque actif un niveau requis. Les certifications, qualifications multiples et règles par site sont reportées après le P0.

### 9.6 Réservation

```text
ACTIVE
FULFILLED
CANCELLED
EXPIRED
```

### 9.7 Prêt

```text
ACTIVE
RETURN_PENDING
COMPLETED
```

### 9.8 LockerOperation

Chaque interaction physique est représentée par une opération temporaire :

```text
REQUESTED
AUTHORIZED
COMMAND_SENT
DOOR_OPENED
OBSERVATION_RECEIVED
CONFIRMED
FAILED
EXPIRED
ANOMALY
```

Une opération contient au minimum :

- un identifiant unique;
- un type `CHECKOUT` ou `RETURN`;
- l'utilisateur;
- l'actif attendu;
- le compartiment;
- la réservation ou le prêt associé;
- l'identifiant physique attendu;
- une date d'expiration;
- son état courant.

---

## 10. Démonstration de référence

### 10.1 Préparation

Le locker contient deux équipements comparables :

| Compartiment | Actif | Présence | Calibration | Niveau requis | Résultat |
|---|---|---|---|---|---|
| `A1` | Multimètre 1 | Présent | Valide | `STANDARD` | `READY` |
| `A2` | Multimètre 2 | Présent | Expirée | `STANDARD` | `BLOCKED` |

Un compte technicien standard et un compte administrateur sont préparés.

### 10.2 Scénario nominal de retrait

1. Le technicien se connecte à l'application iOS.
2. Il recherche un multimètre.
3. L'API évalue la readiness des deux actifs.
4. `A2` apparaît bloqué avec la raison `CALIBRATION_EXPIRED`.
5. Le technicien réserve `A1`.
6. Il demande l'accès au locker.
7. Le backend vérifie à nouveau la readiness et la réservation.
8. Une `LockerOperation` de type `CHECKOUT` est créée.
9. Une commande d'ouverture expirante est envoyée à `A1`.
10. L'ESP32 déverrouille uniquement `A1`.
11. La porte est ouverte, l'actif est retiré et la porte est refermée.
12. Les observations physiques sont publiées avec l'identifiant d'opération.
13. Le backend confirme le retrait et crée le prêt.
14. Le mobile et le Web présentent le nouvel état.

### 10.3 Scénario nominal de retour

1. Le technicien ouvre son prêt actif.
2. Il demande un retour.
3. Le backend crée une `LockerOperation` de type `RETURN`.
4. Le bon compartiment est déverrouillé.
5. L'actif attendu est déposé et la porte est refermée.
6. Les observations physiques sont corrélées à l'opération.
7. Le backend confirme le retour.
8. Le prêt passe à `COMPLETED`.
9. La disponibilité et la readiness sont recalculées.

### 10.4 Scénarios de refus ou d'anomalie

Au minimum, la démonstration doit également prouver :

- le refus d'une réservation pour calibration expirée;
- le refus d'un accès avec un niveau insuffisant;
- l'expiration d'une opération non complétée;
- l'absence de double traitement d'un événement MQTT dupliqué;
- la création d'une anomalie si l'actif attendu n'est pas observé.

---

## 11. P0 — Capacités obligatoires

Le P0 représente le minimum requis pour considérer le prototype comme fonctionnel et cohérent avec son positionnement.

### 11.1 Identité et accès

- authentifier l'administrateur Web;
- authentifier le technicien mobile;
- gérer les rôles `ADMIN` et `TECHNICIAN`;
- gérer les niveaux d'accès `STANDARD` et `RESTRICTED`;
- vérifier les autorisations dans le backend pour chaque action sensible;
- stocker les mots de passe avec une fonction de hachage adaptée;
- utiliser des jetons expirables;
- conserver le jeton iOS dans le Keychain;
- refuser une commande d'ouverture non autorisée, expirée ou déjà consommée;
- fournir des comptes de démonstration préparés.

Ne sont pas exigés : inscription publique, authentification sociale, récupération autonome du mot de passe et gestion avancée des identités d'entreprise.

### 11.2 Catalogue et actifs

- créer et modifier un modèle d'actif depuis le Web;
- créer et modifier un exemplaire physique;
- archiver un actif sans supprimer son historique;
- associer un identifiant physique à un actif;
- associer un actif à un compartiment;
- définir son niveau d'accès requis;
- définir son état opérationnel;
- indiquer si une calibration est requise;
- enregistrer une date d'échéance de calibration;
- afficher sa disponibilité, sa présence et sa readiness;
- consulter les actifs depuis le Web et le mobile.

### 11.3 Moteur de readiness minimal

- recalculer la readiness à la lecture ou après un événement pertinent;
- évaluer présence, disponibilité, état opérationnel, calibration et accès;
- retourner `READY`, `BLOCKED` ou `UNKNOWN`;
- retourner au moins une raison explicite en cas de blocage;
- empêcher la réservation et l'ouverture d'un actif non prêt;
- réévaluer les règles immédiatement avant l'ouverture;
- exposer le résultat de façon cohérente au Web et au mobile;
- couvrir les règles critiques par des tests automatisés.

Le P0 ne nécessite pas un moteur de règles générique configurable. Une implémentation claire dans le domaine Spring Boot est suffisante.

### 11.4 Réservations

- réserver un actif `READY`;
- empêcher deux réservations actives sur le même actif;
- empêcher un utilisateur de réserver un actif auquel il n'a pas accès;
- consulter sa réservation active;
- annuler une réservation inutilisée;
- faire expirer une réservation après une durée définie;
- refuser l'ouverture si la réservation n'est plus valide;
- passer la réservation à `FULFILLED` lorsque le retrait est confirmé.

### 11.5 Prêts et chaîne de possession

- créer automatiquement un prêt après confirmation physique du retrait;
- relier le prêt à l'utilisateur, à l'actif et à l'opération;
- conserver l'horodatage du retrait;
- consulter le prêt actif depuis le mobile et le Web;
- initier un retour;
- compléter automatiquement le prêt après confirmation physique du dépôt;
- conserver l'horodatage du retour;
- empêcher deux prêts actifs pour le même actif;
- conserver l'historique des prêts terminés;
- permettre de reconstruire qui détenait quel actif et à quel moment.

### 11.6 Locker et compartiments

- représenter un locker unique, potentiellement réparti sur un cube hub et un cube cellule (voir 17.5);
- représenter deux compartiments indépendants;
- associer un actif à chaque compartiment;
- connaître l'état en ligne ou hors ligne du locker;
- connaître l'état ouvert ou fermé de chaque porte;
- commander l'ouverture d'un compartiment précis;
- empêcher une ouverture simultanée non prévue;
- confirmer la réception ou l'échec d'une commande;
- afficher les principaux états physiques dans l'administration Web.

Si l'architecture hub/cellule est retenue (17.5), la cellule ne prend aucune décision d'autorisation : elle exécute les commandes reçues du hub et lui rapporte ses observations, conformément à 7.1.

### 11.7 Opérations physiques

- créer une `LockerOperation` pour chaque retrait ou retour;
- corréler la demande, la commande et les événements par `operationId`;
- imposer une durée de validité;
- enregistrer chaque transition d'état;
- attendre la fermeture de la porte avant la confirmation finale;
- confirmer uniquement l'actif attendu;
- marquer une opération incohérente comme `ANOMALY` ou `FAILED`;
- empêcher la réutilisation d'une opération confirmée ou expirée.

### 11.8 Hardware et détection

- connecter l'ESP32 au réseau (celui du hub si l'architecture 17.5 est retenue);
- contrôler deux serrures électroniques;
- lire un capteur de porte par compartiment;
- fournir un indicateur visuel minimal par compartiment;
- appliquer une durée maximale de déverrouillage;
- utiliser au moins une méthode fiable d'identification ou de confirmation physique;
- détecter le retrait de l'actif attendu;
- détecter le retour de l'actif attendu;
- transmettre les événements au backend;
- reprendre la communication après une déconnexion temporaire;
- fournir un comportement sûr en cas de redémarrage.

La fermeture mécanique industrielle, la résistance à l'effraction et la certification électrique ne font pas partie du P0.

### 11.9 Communication MQTT

- utiliser des canaux distincts pour commandes, événements et statuts;
- authentifier le device;
- limiter ses permissions aux topics nécessaires;
- inclure `messageId`, `operationId`, `lockerId`, `type`, `timestamp` et `schemaVersion` lorsque pertinents;
- envoyer un accusé de réception de commande;
- traiter les événements de façon idempotente;
- ignorer ou refuser une commande expirée;
- publier un heartbeat;
- conserver les événements bruts nécessaires au diagnostic.

Topics initiaux :

```text
aegis/v1/lockers/{lockerId}/commands
aegis/v1/lockers/{lockerId}/events
aegis/v1/lockers/{lockerId}/status
```

### 11.10 Administration Web — Aegis Manager

- connexion administrateur;
- gestion minimale du catalogue et des actifs;
- saisie de l'état opérationnel et de la calibration;
- association actif, identifiant physique et compartiment;
- consultation de la readiness et des raisons de blocage;
- consultation des réservations et des prêts;
- consultation du locker et des portes;
- consultation chronologique des événements importants;
- affichage clair d'une anomalie.

Le Web ne reproduit pas l'ensemble du parcours technicien de l'application mobile.

### 11.11 Application iOS — Aegis Mobile

- connexion du technicien;
- catalogue ou recherche simple d'actifs;
- détail d'un actif;
- affichage de `READY`, `BLOCKED` ou `UNKNOWN`;
- affichage de la raison principale d'un blocage;
- création et annulation d'une réservation;
- consultation de la réservation active;
- demande d'accès au locker;
- affichage de la progression de l'opération;
- consultation du prêt actif;
- lancement du retour;
- retour visuel clair en cas de succès, refus, expiration ou anomalie.

### 11.12 Audit et anomalies

- journaliser les connexions et refus pertinents;
- journaliser les changements de readiness déterminants;
- journaliser les réservations, commandes d'ouverture, retraits et retours;
- conserver les transitions des prêts et opérations;
- conserver les événements IoT importants;
- détecter l'absence de l'actif attendu;
- empêcher un doublon de créer une seconde transition métier;
- présenter une chronologie compréhensible à l'administrateur.

### 11.13 Infrastructure et exploitation

- exécuter PostgreSQL et le broker MQTT dans un environnement reproductible;
- déployer le backend et le Web dans un environnement de démonstration accessible;
- utiliser HTTPS pour les clients distants;
- utiliser MQTT authentifié et chiffré lorsque le broker est distant;
- conserver PostgreSQL hors de l'accès public;
- fournir les secrets par configuration externe;
- versionner les migrations Flyway;
- fournir un simulateur IoT pour développer sans le locker;
- documenter les étapes de lancement et de démonstration.

---

## 12. P1 — Fonctionnalités secondaires

Les fonctionnalités P1 peuvent commencer uniquement lorsque le retrait et le retour P0 fonctionnent de bout en bout.

- workflow simple de maintenance;
- historique de calibration;
- gestion d'un actif perdu ou endommagé;
- qualifications multiples par utilisateur;
- notification d'un retour attendu ou d'une calibration prochaine;
- historique détaillé côté technicien;
- gestion Web plus complète des utilisateurs;
- statistiques simples d'utilisation;
- écran central pour guider l'utilisateur;
- gestion d'une batterie ou d'un état de charge déclaré;
- détection du mauvais actif;
- QR ou NFC comme deuxième méthode d'identification;
- export CSV simple;
- amélioration avancée des interfaces et animations.

Si la méthode de détection initiale échoue, le fallback nécessaire au parcours principal passe automatiquement en P0.

---

## 13. P2 — Évolutions futures

Les éléments suivants expriment la vision à plus long terme et ne constituent aucun engagement pour la session :

- gestion de kits composés de plusieurs équipements;
- préparation d'équipements pour une intervention ou un bon de travail;
- recommandations d'allocation;
- gestion multi-lockers et multi-sites;
- application Android;
- intégrations CMMS, EAM, ERP ou annuaire d'entreprise;
- import CSV avancé;
- API publique et webhooks;
- analytics avancées et mesure de ROI;
- prédiction de la demande;
- détection intelligente d'anomalies;
- ajout d'actifs assisté par AI Vision;
- gestion détaillée de la recharge;
- politiques configurables par organisation;
- tableaux de bord opérationnels avancés.

---

## 14. Hors scope de la session

Sont explicitement exclus :

- fabrication d'un meuble industriel certifié;
- garantie de résistance physique à l'effraction;
- conformité réglementaire industrielle complète;
- déploiement de dizaines ou centaines de lockers;
- architecture microservices;
- Kubernetes;
- SaaS multi-organisation complet;
- facturation, abonnement ou paiement;
- remplacement complet d'un ERP, EAM ou CMMS;
- reconnaissance faciale ou biométrique;
- apprentissage ou entraînement d'un modèle d'IA;
- décision d'ouverture prise uniquement par l'ESP32;
- communication directe du mobile ou du Web avec les serrures;
- accès direct des clients à PostgreSQL;
- fonctionnement hors ligne complet;
- synchronisation complexe après plusieurs jours hors ligne;
- support 24/7 ou garantie de disponibilité commerciale;
- promesse chiffrée de réduction des coûts sans données réelles;
- déploiement en production chez un client réel pendant la session.

---

## 15. Hypothèses et contraintes

| Élément | Contrainte ou hypothèse |
|---|---|
| Équipe | Deux étudiants |
| Temps | Une session, présentation en semaine 15 |
| Prototype | Une unité de deux compartiments (architecture hub/cellule en POC, voir 17.5) |
| Budget matériel | Maximum de 500 $ CA, partagé 50/50 |
| Mobile | Application iOS native avec SwiftUI |
| Accès à Xcode | Principalement sur les Macs du Cégep |
| Web | React avec TypeScript |
| Backend | Java avec Spring Boot, technologie en apprentissage |
| Données | PostgreSQL |
| Contrôleur | ESP32 |
| Clients | HTTPS vers une API REST |
| IoT | MQTT entre backend, broker et ESP32 |
| Détection | Une méthode fiable obligatoire; RFID UHF soumis à POC |
| IA | Non requise dans le produit |
| Déploiement | Environnement de démonstration distant prévu |
| Utilisateurs P0 | Comptes de démonstration préparés |
| Échelle P0 | Un locker, deux actifs principaux, quelques comptes |

---

## 16. Exigences non fonctionnelles

### 16.1 Sécurité

- toute décision d'ouverture est prise par le backend;
- toutes les entrées d'API sont validées;
- les autorisations sont vérifiées côté serveur;
- les communications distantes des clients utilisent HTTPS;
- la communication MQTT distante est authentifiée et chiffrée;
- les identifiants MQTT sont propres au device;
- les secrets ne sont jamais committés;
- les mots de passe ne sont jamais stockés en clair;
- une commande possède une durée de validité courte;
- une opération confirmée ne peut pas être rejouée;
- les actions sensibles sont auditables.

### 16.2 Fiabilité

- un événement dupliqué ne produit pas une deuxième opération métier;
- une déconnexion du locker est visible;
- une opération incomplète expire ou passe en erreur;
- la fermeture de porte est observée avant la confirmation finale;
- les erreurs réseau ne laissent pas silencieusement un état incohérent;
- le logiciel peut être testé à l'aide d'un simulateur IoT;
- les actions de démonstration peuvent être répétées sans réinitialisation manuelle de la base.

### 16.3 Maintenabilité

- backend organisé en monolithe modulaire par fonctionnalité;
- migrations PostgreSQL versionnées;
- contrats REST et MQTT documentés;
- configuration séparée du code;
- ADR pour les décisions structurantes;
- tests automatisés des règles de readiness, réservation et transition;
- noms d'états et d'événements cohérents entre les plateformes;
- documentation mise à jour avec le comportement réel.

### 16.4 Performance de démonstration

- une commande d'ouverture produit rapidement un résultat ou une erreur explicite;
- l'état logiciel se met à jour dans les quelques secondes suivant l'événement physique;
- les interfaces restent utilisables sur le réseau de démonstration;
- le parcours complet ne dépend pas d'une intervention manuelle dans PostgreSQL ou MQTT.

### 16.5 Évolutivité raisonnable

Le prototype ne subira pas de test de charge industriel. Les identifiants, contrats et relations doivent néanmoins permettre d'ajouter d'autres lockers, compartiments et actifs sans réécrire le cœur métier.

---

## 17. Porte de décision pour la détection physique

### 17.1 Objectif du POC

Le POC doit déterminer si le RFID UHF permet une observation suffisamment localisée, stable et répétable dans le prototype à deux compartiments.

### 17.2 Tests minimaux

- lire un tag isolé;
- lire plusieurs tags;
- retirer et replacer un tag;
- répéter avec différentes orientations;
- tester le comportement près des matériaux du meuble;
- mesurer les lectures provenant du compartiment voisin;
- tester un tag situé à l'extérieur du locker;
- mesurer le délai nécessaire à une observation stable;
- répéter chaque scénario plusieurs fois;
- documenter les faux positifs et faux négatifs.

### 17.3 Critère de conservation

Le RFID UHF est conservé si le POC permet d'identifier de manière répétable le changement attendu dans le bon compartiment, avec un niveau d'erreur compatible avec la démonstration.

### 17.4 Fallback

Si le résultat n'est pas satisfaisant, le MVP adopte une combinaison plus déterministe :

```text
QR ou NFC pour l'identité
+
capteur de porte
+
capteur de présence ou de poids
```

Le choix doit être consigné dans un ADR. Sélectionner une solution plus fiable après un POC documenté ne constitue pas un échec technique.

### 17.5 Porte de décision pour l'architecture matérielle hub/cellule

#### 17.5.1 Objectif du POC

Le POC doit déterminer si une architecture composée d'un cube hub (écran, calcul, réseau) et d'un cube cellule (compartiment, serrure, capteurs, sans écran ni radio propre), reliés par un câble unique combinant alimentation et communication, est réalisable dans le budget matériel et le calendrier du P0.

#### 17.5.2 Tests minimaux

- alimenter et actionner une serrure de la cellule depuis le hub sur un seul câble;
- adresser la cellule de façon univoque sur cette liaison;
- mesurer la chute de tension sur la longueur de câble prévue pour le prototype;
- détecter une déconnexion ou un débranchement de la cellule depuis le hub;
- reprendre la communication après une déconnexion temporaire;
- estimer le coût en composants (câble, connecteurs, transceiver) contre le budget de 500 $ CA.

#### 17.5.3 Critère de conservation

L'architecture hub/cellule est conservée pour le P0 si le POC démontre une liaison fiable et reproductible dans le budget et le calendrier disponibles, sans retarder le gel fonctionnel de la semaine 12.

#### 17.5.4 Fallback

Si le résultat n'est pas satisfaisant ou consomme trop de temps, le P0 adopte un locker monolithique : un seul ESP32 pilotant directement les deux serrures et leurs capteurs, sans liaison hub/cellule. L'architecture hub/cellule reste alors une orientation de produit documentée pour une évolution P1/P2 (voir 13), sans engagement pour la session.

Le choix doit être consigné dans un ADR. Adopter le fallback monolithique après un POC documenté ne constitue pas un échec technique.

---

## 18. Critères d'acceptation du MVP

Aegis est considéré comme fonctionnel lorsque tous les critères suivants sont satisfaits :

1. Un administrateur peut préparer au moins deux actifs associés aux deux compartiments.
2. Un actif présent avec calibration valide peut être déclaré `READY`.
3. Un actif présent avec calibration expirée est déclaré `BLOCKED`.
4. La raison du blocage est visible sur le Web et le mobile.
5. Un technicien ne peut pas réserver un actif non prêt.
6. Un technicien de niveau insuffisant ne peut pas réserver ou ouvrir un actif restreint.
7. Un technicien autorisé peut réserver un actif prêt depuis iOS.
8. Le backend réévalue les règles avant l'ouverture.
9. Le backend commande le bon compartiment par MQTT.
10. L'ESP32 exécute et confirme la commande.
11. Le retrait physique de l'actif attendu est détecté.
12. Le prêt est créé automatiquement après validation physique.
13. Le retour de l'actif attendu est détecté.
14. Le prêt est terminé automatiquement après validation physique.
15. Le Web et le mobile reflètent l'état final sans modification manuelle de la base.
16. Un événement MQTT dupliqué ne crée pas de transition supplémentaire.
17. Une opération expirée ou incohérente produit un refus ou une anomalie visible.
18. Le locker signale son état en ligne ou hors ligne.
19. La piste d'audit permet de reconstruire l'opération complète.
20. Le système redémarre et retrouve un état de démonstration cohérent selon la procédure documentée.

### Objectif de répétabilité

Avant la présentation finale :

```text
10 retraits consécutifs réussis
+
10 retours consécutifs réussis
+
0 modification manuelle de PostgreSQL
+
0 double traitement causé par un message rejoué
```

---

## 19. Indicateurs et validation de la valeur

### 19.1 Indicateurs démontrables pendant la session

- taux de réussite des retraits et retours;
- délai entre demande autorisée et ouverture;
- délai entre observation physique et mise à jour applicative;
- nombre de doublons correctement ignorés;
- nombre de tentatives non conformes correctement bloquées;
- capacité à reconstruire la chaîne de possession;
- temps nécessaire pour connaître l'état de readiness d'un actif.

### 19.2 Hypothèses commerciales à valider ultérieurement

- réduction du temps passé à chercher du matériel;
- réduction des pertes et retours oubliés;
- diminution des interventions retardées;
- réduction de l'utilisation d'équipements non conformes;
- réduction du temps consacré aux audits;
- meilleure utilisation du parc existant;
- diminution des achats évitables.

Ces bénéfices ne doivent pas être présentés comme déjà prouvés. Une future validation exigerait des entrevues, une mesure de référence et un pilote réel.

---

## 20. Jalons

| Jalon | Résultat attendu |
|---|---|
| Semaines 2–3 | Scope repositionné, User Story Map, architecture initiale, modèle de domaine et matériel de POC |
| Semaines 3–4 | Walking skeleton et décision préliminaire sur la détection |
| Semaines 5–6 | Identité, catalogue, actifs et calcul de readiness |
| Semaine 7 | Réservation et contrats IoT stables |
| Semaines 8–9 | Retrait complet et création automatique du prêt |
| Semaine 10 | Retour complet |
| Semaine 11 | Refus, anomalies, idempotence et sécurité |
| Semaine 12 | Gel fonctionnel du P0 |
| Semaines 13–14 | Stabilisation, tests, documentation, mesure et répétitions |
| Semaine 15 | Présentation finale |

Le développement du logiciel et les POC techniques peuvent progresser en parallèle. L'équipe ne doit pas attendre que toute la documentation soit parfaite avant de réduire les risques matériels et d'intégration.

---

## 21. Règles de modification du scope

Une nouvelle capacité ne peut entrer dans le P0 que si elle est :

- imposée par la grille d'évaluation;
- indispensable à la démonstration de readiness, de retrait ou de retour;
- nécessaire à la sécurité ou à la cohérence des données;
- requise pour remplacer une technologie ayant échoué au POC.

Toute entrée dans le P0 doit être accompagnée d'au moins une mesure compensatoire :

- retrait d'une fonctionnalité de charge comparable;
- simplification explicite d'une autre capacité;
- justification et validation par les deux membres;
- nouvelle estimation montrant que le gel de la semaine 12 reste réaliste.

Questions à poser avant d'accepter une idée :

1. Renforce-t-elle directement la promesse « équipement prêt, conforme et traçable »?
2. Est-elle visible dans le scénario de démonstration?
3. Est-elle nécessaire au parcours P0?
4. Quel coût introduit-elle sur le Web, iOS, backend, données, IoT et tests?
5. Quelle fonctionnalité sera réduite si elle entre maintenant?

Si les réponses ne justifient pas son coût, l'idée reste P1, P2 ou hors scope.

---

## 22. Definition of Done du MVP

Le MVP est terminé lorsque :

- tous les critères d'acceptation P0 sont satisfaits;
- le scénario de readiness est démontré;
- les parcours de retrait et de retour fonctionnent de bout en bout;
- les refus essentiels et au moins une anomalie sont démontrés;
- les règles métier critiques sont couvertes par des tests;
- les contrats REST et MQTT sont documentés;
- les migrations de base de données sont versionnées;
- aucun secret n'est présent dans le dépôt;
- les erreurs principales sont visibles et compréhensibles;
- le système peut être lancé à partir d'instructions écrites;
- la documentation correspond au comportement réellement construit;
- l'objectif de répétabilité a été testé;
- la démonstration complète a été répétée par les deux membres;
- aucune fonctionnalité P1 ou P2 n'est nécessaire pour exécuter le P0.

---

## 23. Questions ouvertes

Les points suivants doivent encore être décidés ou validés :

- méthode de détection physique retenue après le POC;
- matériel RFID UHF exact à tester;
- capteur de présence ou de poids de fallback;
- mécanisme mécanique et électrique des serrures;
- source d'alimentation et stratégie de sécurité électrique;
- protocole exact de la liaison hub–cellule (bus, adressage, détection de déconnexion/sabotage);
- actifs physiques utilisés lors de la démonstration;
- durée d'expiration d'une réservation;
- durée d'expiration d'une `LockerOperation`;
- méthode de rafraîchissement du Web et du mobile;
- fournisseur et topologie du déploiement;
- mécanisme d'authentification exact;
- représentation précise du calcul de readiness dans le modèle de domaine;
- méthode de mesure des délais et de la répétabilité;
- niveau de polish attendu pour l'écran Web et l'application iOS.

Chaque décision structurante doit être ajoutée au cahier de conception ou à un ADR avant son implémentation définitive.

---

## 24. Décision de recentrage

La version précédente du scope présentait principalement Aegis comme une plateforme générique de gestion d'actifs destinée à un laboratoire.

La présente version adopte une base plus précise :

| Avant | Maintenant |
|---|---|
| Gestion générique d'actifs | Disponibilité opérationnelle d'équipements critiques |
| Laboratoire comme cible | Laboratoire comme terrain de validation |
| Présence et disponibilité | Présence, disponibilité, conformité et autorisation |
| Prêt et retour comme valeur principale | Readiness et chaîne de possession comme valeur principale |
| Calibration en P2 | Règle minimale de calibration en P0 |
| IA mise en avant | IA exclue du cœur du MVP |
| RFID comme différenciateur possible | Détection physique remplaçable après POC |

Ce recentrage n'augmente pas le nombre de plateformes ni la taille du prototype. Il remplace une partie du périmètre générique par une règle métier forte et démontrable.
