# Recette combinée QR, retrait, retour et session — 21 novembre 2026

**Niveau de preuve : logiciel vérifié avec simulateur.** Ce n'est ni une recette staging validée, ni du matériel validé.

## Environnement des exécutions

Chaque script a tourné, l'un après l'autre, sur une pile jetable dans le cloud. Chaque script avait son propre projet Compose.

**Pile utilisée :**
- PostgreSQL ;
- Mosquitto avec son ACL ;
- l'API construite depuis le commit testé ;
- `tools/hub-simulator`, un simulateur explicitement identifié et distinct du hub de Jimmy.

**Ce qui est réel et ce qui est simulé :**
- Les règles métier, les transactions, les messages MQTT et les routes REST sont réels.
- Les observations physiques sont simulées : porte, RFID et écran.

**Ce qui n'a pas été utilisé :**
- aucun secret staging ;
- aucun hub réel ;
- aucun SQL sur la garde ou sur `READY`.

Les SQL de mise en place restent **uniquement dans la base jetable**. Ils sont documentés dans chaque script :
- échéance d'un prêt ;
- vieillissement d'une session ;
- preuve d'un déclencheur.

## Références testées

| Référence | Contenu | Rôle |
|---|---|---|
| `c71f5a5` (`67-test-integration-stack-ref`), arbre identique à `43fed3c` de Backend | `dev` `4854982` (avec #180 et #181) + #173 `79d19a0` + #175 `89af9f1` + #176 `fd25b3b` + #177 `47dac78` | État **avant** les sept règles du 21 novembre |
| `c9473c4` (`67-test-session-checkout-return-integration`) | `dev` `4854982` + `c5026df` (contient #173 `df73917`, #175 `0f23f34` et #176 `446ebbe`) + R7 `ad71b16` | **Têtes finales** |

**Équivalence entre `c9473c4` et les têtes finales des PR.** Ce montage a été vérifié :
- montage : `dev` `4854982`, puis merge de #177 `9a6fe7a`, puis merge de #193 `ad71b16` ;
- résultat : il ne diffère de `c9473c4` que par **une ligne de doc 06 §15.3** (`ANOMALY_RESOLVED`).
- La recette `c9473c4` vaut donc pour les têtes finales #173 `df73917`, #175 `0f23f34`, #176 `446ebbe`, #177 `9a6fe7a` et #193 `ad71b16`.
- Chaque nouvelle tête descend de l'ancienne, sans force-push.

## Résultats sur `c9473c4` (têtes finales)

| Script | Couverture | Résultat |
|---|---|---|
| `services/api` `./mvnw test` | Suite complète, pile isolée | **715 tests, 0 échec** |
| `hub-challenge/run.sh` | Préparation, défi chiffré, scan, rejeux, 5 secrets faux, annulation, **nouvelle session du hub** (Q8), plafond, rejet tardif Q5b | 17 PASS, 0 FAIL |
| `hub-challenge/guard-at-scan.sh` | Garde définitive au scan (G1), rejeu `409 LOCAL_PROOF_INVALIDATED` (G2) | 4 PASS, 0 FAIL |
| `checkout-confirmation/run.sh` | Retrait confirmé : R1, R2 (**lecteur défaillant**), doublons, hors ordre, K14, **hub perdu** (C9) | 13 PASS, 0 FAIL |
| `return-preparation/run.sh` D1-D8, E1-E7 | Retour : expiration du QR, porte jamais ouverte ou laissée ouverte, refus sûr et incertain, **hub perdu**, tag étranger, lecteur défaillant, scan tardif, **récupération** E7 | 21 PASS, 0 FAIL (*) |
| `return-preparation/run.sh` E8 | Récupération ratée, nouvelle anomalie, puis réussite : aucune impasse | 2 PASS, 0 FAIL |
| `session-navigateur` S, R, W | Session navigateur, rotation, recette Web contre l'API réelle 17/17, Chromium W1-W14 | 20 + 13 + 26 PASS, 0 FAIL |
| `integration/dix-cycles.sh` | **10 retraits et 10 retours consécutifs**, un seul démarrage du hub | PASS |

(*) Le premier passage s'est arrêté sur une erreur de **mon** harnais : une colonne inexistante dans la requête E8. E8 a été relancé seul après correction : `c9473c4-4b-return-E8.txt`.

### 10 cycles consécutifs

- **Durée :** 1 825 s, avec le plafond livré : 6 préparations par 10 min, 7 attentes `Retry-After`.
- **Totaux :** 10 prêts, 10 terminés, 10 réservations `FULFILLED`, 20 opérations `CONFIRMED` sur 20, 20 commandes, au plus 1 commande par opération, **0 anomalie**, 20 `OPERATION_CONFIRMED`, 10 `LOAN_COMPLETED`. L'actif est `READY` à la fin.

À chaque cycle :
- la préparation est rejouée avec la même clé d'idempotence, ce qui renvoie la même opération ;
- le QR est rejoué après consommation, ce qui donne `409 LOCAL_PROOF_ALREADY_USED`, sans nouvelle commande ;
- **la vue mobile et la vue Manager sont croisées** :
  - routes mobiles (technicien) : `/me/loan` et `/loans/{id}` ;
  - routes Manager (admin) : `/admin/loans/{id}`, `/admin/locker-operations/{id}` et `/admin/reservations/{id}` ;
  - les deux vues donnent le même état, après le retrait comme après le retour.

**Aucun SQL d'écriture.**

### Règles approuvées le 21 novembre ([#67](https://github.com/PhilJordan18/aegis/issues/67#issuecomment-7064405022))

| Règle | Preuve | `c71f5a5` | `c9473c4` |
|---|---|---|---|
| 1. Récupération après anomalie acquittée | E7, E8 | non exécuté | PASS |
| 2. Accusé d'affichage tardif rejeté | Q5b | **FAIL** | PASS |
| 3. Garde définitive au scan | G1, G2 | **FAIL** | PASS |
| 4. Gardes transitoires | D1 (`409 LOCKER_OPERATION_IN_PROGRESS`), refus `409 COMPARTMENT_STATE_UNSAFE` pendant le décalage de projection | PASS | PASS |
| 5. K14, tag étranger au retrait | K14 | PASS | PASS |
| 6. Lecteur non sain après la fermeture | K5, K6, T4 | PASS | PASS |
| 7. Tag étranger au retour, au moins 3 lectures | E3 | PASS | PASS |

Q5b et G1 sont **en échec** sur `c71f5a5`. Ces échecs restent dans le bilan : ils sont corrigés sur les têtes finales, pas effacés.

## Erreurs de harnais (pas des défauts du produit)

- **Rotation R1/R2 sur `c71f5a5` :** la sonde lisait le journal avant que le provisionneur applique la rotation, environ 300 ms après le démarrage de Tomcat. Corrigé par la PR #187 ; résultat 13/13.
- **Variable d'environnement de la chaîne :** mal passée, l'étape retour n'a pas tourné sur `c71f5a5`.
- **Compteur d'attentes de `dix-cycles.sh` :** l'incrément se perdait dans un sous-shell, d'où « 0 attente ». Corrigé.
- **Colonne inexistante dans la requête E8 :** corrigé, puis E8 relancé.
- **Run à blanc de `dix-cycles.sh` sur #177 `47dac78` :** arrêté par la limite de 30 min de l'outil après 9 cycles, sans échec.

## Observations ouvertes

- **G0b :** un administrateur peut passer un actif en maintenance pendant une tentative. C'est acceptable maintenant que la règle 3 termine la tentative au scan.
- **Projection de la cellule :** environ 4 s de décalage après `CONFIRMED`. Un retour préparé dans cet intervalle reçoit `409 COMPARTMENT_STATE_UNSAFE`. C'est une garde transitoire sûre ; la raccourcir serait un suivi optionnel, à décider par Philippe.
- **Jeu de démonstration :** Q9c et Q10d ne sont pas démontrables, faute d'un second technicien et d'un second casier.
- **iOS :** non exécutable dans ce cloud. Le croisement mobile se fait au niveau des routes REST du technicien, pas de l'application.

## Ordre de merge (Philippe fusionne)

1. **#173** `df73917`, puis **#175** `0f23f34`.
2. **#176** `446ebbe` **et #177** `9a6fe7a` dans la même séance, **sans déploiement entre les deux**. Seul, #176 termine un dépôt cohérent en `DEVICE_OFFLINE_DURING_OPERATION`.
3. **#193** (R7) `ad71b16`.
4. **#192** (#179, ADR-018 A+B, migration V012) `c8e7857` : vérification QA séparée, voir #67.
5. **Web :**
   - #185, puis #189 : conflit d'imports, résolu par Web après le premier merge ; #189 après #173 à #177 ;
   - #186, puis #188 ;
   - #194 ;
   - #190, après #193 et #189 ;
   - #195 (R6).

   Les têtes Web sont revérifiées à l'exécution par QA avant le merge.
6. **PR QA :** #174 (sondes de la pile, ce rapport) et #187 (sondes de session).

**Après chaque merge :** relire la CI sur la tête de `dev`. **Le vert de la CI ne vaut pas « Done ».**

## Recette staging

Le guide humain est [`../../recette-staging/README.md`](../../recette-staging/README.md). Sa partie C est mise à jour avec les sept règles :
- C6.9b : récupération après acquittement ;
- C6.10 et C6.10b : tag étranger au retrait et au retour ;
- C6.15 : garde définitive au scan ;
- la contrainte « #176 jamais sans #177 ».

Conditions d'entrée :
- les SHA déployés sont ceux de `dev` après les merges ci-dessus ;
- les clés d'affichage sont provisionnées par le responsable Railway (jamais leur valeur) ;
- une anomalie de test est désignée sans seed SQL.

Le guide distingue la nature **réelle**, **simulée** ou **injectée** de chaque preuve ; l'injection est interdite en staging. **Aucune recette staging n'est revendiquée ici.**

## Essais qui restent exclusivement matériels

Le logiciel est vérifié avec le simulateur pour chacun de ces comportements. Il ne reste que la **preuve physique**, détenue par Jimmy, avec l'application iOS sur appareil :

| Essai | Ligne staging | Prérequis (responsable) |
|---|---|---|
| Défi QR affiché sur l'écran réel ; scan par la caméra du hub | C1, C2 | Écran #45, QR et caméra #22 (Jimmy) ; client iOS de préparation et de scan (iOS) |
| Ouverture du **bon** compartiment, porte et serrure réelles | C2, C6.4 | Porte et serrure #42/#21 (Jimmy) |
| Retrait puis retour avec **lecteur RFID réel** et bus | C3, C4, C5 | RFID #19, bus #20 (Jimmy) |
| Fenêtre de stabilité RFID et seuil des **3 lectures** du tag étranger (règle 7) | C6.10b | POC-01 et ADR-003 (Jimmy, Backend) |
| Lecteur réellement défaillant après la fermeture (règle 6) | C6.14 | RFID #19 (Jimmy) |
| Tag étranger réel au retrait (règle 5) ; tag lu dans deux cellules | C6.10, C6.11 | RFID #19 (Jimmy) |
| Redémarrage et perte réseau du hub réel pendant une opération | C6.6, C6.7, B4 | Firmware (Jimmy) |
| Porte non refermée physiquement | C6.8 | Porte #42 (Jimmy) |
| Récupération physique après une anomalie de retour | C6.9, C6.9b | Toute la chaîne matérielle (Jimmy) |

**Aucune carte dont un critère matériel reste à prouver ne se ferme sur cette recette.**

## Fichiers

- `c71f5a5-*.txt` et `c9473c4-*.txt` : les lignes `PASS`, `FAIL` et `OBS` de chaque étape.
- Les journaux complets restent dans la session.
- Aucun jeton, cookie, mot de passe ni secret QR n'y figure ; le texte a été vérifié avant le commit.
