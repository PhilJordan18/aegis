# Aegis — User Story Map et backlog P0

**Cours :** 420-5X7-SO — Écosystème connecté  
**Session :** Automne 2026  
**Équipe :** Philippe Jordan Monfouayi Mba et Yoël Jimmy Razafindretsa  
**Date de révision :** 17 septembre 2026  
**Version :** 2.0 — backlog d’exécution, responsabilités et tickets initiaux  
**Références :** [scope](02-scope.md), documents 03–10 et [plan d’exécution](14-plan-execution-et-iterations.md).

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

Les anciens points sont des repères de complexité non validés. Avant engagement, découper les grandes stories en tâches exécutables et estimer séparément la charge de Philippe et de Jimmy. Une petite valeur en points ne prouve pas qu’une story tient dans leurs budgets de 7 h et 4 h de réalisation.

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
| Retirer | Préparer; scanner le QR du hub; suivre; retirer; fermer | Défi, autorisation et commande corrélée avec simulateur | ACK, preuve physique locale, création transactionnelle du prêt | Ouverture hors ligne, accès direct mobile-locker |
| Suivre | Voir le prêt actif; voir l’actif emprunté | Chaîne de possession visible | Retard visible sans rendre l’actif réservable | Notifications et historique mobile détaillé |
| Retourner | Préparer; scanner le QR; déposer; fermer; suivre la confirmation | Opération `RETURN` et contrôle local corrélés | Preuve physique, prêt complété, readiness recalculée | Retour dans un autre locker |
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

Livrer la préparation, le scan du QR du hub, l’autorisation backend, la commande d’ouverture, l’ACK et les observations de porte/RFID et la création du prêt.

**Démonstration :** un retrait confirmé physiquement transforme la réservation en prêt sans modification manuelle de la base.

### P0.3 — Retour, anomalies et robustesse

Livrer le retour confirmé, les refus, l’expiration, les anomalies, la déduplication et la piste d’audit.

**Démonstration :** le retour termine le prêt; un doublon n’a aucun second effet; une preuve incohérente crée une anomalie qui ne peut être résolue sans preuve corrective.

---

## 6. Backlog P0 priorisé

Les points ci-dessous conservent les premières estimations pour comparaison; ils ne constituent aucun engagement de calendrier. Les responsables et la charge des tâches d’exécution sont définis au §11. Le budget séparé de chaque personne prévaut pour choisir le contenu d’un cycle.

### 6.1 Risques et fondations

| ID | Story / enabler | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| POC-01 | Valider la lecture RFID UHF locale par cellule | Le bon tag est détecté dans la bonne cellule selon plusieurs orientations; faux positifs/négatifs et délai de stabilisation sont mesurés; le fallback est déclenchable selon un seuil écrit. | Matériel RFID | Hub, cellule, docs | 3 |
| POC-02 | Valider les deux liaisons de l’étoile | Chaque cellule possède son câble alimentation/données et son port; chute de tension, actionnement, déconnexion et reprise sont mesurés séparément; brochage RJ45 documenté, sans connexion Ethernet/PoE. | Architecture physique 12, composants disponibles | Hub, cellules, docs | 3 |
| FND-01 | Lancer l’environnement local reproductible | Une commande documentée démarre PostgreSQL et le broker; aucun secret réel n’est committé; PostgreSQL n’est pas exposé publiquement. | Aucune | Infra | 3 |
| FND-02 | Prouver le walking skeleton | `GET /api/v1/system/health` répond; une migration Flyway s’applique; un heartbeat du simulateur est ingéré; Web/iOS lisent l’API. Le statut privé du locker est exposé aux clients seulement après IAM-01/02. | FND-01; IAM-01/02 pour le statut privé | API, DB, MQTT, Web, iOS, simulateur | 5 |

### 6.2 Identité et configuration

| ID | Story | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| IAM-01 | Se connecter avec un compte de démonstration | Un compte valide reçoit un jeton expirant selon ADR-007 (60 minutes proposées); un mot de passe invalide est refusé sans fuite d’information; les mots de passe sont hachés. | Socle API/Flyway de FND-02, ADR-007 | API, DB, Web, iOS | 3 |
| IAM-02 | Protéger les actions selon le rôle et le niveau d’accès | `ADMIN` et `TECHNICIAN` sont vérifiés côté serveur; un technicien ne lit jamais les données privées d’un autre; `STANDARD` ne permet pas un actif `RESTRICTED`. | IAM-01 | API, tests | 3 |
| CAT-01 | Gérer un modèle et deux actifs | L’administrateur crée/modifie un modèle et ses exemplaires; un actif archivé conserve son historique; les validations sont explicites. | IAM-02 | API, DB, Web | 3 |
| CAT-02 | Associer identité physique et cellule | Un tag actif n’appartient qu’à un actif; un placement courant n’associe qu’un actif à une cellule; une mutation conflictuelle est refusée. | CAT-01 | API, DB, Web | 5 |
| CFG-01 | Définir les règles de l’actif | L’administrateur fixe état opérationnel, calibration et niveau requis; les changements sont audités. | CAT-01 | API, DB, Web | 3 |
| CFG-02 | Définir les heures d’exploitation | L’administrateur configure l’horaire du locker; une période traversant une fermeture est refusée; le fuseau horaire est explicite. | CAT-01 | API, DB, Web | 3 |

### 6.3 Présence, readiness et réservation

| ID | Story | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| PHY-01 | Connaître l’état du locker et de ses cellules | Heartbeat toutes les 10 s; `ONLINE` si le dernier heartbeat valide a au plus 30 s; portes et erreurs sont visibles; un heartbeat ne change aucun prêt. | FND-02 | Hub/simulateur, MQTT, API, DB, Web | 3 |
| PHY-02 | Transformer un scan RFID en observation normalisée | Le payload brut est conservé; seules des lectures stables et saines deviennent présence/absence; une absence de message ne prouve jamais l’absence. Les tests simulés précèdent la validation sur le lecteur réel. | PHY-01, contrat 10; POC-01 pour la validation réelle | Hub/simulateur, MQTT, API, DB | 5 |
| RDY-01 | Calculer la readiness pour un technicien | Présence, disponibilité, état, calibration et accès sont évalués; résultat et raisons sont déterministes; l’état n’est pas un booléen éditable. | IAM-02, CFG-01, PHY-02 | API, DB, tests | 5 |
| RDY-02 | Consulter les actifs et leurs raisons | Web et iOS affichent le même résultat fourni par l’API; A2 expiré est `BLOCKED/CALIBRATION_EXPIRED`; aucun identifiant RFID brut n’est exposé au technicien. | RDY-01 | API, Web, iOS | 5 |
| RES-01 | Réserver un actif admissible pour une période | La fin est choisie dans les heures d’exploitation; un technicien et un actif n’ont chacun qu’une réservation active; deux requêtes concurrentes créent exactement une réservation. | RDY-01, CFG-02 | API, DB, iOS | 5 |
| RES-02 | Consulter, annuler et expirer la réservation | Le technicien ne voit que la sienne; l’annulation est idempotente; l’expiration ne libère pas l’actif pendant un retrait physique actif/incertain ni pendant un prêt. | RES-01 | API, DB, iOS, jobs | 3 |

### 6.4 Rail IoT et retrait

| ID | Story | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| IOT-01 | Publier une commande de façon fiable | La création métier et l’outbox sont atomiques; la commande comporte identifiants, expiration et schéma; une commande n’est jamais retained. | FND-02, ADR outbox | API, DB, MQTT | 5 |
| IOT-02 | Exécuter et accuser une commande une seule fois | Le hub vérifie cible/expiration; ouvre une seule cellule; renvoie `COMMAND_ACKNOWLEDGED` ou `COMMAND_REJECTED`; un redelivery ne réactive pas la serrure. | POC-02, IOT-01 | Hub/simulateur, MQTT | 5 |
| CHK-01 | Préparer un retrait puis scanner au hub | L’API crée AWAITING_LOCAL_PROOF; le QR est affiché au hub, jamais fourni par l’API; avant scan valide, aucune ouverture; une seule préparation active par locker. | RES-01, PHY-01, LOC-01 | API, DB, iOS, écran | À réestimer |
| LOC-01 | Afficher un défi privé sur le hub | Secret aléatoire, outbox chiffrée, TLS/ACL, ACK réel d’affichage; session/révision/expiration contrôlées; aucun token REST/log; écran effacé après usage. | IAM-02, PHY-01, ADR-009 | API, DB, MQTT, hub/simulateur | À estimer |
| LOC-02 | Autoriser une seule ouverture par QR valide | Compte/contexte/délais revérifiés; consommation et commande atomiques; 120 s après scan; autres comptes/rejeux/doubles validations refusés. | LOC-01, IOT-01 | API, DB, iOS, tests | À estimer |
| CHK-02 | Confirmer le retrait et créer le prêt | ACK, ouverture, fermeture et scan sain sans tag attendu sont corrélés; réservation et opération sont confirmées et prêt créé dans une transaction; incohérence = anomalie. | CHK-01, LOC-02, IOT-02, PHY-02 | API, DB, MQTT, iOS, Web | 5 |
| LOAN-01 | Consulter la chaîne de possession active | Le technicien et l’administrateur voient titulaire, actif et début; l’échéance dépassée ne rend pas l’actif disponible; un actif n’a jamais deux prêts ouverts. | CHK-02 | API, DB, iOS, Web | 3 |

### 6.5 Retour, audit et qualité

| ID | Story | Critères essentiels | Dépendances | Composants | Points |
|---|---|---|---|---|---:|
| RET-01 | Préparer et autoriser le retour au hub | Le titulaire prépare RETURN puis scanne le QR; pas d’exigence READY d’emprunt pour un actif BORROWED; prêt inchangé jusqu’à autorisation; 120 s après consommation; récupération RETURN_PENDING encadrée. | LOAN-01, LOC-01, LOC-02 | API, DB, iOS, écran | À réestimer |
| RET-02 | Confirmer physiquement le retour | Après fermeture, un scan sain contient le tag attendu selon le seuil du contrat (trois lectures proposées, à valider au POC); le prêt passe à `COMPLETED`; disponibilité et readiness sont recalculées après la transaction. | RET-01, IOT-02, PHY-02 | API, DB, MQTT, iOS, Web | 5 |
| ANO-01 | Créer et traiter une anomalie | Une divergence attendue/observée crée une anomalie; l’administrateur peut la reconnaître; elle n’est résolue qu’après preuve corrective ou action métier vérifiable. | CHK-02 ou RET-02 | API, DB, Web | 5 |
| AUD-01 | Reconstruire une opération | La chronologie relie utilisateur, réservation/prêt, commande, ACK, porte, RFID et résultat; horodatages et corrélation sont lisibles par l’administrateur. | CHK-02, RET-02 | API, DB, Web | 5 |
| QUA-01 | Résister aux doublons, expirations et redémarrages | Même `messageId` = un traitement; même clé HTTP = même résultat; une opération expirée ne confirme rien; un redémarrage retrouve un état cohérent. | Flux complets | Tous | 5 |
| DEM-01 | Prouver la répétabilité du P0 | 10 retraits + 10 retours consécutifs; aucune modification manuelle SQL; aucun double effet; procédure et résultats sont consignés. | Toutes les stories P0 | Tous | 5 |

---


### 6.6 Critères complémentaires du contrôle local

- Le test « compte valide sur un réseau distant » réserve éventuellement un actif mais ne peut ouvrir sans le code affiché.
- Une préparation expirée libère la file d’opération; elle ne libère pas un actif emprunté.
- Les scans faux, rejoués, concurrents ou d’un autre compte ne créent pas de nouvelle commande.
- La réapparition du tag sans retour confirmé ne termine jamais le prêt.
- Le message de succès sur le téléphone et le hub provient du backend.
- Le scénario de relais par photo est documenté comme limite, pas présenté comme un test anti-relais réussi.

LOC-01/02 constituent une extension du P0 demandée par l’équipe. En compensation proposée : écran limité au QR, aux consignes et au résultat; aucune réservation depuis l’écran, aucune connexion au hub, aucun catalogue tactile et aucun push APNS. Réestimer avec les deux membres avant d’engager ces stories; ne pas convertir arbitrairement les points en heures.

## 7. Ordre recommandé et dépendances critiques

| Étape | Dépendance principale |
|---|---|
| POC et fondations | Matériel, environnement et simulateur |
| Identité, configuration, présence et readiness | Fondations validées |
| Réservation | Readiness et horaires |
| QR, commande et retrait | Réservation, LOC-01/02 et rail IoT |
| Retour et robustesse | Retrait démontrable et preuves physiques |

Les POC matériels avancent en parallèle des fondations logicielles. La décision RFID et la décision hub/cellules doivent être prises au plus tard à la fin de la semaine 6; sinon, le fallback devient le plan P0 afin de protéger le gel fonctionnel de la semaine 12.

---

## 8. Definition of Ready d’une story

Une story peut entrer en itération lorsque :

- sa valeur et son acteur sont clairs;
- ses critères d’acceptation sont testables;
- ses dépendances et contrats touchés sont identifiés;
- aucune question structurante non résolue ne bloque son implémentation;
- ses tâches d’exécution tiennent dans les budgets séparés du cycle, ou elle reste un parent non engagé en entier;
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

1. Une seule tâche d’exécution active par personne; WIP maximal de deux. Un parent regroupant des sous-tâches n’ajoute pas une troisième tâche d’exécution.
2. Finir et intégrer une tranche avant d’ouvrir plusieurs chantiers horizontaux.
3. Les stories P1/P2 ne remplacent jamais un test, un refus ou une preuve physique P0.
4. Toute modification d’un contrat public ou d’un invariant exige une décision d’équipe et, si elle est structurante, un ADR.
5. Après deux itérations, remplacer les hypothèses de vélocité par la moyenne réellement terminée.
6. Une story incomplète n’est pas comptée comme terminée. Revoir son engagement au cycle suivant; un report automatique dans Linear ne remplace pas cette décision.

## 11. Backlog opérationnel et premiers tickets

### 11.1 Responsables par famille

| Références | Pilote | Répartition à respecter |
|---|---|---|
| FND, IAM, CAT, CFG, RDY, RES, LOAN, AUD | Philippe | Backend, DB et clients partagent sa même capacité |
| POC-01/02/03 et nomenclature | Jimmy | Mesures, matériel et pilotes; contribution Philippe si contrat touché |
| PHY, IOT, LOC | Philippe pour le parcours intégré | Sous-tâches séparées : Jimmy acquisition/actionneurs/écran; Philippe MQTT/backend/iOS |
| CHK, RET, ANO | Philippe pour le résultat métier | Jimmy fournit les observations et participe aux essais physiques |
| QUA, DEM | Philippe pour le suivi | Les deux exécutent les scénarios; la charge commune compte chez chacun |

Le partage du firmware reste une hypothèse du document 14. Une tâche Linear exécutable a un seul responsable; si deux personnes produisent deux parties distinctes, créer deux sous-tâches. Les IDs ci-dessous sont des références de projet, pas des numéros Linear déjà attribués.

### 11.2 Première vague à saisir

Ces tickets sont prêts à être discutés et saisis. Leur budget est une **timebox proposée**, à confirmer selon l’état réel du dépôt et le matériel disponible. Aucun n’est déclaré terminé ici.

| Ordre | Ticket | Responsable | Budget initial | Dépendance |
|---:|---|---|---|---|
| 1 | DOC-01 — Préparer le cahier de synthèse PDF | Philippe; figures Jimmy | P : 3 h; J : 1 h | Consignes exactes et sources des figures |
| 2 | PLAN-01 — Initialiser le backlog Linear minimal | Philippe ou Jimmy, un seul assigné | 0,5 h chez l’assigné | Structure du document 14 |
| 3 | HW-01 — Référencer et chiffrer le matériel des deux cellules | Jimmy | J : 1,5 h | Architecture 12 et disponibilité du laboratoire |
| 4 | POC-03 — Caractériser le verrou sur banc | Jimmy | J : 2 h | Verrou disponible, fiche et banc adapté |
| 5 | FND-01 — Démarrer PostgreSQL et le broker | Philippe | P : 3 h | Environnement local utilisable |
| 6 | FND-02A — Démarrer l’API et appliquer une migration | Philippe | P : 2 h | FND-01 |
| 7 | FND-02B — Compiler le client iOS minimal à l’école | Philippe | P : 1,5 h | Mac/Xcode disponibles; API accessible pour l’essai réseau |
| 8 | POC-04 — Vérifier le QR écran–caméra | Jimmy puis essai commun | J : 1,5 h; P : 0,5 h | Écran et iPhone réels disponibles |

Ces huit tickets ne sont pas huit engagements pour la première semaine. DOC-01 et HW-01 précèdent les engagements d’intégration; les autres sont tirés selon la capacité restante. Toute prolongation est notée avant de consommer la réserve. Une timebox écoulée avec un échec donne une preuve de blocage, pas le statut Terminé.

### DOC-01 — Préparer le cahier de synthèse PDF

**Résultat :** un enseignant peut comprendre le projet et retrouver les diagrammes exigés dans un seul PDF.

- Confirmer date, heure, format et attentes sur les diagrammes.
- Utiliser le plan de synthèse du document 14; intégrer les sources logicielles et les figures matérielles de Jimmy.
- Identifier les choix validés, les POC à réaliser et les limites du QR.
- Vérifier la lisibilité de chaque figure après export, les titres, la pagination et les renvois.
- Faire relire par les deux membres et conserver la version de remise.

La première timebox peut produire un brouillon complet; le ticket reste ouvert si un diagramme requis ou la relecture manque. La remise aux enseignants est une action distincte de l’export.

### PLAN-01 — Initialiser le backlog Linear minimal

**Résultat :** une équipe, un projet P0, les jalons utiles et un premier cycle compréhensible par les deux membres.

- Saisir la première vague avec IDs de référence, critères, responsable et dépendances.
- Configurer le modèle d’issue et les budgets par personne décrits dans le document 14.
- Conserver au maximum deux tâches en cours; ne pas remplir tous les futurs cycles.
- Lier les documents et le dépôt existants sans recopier tous les contrats dans Linear.

### HW-01 — Chiffrer la réalisation complète

**Résultat :** un choix de composants traçable pour un hub et deux cellules, dans les 500 $ CA.

- Lister références, quantités, disponibilité, matériel prêté et coût complet.
- Vérifier les interfaces du hub, l’écran graphique, les lecteurs, les drivers et les protections.
- Identifier ce qui manque pour approuver le brochage; ne pas déduire une capacité de courant du seul mot « RJ45 ».
- Donner une conclusion : réalisation chiffrée acceptable, achat bloqué ou repli à examiner.

### POC-03 — Caractériser le verrou

**Résultat :** une fiche d’essai décrit le comportement réel du composant retenu.

- Utiliser le banc et les protections adaptés à la fiche du composant.
- Relever les conditions d’actionnement, le courant avec un moyen de mesure adapté et le fonctionnement mécanique.
- Vérifier repos sans alimentation, fermeture, secours manuel et absence d’actionnement intempestif.
- Consigner les limites de mesure : une lecture de multimètre trop lente ne suffit pas à attester le pic de courant.

### FND-01 — Environnement reproductible

**Résultat :** PostgreSQL et le broker démarrent depuis une procédure versionnée.

- Configuration par variables externes et exemple sans secrets réels.
- PostgreSQL inaccessible publiquement; broker authentifié et permissions documentées.
- Redémarrage avec conservation des données attendues et test de connexion réussi.
- Une commande de lancement effectivement testée est ajoutée à la documentation locale.

### FND-02A — API et migration minimale

**Résultat :** l’API démarre, applique une migration Flyway minimale et répond sur sa route de santé.

- Choisir et consigner les versions réellement utilisées; ne pas générer toutes les tables du P0 dans ce ticket.
- Vérifier démarrage initial puis redémarrage sans rejouer incorrectement la migration.
- Ne pas exposer de secret ou d’état interne détaillé dans la réponse publique de santé.
- Reporter ingestion heartbeat et lecture métier authentifiée dans les sous-tâches suivantes de FND-02.

### FND-02B — Client iOS exécutable à l’école

**Résultat :** le projet SwiftUI compile sur un Mac de l’école et une vue appelle l’API par HTTPS lorsque celle-ci est disponible.

- Noter version Xcode, cible iOS, procédure d’ouverture et commande ou action de compilation.
- Tester chargement, résultat et erreur réseau sur une vue minimale.
- Identifier tôt les conditions d’essai sur l’iPhone réel; le simulateur seul ne valide pas la caméra.
- Conserver les réglages partageables dans Git, sans secrets de compte ou de signature.

### POC-04 — Écran et scan QR

**Résultat :** un QR de test complet et lisible est affiché sur l’écran choisi puis lu sur l’iPhone de démonstration.

- Mesurer lisibilité selon angle, distance et éclairage réalistes.
- Vérifier rafraîchissement et effacement de l’affichage.
- Utiliser un contenu de test sans pouvoir d’ouverture : cet essai ne valide pas encore LOC-01/02.
- Consigner le modèle d’écran, le pilote et le résultat; répartir les adaptations entre pilote et cycle MQTT.

### 11.3 Traçabilité des grands critères

| Critère P0 | Stories principales |
|---|---|
| Deux actifs et règles administrables | CAT-01/02, CFG-01/02 |
| Readiness et refus d’accès/calibration | IAM-02, PHY-02, RDY-01/02, RES-01 |
| Réservation distante sans ouverture automatique | RES-01, CHK-01, LOC-01/02 |
| Une commande, une cellule et une seule exécution | IOT-01/02, POC-02, QUA-01 |
| Retrait physiquement confirmé | CHK-02, PHY-02, LOAN-01 |
| Retour confirmé et retard sans libération | RET-01/02, RES-02, LOAN-01 |
| Anomalie corrigée avec preuve | ANO-01, AUD-01 |
| Historique et reprise | AUD-01, QUA-01 |
| Répétabilité 10 + 10 | DEM-01 |

Les parents conservent leurs critères même lorsque l’implémentation est découpée. La démo simulée valide le logiciel; les critères de détection physique exigent aussi le matériel réel avant la clôture du P0.
