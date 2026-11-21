# ADR-018 — Révocation des jetons d’accès déjà émis

**Statut :** PROPOSED — à valider explicitement par Philippe; rien n’est implémenté

**Date de la proposition :** 21 novembre 2026

**Liens :** ADR-007; ADR-016; ADR-017; document 09, §4.1, §4.2, §10.5 et §10.6; issue #178

## Décision antérieure

L’ADR-007 émet un JWT HS256 de 60 minutes, sans liste de révocation. Le document 09 (§4.2) l’assume : « La déconnexion locale ne révoque pas immédiatement une copie du JWT. »

L’ADR-016 et l’ADR-017 révoquent les sessions navigateur à la déconnexion et au changement de mot de passe. Elles laissent ce compromis intact : un jeton déjà émis reste utilisable jusqu’à son expiration.

## Raison du changement

La révocation d’un cookie n’est pas la révocation de tout accès. Après une déconnexion du Manager ou un changement de mot de passe, une copie du JWT reste valable jusqu’à 60 minutes. Les cas visés :

- un onglet resté ouvert;
- une copie extraite par un script;
- un appareil iOS perdu.

Philippe demande d’évaluer la recommandation suivante :

- **après un changement de mot de passe :** refuser les anciens jetons, sur le Web et sur iOS;
- **après une déconnexion du Manager :** refuser les jetons de cette session seulement, sans déconnecter les autres appareils.

## Constat

Le serveur relit déjà le compte à chaque requête protégée (`CurrentAccountAuthenticationConverter`). Un compte désactivé ou archivé est donc refusé immédiatement, et un rôle changé n’accorde plus ses anciens droits. Il manque deux comparaisons, qui portent sur des portées différentes.

## Options

### A. Révocation globale du compte (changement de mot de passe)

- **Version des créances.**
  - `users.credential_version integer NOT NULL DEFAULT 0`;
  - `PasswordChanges` l’incrémente dans sa transaction (ADR-017);
  - chaque JWT porte le claim `cv`.
- **Contrôle.** Le convertisseur refuse un jeton dont `cv` diffère de la version lue avec le compte.
- **Coût :** aucune requête supplémentaire, puisque la ligne du compte est déjà lue.
- **Portée :** tous les jetons du compte, Web et iOS. Après un changement de mot de passe, iOS doit se reconnecter.

### B. Révocation par session (déconnexion du Manager)

- **Claim `sid`.** Les jetons émis avec une session navigateur portent l’identifiant de leur ligne `browser_sessions`. Deux points d’émission sont concernés :
  - la connexion avec `browserSession: true`;
  - la restauration.
- **Contrôle.** Un jeton porteur de `sid` est refusé si la session est révoquée ou échue.
- **Coût :** une lecture par clé primaire à chaque requête Web. Elle peut être jointe à la lecture du compte pour rester à un seul aller-retour.
- **Portée :** les jetons iOS n’ont pas de `sid` et ne sont pas touchés. Une déconnexion du Manager ne déconnecte donc ni iOS ni un autre navigateur.

### C. Liste de révocation des `jti`

Rejetée : elle exige une table et un nettoyage supplémentaires, alors que A et B couvrent les deux besoins avec des données qui existent déjà.

## Recommandation soumise

Adopter A et B ensemble.

| Événement | A | B | Effet combiné |
|---|---|---|---|
| Changement de mot de passe | tous les jetons du compte refusés | sessions déjà révoquées par l’ADR-017 | refus immédiat, Web et iOS |
| Déconnexion du Manager | aucun | jetons de cette session refusés | refus immédiat pour cet onglet et ses copies; iOS et les autres navigateurs restent connectés |
| Fin absolue de la session | aucun | jetons déjà bornés par la fin | inchangé |

## Compatibilité et migration

- **Migration `V012`, additive :**
  - ajoute `users.credential_version` (défaut 0);
  - ne crée aucune table.
- **Jetons émis avant le déploiement :**
  - un jeton sans `cv` est traité comme la version 0;
  - un jeton sans `sid` n’est soumis à aucun contrôle de session;
  - aucun utilisateur n’est donc déconnecté au déploiement;
  - ces anciens jetons disparaissent d’eux-mêmes en 60 minutes au plus.
- **Clients :**
  - aucun changement de forme REST;
  - un jeton révoqué reçoit le `401` habituel d’un jeton invalide;
  - le Web tente sa restauration unique, qui échoue si la session est révoquée, puis renvoie à la connexion;
  - iOS renvoie à la connexion.
- **Ordre de déploiement :** API seule; le Web et iOS n’ont rien à changer.

## Conséquences si elle est acceptée

- **ADR-007.** La phrase « aucune révocation d’une copie du JWT » est remplacée pour les deux cas ci-dessus. La durée de 60 minutes et l’algorithme sont inchangés.
- **Document 09.** Mettre à jour §4.1, §4.2, §10.5 et la colonne JWT de §10.6.
- **Tests.**
  - jeton refusé après changement de mot de passe, iOS compris;
  - jeton d’une session déconnectée refusé;
  - jeton d’une autre session ou d’iOS toujours accepté;
  - ancien jeton sans claims accepté jusqu’à son expiration.
- **Coût à l’exécution :** B ajoute une lecture indexée par requête Web; A n’ajoute rien.

## Sections remplacées (si acceptée)

- **ADR-007 :** l’absence de révocation d’un jeton émis, pour le changement de mot de passe et la déconnexion du Manager.
- **Document 09 :** §4.2, le paragraphe « La déconnexion locale ne révoque pas immédiatement une copie du JWT ».

## Décision attendue

Philippe choisit A + B (recommandé), A seul, B seul, ou le statu quo. Rien n’est implémenté avant ce choix.
