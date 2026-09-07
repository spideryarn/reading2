## Verdict

**Refuse as written.** No P0/P1 findings. The pilot implementations appear correct, but the oracle still does not prove its stated claim and is not yet sufficient for stage 2.

## Findings

### F20 — P2 — The oracle still misses DOM changes from F16

**Established.** [`childClasses`](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:145>) records only each direct child’s class. Consequently, all of these pass:

- `<form class="chat-composer">` becoming `<div class="chat-composer">`;
- attributes being added to direct children;
- Chat’s `<h2>` or other header contents changing while `.band-head` remains;
- non-whitespace text beside the `<aside>`, because [`host.children`](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:255>) ignores text nodes.

The first three deliberate breaks are now caught, but the child-tag/header-content case raised in F16 remains. Thus F16 is only partly fixed.

I would accept either a normalized pre-migration DOM golden, or a narrower structural oracle that checks `host.childNodes`, direct-child tag/class/attribute signatures, and the header subtree—and describes that narrower claim honestly.

### F21 — P2 — There is no baseline for the remaining stage-2 bands

**Established.** The plan says the companion baseline contains “the current markup of every band in jsdom” ([plan:222](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:222>)). It does not: the baseline explicitly covers only Search and Chat geometry ([baseline:3](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-baseline.md:3>)), and this test mounts only those panels.

Stage 2 nevertheless requires every migrated variant to match “their baseline DOM and geometry” ([plan:246](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:246>)). Those baselines do not yet exist.

The current helper is also not reusable unchanged for Outline: it hardcodes exactly `class` and `aria-label`, while Outline legitimately carries `data-outline-rung` ([OutlinePanel.tsx:307](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/OutlinePanel.tsx:307>)).

Capture each remaining band’s relevant pre-migration shapes before editing it, and make expected root attributes shape-specific.

### F22 — P2 — The footer inventory still misses Debate and Quiz

**Established.** The plan and component say four panels want `foot` ([plan:107](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:107>), [ModeSurface.tsx:142](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/ModeSurface.tsx:142>)). There are six:

- Debate’s `.dbt-again` follows `.dbt-scroll` and its CSS explicitly calls it pinned ([DebatePanel.tsx:803](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/DebatePanel.tsx:803>), [debate.css:342](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/styles/debate.css:342>)).
- Quiz’s `.quiz-rewrite` is likewise a direct child outside `.quiz-one`, the scrolling child ([QuizPanel.tsx:503](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/QuizPanel.tsx:503>)).

The interface already supports both without added DOM. Stage 2 should pass all six pinned rows through `foot`, preserving their current guards.

### F23 — P3 — F18’s semantic invariant remains escapable

**Established.** `dangerouslySetInnerHTML` and `role` are correctly omitted, but `PassThrough` still admits:

- `aria-hidden`, which removes the landmark from the accessibility tree;
- `aria-labelledby`, which can replace the accessible name supplied through `label`.

Either omit those too, or soften the claim that `ModeSurface` owns a labelled complementary landmark.

### F24 — P3 — Several comments still assert false facts

**Established.**

- The corrected provenance preamble is contradicted by “All four values are transcribed from the baseline” ([test:149](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/tests/mode-surface-changes-no-markup.test.tsx:149>)).
- The plan’s interface still declares required `feature: string`, while the implementation deliberately makes it optional ([plan:117](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md:117>), [ModeSurface.tsx:132](</home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface/src/web/ModeSurface.tsx:132>)).
- The empty-head comment says partial empty detection is worse while implementing exactly that boundary. The decision is sound; the reason should instead distinguish control-flow sentinels (`null`, `undefined`, booleans) from content values such as strings, arrays and fragments.

## F15–F19 disposition

- **F15:** fixed. Treating `""` and `[]` as present is defensible; do not attempt recursive “does this ReactNode render anything?” inspection.
- **F16:** only partly fixed; see F20.
- **F17:** substantive provenance and coverage issue fixed; one stale sentence remains in F24.
- **F18:** the two reported props are fixed; F23 is an adjacent semantic hole.
- **F19:** fixed in both code and plan.

## Stage-2 interface readiness

**Established:** none of the remaining bands requires an additional DOM wrapper or a new interface slot. Visitor, Summary and Outline omit `head`; Outline uses the existing ref and passthrough; the other fixed header rows fit `head`; and the six pinned rows fit `foot`.

What is not ready is the evidence: stage 2 needs real before-fixtures for those bands and an oracle that supports Outline’s extra attribute and observes more than child class names.

The focused 12 tests passed, `git diff --check` passed, and all three TypeScript projects passed when invoked directly. The `npm run typecheck` wrapper itself could not start here because the sandbox denied its `tsx` IPC socket; that is environmental, not a source failure.