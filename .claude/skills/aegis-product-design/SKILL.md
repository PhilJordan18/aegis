---
name: aegis-product-design
description: Design distinctive, platform-appropriate Aegis technician and administrator experiences through validated flows, state matrices, accessible mockups, visual systems, usability review, and implementation handoffs.
---

# Aegis Product Design

## Design modes

Always state the current mode.

### Mode 1 — Discovery

Produce:

- user goals;
- task flows;
- information architecture;
- edge cases;
- content requirements;
- state matrix.

Do not edit application code.

### Mode 2 — Prototype

Produce:

- low-fidelity wireframes first;
- two or three materially different visual directions for substantial new or
  rejected work;
- a written recommendation grounded in the Aegis product and user context;
- reusable component inventory;
- design tokens;
- high-fidelity mockups only after flow and direction approval;
- responsive and accessibility annotations.

Do not edit application code.

### Mode 3 — Implementation support

This mode requires explicit human approval of the relevant mockup.

You may then:

- review the implementation;
- refine presentation-layer components;
- adjust layout, typography, spacing, colors, and interaction feedback;
- collaborate with the React or iOS owner.

Do not change:

- backend rules;
- network contracts;
- authentication logic;
- database behavior;
- state-machine semantics.

### Mode 4 — Usability review

Evaluate a prototype or implementation against the task flow, state matrix,
approved visual system, platform standards, and accessibility expectations.
Record evidence and actionable findings. Do not silently redesign domain
behavior while reviewing the interface.

## Substantial redesign workflow

For a new product surface, a major redesign, or work rejected for visual
quality, read `references/design-workflow.md` and follow its approval gates.

Do not polish a rejected mockup by default. First identify why its hierarchy,
composition, platform fit, content, or visual character failed, then develop
fresh directions from the validated flow.

Small presentation corrections do not require multiple directions or renewed
approval when they stay within an already approved visual system.

## Personas

### Technician — iOS

Optimize for:

- fast asset search;
- unmistakable readiness;
- clear blocked reasons;
- reservation;
- guided checkout and return;
- operation progress;
- recovery from physical anomalies;
- minimal interaction while working in a lab.

### Administrator — React

Optimize for:

- asset and model management;
- readiness diagnosis;
- reservations and active loans;
- locker and device state;
- anomaly investigation;
- audit reconstruction;
- safe corrective actions.

## Required UI states

Every important screen must define:

- loading;
- empty;
- success;
- blocked;
- validation error;
- server error;
- unauthorized;
- expired operation;
- physical operation in progress;
- anomaly;
- stale or disconnected state.

Never encode READY, BLOCKED, or UNKNOWN through color alone.

Display actionable reason text.

## Physical-operation UX

Represent the actual sequence:

1. request received;
2. authorization checked;
3. command sent;
4. compartment opened;
5. physical observation awaited;
6. confirmation or anomaly.

Do not show a loan or return as completed before backend confirmation.

## Accessibility

Web:

- keyboard navigation;
- visible focus;
- semantic structure;
- sufficient contrast;
- readable error association;
- no mouse-only actions.

iOS:

- Dynamic Type;
- VoiceOver labels;
- appropriate touch targets;
- reduced-motion compatibility;
- clear destructive-action confirmation.

## Visual quality

Aim for a demonstration-quality interface that is recognizably Aegis, not a
generic generated dashboard. Read
`references/visual-quality-bar.md` before defining a visual direction,
producing high-fidelity work, or performing a visual implementation review.

For iOS work, also apply the Apple checklist from
`../aegis-swiftui/references/apple-hig-checklist.md`. For Web work, also apply
the WCAG checklist from
`../aegis-react-admin/references/web-ui-checklist.md`.

Before approving high-fidelity work or an implementation, read and apply
`references/visual-review-protocol.md`. Source files alone are not visual
evidence. Inspect rendered output at representative sizes and record the
result.

Use platform conventions for behavior while expressing Aegis through hierarchy,
content, tokens, typography, status treatment, and refined details. Require
rendered evidence for high-fidelity approval.

## Scope

P0 requires clarity, reliability, and a coherent visual system. High visual
quality is valuable when it strengthens comprehension, confidence, and the
demonstration.

Advanced animations and non-essential visual experimentation remain P1.

Figma is optional. Do not block discovery, prototype, implementation, or review
on an external design account. Keep implementation-ready artifacts and decisions
in the repository.

Store artifacts under `docs/design/` and include a handoff containing:

- target platform;
- flow;
- screen states;
- component specifications;
- tokens;
- accessibility expectations;
- copy;
- unresolved questions;
- acceptance checklist.

For substantial flows, keep the evidence together under
`docs/design/<flow-or-surface>/`:

- `brief.md` — user, environment, problem, constraints, success criteria;
- `states.md` — flow and state matrix;
- `directions.md` — alternatives, references, tradeoffs, selected direction;
- `wireframes/` — low-fidelity artifacts;
- `mockups/` — approved high-fidelity artifacts and rendered evidence;
- `handoff.md` — tokens, components, copy, behavior, accessibility and
  acceptance checks;
- `review.md` — implementation comparison and remaining findings.

Do not create empty placeholders. Add only the artifacts required by the
current design stage.
