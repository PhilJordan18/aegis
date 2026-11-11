# 10 novembre 2026 — Confirmation de déconnexion iOS

Correction de bogue liée à l’issue #156. Assistance IA : diagnostic du popup,
implémentation SwiftUI, traduction, adaptation des tests et vérification visuelle.

La confirmation utilise une alerte native centrée avec Annuler et Se déconnecter.
Le message indique que la déconnexion n’annule pas les réservations ou prêts en
cours, sans affirmer que le compte en possède. La logique de session est inchangée.
Aucun contrat REST/MQTT, migration, service staging ou réglage du hub n’a été modifié.

## Vérification

Commande exécutée depuis la racine :

```sh
xcodebuild test -project apps/ios/AegisMobile.xcodeproj -scheme AegisMobile -configuration Debug -destination 'platform=iOS Simulator,id=51613E9C-47E7-4713-8F2D-1E85C86CBE5D' -derivedDataPath /private/tmp/aegis-signout-156/build -resultBundlePath /private/tmp/aegis-signout-156/tests-verified.xcresult -parallel-testing-enabled NO -only-testing:AegisMobileUITests/SignInUITests/testSignInAndSignOutInFrench -only-testing:AegisMobileUITests/SignInUITests/testSignInAndSignOutInEnglish
```

Résultat : **2 tests réussis, 0 échec**, 72,656 secondes de tests sur iPhone 17,
iOS 26.3.1. Français avec apparence système claire et anglais avec apparence
système sombre ; l’application conserve son thème sombre. Chaque parcours vérifie
le message, Annuler sans perte de session, puis la déconnexion et le retour au
formulaire. Les captures FR/EN ont été inspectées : alerte centrée, texte complet,
action destructive rouge, annulation visible. Les scénarios utilisent les fixtures
locales de l’application ; aucun appel au hub n’est nécessaire.

Les premiers passages ont révélé des boutons d’accessibilité imbriqués à cause des
identifiants sur les actions natives, puis la traduction anglaise manquante de
Annuler. Ces deux points sont corrigés. Un passage n’a pas démarré à cause de
l’accès restreint au simulateur et un autre a été interrompu pendant son amorçage ;
ils ne comptent pas comme validations.

`git diff --check` réussit. Le test connecté au staging utilise désormais le
libellé français dans l’alerte, mais n’a pas été réexécuté. La suite iOS complète
et la vérification sur l’iPhone physique ne sont pas incluses dans ce contrôle
ciblé. Les réglages de signature locaux et les journaux préexistants sont préservés.

Preuves locales : `signout-156/fr-signout-confirmation.png`,
`signout-156/en-signout-confirmation.png` et `signout-156/tests-verified.log`
dans le dossier de visualisations de cette conversation. Résultat Xcode :
`/private/tmp/aegis-signout-156/tests-verified.xcresult`.
