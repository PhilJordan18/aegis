# Historique des exécutions hébergées (CI-02)

Relevé du 3 novembre 2026 par l'API GitHub Actions, workflow `CI`, runs
`39711005595` (premier run des quatre jobs, PR #92) à `41585549537` (relevé
complété après l'ouverture de #110 et #111). Seuls les jobs **exécutés** sont
listés : un job `skipped` par le filtre n'est pas une preuve. Le run
`41581846591` (`1ab1203`) est l'échec volontaire de CI-02 : il prouve que chaque
job bloque, et n'interrompt pas les séries de succès. Un seul run a une seconde
tentative : `41579245986` (`38-feat-ios-my-activity`, iOS seulement, relancé par
sa session et toujours en échec); partout ailleurs `run_attempt` = 1.
Les annulations viennent de `cancel-in-progress` (nouveau commit sur la PR).
Retour au [bilan](README.md).

## Simulator tests

| Run | Événement | Branche | SHA | Conclusion | Durée (min) | Log |
|---|---|---|---|---|---:|---|
| [39711005595](https://github.com/PhilJordan18/aegis/actions/runs/39711005595/job/119603184535) | pull_request | `67-ci-extend-components` | `7e42241` | success | 5.0 | 102 run, 102 passed, 0 failed, 0 skipped |
| [39716573137](https://github.com/PhilJordan18/aegis/actions/runs/39716573137/job/119620021562) | pull_request | `67-ci-extend-components` | `ddbdfc8` | success | 1.8 | 102 run, 102 passed, 0 failed, 0 skipped |
| [39793631022](https://github.com/PhilJordan18/aegis/actions/runs/39793631022/job/119875572626) | push | `dev` | `bef30df` | success | 0.8 | 102 run, 102 passed, 0 failed, 0 skipped |
| [39795947196](https://github.com/PhilJordan18/aegis/actions/runs/39795947196/job/119883208926) | push | `dev` | `145e66f` | success | 0.8 | 113 run, 113 passed, 0 failed, 0 skipped |
| [39841401555](https://github.com/PhilJordan18/aegis/actions/runs/39841401555/job/120043155490) | pull_request | `39-feat-hub-simulator-commands` | `256c4c5` | success | 0.9 | 264 run, 264 passed, 0 failed, 0 skipped |
| [39842225293](https://github.com/PhilJordan18/aegis/actions/runs/39842225293/job/120046053377) | pull_request | `25-feat-asset-catalog` | `8109f4d` | success | 0.7 | 113 run, 113 passed, 0 failed, 0 skipped |
| [39865839275](https://github.com/PhilJordan18/aegis/actions/runs/39865839275/job/120127744285) | pull_request | `35-docs-ios-technician-flows` | `485ab9a` | success | 0.7 | 113 run, 113 passed, 0 failed, 0 skipped |
| [39872972407](https://github.com/PhilJordan18/aegis/actions/runs/39872972407/job/120151674656) | pull_request | `35-docs-ios-technician-flows` | `0d13443` | success | 0.8 | 113 run, 113 passed, 0 failed, 0 skipped |
| [39874316534](https://github.com/PhilJordan18/aegis/actions/runs/39874316534/job/120156125625) | pull_request | `39-feat-hub-simulator-commands` | `c6a0233` | success | 0.8 | 267 run, 267 passed, 0 failed, 0 skipped |
| [40690228021](https://github.com/PhilJordan18/aegis/actions/runs/40690228021/job/122822907560) | push | `dev` | `38c91ee` | success | 0.7 | 113 run, 113 passed, 0 failed, 0 skipped |
| [40690329981](https://github.com/PhilJordan18/aegis/actions/runs/40690329981/job/122828853031) | push | `dev` | `af22b7e` | success | 0.8 | 267 run, 267 passed, 0 failed, 0 skipped |
| [40698722765](https://github.com/PhilJordan18/aegis/actions/runs/40698722765/job/122852444897) | push | `dev` | `5ec4af2` | success | 0.8 | 267 run, 267 passed, 0 failed, 0 skipped |
| [40737458478](https://github.com/PhilJordan18/aegis/actions/runs/40737458478/job/122989828500) | push | `dev` | `32eb1ce` | success | 1.3 | 267 run, 267 passed, 0 failed, 0 skipped |
| [40754195616](https://github.com/PhilJordan18/aegis/actions/runs/40754195616/job/123048749308) | push | `dev` | `b740bdc` | success | 0.9 | 267 run, 267 passed, 0 failed, 0 skipped |
| [40775801449](https://github.com/PhilJordan18/aegis/actions/runs/40775801449/job/123124717878) | push | `dev` | `71d1f81` | success | 0.7 | 267 run, 267 passed, 0 failed, 0 skipped |
| [41504916299](https://github.com/PhilJordan18/aegis/actions/runs/41504916299/job/125481773487) | push | `dev` | `527c774` | success | 0.9 | 267 run, 267 passed, 0 failed, 0 skipped |
| [41505916014](https://github.com/PhilJordan18/aegis/actions/runs/41505916014/job/125486875416) | push | `dev` | `c1366b3` | success | 1.6 | 267 run, 267 passed, 0 failed, 0 skipped |
| [41515528716](https://github.com/PhilJordan18/aegis/actions/runs/41515528716/job/125518105385) | push | `dev` | `007c584` | success | 0.8 | 267 run, 267 passed, 0 failed, 0 skipped |
| [41577913719](https://github.com/PhilJordan18/aegis/actions/runs/41577913719/job/125725657330) | push | `dev` | `639ada8` | success | 0.8 | 267 run, 267 passed, 0 failed, 0 skipped |
| [41581805590](https://github.com/PhilJordan18/aegis/actions/runs/41581805590/job/125738163102) | pull_request | `67-ci-qualify-controls` | `997e3ec` | success | 0.9 | 267 run, 267 passed, 0 failed, 0 skipped |
| [41581846591](https://github.com/PhilJordan18/aegis/actions/runs/41581846591/job/125738312961) | pull_request | `67-ci-promote-qualified-jobs` | `1ab1203` | failure | 0.4 | 259 run, 258 passed, 1 failed, 0 skipped — **échec volontaire CI-02** |
| [41582652376](https://github.com/PhilJordan18/aegis/actions/runs/41582652376/job/125740846343) | pull_request | `98-feat-mqtt-schema-3` | `c38f13f` | success | 0.8 | 293 run, 293 passed, 0 failed, 0 skipped |
| [41583716102](https://github.com/PhilJordan18/aegis/actions/runs/41583716102/job/125744237552) | pull_request | `98-feat-mqtt-schema-3` | `8d21f98` | success | 0.8 | 294 run, 294 passed, 0 failed, 0 skipped |
| [41584155476](https://github.com/PhilJordan18/aegis/actions/runs/41584155476/job/125745679338) | pull_request | `67-ci-qualify-controls` | `aeedc49` | success | 0.8 | 267 run, 267 passed, 0 failed, 0 skipped |
| [41584158843](https://github.com/PhilJordan18/aegis/actions/runs/41584158843/job/125745782840) | pull_request | `67-ci-promote-qualified-jobs` | `a3f917c` | success | 0.8 | 267 run, 267 passed, 0 failed, 0 skipped |

## Agent setup validator

| Run | Événement | Branche | SHA | Conclusion | Durée (min) | Log |
|---|---|---|---|---|---:|---|
| [39711005595](https://github.com/PhilJordan18/aegis/actions/runs/39711005595/job/119603184509) | pull_request | `67-ci-extend-components` | `7e42241` | success | 0.1 | passed with 0 warning(s) |
| [39716573137](https://github.com/PhilJordan18/aegis/actions/runs/39716573137/job/119620021522) | pull_request | `67-ci-extend-components` | `ddbdfc8` | success | 0.1 | passed with 0 warning(s) |
| [39793631022](https://github.com/PhilJordan18/aegis/actions/runs/39793631022/job/119875572590) | push | `dev` | `bef30df` | success | 0.1 | passed with 0 warning(s) |
| [39795947196](https://github.com/PhilJordan18/aegis/actions/runs/39795947196/job/119883208781) | push | `dev` | `145e66f` | success | 0.1 | passed with 0 warning(s) |
| [39841401555](https://github.com/PhilJordan18/aegis/actions/runs/39841401555/job/120043155445) | pull_request | `39-feat-hub-simulator-commands` | `256c4c5` | success | 0.1 | passed with 0 warning(s) |
| [39842225293](https://github.com/PhilJordan18/aegis/actions/runs/39842225293/job/120046053392) | pull_request | `25-feat-asset-catalog` | `8109f4d` | success | 0.1 | passed with 0 warning(s) |
| [39865839275](https://github.com/PhilJordan18/aegis/actions/runs/39865839275/job/120127743909) | pull_request | `35-docs-ios-technician-flows` | `485ab9a` | success | 0.1 | passed with 0 warning(s) |
| [39866628092](https://github.com/PhilJordan18/aegis/actions/runs/39866628092/job/120130392554) | pull_request | `35-docs-reservation-deadline-actions` | `0ecac28` | success | 0.1 | passed with 0 warning(s) |
| [39872972407](https://github.com/PhilJordan18/aegis/actions/runs/39872972407/job/120151675033) | pull_request | `35-docs-ios-technician-flows` | `0d13443` | success | 0.2 | passed with 0 warning(s) |
| [39874316534](https://github.com/PhilJordan18/aegis/actions/runs/39874316534/job/120156125608) | pull_request | `39-feat-hub-simulator-commands` | `c6a0233` | success | 0.1 | passed with 0 warning(s) |
| [39876232857](https://github.com/PhilJordan18/aegis/actions/runs/39876232857/job/120162439619) | pull_request | `25-feat-asset-catalog` | `73aebb2` | success | 0.1 | passed with 0 warning(s) |
| [39878916629](https://github.com/PhilJordan18/aegis/actions/runs/39878916629/job/120171313585) | pull_request | `25-feat-asset-catalog` | `1e966c7` | success | 0.1 | passed with 0 warning(s) |
| [39880428552](https://github.com/PhilJordan18/aegis/actions/runs/39880428552/job/120176273402) | pull_request | `25-feat-asset-catalog` | `0b7badd` | success | 0.1 | passed with 0 warning(s) |
| [39880703902](https://github.com/PhilJordan18/aegis/actions/runs/39880703902/job/120177171189) | pull_request | `99-feat-catalog-audit` | `ea9e8b4` | success | 0.1 | passed with 0 warning(s) |
| [40690228021](https://github.com/PhilJordan18/aegis/actions/runs/40690228021/job/122822907515) | push | `dev` | `38c91ee` | success | 0.1 | passed with 0 warning(s) |
| [40690329981](https://github.com/PhilJordan18/aegis/actions/runs/40690329981/job/122828853133) | push | `dev` | `af22b7e` | success | 0.2 | passed with 0 warning(s) |
| [40693372550](https://github.com/PhilJordan18/aegis/actions/runs/40693372550/job/122833707454) | pull_request | `25-feat-asset-catalog` | `d0d52ac` | success | 0.2 | passed with 0 warning(s) |
| [40698529574](https://github.com/PhilJordan18/aegis/actions/runs/40698529574/job/122851798743) | pull_request | `99-feat-catalog-audit` | `c4dd2e5` | success | 0.2 | passed with 0 warning(s) |
| [40698722765](https://github.com/PhilJordan18/aegis/actions/runs/40698722765/job/122852444855) | push | `dev` | `5ec4af2` | success | 0.1 | passed with 0 warning(s) |
| [40698722403](https://github.com/PhilJordan18/aegis/actions/runs/40698722403/job/122852454538) | pull_request | `26-feat-asset-placement` | `3c4b798` | success | 0.2 | passed with 0 warning(s) |
| [40700241589](https://github.com/PhilJordan18/aegis/actions/runs/40700241589/job/122857847848) | pull_request | `99-feat-catalog-audit` | `86fa1ac` | success | 0.1 | passed with 0 warning(s) |
| [40700295306](https://github.com/PhilJordan18/aegis/actions/runs/40700295306/job/122858042576) | pull_request | `26-feat-asset-placement` | `261205b` | success | 0.1 | passed with 0 warning(s) |
| [40700302996](https://github.com/PhilJordan18/aegis/actions/runs/40700302996/job/122858079249) | pull_request | `28-feat-operating-hours` | `8d4ecf8` | success | 0.1 | passed with 0 warning(s) |
| [40700354575](https://github.com/PhilJordan18/aegis/actions/runs/40700354575/job/122859051349) | pull_request | `26-feat-asset-placement` | `9cc3354` | success | 0.1 | passed with 0 warning(s) |
| [40700384836](https://github.com/PhilJordan18/aegis/actions/runs/40700384836/job/122859136669) | pull_request | `28-feat-operating-hours` | `467c10d` | success | 0.1 | passed with 0 warning(s) |
| [40701338176](https://github.com/PhilJordan18/aegis/actions/runs/40701338176/job/122861731612) | pull_request | `100-feat-custody-schema` | `f4367c2` | success | 0.1 | passed with 0 warning(s) |
| [40702844851](https://github.com/PhilJordan18/aegis/actions/runs/40702844851/job/122867050642) | pull_request | `33-feat-readiness` | `b905a53` | success | 0.1 | passed with 0 warning(s) |
| [40708390133](https://github.com/PhilJordan18/aegis/actions/runs/40708390133/job/122886709022) | pull_request | `37-feat-reservation` | `be76501` | success | 0.1 | passed with 0 warning(s) |
| [40708958373](https://github.com/PhilJordan18/aegis/actions/runs/40708958373/job/122888731195) | pull_request | `34-feat-ios-asset-catalog` | `9813142` | success | 0.1 | passed with 0 warning(s) |
| [40709029696](https://github.com/PhilJordan18/aegis/actions/runs/40709029696/job/122891975804) | pull_request | `34-feat-ios-asset-catalog` | `4272123` | success | 0.1 | passed with 0 warning(s) |
| [40713203872](https://github.com/PhilJordan18/aegis/actions/runs/40713203872/job/122903838512) | pull_request | `38-feat-ios-my-activity` | `8926ac2` | success | 0.2 | passed with 0 warning(s) |
| [40737458478](https://github.com/PhilJordan18/aegis/actions/runs/40737458478/job/122989828525) | push | `dev` | `32eb1ce` | success | 0.3 | passed with 0 warning(s) |
| [40740090880](https://github.com/PhilJordan18/aegis/actions/runs/40740090880/job/122999175673) | pull_request | `26-feat-asset-placement` | `05f450f` | success | 0.4 | passed with 0 warning(s) |
| [40754195616](https://github.com/PhilJordan18/aegis/actions/runs/40754195616/job/123048749383) | push | `dev` | `b740bdc` | success | 0.3 | passed with 0 warning(s) |
| [40754729747](https://github.com/PhilJordan18/aegis/actions/runs/40754729747/job/123050747783) | pull_request | `28-feat-operating-hours` | `77a38d2` | success | 0.3 | passed with 0 warning(s) |
| [40757782385](https://github.com/PhilJordan18/aegis/actions/runs/40757782385/job/123061325830) | pull_request | `34-feat-ios-asset-catalog` | `3768a9d` | success | 0.2 | passed with 0 warning(s) |
| [40757888220](https://github.com/PhilJordan18/aegis/actions/runs/40757888220/job/123064304444) | pull_request | `34-feat-ios-asset-catalog` | `210302f` | success | 0.2 | passed with 0 warning(s) |
| [40775801449](https://github.com/PhilJordan18/aegis/actions/runs/40775801449/job/123124718199) | push | `dev` | `71d1f81` | success | 0.1 | passed with 0 warning(s) |
| [40775851326](https://github.com/PhilJordan18/aegis/actions/runs/40775851326/job/123124875163) | pull_request | `100-feat-custody-schema` | `8028403` | success | 0.1 | passed with 0 warning(s) |
| [41504916299](https://github.com/PhilJordan18/aegis/actions/runs/41504916299/job/125481773460) | push | `dev` | `527c774` | success | 0.1 | passed with 0 warning(s) |
| [41505038554](https://github.com/PhilJordan18/aegis/actions/runs/41505038554/job/125482147891) | pull_request | `33-feat-readiness` | `65ed95b` | success | 0.2 | passed with 0 warning(s) |
| [41505916014](https://github.com/PhilJordan18/aegis/actions/runs/41505916014/job/125486875625) | push | `dev` | `c1366b3` | success | 0.3 | passed with 0 warning(s) |
| [41507526895](https://github.com/PhilJordan18/aegis/actions/runs/41507526895/job/125490624881) | pull_request | `34-feat-ios-asset-catalog` | `12c8776` | success | 0.3 | passed with 0 warning(s) |
| [41515528716](https://github.com/PhilJordan18/aegis/actions/runs/41515528716/job/125518105459) | push | `dev` | `007c584` | success | 0.2 | passed with 0 warning(s) |
| [41577162962](https://github.com/PhilJordan18/aegis/actions/runs/41577162962/job/125723289553) | pull_request | `37-feat-reservation` | `c7ed3a0` | success | 0.1 | passed with 0 warning(s) |
| [41577565271](https://github.com/PhilJordan18/aegis/actions/runs/41577565271/job/125724562024) | pull_request | `37-feat-reservation` | `29af946` | success | 0.2 | passed with 0 warning(s) |
| [41577913719](https://github.com/PhilJordan18/aegis/actions/runs/41577913719/job/125725657354) | push | `dev` | `639ada8` | success | 0.1 | passed with 0 warning(s) |
| [41581805590](https://github.com/PhilJordan18/aegis/actions/runs/41581805590/job/125738163137) | pull_request | `67-ci-qualify-controls` | `997e3ec` | success | 0.1 | passed with 0 warning(s) |
| [41581846591](https://github.com/PhilJordan18/aegis/actions/runs/41581846591/job/125738313034) | pull_request | `67-ci-promote-qualified-jobs` | `1ab1203` | failure | 0.1 | failed: 1 error(s), 0 warning(s) — **échec volontaire CI-02** |
| [41582652376](https://github.com/PhilJordan18/aegis/actions/runs/41582652376/job/125740846324) | pull_request | `98-feat-mqtt-schema-3` | `c38f13f` | success | 0.1 | passed with 0 warning(s) |
| [41583716102](https://github.com/PhilJordan18/aegis/actions/runs/41583716102/job/125744237629) | pull_request | `98-feat-mqtt-schema-3` | `8d21f98` | success | 0.1 | passed with 0 warning(s) |
| [41584155476](https://github.com/PhilJordan18/aegis/actions/runs/41584155476/job/125745679362) | pull_request | `67-ci-qualify-controls` | `aeedc49` | success | 0.1 | passed with 0 warning(s) |
| [41584158843](https://github.com/PhilJordan18/aegis/actions/runs/41584158843/job/125745782949) | pull_request | `67-ci-promote-qualified-jobs` | `a3f917c` | success | 0.1 | passed with 0 warning(s) |
| [41585187083](https://github.com/PhilJordan18/aegis/actions/runs/41585187083/job/125748951639) | pull_request | `29-feat-iot-evidence-schema` | `dfda477` | success | 0.1 | passed with 0 warning(s) |
| [41585549537](https://github.com/PhilJordan18/aegis/actions/runs/41585549537/job/125750094880) | pull_request | `38-feat-reservation-lifecycle` | `fa88351` | success | 0.2 | passed with 0 warning(s) |

## Accepted ADR guard

| Run | Événement | Branche | SHA | Conclusion | Durée (min) | Log |
|---|---|---|---|---|---:|---|
| [39711005595](https://github.com/PhilJordan18/aegis/actions/runs/39711005595/job/119603184488) | pull_request | `67-ci-extend-components` | `7e42241` | success | 0.1 | No accepted ADR changed |
| [39716573137](https://github.com/PhilJordan18/aegis/actions/runs/39716573137/job/119620021592) | pull_request | `67-ci-extend-components` | `ddbdfc8` | success | 0.1 | No accepted ADR changed |
| [39842225293](https://github.com/PhilJordan18/aegis/actions/runs/39842225293/job/120046053536) | pull_request | `25-feat-asset-catalog` | `8109f4d` | success | 0.1 | No accepted ADR changed |
| [39865839275](https://github.com/PhilJordan18/aegis/actions/runs/39865839275/job/120127743880) | pull_request | `35-docs-ios-technician-flows` | `485ab9a` | success | 0.1 | No accepted ADR changed |
| [39872972407](https://github.com/PhilJordan18/aegis/actions/runs/39872972407/job/120151674770) | pull_request | `35-docs-ios-technician-flows` | `0d13443` | success | 0.1 | No accepted ADR changed |
| [41581805590](https://github.com/PhilJordan18/aegis/actions/runs/41581805590/job/125738163111) | pull_request | `67-ci-qualify-controls` | `997e3ec` | success | 0.1 | No accepted ADR changed |
| [41581846591](https://github.com/PhilJordan18/aegis/actions/runs/41581846591/job/125738313017) | pull_request | `67-ci-promote-qualified-jobs` | `1ab1203` | failure | 0.1 | Accepted ADRs are immutable (ADR-901, dépôt jetable) — **échec volontaire CI-02** |
| [41584155476](https://github.com/PhilJordan18/aegis/actions/runs/41584155476/job/125745679278) | pull_request | `67-ci-qualify-controls` | `aeedc49` | success | 0.1 | No accepted ADR changed |
| [41584158843](https://github.com/PhilJordan18/aegis/actions/runs/41584158843/job/125745782943) | pull_request | `67-ci-promote-qualified-jobs` | `a3f917c` | success | 0.1 | No accepted ADR changed |

## iOS standalone tests

| Run | Événement | Branche | SHA | Conclusion | Durée (min) | Log |
|---|---|---|---|---|---:|---|
| [39711005595](https://github.com/PhilJordan18/aegis/actions/runs/39711005595/job/119603184504) | pull_request | `67-ci-extend-components` | `7e42241` | success | 11.7 | 93 total, 93 passed, 0 failed, 0 skipped |
| [39716573137](https://github.com/PhilJordan18/aegis/actions/runs/39716573137/job/119620021552) | pull_request | `67-ci-extend-components` | `ddbdfc8` | success | 10.8 | 93 total, 93 passed, 0 failed, 0 skipped |
| [39793631022](https://github.com/PhilJordan18/aegis/actions/runs/39793631022/job/119875572458) | push | `dev` | `bef30df` | success | 12.9 | 93 total, 93 passed, 0 failed, 0 skipped |
| [39795947196](https://github.com/PhilJordan18/aegis/actions/runs/39795947196/job/119883208769) | push | `dev` | `145e66f` | success | 8.0 | 93 total, 93 passed, 0 failed, 0 skipped |
| [39842225293](https://github.com/PhilJordan18/aegis/actions/runs/39842225293/job/120046053428) | pull_request | `25-feat-asset-catalog` | `8109f4d` | success | 12.7 | 93 total, 93 passed, 0 failed, 0 skipped |
| [39865839275](https://github.com/PhilJordan18/aegis/actions/runs/39865839275/job/120127743844) | pull_request | `35-docs-ios-technician-flows` | `485ab9a` | success | 11.6 | 93 total, 93 passed, 0 failed, 0 skipped |
| [39872972407](https://github.com/PhilJordan18/aegis/actions/runs/39872972407/job/120151674795) | pull_request | `35-docs-ios-technician-flows` | `0d13443` | success | 14.4 | 93 total, 93 passed, 0 failed, 0 skipped |
| [40690228021](https://github.com/PhilJordan18/aegis/actions/runs/40690228021/job/122822907572) | push | `dev` | `38c91ee` | success | 12.1 | 93 total, 93 passed, 0 failed, 0 skipped |
| [40690329981](https://github.com/PhilJordan18/aegis/actions/runs/40690329981/job/122828853108) | push | `dev` | `af22b7e` | success | 14.6 | 93 total, 93 passed, 0 failed, 0 skipped |
| [40698722765](https://github.com/PhilJordan18/aegis/actions/runs/40698722765/job/122852444734) | push | `dev` | `5ec4af2` | success | 12.6 | 93 total, 93 passed, 0 failed, 0 skipped |
| [40708958373](https://github.com/PhilJordan18/aegis/actions/runs/40708958373/job/122888731048) | pull_request | `34-feat-ios-asset-catalog` | `9813142` | cancelled | 5.2 |  |
| [40709029696](https://github.com/PhilJordan18/aegis/actions/runs/40709029696/job/122891975877) | pull_request | `34-feat-ios-asset-catalog` | `4272123` | success | 17.6 | 159 total, 159 passed, 0 failed, 0 skipped |
| [40713203872](https://github.com/PhilJordan18/aegis/actions/runs/40713203872/job/122903838060) | pull_request | `38-feat-ios-my-activity` | `8926ac2` | success | 21.1 | 170 total, 170 passed, 0 failed, 0 skipped |
| [40737458478](https://github.com/PhilJordan18/aegis/actions/runs/40737458478/job/122989828432) | push | `dev` | `32eb1ce` | success | 13.4 | 93 total, 93 passed, 0 failed, 0 skipped |
| [40754195616](https://github.com/PhilJordan18/aegis/actions/runs/40754195616/job/123048749491) | push | `dev` | `b740bdc` | success | 14.5 | 93 total, 93 passed, 0 failed, 0 skipped |
| [40757782385](https://github.com/PhilJordan18/aegis/actions/runs/40757782385/job/123061325932) | pull_request | `34-feat-ios-asset-catalog` | `3768a9d` | cancelled | 5.5 |  |
| [40757888220](https://github.com/PhilJordan18/aegis/actions/runs/40757888220/job/123064304466) | pull_request | `34-feat-ios-asset-catalog` | `210302f` | success | 18.9 | 160 total, 160 passed, 0 failed, 0 skipped |
| [40775801449](https://github.com/PhilJordan18/aegis/actions/runs/40775801449/job/123124718107) | push | `dev` | `71d1f81` | success | 15.9 | 93 total, 93 passed, 0 failed, 0 skipped |
| [41504916299](https://github.com/PhilJordan18/aegis/actions/runs/41504916299/job/125481773565) | push | `dev` | `527c774` | success | 8.7 | 93 total, 93 passed, 0 failed, 0 skipped |
| [41505916014](https://github.com/PhilJordan18/aegis/actions/runs/41505916014/job/125486875548) | push | `dev` | `c1366b3` | success | 12.6 | 93 total, 93 passed, 0 failed, 0 skipped |
| [41507526895](https://github.com/PhilJordan18/aegis/actions/runs/41507526895/job/125490624525) | pull_request | `34-feat-ios-asset-catalog` | `12c8776` | success | 21.4 | 160 total, 160 passed, 0 failed, 0 skipped |
| [41515528716](https://github.com/PhilJordan18/aegis/actions/runs/41515528716/job/125518105362) | push | `dev` | `007c584` | failure | 16.6 | 160 total, 158 passed, 2 failed, 0 skipped |
| [41577913719](https://github.com/PhilJordan18/aegis/actions/runs/41577913719/job/125725657291) | push | `dev` | `639ada8` | failure | 20.2 | 160 total, 159 passed, 1 failed, 0 skipped |
| [41578010941](https://github.com/PhilJordan18/aegis/actions/runs/41578010941/job/125725986951) | pull_request | `38-feat-ios-my-activity` | `418134a` | cancelled | 14.2 |  |
| [41579245986](https://github.com/PhilJordan18/aegis/actions/runs/41579245986/job/125736236692) | pull_request | `38-feat-ios-my-activity` | `ce1022e` | failure | 21.3 | 171 total, 170 passed, 1 failed, 0 skipped — tentative 2 |
| [41581805590](https://github.com/PhilJordan18/aegis/actions/runs/41581805590/job/125738163048) | pull_request | `67-ci-qualify-controls` | `997e3ec` | success | 22.9 | 160 total, 160 passed, 0 failed, 0 skipped |
| [41581846591](https://github.com/PhilJordan18/aegis/actions/runs/41581846591/job/125738312992) | pull_request | `67-ci-promote-qualified-jobs` | `1ab1203` | failure | 20.2 | 161 total, 160 passed, 1 failed, 0 skipped — **échec volontaire CI-02** |
| [41584155476](https://github.com/PhilJordan18/aegis/actions/runs/41584155476/job/125745679169) | pull_request | `67-ci-qualify-controls` | `aeedc49` | failure | 19.9 | 160 total, 159 passed, 1 failed, 0 skipped |
| [41584158843](https://github.com/PhilJordan18/aegis/actions/runs/41584158843/job/125745782915) | pull_request | `67-ci-promote-qualified-jobs` | `a3f917c` | success | 14.0 | 160 total, 160 passed, 0 failed, 0 skipped |

