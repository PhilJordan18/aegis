# ADR-020 — Changement personnel du mot de passe et provisionnement explicite

**Statut :** ACCEPTED — extension fonctionnelle autorisée par Philippe le 25 novembre 2026 (#229), après recette intégrée; choix d'implémentation consigné pour revue de livraison.

**Références :** ADR-017, ADR-018; document 09 §10.7; issue #229.

## Décision antérieure

ADR-017 centralise les écritures d'empreinte dans `PasswordChanges` et révoque
les sessions navigateur dans la même transaction que l'audit. ADR-018 incrémente
`credential_version` pour invalider tous les anciens jetons. Le provisionnement
de démonstration réapplique le mot de passe configuré à chaque démarrage et
constitue alors le seul chemin de rotation disponible. Aucune route personnelle
n'était exposée.

## Raison du changement

Philippe autorise le changement par le titulaire connecté. Réappliquer sans
condition la configuration de démonstration écraserait son choix au redémarrage.
La rotation opérateur déjà utilisée doit rester possible, mais explicite.
Ni récupération de compte ni modification de la stratégie JWT/cookie n'est
nécessaire.

## Nouvelle décision

- `POST /api/v1/auth/password` accepte uniquement `currentPassword` et
  `newPassword`. Le titulaire vient de l'authentification; ADMIN et TECHNICIAN
  peuvent changer leur propre mot de passe, jamais celui d'un autre compte.
- Vérifier le compte actif et sa version authentifiée **sous verrou de ligne**,
  puis vérifier le mot de passe actuel avant d'appeler `PasswordChanges` dans
  cette même transaction. Une requête qui attendait une rotation ne peut pas
  écraser son résultat, même si le mot de passe est revenu à la valeur initiale.
- Conserver ADR-017/018 : empreinte, version, révocation de toutes les sessions
  navigateur et audit `PASSWORD_CHANGED` avec l'acteur connecté sont atomiques.
  Le mot de passe identique reçoit `409 PASSWORD_REUSED` sans effet. Succès :
  `204`, aucun nouveau jeton; tous les appareils doivent se reconnecter.
- Cinq tentatives valides par fenêtre glissante de 60 secondes et par UUID de
  compte authentifié, indépendamment de l'adresse source. Limiteur séparé de
  la connexion, au plus 10 000 fenêtres; refuser une nouvelle fenêtre saturée
  plutôt qu'évincer une limite active. État en mémoire, instance unique et
  remise à zéro au redémarrage, comme le limiteur de connexion existant.
- `AEGIS_DEMO_ROTATE_PASSWORDS=false` par défaut : le provisionnement crée les
  comptes absents et préserve les mots de passe existants. Les paramètres de
  provisionnement demeurent validés quand il est activé.
- Pour une rotation intentionnelle, l'opérateur fixe temporairement
  `AEGIS_DEMO_ACCOUNTS_ENABLED=true` et `AEGIS_DEMO_ROTATE_PASSWORDS=true`,
  choisit les secrets hors des journaux, puis redémarre. Le mécanisme existant
  change seulement les mots de passe différents. Pendant ce mode, la route
  personnelle répond `503 PASSWORD_CHANGE_UNAVAILABLE` pour tous les comptes.
  Remettre `AEGIS_DEMO_ROTATE_PASSWORDS=false` avant de rouvrir le changement
  personnel. Ce mode exige une fenêtre d'administration; aucune application
  de configuration à un environnement n'est implicite dans cet ADR.

## Conséquences et compatibilité

La route est additive. Les clients effacent leur jeton après `204`; aucune
empreinte ni mot de passe n'est placé dans l'audit ou une réponse. L'exception
aux POST métier idempotents est explicite : aucun cache de requête/réponse ni
clé d'idempotence pour ces secrets. Si la réponse est perdue, tenter une
nouvelle connexion avec le nouveau mot de passe pour déterminer le résultat;
ne pas rejouer automatiquement. Une opération engagée a révoqué le jeton initial.

Le défaut du provisionneur **change intentionnellement** : modifier seulement
une variable de mot de passe n'entraîne plus une rotation. Les opérateurs
utilisent le mode ci-dessus. Aucun nouveau schéma, migration, service externe,
email ou récupération autonome. Aucune mutation de garde ou d'historique métier.

**Retour arrière :** avant de démarrer une version antérieure à #229, désactiver
`AEGIS_DEMO_ACCOUNTS_ENABLED`; l'ancien code ignore le nouveau flag et pourrait
sinon rétablir les anciens secrets configurés. Conserver `credential_version`,
les sessions révoquées et l'audit. Aucun retour arrière SQL ni diminution de
version de créance. Le changement d'un utilisateur ne doit jamais être annulé
implicitement par le déploiement.

## Sections remplacées

Remplace seulement l'application automatique par défaut des mots de passe
configurés par le provisionnement décrit dans le contexte et les exemples
opérationnels d'ADR-017 et dans `services/api/README.md` « Comptes de
démonstration ». Les règles de révocation, d'audit, de rétention et de verrou
ADR-017 ainsi que l'intégralité du mécanisme ADR-018 restent en vigueur.
Les textes acceptés ADR-017/018 sont conservés sans modification.

## Vérification requise

Contrats HTTP positifs/négatifs, secrets masqués, verrou concurrent et version
périmée, limitation glissante/saturation, anciennes sessions refusées, nouvelle
connexion, audit atomique, redémarrage sans écrasement et rotation explicite.
Le déploiement et les preuves UI relèvent des propriétaires Railway et iOS.
