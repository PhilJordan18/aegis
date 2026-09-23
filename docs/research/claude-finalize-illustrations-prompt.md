# Claude handoff — finish the notebook illustration set

The selected direction is treatment A for both iOS and Web. Keep it. We are
finishing illustrations for the conception notebook, not restarting design
exploration or implementing the applications.

Read `AGENTS.md`, `CLAUDE.md`, the relevant project skills, and
`docs/research/revue-jeu-cahier-2026-09-23.md`. Then read the current REST contract
`docs/cahier-conception/09-contrats-rest.md`, especially §§8.3–8.9, 12.2 and 15.4.
The review describes the inspected state, not work already corrected.

## Ownership and scope

You own the illustration corrections under `docs/design/asset-lifecycle/`.
Preserve all other work. Do not edit normative documents, application code,
electrical decisions, or the notebook itself. The notebook integration and
Jimmy’s 3D assets will be handled next. Do not modify or stage the pre-existing
agent configuration changes under `.claude/`, `.codex/`, `CLAUDE.md`, or
`docs/ai/agentic-workflow.md` as part of this UI commit.

Use the UI review workflow for this bounded correction pass. Do not create a
new visual direction, add screens, or resume the cancelled forty-render plan.

## Required corrections

1. Replace the hypothetical administrator diagnostic with the actual
   `AdminAssetView.operationalDiagnostic { evaluatedAt, reasons }`. There is no
   universal `READY` result or hypothetical authorized technician. Update the
   fixture, formatter, Web 02 copy, boards and documentation. An empty reason
   list means no non-personal impediment detected, not permission to borrow or
   open a compartment. Do not compute business authorization in the Web UI.
2. Align C2 with `LockerStatusView.currentWindow`. For an open window,
   `nextOpensAt` must be null. Update its source tags and remove the obsolete
   proposal marker only from fields actually covered by the contract.
3. Update the C3 handoff description: `currentOperationId` may reference the
   latest terminal attempt while its parent remains open; a nonterminal attempt
   takes priority. `returnOperationId` remains a confirmed-return reference.
4. Correct C4 documentation: `AssetSummary.model` is an object, not `modelName`.
   Defining `UserSummary` did NOT add a holder/user summary to LoanView or
   ReservationView. Keep the holder name explicitly illustrative in Web 03/04
   unless you omit it. Do not remove C4 indiscriminately.
5. A raw RFID identifier was not added to AdminAssetView. Preserve a distinct
   mock warning for that display or omit it. Keep unresolved institution-label
   and evidence-shape warnings. Update `sections.md`, `jeu-cahier.md`, the
   prototype README, manifest legends and captions consistently. Do not assert
   that all C1–C8 proposals are approved. Fix stale claims that only 10:30 is
   rendered; keep A/B boards clearly identified as historical comparisons.

Keep the seven existing distinct screens and the valid checkout/anomaly
chronology. The scanner stays explicitly simulated. A command acknowledgment
is not a door opening; acknowledging an anomaly never closes the loan.

Regenerate every PNG affected by shared-source changes, including Web pivots
in both treatments/themes and dependent comparison/notebook boards. Inspect
the regenerated images yourself. Run relevant syntax, reference, chronology,
contrast and whitespace checks. Report what actually ran and any limitations;
do not claim native accessibility or PDF validation from static Chrome renders.

For PDF handoff, retain the individual captures and document that the large
boards are overviews. Do not recommend shrinking them as the sole illustrations
onto portrait A4 pages: the text becomes too small. No PDF production is needed
in this pass.

## Commit and push authorization

After the corrections pass verification:

- Confirm the current branch is `codex/cahier-conception` and inspect status,
  recent commits, the index and remote configuration. Preserve the separate
  Codex documentation commit. If it is missing, or the branch differs, stop and
  report rather than reconstructing or switching branches automatically.
- Inspect all files intended for your illustration commit, including new and
  generated files. Stage only reviewed files within your owned directory, using
  explicit paths. Never use `git add .` or absorb unrelated staged changes.
- Use a Conventional Commit in English, for example:
  `docs(ui): finalize notebook illustrations and contract alignment`.
- Refresh remote information and check that publishing this branch will not
  overwrite or require merging someone else’s work. If the remote has diverged,
  stop and report; do not force-push, rebase, merge, pull, or change branches.
- Push only the current branch to `origin`:
  `git push origin HEAD:codex/cahier-conception`.
- Report the commit hash, checks, push result, and remaining uncommitted files.
  A dirty tree containing preserved unrelated work is not a reason to include
  that work. Do not claim it is clean unless it really is.

Respond to Philippe in French. Stop after this handoff; do not start application
development or integrate Jimmy’s models on your own.
