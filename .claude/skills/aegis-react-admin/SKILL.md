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

Use semantic HTML, keyboard navigation, focus management, readable contrast, and accessible error feedback.

Do not introduce non-essential P1 animations during P0.

## Verification

Include:

- component tests for critical states;
- API mocking for success and failure;
- role and authorization behavior;
- mutation conflict behavior;
- accessibility checks;
- representative responsive layouts;
- unnecessary render and network-request inspection.