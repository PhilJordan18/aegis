# Aegis — Périmètre du projet

**Cours :** 420-5X7-SO — Écosystème connecté  
**Session :** Automne 2026  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Date de révision :** 16 septembre 2026  
**Version :** 0.4 — accès local par QR, horaires et architecture en étoile  
**Échéance :** Semaine 15, le 23 décembre 2026

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
- un casier connecté modulaire composé, pour le P0, d'un hub ESP32 avec écran et réseau et de deux cellules sans écran ni radio propre, chacune correspondant à un compartiment;
- une liaison en étoile, avec un port et un câble dédiés du hub vers chaque cellule;
- un contrôle d'accès local par QR affiché sur le hub avant chaque autorisation de retrait ou de retour;
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
5. vérifier le défi QR scanné par l'initiateur avant d'autoriser l'ouverture d'un seul compartiment;
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
- si les horaires permettent de commencer l'action;
- si le défi QR est valide, lié au demandeur et à l'opération, et encore inutilisé;
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


### 7.6 Réservation, contrôle local et preuve physique sont distincts

Une réservation peut être créée à distance par un utilisateur autorisé; elle ne déverrouille jamais le locker. La préparation d'un retrait ou d'un retour crée une opération `AWAITING_LOCAL_PROOF` et un QR sur l'écran du hub, sans commande de serrure.

Le technicien scanne ce QR dans l'application iOS. Le backend vérifie le compte, le contexte, l'échéance et toutes les gardes métier applicables, puis consomme le défi et crée l'unique commande de manière atomique. Le secret n'est jamais fourni au téléphone par une réponse REST ni exposé dans les logs ou l'administration.

Le scan établit l'accès à un code récemment affiché. Une photo, une vidéo ou un complice peut le relayer : le P0 ne revendique pas une preuve absolue de présence, une protection anti-relais ou un second facteur d'identité indépendant.

Le QR d'accès local ne remplace pas le RFID de l'actif, ni le fallback d'identification et de présence. Le prêt ne commence et ne se termine qu'après confirmation physique.

### 7.7 Le retour possède ses propres conditions d'autorisation

La readiness bloque une nouvelle réservation et un retrait non admissible. Pour retirer sa propre réservation, le titulaire est évalué dans ce contexte : sa réservation valide n'est pas traitée comme un conflit.

Un actif emprunté est normalement `BORROWED` et non disponible pour un nouvel emprunt. Il peut néanmoins être retourné par son titulaire, même s'il est devenu endommagé ou non calibré. Le retour exige un prêt ouvert, le QR valide, les horaires et les gardes physiques de sécurité; il n'exige pas que l'actif soit `READY`. Une récupération après anomalie reste encadrée par les règles du domaine.

## 8. Acteurs du MVP

### 8.1 Technicien

Utilisateur de l'application iOS qui peut :

- s'authentifier;
- consulter le parc institutionnel, y compris les actifs à accès restreint affichés comme bloqués lorsque son niveau est insuffisant;
- voir leur état de readiness;
- réserver un actif prêt;
- demander l'accès au compartiment attribué et scanner le QR affiché sur le hub;
- retirer et retourner l'actif;
- consulter sa réservation et son prêt actifs.

### 8.2 Administrateur

Utilisateur de l'application Web qui peut :

- s'authentifier;
- gérer les modèles et exemplaires d'actifs;
- définir un niveau d'accès requis;
- définir l'état opérationnel et la calibration;
- associer un actif à un tag et à un compartiment;
- configurer les heures d'exploitation du locker;
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
- affiche le défi QR et accuse son affichage effectif;
- reçoit une commande de serrure autorisée;
- affiche les consignes et le résultat métier fourni par le backend;
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


Une seule réservation `ACTIVE` est permise par technicien et par actif. Le P0 réserve pour un usage immédiat : `reservedFrom` correspond à la création; le technicien choisit `reservedUntil`, dans la plage d'exploitation courante.

`reservedUntil` est l'heure de retour attendue, pas une durée fixe de 20 minutes. Avant retrait, elle borne la réservation. Après retrait confirmé, elle est copiée dans `Loan.dueAt`; son dépassement ne libère pas l'actif.

### 9.7 Prêt

```text
ACTIVE
RETURN_PENDING
COMPLETED
```


Un prêt `ACTIVE` ou `RETURN_PENDING` maintient l'actif `BORROWED`. Le retard est dérivé de `dueAt`; il n'est pas un statut terminal. La préparation d'un retour laisse le prêt inchangé; le passage de `ACTIVE` à `RETURN_PENDING` intervient après validation du QR et autorisation backend.

### 9.8 LockerOperation

Chaque interaction physique est représentée par une opération temporaire :

```text
REQUESTED
AWAITING_LOCAL_PROOF
AUTHORIZED
COMMAND_SENT
COMMAND_ACKNOWLEDGED
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
- le défi local associé et son échéance;
- les dates d'autorisation et de validation locale, nulles pendant l'attente du QR;
- une date d'expiration physique, fixée à 120 secondes après l'autorisation;
- son état courant.

---


`COMMAND_ACKNOWLEDGED` signifie que le hub a accepté la commande de serrure. Ce n'est ni un accusé d'affichage du QR ni une preuve d'ouverture ou de mouvement d'actif.

### 9.9 Défi local d'accès

Le concept `LocalAccessChallenge` est lié à une seule opération, donc à un initiateur, une action, un actif et une cellule précis. Il cible aussi le hub actif et son démarrage courant. Ses états sont `PENDING`, `CONSUMED`, `EXPIRED` et `INVALIDATED`.

La consommation du défi, l'autorisation, la création de commande, le changement éventuel du prêt et l'audit réussissent ensemble ou sont annulés ensemble. Une opération terminale ne peut pas être réactivée pour réutiliser son défi.

### 9.10 Horaire d'exploitation

L'administrateur définit un horaire hebdomadaire par locker, au maximum une plage continue par jour, avec son fuseau (`America/Toronto` pour la démonstration). Le P0 n'inclut ni plages de nuit traversant minuit, ni exceptions datées, ni réservations à démarrage futur.

Une réservation, un retrait ou un retour est initié pendant une plage ouverte. La fin de réservation ne dépasse pas la fermeture. Un prêt non rendu à la fermeture reste ouvert et indisponible; aucune clôture automatique n'est admise.

### 9.11 Repères temporels

| Repère | Règle | Statut |
|---|---|---|
| Réservation | Fin personnalisée au plus tard à la fermeture de la plage courante | Décision intégrée |
| Opération physique | 120 s après `authorizedAt` | Décision intégrée |
| Défi QR | Au plus 60 s après création, sans dépasser fermeture ni `reservedUntil` pour un retrait; préparation lorsque le technicien est devant le casier | Retenu le 23 septembre; ergonomie à mesurer |
| Essais de secret | Au plus 5 secrets erronés soumis par défi; seul l'initiateur peut en consommer les essais; une lecture caméra sans soumission ne compte pas | Retenu le 23 septembre |
| Fréquence des préparations | Limitation configurable par utilisateur et casier, sans recompter les rejeux idempotents; compatible avec les retraits/retours normaux et testée contre les rafales | Principe retenu; seuil numérique à qualifier, ancien plafond de 3/15 min abandonné |
| Heartbeat | Toutes les 10 s; `OFFLINE` après plus de 30 s sans heartbeat valide | Base P0 configurable |
| Fenêtre RFID | Départ POC : 3 s après fermeture; retour avec au moins 3 lectures cohérentes, retrait sans le tag sur une fenêtre saine complète | À mesurer au POC |

La durée maximale de l'impulsion électrique de serrure est distincte des 120 secondes métier; elle dépend du composant et des essais.

## 10. Démonstration de référence

### 10.1 Préparation

Le locker contient deux équipements comparables :

| Compartiment | Actif | Présence | Calibration | Niveau requis | Résultat |
|---|---|---|---|---|---|
| `A1` | Multimètre 1 | Présent | Valide | `STANDARD` | `READY` |
| `A2` | Multimètre 2 | Présent | Expirée | `STANDARD` | `BLOCKED` |

Un compte technicien standard et un compte administrateur sont préparés.

### 10.2 Scénario nominal de retrait

1. Le technicien se connecte à l'application iOS et recherche un multimètre.
2. Le backend présente A1 `READY` et A2 `BLOCKED / CALIBRATION_EXPIRED`.
3. Le technicien réserve A1 et choisit une fin comprise dans l'horaire actif. Aucune serrure n'est commandée.
4. Il prépare le retrait depuis sa réservation.
5. Le backend vérifie les préconditions, crée une opération `CHECKOUT / AWAITING_LOCAL_PROOF` et fait afficher son défi sur le hub.
6. Le hub confirme l'affichage; le technicien scanne le QR avec Aegis Mobile.
7. L'application transmet le défi à l'API authentifiée.
8. Le backend vérifie le défi, les droits, les horaires, la réservation et la readiness dans le contexte du titulaire. Il consomme le défi et autorise l'opération atomiquement.
9. La fenêtre physique de 120 secondes commence; une commande expirante cible uniquement A1.
10. Le hub masque le QR, commande la cellule A1 et émet l'accusé de commande.
11. Le technicien ouvre la porte, retire l'actif et referme la porte.
12. La cellule produit une fenêtre RFID saine après fermeture; le tag attendu n'y est plus présent. Le hub transmet les événements corrélés.
13. Le backend valide la séquence, confirme l'opération, passe la réservation à `FULFILLED` et crée le prêt `ACTIVE`.
14. Le mobile et le Web présentent le nouvel état; l'écran affiche le résultat confirmé par le backend.

### 10.3 Scénario nominal de retour

1. Le technicien ouvre son prêt actif dans Aegis Mobile et prépare un retour pendant la plage d'exploitation.
2. Le backend crée une opération `RETURN / AWAITING_LOCAL_PROOF` et fait afficher un nouveau QR. Le prêt conserve son état courant.
3. Le hub accuse l'affichage; le titulaire scanne le QR et le soumet à l'API.
4. Le backend revalide le défi et les conditions du retour, puis consomme, autorise et passe le prêt à `RETURN_PENDING` atomiquement.
5. Le bon compartiment reçoit la commande; les 120 secondes commencent à l'autorisation.
6. Le technicien dépose l'actif attendu et referme la porte.
7. Les observations de porte et la lecture stable du bon tag après fermeture sont corrélées à l'opération.
8. Le backend confirme le retour et passe le prêt à `COMPLETED`.
9. La disponibilité et la readiness sont recalculées; le Web, le mobile et l'écran présentent le résultat.

Un retour confirmé ne garantit pas `READY` : un actif revenu endommagé ou avec calibration expirée reste bloqué pour un nouvel emprunt.

### 10.4 Scénarios de refus ou d'anomalie

Au minimum, la démonstration doit également prouver :

- le refus d'une réservation pour calibration expirée;
- le refus d'un accès avec un niveau insuffisant;
- l'expiration d'une opération non complétée;
- l'absence de double traitement d'un événement MQTT dupliqué;
- la création d'une anomalie si l'actif attendu n'est pas observé;
- l'absence d'ouverture après une simple réservation ou une préparation sans QR valide;
- le refus d'un défi expiré, rejoué ou soumis par un autre compte;
- une seule commande malgré deux validations concurrentes;
- le maintien de l'actif indisponible tant que le prêt n'est pas physiquement terminé, même après son échéance.

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

**Cadre institutionnel P0 — clarification validée le 23 septembre 2026.**
Un déploiement sert une seule institution. Les comptes administrateur et
technicien préparés pour ce déploiement accèdent au même parc institutionnel,
selon leurs rôles et niveaux d'accès vérifiés par le backend. La connexion ne
comporte ni choix d'institution ni demande d'adhésion; l'administrateur ne valide
pas chaque connexion. Le partage du parc ne donne pas au technicien les droits
administratifs ni l'accès aux réservations et prêts des autres techniciens.

Cette limite ne constitue pas une architecture multi-tenant : ni entité
d'organisation, ni adhésions multiples, ni sélecteur d'institution ne sont requis
au P0. L'accueil de plusieurs institutions dans une même instance et les
invitations de membres constituent une évolution future à concevoir et à
valider séparément, sans engagement pour cette session.

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
- empêcher la réservation et le retrait d'un actif non prêt, en tenant compte de la réservation du titulaire pour son propre retrait;
- appliquer au retour ses gardes spécifiques, sans exiger une readiness d'emprunt;
- réévaluer les règles applicables lors de la validation du QR, avant création de la commande;
- exposer le résultat de façon cohérente au Web et au mobile;
- couvrir les règles critiques par des tests automatisés.

Le P0 ne nécessite pas un moteur de règles générique configurable. Une implémentation claire dans le domaine Spring Boot est suffisante.

### 11.4 Réservations

- réserver un actif `READY` sans aucune ouverture automatique;
- empêcher deux réservations actives sur le même actif et plus d'une réservation active par technicien;
- vérifier les droits du demandeur;
- commencer la réservation immédiatement et laisser choisir `reservedUntil` dans la plage ouverte;
- refuser une demande hors horaire, une échéance passée ou une fin dépassant la fermeture;
- consulter et annuler sa réservation inutilisée;
- invalider atomiquement le défi et terminer l'attente QR lors d'une annulation avant autorisation;
- faire expirer une réservation non utilisée à son échéance; l'attente QR ne prolonge pas cette réservation;
- refuser une nouvelle autorisation de retrait si la réservation n'est plus valide;
- passer la réservation à `FULFILLED` seulement au retrait confirmé.

Une opération de retrait autorisée avant la fin de réservation conserve sa fenêtre physique. Si l'échéance survient pendant l'exécution ou si la réalité physique reste incertaine, la réservation ne libère pas l'actif avant classification de l'opération. Une confirmation physique tardive peut créer un prêt déjà en retard, jamais un actif disponible par défaut.

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
- permettre de reconstruire qui détenait quel actif et à quel moment;
- copier l'échéance de réservation dans `Loan.dueAt` et présenter les prêts en retard sans les clôturer;
- maintenir l'actif `BORROWED` tant qu'un prêt reste ouvert, même si son tag réapparaît sans retour corrélé;
- permettre une nouvelle tentative après échec sûr ou une récupération encadrée après anomalie, sans réactiver une opération terminale.

### 11.6 Locker et compartiments

- représenter un locker unique composé d'un hub et de deux cellules, chacune formant un compartiment (voir 17.5);
- représenter deux compartiments indépendants;
- associer un actif à chaque compartiment;
- connaître l'état en ligne ou hors ligne du locker;
- connaître l'état ouvert ou fermé de chaque porte;
- commander l'ouverture d'un compartiment précis;
- limiter le locker à une seule opération non terminale, y compris pendant l'attente QR;
- confirmer la réception ou l'échec d'une commande;
- afficher les principaux états physiques dans l'administration Web.

L'étoile est retenue : chaque cellule a son port et son câble dédiés vers le hub. Elle n'accorde aucune autorisation et ne possède aucun accès MQTT; elle exécute les commandes du hub et lui rapporte ses observations. Le POC valide la réalisation électrique et le protocole, pas le nombre de compartiments.

### 11.7 Opérations physiques

- créer une `LockerOperation` pour chaque retrait ou retour;
- corréler la demande, la commande et les événements par `operationId`;
- distinguer l'attente QR de l'opération autorisée; aucun déverrouillage pendant `AWAITING_LOCAL_PROOF`;
- imposer une durée physique de 120 secondes après autorisation;
- distinguer l'accusé d'affichage du QR de `COMMAND_ACKNOWLEDGED`;
- classer l'expiration avant autorisation comme un échec sûr sans mutation du prêt;
- créer une anomalie lorsque l'exécution physique est incertaine, sans supposer qu'une porte fermée exclut toute action antérieure;
- enregistrer chaque transition d'état;
- attendre la fermeture de la porte avant la confirmation finale;
- confirmer uniquement l'actif attendu;
- marquer une opération incohérente comme `ANOMALY` ou `FAILED`;
- empêcher la réutilisation d'une opération confirmée ou expirée.

### 11.8 Hardware et détection

- connecter le hub ESP32 au réseau; les cellules utilisent leurs liaisons locales dédiées;
- contrôler deux serrures électroniques;
- lire un capteur de porte par compartiment;
- fournir un indicateur visuel minimal par compartiment et un écran de hub capable d'afficher un QR lisible;
- appliquer une durée maximale de déverrouillage;
- utiliser le RFID UHF local par cellule comme option de départ, à qualifier au POC, ou le fallback documenté si nécessaire;
- ne jamais assimiler une absence de réponse du lecteur à l'absence de l'actif;
- détecter le retrait de l'actif attendu;
- détecter le retour de l'actif attendu;
- transmettre les événements au backend;
- reprendre la communication après une déconnexion temporaire;
- fournir un comportement sûr en cas de redémarrage.

La fermeture mécanique industrielle, la résistance à l'effraction et la certification électrique ne font pas partie du P0.

### 11.9 Communication MQTT

- utiliser des canaux distincts pour commandes de serrure, événements, statuts et instructions d'écran;
- authentifier le device;
- limiter ses permissions aux topics nécessaires;
- inclure `messageId`, `operationId`, `lockerId`, `type`, `timestamp` et `schemaVersion` lorsque pertinents;
- envoyer un accusé de réception de commande et un accusé applicatif distinct lorsque le QR a réellement été affiché;
- traiter les événements de façon idempotente;
- ignorer ou refuser une commande expirée;
- publier un heartbeat;
- conserver les événements utiles au diagnostic en excluant les secrets;
- publier commandes et affichages avec `retain=false` et dédupliquer les livraisons;
- vérifier la session du hub et l'ordre des instructions d'écran pour ne pas réafficher un ancien QR.

Topics initiaux :

```text
aegis/v1/lockers/{lockerId}/commands
aegis/v1/lockers/{lockerId}/events
aegis/v1/lockers/{lockerId}/status
aegis/v1/lockers/{lockerId}/display
```

### 11.10 Administration Web — Aegis Manager

- connexion administrateur;
- gestion minimale du catalogue et des actifs;
- saisie de l'état opérationnel et de la calibration;
- configuration des heures d'exploitation et du fuseau du locker;
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
- scan du QR affiché sur le hub et envoi du défi à l'API authentifiée;
- erreur explicite si le QR est invalide, illisible, expiré ou si l'accès à la caméra est refusé;
- affichage de la progression de l'opération;
- consultation du prêt actif;
- lancement du retour;
- retour visuel clair en cas de succès, refus, expiration ou anomalie.

### 11.12 Audit et anomalies

- journaliser les connexions et refus pertinents;
- journaliser les changements de readiness déterminants;
- journaliser les réservations, décisions de défi QR, commandes d'ouverture, retraits et retours, sans stocker le secret dans l'audit;
- conserver les transitions des prêts et opérations;
- conserver les événements IoT importants;
- détecter l'absence de l'actif attendu;
- empêcher un doublon de créer une seconde transition métier;
- présenter une chronologie compréhensible à l'administrateur;
- permettre à l'administrateur de reconnaître une anomalie et documenter la correction, sans la résoudre par simple changement de statut;
- résoudre une anomalie uniquement après une preuve corrective cohérente validée par le backend.

### 11.13 Infrastructure et exploitation

- exécuter PostgreSQL et le broker MQTT dans un environnement reproductible;
- déployer le backend et le Web dans un environnement de démonstration accessible;
- utiliser HTTPS pour les clients distants;
- utiliser MQTT authentifié et chiffré avec tout hub réel, même au laboratoire, afin de protéger le défi; seuls les tests avec simulateur isolé peuvent employer le réseau Docker privé non chiffré;
- conserver PostgreSQL hors de l'accès public;
- fournir les secrets par configuration externe;
- versionner les migrations Flyway;
- fournir un simulateur IoT pour développer sans le locker, couvrant aussi affichage du défi, accusé, expiration et redémarrage;
- documenter les étapes de lancement et de démonstration.

---


### 11.14 Contrôle local et écran du hub

- générer un secret aléatoire fort pour chaque défi, valable une seule fois et lié à l'opération;
- transmettre le secret uniquement au hub ciblé, par le canal MQTT privé; le mobile l'obtient par scan;
- attendre l'accusé d'affichage avant autorisation;
- vérifier le compte initiateur, le contexte, le délai, le démarrage du hub et les gardes applicables au scan;
- consommer le défi et créer la commande de manière atomique et idempotente;
- protéger le secret dans les données techniques et le purger lorsqu'il devient inutilisable;
- effacer le QR après usage, expiration, invalidation ou redémarrage;
- afficher action, cellule, consignes et résultat confirmé par le backend;
- refuser explicitement l'ouverture si l'écran ou le contrôle local n'est pas disponible, sans voie de contournement.

Le P0 ne nécessite pas d'inscription, de catalogue, de réservation ou d'authentification autonome sur l'écran. Le mobile suit l'opération par les lectures REST prévues; aucune notification push supplémentaire n'est exigée.

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
- enrichissement de l'interface du hub au-delà du QR, des consignes et du résultat déjà inclus au P0;
- gestion d'une batterie ou d'un état de charge déclaré;
- identification détaillée et traitement enrichi d'un mauvais actif; le refus d'une preuve incompatible et l'anomalie minimale restent P0;
- QR ou NFC comme seconde méthode d'identification d'actif, distincte du QR d'accès local déjà P0;
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
- garantie anti-relais du QR ou décision d'accès fondée sur le pays ou l'adresse IP;
- calendrier de réservations à démarrage futur, exceptions d'horaires et prolongations avancées dans le P0;
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
| Prototype | Un hub avec écran et deux cellules/compartiments; étoile retenue, réalisation électrique en POC |
| Estimation matérielle | Repère initial de 500 $ CA; coût et partage finaux à décider après nomenclature complète, inventaire et POC |
| Mobile | Application iOS native avec SwiftUI |
| Accès à Xcode | Principalement sur les Macs du Cégep |
| Web | React avec TypeScript |
| Backend | Java avec Spring Boot, technologie en apprentissage |
| Données | PostgreSQL |
| Contrôleur | ESP32 |
| Clients | HTTPS vers une API REST |
| IoT | MQTT entre backend, broker et hub ESP32; cellules sans accès IP/MQTT |
| Liaison de cellule | Un port/câble dédié et un segment RS-485 indépendant par cellule, selon ADR-002; connecteur et brochage propriétaire à valider |
| Accès local | QR à usage unique affiché par le hub et validé par le backend |
| Détection | Une méthode fiable obligatoire; RFID UHF soumis à POC |
| IA | Non requise dans le produit |
| Déploiement | Services sur un hôte local de démonstration, accessible par le réseau autorisé depuis les iPhone et le hub |
| Utilisateurs P0 | Comptes de démonstration préparés |
| Échelle P0 | Un locker, deux actifs principaux, quelques comptes |

---

## 16. Exigences non fonctionnelles

### 16.1 Sécurité

- toute décision d'ouverture est prise par le backend;
- toutes les entrées d'API sont validées;
- les autorisations sont vérifiées côté serveur;
- les communications distantes des clients utilisent HTTPS;
- la communication MQTT avec un hub réel est authentifiée et chiffrée;
- aucune commande de serrure n'est créée avant validation et consommation du défi QR;
- le QR est lié à l'initiateur, à l'opération et au démarrage du hub;
- les essais et préparations sont limités; le secret n'est jamais fourni par une réponse REST ou un diagnostic;
- les identifiants MQTT sont propres au device;
- les secrets ne sont jamais committés;
- les mots de passe ne sont jamais stockés en clair;
- une commande possède une durée de validité courte;
- une opération confirmée ne peut pas être rejouée;
- les actions sensibles sont auditables.

### 16.2 Fiabilité

- un événement dupliqué ne produit pas une deuxième opération métier;
- une déconnexion du locker est visible;
- une opération incomplète expire ou passe en erreur; son délai QR et son délai physique sont distincts;
- une panne d'écran, une reconnexion ou un rejeu ne déclenche aucune ouverture;
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
- tests automatisés des règles de readiness, horaires, réservation, validation du QR et transition;
- noms d'états et d'événements cohérents entre les plateformes;
- documentation mise à jour avec le comportement réel.

### 16.4 Performance de démonstration

- distinguer dans les mesures le temps humain de scan, le temps de validation du défi et le délai entre autorisation et ouverture;
- une commande d'ouverture produit rapidement un résultat ou une erreur explicite;
- l'état logiciel se met à jour dans les quelques secondes suivant l'événement physique;
- les interfaces restent utilisables sur le réseau de démonstration;
- le parcours complet ne dépend pas d'une intervention manuelle dans PostgreSQL ou MQTT.

### 16.5 Évolutivité raisonnable

Le prototype ne subira pas de test de charge industriel. Les identifiants, contrats et relations doivent néanmoins permettre d'ajouter d'autres lockers, compartiments et actifs sans réécrire le cœur métier.

---

## 17. Validation de la détection et de la réalisation matérielle

### 17.1 Objectif du POC

Le RFID UHF local par cellule est l'option de départ. Le POC doit mesurer sa localisation, sa stabilité et sa répétabilité dans les deux compartiments; une lecture locale n'élimine pas à elle seule les lectures parasites. Le choix n'est remplacé que si les résultats documentés justifient le fallback.

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

Le RFID UHF est conservé si le POC permet d'identifier de manière répétable le changement attendu dans le bon compartiment. Le rapport de POC fixe avant essais les seuils admissibles d'erreur et de délai, puis consigne les résultats. La fenêtre initiale de trois secondes n'est pas présentée comme une performance déjà prouvée.

### 17.4 Fallback

Si le résultat n'est pas satisfaisant, le MVP adopte une combinaison plus déterministe :

```text
QR ou NFC pour l'identité
+
capteur de porte
+
capteur de présence ou de poids
```

Le choix doit être consigné dans un ADR. Sélectionner une solution plus fiable après un POC documenté ne constitue pas un échec technique. Ce fallback concerne l'identité et la présence de l'actif; il ne remplace pas le QR d'autorisation affiché sur le hub.

### 17.5 Validation de l'architecture matérielle en étoile

#### 17.5.1 Décision retenue et objet du POC

L'équipe a retenu un hub maître avec écran et deux cellules indépendantes. Une cellule forme exactement un compartiment. L'empilage mécanique reste possible, avec un câble direct du hub vers chaque cellule; aucun câble de cellule ne sert de passage vers l'autre.

Le POC valide l'alimentation, les interfaces, la connectique et le protocole dans les ressources disponibles et le calendrier. Il ne remplace pas le prototype par une seule cellule.

#### 17.5.2 Communication retenue et connectique à valider

La proposition initiale de Jimmy est un câble à paires torsadées Cat5e/Cat6 terminé en connecteurs RJ45. Le document 12 recommande aussi l’étude du M12 codé A à 5 contacts, sans approbation définitive de connecteur. Le câble transporte alimentation et signaux Aegis selon un brochage à définir; une prise RJ45 Aegis n'est ni un port Ethernet ni du PoE standard et ne doit pas être raccordée à un équipement réseau.

L’[ADR-002 accepté](../adr/ADR-002-etoile-rs485.md) retient une liaison RS-485 point à point indépendante par port du hub, avec ses interfaces propres. Cette formulation aligne le scope sur la décision consignée; elle ne valide pas le montage électrique. Les A/B des départs ne sont pas simplement raccordés en étoile passive sur un bus unique. Modbus RTU minimal reste une proposition de protocole applicatif à confirmer; le choix final et ses contraintes seront consignés dans l'ADR matériel.

Aucune tension admissible, section, intensité, terminaison ou affectation de broche non vérifiée n'est considérée comme validée. Ajouter une cellule exige un port, des interfaces et un budget de puissance correspondants.

#### 17.5.3 Tests minimaux

- adresser et commander séparément A1 et A2, sans action sur la mauvaise cellule;
- alimenter et actionner chaque serrure par son propre câble;
- mesurer le courant et la chute de tension sur chaque liaison à la longueur prévue;
- vérifier brochage, contacts, protections et compatibilité des alimentations;
- détecter le débranchement d'une cellule et vérifier le comportement de l'autre;
- reprendre la communication sans réexécuter une ancienne commande;
- tester redémarrages, délais et doublons;
- vérifier la lisibilité du QR sur le téléphone réel et son effacement après usage;
- chiffrer l'écran, les deux lecteurs RFID, les interfaces, les câbles, les connecteurs, l'alimentation, les protections et la mécanique dans une nomenclature complète.

#### 17.5.4 Critère de conservation et fallback

La réalisation modulaire est conservée si les deux liaisons sont fiables et répétables et si son coût, sa disponibilité et son effort d'intégration restent compatibles avec les ressources et le gel de semaine 12. La décision matérielle doit intervenir selon les jalons de POC de l'équipe, après examen de la nomenclature complète.

Si la réalisation échoue, le repli documenté est un ESP32 pilotant directement les deux compartiments. Un ADR explicite le changement; les identifiants A1/A2, l'écran QR, l'autorité du backend et les preuves physiques restent requis. La modularité plus avancée demeure une évolution ultérieure.

---

## 18. Critères d'acceptation du MVP

Aegis est considéré comme fonctionnel lorsque tous les critères suivants sont satisfaits :

1. Un administrateur peut préparer au moins deux actifs associés aux deux compartiments.
2. Un actif présent, conforme, disponible et autorisé pour le demandeur est évalué `READY` par le backend.
3. Un actif présent avec calibration expirée est déclaré `BLOCKED`.
4. La raison du blocage est visible sur le Web et le mobile.
5. Un technicien ne peut pas réserver un actif non prêt.
6. Un technicien de niveau insuffisant ne peut pas réserver ou ouvrir un actif restreint.
7. Un technicien autorisé peut réserver un actif prêt depuis iOS.
8. Le backend réévalue les gardes applicables lors de la validation du QR, avant de créer une commande.
9. Le backend commande le bon compartiment par MQTT.
10. L'ESP32 accuse et exécute la commande; cet accusé seul ne confirme pas le retrait ou le retour.
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
21. Une réservation distante et une préparation sans scan valide ne génèrent aucune commande de serrure.
22. Le QR est affiché sur le hub; aucune réponse REST, trace ou vue administrative n'en expose le secret.
23. Un défi expiré, rejoué, lié à une autre opération ou soumis par un autre compte est refusé; deux scans concurrents ne produisent qu'une commande.
24. Les 120 secondes physiques commencent après autorisation; une expiration du défi laisse le prêt inchangé.
25. Le titulaire choisit une échéance dans l'horaire; une seule réservation active est admise par technicien et par actif.
26. Dépasser l'échéance d'un prêt ou observer le tag sans retour corrélé ne rend jamais l'actif réservable.
27. Un actif emprunté peut suivre le retour autorisé sans être READY; après retour, une non-conformité continue de bloquer un nouvel emprunt.
28. Une anomalie ne peut pas être résolue sans preuve corrective cohérente.
29. Le hub et les deux cellules communiquent sur les départs dédiés; une commande pour A1 n'actionne jamais A2.
30. Le QR est effacé après expiration, invalidation, usage ou redémarrage; sans contrôle local disponible, l'ouverture est refusée.

### Objectif de répétabilité

Avant la présentation finale, chaque retrait et chaque retour réussi comprend la validation du QR et la confirmation physique :

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
- délai entre demande autorisée et ouverture, séparé du temps de scan;
- taux de lecture du QR et nombre de défis expirés ou refusés correctement;
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

L'échéance de remise indiquée par l'équipe reste la semaine 15, le **23 décembre 2026**. Les numéros de semaines suivent le calendrier pédagogique; ils ne sont pas convertis ici en semaines civiles consécutives.

Le plan d'itérations du document 14 propose les cibles internes ci-dessous après la phase de conception. Elles servent au suivi d'équipe et ne modifient aucune date de remise imposée.

| Jalon interne | Résultat attendu |
|---|---|
| Semaines 2–3 | Scope, modèle de domaine et architecture initiale comme base de conception |
| Semaine 4 | Cohérence documentaire, backlog priorisé et début du walking skeleton |
| Semaines 5–6 | Identité, catalogue, premiers tests écran/caméra, décision RFID et liaisons de cellules |
| Semaine 7 | Présence, readiness et horaires démontrables |
| Semaine 8 | Réservation robuste et bornée par l'horaire |
| Semaine 9 | Défi QR, commande ciblée, ACK et contrats d'accès local intégrés |
| Semaine 10 | Retrait complet et prêt créé automatiquement |
| Semaine 11 | Retour complet et refus essentiels intégrés |
| Semaine 12 | Anomalies, audit et sécurité vérifiés; gel fonctionnel du P0 |
| Semaines 13–14 | Stabilisation, documentation, mesures et répétitions |
| Semaine 15 | Présentation finale selon le calendrier confirmé du cours |

Les contrôles de sécurité et d'idempotence sont développés avec chaque parcours; la semaine 12 est leur validation globale, pas leur première implémentation. Les POC et le logiciel progressent en parallèle. Aucun jalon intermédiaire n'est présenté comme déjà atteint par la seule existence de documents.

La capacité planifiée reste celle du document 14 : 6 h communes à deux, plus 4 h hors cours engagées par Philippe, soit 16 h-personnes par semaine avant absences. Aucun engagement supplémentaire de Jimmy ni travail de fin de semaine n'est présumé.

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


### 21.1 Impact de la révision QR

Le QR ajoute un travail réel sur iOS, le hub, l'API, les données et les tests. Les stories LOC-01/02 et les parcours concernés doivent être réestimés par l'équipe.

La simplification compensatoire proposée limite l'écran P0 au QR, aux consignes et au résultat backend : aucun catalogue tactile, aucune réservation ou connexion autonome au hub et aucun push mobile supplémentaire. L'équipe ne considère pas cette limitation comme un gain d'heures déjà mesuré; elle vérifie que la charge tient dans le gel de semaine 12. Budget, nombre de compartiments et échéance finale ne sont pas augmentés par cette révision.

## 22. Definition of Done du MVP

Le MVP est terminé lorsque :

- tous les critères d'acceptation P0 sont satisfaits;
- le scénario de readiness est démontré;
- les parcours de retrait et de retour fonctionnent de bout en bout;
- les refus essentiels et au moins une anomalie sont démontrés;
- les règles métier critiques, l'autorisation QR, les expirations et la consommation concurrente sont couvertes par des tests;
- aucun parcours de compatibilité ne permet d'ouvrir sans contrôle local;
- l'écran du hub et la caméra du téléphone utilisés à la démonstration ont été testés;
- les horaires et le maintien de l'indisponibilité d'un prêt en retard sont démontrés;
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

Les points suivants restent à décider ou à valider :

- références exactes des lecteurs RFID, antennes et tags, puis résultats de localisation et de stabilisation;
- capteur de présence ou de poids si le fallback de détection devient nécessaire;
- verrou retenu, mécanisme de porte, courant d'actionnement, durée d'impulsion et secours manuel;
- alimentation et protections électriques des deux départs;
- choix, section, longueur, brochage et différenciation des connecteurs propriétaires (M12 recommandé ou option RJ45);
- réalisation des segments RS-485 indépendants, nombre d'interfaces disponibles et protocole applicatif;
- modèle d'écran, lisibilité du QR et comportement de l'application en cas de refus de caméra;
- qualification du délai réel d'affichage/scan du QR et du seuil de fréquence des préparations, compatible avec les cycles normaux;
- seuils mesurables des POC et méthode de mesure des délais et de la répétabilité;
- actifs de démonstration exacts et configuration des heures d'exploitation;
- fournisseur et topologie de déploiement;
- choix d'implémentation du JWT (algorithme autorisé et clés), puis tests des choix logiciels acceptés dans les ADR-004 à 007 et 009;
- estimation des stories de contrôle local et validation des jalons internes au regard du calendrier du cours;
- niveau de finition visuelle compatible avec la capacité disponible.

Ne restent pas ouverts : un hub avec deux cellules, une cellule par compartiment, l'étoile, une seule réservation active par technicien, une durée de réservation personnalisée bornée par l'horaire, les 120 secondes après autorisation et la nécessité d'une preuve corrective pour résoudre une anomalie.

Philippe a également validé le 23 septembre : JWT signé de 60 minutes sans
refresh token, Mosquitto/MQTT avec identités séparées et TLS pour le hub réel,
outbox PostgreSQL, polling REST limité aux opérations et QR de 60 secondes maximum
avec cinq secrets erronés maximum. Cette validation de conception ne constitue
pas une preuve d'implémentation ou de réussite des POC.

Chaque décision structurante et chaque résultat de POC sont consignés dans le cahier de conception ou un ADR. Aucune valeur proposée n'est présentée comme un résultat expérimental.

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
