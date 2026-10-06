# Aegis Learning Lab

English-language, code-grounded teaching decks for Philippe and Jimmy. These are learning aids, not product contracts or accepted ADRs. They describe the repository as inspected on 30 September 2026.

| Order | Deck | Purpose | Status |
| --- | --- | --- | --- |
| 1 | [Spring Boot, from zero to Aegis](spring-foundations/output/aegis-spring-foundations-v3.pdf) ([editable slides](spring-foundations/output/aegis-spring-foundations-v3.pptx)) | Boot, dependency injection, layers, `JdbcClient`, SQL/Flyway, and tests | Grounded in implemented API code |
| 2 | [The Spring IAM slice](iam/output/aegis-spring-iam-v2.pdf) ([editable slides](iam/output/aegis-spring-iam-v2.pptx)) | Trace `/auth/login` and `/auth/me` through security, service, repository, token, and tests | Grounded in implemented API code |
| 3 | [SwiftUI through a React lens](ios/output/aegis-ios-swiftui-sign-in-final.pdf) ([editable slides](ios/output/aegis-ios-swiftui-sign-in-final.pptx)) | Map React ideas to SwiftUI and design the first sign-in slice | Conceptual client examples; no native Aegis iOS code exists yet |

## What is real today

- Flyway **does not replace SQL**. The repository has versioned migrations in `services/api/src/main/resources/db/migration/`, including `V001__create_schema_and_extensions.sql` and `V002__create_identity_and_catalog.sql`.
- The API currently uses Spring `JdbcClient`, not JPA/Hibernate. The implemented HTTP slice is health, login, and current profile.
- `apps/ios/` has no Swift/Xcode implementation yet. The iOS lesson labels sample Swift as illustrative and existing design screens as concept art.
- Public signup is not implemented. The team's new desire for real registration still needs a product, authorization, and contract decision before coding.

## Suggested study loop

1. Read one deck, then open the exact repository files named on its final exercise slide.
2. Explain one request or migration aloud without the slides. If a step is unclear, trace the call site and the test.
3. Change only a tiny, safe exercise in a separate task; run the relevant tests, then compare observed behavior with your prediction.

Future feature decks should follow delivered vertical slices: catalogue/readiness, reservation, local authorization and MQTT, checkout/return, and Web/iOS integration. Do not teach planned contracts as implemented behavior.
