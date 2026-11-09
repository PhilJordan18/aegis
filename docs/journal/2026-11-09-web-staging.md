# 9 novembre 2026 — préparation du Web staging (#151)

À la demande de Philippe, Codex a créé l'issue #151 et préparé une branche
isolée `151-build-web-staging` depuis `dev` (`023ab51`). L'assistance a couvert
le Dockerfile, le serveur Caddy, le test d'hébergement et la procédure Railway.
Philippe reste responsable de la revue, de la livraison et du déploiement.

Le serveur sert le build React et relaie `/api` en HTTPS vers Spring, sans
changer l'authentification ni les contrats. Aucun accès au broker, aucune
publication MQTT, aucune migration et aucune intervention sur le firmware de
Jimmy n'ont été effectués dans cette tranche.

Vérifications locales, Node 24.15.0 et Caddy 2.11.9 :

- `npm run build` : types et build réussis, code d'aperçu exclu;
- `npm run lint` : réussi;
- `npm test` : 47 fichiers, 862 tests réussis;
- `CADDY_BIN=/chemin/vers/caddy python3 -I scripts/check-hosting.py` : sept
  groupes de contrôles réussis, dont TLS avec nom incorrect refusé, chemins
  conservés, erreurs API conservées et panne amont sans repli HTML;
- Après redémarrage de Docker par Philippe : `docker build -t aegis-web:151 .`
  réussi; `python3 -I scripts/check-hosting-docker.py aegis-web:151` réussi
  sur un réseau Docker interne, avec une API HTTPS factice. Utilisateur 10001,
  absence de Node dans l’image finale, routes SPA, proxy et refus TLS vérifiés;
- `npm audit` : 13 alertes préexistantes (10 modérées, 3 élevées), aucun
  changement de `package.json` ou du verrou; analyse/correction à suivre.

Le test d'hébergement utilise une API HTTPS factice et des données fictives,
uniquement en boucle locale. Il ne valide ni la connexion réelle dans le
navigateur, ni le déploiement Railway, ni une restauration PostgreSQL.

Après le premier contrôle SonarQube de la PR #152, Codex a remplacé la réponse
réfléchissant les données du POST dans l'API factice native par une réponse
fixe. Les données restent contrôlées via une file en mémoire. Les huit groupes
de contrôles natifs passent, dont un test de non-réflexion d'un contenu HTML.
Aucune règle SonarQube n'a été désactivée; aucun fichier de production modifié.
