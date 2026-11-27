# Broker Railway reproductible — candidat #230

**Image intégrée et testée hors staging ; non déployée.** Elle reconstruit les identités et applique le hook de recette avant chaque démarrage. Aucun rechargement à chaud ni accès Railway n'est exécuté par les outils de ce dossier.

## Défaut corrigé dans le candidat

Le bootstrap historique régénère deux identités de base et recopie `/opt/aegis/acl`. L'identité `aegis_api_recipe_223` dépendait d'une réapplication manuelle. Son suffixe conservé sur le volume est ancien (display seul), alors que l'ACL active sur disque autorise les commandes globales. Le candidat remplace ce mécanisme divergent par une reconstruction à partir de la base versionnée et d'une politique persistante explicite, à chaque boot.

## Construction et configuration

Depuis la racine du dépôt :

```sh
docker build -f infra/mqtt/railway/Dockerfile -t aegis-broker:230 .
```

L'image Mosquitto 2.1.2 est figée par digest. Le contexte Docker est limité aux seuls fichiers versionnés nécessaires ; aucun certificat, secret ou archive de données n'y entre. Le listener unique est TLS 8883, vérification serveur avec TLS 1.2 minimum, authentification utilisateur/mot de passe, sans mTLS ajouté. Aucun port 1883. Les logs serveur sont limités aux erreurs/avertissements ; le test n'ajoute que des identifiants synthétiques.

Variables privées requises (jamais dans un Dockerfile, un rapport ou un argument de commande) :

- `AEGIS_MQTT_API_PASSWORD` pour l'identité de base `aegis_api` ;
- `AEGIS_MQTT_HUB_PASSWORD` et `AEGIS_MQTT_HUB_ID` pour le hub principal ;
- `MQTT_CA_B64`, `MQTT_CERT_B64`, `MQTT_KEY_B64` pour le certificat serveur et sa chaîne. Le SAN du certificat doit couvrir le nom utilisé par chaque client ; ne pas désactiver sa vérification.

Le secret est écrit uniquement dans un fichier temporaire privé puis haché par `mosquitto_passwd -U`, jamais passé en argv. Les variables secrètes sont retirées avant l'exécution du broker. Le dossier runtime appartient à Mosquitto en 0700, ses fichiers en 0600.

Monter le volume durable en `/mosquitto/data`. Il contient :

| Chemin | Contenu requis |
|---|---|
| `device-accounts.hash` | Inventaire explicite des **autres** identités matérielles, dont le simulateur s'il doit rester connecté. Une ligne `UUID:hash Mosquitto $7$` par identité ; un fichier vide est accepté uniquement lorsque l'inventaire confirme qu'il n'existe aucun autre appareil. Pas de doublon ni de répétition du hub principal. |
| `recipe-230/account.hash` | Une seule ligne hachée pour `aegis_api_recipe_223` ; reprendre le hash connu par canal confidentiel, ne pas changer le mot de passe par inadvertance. |
| `recipe-230/locker-id` | UUID exact du seul casier de recette autorisé. |
| `recipe-230/commands-enabled` | `false` pour QR seul ; `true` uniquement pour une séance physique autorisée. |

Dossiers privés 0700 et fichiers 0600 appartenant à `mosquitto` (UID/GID 1883 dans l’image figée). Le volume existant doit être préparé hors exécution avant la bascule ; le conteneur ne corrige pas ses propriétaires avec des privilèges root. Ne pas copier les mots de passe/QR en chat, logs ou captures. La persistance du broker (`mosquitto.db`) reste indépendante de ces fichiers d'identités. Le volume doit être accessible au broker non privilégié. Le bootstrap et le broker s’exécutent tous deux sous `USER mosquitto` ; seuls les répertoires de l’image sont préparés pendant sa construction.

Le démarrage échoue si une entrée manque ou est malformée. Les identités de base sont reconstruites, les autres appareils préservés via l'inventaire, puis l'overlay est appliqué une seule fois. La configuration est validée avant `exec mosquitto`. Une seconde exécution directe du hook sur une base déjà enrichie est refusée ; **la réapplication se fait par le démarrage normal**, à partir d'une base propre. L'ancien `reapply.sh` ne doit plus être utilisé avec cette image.

L'ACL de base versionnée est conservée : le compte historique `aegis_api` garde son rôle backend global. Le compte de recette ne publie que vers un UUID (`display`, et `commands` si autorisé). Ses lectures `events/status` restent globales pour l'ingestion backend actuelle. Les identités de hubs ne peuvent agir que sous leur UUID ; les expansions parasites de `%u` pour les comptes API sont refusées. Cette séparation ne remplace pas une décision de politique production ni la rotation de ses secrets.

## Vérification isolée

```sh
python3 -B infra/mqtt/railway/test_overlay.py
python3 -B infra/mqtt/railway/test_image.py
```

Docker et OpenSSL doivent être disponibles. Le premier test vérifie le hook et ses entrées malformées. Le second construit le **Dockerfile réel**, génère une CA/certificat et des comptes synthétiques, puis vérifie :

- démarrage TLS à froid, restart du conteneur et recréation du conteneur avec le même volume ;
- authentification des comptes backend, hub principal, autre appareil et recette ;
- publications permises/refusées, absence d'usurpation d'événements, mauvais mot de passe et mauvais nom TLS refusés, port plaintext absent ;
- réception effective d'un message synthétique par le hub sur TLS ;
- aucune duplication d'identité, réapplication de la politique QR seul et arrêt si le bundle disparaît.

Chaque broker utilise `--network none`, aucun port publié et un volume dédié jetable. Le test supprime uniquement ses propres conteneurs, volume et tag d'image. Les certificats/identifiants sont synthétiques et temporaires. Sans abonné, PUBACK MQTT5 `16` est un succès sans destinataire ; `135` est le refus attendu. Aucun message n'est envoyé à Jimmy.

## Préflight et application future

1. Obtenir une fenêtre explicite sans essais humains ni opération/commande en vol. Le prêt Jimmy `3cba970f-cb38-47c2-b6a3-238c4719e11f` est actif dans le dernier inventaire : prévoir son **retour normal** ou une **décision explicite de le conserver** pendant la bascule. Jamais de SQL, force-close ou effacement d'historique.
2. Relever les identités réellement provisionnées et préparer `device-accounts.hash` sans en perdre, notamment le SIM. Relever le casier de recette autorisé. Faire contrôler le paquet privé et son empreinte ; un fichier vide par commodité n'est pas une migration valide.
3. Conserver confidentiellement l'image/configuration/volume précédents et la procédure de reprise cohérente. Vérifier qu'aucune commande en attente ne sera livrée inopinément au redémarrage ; ne pas purger l'outbox.
4. Coordonner l'arrêt de publication API, puis seulement avec l'autorisation de la fenêtre installer les fichiers privés et déployer l'image figée. Ce lot n'effectue pas cette action.
5. Vérifier santé TLS, authentification, fichiers/droits et reprise des connexions/heartbeats ; aucun test d'ouverture réelle pour « vérifier une ACL ». Reprendre les dispatchers uniquement selon le périmètre autorisé.

## Retour arrière

Restaurer image et politique compatibles ensemble, en maintenant les publications désactivées tant que la reprise n'est pas vérifiée. Ne pas restaurer aveuglément l'ancien suffixe `block.acl` divergent, ni basculer silencieusement l'API vers le compte global. Préserver le volume broker et tous les historiques/outbox/commandes côté backend. Une restauration de données ancienne sur les opérations récentes n'est pas un rollback applicatif.
