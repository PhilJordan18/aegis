# Aegis — Décisions d’architecture

**Cours :** 420-5X7-SO — Écosystème connecté  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Date de consignation :** 17 septembre 2026  
**Version :** 2.0 — registre opérationnel et décisions explicites  
**Références :** [scope](02-scope.md), documents 03–10 et [architecture physique](12-architecture-physique.md).

## 1. Portée et statuts

Ce document contient les ADRs du P0. Chaque fiche expose un choix, son coût, ses alternatives et sa vérification. Le statut d’une décision ne prouve pas que son implémentation fonctionne.

| Statut | Sens |
|---|---|
| `PROPOSED` | Option documentée, arbitrage restant avant l’implémentation concernée |
| `ACCEPTED` | Principe déjà retenu dans les décisions de projet, applicable dans le périmètre de la fiche |
| `REJECTED` | Proposition examinée et refusée |
| `SUPERSEDED` | Décision acceptée remplacée explicitement par une autre |

Une proposition peut être acceptée ou rejetée. Une décision acceptée peut ensuite être remplacée; sa révision ne doit pas effacer le motif d’origine. La date ci-dessus est celle de consignation, sans inventer de signature ou de date de réunion.

Le statut `ACCEPTED` des ADR-001, 002 et 008 consigne des principes déjà exprimés dans le scope et les échanges d’équipe. Il ne valide ni tous les paramètres des contrats, ni le matériel, ni l’ensemble de ce registre. Les autres fiches doivent être arbitrées par Philippe et Jimmy avant leur réalisation définitive.

## 2. Registre

| ADR | Objet | Statut | Pilote de l’arbitrage | Point de contrôle |
|---|---|---|---|---|
| 001 | Autorité Spring et monolithe modulaire | `ACCEPTED` | Philippe | Première tranche API |
| 002 | Hub et deux cellules en étoile | `ACCEPTED` pour la topologie | Jimmy | Réalisation électrique à décider après POC |
| 003 | Réalisation de la détection RFID locale | `PROPOSED`, POC requis | Jimmy | Avant de dépendre du capteur réel; cible interne S6 |
| 004 | Livraison MQTT, sessions et disponibilité | `PROPOSED` | Philippe, revue Jimmy | Walking skeleton |
| 005 | Outbox et idempotence | `PROPOSED` | Philippe | Première commande persistée |
| 006 | Suivi client par polling REST | `PROPOSED` | Philippe | Première interface d’opération |
| 007 | Authentification des comptes de démonstration | `PROPOSED` | Philippe | IAM-01 |
| 008 | Réservation, horaires et échéance du prêt | `ACCEPTED` | Philippe | RES-01 et transitions de prêt |
| 009 | Mise en œuvre du contrôle QR local | `PROPOSED`; principe intégré au scope | Philippe, revue Jimmy | LOC-01/02, avec essai écran/caméra anticipé |

Les pilotes préparent les preuves et recommandations; ils n’approuvent pas seuls un changement de scope. Les cibles pédagogiques sont précisées dans le document 14.

## ADR-001 — Spring comme autorité dans un monolithe modulaire

**Statut :** `ACCEPTED` — principe imposé par le scope.  
**Liens :** scope §7 et §16; modèles 04/08; contrats 09/10.

### Contexte et décision

Le projet relie deux clients, PostgreSQL et un dispositif physique. Spring Boot décide de la readiness, des réservations, de l’autorisation d’ouverture, des prêts et des anomalies. Les modules métier sont organisés par fonctionnalité dans un seul service déployable.

React et iOS utilisent l’API HTTPS. Le hub reçoit les commandes par MQTT et exécute les contrôles techniques de cible, d’expiration et de rejeu. Il n’accorde aucun droit métier. PostgreSQL protège les contraintes et les transactions.

### Alternatives et conséquences

Distribuer les décisions entre clients et firmware multiplierait les incohérences. Des microservices ajouteraient une exploitation disproportionnée pour deux personnes. Le monolithe réduit cette coordination, mais impose la disponibilité du backend pour toute nouvelle autorisation; l’ouverture métier hors ligne reste exclue du P0.

### Vérification

Un appel non autorisé est refusé côté serveur, même si l’interface est contournée. Un événement IoT ne crée un prêt qu’après validation des gardes de l’opération. Le firmware ne comporte aucune règle d’admissibilité de l’utilisateur.

## ADR-002 — Un hub et deux cellules reliées en étoile

**Statut :** `ACCEPTED` pour la topologie; réalisation électrique ouverte.  
**Liens :** scope §11.6 et §17.5; document 12.

### Contexte et décision

L’équipe a retenu un hub avec écran et deux cellules A1/A2. Une cellule correspond à un compartiment. Chaque cellule rejoint directement un port du hub par un câble dédié; une fixation mécanique en pile n’impose pas un bus électrique traversant.

La proposition actuelle de réalisation utilise des connecteurs RJ45 propriétaires et deux segments RS-485 indépendants. **Ce choix de composants, le brochage et le protocole local ne sont pas encore acceptés par cet ADR.** Une étoile passive avec les lignes A/B réunies n’est pas la réalisation proposée. RJ45 ne signifie ni Ethernet ni PoE.

### Alternatives et conséquences

Une chaîne de cellules économiserait des départs mais contredirait la topologie choisie. Deux départs facilitent le repérage et limitent les dépendances de câblage entre cellules; ils ajoutent des interfaces et des protections au hub. Un port supplémentaire exige une capacité électrique et logicielle supplémentaire.

### Vérification et repli

Jimmy présente un brochage, les composants, le budget complet, le courant d’actionnement et la tension mesurée dans chaque cellule. Les essais couvrent ciblage, déconnexion, reprise et défaut d’un départ. Si le POC dépasse les moyens disponibles, le repli du scope est un contrôleur pilotant directement deux compartiments. Le changement est consigné par un ADR de remplacement; deux cellules et le QR restent requis.

## ADR-003 — Identification RFID UHF locale par cellule

**Statut :** `PROPOSED` pour la réalisation et ses seuils; RFID local retenu comme premier choix à tester.  
**Liens :** scope §17.1–17.4; observation normalisée des documents 03/06/10; POC-01.

### Contexte et décision proposée

L’identité de l’actif doit être localisée dans la bonne cellule. Tester un lecteur/antenne local par cellule, avec un tag unique par actif. Une observation utilisable provient d’une fenêtre complète et saine; ni une coupure de lecteur ni un message manquant ne prouvent l’absence.

Les contrats actuels utilisent une fenêtre de stabilisation et des lectures cohérentes, dont un seuil initial de trois lectures pour la présence. Ces valeurs sont une base d’essai à mesurer, puis à harmoniser dans les documents 03–10 avant fixation. Le retrait et le retour restent conditionnés à la fermeture de porte et au contexte de l’opération.

### Alternatives et conséquences

Un lecteur global réduit certains coûts mais ne garantit pas la localisation. Le repli QR/NFC pour l’identité de l’actif, associé à une mesure de présence/poids et au capteur de porte, rend le parcours plus explicite. Le QR du hub destiné à autoriser l’ouverture n’est pas cette identification d’actif.

### Vérification et repli

Tester orientation, matériaux, cellule voisine, tag extérieur, retrait, retour et interruption du lecteur. Consigner faux positifs, faux négatifs et délai. Définir les seuils de conservation avant de conclure. Si les essais ne permettent pas une démonstration fiable dans le budget et la cible S6, déclencher le repli du scope. Le logiciel poursuit ses essais avec le simulateur pendant le POC.

## ADR-004 — MQTT avec doublons et reconnexion prévus

**Statut :** `PROPOSED`.  
**Liens :** document 10; FND-02, PHY-01, IOT-01/02, LOC-01.

### Contexte et décision proposée

Retenir la configuration MQTT 3.1.1 du contrat 10 : QoS 1 pour les messages critiques, QoS 0 pour le heartbeat, identités/ACL du device et TLS pour les communications distantes. Les commandes, défis et résultats transitoires ne sont pas retained. Le statut retained ne remplace pas la vérification de fraîcheur.

Le document 10 définit les sessions, les identifiants, le Last Will et la reprise. La base proposée est un heartbeat toutes les 10 secondes et `OFFLINE` après plus de 30 secondes sans heartbeat valide. Un QR relève aussi de la session courante du hub et d’un acquittement réel d’affichage.

### Alternatives et conséquences

QoS 2 partout ne supprimerait pas le besoin de gérer les répétitions métier et les reprises après crash. HTTP direct ne correspond pas au rail IoT retenu. La proposition exige une déduplication applicative, des délais et la gestion des événements tardifs; elle n’offre aucune garantie magique d’effet physique « exactement une fois ».

### Vérification

Tester ACL, mauvais device, redelivery, expiration, reconnexion, message retained ancien, redémarrage de session et perte d’acquittement. Aucun défi ancien ne doit permettre une ouverture après reprise.

## ADR-005 — Transactions, outbox et traitement idempotent

**Statut :** `PROPOSED`.  
**Liens :** documents 06/08/09/10; IOT-01, LOC-02, CHK-02, RET-02.

### Contexte et décision proposée

Un commit PostgreSQL et une publication MQTT sont deux opérations distinctes. Enregistrer la décision métier, l’entrée d’outbox et l’audit dans une même transaction, puis publier par un worker capable de reprendre après crash.

Lors de la validation QR, la consommation du défi et la création de la commande sont atomiques avec l’autorisation. Les données temporaires permettant l’affichage sont protégées selon le modèle 08; le token ne figure ni dans les réponses REST ni dans les journaux. Les clés HTTP, `messageId`, `operationId` et contraintes uniques portent la déduplication.

### Alternatives et conséquences

Publier directement pendant une requête HTTP laisse une fenêtre d’incohérence; une transaction distribuée serait trop lourde. L’outbox ajoute un worker, des reprises et de l’observabilité. Une publication peut se répéter : la protection contre une seconde impulsion reste aussi une responsabilité du firmware, y compris après redémarrage.

### Vérification

Interrompre le backend après commit et avant publication, puis après publication et avant marquage de l’outbox. Vérifier l’absence de perte silencieuse et de double transition. Tester deux scans simultanés, une commande tardive et la reprise du hub; un état physique incertain doit conduire au refus ou à une réconciliation, jamais à un rejeu aveugle.

## ADR-006 — Polling REST pendant les opérations

**Statut :** `PROPOSED`.  
**Liens :** document 09; interfaces CHK-01, LOC-02, LOAN-01, RET-01.

### Contexte et décision proposée

Les opérations sont asynchrones. Les clients interrogent `GET /api/v1/locker-operations/{id}` environ chaque seconde pendant une opération active, avec ralentissement en cas d’erreur et arrêt lorsqu’elle est terminale. Ils rafraîchissent ensuite réservation, prêt et actif.

### Alternatives et conséquences

SSE ou WebSocket ajoutent une gestion de connexion pour peu d’utilisateurs. MQTT direct depuis les clients est exclu. Le polling garde une intégration simple mais produit des requêtes répétées et une latence dépendant de l’intervalle. Les notifications push et le suivi permanent à haute fréquence ne sont pas nécessaires au P0.

### Vérification

Tester écran en arrière-plan, perte réseau, jeton expiré, reprise de consultation et arrêt du polling. Un message visuel de succès correspond à une décision du backend, pas à un simple accusé MQTT.

## ADR-007 — Jeton expirant pour les comptes préparés

**Statut :** `PROPOSED`.  
**Liens :** scope §11.1; document 09; IAM-01/02.

### Contexte et décision proposée

Retenir la proposition actuelle du contrat REST : jeton bearer signé de 60 minutes, sans refresh token P0, pour des comptes de démonstration préparés. Utiliser le mécanisme d’authentification du framework, le hachage adapté des mots de passe et des vérifications d’autorisation côté serveur. Le jeton iOS est conservé dans Keychain; aucune persistance navigateur durable n’est ajoutée sans justification.

### Alternatives et conséquences

Une session serveur par cookie demeure une alternative à arbitrer avant IAM-01. Un jeton long terme augmente l’exposition. La proposition réduit le parcours d’authentification à construire mais implique une reconnexion à expiration; elle ne fournit pas une gestion avancée des identités ou de la révocation.

### Vérification

Tester mot de passe erroné, jeton expiré ou falsifié, mauvais rôle et accès aux données d’un autre technicien. L’expiration de session ne termine aucun prêt et ne libère aucun actif. Consigner la décision de l’équipe avant de figer les clients.

## ADR-008 — Une réservation n’est pas la durée réelle de possession

**Statut :** `ACCEPTED` — règle demandée par l’équipe et intégrée au scope.  
**Liens :** documents 03–06, 08/09; CFG-02, RES-01/02, LOAN-01, RET-01/02.

### Contexte et décision

La réservation P0 est immédiate. Le technicien choisit `reservedUntil` dans la plage d’exploitation courante du locker. Il n’existe qu’une réservation active par technicien et par actif. Une réservation distante est possible; elle ne commande aucune serrure.

Lors du retrait confirmé, `Loan.dueAt` reprend `Reservation.reservedUntil`. L’échéance indique ensuite un retard éventuel, sans terminer le prêt. Un retrait autorisé avant l’échéance peut se terminer après celle-ci et créer un prêt déjà en retard.

Une réservation n’est pas libérée pendant un retrait physique encore actif ou incertain. Un tag réapparu sans retour confirmé ne termine pas le prêt. Le retour utilise une opération dédiée; ses gardes vérifient l’identité du titulaire et la situation physique, sans exiger la readiness d’emprunt d’un actif déjà `BORROWED`.

### Alternatives et conséquences

Une durée fixe de 20 minutes ne couvre pas les usages décrits. Libérer l’actif à l’échéance malgré un prêt ouvert rompt la chaîne de possession. Le choix retenu exige des horaires, un fuseau explicite et des états en retard visibles. Les réservations futures ou récurrentes restent hors P0.

### Vérification

Tester fermeture de la plage, réservation concurrente, expiration avant retrait, retrait en cours à l’échéance, prêt dépassé et actif endommagé au retour. Aucune de ces situations ne doit rendre réservable un actif encore détenu.

## ADR-009 — Défi QR temporaire avant chaque ouverture métier

**Statut :** `PROPOSED` pour la mise en œuvre et ses paramètres; le contrôle local figure déjà dans le scope.  
**Liens :** documents 02–10 et 12; LOC-01/02, CHK-01, RET-01.

### Contexte et décision proposée

Un compte valide peut préparer un retrait depuis un réseau distant. Exiger ensuite un QR dynamique affiché sur le hub, lié à l’utilisateur, à l’opération, au locker, à la cellule et à la session du device.

La préparation crée `AWAITING_LOCAL_PROOF`, sans commande de serrure. Le hub confirme l’affichage. Le mobile scanne puis soumet le défi par une route authentifiée; le backend revérifie les gardes, consomme le défi une seule fois et autorise atomiquement. Les **120 secondes physiques commencent alors**, pas au début de la préparation.

Les paramètres proposés sont un secret aléatoire de 256 bits, une validité maximale de 60 secondes bornée par les autres échéances, cinq essais erronés et une limitation des préparations selon les contrats. Ils doivent être arbitrés comme paramètres communs, sans variantes locales dans les clients ou le firmware.

### Alternatives et conséquences

Un QR statique est recopiable durablement. Une vérification anti-relais spécialisée ajoute une complexité hors démonstration. Le QR dynamique limite l’usage d’un code ancien mais une photo ou vidéo relayée reste possible : il ne prouve pas absolument la présence de l’humain et n’est pas présenté comme une authentification multifacteur.

L’écran, son pilote et la caméra iOS deviennent des dépendances P0. Les coûts touchent backend, DB, MQTT, firmware, simulateur, iOS et tests. Le périmètre de l’écran reste limité au QR, aux consignes et au résultat. Cette limitation ne constitue pas, à elle seule, une économie d’heures mesurée.

### Vérification

Tester préparation distante sans scan, mauvais compte, QR faux/ancien, double scan, droits modifiés après affichage, écran défaillant, redémarrage et acquittement perdu. Aucune commande ne part avant consommation valide. Le QR ne remplace pas la fermeture de porte ni l’observation de l’actif pour confirmer le prêt.

La liaison du contrôle à la transaction et son usage unique s’appuient sur les principes de l’[OWASP Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html). Les risques de transfert d’un code d’appareil sont illustrés par le [RFC 8628, §5.4](https://www.rfc-editor.org/rfc/rfc8628.html#section-5.4); Aegis n’implémente pas ce protocole OAuth.

## 3. Conservation des décisions

Ce fichier constitue le registre de référence actuel. Il peut être conservé tel quel dans le cahier de conception; il n’est pas nécessaire de créer neuf fichiers vides supplémentaires. Si les ADRs sont ensuite séparés dans `docs/adr/`, remplacer les fiches ici par des liens pour éviter deux textes normatifs concurrents.

Une validation ajoute le décideur, la date réelle, la justification et la preuve disponible. Un changement incompatible crée une nouvelle décision qui cite celle qu’il remplace. L’état des tâches et leur affectation restent dans le backlog; l’ADR explique le choix architectural.
