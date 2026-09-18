# Aegis Visual Quality Bar

Use this reference when defining a visual direction, producing high-fidelity
mockups, reviewing implementation, or deciding whether an interface is ready
for demonstration.

## Product character

Aegis should feel like a trusted operational instrument: precise, calm,
technical, and unmistakably intentional. It may be visually memorable, but it
must not resemble a generic SaaS dashboard, a decorative cyberpunk concept, or
an entertainment interface.

Express the product through:

- strong information hierarchy;
- disciplined spacing and alignment;
- a restrained industrial palette with one recognizable accent;
- typography optimized for scanning status, identifiers, timestamps, and
  instructions;
- meaningful status shapes, icons, labels, and supporting text;
- coherent light and dark appearances when the platform supports them;
- polished empty, loading, blocked, failure, stale, and anomaly states;
- short, purposeful motion that explains change or progress.

Do not use gradients, glass effects, shadows, animation, or novelty typography
without a reason tied to hierarchy, feedback, or brand character.

## Direction before decoration

Before high-fidelity work, write a short visual-direction statement covering:

1. the user and physical context;
2. the primary job of the screen;
3. the intended emotional quality;
4. the information that must dominate;
5. one memorable visual signature;
6. the accessibility constraints;
7. what the design deliberately avoids.

Choose one coherent direction. Do not combine several unrelated visual trends.
Reuse platform conventions for interaction while making the hierarchy, content,
tokens, and details recognizably Aegis.

## Required system

Define and reuse:

- semantic color tokens, including readiness and severity roles;
- type roles rather than one-off font sizes;
- a spacing scale;
- corner, border, elevation, and focus treatments;
- icon rules and status-label patterns;
- density rules for mobile and administration views;
- motion duration and reduced-motion behavior;
- content patterns for titles, instructions, reasons, timestamps, and recovery.

Never communicate `READY`, `BLOCKED`, `UNKNOWN`, progress, or anomaly through
color alone.

## Review at real states

Do not approve a screen from its ideal populated state alone. Review at least:

- primary success state;
- loading or in-progress state;
- empty or first-use state;
- blocked or authorization failure;
- network/server failure;
- stale/disconnected state when relevant;
- longest realistic French copy;
- largest supported text or browser zoom;
- narrow and representative wide layouts.

Inspect rendered screenshots or a running interface. A source-only review is
not sufficient for high-fidelity approval.

## Demonstration quality gate

A design is demonstration-ready only when:

- the primary task is immediately identifiable;
- the current system state and next safe action are unambiguous;
- visual hierarchy survives realistic data and error messages;
- spacing, alignment, typography, icons, and copy are consistent;
- keyboard or assistive-technology focus is visible and logical;
- the implementation matches the approved tokens and components;
- no visual flourish delays or obscures an operational action;
- both team members can explain the design decisions.

## Tool independence

Figma is optional. Store decisions and handoffs in `docs/design/` using
repository-native Markdown plus reviewable SVG, PNG, HTML, or platform previews.
If Figma is adopted later, keep the repository handoff authoritative enough to
implement and review without access to a private Figma file.
