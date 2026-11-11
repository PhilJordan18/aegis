# Vérification QA indépendante : préparation et défi affiché (#43, #46, plafond #44)

Ce script complète la recette Backend `services/api/scripts/check-hub-challenge.sh` (T0 à T7).
Il exécute les lignes P1 à P11 de
[`../integration/matrice-retrait-retour.md`](../integration/matrice-retrait-retour.md), ainsi que
le plafond de préparations validé par Philippe le 11 novembre pour #44.

```bash
docs/qualite/hub-challenge/run.sh   # depuis la racine du dépôt, environ 12 minutes
```

Le script tourne sur une pile jetable : PostgreSQL, Mosquitto avec son ACL, et l'API construite
depuis le commit extrait. Le projet Compose `aegis-qa-hub-challenge` utilise les ports 58533, 54984
et 19381.

- **Le hub est simulé** par `tools/hub-simulator`.
- **Les événements forgés** sont publiés avec le compte du device, sous un autre identifiant client
  que celui du simulateur.
- **Les clés** sont tirées pour chaque exécution. Elles ne sont jamais affichées et sont effacées à
  la sortie.
- **Le code de sortie** est le nombre de lignes `FAIL`. Les lignes `OBS` sont des constats destinés
  au propriétaire du contrat ; ce ne sont pas des échecs.

| ID | Vérification | Matrice |
|---|---|---|
| Q1 | Cinq configurations de clés invalides (clé de 31 octets, identifiant dupliqué, clé active inconnue, base64 invalide, identifiant invalide) : démarrage refusé, aucune clé dans les journaux | P5 |
| Q2 | Préparation : `202`, `AWAITING_LOCAL_PROOF`, défi `PENDING`, enveloppe scellée, aucune commande, aucun token dans la réponse REST | P1, P2 |
| Q3 | Un octet du texte chiffré altéré : jamais publié ni affiché, ligne `CANCELLED` purgée, puis `EXPIRED LOCAL_PROOF_EXPIRED` | P3, P9 |
| Q4 | Clé retirée alors qu'une ligne en dépend : avertissement au démarrage avec l'identifiant de la clé et le nombre de lignes, ligne annulée sans publication | P4, P5 |
| Q5 | Accusés forgés (révision, session, défi, opération, instruction inconnue) : `displayedAt` reste vide, et les messages sont conservés comme preuve rejetée | P7 |
| Q6 | Accusé rejoué avec le même `messageId`, puis un second accusé : `displayedAt` inchangé, un seul audit d'affichage | P6 |
| Q7 | Réservation annulée en attente de preuve : défi `INVALIDATED`, opération `FAILED`, purge, statut à l'écran | P11 |
| Q8 | Nouvelle session du hub en attente de preuve : défi `INVALIDATED`, opération `FAILED`, aucune commande | P10 |
| Q9 | Plafond #44 : 6 préparations acceptées ; la 7e reçoit `429 LOCAL_PROOF_RATE_LIMITED` avec `Retry-After` ; le rejeu idempotent n'est pas compté ; un autre utilisateur n'est pas limité ; la libération se fait à la borne de la fenêtre | décision #44 |

**Q9 et la fenêtre de 10 minutes.** Q9 raccourcit la fenêtre à 45 s par configuration
(`AEGIS_PREPARATION_WINDOW=PT45S`) pour que la borne soit atteignable. La valeur livrée par défaut
est relevée à part.

**Q8 : motif attendu.** Un arrêt propre du simulateur publie d'abord `OFFLINE`. Le motif
attendu est donc `LOCKER_OFFLINE`, et `HUB_RESTARTED` est accepté. Les deux motifs sont publics
depuis la décision #44 du 11 novembre.

**Q9c : isolation entre couples utilisateur–casier.** Elle n'est pas démontrable sur le jeu de
démonstration : il n'y a qu'un technicien et qu'un casier, et l'administrateur ne peut pas
réserver (403). Le comptage par couple ne repose que sur la lecture du code
(`PreparationRepository.preparationsSince`).

**Arrêt du simulateur.** Après SIGTERM, le simulateur publie son `OFFLINE` propre, mais son
processus reste vivant tant qu'une étape `wait` du scénario est en cours. Le script borne donc
l'arrêt à 10 s, puis tue le processus.

Ces vérifications ne prouvent rien sur un écran réel. L'affichage physique, l'ACK et l'échéance
sur le hub relèvent de #45 et d'une séance humaine.
