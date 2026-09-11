# PDF item boundaries: the evidence, and a decision

Status as of 2026-09-11: **experiment done; decision: no change.** Review found that the corpus result
does not justify adopting the generic split rule — see § Review. The implementation sketch is kept,
blocked —
[260911c-score-pdf-pages-at-the-line-breaks-pdfjs-did-not-mark.md](260911c-score-pdf-pages-at-the-line-breaks-pdfjs-did-not-mark.md).
Evidence: [`evals/pdf/item-boundaries/results-2026-09-11.json`](../../evals/pdf/item-boundaries/results-2026-09-11.json),
produced by the command below; the instrument is pinned by
[`tests/pdf-item-boundaries-eval.test.ts`](../../tests/pdf-item-boundaries-eval.test.ts). No
`src/` behaviour changed: `defusedFolios` and `folioOf` in `src/pdf-score.ts` are exported so the
harness can compare against them, and that is all.

This is cluster N of
[260908f](260908f-prioritised-spideryarn-codebase-improvements.md) (§ "N — preserve PDF evidence
before improving the heuristic"),
dispatched by the Overseer after:

> deprioritise further Overseer/web dashboard stuff to the very bottom priority, and now push up the
> priority of all the Spideryarn product stuff. Keep within 5h usage limits.
>
> — Greg, 2026-09-10

## The question

`pass0` (`src/pdf.ts`) joins pdf.js text items with nothing between them unless pdf.js set
`hasEOL`. On Kuhn's *A Landscape of Consciousness* that welds the page number to the heading after it —
`649.5.10.` — and a model that correctly writes `9.5.10.` is scored as having invented it.
`folioOffset` (`src/pdf-score.ts`) repairs this by electing one page offset for the whole document
by vote and stripping exactly that number. The
[postmortem](../postmortems/260904c-a-document-refused-for-an-answer-it-never-had-to-give.md) called
the upstream fix — keep the item boundary — "the right long-term answer", untested.

The stage asked: build a free corpus comparison; keep page text unchanged; carry the minimum
boundary metadata; compare heading evidence and refusal reasons old against new; score a second
path only inside the experiment; adopt only if the corpus shows an improvement without weakening
the fidelity checks.

## What pdf.js actually does at the fused folio

Probed on file page 37: the running header, an empty end-of-line item, then `64` at **y = 31.6**
(the foot of the page), then `9.5.10.` at **y = 732.9** (the top), with no end-of-line between
them. The folio is a footer the content stream happens to emit before the body. So the boundary is
not ambiguous: the next item is 88 font sizes away. That is what the experiment keys on — no vote,
no document-wide agreement, only the two items' own positions.

## The experiment

```
npx tsx --env-file=.env.local evals/pdf/item-boundaries/compare.mts --db \
  --local <Kuhn full PDF> --local <Nagel PDF> --out evals/pdf/item-boundaries/results-2026-09-11.json
```

- [`boundaries.mts`](../../evals/pdf/item-boundaries/boundaries.mts) restates pass0's loop and
  classifies every *fused* join (no whitespace, no end-of-line) as `touching`, `gap`, `shift`
  (|Δy| > 0.15 font sizes: super/subscripts) or `line-break` (|Δy| > 0.7). The second reading adds a
  newline at `line-break` joins and changes nothing else. **It never inserts a space.**
- [`compare.mts`](../../evals/pdf/item-boundaries/compare.mts) runs both readings through the
  **unchanged** `check`, on every transcription already bought: the committed title-fixture records,
  and the `pdf-chunk` checkpoints in the local database matched by raw-file hash. Then it corrupts
  each numbered heading in each reading (`12.3.` → `2.3.`, `9.5.10.` → `5.10.`) and asks which reading
  still reports it — the "what does this now let through?" question the postmortem says a widened
  rule must be asked. After review, a mutation already reported as invented before it was changed is
  excluded as confounded: otherwise an unrelated existing fault could count as a caught mutation.
- A **negative control** arm splits at *every* fused join — the rule the stage forbids — so that
  "no verdict changed" is shown to be a result the comparison could have failed to produce.
- The harness refuses to report a document where its page text differs from pass0's on any page, and
  the test checks that against pass0 itself on the `easy` fixture.

Corpus: the 13 committed `source.pdf`s, plus two local files that may not be committed — Kuhn's full
142 pages (the committed cut is 3 pages, NC-ND) and Nagel's "What Is It Like to Be a Bat?" (genuine
page numbers on their own lines). **228 pages, 206 real transcriptions.** A third local set — the
144-page LLM survey, with 32 transcriptions — was not included: its PDF exists only in a reader's
storage, and the auto-mode classifier refused copying it out. That refusal was right and is not
worked around.

## Results

| Measure | Old (pass0 + `folioOffset`) | New (split at line breaks) |
|---|---:|---:|
| Instrument matches pass0's text | 228 of 228 pages | — |
| Fused joins: `touching` / `gap` / `shift` / `line-break` | 15,846 / 0 / 185 / 150 | same joins |
| Largest `shift`; nearest `line-break` (font sizes) | 0.45; 1.86 | nothing between 0.5 and 1.0 |
| Kuhn headings recovered | 11 (by vote) | 11 (by position): 0 old-only, 0 new-only |
| What `folioOffset` still adds under the split | — | 0 entries on any page |
| Transcriptions failing the gate | 34 of 206 | 34 of 206 |
| Verdicts changed | — | **0** |
| Failure reasons changed | — | **2, both withdrawn, none added** |
| Corrupted headings caught (Kuhn, lattice; 0 confounded) | 425 of 435 | 425 of 435, the same 425 |
| Control arm (split everywhere): verdicts / failure lists changed | — | 15 / 26 |
| Pages whose text changes; furniture set changes | — | 150; 0 |

What each line means:

- **The measured corpus has a gap; that does not prove the classifier.** 179 of 185 shifts sit at
  0.3–0.5 font sizes; the two smallest line candidates are 1.86 (ACL's small print); the other 148 are
  over 2. Nothing observed lands between. `gap` is zero everywhere: pdf.js already emits a space
  wherever the page shows one. The synthetic stacked-number counterexample below occupies the
  unmeasured space this distribution cannot rule out.
- **The 150 line breaks:** Kuhn full, one per page — every one the folio; Kuhn cut 3; ACL 3; arXiv
  ARNN 2. Nagel's page numbers already carry `hasEOL`, so it has none.
- **Heading evidence is identical**, and it includes all eight cases `tests/pdf-score.test.ts` pins
  (plus `2`, `11.10`, `12` on pages 4, 67 and 70). Under the split, `folioOffset` recovers nothing
  that is not already a token, so for this corpus it is dead weight.
- **The two withdrawn reasons are the improvement, and they are a class `folioOffset` cannot
  reach.** Kuhn page 1 prints the licence URL `http://creativecommons.org/licenses/by-nc-nd/4.0/).`,
  and the text layer welds it to the first word of the next line, 42 font sizes lower. Two of the six
  committed readings transcribed the URL exactly and were told it is *"on none of these pages"*.
  `folioOffset` only ever strips a number off a heading; a URL is out of its reach, and so is every
  other token that happens to end a line pdf.js did not close. Both readings still fail, for reasons
  that are not this, so no verdict flips.
- **No observed heading mutation is lost.** The original arm catches the same 425 in both readings;
  the 10 missed by both are single-digit truncations (`3`, `1`, `2`) that match other numbers on the
  same page — an existing blind spot of `protect`, unchanged. Review found that this does not prove
  the broader claim "nothing is let through": it mutates headings already present in bought readings,
  not every protected token shape that the split can create. The original run also did not exclude a
  mutation whose token was already in the reading's `invented` list; the harness now reports those as
  confounded, and the full run (local PDFs and database) was repeated after that correction: 0
  confounded, so the 425 stands as a causal count.
- **The comparison can see a difference**: the control arm moves 15 verdicts.

Three limits to state plainly. Requested pages are inferred from the pages each reading's records
claim, not from the chunk plan that bought it — identical for both arms, so it cannot manufacture a
difference, but a context page a model echoed is scored as requested. And the corpus holds **no**
document where `folioOffset` fails to elect — fewer than three pages, folios that restart, roman front
matter — so the split's value there is a hypothesis this corpus cannot test. Most importantly, the
corpus does not cover every layout that makes two fused items differ vertically. A hand-built stacked
numeric run (`1` above `2`) crosses the 0.7 threshold: old text is the protected token `12`, split text
is `1\n2`, and a transcription that drops `2` changes from `invented: ["1"]` to no invented fault.
That is a concrete weakening of the check, pinned in `tests/pdf-item-boundaries-eval.test.ts`.

## Decision

The stage's rule was *adopt only if the corpus demonstrates an improvement without weakening the
fidelity checks*. The run demonstrates a narrow benefit on this corpus: two false URL faults are
withdrawn, the 11 Kuhn headings are recovered without a vote, and no observed verdict or heading
mutation is lost. It does **not** satisfy the safety half of the rule, because the stacked-number case
shows the same split can expose a proper subset of a numeric token and forgive an omission the old
path caught.

**Do not adopt the generic 0.7 + fused-only rule yet.** Keep `PageText.text` and `folioOffset` as they
are. The scoring-only architecture is still the right containment if a narrower boundary predicate
is proved: it leaves chunk planning, seam repair, title selection and block production on the old
text. But “only the scorer changes” does not make a weakened scorer safe, and `check` also controls
whether the paid attempt loop retries and which successful reading is checkpointed. The implementation
plan is retained as a record of that architecture and marked blocked on finding the narrower rule.

### Passed over

- **No change, record the evidence.** This is now the decision until a narrower rule rejects the
  stacked-number counterexample while retaining the observed folio and URL cases.
- **Change `pass0`'s text itself.** Simplest to write, and the most expensive: every consumer of page
  text shifts, and the chunk plan with it.
- **Widen `folioOffset` to URLs.** A second inference for a second shape of the same lost fact.

## Review, and why the decision reversed

The first draft of this doc said *adopt*. GPT Sol (gpt-5.6-sol, high effort, 2026-09-11, workspace-write)
returned DO-NOT-SHIP on that decision, not on the harness, and made the edits above. Its findings:

1. **High — the split can forgive an omission the old scorer catches.** Built, not argued: `1` stacked
   above `2`. This is the 260904c class again — a rule that only ever makes haystack tokens
   *shorter* admits a truncation — and the corpus mutations could not see it, because they corrupt
   headings that exist, not the token shapes the split creates. The implementer's counter-argument,
   recorded so it is not lost: `1` genuinely is printed alone there, so by `invented`'s own contract
   ("on none of these pages") the new arm is not wrong; the old arm caught it only because the text
   layer invented `12`. That is true and it does not rescue adoption. The stage's bar was *without
   weakening*, and the same shape arises for a number wrapped across a line pdf.js left unmarked,
   where the old token *is* the printed one.
2. **Medium — the mutation count was not causal.** Guard added; rerun: 0 confounded.
3. **Medium — scoring-only is contained, not inert.** The verdict drives the retry loop and which
   reading is checkpointed. And a content-score failure does not refuse an article — only a
   `structural` verdict does (`src/pdf-read.ts`, the `verdict.kind === "structural"` sites) — so
   the cost of a false `invented` fault is one extra paid read, not a refusal. The first draft's
   "a refusal a reader might have seen" was wrong.
4. **Medium — the comparison is not the production call** (requested pages inferred; no context page
   or bibliography exclusion). Adequate for a symmetric comparison, not for predicting retries.

Which leaves the gain as: two false fault reasons withdrawn, on readings that fail for other reasons
anyway, and no verdict changed.
That is not worth a known weakening. The narrower predicate 260911c's stage 0 describes — for example
requiring a jump of several lines rather than 0.7 of one (the stacked case is 1.0; the real cases are
1.86, 15.8, 19–88) — is cheap to try with this harness, and is left for whoever next finds a document
where the vote fails.
