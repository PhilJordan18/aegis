# Vérification du lot #230

## Périmètre

Documentation TestFlight/production, inventaire daté, restauration isolée et hook de reconstruction d'une identité MQTT de recette. Aucun changement métier API/iOS, REST/MQTT public ou migration. Pas de déploiement, pas d'upload Apple, pas de commande au hub.

## Commandes et résultats

- `railway status --json`, filtré sur environnements/services/déploiements/SHA : API et Manager `feefd766`, production vide. Aucun secret publié.
- `railway ssh -s aegis-api -e staging -- ...` : lecture ciblée du SHA et des trois flags ; tous actifs. Lecture ciblée du nom de compte et du bootstrap. Aucun mot de passe lu dans les sorties.
- `curl --fail --silent --show-error --max-time 15 https://aegis-api-staging-239f.up.railway.app/api/v1/system/health` : UP.
- `gh pr view 196 --json state,headRefOid,mergedAt` : OPEN, tête `000f5257`, non intégrée.
- `git diff --name-only 8d4f2d1 origin/dev -- services/api/src/main/resources/db/migration` : aucun fichier modifié sur ce chemin.
- `python3 -B /tmp/aegis-230-restore.py` : restauration réussie, droits d'audit et contraintes vérifiés ; copie du script conservée dans les artefacts privés sous `delivery-230/restore-drill.py`. Résultats et limites dans le dossier infra.
- `python3 -B infra/mqtt/railway/test_overlay.py` : tests sur données synthétiques, broker sans réseau extérieur ; image Mosquitto 2.1.2 figée par digest. Démarrage, redémarrage, mode QR seul, refus hors casier, refus d'identité injectée, refus de directive ACL injectée et refus de réapplication.
- `sh -n infra/mqtt/railway/install-recipe-overlay.sh` : syntaxe valide.
- `git diff --check` : aucune erreur d'espacement.

Les premières exécutions du harnais ont échoué : option `-W` non reconnue par `mosquitto_pub`, puis code de succès sans abonné MQTT5 `16` traité à tort comme `0`. Ces erreurs du harnais ont été corrigées, sans action staging. Le test final distingue explicitement `16` (accepté sans destinataire) et `135` (non autorisé).

## Revue indépendante

Verdict final : **PASS WITH RISKS**, limité au candidat et aux documents. Le reviewer a relancé indépendamment les 3 tests (8,750 s), la syntaxe shell et le contrôle d’espacement. La revue ne donne aucun feu vert production ; la restauration a été examinée dans le rapport sans accès indépendant à l’archive privée.

Revue en lecture seule demandée au rôle QA. Deux défauts du hook candidat ont été reproduits puis corrigés avant livraison :

1. `wc -l` ne détectait pas une identité supplémentaire sans newline final : validation d'un unique enregistrement par `awk`, test vérifiant aussi que les fichiers de base restent inchangés.
2. Une regex `grep` pouvait accepter une ligne UUID parmi plusieurs et permettre l'injection d'une directive : liste de caractères autorisés vérifiée avant regex canonique, test d'injection multiligne et fichiers de base inchangés.

Le hook exige un bootstrap arrêté, une base propre et des fichiers protégés. Il ne remplace pas le test de l'image TLS finale ni la validation des comptes de production.

## Limites obligatoires du rapport

- Restaurabilité logique démontrée ; snapshot Railway natif, PITR et reprise applicative complète non testés.
- Aucun accès Apple Developer/App Store Connect vérifié ; aucun build Release archivé ou envoyé.
- #228/#229 et iOS restent des dépendances, pas des fonctionnalités déclarées livrées ici.
- Pas de preuve des SHA flashés ni de la série physique 10+10.
- Le hook reste non intégré dans l'image broker actuelle ; l'écart ACL live/reprise reste donc un blocage de promotion production.
- Le prêt Jimmy 004 actif est conservé ; aucun nettoyage fictif de la recette.

Assistance IA : inventaire, préparation/exécution des contrôles isolés, rédaction et revue. Philippe et Jimmy restent responsables des actions Apple et des validations physiques.
