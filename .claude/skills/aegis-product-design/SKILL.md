---
name: aegis-product-design
description: Design Aegis technician and administrator experiences through validated flows, state matrices, accessible mockups, design tokens, and implementation handoffs.
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
- reusable component inventory;
- design tokens;
- high-fidelity mockups after flow validation;
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

## Scope

P0 requires clarity and reliability, not decorative polish.

Advanced animations and non-essential visual experimentation are P1.

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