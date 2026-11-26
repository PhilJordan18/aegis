# Extension de compte de recette persistante — candidat #230

**Préparée et testée hors staging ; non installée.** Ce composant corrige la construction des fichiers au démarrage. Il ne recharge pas un broker en fonctionnement et ne change pas ses variables Railway.

## Défaut observé

Au 25 novembre, le démarrage du broker régénère deux identités de base et recopie `/opt/aegis/acl`. L'identité supplémentaire `aegis_api_recipe_223` dépend d'une réapplication manuelle. Le suffixe stocké sur volume est ancien (display seul), alors que l'ACL active sur disque autorise les commandes globales. Rejouer aveuglément `reapply.sh` n'est pas une reprise valide.

## Intégration à préparer dans l'image du broker

L'image Railway actuelle vient d'un bundle opérateur, pas d'un Dockerfile présent dans `dev`. Avant promotion, son propriétaire doit versionner sa construction TLS et y intégrer ce hook. **Ce dépôt ne fournit donc pas encore une image Railway complète et déployable.** Aucun remplacement de l'image courante n'est autorisé par le seul ajout de ce script.

1. Préparer un bundle privé sur le volume persistant avec trois fichiers :
   - `account.hash` : une ligne Mosquitto `$7$` pour `aegis_api_recipe_223`, sans nouveau mot de passe en clair ;
   - `locker-id` : l'UUID exact du seul casier autorisé ;
   - `commands-enabled` : `false` pour QR seul, `true` uniquement pour une séance physique autorisée.
2. Propriétaire root, dossier `0700`, fichiers `0600`. Copier un hash existant seulement par un canal privé, jamais dans les logs/diff/argv. Le renouvellement du secret reste une opération distincte.
3. Après génération des identités et de l'ACL de base **propres**, mais avant le `chown` final et avant `exec mosquitto`, appeler :

   ```sh
   sh /opt/aegis/install-recipe-overlay.sh /run/aegis-mqtt /mosquitto/data/recipe-230
   ```

4. Garder `set -eu` : un bundle absent, corrompu ou une identité déjà présente arrête le démarrage. Ne pas ignorer le code de sortie et ne pas utiliser ce hook après démarrage.
5. Appliquer ensuite les propriétaires Mosquitto et droits `0700`/`0600` comme dans le bootstrap TLS existant. Exécuter `mosquitto --test-config` sur le candidat avant `exec`.
6. Tester l'**image finale** après démarrage à froid et redémarrage, avec TLS, comptes de base et volume persistant. Les tests ci-dessous couvrent le hook, pas encore cette image finale ni la gestion de ses certificats.

L'ACL générée limite les publications `display` et éventuellement `commands` à un UUID. La lecture `events/status` reste globale pour le backend conformément à son ingestion actuelle. Les patterns globaux des identités matérielles sont conservés ; les droits parasites du compte API via `%u` sont explicitement refusés. Le hook ne supprime ni ne réécrit les règles des comptes de base.

Le compte historique `aegis_api` de la base peut toujours avoir ses propres droits globaux : ce correctif n'en change pas le rôle. Une politique production explicite (identités, casiers permis, rotation et droits backend) reste nécessaire avant création des secrets production.

## Vérification isolée

Depuis la racine :

```sh
python3 -B infra/mqtt/railway/test_overlay.py
```

Docker doit être disponible. L’image Mosquitto 2.1.2 est figée par digest dans le test. Le test crée uniquement un conteneur `aegis-overlay-230-test-<suffixe>`, sans réseau extérieur ni port publié, avec un secret **synthétique**, puis le supprime. Il vérifie l'authentification et les PUBACK MQTT5 après démarrage et redémarrage : publications autorisées au casier ciblé, refus des autres casiers et de l'usurpation d'événements. Il vérifie également le mode QR seul, le refus d'une deuxième application et l'arrêt sur bundle invalide. Sans abonné, `RC:16` est un succès de publication sans destinataire ; `RC:135` est le refus attendu. Ce test ne prétend pas mesurer la livraison d'une commande à un appareil.

## Application et retour arrière

Avant une application humaine : aucune opération non terminale ni commande en vol, état du prêt connu, SHA/configuration sauvegardés confidentiellement, fenêtre convenue avec Jimmy. Ne pas masquer le prêt actif par SQL. Désactiver la publication pendant le remplacement, installer le bundle et l'image revus, confirmer la reprise et les ACL par tests isolés ; pas de commande vers une serrure pour vérifier une ACL.

Un retour arrière restaure l'image et le bundle compatibles ensemble. Ne pas réutiliser l'ancien `block.acl` divergent. En cas d'échec d'authentification, garder les dispatchers désactivés jusqu'à reprise vérifiée ; ne pas revenir silencieusement au compte global. Préserver toutes les outbox, commandes, observations et opérations.
