# Aegis Visual Review Protocol

Use this protocol for high-fidelity mockups and implemented Web or iOS screens.
The reviewer may be the designer during iteration, but final implementation
review should preferably use an independent QA or design pass.

## Evidence required

Record:

- artifact or build revision;
- platform, viewport or device and appearance;
- content and state shown;
- relevant accessibility setting;
- rendered screenshot or directly inspected running interface;
- comparison target, when an approved handoff exists.

If the environment cannot render the artifact, report the review as blocked or
partial. Do not approve high fidelity from markup, SVG XML, CSS or SwiftUI source
alone.

## Review passes

### 1. Five-second hierarchy

Check whether a first look reveals:

- where the user is;
- the most important status;
- the primary task;
- the next safe action;
- whether attention or recovery is required.

### 2. Composition and craft

Inspect alignment, spacing rhythm, density, typography, truncation, icon weight,
border and elevation consistency. Look specifically for collisions, text over
connectors or decoration, accidental wrapping, weak contrast, oversized empty
regions and repeated card containers without a grouping reason.

### 3. State and content resilience

Review nominal, loading or progress, empty, blocked or validation failure,
network failure, stale or disconnected, and anomaly states when applicable.
Use the longest realistic French copy, representative identifiers, explicit
timezones and realistic data volume.

### 4. Platform and accessibility

Apply the Apple checklist for iOS or the Web checklist for React. Confirm that
branding changes presentation without replacing expected navigation, controls,
focus behavior, gestures or semantics.

### 5. System consistency

Compare tokens, components, status treatments, copy patterns and motion with the
approved direction. Web and iOS should share meaning and product character, not
necessarily layout or control styling.

## Finding format

For each problem record:

- severity: blocking, major or minor;
- evidence: screen, state and location;
- violated requirement or design decision;
- user consequence;
- recommended owner and correction.

Avoid subjective findings such as “make it pop.” State the observable mismatch
and why it weakens comprehension, platform fit, accessibility or Aegis identity.

## Verdict

Use one verdict:

- `APPROVE` — ready for the next gate or implementation;
- `REVISE` — direction is viable but specific corrections are required;
- `BLOCKED` — missing evidence, broken flow or unresolved decision prevents a
  reliable review.

Approval means the reviewed screens and states meet the current gate. It does
not approve unreviewed screens, domain behavior or implementation changes.
