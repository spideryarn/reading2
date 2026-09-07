## Verdict

**Refuse as written.** No P0/P1 findings, and the runtime migration itself is correct. Three small P2s remain in its evidence/delivery contract.

### F25 — P2 — established: Quiz’s exact empty-header trap is not pinned

[The oracle always supplies `subMode`](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:1471), while [the ordinary Quiz tests omit it](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/quiz-panel.test.tsx:156) but never inspect `.band-head`. Changing Quiz to `head={subMode}` therefore removes the formerly unconditional empty header while the entire suite remains green—the precise regression the new fragment is meant to prevent.

Add one oracle shape or Quiz assertion with `subMode` omitted, expecting an empty `.band-head`.

### F26 — P2 — established: the new-mode checklist turns a migration exception into a universal rule

[`new-mode.md`](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/project/new-mode.md:69) says every conditional header child requires an always-present fragment. That contradicts the immediately following rule that headers are optional and should exist only when there is something for them.

A future mode whose header genuinely exists only in one state would be instructed to manufacture a blank row in every other state. The rule should instead say: use a fragment only when the row is intentionally persistent while its contents are absent; otherwise pass the conditional node directly.

The same paragraph also says five bands empty while loading; it is four loading bands plus Diagram’s ordinary Sketch state.

### F27 — P2 — established: the circuit-breaker test is untracked

Contrary to the supplied status, [the circuit-breaker test](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/the-band-fallback-must-not-use-modesurface.test.tsx) is untracked, as is the stage-2 review prompt. The test is sound, but unless explicitly added it will not deliver the stage’s future protection.

### F28 — P3 — established: Diagram’s fragment rationale overclaims

[The new Diagram comment](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/DiagramPanel.tsx:1495) says conditional `head` would undo the 2026-08-30 fix. It would not: whenever `ScatterNote` exists, the conditional still creates `.band-head`, keeping the caveat on the non-wrapping row. It would only remove the empty row in Sketch and other no-caveat states.

The fragment is nevertheless correct for this stage because it preserves the deliberately retained pre-migration DOM. The historical inline reasoning also still refers to an `h2` pushing a third child, although Diagram’s `h2` was removed.

### F29 — P3 — established: the raw-band inventory is stale

[The plan claims five preview files hand-copy band markup](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:265). Only two do:

- `preview-sketch.tsx` uses a raw `<aside>`.
- `preview-chat-markdown.tsx` uses a raw `<div>`.

Colour, Timeline, and Diagram-wait mount the real migrated panels; Illustrated tests a dialog without a band. [Diagram-wait’s comment](/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/preview-diagram-wait.tsx:126) is consequently stale too. The oracle’s stage-2 describe still says the bands “have not migrated yet.”

## Confirmed

- All eight current fragment sites preserve their prior DOM. Debate and Referee’s fragments are redundant but harmless.
- All six footer guards are exact conjunctions of their former outer and inner guards.
- Debate’s portal renders under `document.body`; `.dbt-again` remains after `.dbt-scroll` inside the band.
- Outline’s ref still reaches the `<aside>`, `data-outline-rung` survives, and rung selection tests pass.
- Referee’s two regex slices remain equally strong and fail non-vacuously.
- The circuit-breaker test genuinely exercises the second-throw path.
- `FeatureBoundary`, `/design`, and the two actual raw preview shells are reasonable exceptions.

Verification: 7 focused test files, 159 tests passed; `git diff --check` passed.