# Aegis — User Story Map et backlog P0

**Cours :** 420-5X7-SO — Écosystème connecté  
**Session :** Automne 2026  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Date :** 16 septembre 2026  
**Version :** 1.0 — proposition à valider en équipe  
**Références :** `scope.md` v0.3 et documents de conception 03 à 10

---

## 1. But du document

Cette Story Map ordonne le P0 selon le parcours réel des utilisateurs. Elle sert à :

- garder la promesse « prêt, conforme et traçable » au centre du développement;
- découper le MVP en tranches verticales démontrables;
- transformer le scope en backlog priorisé;
- éviter qu’une plateforme soit développée longtemps sans intégration;
- préparer les itérations sans traiter les estimations comme des engagements fixes.

La carte ne remplace ni les contrats REST/MQTT ni les règles métier. Une story est terminée seulement si elle respecte les documents 03 à 10.

---

## 2. Template réutilisable

### 2.1 Structure

| Niveau | Question | Format attendu |
|---|---|---|
| Activité | Quelle grande étape du parcours accomplit l’acteur? | Verbe large : « Réserver un actif » |
| Tâche | Que fait concrètement l’acteur dans cette étape? | Action observable : « Choisir une période » |
| Story | Quelle valeur livrable peut être testée? | « En tant que…, je veux…, afin de… » |
| Critères | Comment prouver que la story fonctionne? | Conditions vérifiables, positives et négatives |
| Tranche | Dans quelle release démontrable entre-t-elle? | Walking skeleton, P0.1, P0.2, etc. |

### 2.2 Carte vierge

Copier une ligne par activité du parcours.

| Activité du parcours | Tâches utilisateur | Tranche minimale | Stories suivantes | Hors tranche / plus tard |
|---|---|---|---|---|
| `[activité]` | `[tâche 1]`, `[tâche 2]` | `[story indispensable]` | `[stories d’enrichissement]` | `[P1/P2]` |

### 2.3 Fiche de story

```markdown
## [ID] — [Titre orienté résultat]

En tant que [acteur],
je veux [capacité],
afin de [valeur].

### Critères d’acceptation

- Étant donné [contexte], lorsque [action], alors [résultat observable].
- Étant donné [cas de refus], lorsque [action], alors [erreur stable et aucun effet métier].
- Une répétition ou un doublon ne produit pas un second effet métier.

### Impacts

- Composants :
- Contrats :
- Données/migration :
- Sécurité :
- Tests :

### Dépendances

- [ID ou décision]

### Estimation initiale

- [1, 2, 3 ou 5 points]
```

Une story estimée à 8 points ou plus doit être redécoupée avant son entrée en itération.

---

## 3. Backbone du parcours Aegis

| # | Activité | Résultat attendu |
|---:|---|---|
| 1 | Préparer l’accès | Les comptes et autorisations de démonstration sont utilisables. |
| 2 | Configurer les actifs et le locker | Chaque actif est identifiable, placé et soumis aux bonnes règles. |
| 3 | Évaluer la readiness | Le technicien sait quel actif est réellement admissible et pourquoi. |
| 4 | Réserver | Une période valide protège un actif pour un seul technicien. |
| 5 | Retirer | Une commande autorisée et une preuve physique créent le prêt. |
| 6 | Suivre la possession | Aegis indique qui détient l’actif et depuis quand. |
| 7 | Retourner | Une preuve physique cohérente termine le prêt. |
| 8 | Superviser et corriger | L’administrateur comprend les événements et traite les anomalies. |

---

## 4. Story Map P0 préremplie

| Activité | Tâches P0 | Première tranche utile | Complément P0 | P1/P2 exclu |
|---|---|---|---|---|
| Préparer l’accès | Se connecter; charger son profil; appliquer rôle et niveau d’accès | Comptes préparés, login, autorisation serveur | Expiration du jeton et audit des refus | Inscription, SSO, récupération de mot de passe |
| Configurer | Créer modèle et actif; associer tag RFID; affecter une cellule; définir calibration, état, accès et horaires | Deux actifs et deux cellules configurables | Archivage sûr, historique de placement | Import massif, multi-site, workflow complet de calibration |
| Évaluer | Chercher; consulter détail; voir `READY`, `BLOCKED` ou `UNKNOWN`; comprendre la raison | Readiness calculée par l’API | Mise à jour après observation et affichage Web/iOS | Moteur de règles générique, recommandations IA |
| Réserver | Choisir une fin; vérifier les horaires; créer; consulter; annuler | Une réservation active par technicien et par actif | Expiration, concurrence et idempotence | Réservations récurrentes, file d’attente |
| Retirer | Demander l’accès; suivre l’opération; ouvrir la bonne cellule; retirer; fermer | Commande corrélée et simulateur IoT | ACK, preuve RFID locale, création transactionnelle du prêt | Ouverture hors ligne, accès direct mobile-locker |
| Suivre | Voir le prêt actif; voir l’actif emprunté | Chaîne de possession visible | Retard visible sans rendre l’actif réservable | Notifications et historique mobile détaillé |
| Retourner | Demander le retour; déposer; fermer; suivre la confirmation | Opération `RETURN` corrélée | Preuve RFID, prêt complété, actif à nouveau disponible | Retour dans un autre locker |
| Superviser | Voir locker/portes; consulter réservations, prêts, audit et anomalies | Statut et chronologie minimale | Déduplication, expiration, refus et résolution par nouvelle preuve | Analytics avancées, exports et tableaux de bord |

---

## 5. Tranches verticales de livraison

### P0.0 — Walking skeleton

Prouver le chemin Web/iOS → API → PostgreSQL et API ↔ MQTT ↔ simulateur, sans logique complète de retrait.

**Démonstration :** les clients lisent un statut fourni par l’API; un heartbeat authentifié met à jour le locker; PostgreSQL et MQTT ne sont jamais joints directement par les clients.

### P0.1 — Actif prêt et réservable

Livrer identité, catalogue, placement, présence, horaires, readiness et réservation.

**Démonstration :** A1 est `READY`, A2 est `BLOCKED` pour calibration expirée; A1 peut être réservé dans les heures d’exploitation, A2 ne peut pas l’être.

### P0.2 — Retrait et chaîne de possession

Livrer la commande d’ouverture, l’ACK, les observations de porte/RFID et la création du prêt.

**Démonstration :** un retrait confirmé physiquement transforme la réservation en prêt sans modification manuelle de la base.

### P0.3 — Retour, anomalies et robustesse

Livrer le retour confirmé, les refus, l’expiration, les anomalies, la déduplication et la piste d’audit.

**Démonstration :** le retour termine le prêt; un doublon n’a aucun second effet; une preuve incohérente crée une anomalie qui ne peut être résolue sans preuve corrective.

---

## 6. Backlog P0 priorisé

Les points sont des estimations relatives initiales. Ils servent à comparer la complexité, pas à convertir automatiquement une story en heures. La vélocité ne sera fixée qu’après deux itérations observées.

### 6.1 Risques et fondations

| ID | Story / enabler | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| POC-01 | Valider la lecture RFID UHF locale par cellule | Le bon tag est détecté dans la bonne cellule selon plusieurs orientations; faux positifs/négatifs et délai de stabilisation sont mesurés; le fallback est déclenchable selon un seuil écrit. | Matériel RFID | Hub, cellule, docs | 3 |
| POC-02 | Valider le bus hub-cellules | Deux cellules adressées répondent sur un seul câble alimentation/données; chute de tension, reconnexion et débranchement sont mesurés; le fallback monolithique est documenté. | Blueprint physique | Hub, cellules, docs | 3 |
| FND-01 | Lancer l’environnement local reproductible | Une commande documentée démarre PostgreSQL et le broker; aucun secret réel n’est committé; PostgreSQL n’est pas exposé publiquement. | Aucune | Infra | 3 |
| FND-02 | Prouver le walking skeleton | `GET /api/v1/system/health` répond; une migration Flyway s’applique; un heartbeat du simulateur est ingéré; le Web et iOS lisent uniquement l’API. | FND-01 | API, DB, MQTT, Web, iOS, simulateur | 5 |

### 6.2 Identité et configuration

| ID | Story | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| IAM-01 | Se connecter avec un compte de démonstration | Un compte valide reçoit un jeton de 60 minutes; un mot de passe invalide est refusé sans fuite d’information; les mots de passe sont hachés. | FND-02, ADR auth | API, DB, Web, iOS | 3 |
| IAM-02 | Protéger les actions selon le rôle et le niveau d’accès | `ADMIN` et `TECHNICIAN` sont vérifiés côté serveur; un technicien ne lit jamais les données privées d’un autre; `STANDARD` ne permet pas un actif `RESTRICTED`. | IAM-01 | API, tests | 3 |
| CAT-01 | Gérer un modèle et deux actifs | L’administrateur crée/modifie un modèle et ses exemplaires; un actif archivé conserve son historique; les validations sont explicites. | IAM-02 | API, DB, Web | 3 |
| CAT-02 | Associer identité physique et cellule | Un tag actif n’appartient qu’à un actif; un placement courant n’associe qu’un actif à une cellule; une mutation conflictuelle est refusée. | CAT-01 | API, DB, Web | 5 |
| CFG-01 | Définir les règles de l’actif | L’administrateur fixe état opérationnel, calibration et niveau requis; les changements sont audités. | CAT-01 | API, DB, Web | 3 |
| CFG-02 | Définir les heures d’exploitation | L’administrateur configure l’horaire du locker; une période traversant une fermeture est refusée; le fuseau horaire est explicite. | CAT-01 | API, DB, Web | 3 |

### 6.3 Présence, readiness et réservation

| ID | Story | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| PHY-01 | Connaître l’état du locker et de ses cellules | Heartbeat toutes les 10 s; `ONLINE` si le dernier heartbeat valide a au plus 30 s; portes et erreurs sont visibles; un heartbeat ne change aucun prêt. | FND-02 | Hub/simulateur, MQTT, API, DB, Web | 3 |
| PHY-02 | Transformer un scan RFID en observation normalisée | Le payload brut est conservé; seules des lectures stables et saines deviennent présence/absence; une absence de message ne prouve jamais l’absence. | POC-01, PHY-01 | Hub, MQTT, API, DB | 5 |
| RDY-01 | Calculer la readiness pour un technicien | Présence, disponibilité, état, calibration et accès sont évalués; résultat et raisons sont déterministes; l’état n’est pas un booléen éditable. | IAM-02, CFG-01, PHY-02 | API, DB, tests | 5 |
| RDY-02 | Consulter les actifs et leurs raisons | Web et iOS affichent le même résultat fourni par l’API; A2 expiré est `BLOCKED/CALIBRATION_EXPIRED`; aucun identifiant RFID brut n’est exposé au technicien. | RDY-01 | API, Web, iOS | 5 |
| RES-01 | Réserver un actif admissible pour une période | La fin est choisie dans les heures d’exploitation; un technicien et un actif n’ont chacun qu’une réservation active; deux requêtes concurrentes créent exactement une réservation. | RDY-01, CFG-02 | API, DB, iOS | 5 |
| RES-02 | Consulter, annuler et expirer la réservation | Le technicien ne voit que la sienne; l’annulation est idempotente; l’expiration libère l’actif seulement avant le retrait, jamais pendant un prêt. | RES-01 | API, DB, iOS, jobs | 3 |

### 6.4 Rail IoT et retrait

| ID | Story | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| IOT-01 | Publier une commande de façon fiable | La création métier et l’outbox sont atomiques; la commande comporte identifiants, expiration et schéma; une commande n’est jamais retained. | FND-02, ADR outbox | API, DB, MQTT | 5 |
| IOT-02 | Exécuter et accuser une commande une seule fois | Le hub vérifie cible/expiration; ouvre une seule cellule; renvoie `COMMAND_ACKNOWLEDGED` ou `COMMAND_REJECTED`; un redelivery ne réactive pas la serrure. | POC-02, IOT-01 | Hub/simulateur, MQTT | 5 |
| CHK-01 | Demander le retrait d’une réservation valide | L’API revérifie horaire, réservation, readiness et locker; crée une opération de 120 s; une opération non terminale bloque une seconde ouverture. | RES-01, PHY-01, IOT-01 | API, DB, iOS | 5 |
| CHK-02 | Confirmer le retrait et créer le prêt | ACK, ouverture, fermeture et scan sain sans tag attendu sont corrélés; réservation et opération sont confirmées et prêt créé dans une transaction; incohérence = anomalie. | CHK-01, IOT-02, PHY-02 | API, DB, MQTT, iOS, Web | 5 |
| LOAN-01 | Consulter la chaîne de possession active | Le technicien et l’administrateur voient titulaire, actif et début; l’échéance dépassée ne rend pas l’actif disponible; un actif n’a jamais deux prêts ouverts. | CHK-02 | API, DB, iOS, Web | 3 |

### 6.5 Retour, audit et qualité

| ID | Story | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| RET-01 | Initier le retour du prêt actif | Seul le titulaire ou le flux autorisé vise le prêt ouvert; la bonne cellule est ciblée; une opération `RETURN` de 120 s est créée. | LOAN-01, IOT-01 | API, DB, iOS | 3 |
| RET-02 | Confirmer physiquement le retour | Après fermeture, un scan sain contient au moins trois lectures cohérentes du tag attendu; le prêt passe à `COMPLETED`; l’actif redevient disponible seulement après cette transaction. | RET-01, IOT-02, PHY-02 | API, DB, MQTT, iOS, Web | 5 |
| ANO-01 | Créer et traiter une anomalie | Une divergence attendue/observée crée une anomalie; l’administrateur peut la reconnaître; elle n’est résolue qu’après preuve corrective ou action métier vérifiable. | CHK-02 ou RET-02 | API, DB, Web | 5 |
| AUD-01 | Reconstruire une opération | La chronologie relie utilisateur, réservation/prêt, commande, ACK, porte, RFID et résultat; horodatages et corrélation sont lisibles par l’administrateur. | CHK-02, RET-02 | API, DB, Web | 5 |
| QUA-01 | Résister aux doublons, expirations et redémarrages | Même `messageId` = un traitement; même clé HTTP = même résultat; une opération expirée ne confirme rien; un redémarrage retrouve un état cohérent. | Flux complets | Tous | 5 |
| DEM-01 | Prouver la répétabilité du P0 | 10 retraits + 10 retours consécutifs; aucune modification manuelle SQL; aucun double effet; procédure et résultats sont consignés. | Toutes les stories P0 | Tous | 5 |

---

## 7. Ordre recommandé et dépendances critiques

```mermaid
flowchart LR
    A["POC + fondations"] --> B["Identité + configuration"]
    B --> C["Présence + readiness"]
    C --> D["Réservation"]
    D --> E["Retrait + prêt"]
    E --> F["Retour + robustesse"]
```

Les POC matériels avancent en parallèle des fondations logicielles. La décision RFID et la décision hub/cellules doivent être prises au plus tard à la fin de la semaine 6; sinon, le fallback devient le plan P0 afin de protéger le gel fonctionnel de la semaine 12.

---

## 8. Definition of Ready d’une story

Une story peut entrer en itération lorsque :

- sa valeur et son acteur sont clairs;
- ses critères d’acceptation sont testables;
- ses dépendances et contrats touchés sont identifiés;
- aucune question structurante non résolue ne bloque son implémentation;
- elle tient dans une itération et vaut au plus 5 points;
- un propriétaire principal et un réviseur sont nommés.

## 9. Definition of Done d’une story

Une story est terminée lorsque :

- le comportement nominal et les refus prévus fonctionnent;
- les tests pertinents réussissent et leur commande est connue;
- les migrations et contrats sont cohérents;
- aucun secret ni accès direct interdit n’est introduit;
- les doublons et erreurs réseau pertinents ont été considérés;
- le second membre a relu le changement;
- la story est intégrée et démontrable depuis une version commune du monorepo;
- la documentation touchée correspond au comportement réel.

---

## 10. Règles de gestion du backlog

1. Une seule story active par personne; WIP maximal de deux stories pour l’équipe.
2. Finir et intégrer une tranche avant d’ouvrir plusieurs chantiers horizontaux.
3. Les stories P1/P2 ne remplacent jamais un test, un refus ou une preuve physique P0.
4. Toute modification d’un contrat public ou d’un invariant exige une décision d’équipe et, si elle est structurante, un ADR.
5. Après deux itérations, remplacer les hypothèses de vélocité par la moyenne réellement terminée.
6. Une story incomplète retourne au backlog; elle n’est pas comptée partiellement comme terminée.
