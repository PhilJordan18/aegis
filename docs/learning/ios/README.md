# Aegis Mobile: SwiftUI through a React lens

This first lesson explains how a future iOS client can consume the existing
sign-in API. The PowerPoint is editable; the PDF is a reading copy. Both are
in `output/`.

## What the lesson does and does not claim

- `apps/ios/` contains no Swift source as of 30 September 2026. Swift samples
  in the deck are illustrative and have not been compiled.
- The login and current-profile endpoints **are implemented** in the Spring API.
  The approved iOS catalogue image is concept art, not an app screenshot.
- The team has asked to scope a real account-registration feature. This
  lesson covers the current sign-in contract only and does not assume that
  registration has been designed or implemented.
- The `@Observable` mental-model comparison applies to iOS 17 and later.
  Choose the minimum iOS version before implementing a shared observation model.

## Project sources

- `README.md`: system boundaries and product demonstration.
- `services/api/README.md`: verified backend routes and local setup.
- `services/api/src/main/java/ca/aegis/control/identity/AuthController.java`:
  implemented login and profile routes.
- `services/api/src/main/java/ca/aegis/control/identity/LoginRequest.java`,
  `LoginResponse.java`, `UserProfile.java`: implemented JSON boundary types.
- `docs/cahier-conception/02-scope.md`: P0 technician role and backend authority.
- `docs/cahier-conception/09-contrats-rest.md`: authentication, storage and
  response contracts.
- `docs/design/asset-lifecycle/direction-validee.md` and
  `docs/design/asset-lifecycle/prototype/README.md`: selected visual direction
  and concept-image provenance.

## Apple references

- [SwiftUI model data](https://developer.apple.com/documentation/swiftui/model-data)
- [Managing model data in your app](https://developer.apple.com/documentation/SwiftUI/Managing-model-data-in-your-app)
- [URLSession `data(for:)`](https://developer.apple.com/documentation/foundation/urlsession/data%28for%3A%29)
- [Keychain services](https://developer.apple.com/documentation/security/keychain-services/)

The PowerPoint speaker notes provide slide-level source attribution and
qualification. The PDF does not carry those notes, so keep this source map
with the reading copy.
