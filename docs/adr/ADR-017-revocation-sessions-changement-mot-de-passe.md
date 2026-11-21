# ADR-017 — Révocation des sessions navigateur au changement de mot de passe et rétention bornée

**Statut :** ACCEPTED — Philippe, 21 novembre 2026 (#178), avec deux précisions : l’événement d’audit survit à la suppression des sessions terminées, et la rétention de 30 jours a un point de départ défini et testé. Une session ouverte ne peut jamais être supprimée, ni une session révoquée réactivée.

**Date de la décision :** 21 novembre 2026

**Liens :** ADR-016; ADR-018; document 08, §4.2; document 09, §10.4 et §10.6; issue #178

## Décision antérieure

L’ADR-016 crée la session navigateur révocable du Manager. Elle ne se termine que de quatre façons :

- par sa fin absolue;
- par la déconnexion explicite (`SIGNED_OUT`);
- par un compte qui ne peut plus se connecter ou dont le rôle a changé (`ACCOUNT_CHANGED`), constaté à la restauration suivante.

Un changement de mot de passe n’y figure pas. L’ADR-016 précise qu’une ligne terminée « peut être supprimée », sans fixer de délai.

## Raison du changement

La revue QA de #178 a montré qu’une rotation du mot de passe laissait ouvertes les sessions navigateur existantes. Un navigateur oublié sur un poste partagé gardait donc l’accès jusqu’à 8 heures après le changement. Philippe a approuvé la révocation. Il demande aussi :

- que la règle ne puisse pas être contournée par un autre chemin;
- qu’un redémarrage avec le même mot de passe ne déconnecte personne;
- que les sessions terminées ne s’accumulent pas indéfiniment.

## Nouvelle décision

1. **Révocation atomique.** Un changement effectif du mot de passe révoque toutes les sessions navigateur ouvertes du compte, avec le motif `PASSWORD_CHANGED`, dans la transaction qui écrit la nouvelle empreinte. La même transaction écrit un événement d’audit `PASSWORD_CHANGED` :
   - sujet `USER`;
   - acteur humain, ou `null` pour le backend lui-même;
   - `details.revokedBrowserSessions`, le nombre de sessions révoquées.
2. **Changement effectif seulement.** Un mot de passe identique au mot de passe courant ne change rien : ni l’empreinte, ni les sessions, ni l’audit. Le provisionnement de démonstration réappliqué au redémarrage avec les mêmes variables ne déconnecte donc personne.
3. **Point unique.** Le service `PasswordChanges` est le seul code qui réécrit `users.password_hash`. Le provisionnement de démonstration passe par lui. Un test refuse toute autre instruction `UPDATE aegis.users … password_hash` dans le code de production.
4. **Courses fermées.**
   - **Changement de mot de passe.** Il verrouille d’abord la ligne du compte (`FOR UPDATE`).
   - **Connexion navigateur.** Elle n’insère sa session que si le compte porte encore l’empreinte vérifiée et peut se connecter, sous un verrou partagé (`INSERT … SELECT … FOR SHARE`). Une connexion concurrente a donc deux issues :
     - elle s’engage avant le changement, qui révoque alors sa session;
     - elle n’insère rien et répond `401 AUTH_INVALID_CREDENTIALS`.
   - **Restauration.** Elle verrouille la ligne de session ouverte (`FOR UPDATE … WHERE revoked_at IS NULL`). Après l’attente, elle relit la ligne et voit la révocation.
5. **Révocation définitive.** Un déclencheur de `V011` refuse toute modification d’une ligne déjà révoquée. Aucun chemin ne peut rouvrir une session ni changer son motif.
6. **Rétention bornée.** Une tâche planifiée (`BrowserSessionPurgeJob`, toutes les heures par défaut) supprime par lots les sessions terminées.
   - **Fin d’une session :** le plus tôt de deux instants, sa révocation (`revoked_at`) ou sa fin absolue (`expires_at`). En SQL : `LEAST(revoked_at, expires_at)`, qui ignore un `revoked_at` nul. Une déconnexion tardive, après la fin absolue, ne repousse donc pas le délai.
   - **Point de départ :** les 30 jours partent de cette fin. Une ligne est supprimée quand sa fin est **strictement** antérieure à `maintenant − 30 jours`; une ligne terminée depuis exactement 30 jours est conservée.
   - **Session ouverte :** une session ni révoquée ni échue n’est jamais supprimée.
     - La purge ne la sélectionne pas, même avec une rétention nulle.
     - Un second déclencheur de `V011` (`tr_browser_sessions_open_kept`) refuse en base la suppression d’une ligne ouverte selon l’horloge de PostgreSQL, quel que soit l’appelant.
   - **Audit :** la purge ne touche jamais l’audit. L’événement `PASSWORD_CHANGED` reste après la suppression des sessions qu’il a révoquées; c’est la trace durable du changement.

## Ce que cette décision ne fait pas

La révocation porte sur les sessions navigateur, pas sur les jetons d’accès déjà émis.

- **JWT déjà émis.** Un JWT reste valable jusqu’à son expiration, au plus 60 minutes, sur le Web comme sur iOS. C’est le compromis de l’ADR-007.
- **Comptes désactivés ou archivés.** Ils restent refusés immédiatement, puisque le compte est relu à chaque requête.

La révocation des jetons émis fait l’objet de l’ADR-018, accepté pour la tranche suivante (A + B). Jusqu’à son déploiement, le compromis ci-dessus s’applique.

## Conséquences

- **Migration `V011`** :
  - le motif `PASSWORD_CHANGED`;
  - les déclencheurs `tr_browser_sessions_revoked_final` et `tr_browser_sessions_open_kept`;
  - l’index `ix_browser_sessions_ended`;
  - le type d’audit `PASSWORD_CHANGED`.

  Elle est additive : aucune ligne existante ne change.
- **Lecture de l’audit.**
  - Le type `PASSWORD_CHANGED` et le sujet `USER` deviennent filtrables.
  - Seul `revokedBrowserSessions` est exposé dans les détails filtrés.
  - Le Web ajoute le libellé du type.
- **Exploitation.**
  - La rotation d’un mot de passe de démonstration sur Railway déconnecte les navigateurs ouverts de ce compte à leur prochaine restauration.
  - Un redémarrage sans changement n’a aucun effet.
  - Variables optionnelles de la purge :
    - `aegis.security.browser-session.purge.interval` (`PT1H`);
    - `aegis.security.browser-session.purge.batch-size` (500).
- **Contrat.** Aucun changement de forme REST. La restauration répond déjà `401 AUTH_SESSION_INVALID` pour une session révoquée.

## Sections remplacées

Aucune section de l’ADR-016 n’est contredite; la présente décision la complète :

- un troisième motif de révocation;
- le caractère définitif d’une révocation;
- le délai de suppression d’une ligne terminée, que l’ADR-016 laissait ouvert.

## Vérification

- **`PasswordChangeSessionTests`** :
  - révocation de toutes les sessions du compte et d’aucune autre;
  - un seul événement d’audit;
  - aucun effet pour un mot de passe identique;
  - ligne révoquée immuable, sans réactivation possible;
  - course connexion/changement et course restauration/changement, sur PostgreSQL réel avec verrous observés;
  - rétention :
    - suppression à 30 jours et 1 seconde, conservation à exactement 30 jours;
    - départ à la fin absolue pour une déconnexion tardive;
    - audit `PASSWORD_CHANGED` intact après la suppression des sessions révoquées;
  - session ouverte jamais supprimée, par la purge (rétention nulle) comme en base (déclencheur).
- **`DemoAccountProvisioningTests`** : la rotation révoque, le redémarrage à l’identique ne révoque pas.
- **`PasswordWritersTests`** : `PasswordChanges` est le seul code qui écrit l’empreinte.
- **Preuve sur staging après déploiement :** elle est faite par une personne qui détient un compte non exposé.
