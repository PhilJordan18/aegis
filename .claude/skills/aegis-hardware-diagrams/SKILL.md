---
name: aegis-hardware-diagrams
description: Produce consistent, clean draw.io diagrams for Aegis hardware and wiring topology (hub/cellule architecture, locker wiring, MQTT/network layout) using the draw.io MCP connector.
---

# Aegis hardware diagrams

Use the draw.io MCP connector (`create_diagram`, `search_shapes`) for any diagram documenting Aegis physical hardware, wiring, or network topology — not the inline SVG visualize tool, which is for conversational explainers only. Diagrams meant for `docs/diagrams/` or the cahier de conception should be draw.io so they stay editable and versionable.

## Format choice

- Wiring topology, network/deployment layout, connector pinouts, floor/enclosure layout → **XML**, with `search_shapes` for electrical/network stencils when a pictorial icon adds clarity (connector, PSU, antenna). Use `routing: "libavoid"` when hand-placed nodes need clean orthogonal wires.
- Sequence of operations (checkout/return flow, MQTT command/ack/event flow), state machines (readiness, LockerOperation), or ER-style domain diagrams → **Mermaid** (`sequenceDiagram`, `stateDiagram-v2`, `erDiagram`). Add `postLayout: "elk"` once the diagram has real branching or ≥20 nodes.

## Vocabulary

Match the project's current terms exactly — do not reintroduce `master`/`node`:

- **hub** — the cube with the screen, compute, and network/MQTT uplink.
- **cellule** — a node cube: lock, sensor(s), no screen, no radio of its own.
- **alimentation** — the external power supply feeding the hub.

## Conventions

- Color by category, not sequence: hub = one color, cellule(s) = a second, PSU/power = neutral gray. Keep it to 2 colors + gray, same rule as the visualize tool's palette discipline.
- Label every cable with what it actually carries: `power + data`, `power only`, `MQTT/WiFi`. Never leave a connector line unlabeled in a wiring diagram — that's the ambiguity that caused the star-topology mix-up (a single point where 4 lines meet reads as one shared cable, not 4 dedicated ones; give each line its own distinct port/anchor point).
- Star topology = one dedicated port per cellule on the hub, one cable per cellule, no cable shared between cellules. Daisy-chain/loop = one hub port serving multiple cellules on a shared line. Never draw one as if it were the other.
- Keep P0 diagrams (single hub + up to 2 cellules) and product-vision diagrams (multi-cellule scaling) visually distinct — don't imply P0 commits to more hardware than `docs/cahier-conception/scope.md` §11.6/§17.5 actually requires.

## Default conceptual style (reference palette)

For explanatory/conceptual wiring diagrams (as opposed to the electrical-block-diagram style below), use this exact palette every time so diagrams look like one family:

| Element | Shape | fillColor | strokeColor | fontSize |
|---|---|---|---|---|
| `alimentation` (PSU) | ellipse | `#F5F5F5` | `#666666` | 12 |
| `hub` | rounded rect | `#d5e8d4` | `#82b366` | 13 |
| `cellule N` | rounded rect | `#f5f5f5` | `#666666` | 13 |
| port dot (on hub, one per cellule) | 8x8 ellipse | `#82b366` (matches hub stroke) | none | — |
| cable edge (power + data) | orthogonal edge | — | `#1a73e8` | 11, labeled `power + data` |
| PSU → hub edge | orthogonal edge | — | `#666666` | — |
| legend caption | text, centered below | — | fontColor `#666666` | 12 |

Use `edgeStyle=orthogonalEdgeStyle` with `libavoidRouting=1;jettySize=auto` (or pass `routing: "libavoid"`) so cables route cleanly instead of crossing boxes. Give each cellule its own port dot on the hub — never let multiple cable edges share one source point.

For the electrical/engineering-accurate variant (BOM-traceable: reference designators, fuse symbols, ground symbol, connector pinouts) use `search_shapes` for `fuse`, `signal ground`, and plain labeled rectangles for board-level ICs — reserve that style for hardware-spec documents, not the cahier de conception.

## Where diagrams live and GitHub rendering

**GitHub does not render `.drawio`/XML files as diagrams in the file browser** — it shows raw XML text. So for every diagram meant to actually be seen on github.com (README, ADR, cahier de conception), export and commit both:

- the `.drawio` source (editable, kept in sync) under `docs/diagrams/`, matching the filename to the concept (e.g. `hub-cellule-star-topology.drawio`);
- a rendered `.png` or `.svg` alongside it, embedded via a normal Markdown image (`![hub/cellule star topology](../diagrams/hub-cellule-star-topology.png)`) wherever the diagram needs to be visible.

Never link only the `.drawio` file and call it done — on GitHub that reads as unrendered XML to anyone without the desktop app or the drawio browser extension installed.
