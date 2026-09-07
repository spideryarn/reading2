Verdict: **refuse as written**. F5 remains an established P1: the revised tagged union records delegation but does not connect it to executable wiring.

### F5 — P1 — established: delegated activation can still typecheck while unwired

(a) The proposed `{ kind: "delegated"; owner: string }` is only documentation. A fifteenth `research` mode can add `{ kind: "delegated", owner: "ResearchBand" }` without adding an arming path. Typecheck passes because nothing consumes `owner`. Today Diagram works only through the explicit special case in [`Dock.tsx`](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/Dock.tsx:1602>); the proposed type creates no equivalent obligation for another delegated mode.

The promised spending assertion is also missing from the shown test contract: `DRAWS` contains only `where` and `says`, with no independently written activation expectation.

(b) Replace Stage 4 item 1 with:

> **Every activation decision is executable.** The delegated variant carries an arming function—or a closed delegate key covered by a total handler table—not a descriptive string. `armActivationForMode(slug, mode, context)` exhaustively executes `fixed`, `delegated` or `none`, and Dock calls that one function for every mode; it has no Diagram-only branch. The context carries the current diagram kind.
>
> The test independently defines `SPENDS: Record<Mode, …>` with literal expected targets or deliberate none. It never derives the expectation from the production activation table. Diagram additionally exercises both dynamic targets.

### F6 — P1 — reasoned: one non-null string still does not prove the controller body exists

(a) `{ where; says }` permits `says` to be a heading, loading sentence or other static chrome. The single proposed body-deletion mutation calibrates only whichever row it mutates.

Combining spending and presentation makes that especially likely: a generated mode must be missing to prove its Dock press posts, but then the controller draws its missing/running state rather than its populated body. Deleting the successful Ideas, Quotes, Timeline or Debate renderer could therefore leave the sweep green.

(b) Replace “One sweep, not two” with:

> **One test file and one App harness, with two independently configured phases.** The activation phase supplies missing artefacts and checks `SPENDS`. The presentation phase supplies asymmetric, populated fixtures and requires each `DRAWS.says` to be a fixture-only body literal—not a heading, status, button label or shared chrome—scoped to the exact band. Mutation-check a populated generated controller’s visible body while leaving its shell, heading, loading/empty chrome and hidden copies intact.

Keeping both contracts in one test file is reasonable; forcing them through one fixture state is not.

### F9 — P2 — established: repeated selectors are not “exactly” the ordering dependencies

(a) Selector identity misses equal-specificity companion classes applied to the same element. For example:

- `.gloss-quiet` in slice 12 sets `padding`; `.tl-thin` in slice 33 later resets it on the same `<p>` in [`TimelinePanel.tsx`](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/TimelinePanel.tsx:435>).
- `.gloss-quiet` and `.dbt-empty` likewise compete on the same `<p>` in [`DebatePanel.tsx`](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/DebatePanel.tsx:612>).

These selectors are different and equally specific, so order—not specificity—selects the padding. This directly contradicts the plan’s “exactly the pairs” and “Specificity settles that, not order” claims.

(b) Replace those claims with:

> The selector-span scan identifies one concentrated set of high-risk dependencies, not all ordering dependencies. Distinct selectors can match the same element at equal specificity; known examples include `.gloss-quiet` followed by `.tl-thin` and `.dbt-empty`. The ordered manifest and compiled-output comparisons—not selector identity—are the proof that all such dependencies remain intact.
>
> `glossary.css` supplies shared base classes to four later mode files, some of whose companion classes intentionally override it by source order. Their later position is load-bearing.

### F10 — P2 — established: the import-only guard is right, but its future-bundler rationale is not

(a) An import-only `styles.css` is a good ownership guard. It does not make the tree portable to a plain spec-conformant CSS pipeline: [`tailwind.css`](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/tailwind.css:98>) already places `@custom-variant` rules before its `@import "./styles.css"` at line 107. A plain pipeline would reject that parent import regardless of whether `styles.css` contains rules.

(b) Replace the portability claim with:

> **`styles.css` is an import-only ownership manifest.** Parse it and require every non-comment top-level node to be an `@import`; checking merely for ordinary style rules is insufficient. This protects visible ordering under the supported Tailwind pipeline. It does not promise compatibility with a plain-CSS pipeline, because `tailwind.css` itself relies on Tailwind’s positional import processing; changing bundlers requires a separate import-prelude review.

### F7 — P3 — established: the withdrawn claim remains in the introduction

(a) The introduction still says presentation “has nothing at all” at [the plan](</home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/docs/plans/260906d-make-style-ownership-visible-and-a-new-mode-fail-to-compile.md:13>), contradicting Stage 4’s corrected account.

(b) Replace it with:

> Activation lacks a total decision. Presentation already has a visitor-side compile tripwire, but no owner-controller coverage. Close those two gaps.

The extraction itself checked out: all 37 slices tile the source, each parses independently, concatenation is byte-identical, and a virtual 37-file Tailwind compilation was exactly identical to the current output. I see no reason to reduce it to ~15 files or rename `glossary.css`; correcting its shared-order documentation is sufficient. No files were changed.