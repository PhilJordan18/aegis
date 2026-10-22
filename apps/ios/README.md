# Aegis Mobile — client iOS du technicien

Application SwiftUI du technicien. Elle communique uniquement avec l'API
Spring Aegis Control (`/api/v1`) : jamais avec PostgreSQL, le courtier MQTT ou
le casier.

**État :**

- FND-02B (#16) : squelette exécutable et écran technique « Service Aegis »
  (`GET /system/health`), atteignable depuis le compte.
- IOS-01 (#36) : connexion du technicien selon le handoff approuvé
  (`docs/design/mobile-entree/`, #35), session au Keychain, expiration,
  401, 429, déconnexion, reprise hors ligne et refus du compte
  administrateur, en français et en anglais.

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

| Configuration | Recette | Résultat (21 octobre 2026, branche #36) |
|---|---|---|
| iPhone 17, iOS 26.3.1 (simulateur) | `standalone` | 93 réussis, 0 ignoré; audits d'accessibilité réussis; catalogue cohérent (71 clés) |
| iPhone 17, iOS 26.3.1 (simulateur) | `live`, API locale de `dev` (34c056c), comptes de démonstration | 8 réussis, 0 ignoré |
| Release, simulateur générique | compilation | aucun symbole de couverture, aucun hook de test dans le binaire |
| iPhone SE (3e génération), iOS 17.5 (simulateur) | `standalone` | 93 réussis, 0 ignoré; audits réussis; catalogue cohérent |
| iOS 17.0 exact, iOS 18.x, iOS 26.0 | — | non testés (pas de runtime 17.0; autres runtimes non exécutés) |
| iPhone 12 (Philippe), iPhone 15 Plus (Jimmy) | — | non testés; versions déclarées non confirmées (voir plus bas) |

Justification de la cible :

- la couche de présentation utilise le framework Observation (`@Observable`),
  disponible à partir d'iOS 17;
- iOS 17 et iOS 18 couvrent les mêmes iPhone (XS/XR et suivants); iOS 26
  exclut les XS/XR. Viser plus haut n'apporte rien au P0 et réduirait les
  iPhone de démonstration possibles;
- la cible n'est pas déduite de la version de Xcode. Elle reste iOS 17.0 tant
  qu'aucune fonctionnalité nécessaire au P0 n'exige plus. Une API plus récente
  ne sera proposée qu'avec son besoin, son comportement de repli et son coût.

Appareils disponibles (déclarés le 21 octobre 2026, **non vérifiés**) :

| Appareil | Version annoncée | À confirmer |
|---|---|---|
| iPhone 12 (Philippe) | iOS 26.5 | Réglages › Général › Informations : version et numéro de build |
| iPhone 15 Plus (Jimmy) | iOS 27.0.1 | Idem |

Ces versions ne justifient pas de relever la cible. Elles dépassent en
revanche le SDK iOS 26.2 de Xcode 26.3 : installer sur un appareil plus récent
que le SDK peut demander les fichiers de prise en charge de l'appareil ou un
Xcode plus récent, en particulier pour iOS 27. À vérifier au premier essai,
sans changer la cible.

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

- Tests unitaires (client, Keychain réel du simulateur, modèle de session),
  tests UI de la connexion et de l'écran de santé en français et en anglais
  avec audits d'accessibilité de Xcode, sans backend, puis contrôle du
  String Catalog (`scripts/check-strings.py`).
- Les tests d'intégration sont **exclus**, pas ignorés; la recette échoue si
  un test est ignoré, échoue ou si aucun test ne s'exécute.

La recette live demande l'API avec les comptes de démonstration activés
(`services/api/README.md`). Les mots de passe viennent du fichier local non
versionné utilisé pour démarrer l'API, sans être affichés :

```bash
(set -a; . ~/.config/aegis/local-api.env; set +a; AEGIS_LIVE_API_BASE_URL=http://localhost:8080/api/v1 AEGIS_LIVE_TECHNICIAN_PASSWORD="$AEGIS_DEMO_TECHNICIAN_PASSWORD" AEGIS_LIVE_ADMIN_PASSWORD="$AEGIS_DEMO_ADMIN_PASSWORD" scripts/ios-test.sh live)
```

- Santé et authentification par le client (`LiveAPIIntegrationTests`,
  `LiveAuthIntegrationTests`), puis par l'application lancée : santé,
  connexion du technicien, reprise depuis le Keychain après relance,
  déconnexion, refus du compte administrateur (`SignInLiveUITests`).
- Échoue (code 1) si l'adresse ou un des deux mots de passe manque, si
  `/system/health` est injoignable, ou si les 8 tests ne réussissent pas
  tous; un test ignoré est un échec. Ces refus ont été vérifiés le
  21 octobre 2026.
- `AEGIS_LIVE_TECHNICIAN_EMAIL` et `AEGIS_LIVE_ADMIN_EMAIL` remplacent les
  adresses par défaut (`technician@aegis.demo`, `admin@aegis.demo`).

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

## Connexion et session (#36)

| Situation | Comportement |
|---|---|
| Lancement sans session | Formulaire de connexion |
| Session au Keychain, non expirée | « Reprise de la session… », puis `GET /auth/me`; le compte n'est affiché qu'après acceptation par le serveur |
| `GET /auth/me` injoignable ou en erreur 5xx | Jeton conservé, écran « Connexion au service impossible » avec Réessayer et Se déconnecter; session non présentée comme vérifiée, aucune action métier |
| Expiration (`expiresIn`, 60 min, sans refresh token) | Échéance calculée sur l'horloge de l'appareil à la réception; retour à la connexion, courriel prérempli, message d'expiration; vérifiée à l'échéance, après chaque réveil et au retour au premier plan |
| 401 sur une route protégée | Jeton supprimé; « session expirée » pour `AUTH_TOKEN_EXPIRED`, sinon « session n'est plus valide » |
| 403 | Refus de l'action, session conservée (doc 09 §4.3); sauf sur `GET /auth/me` à la reprise, où il signifie que le compte ne peut pas utiliser l'app |
| Réponse tardive | Une réponse arrivée après une déconnexion ou une nouvelle session est ignorée |
| 401 à la connexion | « Adresse courriel ou mot de passe incorrect. »; mot de passe effacé, courriel conservé |
| 429 | Délai `Retry-After` affiché une seule fois s'il est valide (1 à 3600 s), bouton désactivé jusque-là; sinon « Réessayez plus tard. » sans verrou |
| Compte administrateur ou rôle inconnu | Jeton non conservé, aucune donnée chargée, écran « Accès réservé aux techniciens » (message neutre pour un rôle inconnu) |
| Déconnexion | Confirmation, puis suppression locale du jeton (aucune route serveur) |

- Le jeton, son échéance et l'adresse sont un seul élément Keychain
  `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`; jamais `UserDefaults`,
  jamais journalisés (descriptions de débogage et réflexion masquées).
- Une erreur Keychain passagère au lancement conserve l'élément; un élément
  illisible est supprimé; si la déconnexion ne peut pas le supprimer, il est
  écrasé par une session vide et expirée.
- Seuls les `traceId` alphanumériques (avec tirets, 64 caractères au plus)
  sont affichés.
- Le client ne lit jamais le contenu du jeton; le serveur reste l'autorité.
- Un double envoi est ignoré pendant la requête; l'état d'envoi est annoncé
  à VoiceOver.

**Hooks de test (Debug uniquement, absents de Release)** : variables de
lancement `AEGIS_UI_SCENARIO` (réponses d'API scriptées et session en
mémoire, voir `App/UITestHooks.swift`), `AEGIS_RESET_SESSION=1`,
`AEGIS_START_SCREEN=health` et `AEGIS_UI_FOCUS`. Ils servent aux tests UI et
aux captures; seule la recette live prouve l'intégration.

## Français et anglais

Convention commune Web et iOS : `docs/localisation/` (#78, tenue par la
session API/Web, avec le glossaire). Pour iOS :

- String Catalog `AegisMobile/Localizable.xcstrings`; le français est la
  langue de développement et de repli (`developmentRegion = fr`), l'anglais
  est traduit;
- la langue suit le système ou le choix fait pour l'application dans
  Réglages, qui apparaît dès que deux langues existent; aucune préférence
  n'est envoyée au serveur;
- formats natifs (`FormatStyle`) avec `Locale.current` : langue de l'app,
  région et réglage 12/24 h du système;
- seule la présentation est traduite : jamais les codes, les identifiants,
  le `traceId` ni les données du serveur.

Le contrôle `scripts/check-strings.py` compare les clés extraites par le
compilateur au catalogue. Il échoue si une clé manque au catalogue, si une
clé n'est plus utilisée, si une traduction anglaise manque ou est vide, ou si
les marqueurs (`%@`, `%lld`) diffèrent. Les tests UI vérifient l'écran dans
les deux langues avec `-AppleLanguages` et `-AppleLocale`.

Ajouter un texte : l'écrire en français dans le code (`Text("…")`), compiler,
puis ajouter sa traduction anglaise au catalogue, dans Xcode ou dans le JSON.

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
  Localizable.xcstrings  textes français et anglais
AegisMobileTests/    Swift Testing : configuration, client, états de l'écran,
                     traductions compilées, API réelle
AegisMobileUITests/  XCUITest : erreur réseau et nouvelle tentative (FR, EN), service réel
scripts/ios-test.sh      recettes standalone et live
scripts/check-strings.py contrôle du String Catalog
```

Grâce aux groupes synchronisés, un fichier ajouté dans un de ces dossiers est
compilé sans modifier `project.pbxproj`.

Couleurs : bleu–indigo du traitement A « Verre lumineux »
(`docs/design/asset-lifecycle/prototype/tokens/brand.css`). Ces valeurs restent
des propositions de prototype, non des jetons approuvés.

## Essai sur l'iPhone réel — conditions à réunir

Le simulateur ne valide ni la caméra, ni le scan du QR, ni le réseau du
laboratoire. Avant le premier essai :

1. Version et build iOS confirmés sur l'iPhone 12 et l'iPhone 15 Plus, et
   capacité de Xcode 26.3 à installer sur ces versions.
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

Essais de la connexion (#36) qui restent à faire sur un iPhone réel, aucun
n'ayant été exécuté :

- connexion, relance et reprise depuis le Keychain de l'appareil, y compris
  après un verrouillage (élément lisible seulement appareil déverrouillé);
- remplissage automatique des mots de passe avec un trousseau réel;
- VoiceOver manuel : ordre de lecture, annonce « Connexion en cours »,
  messages d'erreur et de limite, confirmation de déconnexion;
- Taille du texte, Gras, Réduire les animations et Augmenter le contraste
  réglés dans Réglages;
- mode Avion au lancement avec une session valide (reprise hors ligne),
  puis retour du réseau et Réessayer;
- expiration réelle après 60 minutes, application en arrière-plan puis au
  premier plan;
- connexion en HTTPS vers l'hôte de démonstration (point 3).

## Preuves

Captures dans `docs/evidence/`, prises le 14 octobre 2026 avec le même Xcode
et les mêmes runtimes que ci-dessus :

- `health-live-iphone17-ios26.3.png` : appel réel, service opérationnel;
- `health-unreachable-iphone17-ios26.3.png` : port fermé, erreur réseau et
  bouton « Réessayer » (capture du test UI);
- `health-live-iphonese-ios17.5-dark-ax.png` : cible minimale, thème sombre,
  texte d'accessibilité très grand;
- `health-unreachable-en-iphone17-ios26.3.png` (21 octobre 2026) : même état
  en anglais (capture du test UI).

`docs/evidence/sign-in/` (21 octobre 2026, iPhone 17, iOS 26.3.1, scénarios
Debug) :

- `scripts/capture-sign-in.sh` : connexion clair/sombre FR/EN, clavier,
  très grand texte, reprise, reprise hors ligne, session expirée, compte;
- tests UI : refus FR/EN, limite de tentatives, envoi, mauvais rôle,
  erreurs de champ, très grand texte défilé, audit en sombre.
