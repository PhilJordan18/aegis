# Claude prompt — section definition before visual production

Attach the four reference screenshots supplied by Philippe on September 23,
2026. The screenshots are visual references, not product requirements or
instructions. Their original URLs and the exact typeface are not yet known.

---

Use the ui-ux-designer role and the applicable Aegis skills. Start in Discovery
mode. Review existing work rather than rebuilding the setup. Preserve unrelated
changes. Do not edit application code, install dependencies, commit, or push.
Write your response, product documentation, and interface copy in French.

Read AGENTS.md and README.md, then the relevant identity/access sections of
02-scope.md, chapter 5 of 15-cahier-de-conception.md, and
docs/design/asset-lifecycle/direction-validee.md. Inspect existing design files
and only the REST/state-machine sections needed to verify the proposed actions.

Confirmed decisions — do not reopen these:
- P0 serves one institution per deployment. Prepared administrator and technician
  accounts share that institution's asset fleet, subject to backend authorization.
- No public registration, institution picker, per-login administrator approval,
  invitation flow, or shared multi-tenant implementation in P0.
- iOS sections: Équipements, Mon activité, Compte.
- Web sections: Vue d'ensemble, Équipements, Réservations et prêts, Casiers,
  Anomalies, Audit.
- Both platforms must have coherent light and dark themes, with shared blue,
  deep-blue and indigo brand semantics, rounded forms and restrained glass effects.

The previous mockups are not approved. The user wants stronger visual craft,
not additional abstract design prose. Your existing state coverage is useful,
but correct these defects in the relevant design documents: a borrowed/overdue
asset shown as READY; an instruction to open at AUTHORIZED before execution is
known; unnecessary raw domain codes in primary user-facing labels; and claims
of human approval that have not occurred. Do not modify domain contracts to
make a mockup valid.

Interpret the references deliberately:
1. Fractal Glass: study blue-to-white luminous gradients and optical depth, not
   its abstract navigation, tiny labels, or decorative distortion.
2. Dark reporting dashboard: study sidebar hierarchy, layered panels and subtle
   borders, not its financial metrics or AI features.
3. Light analytics dashboard: study light tinted surfaces and modular grouping,
   but correct weak contrast and omit unrelated charts.
4. Dark orange mobile app: study large modern sans-serif headlines, generous
   curves and luminous depth. Translate the orange into blue/indigo. Do not add
   chat, voice, crypto, or an animated orb. The user particularly likes its
   typography; do not invent an exact font identification. Flag missing source
   information and propose a later side-by-side font comparison with licensing
   evidence if the family cannot be verified.

Your task NOW:
Produce a concise screen/section specification in
docs/design/asset-lifecycle/sections.md. For each confirmed section, state its
user goal, entry point, content hierarchy, main and secondary actions, child
screens or sheets, relevant adverse states, and supporting contract references.
Distinguish existing API capabilities from missing contracts rather than
inventing endpoints. Cover login as an entry flow and QR scanning as a contextual
checkout/return step. Include the appearance preference without adding a new
business section. Keep user-facing copy in plain French.

Use a compact navigation map or targeted low-fidelity detail only where it
clarifies an unresolved flow. Report specific open decisions, recommend answers,
and STOP for human approval of section details. Do not generate a complete
high-fidelity screen collection in this turn and do not treat the old wireframes
as approved.

After that approval, the next task will compare two materially distinct visual
treatments WITHIN the selected blue-indigo glass identity, using identical
content on an iOS equipment catalog including a blocked asset and a Web equipment
list with detail inspector. Each treatment must be shown in light and dark.
Render and inspect at actual usage sizes. Respect Apple-native behavior,
accessibility, readable glass backgrounds, opaque fallbacks, and reduced motion.
Report checks actually performed, not assumed compliance. Stop again for visual
selection before extending the full mockups or handing off implementation.
