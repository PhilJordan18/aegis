# Recette staging : guide humain pour Philippe et Jimmy

Ce guide est une **recette planifiée**, pas un compte rendu d'exécution. Il transforme la
liste de contrôle du 11 novembre (#67, commentaires 6804889493 et 6804913140) en fiche à
remplir. Il a été mis à jour le 26 novembre 2026 pour le logiciel de `dev` `fe205ee` :
Manager, application mobile, API et image du broker (#236, #237, #238 comprises). Rien n'est réputé réussi tant que Philippe ou
Jimmy ne l'a pas exécuté et consigné.

Il y a quatre parties :

| Partie | Portée | Hub | Quand l'exécuter |
|---|---|---|---|
| **A — Logiciel sans hub** | Connexion et restauration de session, révocation, réservation, cohérence Manager et mobile, anomalies, audit | Aucun | Dès que le responsable Railway confirme les SHA déployés |
| **S — Garde physique avec hub simulé** | Retrait, retour, anomalie et reprise, pilotés par le mobile et le Manager | `tools/hub-simulator`, locker de test dédié | Seulement après la décision D1 (ci-dessous) ; sinon `BLOCKED` |
| **B — Broker et ESP32 réel** | Connexion TLS, ACL, reconnexion du hub | Hub de Jimmy | Quand les identifiants rotés et la CA sont fournis |
| **C — Validations matérielles** | QR affiché, caméra, porte, RFID, prêt réel, cas négatifs | Hub de Jimmy | Après B, avec le firmware qualifié par Jimmy |

**Le logiciel du retrait et du retour est fusionné dans `dev`.** Cela comprend l'API
(#172, #173, #175, #176, #177, #200), le Manager (#186, #188, #189, #190, #202) et l'application
mobile (#198, #199). Ils sont prouvés avec un hub simulé dans des piles cloud isolées, et
un premier essai réel a eu lieu sur staging le 25 novembre avec le hub de Jimmy (voir
« Preuves déjà acquises »). Cet essai n'est pas consigné dans le format de ce guide : une
ligne S ou C ne passe à `PASS` que consignée pendant une séance, avec la nature de preuve
qu'elle exige.

### Preuves déjà acquises hors staging (nature simulée)

Elles ne remplacent aucune ligne de ce guide. Elles indiquent ce qui est déjà vérifié au
niveau logiciel.

| Preuve | Où | Ce qu'elle couvre |
|---|---|---|
| 10 retraits et 10 retours, sans SQL ni `READY` forcé | [`../integration/recette-2026-11-22/`](../integration/recette-2026-11-22/README.md), `d404bb6` | API, broker et hub simulé ; plafond de préparation respecté |
| Récupération d'un retrait incertain (#200) | Même dossier, `7c896fd` | Anomalie, absence de résolution parasite, reprise par une nouvelle présence |
| Règles 1 à 7 (défi, garde, tags étrangers, lecteur non sain) | [`../integration/matrice-retrait-retour.md`](../integration/matrice-retrait-retour.md) | Cas négatifs, chiffrement, doublons et réordonnancements MQTT |
| Sessions navigateur et révocation des JWT (#180, #192) | [`../session-navigateur/`](../session-navigateur/README.md) | Restauration, déconnexion, changement de mot de passe |
| CI complète de `dev` (API, Web, simulateur, iOS) | #67, bilan du 25 novembre (`8d4f2d1`) ; CI verte sur `fe205ee`, iOS sauté faute de changement iOS | Tests automatisés ; UI iOS sur simulateur Apple |

### Essai réel sur staging du 25 novembre (non consigné)

Rapporté par Philippe et relevé en base dans
[`../../livraison/etat-infra-20261125.md`](../../livraison/etat-infra-20261125.md), pour
AEG-DEMO-004 avec le hub de Jimmy : une tentative de retour en `ANOMALY`
(`f85bf3e2`), puis un retrait (`616cb5ef`) et un retour (`2286d781`) `CONFIRMED`. Un
retrait ultérieur (`4ab854ba`) a laissé le prêt `3cba970f` **`ACTIVE`** : il se clôture
par un retour normal ou se conserve par décision explicite, jamais par SQL.

Cet essai montre que la chaîne réelle fonctionne, mais il **ne remplace aucune ligne C** :
il n'a ni testeur et heure consignés par ligne, ni preuve désinfectée au format de ce guide,
et la tension, les capteurs et le firmware flashé n'en sont pas déduits. L'ACL du broker
relevée ce jour-là autorisait les commandes vers tous les casiers ; l'isolation du
simulateur mesurée auparavant ne décrit donc pas cet état.

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
- **Un hub simulé reste identifié et séparé du hub de Jimmy** : son propre locker de test,
  son propre compte MQTT, un `deviceKey` préfixé `sim-` et jamais le `clientId` d'un ESP32.
  Ses résultats sont consignés « simulée », jamais « réelle ».
- **Jamais de `READY` forcé, de garde fabriquée ni de SQL manuel** sur la garde, les prêts,
  les opérations ou l'audit. Une situation bloquée se résout par la procédure approuvée,
  sinon elle est consignée `FAIL` ou `BLOCKED`.
- Aucun fichier HAR, cookie ou jeton non masqué dans une preuve. Une capture des outils de
  développement ne montre que le statut HTTP et le `traceId`.

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

Référence logicielle au moment de la rédaction : `dev` `fe205ee` (26 novembre 2026), CI
verte. Le bilan complet, iOS compris, porte sur son ancêtre `8d4f2d1` et est publié sur
#67 ; aucun fichier iOS n'a changé depuis. Le staging tournait sur `feefd76` à la dernière
lecture : sans #237 ni #238, A5 n'y est pas exécutable comme écrit. Un SHA déployé différent doit être
un descendant de `dev` dont la CI est verte, sinon la séance est `BLOCKED`. Les preuves
cloud sont **synthétiques et isolées** : elles ne disent rien de staging.

### Décisions de Philippe (25 novembre 2026)

| ID | Décision | Conséquence pour la séance | Lignes |
|---|---|---|---|
| D1 | **Approuvée** : casier simulé dédié sur staging, séparé du hub de Jimmy. | Le responsable Railway fournit le compte MQTT de ce casier ; le simulateur ne tourne pas sur le Mac de Philippe et n'utilise jamais l'identité du hub. Avec l'image du broker de #236, l'API ne publie vers **un seul casier** à la fois : S et C exigent un changement de casier autorisé entre les deux (voir « Bascule du casier autorisé »). | Partie S |
| D2 | **Approuvée** : saisie du vrai QR dans le champ réservé au build Debug. Le serveur conserve toutes ses vérifications. La caméra est vérifiée séparément sur iPhone (partie C). | Aucun jeton dans un journal, une capture ou un rapport. Le champ n'existe que dans le build Debug, dont l'URL d'API doit pointer vers staging. | S2, S4, S5, S7 |
| D3 | **Préparée, non exécutée** : rotation du mot de passe d'un compte de recette dédié pendant la séance. | Aucun mot de passe n'est changé avant la séance. Le nouveau mot de passe circule hors GitHub. Depuis #238, changer la seule variable `AEGIS_DEMO_*_PASSWORD` **ne révoque rien** : A5 nomme les deux mécanismes valides. | A5 |
| D4 | **Approuvée** : l'anomalie de test est celle que produit le retour simulé de S4. Aucun SQL manuel. | A9 s'exécute après S4 ; acquitter ne résout pas ; la reprise S5 va jusqu'à la confirmation physique simulée. | S4, A9, S5 |

## Classement avant la séance

### Prérequis de séance (à réunir, pas des défauts)

| Prérequis | Responsable | Lignes |
|---|---|---|
| SHA API et Web de `dev` déployés, migrations appliquées, URL HTTPS | Responsable Railway | Toutes |
| Comptes de recette administrateur et technicien, dont le compte dédié de D3 | Philippe, responsable Railway | Toutes, A5 |
| Compte MQTT du casier simulé, DNS, port, CA du broker | Responsable Railway | S |
| Image du broker de #236 déployée, ou état de l'ACL live relevé ; casier autorisé (`recipe-230/locker-id`) et `commands-enabled` connus avant S, puis avant C ; simulateur présent dans `device-accounts.hash` | Responsable Railway, Jimmy pour la fenêtre | S, C |
| Sort du prêt réel `3cba970f` (`ACTIVE`) décidé : retour normal ou conservation explicite | Philippe, Jimmy | C |
| `AEGIS_DISPLAY_KEYS` / `AEGIS_DISPLAY_ACTIVE_KEY_ID` provisionnées (jamais leur valeur ici) | Responsable Railway | S, C |
| Casier, compartiments et actifs de test créés par le Manager, sans SQL | Philippe | S, C |
| Build Debug du mobile au SHA de la section 0, avec `AEGIS_API_BASE_URL` vers staging, sur appareil | Propriétaire iOS | A, S |
| **Lecture opérateur du QR simulé.** Le simulateur ne journalise jamais le QR ; seul son accesseur `screen` l'expose. Aucun outil livré ne le montre à l'opérateur. Il faut un affichage local, non journalisé et non capturé, pour la saisie D2. | À désigner par Philippe (outillage de test, pas le produit) | S2, S4, S5, S7 |
| Firmware avec écran, QR, porte et RFID qualifiés | Jimmy | B, C |

### Tests restant à exécuter (staging)

- A1 à A12 : session, révocation (A5 pendant la séance), réservation, cohérence, audit.
- S1 à S7 : retrait, retour, anomalie et reprise, cohérence, avec le casier simulé.
- B1 à B5 et C1 à C6.15 : broker et validations matérielles sur le hub de Jimmy, caméra
  de l'iPhone comprise.

### Défauts bloquants

Aucun défaut produit bloquant n'est connu au moment de la publication. Le résultat de la CI
finale de `dev` est publié sur #67. #222 reste au backlog et ne bloque pas la recette. Un
`FAIL` de séance devient un défaut bloquant s'il touche un invariant de garde.

Ces préparatifs ne maintiennent aucun développement ouvert : un prérequis manquant rend
ses lignes `BLOCKED`, il ne justifie aucune modification du produit.

## Gabarit de consignation

Copiez ce bloc pour chaque ligne exécutée, dans l'issue de la carte concernée ou dans #67.

```text
Ligne      : A6
Statut     : PASS | FAIL | BLOCKED | NOT RUN
Testeur    : Jimmy
UTC        : 2026-11-12T15:04Z
SHA API/Web: abc1234 / def5678     Build iOS: …     Firmware ou simulateur: …
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

## A — Logiciel sans hub

Cartes : #24, #37, #38, #48, #52, #53, #159, #178/#180 (session navigateur), #179/#192
(révocation) et #85 (session mobile). Aucune ligne de cette partie n'envoie de commande au
hub. L'observateur désigné confirme l'absence de commande MQTT pendant A6 à A8.

### A.1 — Connexion, restauration de session et révocation

Référence : doc 09 §4.1, §10.4 à §10.6 (ADR-016 à ADR-018).

| ID | Action humaine | Résultat attendu | Statut | Observé / preuve |
|---|---|---|---|---|
| A1 | Ouvrir le Manager en HTTPS ; se connecter en administrateur ; vérifier la santé de l'API. Avec le compte technicien, tenter une lecture admin dans le Manager et par l'API. | Certificat valide, version attendue, aucun secret affiché. Le technicien est refusé (`403`) sur les lectures et actions admin. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | SHA, statut HTTP, traceId ; **aucun jeton** |
| A2 | Manager : actualiser la page, suivre un lien direct vers un dossier, ouvrir un nouvel onglet. | La session est restaurée sans nouvelle connexion, dans chaque onglet. Aucune boucle de restauration. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Statuts HTTP seulement |
| A3 | Mobile : se connecter en technicien, fermer l'application (balayage), la rouvrir. Puis couper le réseau et rouvrir un écran. | La session est restaurée depuis le trousseau sans ressaisie. Hors réseau : message d'indisponibilité récupérable, pas de déconnexion. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Capture sans jeton |
| A4 | Manager, deux onglets ouverts : se déconnecter dans l'un. Rafraîchir l'autre. Sur le mobile, rouvrir « Mon activité ». | Le second onglet revient à la connexion. **Le mobile reste connecté** : la déconnexion du Web ne touche pas iOS. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |
| A5 | Pendant la séance (D3), avec le mobile et le Manager connectés au compte de recette dédié, changer son mot de passe par **l'un** de ces mécanismes : (a) le testeur, depuis une session de ce compte, appelle `POST /api/v1/auth/password` (mot de passe actuel requis, doc 09 §10.7 ; réponse `204`) ; (b) pour un compte de démonstration seulement, le responsable Railway règle `AEGIS_DEMO_ROTATE_PASSWORDS=true`, change le secret, redémarre l'API, puis remet le drapeau à `false` et redémarre (entre-temps, (a) répond `503`). Changer la seule variable de mot de passe ne suffit pas. Puis rouvrir le mobile et le Manager. | Les jetons du compte sont refusés (`401`) ; Web et mobile reviennent à la connexion ; le nouveau mot de passe fonctionne. Un audit `PASSWORD_CHANGED` existe. Réservations et prêts sont inchangés. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Rotation non faite ⇒ `NOT RUN` ; le mot de passe ne circule jamais ici |

L'échéance d'un jeton mobile (60 minutes) se vérifie seulement si la séance dure : retour à
la connexion, réservations et prêts inchangés.

### A.2 — Réservation et cohérence entre les deux interfaces

| ID | Action humaine | Résultat attendu | Cartes | Statut | Observé / preuve |
|---|---|---|---|---|---|
| A6 | Dans le mobile, ouvrir un actif de test prêt, puis un actif dont la calibration est expirée. | L'actif prêt est réservable. L'actif expiré explique le refus et n'est pas réservable. | #37, #38 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | Capture des deux états |
| A7 | Réserver l'actif prêt jusqu'à une heure locale explicite. Ouvrir « Mon activité », puis Manager → Réservations et le dossier de l'actif. | Une seule réservation. Même technicien, même actif et même échéance dans les deux clients, à l'heure du laboratoire. **Aucune commande de déverrouillage, aucun prêt.** | #37, #38, #48 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | L'observateur confirme l'absence de commande MQTT |
| A8 | Actualiser, naviguer et rouvrir « Mon activité ». Annuler par l'écran de confirmation. Revenir au Manager **sans recharger**, puis en changeant d'onglet. | Même réservation avant l'annulation. Ensuite : plus de réservation active des deux côtés ; le Manager relit les faits à l'entrée de l'écran (#202). L'actif ne redevient prêt que si la readiness le permet. | #37, #38, #202 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | **Jimmy consigne son propre résultat** |
| A9 | Après S4 (D4) : ouvrir l'anomalie produite par S4, puis l'acquitter avec une note (elle seule). Répéter l'acquittement. Vérifier qu'elle n'est pas résolue avant S5. | Type localisé, preuves bornées, aucun payload brut, tag ou secret. L'acquittement n'est pas une résolution. La répétition et le conflit donnent les erreurs approuvées. | #52 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | **S4 non exécutée ⇒ `BLOCKED`**, jamais PASS ; aucun SQL |
| A10 | Manager : Réservations, Prêts et Opérations ; filtres, pagination, dossiers liés (#188). Changer d'onglet rapidement, puis actualiser. | Données persistées réelles, filtrage et pagination stables. Personne et équipement nommés (#190). Aucune ligne de l'onglet précédent. États vide et indisponible honnêtes. | #48, #188, #190 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | **Ne pas créer de faux prêts** |
| A11 | Audit : filtrer autour de A5, A7, A8 et A9 ; ouvrir les détails. | Événements attribuables et ordonnés. Seuls les détails autorisés sont visibles, imbriqués compris (#185). Aucun mot de passe, jeton, tag RFID brut ni payload MQTT brut. | #53 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |
| A12 | Vue d'ensemble : suivre le lien de chaque bloc prioritaire. | Données réelles, comptes cohérents ou explicitement partiels. Un bloc en échec n'affiche jamais « 0 » à la place de « indisponible ». Clavier et affichage étroit utilisables. | #159 | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |

## S — Garde physique avec hub simulé (staging, après D1)

**Nature : simulée.** Le simulateur prouve que le backend, le Manager et le mobile traitent
correctement un hub conforme au contrat. Il ne prouve **ni l'écran, ni la caméra, ni la
porte, ni le RFID**, qui restent en partie C. D1 est approuvée ; sans
la lecture opérateur du QR simulé, S2, S4, S5 et S7 sont `BLOCKED`.

**Préalables.** Locker, compartiments et actifs de test créés par le Manager, sans SQL. Le
compte MQTT du locker simulé est fourni par le responsable Railway. Le simulateur est
configuré avec `AEGIS_MQTT_URL` en `mqtts:`, la CA fournie, `AEGIS_SIM_LOCKER_ID` et
`AEGIS_SIM_COMPARTMENTS` du locker de test. Les observations physiques (porte, scans RFID)
sont scriptées et consignées avec leur scénario.

### Bascule du casier autorisé (image du broker de #236)

Avec l'image de #236, le compte MQTT de l'API (`aegis_api_recipe_223`) ne publie
`display`, et `commands` si `commands-enabled` vaut `true`, que vers **le** casier nommé
par `recipe-230/locker-id`. Un seul casier est donc testable à la fois :

1. **Avant S** : le responsable Railway confirme que `locker-id` désigne le casier simulé
   de D1 et que `commands-enabled` vaut `true`. Sinon S2 échoue faute d'affichage (refus
   du broker, puis expiration) : ce n'est pas un défaut du produit ; consigner `BLOCKED`.
2. **Isolation, avant S2** : le responsable Railway confirme, par l'inventaire et l'ACL
   chargée, que l'API ne peut publier ni `display` ni `commands` vers le casier de Jimmy
   pendant la partie S. L'ACL relevée le 25 novembre autorisait tous les casiers ; tant
   que cette confirmation manque, S est `BLOCKED`. Ne jamais « vérifier une ACL » par une
   commande d'ouverture réelle.
3. **Entre S et C** : fenêtre sans opération ni commande en vol ; le responsable Railway
   remplace `locker-id` par le casier de Jimmy et redémarre le broker (la politique n'est
   réappliquée qu'au démarrage). Vérifier ensuite les reconnexions et heartbeats avant C1.

Si l'image de #236 n'est pas déployée, consigner l'état réel de l'ACL dans la section 0 et
appliquer les mêmes conditions d'isolation.

| ID | Action humaine | Résultat attendu (référence normative) | Statut | Observé / preuve |
|---|---|---|---|---|
| S1 | Démarrer le simulateur. Ouvrir Manager → Casiers. | Locker de test `ONLINE`, heartbeats réguliers. Le hub de Jimmy n'est ni déconnecté ni modifié. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | `clientId` `aegis-locker-sim-…` |
| S2 | Mobile, technicien titulaire de la réservation de A7 (refaite si annulée) : préparer le retrait, puis présenter le QR selon D2. | Opération `AWAITING_LOCAL_PROOF`, défi affiché par le simulateur seul. Après le scan : **une** commande corrélée vers le bon compartiment. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | operationId ; **jeton jamais copié dans la preuve** |
| S3 | Scénario : porte ouverte puis fermée, absence stable du tag attendu. Suivre le mobile, puis Manager → Opérations, Prêts et le dossier. | **Exactement un prêt confirmé** après la séquence complète. Le mobile affiche la confirmation serveur. Le Manager suit l'opération jusqu'à son état terminal (#186). Audit concordant. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |
| S4 | Retour, cas d'anomalie : préparer et autoriser le retour, puis porte ouverte et fermée **sans** le tag attendu. | `ANOMALY` (`EXPECTED_ASSET_NOT_OBSERVED`), prêt `RETURN_PENDING`. Le mobile n'annonce pas de retour réussi. Le Manager affiche l'anomalie `OPEN`. Un nouveau retour est refusé tant qu'elle est `OPEN` (règle 1). | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |
| S5 | Reprise, après l'acquittement de A9 (l'anomalie reste non résolue) : le détenteur prépare un nouveau retour, présente le QR, le scénario dépose le tag attendu de façon stable. | Retour proposé de nouveau après l'acquittement. Prêt `COMPLETED`, anomalie `RESOLVED` avec sa preuve, audit `ANOMALY_RESOLVED`. **Aucune impasse.** | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |
| S6 | Après S5, comparer mobile (« Mon activité ») et Manager (Prêts, Opérations, dossier de l'actif, Audit), puis actualiser les deux. | Mêmes faits des deux côtés : un prêt terminé, aucune opération ouverte, readiness recalculée (l'actif n'est pas forcément `READY`). | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |
| S7 | Pendant une préparation `AWAITING_LOCAL_PROOF`, arrêter le simulateur (`Ctrl+C`), puis le redémarrer. | Nouvelle session : l'ancien défi est invalidé et un scan de ce QR ne produit aucune commande (comme C6.6). Le mobile n'annonce aucun succès ; le Manager montre l'état de l'opération sans la déclarer réussie. | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN | |

Ces lignes ne valent **pas** C1 à C5 : la partie C reste requise pour chaque carte physique.

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

## C — Validations matérielles restantes (hub de Jimmy)

Cartes : #43, #44, #46, #47, #50, #51 et leurs prérequis matériels : écran #45, porte et
serrure #42/#21, RFID #19, bus #20. Le QR est affiché par l'écran du hub et lu par la
caméra de l'iPhone (ADR-019 a retiré le module caméra du hub). Les seuils QR, porte, RFID et
caméra et leur ordre viennent des contrats approuvés et du POC (docs 05, 06 et 10) :
**ne pas les improviser pendant la recette.**

**Préalables, tous obligatoires :**

- [x] Logiciel fusionné dans `dev` : préparation et défi #172, autorisation par QR #173,
  retrait #175, retour #176 et #177 (toujours déployés **ensemble**), reprise #200 ;
  mobile #198 et #199.
- [ ] Ce logiciel **déployé** sur staging au SHA de la section 0 ; clés
  `AEGIS_DISPLAY_KEYS` / `AEGIS_DISPLAY_ACTIVE_KEY_ID` provisionnées par le responsable
  Railway (jamais leur valeur ici).
- [ ] Partie B réussie avec le hub de Jimmy.
- [ ] Casier autorisé du broker basculé sur celui de Jimmy, avec reconnexion vérifiée
  (« Bascule du casier autorisé », étape 3).
- [ ] Build mobile du SHA de la section 0 installé sur un appareil réel, caméra comprise
  (le simulateur Apple de la CI ne prouve pas la caméra).
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
| C6.9 | **Retour** : préparer et autoriser le retour, ouvrir puis refermer **sans déposer** l'actif attendu (lecteur sain) | `ANOMALY` (`EXPECTED_ASSET_NOT_OBSERVED`, doc 05 §5.4). Le prêt reste `RETURN_PENDING`. Un nouveau retour est **refusé tant que l'anomalie est `OPEN`** (règle 1) | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.9b | Suite de C6.9 : l'administrateur acquitte l'anomalie dans le Manager (note), puis le détenteur prépare un nouveau retour, scanne, dépose l'actif et referme | Retour proposé de nouveau après l'acquittement. Preuve cohérente : prêt `COMPLETED`, anomalie `RESOLVED` avec sa preuve, un audit `ANOMALY_RESOLVED` (règle 1). Si cette tentative échoue aussi : nouvelle anomalie `OPEN`, même chemin après son acquittement, **aucune impasse** | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.10 | **Retrait** : l'actif attendu est retiré, mais un **autre** tag reste lu dans la cellule ciblée | `CONFIRMED`, un seul prêt : l'absence stable du tag attendu prime (règle 5, K14) | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.10b | **Retour** : un **autre** tag est lu au moins trois fois, de façon stable, dans la cellule ciblée | `ANOMALY` (`UNEXPECTED_ASSET_OBSERVED`), prêt non clôturé. Moins de trois lectures, ou des doublons d'une même lecture, ne suffisent pas (règle 7, seuil à requalifier par POC-01 et ADR-003) | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.11 | Retrait ou retour : lectures contradictoires ou localisation ambiguë (par exemple, tag lu dans deux cellules) | `ANOMALY` (`INCONSISTENT_PHYSICAL_STATE`, doc 05 §5.4) | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.12 | Deux scans quasi simultanés du même QR | Exactement une commande | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.13 | **Retrait** : ouvrir puis refermer correctement **sans retirer** l'actif (lecteur sain, tag toujours présent) | Opération non terminale jusqu'à `expiresAt` (preuve incomplète), puis `ANOMALY` (`INCONSISTENT_PHYSICAL_STATE`). **Aucun prêt** créé | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.15 | Pendant `AWAITING_LOCAL_PROOF`, l'administrateur passe l'actif en maintenance, puis le technicien scanne le QR | Refus. Opération `FAILED` / `LOCAL_PROOF_GUARD_FAILED`, défi invalidé, écran effacé, aucune commande ; un second scan du même QR est refusé (règle 3). Un refus transitoire (cellule non sûre, autre opération en cours) ne change rien (règle 4) | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |
| C6.14 | Retrait ou retour : après un accusé et une porte ouverte puis fermée valides, le scan d'évaluation est `FAULTED` ou `UNKNOWN` | `ANOMALY` (`INCONSISTENT_PHYSICAL_STATE`) **dès ce constat**, sans attendre l'échéance et sans conclure présence ni absence. Aucun prêt créé au retrait ; aucun prêt clôturé au retour | ☐ PASS ☐ FAIL ☐ BLOCKED ☐ NOT RUN |

**Absence normale au retrait.** Au retrait, l'absence stable du tag attendu après la
fermeture, avec un lecteur sain, est la **preuve nominale** (doc 06 §10.2) : c'est C3, pas
une anomalie. Elle ne doit jamais être consignée comme `EXPECTED_ASSET_NOT_OBSERVED`.

**Règles QR, retrait et retour validées par Philippe le 21 novembre** ([#67](https://github.com/PhilJordan18/aegis/issues/67#issuecomment-7064405022)) :
récupération après anomalie acquittée (C6.9b), accusé d'affichage tardif rejeté, garde
définitive au scan (C6.15), gardes transitoires, tag étranger au retrait (C6.10), lecteur
non sain après la fermeture (C6.14), tag étranger au retour (C6.10b). Les seuils restent à
requalifier par POC-01.

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
- Chaque `BLOCKED` nomme le prérequis manquant et son responsable : Railway, Philippe,
  Jimmy, iOS, Backend ou Web.
- Le résumé sépare les lignes de nature **simulée** (partie S) des lignes **réelles**
  (parties B et C). Une carte physique ne passe pas à « Done » sur la seule partie S.
- Publier le résumé sur #67 avec les liens vers les consignations par carte.

## Prérequis et responsables (résumé)

| Prérequis | Responsable | Nécessaire pour |
|---|---|---|
| SHA API/Web déployés, migrations, HTTPS | Responsable Railway | A, S, B, C |
| Comptes de test administrateur et technicien (mots de passe hors GitHub) | Philippe | A, S, C |
| Lecture opérateur du QR simulé (saisie D2) | À désigner par Philippe | S |
| Compte MQTT du locker simulé, distinct de celui du hub | Responsable Railway | S |
| Identifiants MQTT rotés (#24), DNS, port, CA | Responsable Railway | S, B, C |
| `AEGIS_DISPLAY_KEYS` / `AEGIS_DISPLAY_ACTIVE_KEY_ID` provisionnées | Responsable Railway | S, C |
| Build Debug du mobile (URL d'API staging) pour A et S ; build sur iPhone avec caméra pour C | Propriétaire iOS | A, S, C |
| Bascule du casier autorisé entre S et C, isolation confirmée avant S | Responsable Railway | S, C |
| Écran du hub #45 (affichage du QR) | Jimmy | C1 |
| Lecture du QR par la caméra de l'iPhone | Propriétaire iOS | C2, C4, C6 |
| Porte et serrure #42/#21 | Jimmy | C2 à C6 |
| RFID #19, bus #20 | Jimmy | C3 à C6 |
