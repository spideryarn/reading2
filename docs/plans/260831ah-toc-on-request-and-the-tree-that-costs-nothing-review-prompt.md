# Review: taking the 320-second ToC step off the ingest path

You are reviewing a **plan, before any of it is built**. Be adversarial. We would rather hear "STOP"
now than find it in production. A previous plan in this exact area got a "STOP. Do not build this as
written" from you with six P0s, and it was right.

**Read the plan:** `docs/plans/260831ah-toc-on-request-and-the-tree-that-costs-nothing.md`

## Context you need

Spideryarn is an AI-assisted reading app. A pipeline ingests an article in stages
(`fetch → extract → blocks → toc → assets`). The `toc` step makes a nested table of contents with an
LLM. It is **320 seconds of a ~350-second ingest**, and its structure call alone is 163s.

Recently `DEFAULT_MODE` became `"plain"` (`src/modes.ts`) — the reader now lands in a mode that draws
no tree and no gists. The plan's argument is: if nobody is looking at the tree when the article
opens, don't buy one when the article opens. Publish a free tree built from the author's own HTML
headings (`src/heading-tree.ts`, already built, wired to nothing), and run the real `toc` when the
reader opens Hierarchy.

## The files that matter

- `src/pipeline.ts` — `DEFAULT_INGEST_STEPS` (~line 217), `FORCE_ONLY_WHEN_NAMED` (~296), the `toc`
  step registration (~1663) and the `blocks` step (~1502).
- `src/article-input.ts` — the seam all seven article-reading stages share. `tree: Tree` is
  **non-optional** and the plan makes it nullable. This is the load-bearing change.
- `src/toc.ts` — especially ~1469, `blocks: blocksArtefact(blocks)`, and ~1710 in `pipeline.ts`.
- `src/heading-tree.ts`, `src/types.ts` (~212, `provisional?: "headings"`),
  `src/tree-invariants.ts` (~267).
- `src/web/useArc.ts` (~120-150) — the on-demand precedent the plan proposes to copy for `toc`.
- `src/web/AddPage.tsx` (~176) — the whole-job-done gate.

## Prior art you should read before judging

- `docs/plans/260830am-faster-ingest-and-concurrency.md` and its `-review-sol.md` — **your own
  earlier review.** The plan under review deliberately takes a *different* route (no background
  swap racing the reader). Say whether that actually dissolves your six P0s or merely moves them.
- `docs/plans/260830ak-toc-repairs-and-heading-tree.md`, `docs/plans/260829f-defer-arc-and-rename-hierarchy.md`
  (the precedent for deferring a step), `docs/project/block-ids.md` (the contract everything rests on).
- `docs/plans/260831b-finish-the-database-move.md` — a sibling plan, in flight, sharing four files.

## What we most want you to attack

1. **The load-bearing factual claim.** The plan asserts that `toc`'s returned `blocks` are a *copy*
   of the `blocks` step's blocks (re-wrapped for a sanitiser stamp), not a transformation, and that
   therefore an article with no `toc` run has the same prose and the same block ids. **Go and check
   this in the code.** If it is false, or true only on some paths, the plan stops. This is the one
   thing we most want independently verified.
2. **Does anything else silently require a tree?** The plan names the seven article-reading stages
   and the public payload. Search for consumers it has missed — the reading view, search, embeddings,
   comments, page titles, the shelf, chat tools, ToC-flattening. What breaks or silently degrades
   when `tree` is provisional or null?
3. **The "real toc must not be skipped" trap.** A provisional tree is now a durable published state
   rather than a brief window. Is there a path where `stepIsDone`, a freshness/input hash, or a
   publication check treats a provisional tree as a finished `toc` and never buys the real one?
4. **Staleness.** `summary` keys freshness on blocks only. What else keys on blocks and would call
   itself current across a provisional→real tree replacement? The plan defers this to stage 4 —
   is that safe, or does it have to be stage 1?
5. **Ordering vs. the database move.** The plan lands the `article-input.ts` contract change *first*,
   before `260831b`'s stage 3 flip, to avoid a mid-flight collision. Is that the right order, or does
   making `tree` nullable before the store flip create a state neither plan has thought about?
6. **The visitor hole.** A signed-out visitor cannot start a job (POST), so a visitor to a
   never-opened article sees a heading tree for ever. The plan flags this as a decision to take
   deliberately. Is it worse than the plan admits?
7. **Anything the plan is quietly optimistic about**, especially where it claims a change is
   "invisible" or "nearly free".

## What we do not need

Style, naming, doc structure, or a rewrite of the staging. Findings only, each with the file and the
concrete failure it produces. If a finding is a NO-SHIP, say so plainly and say which stage it blocks.
Rank by severity. If the plan is sound, say that too — but say what you checked to conclude it.
