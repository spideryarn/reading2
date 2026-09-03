Stage 2’s implementation looks correct, but I would not commit it yet: one required test invariant was weakened, and the rewritten documentation contains several false claims.

## Must-fix before commit

1. **The thirteen-link loose arm is no longer tested.**

[dock-fit.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/dock-fit.test.ts:327) defaults every render to Experimental off, and its metadata assertion was lowered from `> 10` loose links to the eight-item filtered set at [line 356](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/dock-fit.test.ts:356). The replacement thirteen-mode test at [line 373](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/dock-fit.test.ts:373) exercises the reading-view radiogroup, not the loose links.

The new matrix does not close this hole: its loose-arm assertion at [dock-experimental-modes.test.tsx:287](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/dock-experimental-modes.test.tsx:287) merely checks that the set is non-empty and contains the URL mode. It never expects thirteen links when Experimental is on.

Concrete surviving mutation: make the loose arm always filter as Experimental off while leaving the radiogroup correct. Every new Dock test still passes. This is exactly the “right in one arm, wrong in the other” regression the review brief warned about, and it weakens the existing count rather than turning the switch on.

2. **The documentation gives false reasons for two gated modes.**

At [experimental-features.md:112](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/project/experimental-features.md:112), Quotes is described as having unfinished verification and “good” selection. Its cited document instead defines a completed verification contract—article text, not authorship—and says the promise intentionally stops where verification stops. It also says quality/calibration rests on one article, so “the selection is good” is not established.

At [experimental-features.md:115](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/project/experimental-features.md:115), Diagram is said to have three pictures. It has four: `force`, `drift`, `trail`, and `sketch`, as both [diagram.md](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/project/diagram.md:3) and [diagram.ts](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/src/web/diagram.ts:133) state. The cost and duration claim itself is accurate.

The Timeline and Remember rows agree with their cited documents.

3. **The corrected Referee claim is reintroduced elsewhere.**

[reading-view-overview.md:64](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/project/reading-view-overview.md:64) says the experimental-features document explains why all five modes are “not ready yet.” The Referee row explicitly says Referee is built and hidden because of its narrow audience. This restores the same false umbrella claim that was corrected in the table.

4. **The operating manual has incorrect or misleading references.**

In [experimental-features.md](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/project/experimental-features.md:35):

- `?mode=outline` is used to demonstrate that a hidden mode remains reachable, but Outline is default-visible. A gated mode is needed as the example.
- “A shared URL behaves the same” is too broad: its band does, but its bar contains nine buttons for an off reader and thirteen for an on reader.
- [Line 47](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/project/experimental-features.md:47) names the nonexistent `drizzle/0032_experimental_features.sql`; the applied migration is [0037_experimental_features_and_callout_blocks.sql](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/drizzle/0037_experimental_features_and_callout_blocks.sql:1).
- [Line 88](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/docs/project/experimental-features.md:88) says route reachability is the second rule. It became the third when the anonymous rule was inserted.

## Should

1. **Several new test names claim states they do not enter.**

The “signed-out visitor, off by decision” test at [dock-experimental-modes.test.tsx:140](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/dock-experimental-modes.test.tsx:140) manually passes `EXPERIMENTAL_OFF`; it does not exercise a session or the store. Likewise, the reading-arm `?mode=timeline` test at [line 148](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/dock-experimental-modes.test.tsx:148) passes `mode: "timeline"` directly without putting it in the URL.

The network-trace suite supplies integration coverage for both facts, so this is not a production hole, but the unit tests overstate what they prove.

2. **The advertised matrix omits a signed-in non-owner.**

The reader cases at [dock-experimental-modes.test.tsx:249](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/dock-experimental-modes.test.tsx:249) never pass `signedIn: true`. That prop does not currently affect mode width or filtering, so the implementation is safe, but the matrix does not literally cover the case promised by the plan.

3. **Stage 3 must key fitting on every visible toggle shape, not merely its presence.**

The planned warning marker, spinner/disabled state, and failure wording may change the row width. If any of those are rendered inside the bar, `fitSignature` must include the rendered toggle variant, not just whether the signed-in toggle exists. Stage 2’s current signature is sufficient for current content.

## Noted / verified

- `visibleModes` feeds both rendering arms and `fitSignature`; the current production code does not diverge.
- With Experimental off, eight default rows guarantee the radiogroup is non-empty. The current parsed mode is retained, including marked owner-only modes, so exactly one radio remains checked.
- Unknown modes fall back to Plain in the reading view and add nothing in the loose arm.
- `modeInSearch` and nuqs both use `URLSearchParams.get`: absent or malformed values are rejected, encoded names decode, and repeated parameters use the first value. `carriedSearch` need not canonicalize them for the two arms to agree.
- `marked`, `visitor`, and `signedIn` do not alter bar geometry. Comments count is represented in the signature, and `keepLabel` is fixed by the included mode identities.
- `DockExperimental` is required, all four production mount sites pass the hook result, and `Dock` directly reads `experimental.on`. Omitting it throws. All three TypeScript projects pass.
- The stranger’s zero `/api/reader` requests is proved directly by the exact trace assertion at [public-network-trace.test.tsx:777](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/public-network-trace.test.tsx:777) and again alongside the signed-in assertion. The signed-in reader is pinned to exactly one at [line 1563](/home/greg/code/spideryarn2/.claude/worktrees/experimental-mode-gate/tests/public-network-trace.test.tsx:1563).
- Arrows and self-starting-mode tests correctly turn Experimental on. The public visitor sweep still covers all thirteen through its two-pass approach.

Checks run:

- Required suites: **3 files, 117 tests passed**
- Other changed Dock suites: **3 files, 42 tests passed**
- All three direct `tsc --noEmit` projects passed
- `npm run typecheck` itself was blocked by the sandbox’s `/tmp` IPC restriction; its underlying compiler runs succeeded.