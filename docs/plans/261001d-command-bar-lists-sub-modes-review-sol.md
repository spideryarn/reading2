No P0 findings. While I reviewed, concurrent Stage 1 edits appeared in the worktree; I did not modify anything.

## P1

1. Diagram still permits non-press spending.

   The plan correctly arms Sketch/Illustrated by the row’s named picture, avoiding the stale-`?diagram=` orphan-token bug ([plan:50](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/docs/plans/261001d-command-bar-lists-sub-modes.md:50>), [activation.ts:493](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/activation.ts:493>)). Summary’s three levels also correctly share the `simple` target ([activation.ts:600](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/activation.ts:600>)).

   However, Force, Drift and Trail use mount-driven POSTs rather than activation tokens. Back and pasted links can therefore spend without an explicit press; the code explicitly records this exception ([activation.ts:527](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/activation.ts:527>), [useSimilar.ts:122](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/useSimilar.ts:122>), [useProjection.ts:145](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/useProjection.ts:145>)). Last-view restore is safe because it drops `mode=diagram`, leaving the dormant sub-parameter ([last-view.ts:152](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/last-view.ts:152>), [last-view.ts:173](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/last-view.ts:173>)).

   This is pre-existing, not introduced by the plan, but the plan must name it explicitly rather than suggesting activation now enforces press-only spending for every sub-mode.

2. The proposed activation test is internally contradictory and misses the orphan-token contract.

   Stage 1 says `subModeGenerates` should agree with what each chip arms ([plan:104](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/docs/plans/261001d-command-bar-lists-sub-modes.md:104>)), while the plan correctly says all Diagram rows generate even though Force/Drift/Trail arm nothing ([plan:50](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/docs/plans/261001d-command-bar-lists-sub-modes.md:50>)). Those assertions cannot agree.

   Split this into:

   - `subModeTarget` equals the real chip’s arming target.
   - `subModeGenerates` equals actual possible work, including Diagram’s mount-driven embeddings.
   - For every token-bearing sub-mode, `subModeTarget(sub)` equals the target `bandTarget` returns after the destination params are applied.

   The last comparison is essential because `ModeBoundary` retires exactly `bandTarget`; disagreement leaves a token for a later navigation to claim ([activation.ts:577](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/activation.ts:577>), [ModeBoundary.tsx:111](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/reader/ModeBoundary.tsx:111>)).

3. The visibility design omits Diagram’s “current experimental picture remains visible” input and test.

   The plan says to reproduce `shownBehindTheSwitch`, but only explicitly adds the switch value to `CommandBar` ([plan:62](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/docs/plans/261001d-command-bar-lists-sub-modes.md:62>)). The real rule also needs the current Diagram kind: with experiments off, Sketch plus the currently selected experimental picture remain visible ([DiagramPanel.tsx:328](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/DiagramPanel.tsx:328>), [DiagramPanel.tsx:351](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/DiagramPanel.tsx:351>)).

   Specify that the current parsed picture comes from the carried search, or pass the already-filtered kinds. Add reading-view and Metadata tests for `mode=diagram&diagram=trail` with experiments off. The proposed test only covers the ordinary hidden case ([plan:107](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/docs/plans/261001d-command-bar-lists-sub-modes.md:107>)).

4. “Four modes have sub-modes” conflicts with the project’s existing vocabulary.

   The plan excludes Search, Quotes and Glossary as mere orderings ([plan:96](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/docs/plans/261001d-command-bar-lists-sub-modes.md:96>)), but:

   - Quotes’ original requirement explicitly calls its alternative orders sub-modes ([params.ts:434](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/params.ts:434>)).
   - Search’s prioritised view is explicitly called its default submode ([params.ts:875](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/params.ts:875>)).
   - Search’s Words/Meaning matcher is not an ordering at all; it changes what question is asked and where spending occurs ([params.ts:684](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/params.ts:684>), [SearchPanel.tsx:555](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/SearchPanel.tsx:555>)).

   Either include these, or explicitly narrow this feature to “controls that replace the whole band” and record that product decision. The present plan silently redefines “sub-mode” despite Greg saying “e.g.” rather than naming an exhaustive four-mode set.

## P2

5. The proposed search words do not match the rendered compound names.

   The row renders `Remember › Quiz`, but matching uses label `Quiz` and separate aliases `Remember` and `Quiz` ([plan:56](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/docs/plans/261001d-command-bar-lists-sub-modes.md:56>)). Ranking compares the entire query against each field independently ([command-match.ts:276](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/command-match.ts:276>)). Consequently, natural queries such as `remember quiz`, `quiz mode`, or `illustrated diagram` match nothing. Add compound aliases or make the displayed compound name searchable.

The one-push Reader design itself is sound. There is already a direct precedent writing `mode`, `remember`, and `thread` atomically ([Reader.tsx:667](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/reader/Reader.tsx:667>)); it satisfies Remember’s thread rule ([ConversationModes.tsx:52](</home/greg/code/spideryarn2/.claude/worktrees/fb77-command-bar-sub-modes/src/web/modes/conversation/ConversationModes.tsx:52>)), gives one Back entry, and lets `ModeBoundary` observe the new mode/sub-mode together. The fourth `Command` arm, discriminated `SubMode`, pure registry, and total per-view records are also appropriate; folding sub-modes into the existing `mode` arm would weaken the mode/view pairing.

**Verdict: proceed with changes.**