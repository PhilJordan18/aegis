# Transmission à la session iOS : CatalogUITests rouges sur `dev`

Constat de CI-02 (#67), 3 novembre 2026. Les deux derniers pushs sur `dev`
échouent dans le job « iOS standalone tests » (macos-26, Xcode 26.3 17C529,
iPhone 17 iOS 26.5 23F77, SDK simulateur 26.2). Le même code passait sur sa PR
(run `41507526895`, `12c8776`, 160/160). Retour au [bilan](README.md).

**Ne désactivez ni ces tests ni le job, et n'ajoutez aucun `skip`** : la
recette `standalone` refuse les tests ignorés, et c'est voulu.

## Exécutions

| Run (job) | SHA | Résultat | Artefact `ios-standalone-results` | Expire |
|---|---|---|---|---|
| [41515528716](https://github.com/PhilJordan18/aegis/actions/runs/41515528716/job/125518105362) | `007c584` | 160 total, 158 passed, 2 failed, 0 skipped; 902 s de tests | id `13174734842`, 132 Mo | 2026-11-09 |
| [41577913719](https://github.com/PhilJordan18/aegis/actions/runs/41577913719/job/125725657291) | `639ada8` | 160 total, 159 passed, 1 failed, 0 skipped; 1147 s de tests | id `13204199573`, 140 Mo | 2026-11-10 |
| [41584155476](https://github.com/PhilJordan18/aegis/actions/runs/41584155476/job/125745679169) | `aeedc49` (PR #110, documentation seule) | 160 total, 159 passed, 1 failed, 0 skipped; 1136 s de tests | id `13208121522`, 141 Mo | 2026-11-10 |
| [41586555809](https://github.com/PhilJordan18/aegis/actions/runs/41586555809/job/125753337711) | `ec9c36a` (PR #110, documentation seule) | 160 total, 159 passed, 1 failed, 0 skipped; 1042 s de tests | id `13209036791` | 2026-11-10 |
| [41586558351](https://github.com/PhilJordan18/aegis/actions/runs/41586558351/job/125753344732) | `6fedac9` (PR #111, documentation seule) | 160 total, 159 passed, 1 failed, 0 skipped; 862 s de tests | id `13208208682` | 2026-11-10 |

Le même code passe sur `997e3ec` ([41581805590](https://github.com/PhilJordan18/aegis/actions/runs/41581805590/job/125738163048), 160/160) et sur `a3f917c`
([41584158843](https://github.com/PhilJordan18/aegis/actions/runs/41584158843/job/125745782915), 160/160) : l'échec est **intermittent** sur la configuration hébergée.

Le log du job est en mode `-quiet` : il ne donne que `** TEST FAILED **`, la
ligne `tests: …` et `error: failures`. Les noms et messages ci-dessous viennent
de la base `standalone.xcresult/database.sqlite3` de chaque artefact (table
`TestIssues`).

## Échecs

| Run | Test | Durée | Message |
|---|---|---:|---|
| `41515528716` | `CatalogUITests/testCatalogueFilterSheetAndBackInBothLanguagesAndAppearances()` | 113,7 s | `failed: caught error: "Error Domain=com.apple.xcode.xctest.accessibilityAudit Code=-56 "Audit failed to complete in time"` |
| `41515528716` | `CatalogUITests/testOfflineRefreshKeepsTheLastListThenTryAgainRecovers()` | 43,3 s | même erreur, code -56 |
| `41577913719` | `CatalogUITests/testOfflineRefreshKeepsTheLastListThenTryAgainRecovers()` | 182,3 s | `Accessibility audit: Dynamic Type font sizes are partially unsupported — XCUIElementType(rawValue: 48) 'Last known: Blocked' id= frame=(51.33, 646.0, 172.0, 18.0) — User will not be able to change the font size of this SwiftUI.AccessibilityNode` |
| `41584155476` | `CatalogUITests/testOfflineRefreshKeepsTheLastListThenTryAgainRecovers()` | 146,4 s | même constat Dynamic Type sur 'Last known: Blocked', frame=(51.33, 646.0, 172.0, 18.0) |
| `41586555809` | `CatalogUITests/testOfflineRefreshKeepsTheLastListThenTryAgainRecovers()` | 38,1 s | `Audit failed to complete in time`, code -56 |
| `41586558351` | `CatalogUITests/testCatalogueFilterSheetAndBackInBothLanguagesAndAppearances()` | 140,3 s | `XCTAssertTrue failed` à `CatalogUITests.swift:72` : la carte `MM-002` n'est pas revenue en 10 s après le retour depuis la fiche |

Repères dans le code (lecture seule de CI-02) :

- `apps/ios/AegisMobileUITests/CatalogUITests.swift:43` et `:119` pour les deux
  tests;
- `:320`, l'appel `app.performAccessibilityAudit(for: types)` partagé, dont le
  filtre `.dynamicType` tolère seulement les éléments hors de l'écran visible
  et les pastilles de statut;
- le libellé « Last known: Blocked » (clé `Dernier état : %@`) est rendu par
  `apps/ios/AegisMobile/Catalog/CatalogComponents.swift:41`, la pastille de
  statut en mode « dernier état connu » (ElementType 48 : texte statique).

## Lecture

- Trois modes d'échec, tous intermittents et tous dans `CatalogUITests` : délai
  de l'audit (-56), constat Dynamic Type, et retour vers la liste trop lent
  (`:72`). Hors échec volontaire de CI-02, cinq des sept derniers runs iOS
  hébergés échouent (`639ada8`, `ce1022e`, `aeedc49`, `ec9c36a`, `6fedac9`).
  `ce1022e` appartient à la branche `38-feat-ios-my-activity` et n'est pas
  analysé ici; les quatre autres ont chacun un seul test en échec.

- Code -56 : l'audit dépasse son délai sur le runner hébergé. Ce n'est pas un
  constat d'accessibilité, mais il rend le test non fiable sur cette
  configuration.
- Dynamic Type : un vrai constat sur iOS 26.5. Le Mac de développement est sur
  iOS 26.3.1 : la configuration hébergée est distincte et doit être tenue pour
  une configuration testée à part.

## Ce qui est attendu de la session iOS

1. Corriger la vue du libellé, ou documenter une tolérance précise et justifiée
   dans l'audit, sans retirer `.dynamicType` en général.
2. Rendre l'audit fiable dans le temps imparti du runner (par exemple, auditer
   moins de types par appel ou un sous-arbre), sans `skip` ni nouvel essai
   automatique qui masquerait un échec.
3. Livrer par une PR vers `dev`; CI-02 comptera de nouveau les succès iOS à
   partir du premier run vert sur `dev` qui suivra.

## Mise à jour du 3 novembre 2026

Cette section remplace les points 1 et 2 ci-dessus. Les mesures sont dans
`diagnostic-duree-ios.md`.

Les décisions humaines du 3 novembre s'appliquent :

- **La tolérance Dynamic Type est refusée.** La bande de 60 pt du commit 27ee03f doit
  être retirée.
- **Le découpage de l'audit en trois passes est aussi à retirer.** Il double environ la
  durée de chaque audit (catalogue : 11,6 à 20,5 s, contre 6,1 à 8,7 s) et n'a pas
  empêché le -56.
- **La disposition réelle de la carte « Last known: Blocked » doit être vérifiée**
  avant toute conclusion sur l'audit, en grande taille et en AX5 : défilement, safe
  areas, libellé lisible. Un défaut produit n'est pas exclu.

Autres observations :

- **Le deuxième tap sur « Réessayer »** de `testOfflineRefreshKeepsTheLastListThenTryAgainRecovers`
  est sollicité dans 12 itérations sur 14 mesurées. Un premier tap ignoré peut être un
  défaut produit, par exemple un rafraîchissement encore en cours ; il est à reproduire
  avant de garder ce second tap.
- **Le timeout de lancement de `testEmptyCatalogueOffersNoFilterToClear`** (run
  41620501772) suit un -56 dont l'app n'était pas encore terminée. La corrélation est
  observée une seule fois.
- **Le commit 4084695 de #116 relance l'audit après un abandon de XCTest.** C'est une
  reprise automatique, que la règle « pas de retry masquant un défaut » exclut sans
  preuve que la cause est dans XCTest.

La session cloud ne modifie plus `CatalogUITests` ni `StillScreen`. La consolidation
de #116 et #117 appartient à la session iOS.
