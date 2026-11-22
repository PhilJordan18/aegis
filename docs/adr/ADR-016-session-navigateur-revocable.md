# ADR-016 — Session navigateur révocable pour le Manager

**Statut :** ACCEPTED — Philippe, 18 novembre 2026 (choix « Refresh cookie » sur #178); implémentation livrée par la PR de #178

**Date de la décision :** 18 novembre 2026

**Liens :** ADR-007; document 08, §4.2; document 09, §4.1, §4.2, §9.1, §10.2, §10.4 et §10.5; issue #178

## Décision antérieure

L’ADR-007 retient un JWT de 60 minutes sans refresh token. Le jeton Web reste en mémoire, hors de `localStorage` et de `sessionStorage`. L’ADR accepte explicitement une reconnexion après un rechargement du Web et n’ajoute « aucun deuxième mécanisme Web distinct » au P0. Le document 09 (§4.2) le répète : « Le rechargement du Web impose une reconnexion. »

## Raison du changement

Sur le Manager de staging, chaque actualisation d’une page protégée renvoie à `/connexion` (#178). Le comportement est conforme au contrat :

- `session.ts` garde le jeton dans une fermeture JavaScript, que le rechargement vide;
- `RequireAdminSession` voit alors une session anonyme et remplace l’entrée d’historique.

Le serveur n’invalide rien : le jeton reste valide jusqu’à son expiration, mais le navigateur l’a perdu. Pour un administrateur qui consulte des dossiers, ouvre des liens directs et rafraîchit les listes, ce compromis s’est révélé inacceptable. Philippe demande que la session survive au rechargement tant qu’elle est valide. Il refuse deux contournements : allonger indéfiniment les sessions, et stocker un jeton de façon persistante sans revue de sécurité.

## Nouvelle décision

1. **Jeton d’accès inchangé.** Le JWT HS256 de l’ADR-007, d’au plus 60 minutes, reste l’unique créance des routes protégées. Il reste en mémoire dans le Web et dans le Keychain sur iOS. Il n’est jamais écrit dans un stockage du navigateur.
2. **Session navigateur explicite.** `POST /auth/login` accepte un champ optionnel `browserSession: true`. Avec ce champ et une origine autorisée, la réponse pose un cookie en plus du corps habituel :

   ```http
   Set-Cookie: __Secure-aegis_session=<256 bits aléatoires, base64url>; Path=/api/v1/auth/session; Max-Age=28800; HttpOnly; Secure; SameSite=Strict
   ```

   - **iOS :** il n’envoie pas ce champ et ne reçoit aucun cookie.
   - **Origine absente ou non autorisée :** la demande est refusée par `403 FORBIDDEN`, avant toute vérification du mot de passe.
3. **Stockage serveur.** La table `aegis.browser_sessions` ne garde que l’empreinte SHA-256 du cookie, le compte, son rôle, le début, la fin absolue et la révocation éventuelle. Une lecture de la base ne donne aucune créance utilisable.
4. **Durée absolue.** La session dure 8 heures par défaut (`AEGIS_WEB_SESSION_LIFETIME`). Le maximum de 12 heures est imposé par l’application et par une contrainte SQL. Aucun rafraîchissement ne prolonge cette fin, et le cookie n’est pas renouvelé : deux onglets rechargés ensemble ne s’invalident pas l’un l’autre.
5. **Restauration.** `POST /auth/session/refresh` lit le cookie, relit le compte et émet un nouveau jeton d’accès. L’expiration de ce jeton est le plus tôt de deux instants : 60 minutes après l’émission, ou la fin de la session. La route répond `401 AUTH_SESSION_INVALID` et efface le cookie dans quatre cas :
   - cookie absent, mal formé ou inconnu;
   - session révoquée;
   - session échue;
   - compte qui ne peut plus se connecter ou dont le rôle a changé. Ce dernier cas révoque aussi la session, définitivement.
6. **Déconnexion réelle.** `POST /auth/session/revoke` révoque la session côté serveur et efface le cookie. La route est idempotente : elle répond `204`, avec ou sans cookie.
7. **Défense CSRF.** Les trois usages du cookie (pose, restauration, révocation) exigent un en-tête `Origin` égal à une origine de `AEGIS_WEB_ALLOWED_ORIGINS`, liste exacte. Une origine en `http` n’est admise que pour `localhost`. Ce contrôle s’ajoute à `SameSite=Strict` et à la portée du cookie, limitée à `/api/v1/auth/session` : aucune route métier ne lit le cookie, et il ne remplace jamais l’en-tête `Authorization`. Sans origine configurée, aucune session navigateur ne démarre, et le Web se comporte comme sous l’ADR-007.
8. **Autorisation inchangée.** Les rôles et droits restent vérifiés sur chaque requête protégée (ADR-007). Un jeton restauré pour un technicien reçoit `403` sur l’administration.

## Conséquences

- **Rechargement et liens directs.** Une actualisation ou un lien direct vers une page protégée restaure la session tant qu’elle est valide.
- **Session terminée.** Une session échue ou révoquée renvoie une seule fois à la connexion, sans boucle.
- **Déconnexion.** La déconnexion explicite devient une révocation serveur, effective après un rechargement.
- **Jeton déjà émis.** Une copie du jeton d’accès émise avant la déconnexion reste utilisable jusqu’à son expiration, au plus 60 minutes. C’est le compromis de l’ADR-007, qui demeure.
- **XSS.** Un script injecté ne peut pas lire le cookie (`HttpOnly`). Il peut toutefois appeler la restauration depuis la page et obtenir un jeton tant que la session vit. Ce risque existe déjà avec un jeton en mémoire; la politique de contenu du Web reste la défense principale.
- **Exploitation.**
  - Railway doit définir `AEGIS_WEB_ALLOWED_ORIGINS` sur l’API, avec l’origine publique exacte du Manager.
  - Le cookie est posé par le domaine du Manager, à travers son proxy Caddy, sans attribut `Domain`.
  - Une seconde instance de l’API partagerait la table sans difficulté.
- **Données.** La migration `V010` ajoute la table. Ses lignes sont des créances, pas un historique de possession : une ligne terminée peut être supprimée.
- **Clients.** Le Web appelle la restauration au démarrage, avant toute redirection vers la connexion, et la révocation à la déconnexion. iOS est inchangé.

## Sections remplacées

- **ADR-007**, pour le Web seulement :
  - « sans refresh token P0 » devient « sans refresh token, avec une session navigateur révocable de durée absolue »;
  - la reconnexion imposée après un rechargement du Web;
  - « aucun deuxième mécanisme Web distinct n’est ajouté au P0 ».

  Le reste de l’ADR-007 demeure en vigueur.
- **Document 09** :
  - §4.1 : la puce « aucun refresh token n’est émis dans le P0 »;
  - §4.2 : la phrase « Le rechargement du Web impose une reconnexion. »

## Vérification

- **Tests API :** `BrowserSessionApiTests` et `BrowserSessionPropertiesTests`. Ils couvrent :
  - les attributs du cookie et l’empreinte seule en base;
  - le refus d’une autre origine;
  - la restauration et l’expiration plafonnée;
  - la fin absolue;
  - la révocation idempotente;
  - le compte désactivé ou le rôle changé;
  - un technicien sans accès à l’administration;
  - le cookie refusé comme bearer.
- **Tests Web :**
  - rechargement et lien direct;
  - session terminée sans boucle;
  - déconnexion puis rechargement.
- **Preuve sur staging après déploiement :** elle est faite par une personne qui détient un compte non exposé.
