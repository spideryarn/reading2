# Content extraction loses real structure and admits junk

**Status: not started.** This is the named plan that
[260903e](260903e-sweep-recorded-rather-than-fixed-defects.md) promised instead of another queue
entry, because "top of the next sweep" is a sentence and sentences are that plan's subject.

## Why this one matters more than the sweep that found it

The blocks feed Hierarchy and the granularity-zoom tree, and
[granularity-zoom.md](../project/granularity-zoom.md) is the feature this whole app exists for. A
dropped heading is a missing node in that tree. A six-character bracket-citation admitted as a
`gistable` block is a TOC entry made of punctuation. Both are silent.

[content-extraction.md:134](../project/content-extraction.md) has said so for days, in its own words:

> The rest is not fixed... **nothing reports it.**

GPT Sol, reviewing 260903e: *"If priorities force a choice, I would do content extraction before the
new defect-convention machinery."* The machinery was then dropped entirely, so the comparison is
against the sweep itself — and on measured reader impact this is the larger piece.

## The evidence, and how good it is

From `evals/results/extraction-corpus.json`, **already committed** by a prior run of the instruments
rather than generated for this plan — a distinction that matters, see "What is not verified" below.

- **13 of 15 fixture pages lose 10% or more of some structural element.** Counted directly from the
  rows with a non-empty `structureLost`; exact match to the doc's claim.
- **Wikipedia's *Transformer* article arrives with 0 of its 188 `<math>` elements.** The row reads
  `math 0/188` verbatim.
- **Paul Graham's *Great Work*: 326 blocks, 87 of them markers** — six characters or fewer, no letter
  in them, all `gistable`. The doc says 328 and 87; the marker count matches exactly and the block
  count is 2 out (~0.6%), unexplained and probably a slightly different revision.

**One number in the doc could not be reconciled and must not be quoted until it is.**
`content-extraction.md` says a 24,000-word ACX review "keeps 19 of 134 headings". The committed
corpus row for `acx` says `h2 0/6, h3 0/34` — 40 headings, none surviving. Those are not the same
claim and I do not know which is current. It may be a hand count from the original spike, or count
heading levels `STRUCTURE` does not track. **Resolve this before building anything on it.**

## Two problems, not one — and the evidence supports the split

They fail at different stages and want different fixes.

| | **Dropping real structure** | **Admitting junk** |
| --- | --- | --- |
| Where | Inside Readability, before stage 3 sees anything | After extraction succeeds completely |
| Symptom | Headings, tables, `<math>` never reach `article.content` | Marker blocks become gistable TOC entries |
| Recall | `droppedChars` non-zero | `ratio: 1.000`, `droppedChars: 0` |
| Fix shape | Pre-clean before Readability; possibly a second extractor | Classify or remove after splitting |
| Prior spike | [260827ab](260827ab-readability-repair-pass.md) | [260830at](260830at-readability-tidy-pass.md) |

A page can score perfectly on the first and be wrecked by the second (`pg-greatwork`,
`whitman-leaves`) and vice versa (RFC 9110 loses real `<pre>` and heading structure with few
markers). Treat them as separate jobs with separate fixture emphasis.

## Why the two previous attempts failed — read this before proposing a third

Both are labelled `**Status: a spike**` in their own headers. Neither was rejected on the idea.
**Both were sunk by their own measuring instruments being wrong in ways that made the proposed fix
look safer than it was.** That is the single most useful fact in this document.

**[260827ab](260827ab-readability-repair-pass.md), the dropped-structure side.** Shipped rung 0 (the
`aria-hidden` unhide, now in production at `src/extract.ts:257`), ran 15 fixtures, ran two models
once each on two pages. Sol's review found: no prevalence evidence at scale, and an inventory row
schema that **could not tell "table preserved" from "words survived as a bag"**. Its own "Decisions
for Greg" ends in five unanswered questions.

**[260830at](260830at-readability-tidy-pass.md), the junk side.** Ran three models over 21 fixtures.
Sol's review found three separate instrument faults:

- the eval **did not call the real pipeline** — `canonicaliseNotes` was missing, and a swallowed
  splitter exception made a broken splitter score as perfect;
- the proposed marker rule (no letter in a ≤6-char gistable block) **would delete real content** —
  numeric table cells, chess results (`1–0`), equations, dates;
- the control was Shakespeare's *Hamlet*, **inert at a 6-character threshold**, so "the trivial
  policy scores 100% clean" measured nothing.

Its own post-review recommendation was to fix the instruments, build negative controls for
numeric/symbol content, prefer structural rules to a character-class regex, and stay
**detection-only "for a long time."** None of that exists in `src/`.

**So the first stage of any third attempt is the instrument, not the fix.** Specifically: make the
eval call the real `readArticle` and `splitIntoBlocks` (`probe.mts` already does — see below), give
the corpus negative controls containing legitimate short numeric and symbolic blocks, and make the
inventory able to distinguish a preserved table from scattered words. Until a control can go red,
nothing measured against it means anything — [silent-success.md](../reusable/silent-success.md).

## What exists to build on

- **`evals/extraction/probe.mts`** runs the **real** production transforms — `readArticle` from
  `src/extract.ts` and `splitIntoBlocks` — and reports recall (`droppedChars`), per-tag structure
  loss below 90%, and "shatter" split into `markerBlocks` (no letter, certain junk) and `tinyBlocks`
  (has a letter, suspicious). **No model, no money, and no network on the `--file` path** — verified
  by reading it. `probeUrl()` fetches only when given a bare URL.
  `npx tsx evals/extraction/probe.mts --file evals/extraction/fixtures/<name>.html --url <original>`
- **21 committed fixtures** at `evals/extraction/fixtures/`, hashed in `hashes.json`, captured with
  no JavaScript. **Every loss above reproduces entirely offline.** (Note: `evals/extraction/fixtures/`,
  not `tests/fixtures/`, which is unrelated.)
- **Nothing is a gate.** `npm test` is `vitest run` and `npm run check` is `scripts/check.ts`; neither
  invokes anything under `evals/`. The instruments are hand-run, which is why a regression here has
  never once gone red.

**Confirmed absent from shipped code** — grepped `src/extract.ts`, `src/blocks.ts`, `src/hierarchy.ts`:
the structural check that 260827ab called *"the one I would build first"* (`structureLoss`, `STRUCTURE`,
kept-over-present — nothing); any rule that drops or flags short punctuation blocks (`SHATTER`,
`marker`, `hasLetter` — confined to `evals/extraction/tidy.mts`); a second extractor; model repair.

## Shape of the work, in the order the evidence demands

1. **Resolve the ACX heading discrepancy**, and re-run `corpus.mts` offline to confirm nothing drifted
   since 2026-08-30. Cheap, and everything below cites these numbers.
2. **Fix the instruments and give them negative controls that can fail.** Not the fix — the ruler.
   This is where both previous attempts died.
3. **Ship the structural check as a warning**, which 260827ab named first and nobody built. Detection
   before repair, and it is the thing that would make any future regression visible at all.
4. **Then, and only then**, argue about repair: pre-cleaning rules, a second extractor, or a model
   pass. Sol's standing advice on the junk side is detection-only for a long time, and nothing since
   has weakened it.

## What is not verified, stated plainly

- The numbers above come from **committed prior runs of the instruments, not from a run made for this
  plan.** A fresh `corpus.mts` run was attempted and abandoned unfinished: the box was at load average
  132 with 122 concurrent vitest processes from other agents. Re-run it before relying on any figure
  here.
- The callout/box preservation claim (`src/callouts.ts`, `src/notes.ts`) was confirmed only as far as
  "the code exists and is wired into `readArticle`". Its correctness was not checked.
- The ACX heading figure, as above.
