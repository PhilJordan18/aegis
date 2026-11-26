# Dossier de préparation infra — 25 novembre 2026

Issue #230. Classement : réduction du risque et documentation P0. Inventaire en lecture seule vers 19 h 10–19 h 25 Toronto ; il ne garantit pas un état ultérieur. Aucun déploiement ni changement de configuration live effectué dans ce lot.

## Versions et état constatés

| Composante | Preuve actuelle | Limite |
|---|---|---|
| API staging | `feefd766b9bbbd7f74c030390b3e58d97e73764b`, déploiement `63726c35-3035-4ff0-bc86-befbdb448962` SUCCESS ; SHA confirmé dans runtime ; health UP | Remplace le repère historique `8d4f2d1`, ne vaut pas QA des futurs #228/#229 |
| Manager staging | Même SHA `feefd766`, déploiement `7e9f2bf6-2a31-42c8-b2be-391e8a4bfe49` SUCCESS | Ne prouve pas chaque écran du prochain candidat |
| Hub | Source #226 intégrée dans `feefd766` | SHA binaire réellement flashé non relevé ici |
| Écran | #196 OPEN, tête `000f52571b2cf2fc006d6c0847138ef4429a4008` contenant #227 | Attendre confirmation Jimmy et intégration humaine ; SHA flashé à relever |
| PostgreSQL utile | `postgres17`, export de la base `aegis` réussi | Service distinct `Postgres` également présent ; aucun nettoyage effectué |
| Production Railway | Environnement présent, aucun service ni volume déclaré dans l'inventaire | Aucun déploiement production prêt ni effectué |
| Compte API MQTT | Runtime `aegis_api_recipe_223` | Nom historique ne signifie plus isolation SIM |
| Interrupteurs runtime | display=true, display-dispatcher=true, command-dispatcher=true | État constaté, pas une activation de ce lot |
| Bootstrap des comptes | `AEGIS_DEMO_ACCOUNTS_ENABLED=true` | #229 propriétaire de la correction ; ne pas implémenter une deuxième stratégie |

## Preuves physiques rapprochées

Philippe rapporte un retrait et retour réels concluants avec Jimmy, écran QR et messages temps réel corrects. La base confirme pour AEG-DEMO-004 :

- retrait `616cb5ef-efe2-49b0-a691-845ae520a1c0`, CONFIRMED le 25 novembre à 15:58:16 Toronto ;
- retour `2286d781-4add-4ef4-9d5a-5c69282868e7`, CONFIRMED à 16:10:11 ;
- prêt `5b4b5fea-6c0f-4c9a-95fc-36824278d107`, COMPLETED ;
- une tentative de retour précédente `f85bf3e2-1468-416a-a35b-d517e8263651` est ANOMALY : ne pas transformer cette suite en série sans échec.

Un retrait ultérieur `4ab854ba-23f2-4fd0-95f4-0f834bca39b9` est CONFIRMED à 16:12:09 et son prêt `3cba970f-cb38-47c2-b6a3-238c4719e11f` est encore **ACTIVE** à la lecture finale. Zéro opération non terminale. Ce prêt n'a pas été modifié. La tension 12 V, les capteurs et les SHA flashés ne sont pas déduits du seul statut serveur.

## Écart MQTT bloquant pour la promotion

Le fichier `/run/aegis-mqtt/acl` a l'empreinte `1f8092420263c4fd2a02cb2ea1a685454dcc0ff3d1d250bb6242dddd610017cc`. Son bloc API autorise `+/commands` et `+/display`. Le fichier persistant `/mosquitto/data/recipe-223/block.acl` garde l'ancien mode Jimmy display-only et refuse toutes les commandes. Le script `reapply.sh` exige un suffixe identique ; cette condition n'est plus remplie. Le démarrage de base régénère les identités puis recopie une ACL sans installer automatiquement cette extension.

La lecture du disque ne prouve pas à elle seule son chargement en mémoire. Aucun test de publication live n'a été fait pour le vérifier. Les preuves historiques d'isolation SIM 18/18 ne décrivent pas cet état actuel.

Le [hook candidat](../../infra/mqtt/railway/README.md) reconstruit l'extension avant démarrage avec le droit de publier limité à un seul casier. Il reste à l'intégrer dans l'image broker finale, tester cette image TLS et planifier l'application. **Aucun correctif runtime n'est prétendu livré.**

## Sauvegarde et restauration exécutées dans ce lot

Export logique `pg_dump --format=custom --create --lock-wait-timeout=5s`, source staging postgres17. L'export ne modifie pas les données, mais prend les verrous de lecture usuels. Restauration dans `aegis-restore-230-20261125`, image PostgreSQL locale `sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24`, `--network none`, aucun port publié, aucune API ni MQTT.

- Capture à 19:15:25 Toronto ; archive 1 223 243 octets, SHA256 `3f44b3e620dc13ce54892cfb4137b1c825cae2010aa1827114d3ffe89992b343`.
- `pg_restore --create --exit-on-error` réussi en 1,473 s ; export 2,808 s (petite base de démonstration, pas un RTO).
- 22 tables métier, 5 actifs, 16 opérations, 4 prêts et 536 événements d'audit restaurés.
- 14 migrations Flyway réussies jusqu'à V012 ; zéro contrainte non validée.
- Rôle applicatif : lecture des actifs et INSERT audit autorisés ; UPDATE/DELETE/TRUNCATE audit refusés.
- Rôles recréés NOLOGIN sans copier leurs mots de passe : la restauration des identités de connexion n'est pas validée.
- Cible arrêtée après contrôle ; archive privée 0600, jamais ajoutée au dépôt. Conteneur/volume conservés pour inspection.

Preuves privées : dossier `delivery-230` sous les artefacts de ce chat, `restore-proof.json` et script opérateur `restore-drill.py`. Seul ce résumé expurgé est versionné. Aucun hash global source/cible sous snapshot commun n'a été comparé dans ce lot ; les comptages sont ceux de la copie restaurée. Le snapshot Railway natif, le PITR, la reprise de l'API et la récupération des secrets restent **non testés**. La preuve plus complète du 10 novembre (11 migrations) reste historique et ne remplace pas les contrôles actuels.

Entre `8d4f2d1` et `feefd766`, aucun fichier de migration modifié. Cela ne dispense pas de réexaminer le diff des migrations du futur candidat #228/#229.

## Portes de sortie production

| Contrôle | Travail nécessaire / propriétaire | Condition de passage |
|---|---|---|
| Candidat | Propriétaires API/Web/iOS/firmware + QA | SHA figés, contrats compatibles, #196 confirmé, CI et QA du candidat |
| Comptes | Backend #229 | Création seule par défaut et rotation explicite validées ; tester la persistance d'un nouveau mot de passe après restart |
| Rollback #229 | Backend + infra | Avant retour à `8d4f2d1`/`feefd766`, désactiver le provisioner démo **avant boot** pour éviter de réécrire le nouveau mot de passe ; confirmer les noms finaux de configuration après QA |
| DB | Infra | Instance/volume/identités privés séparés de staging, secrets distincts, aucun clone de données personnelles non justifié ; restauration sur copie et procédure native documentées |
| MQTT | Infra + Jimmy pour la fenêtre | Image reproductible TLS, identités séparées par environnement, ACL durables à froid/restart, publications minimales et absence de commande en vol avant intervention |
| Secrets | Philippe + infra | Stockage privé, clés d'affichage/JWT/TLS distinctes, rotation et restauration testables ; aucune clé dans application mobile, dépôt ou captures |
| Sessions | API/Web/iOS | Domaines HTTPS et cookies Secure/HttpOnly/SameSite corrects, durée absolue, logout et révocation vérifiés sur candidat ; pas d'origine staging autorisée par inadvertance en production |
| Migrations | Backend + QA | Répéter migration sur copie, contraintes préservées, pas de changement destructeur ; pas de downgrade Flyway improvisé |
| Supervision | Infra | Health API/Web, alerte échec déploiement/DB/MQTT, taille volume, outbox en échec, fraîcheur heartbeat ; propriétaire et procédure de reprise identifiés |
| Logs | Tous | Vérifier l'absence de passwords, JWT/cookies, QR et payloads privés ; rapports limités aux IDs/statuts/dates nécessaires |
| Retour arrière | Infra | SHA/configuration précédente et compatibilité schéma connus ; conserver historique/outbox, ne pas restaurer une vieille base sur les nouvelles opérations |
| Répétabilité | Philippe/Jimmy #55 | 10 retraits + 10 retours consécutifs attestés sur versions identifiées, rejets/anomalies/restarts ; réutiliser uniquement preuves compatibles |
| Décision | Philippe | Accord explicite de bascule production, puis smoke ciblé ; TestFlight seul n'accorde pas cette bascule |

## Prochaine action humaine

Finir les lots convenus et faire figer le candidat. Suivre ensuite la [procédure TestFlight](testflight-staging.md). Le prêt 004 actif doit être compris avec Jimmy avant une fenêtre d'intervention, sans fermeture administrative fictive. Aucune nouvelle ouverture ni rotation de secret n'est nécessaire pour lire ce dossier.
