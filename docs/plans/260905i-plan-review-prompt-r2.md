# Review request round 2: revised plan for A7, measuring annotation computation

You reviewed round 1 of this plan and returned "do not proceed" with nine findings F1–F9. **All nine
were accepted; none was overruled.** This is the revised plan.

## The candidate

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure` (a git worktree).
Base SHA: `6eecb377f24d92446086a006d5b3103daae40aef`, branch `worktree-a7-annotation-measure`.

**Live pre-commit candidate.** Still no code. Three untracked files, no tracked file modified:

- `docs/plans/260905i-measure-annotation-computation-before-optimising-it.md` — the revised plan,
  the thing under review
- `docs/plans/260905i-plan-review-prompt-r1.md` — round 1's prompt
- `docs/plans/260905i-plan-review-sol-r1.md` — your round 1 answer, for reference

## What changed since round 1

A ledger, so you can check each finding landed rather than re-deriving them. Every ID appears once.

| ID | Where it landed in the revised plan |
|---|---|
| F1 | Stage 2 step 2 — resolution keyed on `(id, blockId, quote, start)` + block-content generation, not object identity; previous grouped map and per-block arrays preserved when no anchor changed; explicit acceptance that a body-only delta produces zero of everything |
| F2 | § The wall clock — two separate production-build measurements: end-to-end action-to-second-painted-frame, and attributable time accumulated around `marksByBlock`/`proseHtml`. Scalar microbenchmark demoted to diagnostic only |
| F3 | § Decision rule rewritten — 8ms attributable per gesture, or ≥30% of an end-to-end total over 50ms, or ≥10% main-thread duty cycle during streaming / worst delta ≥16ms |
| F4 | § Workload cohorts and the clone helper — four cohorts, and the clone helper must remap *and validate* ids in `Block.id`, the root element id inside `block.html`, tree nodes/ranges, note refs, internal links, glossary occurrence lists and anchors; per-cohort assertions on resolvable anchors, marked blocks, overlaps and figures before any timing |
| F5 | § The bench — renamed a prop-transition bench, with an explicit list of what it models and does not; counts and zero/nonzero invariants only, never milliseconds; StrictMode noted |
| F6 | Stage 2 step 1 — the shared rendered-text cache is **lazy per block**; `page()` may fill all because search needs all; comments and terms keep their sparseness; search's index/scale/fold caches stay put |
| F7 | Stage 2 step 3 — equality contract stated: source per-block arrays plus only the selected flags relevant to that block; a block always recomputed from all mark kinds together |
| F8 | Stage 2 test set — a changed-glossary-entry regression with the four assertions you named |
| F9 | § The instrument — counters and timers off by default, enabled by `startAnnotationCounters()`, called by `startPerf()` and by the bench |

## New evidence added since round 1, which you have not seen

Two things arrived while you were reviewing, both now in the plan:

1. **A survey of the local corpus.** The two longest local articles (2,569 and 2,046 blocks) carry
   **zero** comments, zero chats and no glossary. `replication-crisis-spya-hrjamq` (551 blocks, 5
   comments, 20 glossary entries) is the only local article with both real length and real
   annotation inputs. The committed fixture corpus is smaller still — largest glossary 19 entries
   over 42 blocks, and exactly two resolvable comment anchors in the whole corpus.
2. **A baseline browser measurement** (§ "The baseline gesture cost"). On the 551-block article,
   opening a comment costs a median **948ms** click-to-painted-frame and closing it 741ms, pressing
   a glossary term 927ms, while a find-box keystroke and a hover stay flat at 12–14ms. Against a
   186-block article the comment cost falls to 335ms — 3.0× the blocks for ~2.8× the cost. **It was
   taken on a dev server, so StrictMode and unbundled modules inflate it**, and it is end-to-end,
   not attributed to annotation.

## What to attack

Form your own view; my suspicions are at the bottom.

1. **Did F1, F2, F4 and F8 actually get fixed, or only acknowledged?** Those were your blocking
   findings. Check the revised text does the work, not that it cites the finding.
2. **Is the revised decision rule now sound?** Specifically the streaming duty-cycle clause and the
   "≥30% of an end-to-end total over 50ms" clause — are those measurable as written, and do they
   fail safe?
3. **Does the new baseline evidence change what Stage 1 should do?** Given comment-open is already
   ~1s end-to-end and scales with length, is the plan still measuring the right thing, or should
   the attribution step come first and larger? In particular: is there a cheaper decisive
   experiment than the one planned — something that would attribute that 948ms to annotation or
   exonerate it in one step?
4. **Is the attributable-time instrument going to attribute correctly?** Timing accumulated inside
   `marksByBlock` and `proseHtml` is React `useMemo` body time. Name any way that under- or
   over-counts the real cost — lazy work escaping the memo body, work moved into the render pass
   below it, or cost that lands in the browser's parser outside our stack frames.
5. **Anything new that round 1 did not reach**, including in Stage 3 and in the anti-goals.
6. **Is the plan now over-built?** It grew. This repo prefers fewer moving parts, and a measurement
   scaffold that outlives its usefulness is a maintenance cost. Say what to cut.

Discovery is closing after this round, so raise anything structural now.

## Severity scale

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Grade by consequence, not by the file the defect lives in. Refuse only on an **established** P0 or
P1: direct evidence with no unresolved material inference. Reasoned findings rank and inform but do
not block.

**Reuse F1–F9 for the same finding**; give genuinely new findings fresh IDs starting at F10. If a
round-1 finding is now settled, say so by ID. Finish with an explicit verdict line.

You have no network. You may read and run anything in the tree that needs nothing outside it.

## My own suspicions, worth less than yours

- I think the 948ms is probably **not** mostly annotation — the last round of work put
  `getBoundingClientRect` at 29.9% of script and three separate passes measure the whole article on
  every state change. If so, A7 is real but small, and the honest outcome is "optimise the cheap
  part, and point at A8 for the rest". I may be talking myself out of my own job here; push back.
- I suspect the glossary-press number (927ms) is the cleanest probe available, because `openTerm`
  provably does not change `termMarksByBlock` and provably does re-run `proseHtml` for every block.
  If that gesture is not dominated by annotation, very little is.
