# Aegis — Décisions d’architecture

**Cours :** 420-5X7-SO — Écosystème connecté  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Date de consignation :** 17 septembre 2026  
**Version :** 2.0 — registre opérationnel et décisions explicites  
**Mise à jour :** 23 septembre 2026 — ADR-011 et validation des choix logiciels 004 à 007 et 009
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

Le statut `ACCEPTED` des ADR-001, 002, 008 et 010 consigne des principes déjà exprimés dans le scope et les échanges d’équipe. Il ne valide ni tous les paramètres des contrats ni le matériel. Les fiches ou paramètres encore proposés restent à arbitrer avant la réalisation concernée. L’ADR-010 est conservé dans son fichier détaillé sous `docs/adr/` afin de ne pas dupliquer deux textes normatifs.

Le 23 septembre, Philippe valide explicitement les choix logiciels des ADR-004,
005, 006, 007 et 009 après comparaison des options. Cette validation n’invente
ni une signature de Jimmy ni des résultats d’essais. Les paramètres électriques,
les POC matériels et le seuil numérique de fréquence des préparations QR restent
à qualifier; les mécanismes retenus peuvent désormais guider le développement.

## 2. Registre

| ADR | Objet | Statut | Pilote de l’arbitrage | Point de contrôle |
|---|---|---|---|---|
| 001 | Autorité Spring et monolithe modulaire | `ACCEPTED` | Philippe | Première tranche API |
| 002 | Hub et deux cellules en étoile, segments RS-485 indépendants | `ACCEPTED` pour l’architecture | Jimmy | Réalisation électrique à qualifier après POC |
| 003 | Réalisation de la détection RFID locale | `PROPOSED`, POC requis | Jimmy | Avant de dépendre du capteur réel; cible interne S6 |
| 004 | Mosquitto, livraison MQTT, identités et disponibilité | `ACCEPTED` — Philippe, 23 septembre | Philippe, essais hub avec Jimmy | Walking skeleton et tests TLS/ACL |
| 005 | Outbox et idempotence | `ACCEPTED` — Philippe, 23 septembre | Philippe | Première commande persistée |
| 006 | Suivi client par polling REST | `ACCEPTED` — Philippe, 23 septembre | Philippe | Première interface d’opération |
| 007 | JWT expirant pour les comptes préparés | `ACCEPTED` — Philippe, 23 septembre | Philippe | IAM-01 |
| 008 | Réservation, horaires et échéance du prêt | `ACCEPTED` | Philippe | RES-01 et transitions de prêt |
| 009 | Contrôle QR local, 60 s maximum et 5 secrets erronés | `ACCEPTED` — Philippe, 23 septembre; seuil de fréquence à qualifier | Philippe, essais avec Jimmy | LOC-01/02 et essai écran/caméra |
| 010 | [Monorepo commun pour les composants du P0](../adr/ADR-010-architecture-monorepo.md) | `ACCEPTED` | Équipe | Structure initiale et première évolution transversale |
| 011 | [Évolution de l’estimation matérielle](../adr/ADR-011-evolution-estimation-materielle.md) | `ACCEPTED`, clarification demandée par Philippe; aucun achat approuvé | Philippe, achats à revoir avec Jimmy | Nomenclature complète; décision financière après inventaire et POC |

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

**Statut :** `ACCEPTED` pour l’architecture, incluant les segments RS-485 indépendants; réalisation électrique ouverte.
**Liens :** [ADR-002 détaillé](../adr/ADR-002-etoile-rs485.md), référence de la décision; scope §11.6 et §17.5; document 12.

### Contexte et décision

L’équipe a retenu un hub avec écran et deux cellules A1/A2. Une cellule correspond à un compartiment. Chaque cellule rejoint directement un port du hub par un câble dédié; une fixation mécanique en pile n’impose pas un bus électrique traversant.

Le fichier détaillé accepte deux segments RS-485 indépendants. La proposition actuelle de réalisation recommande des connecteurs M12 codés A à 5 contacts; le RJ45 propriétaire demeure une option initiale de repli économique. **Le connecteur, les références, le brochage, les protections et le protocole local ne sont pas encore acceptés par cet ADR.** Une étoile passive avec les lignes A/B réunies n’est pas retenue.

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

**Statut :** `ACCEPTED` — Philippe, 23 septembre 2026; implémentation non testée.
**Liens :** document 10; FND-02, PHY-01, IOT-01/02, LOC-01.

### Contexte et décision

Retenir Mosquitto local et la configuration MQTT 3.1.1 du contrat 10 : QoS 1 pour les messages critiques, QoS 0 pour le heartbeat, compte backend distinct et identifiant/secret unique par hub avec ACL limitées à son casier. TLS avec validation du certificat est obligatoire pour le hub réel, même au laboratoire. Le `clientId` n’est pas un secret d’authentification. Le mTLS reste une évolution possible, pas une exigence P0. Les commandes, défis et résultats transitoires ne sont pas retained. Le statut retained ne remplace pas la vérification de fraîcheur.

Le document 10 définit les sessions, les identifiants, le Last Will et la reprise. La base retenue est un heartbeat toutes les 10 secondes et `OFFLINE` après plus de 30 secondes sans heartbeat valide. Un QR relève aussi de la session courante du hub et d’un acquittement réel d’affichage.

### Alternatives et conséquences

QoS 2 partout ne supprimerait pas le besoin de gérer les répétitions métier et les reprises après crash. HTTP direct ne correspond pas au rail IoT retenu. Le choix exige une déduplication applicative, des délais et la gestion des événements tardifs; il n’offre aucune garantie d’effet physique « exactement une fois » par le transport seul.

### Vérification

Tester ACL, mauvais device, redelivery, expiration, reconnexion, message retained ancien, redémarrage de session et perte d’acquittement. Aucun défi ancien ne doit permettre une ouverture après reprise.

## ADR-005 — Transactions, outbox et traitement idempotent

**Statut :** `ACCEPTED` — Philippe, 23 septembre 2026; implémentation non testée.
**Liens :** documents 06/08/09/10; IOT-01, LOC-02, CHK-02, RET-02.

### Contexte et décision

Un commit PostgreSQL et une publication MQTT sont deux opérations distinctes. Enregistrer la décision métier, l’entrée d’outbox et l’audit dans une même transaction, puis publier par un worker capable de reprendre après crash.

L’outbox est une table PostgreSQL traitée par une tâche du monolithe Spring,
pas un nouveau service ni une nouvelle infrastructure. Le dispatcher conserve
les identifiants lors des reprises et n’envoie pas une commande devenue
inexécutable; il applique la règle d’expiration et de réconciliation du contrat.
Un accusé du broker atteste le transport, pas l’exécution physique.

Lors de la validation QR, la consommation du défi et la création de la commande sont atomiques avec l’autorisation. Les données temporaires permettant l’affichage sont protégées selon le modèle 08; le token ne figure ni dans les réponses REST ni dans les journaux. Les clés HTTP, `messageId`, `operationId` et contraintes uniques portent la déduplication.

### Alternatives et conséquences

Publier directement pendant une requête HTTP laisse une fenêtre d’incohérence; une transaction distribuée serait trop lourde. L’outbox ajoute un worker, des reprises et de l’observabilité. Une publication peut se répéter : la protection contre une seconde impulsion reste aussi une responsabilité du firmware, y compris après redémarrage.

### Vérification

Interrompre le backend après commit et avant publication, puis après publication et avant marquage de l’outbox. Vérifier l’absence de perte silencieuse et de double transition. Tester deux scans simultanés, une commande tardive et la reprise du hub; un état physique incertain doit conduire au refus ou à une réconciliation, jamais à un rejeu aveugle.

## ADR-006 — Polling REST pendant les opérations

**Statut :** `ACCEPTED` — Philippe, 23 septembre 2026; comportement à tester.
**Liens :** document 09; interfaces CHK-01, LOC-02, LOAN-01, RET-01.

### Contexte et décision

Les opérations sont asynchrones. Les clients interrogent `GET /api/v1/locker-operations/{id}` environ chaque seconde pendant une opération active, avec ralentissement en cas d’erreur et arrêt lorsqu’elle est terminale. Ils rafraîchissent ensuite réservation, prêt et actif.

Il n’y a qu’une requête de suivi en vol par opération. Le suivi est suspendu
quand l’application n’est plus active et reprend par une lecture immédiate au
retour au premier plan. Une interruption du client ne suspend ni les délais ni
le traitement serveur. Aucun polling permanent à une seconde n’est imposé au
catalogue ou au profil. SSE sera réévalué seulement si les mesures le justifient.

### Alternatives et conséquences

SSE ou WebSocket ajoutent une gestion de connexion pour peu d’utilisateurs. MQTT direct depuis les clients est exclu. Le polling garde une intégration simple mais produit des requêtes répétées et une latence dépendant de l’intervalle. Les notifications push et le suivi permanent à haute fréquence ne sont pas nécessaires au P0.

### Vérification

Tester écran en arrière-plan, perte réseau, jeton expiré, reprise de consultation et arrêt du polling. Un message visuel de succès correspond à une décision du backend, pas à un simple accusé MQTT.

## ADR-007 — Jeton expirant pour les comptes préparés

**Statut :** `ACCEPTED` — Philippe, 23 septembre 2026; implémentation non testée.
**Liens :** scope §11.1; document 09; IAM-01/02.

### Contexte et décision

Retenir un JWT signé présenté comme bearer, valable 60 minutes, sans refresh token P0, pour les deux clients et les comptes préparés. Utiliser Spring Security pour la validation, un hachage adapté des mots de passe et des vérifications d’autorisation côté serveur. Le jeton iOS est conservé dans Keychain et le jeton Web en mémoire, sans localStorage ni sessionStorage. L’algorithme autorisé et la gestion des clés seront documentés au bootstrap; les clients ne dépendent pas du contenu interne du jeton.

### Alternatives et conséquences

Une session serveur ou un jeton opaque seraient compatibles avec l’API et
faciliteraient la révocation centrale. Le JWT n’est pas choisi parce qu’un mobile
l’imposerait, mais pour conserver un mécanisme commun aligné sur les contrats.
Le compromis accepté est une reconnexion après expiration ou rechargement du Web
et l’absence de révocation immédiate d’une copie de jeton à la déconnexion locale.
L’état actif du compte, son rôle et ses droits courants sont vérifiés sur les
requêtes protégées; les gardes métier sont revérifiées avant les actions sensibles.
Les claims ne dispensent pas de ces contrôles. Aucune gestion avancée des
identités ni deuxième mécanisme Web distinct n’est ajouté au P0.

### Vérification

Tester mot de passe erroné, jeton expiré ou falsifié, mauvais rôle, droits modifiés et accès aux données d’un autre technicien. L’expiration de session ne termine aucun prêt, ne libère aucun actif et n’interrompt pas une opération physique déjà autorisée : la reconnexion permet de relire son état.

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

**Statut :** `ACCEPTED` — Philippe, 23 septembre 2026, pour le mécanisme, les 60 s maximum et les 5 secrets erronés; seuil de fréquence à qualifier.
**Liens :** documents 02–10 et 12; LOC-01/02, CHK-01, RET-01.

### Contexte et décision

Un compte valide peut préparer un retrait depuis un réseau distant. Exiger ensuite un QR dynamique affiché sur le hub, lié à l’utilisateur, à l’opération, au locker, à la cellule et à la session du device.

La préparation crée `AWAITING_LOCAL_PROOF`, sans commande de serrure. Le hub confirme l’affichage. Le mobile scanne puis soumet le défi par une route authentifiée; le backend revérifie les gardes, consomme le défi une seule fois et autorise atomiquement. Les **120 secondes physiques commencent alors**, pas au début de la préparation.

La base des contrats utilise un secret aléatoire de 256 bits. La validité retenue
est de 60 secondes maximum après création, bornée par l’horaire et la réservation
applicable, avec au plus cinq secrets erronés soumis par l’initiateur. La lecture
caméra sans soumission ne consomme pas un essai. Le technicien prépare le défi
lorsqu’il est devant le casier, et non au moment de sa réservation distante;
cela ne constitue pas une preuve de géolocalisation. La latence d’affichage
consomme une partie de la fenêtre et doit être mesurée.

La proposition antérieure de trois préparations par utilisateur/casier en quinze
minutes est abandonnée : elle peut bloquer le deuxième retour d’une série
normale. Une limitation des préparations reste obligatoire, configurable par
utilisateur et casier, sans recompter les rejeux idempotents; sa valeur sera
qualifiée sur les cycles normaux et les essais d’abus. Une seule opération active
par casier reste autorisée. Aucun réglage de démonstration ne désactive les
contrôles de secret, d’expiration, de propriétaire ou de consommation unique.

### Alternatives et conséquences

Un QR statique est recopiable durablement. Une vérification anti-relais spécialisée ajoute une complexité hors démonstration. Le QR dynamique limite l’usage d’un code ancien mais une photo ou vidéo relayée reste possible : il ne prouve pas absolument la présence de l’humain et n’est pas présenté comme une authentification multifacteur.

L’écran, son pilote et la caméra iOS deviennent des dépendances P0. Les coûts touchent backend, DB, MQTT, firmware, simulateur, iOS et tests. Le périmètre de l’écran reste limité au QR, aux consignes et au résultat. Cette limitation ne constitue pas, à elle seule, une économie d’heures mesurée.

### Vérification

Tester préparation distante sans scan, mauvais compte, QR faux/ancien, double scan, droits modifiés après affichage, écran défaillant, redémarrage et acquittement perdu. Aucune commande ne part avant consommation valide. Le QR ne remplace pas la fermeture de porte ni l’observation de l’actif pour confirmer le prêt.

Qualifier le seuil de fréquence avant intégration : dix retraits et dix retours
successifs selon une cadence représentative ne doivent pas être bloqués par un
plafond arbitraire, tandis qu’une rafale abusive doit produire un refus borné
avec `Retry-After`. Les résultats restent à produire.

La liaison du contrôle à la transaction et son usage unique s’appuient sur les principes de l’[OWASP Transaction Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Transaction_Authorization_Cheat_Sheet.html). Les risques de transfert d’un code d’appareil sont illustrés par le [RFC 8628, §5.4](https://www.rfc-editor.org/rfc/rfc8628.html#section-5.4); Aegis n’implémente pas ce protocole OAuth.

## 3. Conservation des décisions

Ce fichier constitue le registre de référence actuel. Il peut être conservé tel quel dans le cahier de conception; il n’est pas nécessaire de créer neuf fichiers vides supplémentaires. Si les ADRs sont ensuite séparés dans `docs/adr/`, remplacer les fiches ici par des liens pour éviter deux textes normatifs concurrents.

Une validation ajoute le décideur, la date réelle, la justification et la preuve disponible. Un changement incompatible crée une nouvelle décision qui cite celle qu’il remplace. L’état des tâches et leur affectation restent dans le backlog; l’ADR explique le choix architectural.
