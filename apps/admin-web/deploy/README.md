# Aegis Manager sur Railway staging

Le service `aegis-web` sert le build de production React avec Caddy 2.11.9.
Le navigateur appelle `/api/v1` sur la même origine que le Web; Caddy conserve
le chemin, la méthode, le corps et les en-têtes d'autorisation et relaie vers
Spring en HTTPS avec vérification du certificat. Spring reste l'autorité métier.
Aucun accès à PostgreSQL ou MQTT n'est ajouté. Aucun réglage CORS n'est requis.

## Préparation et vérification

Depuis `apps/admin-web`, avec Node 24.15.0 :

```sh
npm ci --ignore-scripts
npm run build
npm run lint
npm test
CADDY_BIN=/chemin/vers/caddy python3 scripts/check-hosting.py
```

`npm run build` contrôle les types et l'absence du code d'aperçu. Le dernier
script exige Caddy 2.11.9, Python 3 et OpenSSL. Il démarre une API HTTPS factice
et le vrai Caddyfile sur des ports locaux temporaires, vérifie les liens profonds,
les fichiers JS, les erreurs 401/429/502, la transmission du jeton fictif et le
rejet d'un certificat dont le nom ne correspond pas. Il ne contacte pas staging.

Pour vérifier aussi l'image sur une machine équipée de Docker :

```sh
docker build -t aegis-web:151 .
python3 -I scripts/check-hosting-docker.py aegis-web:151
```

Ce test crée un réseau Docker interne et des conteneurs temporaires aux noms
uniques. Il vérifie l'image construite avec une API HTTPS factice, sans accès
au staging : utilisateur sans privilèges, absence de Node dans l'image finale,
pages, bundles, transmission API, panne amont et refus TLS (nom incorrect ou
certificat non approuvé). Il nettoie uniquement ses propres conteneurs et réseau.

Pour un essai manuel facultatif contre l'API staging :

```sh
docker run --rm -p 127.0.0.1:5182:8080 \
  -e AEGIS_API_HOST=aegis-api-staging-239f.up.railway.app aegis-web:151
```

Cette commande utilise l'API staging : limiter les vérifications à
`/healthz`, `/connexion`, `/api/v1/system/health` et `/api/v1/auth/me` sans jeton.
Les résultats attendus sont respectivement 200, 200, 200 et 401.
Les images de base sont fixées par version; leurs tags ne sont pas des digests
immuables. Les dépendances JavaScript restent verrouillées par `package-lock.json`.

## Clics Railway après intégration approuvée dans dev

1. Dans **aegis → staging**, ouvrir le service **aegis-web**.
2. Connecter `PhilJordan18/aegis`, branche `dev`, avec **Root Directory**
   `/apps/admin-web`. La branche doit contenir les fichiers de l'issue #151.
3. Utiliser le Dockerfile de ce répertoire. Retirer les commandes Build/Start
   personnalisées si elles existent : le Dockerfile fournit les deux étapes.
4. Définir uniquement les variables suivantes :

   | Variable | Valeur |
   |---|---|
   | `PORT` | `8080` |
   | `AEGIS_API_HOST` | `aegis-api-staging-239f.up.railway.app` |

   `AEGIS_API_HOST` est un hôte sans schéma, chemin ou identifiants; HTTPS est
   imposé par le Caddyfile. Aucun mot de passe, JWT, compte DB ou secret MQTT
   n'est nécessaire. Ne pas définir `VITE_AEGIS_PREVIEW`.
5. Choisir une réplique en Virginia, avec le healthcheck `/healthz` et un délai
   de 60 secondes. Le healthcheck valide le serveur Web seulement; la santé
   de Spring est vérifiée séparément via `/api/v1/system/health`.
6. Activer **Wait for CI** et garder les déploiements automatiques désactivés
   pendant la recette. Relire les changements : seul `aegis-web` est concerné.
7. Déployer après approbation, puis générer le domaine public sur le port 8080.
   Railway termine le HTTPS public; Caddy reçoit le trafic interne sur 8080.
8. Vérifier `/healthz`, `/connexion`, le rechargement direct d'une route Web,
   `/api/v1/system/health` et `/api/v1/auth/me` sans jeton (401).
9. Se connecter manuellement comme administrateur, vérifier l'identité et la
   lecture du catalogue puis se déconnecter. Ne créer ni modifier d'actif,
   réservation, placement ou opération pendant les tests de Jimmy.

Les routes `/api` ne passent jamais par le repli SPA, y compris lors d'une
panne de Spring. Un fichier JS manquant répond 404. Le HTML et les assets sont
revalidés (`no-cache`); les réponses API sont `no-store`. Aucun journal d'accès
n'est activé. Les journaux d'erreur Caddy restent disponibles pour le diagnostic.
Le conteneur s'exécute avec un utilisateur sans privilèges et sans volume.

## Retour arrière et limites

Revenir au déploiement Web précédent dans Railway. Lors du premier déploiement,
arrêter uniquement `aegis-web` si la recette échoue. Ne modifier ni les variables
API, ni la base, ni le broker, ni les identifiants du hub. La publication de ce
service ne nécessite aucune migration et ne réactive pas le dispatcher.

Le relais constitue une seule adresse cliente vue par Spring : sa limite de
connexion par adresse peut donc être partagée par les utilisateurs du Web.
Ne pas modifier la confiance accordée aux en-têtes proxy dans cette tranche;
ne pas lancer un test de charge ou de verrouillage des connexions sur staging.

La sauvegarde PostgreSQL et son calendrier sont indépendants de ce service.
La restauration sur une cible isolée et la validation du matériel restent des
étapes distinctes : un déploiement Web réussi ne les valide pas.
