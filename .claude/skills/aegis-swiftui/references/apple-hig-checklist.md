# Apple HIG Checklist for Aegis Mobile

Use this checklist for every new iOS flow, high-fidelity mockup,
implementation review, and accessibility review.

## Authoritative references

- [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios/)
- [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Typography](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- [SwiftUI accessibility fundamentals](https://developer.apple.com/documentation/swiftui/accessibility-fundamentals)

When guidance may have changed, consult these official pages rather than
relying on remembered platform details.

## Platform-native structure

- Prefer standard SwiftUI navigation, controls, sheets, alerts, lists, forms,
  search, and progress presentation.
- Preserve expected back navigation, dismissal, safe areas, and system gesture
  behavior.
- Keep the primary task and content prominent; make secondary actions
  discoverable without crowding the screen.
- Place frequent primary actions where they are comfortable to reach without
  inventing unfamiliar gestures.
- Use SF Symbols and semantic system colors when they fit the meaning.
- Apply Aegis branding through hierarchy, content, tokens, and refined details;
  do not make the interface feel foreign to iOS.

## Accessibility baseline

- Support Dynamic Type through accessibility sizes without clipping critical
  content or hiding the next safe action.
- Use a 44 by 44 point target as the Aegis goal for interactive controls.
- Provide useful VoiceOver labels, values, hints, traits, grouping, and reading
  order; do not restate information VoiceOver already derives correctly.
- Verify controls remain usable with Voice Control and Switch Control.
- Respect Reduce Motion and avoid motion as the only carrier of status.
- Support light, dark, and Increase Contrast appearances.
- Do not hard-code system color values or rely on color alone.
- Keep destructive actions explicit and provide a safe recovery path.

## Aegis operation flow

- Distinguish preparation, QR scan, authorization, command, open door,
  observation, and backend confirmation.
- Never show checkout or return as complete before backend confirmation.
- Keep progress understandable if the app backgrounds and later returns.
- Prevent repeated primary actions while a request is in flight.
- Present blocked reasons and recovery steps in plain language.
- Use haptics or motion only as supporting feedback, never as sole evidence.

## Camera and QR

- Explain camera access in language connected directly to scanning the Aegis
  locker QR.
- Design permission-not-determined, denied, restricted, unavailable, scanning,
  invalid-code, expired-code, and success states.
- Provide a clear route to Settings after denial without repeatedly prompting.
- Keep the scanner overlay legible in bright and low-light conditions.
- Do not expose or retain the QR secret beyond the operation that submits it.

## Verification evidence

Record the devices or simulators, appearance, content-size category, and flow
tested. Before accepting a critical flow, verify:

- representative small and large iPhone layouts;
- default and largest accessibility text sizes;
- portrait orientation used by the demonstration;
- light, dark, and Increase Contrast appearances;
- VoiceOver order and spoken status;
- Reduce Motion behavior;
- camera denial and QR failure recovery;
- Accessibility Inspector findings;
- the real demonstration iPhone for camera-dependent behavior.
