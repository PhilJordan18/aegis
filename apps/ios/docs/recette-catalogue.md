# Recette du catalogue technicien (#34) sur simulateur

Cette recette fait suivre à une personne le vrai parcours du technicien, sur le
Mac de Philippe : l'application iOS sur un simulateur, contre l'API construite
depuis `dev`. Elle complète les tests automatiques sans les remplacer.

- **Propriétaire du document :** l'équipe iOS. La section « Démarrer l'API et
  les données » est tenue par l'équipe API et reproduite telle quelle.
- **Prérequis :** #101 à #105 et #107 fusionnées dans `dev`. Avant ces fusions,
  `dev` n'a pas `GET /assets` : le catalogue y affiche une erreur contrôlée,
  et la recette ne peut pas être faite.
- **Aucun secret** n'apparaît ici. Les mots de passe restent dans
  `~/.config/aegis/local-api.env` et ne sont jamais affichés.
- Le simulateur suffit pour cette première recette. Aucun iPhone physique ni
  aucune signature d'appareil n'est nécessaire.

## Ce que cette recette distingue

| Catégorie | Contenu | Où |
|---|---|---|
| Tests automatiques exécutés | Recettes `standalone` et `live`, build Release | [Tests automatiques](#tests-automatiques-exécutés) |
| Recette manuelle, contre l'API réelle | Les 10 étapes, le scénario réseau, l'anglais | [Parcours manuel](#parcours-manuel) |
| Scénarios sur fixtures uniquement | Recherche, pagination, fiche disparue, tailles d'accessibilité, mode sombre | [Fixtures uniquement](#scénarios-prouvés-sur-fixtures-uniquement) |
| Essais physiques non réalisés | iPhone réel, casier, présence d'un équipement | [Non réalisé](#essais-physiques-non-réalisés) |

Un équipement « Prêt » ne peut pas être vu contre l'API réelle : aucune preuve
physique n'existe avant PHY-02 (#31). Les équipements non bloqués s'affichent
« À vérifier ». C'est le résultat attendu, pas un défaut.

## Démarrer l'API et les données

Cette section est tenue par l'équipe API. La recette utilise une base dédiée, `aegis_recette`, sur le PostgreSQL local `aegis-dev` (127.0.0.1:5432). Elle n'utilise jamais `aegis` ni `aegis_test`. L'API écoute sur `http://127.0.0.1:8080/api/v1`.

### 1. Copie de travail de la recette

Une copie détachée de `dev` laisse intacte la copie de travail de Philippe. Le SHA testé est celui de cette copie.

```bash
cd ~/Projects/aegis
git fetch origin
git worktree add --detach ~/Projects/aegis-recette origin/dev   # la première fois seulement
git -C ~/Projects/aegis-recette switch --detach origin/dev       # les fois suivantes
git -C ~/Projects/aegis-recette rev-parse --short HEAD           # à noter : SHA testé (API et iOS)
```

### 2. Secrets locaux, jamais affichés

Le fichier `~/.config/aegis/local-api.env` est hors du dépôt, en mode 600. Il contient `AEGIS_DB_PASSWORD`, `AEGIS_JWT_SECRET`, `AEGIS_DEMO_ACCOUNTS_ENABLED`, `AEGIS_DEMO_ADMIN_PASSWORD` et `AEGIS_DEMO_TECHNICIAN_PASSWORD`. Ne jamais l'afficher, que ce soit avec `cat`, `echo` ou `env`. On le charge seulement avec `set -a; . ~/.config/aegis/local-api.env; set +a`.

S'il n'existe pas, le créer une fois, avec des mots de passe aléatoires :

```bash
umask 077; mkdir -p ~/.config/aegis
{ echo "AEGIS_DB_PASSWORD=local-demo-db-password-change-me"
  echo "AEGIS_JWT_SECRET=$(openssl rand -base64 48)"
  echo "AEGIS_DEMO_ACCOUNTS_ENABLED=true"
  echo "AEGIS_DEMO_ADMIN_PASSWORD=$(openssl rand -hex 16)"
  echo "AEGIS_DEMO_TECHNICIAN_PASSWORD=$(openssl rand -hex 16)"; } > ~/.config/aegis/local-api.env
```

Le mot de passe de la base est celui de l'exemple `infra/docker/.env.example`, réservé au simulateur local.

### 3. PostgreSQL et Mosquitto

```bash
cd ~/Projects/aegis-recette
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml up -d --wait
```

### 4. Base de recette, créée si absente

Cette commande ne supprime jamais rien.

```bash
cd ~/Projects/aegis-recette
dc="docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml"
$dc exec -T postgres psql -U aegis -d aegis -tAc "SELECT 1 FROM pg_database WHERE datname = 'aegis_recette'" | grep -q 1 \
  || $dc exec -T postgres createdb -U aegis aegis_recette
```

### 5. API

Dans le terminal 1, laisser l'API ouverte pendant toute la recette :

```bash
cd ~/Projects/aegis-recette/services/api
set -a; . ~/.config/aegis/local-api.env; set +a
export AEGIS_DB_NAME=aegis_recette AEGIS_DEMO_LOCKER_ENABLED=true
./mvnw spring-boot:run
```

Le démarrage est terminé quand le journal affiche `Started`. Au premier démarrage, Flyway applique les migrations de `V001` à `V006`. Il crée aussi les comptes de démonstration et le casier `AEGIS-DEMO-01`, avec ses cellules A1 et A2.

Dans le terminal 2, vérifier la santé de l'API et les migrations appliquées :

```bash
curl -s http://127.0.0.1:8080/api/v1/system/health; echo
cd ~/Projects/aegis-recette
docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml exec -T postgres \
  psql -U aegis -d aegis_recette -tAc "SELECT string_agg(version, ' ' ORDER BY installed_rank) FROM public.flyway_schema_history WHERE success"
```

Résultats attendus :
- la santé contient `"status":"UP"` ;
- les migrations sont `001 002 002.1 002.2 003 004 005 006`.

### 6. Données de démonstration

Ce script est idempotent : il passe par l'API administrative et réutilise ce qui existe déjà.

```bash
cd ~/Projects/aegis-recette/services/api
set -a; . ~/.config/aegis/local-api.env; set +a
python3 -I scripts/seed-demo-catalog.py
```

Le script relit ensuite le catalogue du technicien et doit afficher `ok` sur les cinq lignes suivantes, avec un code de sortie 0.

| Actif | Readiness | Compartiment |
|---|---|---|
| `AEG-DEMO-001` | `UNKNOWN [UNKNOWN_PHYSICAL_STATE]` | A1 |
| `AEG-DEMO-002` | `BLOCKED [CALIBRATION_EXPIRED]` | A2 |
| `AEG-DEMO-003` | `BLOCKED [ACCESS_DENIED]` | aucun |
| `AEG-DEMO-004` | `UNKNOWN [UNKNOWN_PHYSICAL_STATE]` | aucun |
| `AEG-DEMO-005` | `BLOCKED [MAINTENANCE]` | aucun |

Aucun équipement n'est `READY` : aucune preuve physique n'existe avant PHY-02. C'est le résultat attendu, pas un défaut.

### 7. Connexion du technicien sans afficher le mot de passe

- Adresse : `technician@aegis.demo`.
- Mot de passe : le copier dans le presse-papiers sans l'afficher, puis le coller dans le simulateur avec Cmd+V :

```bash
(set -a; . ~/.config/aegis/local-api.env; printf %s "$AEGIS_DEMO_TECHNICIAN_PASSWORD" | pbcopy)
```

Après la recette, vider le presse-papiers avec `pbcopy < /dev/null`.

### 8. Arrêt et reprise, sans suppression

- Arrêter l'API avec Ctrl+C dans le terminal 1.
- Arrêter l'infrastructure avec `docker compose --env-file infra/docker/.env.example -f infra/docker/compose.yaml down`. Les volumes sont conservés. Ne jamais ajouter `--volumes` et ne jamais lancer `dropdb`.
- Pour reprendre, refaire les étapes 3, 5 et 6. La base `aegis_recette` est réutilisée, les migrations déjà appliquées ne sont pas rejouées et le script de données ne recrée rien.
- Si une base vierge est nécessaire, en créer une nouvelle (par exemple `aegis_recette_2`, avec la même commande qu'à l'étape 4) et l'exporter dans `AEGIS_DB_NAME`. Aucune base n'est supprimée sans l'accord de Philippe.

### 9. Suite automatique de l'API

Cette suite complète la recette. Elle utilise ses propres bases temporaires.

```bash
cd ~/Projects/aegis-recette/services/api
AEGIS_DB_PASSWORD=local-demo-db-password-change-me ./mvnw test
```

Résultat attendu : `BUILD SUCCESS` et 0 échec. Le nombre de tests est inscrit dans le rapport de recette du SHA testé.

## Lancer l'application

L'application de la recette est compilée depuis la même copie
`~/Projects/aegis-recette`. Le SHA testé est donc le même pour l'API et pour
iOS. En Debug, l'application vise `http://localhost:8080/api/v1`, qui est
l'API du terminal 1.

1. Ouvrir `~/Projects/aegis-recette/apps/ios/AegisMobile.xcodeproj` dans
   Xcode 26.3.
2. Choisir le schéma **AegisMobile** et la destination **iPhone 17**
   (iOS 26.3.1). L'**iPhone SE (3rd generation)** (iOS 17.5) peut servir pour
   un second passage sur petit écran.
3. Product › Run (⌘R). Le simulateur s'ouvre sur l'application.
4. Pour choisir la langue sans toucher aux réglages du simulateur, arrêter
   l'exécution dans Xcode (⌘.), puis relancer depuis le terminal 2.

   En français :

   ```bash
   xcrun simctl terminate booted com.example.aegis.mobile
   xcrun simctl launch booted com.example.aegis.mobile -AppleLanguages "(fr)" -AppleLocale fr_CA
   ```

   En anglais :

   ```bash
   xcrun simctl terminate booted com.example.aegis.mobile
   xcrun simctl launch booted com.example.aegis.mobile -AppleLanguages "(en)" -AppleLocale en_CA
   ```

   Ces commandes visent le seul simulateur démarré. L'identifiant
   `com.example.aegis.mobile` est celui de la configuration par défaut,
   `Config/Shared.xcconfig`.

Si l'application s'ouvre déjà connectée, d'un essai précédent : onglet
**Compte**, puis **Se déconnecter**, puis confirmer.

Pour une capture : dans le simulateur, File › Save Screen (⌘S). L'image est
enregistrée sur le Bureau.

## Parcours manuel

Contre l'API réelle, en français, en mode clair. Cocher OK ou KO et noter
toute différence.

| N° | Action | Résultat attendu | OK / KO | Remarque |
|---:|---|---|---|---|
| 1 | Lancer l'application en français (voir ci-dessus). | L'écran de connexion s'affiche. Aucune donnée d'équipement n'est visible. | | |
| 2 | Saisir `technician@aegis.demo`, coller le mot de passe (étape 7 de la section API), puis toucher **Se connecter**. | L'onglet **Équipements** s'ouvre. | | |
| 3 | Lire le catalogue. | Cinq cartes, `AEG-DEMO-001` à `AEG-DEMO-005`. Chacune dit son état en mots : « À vérifier » pour 001 et 004, « Bloqué » pour 002, 003 et 005. Aucun « Prêt ». Sous les cartes : « État évalué à …, heure du casier. » Aucun identifiant RFID n'apparaît. | | |
| 4 | Toucher le filtre **Bloqué**. | Le filtre est sélectionné. Seules 002, 003 et 005 restent. | | |
| 5 | Ouvrir `AEG-DEMO-002`. | La fiche s'ouvre sur l'état « Bloqué », puis la section « Pourquoi il est bloqué ». | | |
| 6 | Lire la raison et les faits. | La raison commence par « Calibration expirée depuis le 1 oct. 2026 à 00:00 HAE ». La date, l'heure et le fuseau sont présents. La ligne **Cellule** indique `A2 · AEGIS-DEMO-01`. | | |
| 7 | Revenir avec le bouton de retour en haut à gauche. | La liste réapparaît, toujours filtrée sur « Bloqué ». | | |
| 8 | Fermer l'application : `xcrun simctl terminate booted com.example.aegis.mobile`. La rouvrir en touchant son icône sur l'écran d'accueil du simulateur. | **Équipements** s'ouvre sans redemander le mot de passe. « Reprise de la session… » peut s'afficher un instant avant. | | |
| 9 | Onglet **Compte**, toucher **Se déconnecter**, puis confirmer « Vous déconnecter ? ». | L'écran de connexion s'affiche avec « Vous êtes déconnecté. ». Après une nouvelle fermeture et réouverture, l'application redemande la connexion. | | |
| 10 | Refaire les étapes 1 à 7 en anglais (voir ci-dessus). | Les écrans essentiels sont en anglais : **Equipment**, **Blocked**, « Why it's blocked », « Calibration expired on … » avec la date, l'heure et le fuseau, **Compartment** `A2 · AEGIS-DEMO-01`, **Account**, **Sign out**. Les codes d'équipement et les noms de modèle ne sont pas traduits. | | |

### Scénario réseau : « Dernier état », puis retour

Ce scénario montre que des données anciennes ne passent jamais pour un état
actuel. Il se fait en français, connecté, sur l'onglet **Équipements**, filtre
**Tous**.

| N° | Action | Résultat attendu | OK / KO | Remarque |
|---:|---|---|---|---|
| R1 | Noter l'heure. Arrêter l'API : Ctrl+C dans le terminal 1. | Rien ne change à l'écran tant que l'application ne relit pas. | | |
| R2 | Tirer la liste vers le bas pour l'actualiser. | Un avis s'affiche au-dessus des cartes : « Connexion au service impossible. Vérifiez le réseau. » et « Informations non actualisées depuis HH:MM. », où HH:MM est l'heure locale de la dernière réception. La liste reste visible, mais chaque carte dit « Dernier état : … », en couleurs neutres (gris), et non « Bloqué » ou « À vérifier » en couleur. La ligne « État évalué à … » disparaît. Le bouton **Réessayer** est présent. | | |
| R3 | Ouvrir `AEG-DEMO-002`. | La fiche reste lisible, avec l'état « Dernier état : Bloqué » et « Informations non actualisées depuis HH:MM. ». Rien n'indique un état actuel. Revenir à la liste. | | |
| R4 | Redémarrer l'API : refaire l'étape 5 de la section API dans le terminal 1, jusqu'à `Started`. Les données sont conservées ; l'étape 6 n'est pas nécessaire. | — | | |
| R5 | Toucher **Réessayer**. | L'avis disparaît. Les cartes retrouvent « Bloqué » ou « À vérifier » en couleur, et « État évalué à …, heure du casier. » revient, avec une heure postérieure à R1. | | |

Si l'application est fermée pendant que l'API est arrêtée, la réouverture
affiche « Connexion au service impossible » avec **Réessayer** : la session est
conservée sans être vérifiée, et aucune donnée n'est montrée. Ce cas est
couvert par les tests automatiques ; il n'est pas une étape de la recette.

### Après #106 (réservation)

Après la fusion de #106 ; script `scripts/check-refused-reservation.py`.
Test négatif : une réservation refusée n'est pas une réservation réussie. La
procédure est dans `services/api/README.md`, section « Test négatif de la
recette ». L'application iOS n'a pas encore d'écran de réservation.

| N° | Action | Résultat attendu | OK / KO | Remarque |
|---:|---|---|---|---|
| N1 | Depuis `services/api`, après le seed, lancer le script selon le README de l'API. | Le script affiche, dans l'ordre : `404 ACTIVE_RESERVATION_NOT_FOUND`, `422 ASSET_NOT_READY ['UNKNOWN_PHYSICAL_STATE']`, `404 ACTIVE_RESERVATION_NOT_FOUND`, et se termine avec le code 0. | | |

### Captures à joindre

Enregistrer les captures avec ces noms, dans le compte rendu de la recette et
non dans le dépôt :

| Nom | Étape |
|---|---|
| `fr-catalogue.png` | 3 |
| `fr-filtre-bloque.png` | 4 |
| `fr-fiche-aeg-demo-002.png` | 6 |
| `fr-reprise-session.png` | 8, après la reprise |
| `fr-deconnecte.png` | 9 |
| `en-catalogue.png` et `en-fiche-aeg-demo-002.png` | 10 |
| `fr-dernier-etat-liste.png` et `fr-dernier-etat-fiche.png` | R2 et R3 |
| `fr-retour-reseau.png` | R5 |

### Grille de résultats

| Champ | Valeur |
|---|---|
| Date et heure | |
| Testeur | |
| SHA de `dev` testé (API et iOS) | |
| Migrations appliquées (étape 5) | |
| Simulateur et version d'iOS | |
| Parcours 1 à 10 : nombre d'OK sur 10 | |
| Scénario réseau R1 à R5 : nombre d'OK sur 5 | |
| Anomalies (étape, observé, attendu) | |

## Tests automatiques exécutés

Commandes et détails : `apps/ios/README.md`, section « Recettes de test ».
Une recette échoue si un test est ignoré.

| Recette | Contre | Appareil | Résultat |
|---|---|---|---|
| `standalone` | fixtures Debug, sans backend | iPhone 17, iOS 26.3.1 | 159 réussis sur 159, 0 ignoré, au commit `4272123` |
| `standalone` | fixtures Debug, sans backend | iPhone SE (3e génération), iOS 17.5 | 159 réussis sur 159, 0 ignoré, au commit `4272123` |
| `live` | API de la branche `33-feat-readiness` (`5788607`), avant fusion | iPhone 17 et iPhone SE | 10 réussis sur 10, le 28 octobre 2026 |
| `live` | API construite depuis `dev` après #105, base `aegis_recette` | iPhone 17 et iPhone SE | à exécuter après la fusion de #105 |
| Build Release | — | simulateur générique | aucun hook, scénario ou fixture de test dans le binaire |

La recette `live` automatise les étapes 2 à 9 du parcours, sans l'anglais ni
le scénario réseau. La recette manuelle vérifie ce qu'une personne voit.

## Scénarios prouvés sur fixtures uniquement

Ces comportements sont couverts par les tests UI sur des données fictives
(`AEGIS_UI_SCENARIO`, Debug seulement), pas contre l'API réelle :

- la recherche par code ou modèle, et la recherche sans résultat ;
- la pagination : les cinq équipements de démonstration tiennent sur une page de 20 ;
- un équipement « Prêt » ;
- une fiche dont l'équipement a disparu (404), avec « Retour à la liste » ;
- les plus grandes tailles de texte et le mode sombre, en français et en
  anglais.

Limite connue : sur l'écran de 375 points de l'iPhone SE, le grand titre
« Équipements » est tronqué aux plus grandes tailles d'accessibilité. Le
contenu garde la taille choisie, et l'onglet et VoiceOver donnent le titre en
entier. La correction est un suivi séparé de #107.

Le scénario réseau ci-dessus reproduit contre l'API réelle ce que les fixtures
prouvent déjà.

## Essais physiques non réalisés

- Aucun iPhone physique : ni installation signée, ni VoiceOver sur appareil.
- Aucun casier, lecteur RFID ni capteur : la présence physique reste inconnue
  jusqu'à PHY-02 (#31). C'est pourquoi aucun équipement n'est « Prêt ».
- iOS 17.0 exact et iOS 18.x ne sont pas testés.
