# Structure's fourth level, staged: today's call untouched, then one scoped call that writes the sub-sections

Started 2026-11-01, queue item `qi-p6s6g6vw`, Greg's answer `spya-xb2rrn` to
[q-k25zfg](../user-feedback/questions/q-k25zfg.md), for his report `spya-pn7gvw`. Worktree
`qi-p6s6g6vw-structure-staged-fourth-level`. Follows
[261029a § Stage 2](261029a-structure-one-level-deeper.md) and its write-up
[261101b](../investigations/261101b-structure-fourth-level-two-wordings-measured.md). Up:
[structure.md](../project/structure.md).

**Status: plan, revised after Sol's first review and a one-article smoke run; before the build.**

## What Greg said

> I mean, this feels like a technical problem that you should be able to solve if you try a few
> different ways. I will say that one of the hunches I always had was that we should do this in
> multiple stages, perhaps hierarchically. So we might do the top level first, then the next level
> of granularity, and then perhaps an optional thing that would add yet a further level of
> granularity. So I don't know if that would help. Or alternatively, stick with what we have right
> now that works robustly for, you know, for the current approach, and a button that says add an
> extra level of granularity so the user can request it. That would work fine.
>
> — Greg, 2026-11-01, reply `spya-xb2rrn` to q-k25zfg

## The idea

**Stage 1 is today's `toc/13` call, byte for byte.** Stage 2 only ever adds children under a
section stage 1 made, so it cannot take a section away: the failure that sank both one-call wordings
(an article left with no sections) cannot happen by construction.

**Stage 2 splits the work between code and model along the line each is good at.**

- **Code picks the sub-sections**, from the author's own *immediate* sub-headings inside a section.
  No model decides where a sub-section starts, so there are no invented joins and nothing to drift
  between runs.
- **One scoped call writes only the titles and gists** for those fixed pieces — the part that needs
  reading. Several sections per call, in parallel.

That is the narrower first rollout Sol recommended (first review, finding 7). A long section with
no sub-headings stays as it is; "split a long section at its topic shifts" is a later, separate
rollout, measured on its own.

## Why not switch on September's deepening wave

[260904d](260904d-deepen-fat-sections.md) built Greg's hunch for books — his words then: *"fan out
the sections of it to separate agents in parallel to output sub-sections for one level deeper"* —
and it is in `src/` behind `SPIDERYARN_DEEPEN_STRUCTURE`, off. It was the first thing tried here.
**A smoke run on the report's paper (local copy, 2026-11-01) and Sol's review found it the wrong
tool for articles**:

- **It made the right tree for 2.4** (each theory its own sub-section, 2.5 beside 2.4) **but cost
  $0.41 on top of stage 1's $0.22 (+180%) and added 19 s.** Half of that was redraws: one batch of
  three sections was refused on all three draws (`not-an-expansion`) because one of the three, the
  Bibliography, honestly has nothing to divide, so 3.2 and 4.1, which came back fine, were thrown
  away with it.
- **Its heading rule makes every author heading in a section a child** (Sol, finding 2): a
  same-level heading stage 1 swallowed ("2.5" inside 2.4, which 261029a counts in 26 of 67
  production articles) would be *demoted* to a sub-section — Structure asserting a wrong
  relationship — and deeper headings ("2.4.5(a)–(c)") are flattened beside their parent.
- **It is not limited to sections** (finding 1): any childless node is a target, so a part could
  gain sections instead of a section gaining sub-sections.
- **It invents joins** in any section over 9 blocks and 2,000 words, which is where the quality and
  stability risk lives (finding 7; in September 15 of 22 parents changed fan-out between runs).
- **Its prompt and its re-reading of the outline are sized for books**: ~30,000 input tokens per
  call on this paper.

It stays as it is, off, for books.

## Stage 2 in detail

**Which sections, in code** (`planSubsections`, pure):

1. Only depth-2 nodes whose children are all leaves; never a supplement.
2. **The section's own heading** is the heading its `sourceHeading` names, inside its range; else
   its first block, if that is a heading. Without one there is no level to compare with, and the
   section is skipped (counted).
3. **Levels compare by numbering first, tags second.** Two headings that both open with a section
   number (`2.4`, `2.4.1`, `2.4.5(a)`) compare by how many parts the number has (a letter suffix is
   one more part); otherwise by tag. The extractor tags "2.4.5(a)" `h2` inside an `h3` section, so
   tags alone would get the paper wrong.
4. **A heading inside the section that is not deeper than the section's own** — a swallowed sibling
   like 2.5 — **makes the whole section ineligible** (counted as `holdsSiblingHeading`). Never
   demoted; that is stage 1's mistake and stays visible as today's tree.
5. **The immediate sub-headings** are the headings deeper than the section's own that are not
   deeper than any other such heading: in 2.4, the six 2.4.k, not 2.4.5(a)–(c), which stay inside
   2.4.5.
6. **The children**: the first starts at the section's first block, as every first child does;
   one more starts at each immediate sub-heading. When nothing but headings comes before the first
   sub-heading, that sub-heading's child is the first child, so there is no empty opening. Fewer
   than two children: not eligible.

**The call** (`subsectionsRequest`, `SUBSECTIONS_SYSTEM`, stamp `subs/1`): per section, the chain
above it (part title and gist, section title and gist) and its blocks numbered from 0; then its
children as fixed block ranges, each marked with the author heading it begins at, if any. The model
returns, per section, one `{title, gist}` per child in order; the strict schema has no ids and no
numbers to get wrong. Titles: the author's heading unchanged where the child begins at one (the
rules of `SYSTEM`'s TITLES block); the opening child gets a title of its own. Gists: the depth-2+
band of `SYSTEM` (22–32 words, a claim and its ground), the shared `plainWords()` core. No
questions (they are depth 0–1 only). `sourceHeading` is set by code, never by the model.

- **Batches**: up to 6 sections or ~20,000 tokens of evidence a call; 4 calls in flight per job.
- **A wrong answer costs that section, not the batch**: a section whose child count is wrong, or
  whose number is missing, is left as stage 1 made it; a call that fails whole is drawn once more.
- **Model and effort as stage 1's** (`streamMessage("structure", …)` with the article's power, so
  High-powered AI applies and the call is cost-tracked like stage 1's).
- **Deadline**: started only with at least 120 s left before the step's deadline; otherwise
  skipped and counted. Sol's finding 4 asked for `NeedsAnotherWindow`; for a stage of ~10–20 s
  after a stage-1 call of ~20–60 s inside a 700 s budget, a skip that is counted and logged is the
  simpler honest answer, and the counts make it visible.
- **No checkpoint in v1.** A retried structure step resumes stage 1 from its checkpoint and buys
  stage 2 again, about a tenth of what stage 1 cost. Named here as a deliberate gap.
- **On the run**: `subsections: {eligible, asked, made, failedSections, calls, skipped: {...}}`
  beside the existing `subsections`/`swallowedHeadings` counts, logged at every value.
- **A kill switch**: on by default; `SPIDERYARN_SUBSECTIONS=0` turns it off without a rebuild.
  If `SPIDERYARN_DEEPEN_STRUCTURE` is on, the deepening wave runs instead (the two are never both
  run). The slices path (documents too long for one answer) runs neither, as today.

### As built, after Sol's second plan review

Sol's second review ([261101d-plan-review-2-sol.md](261101d-plan-review-2-sol.md)) found six P1s in
the draft above; all were taken, and one premise turned out wrong while building:

- **Levels are one number per heading, measured from the section's own** (`levelsBelow`): by
  number when both are numbered, and the number must extend the section's own ("3.1.1" inside
  "2.4" makes the section ineligible); otherwise by tag distance. The draft's pairwise "deeper
  than" could go round in a circle on mixed numbered and unnumbered headings.
- **The section's own heading is found by position and its siblings, not by `sourceHeading`.**
  The draft trusted `sourceHeading`; stage 1 does not write it on sections in practice (not once
  in the report's paper). So: the first heading in range at the level the part's other sections
  start at — its first block, or, when the section starts where its part does, the first heading
  after the part's. A section stage 1 began mid-run at a paragraph is skipped. Position cannot be
  ambiguous where a heading's text can (Sol's duplicate-heading case).
- **A section holding any supplement block is skipped**; headings are read by `isBodyEvidence`,
  so a NOT-GISTABLE body heading is still a boundary.
- **Code supplies the author's headings as titles**; the model's title is used only for an opening.
  The answer is read by section number, not position; a gist outside 6–45 words, or an opening
  title over 8, costs that section.
- **One process-wide `WidthGate` of 8**, narrowed by 429s, under 4 calls per job.
- **Too close to the deadline with another lease window available, the step hands the job back**
  (`NeedsAnotherWindow`) before stage 2 buys anything; stage 1 is already checkpointed. On the
  last window it keeps stage 1's tree and says so.
- **Recall is gated against an independent annotation**: an Opus reader, shown only each
  section's headings, says where sub-sections should start, without seeing the planner's rule.

## The measurement

**Corpus, from the local database, not production.** The previous run's copies of Greg's
production blocks went with their worktree, and this session may not read production. The local
Supabase holds real copies of many of the same pieces, the report's paper included
(`arxiv-2308-08708-spya-w598t3`, 667 blocks, its 27 `h4`s). Nineteen documents
(`evals/structure-fourth-level/staged-corpus.ts`): five from 261101b's set (the paper;
arxiv-2602-11988, the one wording 2 emptied; three without sub-headings) and **fourteen fresh**,
used to tune nothing: eight sub-headed, five without, one book-sized piece on the whole-document
path (1,025 blocks).

**Paired**: each run makes stage 1 once per document and scores it as the control, then runs stage
2 on that very tree. Two runs, separated in time. Cap $25.

**Gates, quality before money, set before the run** (revised from Sol's findings 2, 3, 5, 6):

1. **The paper, in every run where stage 1 kept 2.5 beside 2.4**: 2.4.1–2.4.6 each start a depth-3
   child of 2.4, and nothing else in 2.4 does (not 2.4.5(a)–(c), not 2.5). Where stage 1 swallowed
   2.5, 2.4 is untouched.
2. **Every new node is depth 3, under a depth-2 section, with only leaves under it**; every one
   starts at the section's first block or an author heading.
3. **Nothing taken away**: every stage-1 node keeps its path, range, title, gist, question and
   `sourceHeading`; the leaves are the same.
4. **No section lost to a bad answer** beyond 1 in 20 asked, and no call failing whole after its
   redraw. Skips by reason are printed.
5. **Recall**: of the sections a sub-heading divides (and that rule 4 above does not exclude),
   at least 90% are divided.
6. **Gists read right**: a blind Sonnet reader checks every new title and gist against its prose
   (fits, and does not claim what the prose does not) on both runs; at most 1 in 20 flagged.
7. **Cost and time, on the articles stage 2 touches**: the structure step (stage 1 + 2) median cost
   **under +40%** and median added wall-clock **under 20 s**; and the labels step, run on both trees
   for four of them, not more than 10% dearer. The cost bar is looser than 261101b's 20% because it
   is now a second call, but only on the articles that get the level; it is about $0.05–0.10 an
   article against ~$0.55 for structure and labels together. If it lands over, that is Greg's call,
   with the numbers.

If a gate fails in a way one small change fixes, that one change is made and re-measured once; not
a tuning loop. If it still fails, Greg's fallback — a reader's "add a level of detail" button —
gets its own plan.

## If it passes

- Wire `addSubsections` into `generateStructure` after stage 1's checkpoint write and before the
  labels, on the body tree, rebuilt with `buildTree` and checked with `assertTreeSound`; a throw is
  a `warn` and stage 1's tree.
- Tests, each seen red first: the planner on hand-made shapes (the paper's numbering, a swallowed
  sibling, tag-only levels, an opening of headings only, one sub-heading with prose before it, a
  supplement, a part with leaves under it); the answer reader (wrong count costs one section);
  the wiring (off switch; deepening on runs instead; a thrown stage 2 keeps stage 1's tree); the
  request's parity pin.
- Docs: structure-step.md (a stage 2 section), structure.md, granularity-zoom.md § the tree,
  ai-gateway.md's cost line; 261029a's status.
- `npm test`, `npm run typecheck`, Sol's code review, push to `dev`.
- Then **ask the Overseer** to deploy and to re-run Greg's paper's structure in production, which
  he approved (q-vrnbyj, `spya-yg89m9`), through Metadata › Structure. Not run from here.

**Old articles stay as they are** ([principles.md § 1](../project/principles.md)); new articles
whose outline fits one answer get the level, and so does any article re-run through Metadata ›
Structure.

## Simpler options passed over

- **Switch on the September wave as it is.** Measured above: the right shape on the paper at
  +180% cost, with three ways to publish a wrong hierarchy.
- **Sub-sections from the author's headings with no call at all.** Free, but every internal node
  needs a gist (`tree-invariants.ts`), and the gist is what the reader at that zoom reads.
- **A third one-call wording, or letting the one call think** (q-k25zfg's A and B). Both change
  the call that works today; the staged route leaves it alone.
- **A reader's button first.** Greg offered it as the fallback; it is an endpoint, a wait and a
  re-run of the labels, where this is one more stage in a step that already runs.
