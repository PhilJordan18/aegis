# Aegis Mobile — client iOS du technicien

Application SwiftUI du technicien. Elle communique uniquement avec l'API
Spring Aegis Control (`/api/v1`) : jamais avec PostgreSQL, le courtier MQTT ou
le casier.

**État (FND-02B, #16) :** squelette exécutable. Un écran technique vérifie
`GET /system/health` avec les états chargement, service opérationnel, erreur
et nouvelle tentative. Ce n'est pas une section métier approuvée : il prouve
seulement que l'application compile, se lance et joint l'API.

## Environnement vérifié

Observations du **21 octobre 2026** sur le Mac de Philippe, contrôlées par
commande (`sw_vers`, `xcodebuild -version`, `swift --version`,
`xcodebuild -showsdks`, `xcrun simctl list`) :

| Élément | Valeur observée |
|---|---|
| Mac | macOS 15.7.9 (24G830), Intel x86_64 |
| Xcode sélectionné | 26.3 (17C529), `/Applications/Xcode.app` |
| Swift | compilateur 6.2.4; mode de langage du projet : Swift 6 |
| SDK | iOS 26.2, iOS Simulator 26.2 |
| Runtimes de simulateur installés | iOS 17.5, 18.0, 18.1, 18.3.1, 18.4, 18.5, 26.0, 26.3.1 |

Le projet utilise des groupes synchronisés avec le système de fichiers
(format `objectVersion 77`) : **Xcode 16 ou plus récent** est requis pour
l'ouvrir.

## Cible minimale et versions testées

**Cible minimale : iOS 17.0** (`Config/Shared.xcconfig`), à ne pas confondre
avec les versions réellement testées :

| Configuration | Recette | Résultat (21 octobre 2026) |
|---|---|---|
| iPhone 17, iOS 26.3.1 (simulateur) | `standalone` | 24 réussis, 0 ignoré |
| iPhone 17, iOS 26.3.1 (simulateur) | `live`, API locale issue de `dev` | 2 réussis, 0 ignoré |
| iPhone SE (3e génération), iOS 17.5 (simulateur) | `standalone` | 24 réussis, 0 ignoré |
| iOS 17.0 exact, iOS 18.x, iOS 26.0 | — | non testés (pas de runtime 17.0; autres runtimes non exécutés) |
| iPhone physique | — | non testé : aucun appareil disponible |

Justification de la cible :

- la couche de présentation utilise le framework Observation (`@Observable`),
  disponible à partir d'iOS 17;
- iOS 17 et iOS 18 couvrent les mêmes iPhone (XS/XR et suivants); iOS 26
  exclut les XS/XR. Viser plus haut n'apporte rien au P0 et réduirait les
  iPhone de démonstration possibles;
- la cible n'est pas déduite de la version de Xcode. Elle reste iOS 17.0 tant
  qu'aucune fonctionnalité nécessaire au P0 n'exige plus. Une API plus récente
  ne sera proposée qu'avec son besoin, son comportement de repli et son coût.

**À confirmer :** modèle et version iOS de l'iPhone de démonstration.

## Ouvrir et lancer dans Xcode

1. Démarrer l'API (voir `services/api/README.md`) et vérifier :
   `curl http://localhost:8080/api/v1/system/health`.
2. Ouvrir `apps/ios/AegisMobile.xcodeproj` (pas d'espace de travail ni de
   dépendance externe).
3. Choisir le schéma partagé **AegisMobile** et une destination
   **iPhone 17** (iOS 26.x) ou **iPhone SE (3rd generation)** (iOS 17.5).
4. Product › Run (⌘R). Product › Test (⌘U) exécute toute la suite; sans
   adresse d'API réelle, les deux tests d'intégration y sont ignorés. Ce
   résultat ne prouve donc pas l'intégration : utiliser la recette `live`.

## Recettes de test (local et CI)

`scripts/ios-test.sh` est la seule commande à utiliser en CI. Depuis
`apps/ios/` :

```bash
scripts/ios-test.sh standalone
```

- Tests unitaires et test UI « service injoignable », sans backend.
- Les tests d'intégration sont **exclus**, pas ignorés; la recette échoue si
  un test est ignoré, échoue ou si aucun test ne s'exécute.

```bash
AEGIS_LIVE_API_BASE_URL=http://localhost:8080/api/v1 scripts/ios-test.sh live
```

- Appel réel par le client (`LiveAPIIntegrationTests`) et par l'application
  lancée (`testLiveServiceShowsHealth`).
- Échoue (code 1) si `AEGIS_LIVE_API_BASE_URL` manque, si
  `/system/health` est injoignable, ou si les 2 tests ne réussissent pas
  tous; un test ignoré est un échec. Ces deux refus ont été vérifiés le
  21 octobre 2026.

Variables facultatives : `IOS_DESTINATION` (défaut
`platform=iOS Simulator,name=iPhone 17,OS=latest`, à adapter aux simulateurs
de la machine), `IOS_DERIVED_DATA` (défaut `build/DerivedData`) et
`IOS_RESULTS_DIR` (défaut `build/results`, où sont écrits les `.xcresult`).
Exemple sur la cible minimale :

```bash
IOS_DESTINATION='platform=iOS Simulator,name=iPhone SE (3rd generation),OS=17.5' scripts/ios-test.sh standalone
```

Le premier build prend 5 à 6 minutes sur ce Mac Intel. `build/` est ignoré
par Git.

Compiler sans tester, puis installer et lancer sur le simulateur démarré :

```bash
xcodebuild build -project AegisMobile.xcodeproj -scheme AegisMobile -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17,OS=latest' -derivedDataPath build/DerivedData
```

```bash
xcrun simctl install booted build/DerivedData/Build/Products/Debug-iphonesimulator/AegisMobile.app
```

```bash
xcrun simctl launch booted com.example.aegis.mobile
```

## Configuration et règles réseau

| Fichier | Rôle | Versionné |
|---|---|---|
| `Config/Shared.xcconfig` | Cible iOS, Swift, version, préfixe d'identifiant | oui |
| `Config/Debug.xcconfig` | `AEGIS_API_BASE_URL = http://localhost:8080/api/v1` | oui |
| `Config/Release.xcconfig` | Adresse vide : à fournir en HTTPS | oui |
| `Config/Local.xcconfig` | Équipe de signature, préfixe d'identifiant, adresse locale | **non** (`Local.xcconfig.example`) |
| `Config/AegisMobile-Info.plist` | Expose `AegisAPIBaseURL` au code | oui |

- L'adresse est validée au lancement (`APIConfiguration`) : HTTPS obligatoire,
  sauf HTTP vers `localhost`, `127.0.0.1` ou `::1`. Une adresse absente ou en
  HTTP vers un autre hôte affiche un état de configuration au lieu d'appeler.
- **Aucune exception App Transport Security** n'est déclarée : l'appel HTTP au
  loopback du simulateur fonctionne sans elle (vérifié). Aucun certificat
  arbitraire n'est accepté et la vérification TLS reste celle de la plateforme.
- En Debug seulement, la variable de lancement `AEGIS_API_BASE_URL` remplace
  l'adresse (utilisée par les tests UI pour simuler un service injoignable);
  elle subit la même validation.
- Aucun secret, compte ou équipe de signature n'est versionné. L'identifiant
  `com.example.aegis.mobile` est un substitut à remplacer dans `Local.xcconfig`
  pour signer sur un appareil.

## Structure

```text
AegisMobile/
  App/          point d'entrée SwiftUI
  Networking/   APIConfiguration, APIClient (URLSession), SystemHealth
  Health/       HealthViewModel (@MainActor, @Observable) et HealthView
  Assets.xcassets  couleurs du traitement A (valeurs du prototype, non définitives)
AegisMobileTests/    Swift Testing : configuration, client, états de l'écran, API réelle
AegisMobileUITests/  XCUITest : erreur réseau et nouvelle tentative, service réel
scripts/ios-test.sh  recettes standalone et live
```

Grâce aux groupes synchronisés, un fichier ajouté dans un de ces dossiers est
compilé sans modifier `project.pbxproj`.

Couleurs : bleu–indigo du traitement A « Verre lumineux »
(`docs/design/asset-lifecycle/prototype/tokens/brand.css`). Ces valeurs restent
des propositions de prototype, non des jetons approuvés.

## Essai sur l'iPhone réel — conditions à réunir

Le simulateur ne valide ni la caméra, ni le scan du QR, ni le réseau du
laboratoire. Avant le premier essai :

1. Modèle et version iOS de l'iPhone de démonstration (≥ iOS 17).
2. Compte Apple Developer et équipe de signature sur le Mac qui compile
   (`DEVELOPMENT_TEAM` dans `Local.xcconfig`), mode développeur activé sur
   l'iPhone, échéance du profil connue.
3. Adresse d'Aegis Control joignable depuis l'iPhone : jamais `localhost`.
   Le contrat impose HTTPS hors environnement local; il faut donc un
   certificat dont la chaîne est approuvée sur l'iPhone. Ce choix (autorité
   locale, nom d'hôte) est à coordonner avec le responsable de l'API et de
   l'infrastructure; aucun contournement TLS n'est prévu.
4. Réseau : iPhone et hôte sur le même réseau autorisé, sans isolation des
   clients. Joindre un hôte du réseau local demandera la description
   `NSLocalNetworkUsageDescription` (non ajoutée tant qu'elle n'est pas
   utilisée).
5. Caméra : `NSCameraUsageDescription` et le scan seront ajoutés avec CHK-01
   et validés seulement sur l'appareil.

## Preuves

Captures dans `docs/evidence/`, prises le 14 octobre 2026 avec le même Xcode
et les mêmes runtimes que ci-dessus :

- `health-live-iphone17-ios26.3.png` : appel réel, service opérationnel;
- `health-unreachable-iphone17-ios26.3.png` : port fermé, erreur réseau et
  bouton « Réessayer » (capture du test UI);
- `health-live-iphonese-ios17.5-dark-ax.png` : cible minimale, thème sombre,
  texte d'accessibilité très grand.
