# Recette logicielle du 22 novembre 2026

**Niveau de preuve : logiciel vérifié avec simulateur.** Ce n'est ni une recette staging validée, ni du matériel validé.

## Environnement des exécutions

Les exécutions ont tourné dans le cloud, sur des piles jetables. Chaque script a son propre projet Compose, ses propres
ports et ses propres volumes.

**Pile utilisée :**
- PostgreSQL ;
- Mosquitto avec son ACL ;
- l'API construite depuis le commit testé ;
- `tools/hub-simulator`, un simulateur explicitement identifié et distinct du hub de Jimmy.

**Garanties :**
- Aucun secret staging, aucun hub réel, aucun SQL d'écriture : les scripts ne font que des `SELECT`.
- Les mots de passe de démonstration sont tirés au hasard à chaque exécution et ne sont jamais affichés.
- Les jetons QR restent en mémoire.

Ce dossier ne contient que des sorties nettoyées. Les chemins des journaux jetables sont remplacés, et aucune capture
d'écran ni aucun journal brut n'est versionné.

## Recette des 10 retraits et 10 retours, pilotée par machine (`../dix-cycles.sh`, dev `d404bb6`)

Le plafond livré (6 préparations par utilisateur et par locker sur 10 minutes) est respecté : la recette attend chaque
`Retry-After` sans le contourner. Ces cycles sont pilotés par REST et par le simulateur. Ils sont distincts du parcours
piloté par l'application iOS, rapporté par la session iOS sur #67.

| Fichier | Début (Toronto) | Résultat |
|---|---|---|
| [`d404bb6-dix-cycles-1-cloture.txt`](d404bb6-dix-cycles-1-cloture.txt) | 23 h 13 | **Échec, conservé.** 4 cycles sur 10. En C5, la réservation reçoit `422 RESERVATION_END_AFTER_CLOSING`, car son échéance dépasse 23 h 59. C'est une limite d'horaire du harnais : l'API applique correctement la fermeture. |
| [`d404bb6-dix-cycles-2.txt`](d404bb6-dix-cycles-2.txt) | 00 h 01 | **Réussite** en 1830 s. Totaux `10 10 10 20 20 20 1 0 20 10` (voir le détail sous ce tableau), avec 8 attentes du plafond. `READY` revient sans SQL manuel. |

Ordre des totaux : prêts, prêts terminés, réservations satisfaites, opérations confirmées, opérations, commandes,
commandes maximum par opération, anomalies, `OPERATION_CONFIRMED`, `LOAN_COMPLETED`.

**Garde de fermeture.** Depuis l'échec du premier passage, `dix-cycles.sh` refuse de démarrer, avec le code 2 et le
message `FAIL BLOCKED clock`, quand la durée prévue dépasserait la fermeture de 23 h 59 à Toronto. La durée prévue
additionne :
- 10 minutes de mise en place ;
- environ 1 minute par cycle ;
- les 40 minutes de la réservation ;
- 10 minutes par fenêtre pleine du plafond.

Pour 10 cycles avec le plafond livré, il faut 90 minutes, donc démarrer au plus tard à 22 h 29.

Vérification de la garde : `QA_CYC_CLOCK=23:13` et `22:30` sont refusés, `22:29` et `00:01` sont acceptés. Le script
complet lancé avec `QA_CYC_CLOCK=23:13` sort avec le code 2 avant de créer quoi que ce soit.

## Récupération d'un retrait incertain, #200 (`recuperation-retrait.sh`)

[`7c896fd-recuperation-retrait.txt`](7c896fd-recuperation-retrait.txt) : K1 à K7 réussis sur la tête `7c896fd` de #200.

Le scénario vérifie cinq choses :
- un retrait dont le scan de fermeture voit encore l'équipement finit en `ANOMALY` ;
- son propre scan ne résout rien ;
- une nouvelle session de hub avec une cellule vide ne résout rien ;
- une nouvelle présence stable de l'équipement résout l'anomalie, sans créer de prêt ;
- un nouveau retrait passe ensuite par le vrai QR.

Le dernier passage, depuis ce dossier, est rapporté plus bas.

## Fraîcheur du catalogue Manager, #197 et #202 (`fraicheur-manager.sh` et `fraicheur-manager.cjs`)

La sonde s'accroche à `dix-cycles.sh` (`QA_CYCLES_AFTER`) et pilote l'application Manager construite, servie par
`vite preview`, contre la même API. La commande complète est en tête de `fraicheur-manager.sh`.

| Fichier | Référence | F1 : revenir sur Équipements | F2 : retour d'onglet |
|---|---|---|---|
| [`d404bb6-fraicheur-manager.txt`](d404bb6-fraicheur-manager.txt) | dev avant #202 | **Échec** : 0 relecture, la ligne reste « Disponible » alors que l'API dit `RESERVED` | **Échec** : 0 relecture |
| [`aaffd9b-fraicheur-manager.txt`](aaffd9b-fraicheur-manager.txt) | #202 | Réussite : 1 relecture, la ligne affiche « Réservé » | Réussite : 1 relecture, la ligne revient à « Disponible » |

Sur dev, la ligne F2 « revenue à l'état initial » réussit sans rien prouver, puisque la ligne n'avait jamais changé.

Deux essais de la sonde ont échoué à cause d'elle et sont rapportés sur #202 :
- un `visibilitychange` sans propagation, alors que TanStack Query v5 écoute sur `window` ;
- une course au démontage de Compose.

**Limite.** Chromium headless garde toutes les pages visibles. F2 simule donc le retour d'onglet par un
`visibilitychange` qui se propage, sur une page visible. Un vrai changement d'onglet reste une ligne de recette humaine.

## Exécution depuis ce dossier sur dev `f442a5c` (avec #200, #202 et #182)

Les deux scripts ont été relancés depuis ce dossier sur la branche `67-test-cycles-closing-guard`. Hors
`docs/qualite`, son code est identique à dev `f442a5c` (#200, #202 et #182 fusionnées). La relance montre que la
preuve s'exécute depuis le dépôt et non depuis une copie dans `/tmp`.

| Fichier | Résultat |
|---|---|
| [`f442a5c-recuperation-retrait.txt`](f442a5c-recuperation-retrait.txt) | K1 à K7 réussis ; 1 anomalie `RESOLVED` ; code de sortie 0 |
| [`f442a5c-fraicheur-manager.txt`](f442a5c-fraicheur-manager.txt) | 1 cycle `1 1 1 2 2 2 1 0 2 1` ; F1 et F2 réussis (1 relecture chacun, la ligne suit l'API) ; code de sortie 0 |

## Hors de cette preuve

Le parcours iOS piloté par l'application, la caméra, la lecture optique du QR, l'acceptation physique, le hub réel et le
staging relèvent d'autres niveaux de preuve. Ils ne sont pas déduits de ces exécutions.
