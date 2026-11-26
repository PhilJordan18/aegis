# Livraison TestFlight staging — procédure opérateur

Issue #230 — préparée le 25 novembre 2026. **Procédure prête à revue, aucune archive ni aucun upload effectués.** Philippe effectue toutes les actions Apple. TestFlight distribue l'application iOS ; il ne déploie pas le backend en production.

## Conditions de départ

Le candidat doit intégrer les corrections iOS convenues et les contrats #228/#229 après QA. L'écran #196 attend confirmation de Jimmy puis intégration humaine. Ne pas construire un candidat depuis un `dev` mouvant. Les essais matériels déjà rapportés restent acquis comme preuves humaines, mais ne valent pas 10 cycles consécutifs #55.

Les Team ID historiques `8L855CDWRG` et `PMD3MU9H8H` ont posé un conflit : choisir avec le propriétaire iOS la Team réellement titulaire de l'App ID. Ne pas alterner les Teams ni réutiliser arbitrairement un Bundle ID installé sous une autre signature. Le compte Apple, son abonnement, les rôles et les identifiants définitifs restent à vérifier humainement.

## Étapes, dans cet ordre

| # | Prérequis | Action de Philippe | Preuve à conserver sans secret | Retour arrière / arrêt |
|---|---|---|---|---|
| 1 | #228/#229 et iOS testés ; #196 confirmé | Faire figer les SHA API, Manager, iOS, hub et écran, puis obtenir le verdict QA du candidat | Tableau de versions, CI et rapport QA ; aucun SHA déduit seulement d'un nom de branche | Arrêter si composantes incompatibles ; ne pas déployer pour « essayer » |
| 2 | Accès Apple Developer et App Store Connect | Ouvrir les deux portails, vérifier abonnement, accords et rôle permettant l'upload ; identifier la Team et l'application staging | Team ID, Bundle ID et fiche d'application correspondants ; aucune clé/certificat privé | Faire corriger les droits par le titulaire ; ne pas créer un deuxième App ID par contournement |
| 3 | Identité décidée avec iOS | Vérifier le nom visible « Aegis » (les noms des apps sont conservés, décision du 26 novembre 2026), Bundle ID stable, numéro de version et numéro de build unique ; l'environnement reste identifiable : Compte affiche « Recette (staging) » et la note du contrôle d'archive nomme `staging` ; conserver la séparation avec une future app production | Version/build/Bundle ID/Team, environnement affiché dans Compte | Incrémenter le build pour une nouvelle livraison ; ne pas réutiliser un numéro déjà uploadé |
| 4 | Configuration Release livrée par iOS | Faire contrôler les paramètres **résolus** Release et l'archive : URL HTTPS staging fixe, aucune URL localhost/mock, aucun champ Debug QR, aucun pont opérateur ni secret dans l'application ; pas d'exception ATS injustifiée. La phase « Check Release Identity » (#235) lit l'Info.plist produit et bloque l'archive si l'environnement n'est pas `staging`, si l'URL intégrée diffère de la cible staging (y compris remplacée par un `Local.xcconfig`), si l'identifiant est un substitut ou si la Team manque | URL publique, configuration Release, note du contrôle (Bundle ID, Team, environnement, URL, version), contrôle de l'Info.plist et des entitlements signés, résultat tests Release | Arrêter si le contrôle bloque l'archive ; une adresse locale se limite à Debug (`[config=Debug]`), jamais contournée |
| 5 | Signature disponible | Dans Xcode, choisir la bonne Team et le profil de distribution ; vérifier `NSCameraUsageDescription`, capacités et accès Keychain nécessaires, sans ajouter de capacité inutile | Validation de signature et permission caméra sur iPhone | Corriger chez iOS ; ne pas contourner par une autre Team |
| 6 | Candidat figé, tests pertinents réussis | Sélectionner le scheme de livraison et une destination appareil générique, puis Product → Archive ; confirmer que l'action Archive utilise Release | Archive horodatée, SHA, version/build et version Xcode | Conserver l'ancienne archive ; reconstruire après correction, sans modifier la version déjà distribuée |
| 7 | Archive correcte | Dans Organizer, Validate App pour App Store Connect ; traiter erreurs et avertissements utiles | Validation Apple réussie | Aucun upload tant que les erreurs bloquantes restent |
| 8 | Validation et feu vert de Philippe | Philippe choisit Distribute App → App Store Connect → Upload et effectue lui-même l'authentification | Reçu d'upload/version/build ; jamais de capture de secret | Une version uploadée se retire des groupes/expire ; on ne promet pas d'annuler un upload terminé |
| 9 | Upload accepté | Attendre le traitement App Store Connect ; compléter les informations bêta et la conformité chiffrement selon les fonctionnalités réelles | Build disponible, conformité renseignée ; pas de statut « Processing » présenté comme disponible | Corriger puis envoyer un nouveau build en cas d'échec ; délai Apple non garanti |
| 10 | Build traité, utilisateurs internes éligibles | Créer/sélectionner un groupe **interne**, ajouter le build et les testeurs autorisés | Groupe, build attribué et invitation reçue | Retirer le build du groupe ou arrêter son test ; conserver les preuves |
| 11 | Invitation sur l'iPhone | Installer TestFlight puis le build staging d'Aegis ; confirmer nom « Aegis », version/build, ouvrir l'app et vérifier « Recette (staging) » dans Compte | Installation effective sur appareil, version iOS, build et environnement affiché | Revenir à un ancien build encore disponible ou retirer le test ; aucune restauration destructive de données backend |
| 12 | API staging saine et compte de recette fourni confidentiellement | Smoke ciblé : connexion, restauration de session après fermeture, catalogue/détails, historique personnel livré, changement de mot de passe selon #229 puis reconnexion ; caméra autorisée/refusée avec message compréhensible | Résultats horodatés et captures sans QR, token, mot de passe ni données personnelles inutiles | Arrêter à la première régression, révoquer la session de test si nécessaire ; remonter au propriétaire, pas de patch live |
| 13 | Smoke logiciel acquis ; Jimmy disponible et matériel alimenté | Planifier seulement les essais physiques manquants de #55 ; relier chaque preuve à l'opération, au prêt et aux versions | 10 retraits et 10 retours consécutifs attestés si réellement réalisés ; audit et absence de double effet | Ne pas ouvrir de porte pour un smoke logiciel ; ne jamais effacer un échec pour fabriquer une série |
| 14 | Toutes preuves du candidat consolidées | Accepter la distribution staging ou consigner les défauts ; préparer séparément la décision production | Rapport de validation avec limites | Le backend production reste hors de cette procédure |

## Confidentialité, chiffrement et tests externes

Le propriétaire iOS et Philippe déclarent les données réellement collectées (identité, historique, diagnostics éventuels), leur finalité, leur rattachement à l'utilisateur et la conservation. Ne pas déclarer « aucune collecte » sans analyse. La caméra de scan n'implique pas à elle seule un téléversement de photos. Ne pas mettre de mot de passe dans les notes publiques ; les éventuelles informations de revue sont transmises uniquement dans les champs privés appropriés avec un compte dédié.

La réponse export/chiffrement dépend de l'implémentation livrée : HTTPS seul et algorithmes propres ne se déclarent pas par supposition. Vérifier les exigences Apple au moment de l'upload. Un groupe externe n'est créé que s'il est nécessaire : Beta App Review peut être requise, avec un délai non garanti. Une absence de rôle interne ne justifie pas d'accorder des droits App Store Connect excessifs à un testeur.

## Sources Apple consultées le 25 novembre 2026

- [Upload et traitement des builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [Testeurs internes](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers) : jusqu'à 100 utilisateurs éligibles, build testable pendant 90 jours.
- [Testeurs externes et Beta App Review](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/)
- [Conformité export des builds bêta](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds)
- [Déclarations de confidentialité](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/)

Les seuls jalons calendaires retenus pour la préparation sont les mercredis **2 et 9 décembre 2026**, sans garantie de délai Apple. La date du 23 décembre encore affichée dans le README est un ancien repère à arbitrer, pas une extension implicite du calendrier convenu.
