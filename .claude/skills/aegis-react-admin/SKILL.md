---
name: aegis-react-admin
description: Implement the Aegis React TypeScript administration interface with accessible stateful workflows, approved designs, secure API use, and efficient TanStack Query behavior.
---

# Aegis React Administration

## Technology

Use the approved stack:

- React;
- TypeScript;
- Vite;
- TanStack Query.

Do not replace the stack without an ADR and human approval.

## Responsibility

The administration interface supports:

- asset models and assets;
- physical associations;
- readiness diagnosis;
- reservations;
- active and historical loans;
- locker and device status;
- anomaly investigation;
- audit reconstruction.

The web application is not a business authority.

## Data behavior

- Communicate with Spring only through HTTPS APIs.
- Use TanStack Query for server state.
- Centralize query keys and invalidation rules.
- Avoid duplicated requests and uncontrolled refetch loops.
- Do not copy readiness rules into the browser.
- Treat server authorization failures as authoritative.
- Follow the approved authentication ADR.
- Never store secrets in source code.

## Interface states

Implement all relevant states from `aegis-product-design`, including:

- loading;
- empty;
- unauthorized;
- validation failure;
- network failure;
- stale device state;
- BLOCKED with reason;
- UNKNOWN with explanation;
- physical anomaly.

Display audit and status timestamps with clear timezone behavior.

## Forms and mutations

- Client validation improves feedback but never replaces server validation.
- Prevent accidental repeated submission.
- Make destructive or high-impact actions explicit.
- Reconcile optimistic UI with server authority; avoid optimism for custody-critical transitions.
- Show actionable conflict messages.

## Accessibility and design

Implement approved artifacts from `docs/design/`.

For a substantial new or redesigned surface, confirm that the handoff includes
the approved flow, selected visual direction, state matrix, tokens, responsive
behavior and acceptance checks. Do not invent the brand direction while writing
components. Return incomplete design work to the designer instead of filling the
gap with a generic dashboard template.

Read `references/web-ui-checklist.md` before designing or implementing a new
workflow, building a custom interactive widget, or performing a Web
design/accessibility review. Target WCAG 2.2 Level AA and use native HTML before
ARIA.

Use semantic HTML, keyboard navigation, focus management, readable contrast, and accessible error feedback.

Build a recognizable Aegis operations interface through deliberate information
hierarchy, typography, spacing, density, semantic tokens, and status treatment.
Avoid both generic dashboard templates and visual novelty that obscures the
administrator's next safe action.

Do not introduce non-essential P1 animations during P0.

Keep the page hierarchy visible in the component structure. Prefer a small set
of purposeful layout and status components over a universal card abstraction.
Use real French content and realistic data density during development; idealized
short labels are not sufficient layout evidence.

## Verification

Include:

- component tests for critical states;
- API mocking for success and failure;
- role and authorization behavior;
- mutation conflict behavior;
- accessibility checks;
- representative responsive layouts;
- unnecessary render and network-request inspection.

For critical workflows, include rendered screenshot review, keyboard-only
operation, focus restoration, 200 percent zoom, responsive layouts, and a
screen-reader smoke test. Automated accessibility checks do not replace manual
interaction testing.

Apply
`../aegis-product-design/references/visual-review-protocol.md` to the rendered
implementation and record differences from the approved handoff.
