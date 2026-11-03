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
