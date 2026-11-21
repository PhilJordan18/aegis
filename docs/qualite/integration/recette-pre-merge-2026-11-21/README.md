# Recette pré-merge QR, retrait et retour — 21 novembre 2026

Cette recette vérifie chaque PR de la pile, sur la tête exacte de la PR, avant les merges. L'ordre des merges est #173 → #175 → #176 → #177 ; Philippe fusionne.

**Ce n'est ni une recette staging, ni une recette matérielle.** Chaque script a tourné sur une pile jetable dans le cloud, avec :
- PostgreSQL, Mosquitto avec son ACL, et l'API construite depuis le commit testé ;
- le hub simulé par `tools/hub-simulator`.

Aucun secret staging, aucun hub réel, aucun SQL sur la garde ou sur `READY`. Les scripts se sont exécutés **l'un après l'autre**, chacun avec son propre projet Compose.

Les fichiers `*.txt` de ce dossier sont les lignes `PASS`, `FAIL` et `OBS` de chaque exécution. Les journaux complets restent dans la session ; aucune clé ni aucun jeton n'y figure (Q10c, INV).

## Résultats

| PR | Tête testée | Script | Échecs | CI de la tête |
|---|---|---|---|---|
| #173 | `79d19a0` | `hub-challenge/run.sh` | 0 | `CI result`, `API tests`, Sonar : verts |
| #173 | `79d19a0` | `hub-challenge/guard-at-scan.sh` | **1 (G1)** | idem |
| #175 | `89af9f1` | `checkout-confirmation/run.sh` | 0 | verts |
| #176 | `fd25b3b` | `return-preparation/run.sh` (D1 à D8) | 0 | verts |
| #177 | `47dac78` | `return-preparation/run.sh` avec `QA_RET_CASES="D1 D3 D4 D5 D6 D7 D8 E1 E2 E3 E4 E5 E6"` | 0 | verts |

Le vert de la CI ne vaut pas « Done ».

## Classement

### Défaut

| ID | PR | Constat | Référence |
|---|---|---|---|
| G1 | #173 | Une garde devient invalide avant le scan (actif passé en `MAINTENANCE` par la route admin). Le scan avec le bon secret reçoit alors `422 ASSET_NOT_READY`, mais la tentative ne se termine pas :<br>- l'opération reste `AWAITING_LOCAL_PROOF` ;<br>- le défi reste `PENDING` avec 0 essai ;<br>- aucun audit n'est écrit.<br>La tentative ne se termine qu'à l'échéance, en `EXPIRED LOCAL_PROOF_EXPIRED`. Aucune commande ni aucun prêt ne sont créés. | 05 §5.4, 06 §6.5 ; registre Backend, point 3 ([#67](https://github.com/PhilJordan18/aegis/issues/67#issuecomment-7063175563)) ; [#173](https://github.com/PhilJordan18/aegis/pull/173#issuecomment-7063390524) |

Backend attend la décision de Philippe sur la valeur du motif `FAILED` et la liste des refus transitoires avant de corriger. Le script accepte tout motif `FAILED`.

### Décisions métier en attente (`OBS`, pas des défauts)

| ID | PR | Question |
|---|---|---|
| §6.5 motif | #173 | Valeur du motif `FAILED` et liste des refus transitoires (registre, questions 3 et 4) |
| 09 §15.5 | #173 | Au scan, la garde de readiness répond `422 ASSET_NOT_READY`. Or 09 §15.5 annonce `409` pour les gardes, et 09 §8.1 réserve `ASSET_NOT_READY` à la création. Correction de documentation prévue par Backend (handoff iOS, écart 2) |
| G0b | #173 | Un administrateur peut modifier l'actif pendant une tentative. C'est acceptable seulement si §6.5 termine la tentative au scan |
| Q5b | #173 | Un accusé `ACCESS_CHALLENGE_DISPLAYED` correctement corrélé, reçu après `DISPLAY_REJECTED`, renseigne `displayedAt` (10 §27.2 muet) |
| K14 | #175 | Étiquette étrangère dans la cellule et étiquette attendue retirée : le retrait est `CONFIRMED`, sans anomalie. 05 §5.4 attend `UNEXPECTED_ASSET_OBSERVED` ; 06 §10.3 ne vérifie que l'étiquette attendue |

### Comportements connus, non bloquants

| ID | PR | Constat |
|---|---|---|
| D2 | #176 | Un dépôt complet et cohérent se termine `DEVICE_OFFLINE_DURING_OPERATION` tant que #177 n'apporte pas la preuve positive. Sur #177, T2 le confirme (`COMPLETED`). **#176 ne doit pas atteindre `dev` sans #177.** |
| Projection | #176, #177 | Après un retrait `CONFIRMED`, la projection de la cellule montre encore le verrou ouvert pendant 4,2 à 4,3 s : elle suit le heartbeat. Un retour préparé dans cet intervalle reçoit `409 COMPARTMENT_STATE_UNSAFE`. C'est un refus sûr ; il suffit de réessayer. |

### Limites du jeu de démonstration et de l'environnement

- Q9c (isolation entre couples utilisateur–casier) et Q10d (`404` pour un autre technicien) ne sont pas démontrables : le jeu n'a qu'un technicien et qu'un casier.
- Q9 raccourcit la fenêtre à 45 s par configuration. La valeur livrée par défaut, 6 préparations par 10 min, est relevée en Q9e.
- Aucun problème d'environnement pendant ces exécutions. Plus tôt dans la journée, un redémarrage du worker avait arrêté Docker. Les scripts affichent alors `FAIL BLOCKED` : c'est un problème d'environnement, pas un défaut.

## Pas couvert

- Le hub réel, l'écran réel, le lecteur RFID réel, Railway et Caddy.
- L'intégration combinée avec la session navigateur (#180). Elle se fera sur une référence d'intégration épinglée.
- Les 10 retraits et 10 retours simulés consécutifs. Ils se feront après l'intégration.
