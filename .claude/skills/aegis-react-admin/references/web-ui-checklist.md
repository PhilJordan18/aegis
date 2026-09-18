# Web UI and WCAG Checklist for Aegis Manager

Use this checklist for every new administrator workflow, high-fidelity mockup,
implementation review, and accessibility review.

## Authoritative references

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [How to Meet WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/)
- [ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)

Target WCAG 2.2 Level AA for the P0 Web experience. Use native HTML before
ARIA. When a custom widget is truly necessary, follow the corresponding APG
keyboard and semantic pattern and test the result; APG examples are guidance,
not a production design system.

## Operational visual direction

- Make status, blocked reasons, anomalies, affected assets, and safe next
  actions dominate the hierarchy.
- Use intentional typography, spacing, density, and a restrained palette so the
  application feels like an Aegis operations console rather than a generic
  template.
- Keep tables scannable and preserve row identity when data refreshes.
- Use cards only when they improve grouping; do not turn every fact into a card.
- Keep dashboards focused on decisions and exceptions, not decorative metrics.
- Define responsive behavior for navigation, tables, forms, timelines, and
  detail panels before implementation.
- Make light/dark support a deliberate project decision; never ship an
  incomplete theme solely for visual novelty.

## Semantics and keyboard

- Use landmarks, one clear page heading, ordered heading levels, native buttons,
  links, inputs, labels, tables, and dialogs.
- Preserve a logical tab order without positive `tabindex` values.
- Provide visible focus that is not obscured by sticky content.
- Support expected keyboard operation for menus, dialogs, tabs, disclosure
  controls, grids, and other composite widgets.
- Move focus deliberately after dialog open/close, validation failure, route
  changes, destructive confirmation, and asynchronous content replacement.
- Provide a skip mechanism when repeated navigation would otherwise block task
  completion.

## Perception and content

- Meet WCAG 2.2 AA contrast requirements and keep content usable with increased
  contrast or forced colors.
- Do not encode readiness, severity, connectivity, or selection through color
  alone.
- Keep content and controls usable at 200 percent zoom and during text resize.
- Give icons accessible names when they act as controls; hide decorative icons
  from assistive technology.
- Use plain, actionable French interface copy while keeping source identifiers
  and code in English.
- Expose timestamps with an explicit timezone and understandable format.

## Forms, feedback, and live state

- Associate instructions and errors with their fields and provide an error
  summary for long forms.
- Preserve entered values after server validation failures when safe.
- Announce important asynchronous status changes without stealing focus.
- Distinguish loading, empty, stale, disconnected, unauthorized, forbidden,
  conflict, and server-error states.
- Disable or guard duplicate submissions and explain why an unavailable action
  cannot proceed.
- Require explicit confirmation for destructive or custody-sensitive actions.

## Verification evidence

Before accepting a critical workflow, record evidence for:

- automated accessibility checks using the approved test setup;
- complete keyboard-only operation;
- visible focus and focus restoration;
- 200 percent zoom and a narrow responsive viewport;
- representative desktop layout;
- a screen-reader smoke test of headings, forms, dialogs, status, and tables;
- forced-colors or increased-contrast behavior where available;
- loading, empty, long-copy, validation, authorization, network, and stale-data
  states;
- rendered screenshot review against approved tokens and handoff.

Automated checks cannot replace keyboard, screen-reader, responsive, and visual
inspection.
