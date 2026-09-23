# Aegis Design Workflow

Use this workflow for a substantial new interface, a redesign, or a mockup that
was rejected for visual quality. It prevents a one-shot generated screen from
becoming the design system by accident.

## 1. Establish the design brief

Record:

- target platform and primary persona;
- physical environment and device constraints;
- task the user must finish;
- information that must dominate;
- domain states and failure paths;
- real French copy and representative data;
- accessibility and platform constraints;
- current interface evidence, if one exists;
- observable success criteria.

If redesigning, critique the existing artifact before generating a replacement.
Separate problems of flow, hierarchy, visual direction, copy, platform fit and
craft. Do not assume the rejected artifact should remain the starting style.

## 2. Validate flow and information hierarchy

Produce the state matrix and low-fidelity wireframes before choosing decorative
details. Cover the nominal path plus the relevant loading, empty, blocked,
expired, disconnected, failure and anomaly states.

Approval gate A: the human can identify the primary task, current system state,
next safe action and recovery path without relying on color or visual polish.

## 3. Explore visual directions

For substantial or rejected work, propose two or three directions that differ
meaningfully in composition, density, typography, status treatment and visual
signature. Renaming the same layout with different colors is not exploration.

For each direction provide:

- a short concept statement;
- hierarchy and layout approach;
- typography and density intent;
- semantic color and status approach;
- one distinctive Aegis signature;
- platform-fit explanation;
- accessibility and implementation risks;
- a small representative composition or style tile when useful.

Use references to study patterns, not to copy a product. Record source links and
the specific principle learned. Prefer official platform guidance and products
with comparable operational density over trend galleries.

Recommend one direction and explain the tradeoff. Wait for human selection
before substantial high-fidelity production unless the user explicitly grants
the designer autonomy to choose.

Approval gate B: one direction is selected and the rejected directions remain
documented briefly enough to explain the decision.

## 4. Build the visual system

Define shared semantics without forcing Web and iOS into the same skin:

- readiness, severity, connectivity and operation-state tokens;
- type roles and numeric treatment;
- spacing and layout rhythm;
- borders, corners, elevation and focus;
- icon and status-label rules;
- motion and reduced-motion behavior;
- content patterns for reasons, timestamps and recovery actions.

Map those semantics to native platform behavior. SwiftUI should still feel like
iOS. The React administration surface may use denser tables, split views and
keyboard-oriented workflows that would be inappropriate on the phone.

## 5. Produce high-fidelity evidence

Use real French copy, realistic identifiers, long blocked reasons and meaningful
timestamps. Avoid lorem ipsum, decorative charts, fake metrics and empty cards.

Render the primary screens and the states most likely to break the design. At a
minimum include the nominal state, one adverse state and the longest realistic
copy at representative sizes. Follow the platform checklist and the visual
review protocol.

Approval gate C: rendered evidence passes review and the human explicitly
approves the direction for implementation.

## 6. Handoff and implementation review

The handoff must make implementation decisions reproducible: tokens, component
anatomy, layout behavior, copy, interaction, state mapping, accessibility and
acceptance checks. Call out what is intentionally native and what carries the
Aegis identity.

After implementation, compare rendered output with the approved handoff. Record
differences as accepted platform adaptations, defects or follow-up work. Never
declare fidelity from source inspection alone.

## Rejection conditions

Return the work to an earlier gate when it:

- resembles a generic dashboard or stock mobile template;
- hides status, reason or next action behind decoration;
- turns every datum into an interchangeable card;
- uses Web and iOS as scaled copies of one layout;
- depends on color alone;
- clips or overlaps at realistic content sizes;
- omits adverse states;
- invents domain behavior or unapproved data;
- cannot be rendered and inspected.
