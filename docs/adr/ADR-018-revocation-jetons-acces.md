# ADR-018 — Révocation des jetons d’accès déjà émis

**Statut :** ACCEPTED — Philippe, 21 novembre 2026, options A + B; tranche suivante explicitement suivie par l’issue #179, après la fusion de #178

**Date de la décision :** 21 novembre 2026

**Liens :** ADR-007; ADR-016; ADR-017; document 09, §4.1, §4.2, §10.5 et §10.6; issues #178 et #179

## Décision antérieure

L’ADR-007 émet un JWT HS256 de 60 minutes, sans liste de révocation. Le document 09 (§4.2) l’assume : « La déconnexion locale ne révoque pas immédiatement une copie du JWT. »

L’ADR-016 et l’ADR-017 révoquent les sessions navigateur à la déconnexion et au changement de mot de passe. Elles laissent ce compromis intact : un jeton déjà émis reste utilisable jusqu’à son expiration.

## Raison du changement

La révocation d’un cookie n’est pas la révocation de tout accès. Après une déconnexion du Manager ou un changement de mot de passe, une copie du JWT reste valable jusqu’à 60 minutes. Les cas visés :

- un onglet resté ouvert;
- une copie extraite par un script;
- un appareil iOS perdu.

Philippe retient deux règles :

- **après un changement réel de mot de passe :** refuser les anciens jetons, sur le Web et sur iOS;
- **après une déconnexion du Manager :** refuser seulement les jetons de cette session.

## Constat

Le serveur relit déjà le compte à chaque requête protégée (`CurrentAccountAuthenticationConverter`). Un compte désactivé ou archivé est donc refusé immédiatement, et un rôle changé n’accorde plus ses anciens droits. Il manque deux comparaisons, qui portent sur des portées différentes.

## Nouvelle décision

### A. Révocation globale du compte (changement de mot de passe)

- **Version des créances.**
  - Ajouter `users.credential_version integer NOT NULL DEFAULT 0`.
  - `PasswordChanges` l’incrémente dans la transaction de l’ADR-017, avant de révoquer les sessions. Un mot de passe identique ne l’incrémente pas.
  - Chaque JWT porte le claim `cv`, la version lue dans la ligne du compte dont le mot de passe vient d’être vérifié, ou relue par la restauration.
- **Contrôle.** Le convertisseur refuse par `401` un jeton dont `cv` diffère de la version lue avec le compte.
- **Coût :** aucune requête supplémentaire, puisque la ligne du compte est déjà lue.
- **Portée :** tous les jetons du compte, Web et iOS. Après un changement de mot de passe, iOS doit se reconnecter.

### B. Révocation par session (déconnexion du Manager)

- **Claim `sid`.** Les jetons émis avec une session navigateur portent l’identifiant de leur ligne `browser_sessions`. Deux points d’émission sont concernés :
  - la connexion avec `browserSession: true`. Elle démarre désormais sa session **avant** d’émettre le jeton, pour pouvoir y inscrire `sid`;
  - la restauration.
- **Contrôle.** Un jeton porteur de `sid` est refusé par `401` dans trois cas :
  - la session est révoquée;
  - la session est échue;
  - la session appartient à un autre compte que le sujet du jeton.
- **Coût :** une lecture par clé primaire, jointe à la lecture du compte, donc toujours un seul aller-retour par requête.
- **Portée :** une connexion sans session navigateur, par exemple iOS, émet un jeton sans `sid`, couvert par A seulement. Une déconnexion du Manager ne déconnecte donc ni iOS ni un autre navigateur.

### Anciens jetons : aucun contournement par l’ancien format

- **Jeton sans `cv`.** Après le déploiement, un jeton sans `cv` est refusé par `401`, quel que soit son âge. Un jeton émis avant le déploiement ne peut donc pas survivre à un changement de mot de passe ni échapper au contrôle de session.
- **Jeton sans `sid`.** Un jeton signé ne peut pas perdre son `sid`. Un jeton sans `sid` est un jeton d’appareil, émis sans session navigateur, et A le couvre entièrement.
- **Effet au déploiement :**
  - le Web reçoit un `401`, fait sa restauration unique et obtient un jeton au nouveau format, sans revenir à la connexion;
  - iOS se reconnecte une fois;
  - aucune donnée n’est perdue.

### Courses

| Course | Issue garantie |
|---|---|
| Connexion / changement de mot de passe | Le `cv` du jeton est lu avec l’empreinte vérifiée. Si le changement s’engage après cette lecture, le jeton porte une version périmée et il est refusé dès sa première utilisation. La session navigateur reste gardée par l’ADR-017. |
| Restauration / changement de mot de passe | La restauration relit `cv` sous le verrou de sa ligne de session. Si elle passe d’abord, son jeton porte l’ancienne version et il est refusé dès que le changement s’engage. Si le changement passe d’abord, elle voit la session révoquée. |
| Restauration / déconnexion | Le jeton restauré porte `sid`. Dès que la révocation s’engage, ce jeton est refusé. |
| Requête en cours pendant une révocation | Une requête authentifiée juste avant l’engagement de la révocation se termine. La fenêtre acceptée est la durée d’une requête, pas 60 minutes. |

## Compatibilité et migration

- **Migration `V012`, additive.** Elle ajoute `users.credential_version` avec la valeur par défaut 0 et ne crée aucune table.
  - Son numéro est vérifié au départ de la branche, sur `dev` à jour.
  - Au 21 novembre 2026, `dev` s’arrête à `V009`, #178 apporte `V010` et `V011`, et aucune autre PR ouverte n’ajoute de migration.
- **Ordre de déploiement.**
  1. Déployer l’API seule. Flyway applique `V012` au démarrage, puis les anciens jetons sont refusés.
  2. Le Web et iOS n’ont rien à changer.
  - Un retour arrière vers l’API précédente reste possible : elle ignore la colonne et les claims.
- **Clé de signature.** Inchangée.
- **Contrat REST.** Aucun changement de forme. Un jeton révoqué reçoit le `401` habituel d’un jeton invalide.
- **Déconnexion non confirmée.** Le comportement clarifié sur #178 reste en vigueur : aucune annonce de succès sans confirmation du serveur.

## Conséquences

- **ADR-007.** Pour le changement de mot de passe et la déconnexion du Manager, cette décision remplace l’absence de révocation d’une copie du JWT. La durée de 60 minutes et l’algorithme sont inchangés.
- **Document 09.** À la livraison de #179, mettre à jour §4.1, §4.2, §10.5 et la colonne JWT de §10.6.
- **Tests de #179, sur PostgreSQL réel :**
  - jetons Web et iOS refusés après un changement réel de mot de passe, et aucun refus après un redémarrage à l’identique;
  - jeton d’une session déconnectée refusé, alors que le jeton d’une autre session et un jeton iOS restent acceptés;
  - ancien jeton sans `cv` refusé;
  - les quatre courses ci-dessus;
  - aucun secret dans les journaux.
- **Coût à l’exécution :** B ajoute une jointure indexée à la lecture existante du compte; A n’ajoute rien.

## Sections remplacées (à la livraison de #179)

- **ADR-007 :** l’absence de révocation d’un jeton émis, pour le changement de mot de passe et la déconnexion du Manager.
- **Document 09 :** §4.2, le paragraphe « La déconnexion locale ne révoque pas immédiatement une copie du JWT ».
