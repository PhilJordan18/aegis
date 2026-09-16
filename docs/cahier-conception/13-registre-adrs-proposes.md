# Aegis — Registre et brouillons d’ADR

**Cours :** 420-5X7-SO — Écosystème connecté  
**Session :** Automne 2026  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Date :** 16 septembre 2026  
**Version :** 0.1 — propositions à arbitrer  
**Destination après validation :** un fichier par décision dans `docs/adr/`

---

## 1. Règle d’utilisation

Un ADR consigne une décision structurante difficile ou coûteuse à inverser. Il explique le contexte, les options et les conséquences; il ne duplique pas un contrat détaillé.

Statuts autorisés :

```text
PROPOSED → ACCEPTED → SUPERSEDED
              ↘ REJECTED
```

- `PROPOSED` : recommandation non encore approuvée par Philippe et Jimmy;
- `ACCEPTED` : décision applicable à l’implémentation;
- `REJECTED` : option étudiée mais non retenue;
- `SUPERSEDED` : remplacée par un nouvel ADR, sans réécrire l’historique.

---

## 2. Template d’ADR

```markdown
# ADR-NNN — Titre de la décision

**Date :** YYYY-MM-DD
**Statut :** PROPOSED | ACCEPTED | REJECTED | SUPERSEDED
**Décideurs :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa
**Documents liés :**

## Contexte

[Problème, contraintes et raison de décider maintenant.]

## Options considérées

1. [Option A]
2. [Option B]
3. [Option C]

## Décision

[Option choisie et règles précises.]

## Conséquences

### Positives
- [...]

### Négatives et risques
- [...]

## Validation

[Tests, mesure ou événement permettant de confirmer la décision.]

## Repli ou remplacement

[Fallback et condition de déclenchement.]
```

---

## 3. Registre priorisé

| ID | Décision | Statut initial | À trancher avant | Preuve attendue |
|---|---|---|---|---|
| ADR-001 | Autorité backend et monolithe modulaire | PROPOSED | Première implémentation | Revue d’architecture |
| ADR-002 | Hub maître et cellules RS-485 | PROPOSED | Fin semaine 6 | POC bus/alimentation |
| ADR-003 | RFID UHF local par cellule | PROPOSED | Fin semaine 6 | POC de localisation |
| ADR-004 | MQTT, QoS, sessions et disponibilité | PROPOSED | Walking skeleton | Tests contractuels broker |
| ADR-005 | Outbox transactionnelle et idempotence | PROPOSED | Première commande IoT | Test crash/redelivery |
| ADR-006 | Suivi des opérations par polling REST | PROPOSED | Écran de retrait | Test du parcours mobile |
| ADR-007 | Authentification P0 par jeton court | PROPOSED | Story IAM-01 | Tests de sécurité |
| ADR-008 | Sémantique de réservation et d’emprunt | PROPOSED | Story RES-01 | Tests concurrence/expiration |

Les ADR-002 et ADR-003 sont conditionnels aux POC. Les autres peuvent être approuvés dès la revue d’équipe si leurs conséquences sont acceptées.

---

## ADR-001 — Backend autoritaire dans un monolithe modulaire

**Statut :** PROPOSED  
**Documents liés :** scope v0.3, modèle logique, contrats REST/MQTT

### Contexte

Le système combine deux clients, une base et un locker connecté. Distribuer les décisions métier entre iOS, React et ESP32 créerait des états incohérents et rendrait l’audit impossible. Une équipe de deux personnes ne bénéficie pas d’une architecture microservices.

### Options considérées

1. Spring Boot monolithe modulaire, seule autorité métier.
2. Décisions partagées entre mobile, backend et ESP32.
3. Plusieurs microservices spécialisés.

### Décision recommandée

Retenir l’option 1. Spring Boot décide readiness, réservation, autorisation, confirmation du retrait/retour et anomalie. Les modules métier restent séparés dans le code, mais sont déployés ensemble. Web et iOS utilisent uniquement REST; le hub utilise uniquement MQTT et n’accorde aucun droit.

### Conséquences

- Positif : invariants transactionnels centralisés, déploiement et diagnostic plus simples.
- Négatif : le backend est requis pour toute nouvelle ouverture; aucune ouverture métier hors ligne en P0.
- Repli : aucun pour le P0; un changement exigerait un nouveau scope et un ADR de remplacement.

---

## ADR-002 — Hub maître et cellules adressables sur RS-485

**Statut :** PROPOSED — conditionné au POC  
**Documents liés :** scope §17.5, blueprint physique

### Contexte

Le concept produit exige un hub avec écran/réseau et des cellules empilables, une cellule correspondant à un compartiment. Il faut une liaison robuste, économique et extensible transportée avec l’alimentation dans un câble commun.

### Options considérées

1. Hub maître et bus RS-485 half-duplex multidrop.
2. Bus I²C ou UART logique sur les modules empilés.
3. Une connexion Wi-Fi/MQTT par cellule.
4. Un ESP32 unique câblé directement aux deux compartiments.

### Décision recommandée

Tester l’option 1. Le hub est l’unique maître; chaque cellule possède une adresse et répond à des trames courtes avec CRC. Les cellules n’utilisent ni IP ni MQTT. L’option 4 est le fallback P0.

### Conséquences

- Positif : modularité, câblage partagé, meilleure immunité au bruit.
- Négatif : contrôleur/transceiver par cellule, protocole local et budget supplémentaires.
- Validation : deux cellules, 100 cycles de communication, mesure de chute de tension, débranchement/reprise et déduplication d’ouverture.
- Repli : architecture monolithique si la fiabilité, le coût ou le calendrier échoue au plus tard fin semaine 6.

---

## ADR-003 — RFID UHF local par cellule comme preuve physique principale

**Statut :** PROPOSED — conditionné au POC  
**Documents liés :** scope §17.1–17.4, contrat MQTT §12, blueprint physique

### Contexte

Aegis doit identifier l’actif retiré ou retourné sans confondre les deux compartiments. Une lecture globale ne localise pas nécessairement le tag; l’absence de lecture ne prouve pas automatiquement l’absence.

### Options considérées

1. Lecteur/antenne RFID UHF local par cellule et tag unique par actif.
2. Un lecteur RFID commun au locker.
3. QR ou NFC pour l’identité, combiné au capteur de porte et à un capteur de présence/poids.

### Décision recommandée

Tester l’option 1. Le hub publie une fenêtre complète `RFID_SCAN_COMPLETED`; le backend transforme seulement une lecture stable et saine en observation métier. Le retour exige au moins trois lectures cohérentes du tag attendu. Le checkout exige, après fermeture, une fenêtre saine sans ce tag. L’absence d’un message n’est jamais une preuve.

### Conséquences

- Positif : expérience automatisée et observation localisée.
- Négatif : coût par cellule, interférences, orientation et matériaux à caractériser.
- Validation : matrice de tests de position/orientation, cellule voisine, tag externe, faux positifs/négatifs et durée de stabilisation.
- Repli : option 3 si la localisation n’est pas répétable au plus tard fin semaine 6.

---

## ADR-004 — MQTT 3.1.1 à livraison au moins une fois

**Statut :** PROPOSED  
**Documents liés :** contrat MQTT détaillé

### Contexte

Le locker doit recevoir des commandes et émettre des preuves sur un réseau pouvant se déconnecter. Le système ne peut pas supposer une livraison exactement une fois.

### Options considérées

1. MQTT 3.1.1 avec QoS 1 pour commandes/événements critiques, QoS 0 pour heartbeat et idempotence applicative.
2. QoS 2 partout.
3. HTTP direct du hub vers l’API.

### Décision recommandée

Retenir l’option 1. Utiliser trois topics versionnés `commands`, `events`, `status`; commandes non retained; présence `ONLINE/OFFLINE` retained; heartbeat toutes les 10 s; locker `OFFLINE` après plus de 30 s sans heartbeat valide; TLS et identifiants/ACL propres au device à distance.

### Conséquences

- Positif : reconnexion et redelivery explicites avec complexité contenue.
- Négatif : chaque consommateur doit dédupliquer; l’ordre global n’est pas garanti.
- Validation : tests d’ACL, doublon, message tardif, reconnexion, Last Will et commande expirée.

---

## ADR-005 — Outbox transactionnelle pour les commandes IoT

**Statut :** PROPOSED  
**Documents liés :** algorithmes, modèle PostgreSQL, contrats MQTT

### Contexte

Écrire une `LockerOperation` puis publier MQTT dans deux actions indépendantes crée une fenêtre où la base indique une commande qui n’a jamais été envoyée, ou inversement.

### Options considérées

1. Outbox enregistrée dans la même transaction PostgreSQL que l’opération, puis publication asynchrone.
2. Publication MQTT directe depuis la transaction HTTP.
3. Transaction distribuée entre PostgreSQL et le broker.

### Décision recommandée

Retenir l’option 1. Un worker publie les entrées non envoyées, enregistre les tentatives et accepte les redeliveries. `messageId`, `operationId`, la clé HTTP et les contraintes uniques empêchent tout second effet métier.

### Conséquences

- Positif : aucune commande métier validée n’est silencieusement perdue lors d’un crash.
- Négatif : table, worker, reprise et observabilité supplémentaires.
- Validation : provoquer un arrêt entre commit et publication, redémarrer puis vérifier une publication et un seul effet physique.

---

## ADR-006 — Polling REST pour suivre une opération P0

**Statut :** PROPOSED  
**Documents liés :** contrat REST §15

### Contexte

Le retrait et le retour sont asynchrones. Le mobile doit afficher la progression sans accéder au broker. WebSocket/SSE augmentent l’infrastructure et la gestion de reconnexion pour un faible volume P0.

### Options considérées

1. Polling de `GET /api/v1/locker-operations/{id}` environ chaque seconde jusqu’à un état terminal.
2. Server-Sent Events.
3. WebSocket.
4. MQTT direct depuis iOS/Web.

### Décision recommandée

Retenir l’option 1 pour le P0, avec backoff raisonnable en cas d’erreur, arrêt après état terminal ou expiration, puis rafraîchissement de la réservation, du prêt et de l’actif. L’option 4 reste interdite.

### Conséquences

- Positif : implémentation testable et identique pour les clients.
- Négatif : requêtes répétées et latence maximale proche de l’intervalle.
- Remplacement : SSE peut faire l’objet d’un ADR P1 si la mesure justifie le changement.

---

## ADR-007 — Jeton d’accès de 60 minutes pour les comptes P0

**Statut :** PROPOSED  
**Documents liés :** contrat REST §4, exigences de sécurité

### Contexte

Le P0 utilise des comptes préparés et n’exige ni inscription, ni SSO, ni récupération autonome. Il faut néanmoins authentifier Web/iOS sans stocker un mot de passe en clair ou exposer un jeton durable.

### Options considérées

1. Jeton bearer signé expirant après 60 minutes, sans refresh token P0.
2. Session serveur par cookie.
3. Jeton long terme stocké sur les clients.

### Décision recommandée

Retenir l’option 1. Stocker le jeton iOS dans Keychain et éviter une persistance navigateur non nécessaire. Hacher les mots de passe avec une fonction adaptée. L’expiration du jeton ne modifie jamais une réservation ou un prêt existant.

### Conséquences

- Positif : flux simple et durée d’exposition limitée.
- Négatif : reconnexion possible pendant une longue démonstration; révocation fine non couverte.
- Validation : tests d’expiration, mauvais rôle, mauvaise identité et absence de secret dans logs/configuration versionnée.

---

## ADR-008 — Réservation bornée par les horaires, prêt terminé uniquement par preuve

**Statut :** PROPOSED  
**Documents liés :** dictionnaire, machines à états, contrat REST §13–15

### Contexte

Une réservation fixe de 20 minutes ne représente pas l’usage réel d’un outil. À l’inverse, une réservation illimitée peut dépasser les heures d’exploitation. L’échéance de réservation ne doit jamais faire croire qu’un actif emprunté est revenu.

### Options considérées

1. L’utilisateur choisit une période entièrement comprise dans les heures configurées; une seule réservation active par utilisateur et par actif; le prêt reste ouvert jusqu’au retour physique confirmé.
2. Durée fixe de 20 minutes pour toute réservation.
3. Rendre automatiquement l’actif disponible à `expiresAt`, même après le retrait.

### Décision recommandée

Retenir l’option 1. `expiresAt` limite l’intention avant retrait. Après confirmation du checkout, le prêt et la disponibilité `BORROWED` deviennent la source d’autorité; dépasser l’heure attendue signale un retard, mais ne rend jamais l’actif réservable. Le retour exige une `LockerOperation RETURN` et une preuve physique cohérente.

### Conséquences

- Positif : disponibilité fidèle à la réalité et horaires administrables.
- Négatif : nécessite la gestion du fuseau, des fermetures et des prêts en retard.
- Validation : tests de frontière d’horaire, concurrence, expiration avant retrait et dépassement pendant un prêt.

---

## 4. Procédure de validation rapide

Pour chaque ADR, Philippe et Jimmy doivent :

1. lire le contexte et vérifier qu’il décrit le vrai problème;
2. ajouter toute option sérieuse manquante;
3. accepter, rejeter ou demander une mesure;
4. dater la décision;
5. déplacer le contenu dans `docs/adr/ADR-NNN-titre.md`;
6. ne jamais réécrire un ADR accepté pour masquer un changement : créer un ADR qui le remplace.

Les ADR-001, 004, 005, 006, 007 et 008 peuvent être arbitrés en une séance de 45 minutes. Les ADR-002 et 003 restent `PROPOSED` jusqu’aux résultats de POC.
