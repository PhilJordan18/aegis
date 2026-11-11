# Recette staging : guide humain pour Philippe et Jimmy

Ce guide est une **recette planifiée**, pas un compte rendu d'exécution. Il transforme la
liste de contrôle du 11 novembre (#67, commentaires 6804889493 et 6804913140) en fiche à
remplir. Rien n'est réputé réussi tant que Philippe ou Jimmy ne l'a pas exécuté et
consigné.

Il y a trois parties :

| Partie | Portée | Quand l'exécuter |
|---|---|---|
| **A — Recette actuelle** | Logiciel déjà livré : API, Manager, réservations iOS | Dès que le responsable Railway confirme les SHA déployés |
| **B — Broker et ESP32 réel** | Connexion TLS, ACL, reconnexion du hub | Quand les identifiants rotés et la CA sont fournis |
| **C — Futur retrait et retour physiques** | QR, commande, porte, RFID, prêt | **Seulement** après déploiement de #43/#46, #44, #47, #50, #51, du client iOS et du firmware correspondant |

La partie C est décrite pour préparer le matériel. **Elle n'est pas exécutable
aujourd'hui** : sans ces livraisons, chaque ligne est `BLOCKED`.

## Règles de sécurité (à relire avant chaque séance)

- **Aucun script de seed, de reset ou de SQL de fixtures du kit cloud n'est pointé vers
  staging.** Cela vise `docs/qualite/manager-admin/*.sql`, `run.sh` et
  `docs/qualite/recette-cloud/`. PostgreSQL reste privé. L'inventaire de test se prépare
  uniquement par l'interface ou l'API approuvées.
- Aucun mot de passe (y compris le mot de passe MQTT), jeton d'authentification, clé
  `AEGIS_DISPLAY_KEYS`, secret QR actif, tag RFID brut ou payload MQTT brut
  dans une capture, une issue, une PR ou un message. Les **identifiants** ne sont pas des
  secrets : un `traceId`, un `operationId`, un identifiant d'acteur ou d'entité, un nom
  d'utilisateur MQTT ou un `clientId` peuvent figurer dans la preuve. Masquez-les seulement
  quand ils donnent accès à quelque chose ou désignent une personne réelle hors du test.
- **Ne jamais capturer un QR actif.** Masquez-le avant de conserver la preuve. Une photo de
  l'écran du hub n'est gardée qu'après expiration ou consommation du défi.
- N'utilisez jamais l'identifiant client MQTT actif d'un ESP32 pour un client de test : la
  connexion de test déconnecterait le hub.
- Ne désactivez jamais la validation du certificat TLS, même pour « essayer ».
- Comptes séparés : un administrateur de test et un technicien de test. Les mots de passe
  circulent en privé, hors GitHub.
- Utilisez seulement un casier, des compartiments et des actifs **désignés pour le test**.
  Aucune opération sur l'équipement réel de Jimmy hors de ce périmètre.

## Statuts

| Statut | Sens |
|---|---|
| `PASS` | Le résultat observé correspond exactement au résultat attendu |
| `FAIL` | Le résultat observé diffère ; ouvrir ou mettre à jour une issue (reproduction, attendu, observé, responsable) |
| `BLOCKED` | Un prérequis manque (déploiement, donnée de test, matériel, client) ; noter lequel |
| `NOT RUN` | Pas exécuté pendant cette séance, sans blocage |

Un test automatisé vert (kit cloud, simulateur) ne remplace **jamais** une ligne de ce
guide. Une carte passe à « In Testing » quand son périmètre livré est testable ; elle ne
passe à « Done » qu'avec ses critères humains et physiques complets. **#46 ne se ferme pas
après la seule préparation.**

## 0. Conditions d'entrée

Remplissez ce tableau avant toute ligne. Les valeurs entre chevrons viennent du
responsable Railway ou du dépôt.

| Élément | Valeur | Source |
|---|---|---|
| Date et heure de début (UTC) | | Horloge |
| Testeurs (rôle de chacun) | | Philippe / Jimmy / observateur |
| SHA API déployé | `<à obtenir du responsable Railway>` | Railway, pas la branche locale |
| SHA Web (Manager) déployé | `<à obtenir du responsable Railway>` | Railway |
| Version des migrations Flyway appliquées | `<à obtenir du responsable Railway>` | Railway |
| Build iOS (commit + numéro) | | Xcode (TestFlight non requis) |
| Build firmware hub | | Jimmy |
| URL HTTPS de l'API | `<à obtenir>` | Railway |
| URL HTTPS du Manager | `<à obtenir>` | Railway |
| DNS du broker, port TCP public, CA | `<à obtenir>` | Railway |
| Rotation du mot de passe MQTT exposé (#24) confirmée | oui / non | Responsable Railway |
| Clés d'affichage provisionnées (partie C seulement) | oui / non, **jamais la valeur** | Responsable Railway |
| Casier, compartiments et actifs de test | identifiants du casier et des actifs de test | Philippe |

**Contrôle de cohérence.** Le SHA API et le SHA Web doivent appartenir au même `dev`, ou
leur combinaison doit être explicitement validée. Les contrats REST et MQTT doivent
correspondre à ceux de ce SHA. En cas de doute, la séance est `BLOCKED`.

Référence de qualification cloud au moment de la rédaction : `dev` `66bcefd`. Sur ce SHA,
`services/` et `infra/` sont identiques à l'arbre qualifié 147 PASS / 0 FAIL par le kit
`docs/qualite/manager-admin`. `apps/admin-web/src` est identique à l'arbre revu en rendu
(axe 0 violation). Ces preuves sont **synthétiques et isolées** : elles ne disent rien de
staging.

## Gabarit de consignation

Copiez ce bloc pour chaque ligne exécutée, dans l'issue de la carte concernée ou dans #67.

```text
Ligne      : S3
Statut     : PASS | FAIL | BLOCKED | NOT RUN
Testeur    : Jimmy
UTC        : 2026-11-12T15:04Z
SHA API/Web: abc1234 / def5678     Build iOS: …     Firmware: …
Observé    : …
Preuve     : lien de capture (masquée), traceId ou operationId désinfecté
Nature     : réelle | simulée | injectée   (voir « Nature des preuves »)
Écart      : issue #… (si FAIL)
```

### Nature des preuves

Chaque résultat indique sa nature. Elles ne se substituent pas l'une à l'autre.

| Nature | Exemple | Ce qu'elle prouve |
|---|---|---|
| **Réelle** | ESP32 de Jimmy, porte et lecteur RFID physiques, client iOS sur appareil | Le comportement dans le laboratoire |
| **Simulée** | `tools/hub-simulator` publiant DOOR_OPENED ou RFID_SCAN_COMPLETED | La logique backend face à un hub conforme au contrat |
| **Injectée** | Fixture SQL ou événement fabriqué dans la pile cloud isolée | Un cas limite logiciel ; **interdit en staging** |

## A — Recette actuelle (logiciel livré)

Cartes : #24, #37, #38, #48, #52, #53 et #159 pour S8.

| ID | Action humaine | Résultat attendu | Cartes | Statut | Observé / preuve |
|---|---|---|---|---|---|
| S1 | Ouvrir le Manager en HTTPS ; se connecter en administrateur. Vérifier la santé de l'API. Avec le compte technicien, tenter une lecture ou une action réservée à l'administrateur. | Certificat valide, version attendue, aucun secret affiché. Le technicien est refusé (403) sur les lectures et actions admin. | #24 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | SHA, statut HTTP, traceId ; **aucun jeton** |
| S2 | Dans l'app iOS de staging, ouvrir un actif de test prêt, puis un actif dont la calibration est expirée. | L'actif prêt est réservable. L'actif expiré explique le refus et n'est pas réservable. | #37, #38 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Capture des deux états |
| S3 | Réserver l'actif prêt jusqu'à une heure locale explicite (heure du laboratoire). Ouvrir « Mon activité », puis Manager → Réservations. | Une seule réservation. Même nom de technicien et même échéance dans les deux clients. Aucune erreur parasite de prêt courant. **Aucune commande de déverrouillage, aucun prêt.** | #37, #38, #48 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | L'observateur désigné confirme l'absence de commande MQTT |
| S4 | Actualiser, naviguer et rouvrir « Mon activité ». Annuler par l'écran de confirmation. | Même réservation avant l'annulation. Annulation affichée, plus de réservation ni de prêt actif. L'actif ne redevient prêt que si toutes les conditions de readiness le permettent. | #37, #38 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | **Jimmy consigne son propre résultat**, distinct de la validation de Philippe du 5 novembre |
| S5 | Manager : listes Réservations, Prêts et Opérations ; filtres, pagination et détails. Changer d'onglet rapidement, puis actualiser. | Données réelles persistées. Filtrage et pagination stables. Personne (utilisateur ou détenteur) correcte. Aucune ligne de l'onglet précédent. Heures dans le fuseau du laboratoire. États vide et indisponible honnêtes. | #48 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | **Ne pas créer de faux prêts** pour couvrir le physique |
| S6 | Anomalies : ouvrir l'anomalie de test désignée, si elle existe, puis l'acquitter (elle seule). Répéter l'acquittement. | Type localisé, preuves bornées, aucun payload brut, tag ou secret. L'acquittement n'est pas une résolution. La répétition et le conflit donnent les erreurs approuvées. | #52 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | **Aucune anomalie de test désignée ⇒ `BLOCKED`**, jamais PASS |
| S7 | Audit : filtrer autour de S3, S4 et S6 ; ouvrir les détails. | Événements attribuables et ordonnés. Seuls les détails scalaires autorisés sont visibles ; un champ structuré est signalé comme non affiché. Les identifiants approuvés (acteur, entité, trace) restent visibles. Aucun mot de passe, jeton d'authentification, tag RFID brut ou payload MQTT brut. | #53 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |
| S8 | Après fusion **et déploiement** de #159 : ouvrir Vue d'ensemble et suivre le lien de chaque bloc prioritaire. | Données réelles, comptes cohérents ou explicitement partiels. Un bloc en échec n'affecte pas les autres et n'affiche jamais « 0 » à la place de « indisponible ». Fraîcheur visible. Clavier et affichage étroit utilisables. | #159 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Non déployé ⇒ `BLOCKED` ; une revue cloud ne vaut pas PASS |

## B — Broker et ESP32 réel

Cartes : #24 et l'acceptation de connectivité du firmware. **Cette partie ne prouve ni
l'affichage QR, ni le déverrouillage, ni la porte, ni le RFID.**

| ID | Action humaine | Résultat attendu | Statut | Observé / preuve |
|---|---|---|---|---|
| B1 | Jimmy configure le hub avec le DNS, le port et la CA fournis, et l'identité de hub scopée. | Certificat validé par l'ESP32 ; connexion établie. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Horodatage UTC ; aucun mot de passe |
| B2 | L'observateur, avec l'identité de test scopée (**pas** l'identifiant client du hub), vérifie la réception dans les deux sens autorisés. | Les messages autorisés sont reçus des deux côtés. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | messageId, topic |
| B3 | Tenter la publication et l'abonnement interdits documentés (doc 10, §6). | **Aucune livraison non autorisée** côté destinataire. Un « publié » côté client ne suffit pas comme preuve. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Absence de réception observée |
| B4 | Redémarrer le hub. | Reconnexion, abonnements restaurés, nouvelle session, heartbeats réguliers. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Horodatages, identifiant de session désinfecté |
| B5 | Seulement si le Wi-Fi du campus bloque le port : refaire B1 à B4 sur le point d'accès 2,4 GHz du téléphone. | Distinguer un échec réseau d'un échec TLS ou firmware. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Réseau utilisé |

## C — Futur retrait et retour physiques (bloqué à ce jour)

Cartes : #43, #44, #46, #47, #50, #51 et leurs prérequis matériels : écran #45, QR et
caméra #22, porte et serrure #42/#21, RFID #19, bus #20. Les seuils QR, porte, RFID et
caméra et leur ordre viennent des contrats approuvés et du POC (docs 05, 06 et 10) :
**ne pas les improviser pendant la recette.**

**Préalables, tous obligatoires :**

- [ ] #43 + #46 (préparation, défi, outbox d'affichage chiffrée AES-256-GCM) fusionné et
  déployé ; clés provisionnées par le responsable Railway.
- [ ] #44 (autorisation par QR) fusionné et déployé pour C2 et au-delà.
- [ ] #47 (retrait confirmé physiquement) pour C3 ; #50 et #51 (retour) pour C4 et C5.
- [ ] Client iOS intégré aux **futures** routes de préparation et de scan, installé sur un appareil réel (en plus du client de réservation de la partie A).
- [ ] Firmware du hub avec affichage du défi, lecture QR, porte et RFID qualifiés par Jimmy.
- [ ] Procédure de récupération approuvée connue des deux testeurs avant C6.

Sans appareil réel ou sans client, chaque ligne est `BLOCKED`, **même si les tests du
simulateur cloud sont verts**.

| ID | Action humaine | Résultat attendu (référence normative) | Cartes | Statut | Observé / preuve |
|---|---|---|---|---|---|
| C1 | Depuis le client technicien autorisé, préparer le retrait de l'actif réservé. | Opération `AWAITING_LOCAL_PROOF`. Le défi apparaît **uniquement sur l'écran du hub**. Avant un scan valide : aucune ouverture, aucun prêt (doc 05, §5.3 et §5.7). | #43, #46 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | operationId désinfecté ; **QR masqué** |
| C2 | Scanner le QR affiché avec le compte autorisé. | Commande corrélée observée, puis ouverture du **bon** compartiment. | #44 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | messageId de la commande |
| C3 | Ouvrir, retirer l'actif de test, refermer ; laisser le RFID sain fournir la preuve. | **Exactement un prêt confirmé**, seulement après la séquence physique complète. iOS, Manager (Opérations, Prêts) et Audit concordent. | #47 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |
| C4 | En tant que détenteur, préparer le retour, scanner le QR courant, déposer l'actif, refermer le bon compartiment. | Le retour reste disponible **même si l'actif n'est plus READY**. Confirmation RFID saine obtenue. | #50, #51 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |
| C5 | Contrôler le prêt et l'actif après C4. | Un seul prêt terminé. Readiness recalculée par le backend ; l'actif n'est pas forcément READY. | #51 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |

### C6 — Cas négatifs contrôlés (compartiment de test dédié)

Attendu commun : refus, ou état non résolu explicite. **Aucun déverrouillage non autorisé,
aucune garde fabriquée.** Appliquer la procédure de récupération approuvée avant de
réessayer.

| ID | Cas | Résultat attendu (doc 05) | Statut |
|---|---|---|---|
| C6.1 | QR expiré (attendre l'échéance du défi, au plus 60 s) | Opération `EXPIRED`, aucune ouverture, prêt inchangé | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.2 | QR rejoué après consommation | Refus ; aucune seconde commande | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.3 | Mauvais compte : un autre technicien scanne le QR | Refus ; aucune commande | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.4 | Mauvais compartiment : le défi d'une autre opération | Refus ; aucune ouverture | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.5 | Cinq secrets erronés | Défi `INVALIDATED`, écran effacé, opération `FAILED` | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.6 | Hub redémarré ou reconnecté pendant `AWAITING_LOCAL_PROOF` | Nouvelle session ⇒ ancien défi invalidé, aucune commande | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.7 | Hub déconnecté après l'envoi de la commande | `ANOMALY` (`DEVICE_OFFLINE_DURING_OPERATION`), pas de prêt fabriqué | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.8 | Porte non refermée avant l'échéance | `ANOMALY` (`DOOR_NOT_CLOSED_BEFORE_EXPIRY`) | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.9 | **Retour** : préparer et autoriser le retour, ouvrir puis refermer **sans déposer** l'actif attendu (lecteur sain) | `ANOMALY` (`EXPECTED_ASSET_NOT_OBSERVED`, doc 05 §5.4). Le prêt reste `RETURN_PENDING` jusqu'à la correction ; la preuve que rien n'a été déposé le ramène à `ACTIVE` (doc 05 §4.4) | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.10 | Retrait ou retour : un **autre** tag que l'actif attendu est lu dans la cellule ciblée | `ANOMALY` (`UNEXPECTED_ASSET_OBSERVED`, doc 05 §5.4) | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.11 | Retrait ou retour : lectures contradictoires ou localisation ambiguë (par exemple, tag lu dans deux cellules) | `ANOMALY` (`INCONSISTENT_PHYSICAL_STATE`, doc 05 §5.4) | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.12 | Deux scans quasi simultanés du même QR | Exactement une commande | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.13 | **Retrait** : ouvrir puis refermer correctement **sans retirer** l'actif (lecteur sain, tag toujours présent) | Opération non terminale jusqu'à `expiresAt` (preuve incomplète), puis `ANOMALY` (`INCONSISTENT_PHYSICAL_STATE`). **Aucun prêt** créé | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.14 | Retrait ou retour : après un accusé et une porte ouverte puis fermée valides, le scan d'évaluation est `FAULTED` ou `UNKNOWN` | `ANOMALY` (`INCONSISTENT_PHYSICAL_STATE`) **dès ce constat**, sans attendre l'échéance et sans conclure présence ni absence. Aucun prêt créé au retrait ; aucun prêt clôturé au retour | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |

**Absence normale au retrait.** Au retrait, l'absence stable du tag attendu après la
fermeture, avec un lecteur sain, est la **preuve nominale** (doc 06 §10.2) : c'est C3, pas
une anomalie. Elle ne doit jamais être consignée comme `EXPECTED_ASSET_NOT_OBSERVED`.

**Règles #47 validées par Philippe le 11 novembre (C6.13 et C6.14).**

- **Actif non retiré au retrait.** Le tag attendu est toujours présent après une ouverture
  et une fermeture valides, et le lecteur est sain. La preuve reste incomplète jusqu'à
  `expiresAt`. L'opération passe ensuite en `ANOMALY` avec `INCONSISTENT_PHYSICAL_STATE`, sans
  prêt.
- **Lecteur non sain après une séquence valide.** Doc 06 §10.3 traite déjà ce cas (lecteur
  non sain ⇒ `INCONSISTENT`). Un scan `FAULTED` ou `UNKNOWN` ne prouve ni présence ni absence
  (doc 10 §12.1). Constaté **à l'évaluation**, après un accusé valide, une ouverture puis une
  fermeture de la bonne cellule, il donne `ANOMALY` avec `INCONSISTENT_PHYSICAL_STATE` dès ce
  constat.
- **À ne pas confondre :**
  - l'**absence d'un message** RFID n'est jamais une preuve et ne déclenche pas cette règle :
    l'opération attend, puis l'échéance s'applique (doc 06 §14.2) ;
  - un lecteur non sain **avant** l'accusé ou avant la séquence de porte ne crée pas cette
    anomalie.
- **Effets.** Aucun prêt créé au retrait, aucun prêt clôturé au retour. La récupération
  suit les contrats existants (doc 05 §4.4 et §4.6).
- **Précision des documents normatifs.** La précision de doc 05 §5.4 et doc 06 §10.3 revient
  au propriétaire des contrats (Backend). Les ADR acceptés restent inchangés.

Les cas de chiffrement (falsification du texte chiffré ou de l'AAD, rotation de clé,
configuration de clé manquante) et les doublons ou réordonnancements MQTT se vérifient
dans la pile cloud isolée, pas en staging. Leur résultat y est **simulé ou injecté**.
Ils sont décrits dans
[`../integration/matrice-retrait-retour.md`](../integration/matrice-retrait-retour.md).

## Sortie de séance

- Chaque ligne exécutée a un statut, un observé, un testeur, une heure UTC, les SHA et
  builds, et une preuve désinfectée.
- Chaque `FAIL` a une issue : reproduction exacte, attendu, observé, responsable.
- Chaque `BLOCKED` nomme le prérequis manquant et son responsable : Railway, Jimmy, iOS,
  Backend ou Web.
- Publier le résumé sur #67 avec les liens vers les consignations par carte.

## Prérequis matériels et iOS (résumé)

| Prérequis | Responsable | Nécessaire pour |
|---|---|---|
| SHA API/Web déployés, migrations, HTTPS | Responsable Railway | A, B, C |
| Identifiants MQTT rotés (#24), DNS, port, CA | Responsable Railway | B, C |
| `AEGIS_DISPLAY_KEYS` / `AEGIS_DISPLAY_ACTIVE_KEY_ID` provisionnées | Responsable Railway | C |
| Anomalie de test désignée (sans seed SQL) | Philippe | S6 |
| Écran du hub #45 | Jimmy | C1 |
| QR et caméra #22 | Jimmy | C2, C4, C6 |
| Porte et serrure #42/#21 | Jimmy | C2 à C6 |
| RFID #19, bus #20 | Jimmy | C3 à C6 |
| Build iOS de staging du parcours de réservation existant (#37/#38), installée sur appareil réel | Propriétaire iOS | S2 à S4 |
| Futur client iOS intégré à la préparation et au scan QR (#43/#44/#46 et suivants), sur appareil réel | Propriétaire iOS | C |
