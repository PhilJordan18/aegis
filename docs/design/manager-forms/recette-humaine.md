# Recette humaine du Manager (Web)

Parcours courts à dérouler à la main dans le Manager, contre l'API réelle. Ils
couvrent #25 (catalogue), #26 (identifiants et placement), #28 (horaire), la
saisie de calibration au changement d'heure (#141), la recherche (#109) et les
erreurs signalées par le casier (#29). Ce sont des contrôles d'acceptation, pas
une preuve matérielle : **le casier et ses messages viennent du simulateur de
hub**, jamais d'un ESP32 réel.

La recette automatisée correspondante est `npm run test:e2e:api` (12 tests,
`apps/admin-web/README.md`). Le parcours broker → API → Manager des erreurs
signalées est `apps/admin-web/scripts/check-device-errors-live.sh`. Sur `dev`
`49bf5f8`, ces deux recettes passent (12/12, puis W1 et W2), ainsi que le projet
Playwright `forms` (28/28) qui couvre la saisie au changement d'heure.

## Préparation

1. Lancer l'API de `dev` avec les comptes et le casier de démonstration
   (`services/api/README.md`, « Pour lancer l'API »), puis peupler le catalogue :
   `python3 -I services/api/scripts/seed-demo-catalog.py`.
2. Dans `apps/admin-web` : `npm ci`, puis `npm run dev:api`, et ouvrir
   `http://localhost:5173/connexion`.
3. Se connecter avec le compte administrateur de démonstration.

Noter pour chaque étape : conforme, ou l'écart observé, avec une capture.

## 1. Catalogue (#25)

- [ ] **Modèles**, puis **Nouveau modèle** : créer « Recette <date> ».
  Attendu : le modèle apparaît dans la liste.
- [ ] **Exemplaires**, puis **Nouvel exemplaire** : choisir ce modèle et le code
  `REC-001`, puis cliquer sur **Créer**. Attendu : le dossier de l'exemplaire
  s'ouvre.
- [ ] Recommencer avec le même code. Attendu : « Ce code est déjà utilisé,
  exemplaires archivés compris. », sur le champ du code. Rien n'est créé.
- [ ] **Modifier** : passer le statut opérationnel à « En maintenance », puis
  enregistrer et recharger la page. Attendu : la valeur est relue.
- [ ] **Archiver**, puis confirmer. Attendu : le dialogue s'ouvre sur
  « Annuler ». Une fois archivé, l'exemplaire n'offre plus aucune action, et
  son code reste réservé.
- [ ] Ouvrir `AEG-DEMO-002`. Attendu : bloqué pour calibration expirée. Aucun
  bouton ne force l'état prêt.

## 2. Calibration et changement d'heure (#141)

Dans **Nouvel exemplaire**, choisir un modèle avec calibration requise, puis
saisir l'échéance :

- [ ] `2026-03-08 02:30`, puis **Créer**. Attendu : « Cette heure n'existe pas
  ce jour-là… ». Aucune requête n'est envoyée et l'heure n'est pas déplacée à
  03:30.
- [ ] `2026-11-01 01:30`. Attendu : deux choix, dont aucun n'est présélectionné,
  « La première : 01 h 30 HAE (UTC−04:00) » et « La seconde : 01 h 30 HNE
  (UTC−05:00) ». Sans choix, **Créer** affiche une erreur sur le groupe.
- [ ] Choisir « La seconde », puis créer. Attendu : en modification, la seconde
  occurrence reste présélectionnée.

## 3. Identifiants et placement (#26)

Dans le dossier d'un exemplaire placé, par exemple `AEG-DEMO-001` :

- [ ] **Attribuer un identifiant** : RFID, avec une valeur nouvelle. Attendu :
  elle est listée comme active.
- [ ] Attribuer la même valeur à un autre exemplaire. Attendu : un refus sur le
  champ de la valeur. Rien n'est écrit.
- [ ] **Révoquer**, puis confirmer. Attendu : le dialogue s'ouvre sur
  « Annuler ». L'identifiant reste dans l'historique, marqué révoqué.
- [ ] **Modifier le placement** : choisir une cellule occupée par un autre
  exemplaire et indiquer un motif. Attendu : un refus sur le champ de la
  cellule. Le placement reste le même.

## 4. Horaire d'exploitation (#28)

Dans **Casiers**, cliquer sur **Modifier l'horaire** :

- [ ] Le fuseau `America/Toronto` est affiché. Les sept jours sont lus depuis
  le serveur.
- [ ] Lundi : fermeture `06:00` après une ouverture `07:00`, puis
  **Enregistrer**. Attendu : « La fermeture doit suivre l'ouverture, le même
  jour. », sur le champ concerné. Rien n'est envoyé.
- [ ] Corriger, puis enregistrer. Attendu : l'horaire est relu, et la fenêtre
  courante du statut suit le verdict du serveur.

## 5. Recherche (#109)

Dans **Exemplaires**, champ « Rechercher un exemplaire » :

- [ ] `  rec-001  `, avec des espaces autour. Attendu : `REC-001` est trouvé, et
  l'adresse contient `q=rec-001`, sans les espaces.
- [ ] 101 caractères `a`. Attendu : un refus sur le champ, sans requête.
- [ ] 100 caractères `é` composés (`e` suivi de U+0301). Attendu : la recherche
  est acceptée, car chaque caractère compte pour un graphème.
- [ ] **Tout afficher**. Attendu : le champ se vide et la liste complète revient.

## 6. Erreurs signalées par le casier (#29, simulateur)

Disponible sur `dev` depuis `49bf5f8` (#142 puis #148). Le hub est **simulé**.

- [ ] Avant toute session du hub : la section « Erreurs signalées » affiche
  « Aucun signal reçu du casier ».
- [ ] Faire jouer au simulateur `invalid-inbound-local.json`, depuis
  `tools/hub-simulator` :
  `npm start -- --scenario scenarios/invalid-inbound-local.json`. Attendu, au
  rafraîchissement suivant (15 s au plus) :
  - deux groupes « Avertissement · Message reçu invalide », l'un sur le casier
    entier avec 3 signalements, l'autre sur la cellule A1 avec 1 signalement ;
  - les heures de réception affichées.
- [ ] Environ 30 s après l'arrêt du simulateur. Attendu : la pastille indique
  « Hors ligne », les mêmes groupes restent affichés, et une note dit que la
  liste peut ne plus refléter l'état du casier.
- [ ] Les erreurs ne changent ni la disponibilité ni les actions : la page n'a
  qu'un bouton, « Modifier l'horaire ».

## Fin de recette

Reporter le résultat (date, SHA de `dev`, navigateur, conforme ou écarts) en
commentaire sur l'issue de chaque parcours. Un parcours conforme sur le
simulateur ne vaut pas validation matérielle.
