---
name: aegis-hardware-diagrams
description: Produce consistent, clean, dark-mode-only diagrams for Aegis — hardware/wiring topology (hub/cellule, locker wiring) via draw.io XML, and system/actor/component architecture (technicien, administrateur, iOS, React, Spring, PostgreSQL, MQTT, ESP32) via Mermaid — using the draw.io MCP connector. Every diagram document matches the canonical `docs/diagrams/architecture-globale.md` shape — a short description, one diagram, one file, never a light/dark pair or a long prose write-up.
---

# Aegis diagrams

Use the draw.io MCP connector (`create_diagram`, `search_shapes`) for any diagram documenting Aegis physical hardware, wiring, network topology, or system/component architecture — not the inline SVG visualize tool, which is for conversational explainers only. Diagrams meant for `docs/diagrams/`, the README, or the cahier de conception should go through this connector so they stay editable, versionable, and visually consistent with every other Aegis diagram.

## Format choice

- Wiring topology, network/deployment layout, connector pinouts, floor/enclosure layout → **XML**, with `search_shapes` for electrical/network stencils when a pictorial icon adds clarity (connector, PSU, antenna). Use `routing: "libavoid"` when hand-placed nodes need clean orthogonal wires.
- Whole-system or component architecture (actors + software + infra + hardware, e.g. the README "Architecture du système" diagram), sequence of operations (checkout/return flow, MQTT command/ack/event flow), state machines (readiness, LockerOperation), or ER-style domain diagrams → **Mermaid** (`flowchart TD`, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`). Add `postLayout: "elk"` once the diagram has real branching or ≥20 nodes. See "System / actor architecture style" below for the exact template.

## Document format (mandatory — match every time)

Every diagram document (anything under `docs/diagrams/`, a diagram-carrying ADR, or a diagram destined for the README) follows the exact shape of the canonical reference, [`docs/diagrams/architecture-globale.md`](../../../docs/diagrams/architecture-globale.md) — regardless of whether the diagram itself is Mermaid or an exported XML/SVG:

1. `# <Title>` — short and specific.
2. **One description paragraph, 1–3 sentences.** What the diagram shows, plus provenance/canonical-status if relevant (e.g. "version canonique, identique au README"). Never a bullet essay.
3. **Exactly one diagram artifact per section, one file, dark palette, no light variant.** One ```mermaid block, or one embedded image — never a `#gh-light-mode-only`/`#gh-dark-mode-only` pair by default (see "Default conceptual style" below for the rare exception). If a concept genuinely needs several pictorial views (front/side/back, a mechanism cross-section, a topology), compose them into a single combined multi-panel SVG rather than several unrelated images.
4. **Legend, only if the diagram uses a category palette** — a short table, category → contents (see "Légende des catégories" in the reference).
5. **Optional short rules/decisions recap — bullets only, ≤5 lines, one sentence each.** Design rationale and discussion history belong in an ADR or the conversation log, not in a diagram doc. Never reproduce a long "Décisions encodées"-style essay.
6. **Optional one-line status** (e.g. "Prototype / exploratoire") only if the diagram is provisional.

**Exception — a small set of closely related diagrams may share one doc** (e.g. several angles/aspects of the same physical object) instead of one file each: one `#` title, then one `##` section per diagram, each still following rules 2–5 exactly (short description, one image, optional legend, optional ≤5-bullet recap) — a shared `## Statut` at the end instead of repeating it per section. What's never allowed, shared doc or not, is a long prose write-up per diagram or a diagram missing its own short description.

Skeleton:

````markdown
# <Title>

<1–3 sentence description>

```mermaid
<one flowchart>
```
<!-- or, for an XML/SVG-based diagram: ![<short alt text>](<one-file>.svg) -->

## Légende des catégories   <!-- only if a category palette is used -->

| Catégorie | Contenu |
|---|---|
| ... | ... |

## <short rules/decisions recap>   <!-- optional, ≤5 bullets -->

- ...
````

`docs/diagrams/architecture-physique/architecture-physique.md` is a second worked example of the shared-doc exception above: one file, one `##` section per diagram (vues / mécanisme de verrouillage / connectivité), each with a short description, one fixed-dark SVG, a small legend, and a ≤2-bullet recap, plus one shared `## Statut`. What makes this different from the old shape it replaced isn't the file count — it's that every section stays short; do not let any section grow back into a "Décisions encodées"-style essay.

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

## Default conceptual style (dark palette, single file, mandatory)

For explanatory/conceptual wiring diagrams (as opposed to the electrical-block-diagram style below), every diagram is **one complete SVG file, dark palette, canvas included** — no light variant, no second file:

| Element | Shape | fill | stroke | fontSize |
|---|---|---|---|---|
| canvas / page background | full-page fill | `#1e1e1e` | — | — |
| `alimentation` (PSU) | ellipse | `#3a3a3a` | `#b0b0b0` | 12 |
| `hub` | rounded rect | `#3d5a41` | `#8fd382` | 13 |
| `cellule N` | rounded rect | `#454545` | `#a3a3a3` | 13 |
| door/trappe (if drawn) | rect | `#5a4420` | `#e0a94a` | — |
| connector/plug pictogram | polygon/rect | `#4a4a4a` | `#d0d0d0` | — |
| rail/bracket bar (+ its label) | rect (+ text) | `#7a7975` / `#ffffff` text | — | 7–9 |
| status LED / port dot (one per cellule, matches hub stroke) | small ellipse | `#8fd382` | none | — |
| cable edge (power + data) | orthogonal edge | — | `#6cb2ff` | 11, labeled `power + data` |
| primary label text | — | `#e8e8e8` | — | as noted |
| muted/caption text (legend, secondary notes) | — | `#b0b0b0` | — | 9–12 |
| door/trappe label text | — | `#f5e0b8` | — | — |
| thin leader/callout line | line | — | `#999999` | — |

This is the same palette family already in use in `docs/diagrams/architecture-physique/` — reuse those exact values rather than inventing new ones, so every physical diagram in the set looks like one family. Use `edgeStyle=orthogonalEdgeStyle` with `libavoidRouting=1;jettySize=auto` (or pass `routing: "libavoid"`) so cables route cleanly instead of crossing boxes. Give each cellule its own port dot on the hub — never let multiple cable edges share one source point.

For the electrical/engineering-accurate variant (BOM-traceable: reference designators, fuse symbols, ground symbol, connector pinouts) use `search_shapes` for `fuse`, `signal ground`, and plain labeled rectangles for board-level ICs — reserve that style for hardware-spec documents, not the cahier de conception. Same `#1e1e1e` page background and `#e8e8e8` label color; only the stencil colors returned by `search_shapes` are exempt from the table.

### If a doc specifically needs to render correctly in both GitHub light and dark mode (rare, opt-in only)

Default to dark-only, above. Only reach for this when a doc is genuinely customer/officially facing to an audience whose GitHub theme you don't control — it doubles the SVG count (light file + `<name>-dark.svg`), so it's an explicit exception, not the house style. Ship both as complete, static, single-theme files (light palette = the mirror of the table above with `#ffffff` canvas and the original light hex set from before this palette was made dark-only) and embed both with GitHub's native fragments:

```markdown
![<short alt text>](<name>.svg#gh-light-mode-only)
![<short alt text>](<name>-dark.svg#gh-dark-mode-only)
```

Do not use an embedded `<style>@media (prefers-color-scheme: dark){…}</style>` block in one file instead — documented to fail in Safari even where it works in Chrome/Firefox, and it isn't GitHub's supported mechanism. The two-file fragment pair is GitHub's own documented approach ([github.blog](https://github.blog/developer-skills/github/how-to-make-your-images-in-markdown-on-github-adjust-for-dark-mode-and-light-mode/)).

## System / actor architecture style (Mermaid)

For whole-system or component architecture diagrams — actors plus software, infra, and hardware blocks, like the README's "Architecture du système" — use Mermaid `flowchart TD` with `classDef` categories, not draw.io XML. This renders natively in GitHub Markdown, so unlike the XML styles above, **no separate `.svg`/`.png` export is needed** — paste the fenced ```mermaid block directly into the README/ADR/scope doc. The palette below is the dark-mode set (mandatory) — chosen to read clearly on a dark canvas; never substitute lighter pastel values.

Reference template — reproduce this exact style (labels, arrows, palette) every time:

```mermaid
flowchart TD
    TECH["Technicien"]:::persona
    ADMIN["Administrateur"]:::persona
    IOS["Aegis Mobile<br/>SwiftUI"]:::software
    WEB["Aegis Manager<br/>React"]:::software
    API["Aegis Control<br/>Spring Boot"]:::software
    DB[("PostgreSQL")]:::infra
    BROKER["Broker MQTT"]:::infra
    NODE["Aegis Locker Node<br/>ESP32"]:::hardware

    TECH -->|utilise| IOS
    ADMIN -->|utilise| WEB
    IOS -->|HTTPS| API
    WEB -->|HTTPS| API
    API --> DB
    API <-->|MQTT securise| BROKER
    BROKER <-->|Commandes et evenements| NODE

    classDef persona fill:#2B2440,stroke:#9F91F0,color:#EDE9FE
    classDef software fill:#0F2C46,stroke:#58A6FF,color:#D6E8FB
    classDef infra fill:#2A2A2E,stroke:#9CA3AF,color:#E6EDF3
    classDef hardware fill:#3A2A0E,stroke:#D9A441,color:#FCEACD
```

What this encodes, apply it every time:

- **Two-line node labels** via `<br/>`: product/role name on line 1, technology on line 2 (`"Aegis Mobile<br/>SwiftUI"`). Persona nodes (people) stay single-line.
- **Every arrow carries a label** describing what actually crosses it (`-->|HTTPS|`, `<-->|MQTT securise|`, `-->|utilise|`) — never an unlabeled edge between two blocks, same rule as the wiring conventions above.
- **A database is a cylinder** (`DB[("PostgreSQL")]`), not a rectangle. Reserve plain rectangles for software/service/hardware/persona nodes.
- **Exactly 4 categories, one `classDef` each** — don't add a 5th color or cycle colors by position. Reuse these exact hex values every time rather than inventing new ones:

| Category | fill | stroke | text |
|---|---|---|---|
| persona (people) | `#2B2440` | `#9F91F0` | `#EDE9FE` |
| software (iOS/React/Spring) | `#0F2C46` | `#58A6FF` | `#D6E8FB` |
| infra (PostgreSQL/MQTT broker) | `#2A2A2E` | `#9CA3AF` | `#E6EDF3` |
| hardware (ESP32/locker) | `#3A2A0E` | `#D9A441` | `#FCEACD` |

- **Match existing official names exactly** — `Aegis Mobile`, `Aegis Manager`, `Aegis Control`, `Aegis Locker Node`, `Technicien`, `Administrateur` are already defined in `README.md`; never rename them or invent alternates in a new diagram.
- **Never bake a POC-gated architecture into this diagram as if committed.** `hub`/`cellule` is a documented product-vision idea still gated behind `docs/cahier-conception/scope.md` §17.5 (not decided; has a monolithic fallback) — keep `Aegis Locker Node` as the node label until that gate resolves one way or the other. Mixing a gated hypothesis into the "official" system diagram misrepresents P0 as committing to more hardware than it does.

## Where diagrams live and GitHub rendering

**GitHub does not render `.drawio`/XML files as diagrams in the file browser** — it shows raw XML text. So for every diagram meant to actually be seen on github.com (README, ADR, cahier de conception), export and commit:

- the `.drawio` source (editable, kept in sync) under `docs/diagrams/`, matching the filename to the concept (e.g. `hub-cellule-star-topology.drawio`);
- the rendered `<name>.svg` export — dark palette, per "Default conceptual style" above — embedded wherever the diagram needs to be visible.

Never link only the `.drawio` file and call it done — on GitHub that reads as unrendered XML to anyone without the desktop app or the drawio browser extension installed. Never export with a white/transparent background either — a dark-palette diagram on a light canvas is the bug the "Default conceptual style" table exists to prevent.
