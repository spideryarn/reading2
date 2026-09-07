## Verdict

Do not refuse. I found no established P0 or P1. The revised plan is viable, with four smaller corrections.

## Findings

### F9 — P2 — established: StrictMode masks the pre-fix Referee race

(a) In React 19.2.8, the non-StrictMode hand-off reproduced both failures:

```text
claims layout publish
criteria passive clear
settled DOM empty
```

The reverse direction behaves identically.

Under StrictMode, however, React’s simulated remount republishes the incoming producer after the outgoing passive clear:

```text
claims layout publish
criteria passive clear
claims passive clear
claims layout publish
settled DOM claims
```

Therefore [the requirement to reproduce red “under StrictMode”](</home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md:214>) can produce a false green even though production remains broken.

(b) Require the pre-fix red proof without StrictMode in both directions. Retain StrictMode as a post-fix regression variant, but explicitly say it is not evidence that the old implementation fails.

### F10 — P2 — established: the slot-sharing field is unnecessary

(a) A separate layout cleanup with dependencies only on the stable parent setters:

- clears before the incoming sibling’s layout publication;
- survives StrictMode;
- survives a sub-mode swap batched with another parent state update;
- clears correctly when leaving Referee entirely;
- does not run during ordinary `found` updates.

The existing flicker comments in [CriteriaPanel.tsx](</home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/src/web/CriteriaPanel.tsx:294>) and [ClaimsPanel.tsx](</home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/src/web/ClaimsPanel.tsx:259>) warn against putting cleanup on the publication effect, whose data dependencies change. They do not require the separate unmount-only effect to be passive.

Using layout cleanup universally may move one otherwise-passive parent update before paint, but no current evidence establishes that as material. The proposed field adds composition knowledge to six feature hooks solely to preserve an unmeasured distinction.

(b) Make every producer’s separate unmount-only clear a layout effect and remove the slot-sharing field. Keep all five slots and raw setter identities. Amend the comments to distinguish “separate stable-dependency cleanup” from effect phase.

### F11 — P2 — established: the import guard enforces only half the stated invariant

(a) The contract says feature files must import neither `App.tsx` nor another feature. The proposed AST test only rejects imports of `App.tsx` from `modes/`, `reader/`, and `article/` ([plan lines 299–303](</home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md:299>)). F2’s immediate Chat/Remember violation is fixed, but another cross-feature import remains silently permitted.

(b) Extend that same AST walk to reject imports between different first-level `modes/<feature>/` directories. Give this rule its own mutation control.

### F12 — P2 — reasoned: Stage 4 should be two stages

(a) [Stage 4](</home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md:311>) combines a lifecycle refactor, a user-visible Referee fix, exhaustive passage selection, dispatch replacement, a large Reader integration harness, mutations, and rule-doc changes. These have two clean ownership boundaries and different failure modes.

(b) Split it into:

- **4a — lifecycle:** helper, non-StrictMode red Referee reproductions, layout cleanup, cleanup tests, postmortem.
- **4b — composition:** `selectPassages`, exhaustive `band()`, Reader wiring sequence and mutation, mode-addition acceptance, docs.

This also gives the Referee fix a green stopping point before constructing the much larger Reader harness.

### F13 — P3 — established: Stage 1 still says seven controllers but lists eight

(a) Both batches contain four controllers: Timeline, Quotes, Debate, Glossary; then Search, Summary, Diagram, Referee. The plan nevertheless says “seven” in [the overview](</home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md:31>) and [the stage heading](</home/greg/code/spideryarn2/.claude/worktrees/a1-a3-reader-composition/docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md:225>).

(b) Change both to “eight.”

## Answers to the targeted attacks

- The React layout-order claim is correct for distinct sibling component types: outgoing layout cleanup runs before incoming layout publication.
- Criteria and Claims are the only two producers that can hand off one slot during a mounted `Reader` lifetime. Owner/visitor twins use the same named slots, but changing access replaces `OwnedArticle` with `VisitorArticle` and unmounts the whole `Reader`.
- The local `band()` closure preserves mounting semantics. Every mode returns a distinct top-level component type; Chat and Remember remain `ConversationBand` versus `RememberBand`. Keep `VisitorBand` above it as planned.
- Stage 3 commit 1 is cycle-free by source dependency inspection: after controller extraction, `Reader` depends only on moved position/measurement helpers, constants moving with it, and feature/shared modules. `App.tsx → Reader.tsx` remains one-way while `ArticlePage` stays temporarily in `App.tsx`.

One execution caveat: while I was reviewing, another process began Stage 1 edits in the shared worktree. The permitted `passage-mode-cleanup` run consequently failed midway against an inconsistent snapshot, then its imports changed afterward. I did not treat that as candidate evidence. I changed no repository file; the lifecycle probe lived only in `/tmp`.