---
name: aegis-swiftui
description: Implement the Aegis SwiftUI technician application using structured concurrency, secure token storage, backend-authoritative workflows, and accessible physical-operation guidance.
---

# Aegis SwiftUI Mobile

## Technology

Use:

- Swift;
- SwiftUI;
- async/await;
- URLSession;
- Keychain for authentication secrets.

Do not add a large application framework without a demonstrated need.

## Responsibility

The iOS P0 flow supports:

- authentication;
- asset search;
- readiness inspection;
- reservation;
- checkout request;
- physical-operation progress;
- confirmed loan;
- return;
- anomaly and recovery guidance.

The app never communicates directly with MQTT, ESP32, or PostgreSQL.

## Architecture

Keep clear boundaries between:

- views;
- presentation state;
- API client;
- authentication storage;
- domain-facing models;
- platform services.

Make dependencies replaceable for tests.

Avoid embedding network calls or authoritative rules directly in SwiftUI views.

## Concurrency

- Use structured concurrency.
- Cancel work when its owning screen or operation ends.
- Isolate UI mutations appropriately.
- Avoid duplicate requests caused by repeated view appearance.
- Decode errors explicitly.
- Handle token expiry and session invalidation predictably.

Do not choose polling, push, or refresh strategy silently. Follow the approved communication design or raise an ADR question.

## Security

- Store tokens in Keychain.
- Never print tokens or sensitive data.
- Validate server identity using platform HTTPS behavior and approved configuration.
- Do not treat local device state as proof of authorization.
- Treat server conflicts and expiry as authoritative.

## Physical workflow

Display backend-confirmed progress:

1. authorization in progress;
2. compartment command sent;
3. door opened;
4. physical confirmation awaited;
5. confirmed, failed, expired, or anomalous.

Do not display a completed loan before backend confirmation.

## Design and accessibility

Implement approved artifacts from `docs/design/`.

Read `references/apple-hig-checklist.md` before designing or implementing a new
screen, changing navigation or interaction patterns, adding camera behavior, or
performing an iOS design/accessibility review. When platform guidance may have
changed, verify it against the linked official Apple sources.

Prefer familiar SwiftUI components and platform behavior. Express Aegis through
purposeful hierarchy, content, semantic colors, typography, SF Symbols, and
refined feedback rather than by replacing standard iOS interaction patterns.

Support:

- Dynamic Type;
- VoiceOver;
- sufficient touch targets;
- reduced motion;
- unambiguous READY, BLOCKED, and UNKNOWN communication;
- useful recovery messages.

Support camera permission denial, QR scan failure, expired codes, and return to
an interrupted operation as designed states rather than generic alerts.

## Verification

Include:

- model and decoding tests;
- API-client tests;
- authentication-expiry tests;
- view-model or presentation-state tests;
- duplicate-action prevention;
- operation state-transition tests;
- accessibility identifiers for critical flows.

For critical screens, also verify rendered previews or the running app at
representative iPhone sizes, large accessibility text, light/dark appearance,
Increase Contrast, Reduce Motion, and VoiceOver. Camera-dependent acceptance
requires the real demonstration device.
