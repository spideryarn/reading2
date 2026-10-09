# arXiv HTML imports: each author's affiliation, read by the PDF path's authors pass

Up: [plans.md](../project/plans.md). Report `spya-xg4jyr` (SPIDERYARN-READING2-FG), question
[q-qjbb9a](../user-feedback/questions/q-qjbb9a.md), queue item `qi-62h5hz6s`. Follows
[261009d](261009d-arxiv-html-title-block-tidied-at-import.md), which tidied the rows and asked this.

> 1A as long as it's not too complicated or costly. 2A but just for that one because it's a
> prominent paper that we're sharing publicly.
>
> — Greg, 2026-10-09, reply `spya-fb8y50` to q-qjbb9a

## What this is for

Since 2026-10-05 an arXiv link imports arXiv's HTML rendering, not the PDF. Its masthead names come
from LaTeXML's markup (`latexmlAuthorNames`, src/latexml.ts), without affiliations, so the hover
tooltip a PDF import has on each name is missing. Reading affiliations by rule was tried and was
wrong on 7 of 19 pages, silently
([261007d](261007d-front-matter-folded-by-default-and-arxiv-html-authors.md)). A PDF import gets
them from a model call held to the page's words (`src/pdf-authors.ts`). 1A is that call, on the
HTML path.

## What to build

**The PDF path's authors pass, unchanged, fed the title block as records.** No new prompt, schema,
model or check:

```
LaTeXML title block (before prepareDocument rewrites it)
  └─ latexmlTitleBlock(doc) → { names (the markup's, as today), creators: one line of text per author }
       └─ records: [ {id:"names", text: names.join(", ")},  {id:"author-1", text: "Ashish Vaswani … Google Brain …"}, … ]
            └─ readAuthors(records, ["names"], openRouterAuthorsReader(modelFor("pdf-frontmatter", power)))
                 └─ verifyAuthors: every name in the names record, in order, nobody skipped;
                    every affiliation a run of the page's own words, trimmed, shape- and cap-checked
                 └─ and here: the names returned are exactly the markup's names, in order,
                    and each affiliation is a run of words in that author's own record
```

- `latexmlTitleBlock` (src/latexml.ts): the same `titleBlockOf` + `readCreators` as
  `latexmlAuthorNames`, so it is `null` exactly when the names are. Each creator's text, with
  LaTeXML's furniture **replaced by a space**: a note's repeated marks and number (`NOTE_FURNITURE`,
  which the tidy rewrite already drops) and a contact label that is exactly one of the measured
  `CONTACT_LABELS` (`Affiliation:`, `Email:` …); a label not in that list stays as words. And a
  space after the name and each contact and note. The labels have to go: LaTeXML splits one
  institution over several contacts (`Affiliation: Department of Physics, Affiliation: University
  of Trento, Affiliation: Italy`), and with them in, the institution is no consecutive run of words,
  so the check refused the whole paper (2610.08392, measured below). *Replaced*, not deleted, because
  deleting fused the words either side into one the page never printed (plan review, 2).
- `src/arxiv-affiliations.ts`: the records, the call, and two checks `verifyAuthors` does not make.
  The names that come back must be exactly the markup's names, in order (a model splitting one name
  into two people would otherwise pass). And **each affiliation must be printed in that author's own
  record** (`affiliationPrintedIn`, the PDF check's own matcher, exported): `verifyAuthors` finds an
  affiliation anywhere on the page, which is all a PDF offers, and so "Google Research" for Vaswani
  passed it (plan review, 1). An institution printed once for several authors is refused with it.
  All or nothing, as on the PDF path: any refusal leaves the names-only list exactly as today. A
  model that gives nobody an institution is also "nothing".
- `runExtract` (src/extract.ts) takes an optional `affiliations` reader, as it takes `titleTidier`;
  absent, no call (tests, scripts, evals). `readingArm` hands out the title block only when the
  author list **came from it** — asked while it can be, by whether `metaAuthors` finds anything
  without it, since a `citation_author` list of the same names is indistinguishable afterwards (plan
  review, 3). The call is in `runExtract`, after every refusal, so a page refused as too short never
  pays and the prose-retention fallback's second `readingArm` run does not call twice.
- `pipeline.ts` hands one in on the HTML extract branch, built on the article's power, and logs a
  refusal or a failure (an abort is re-thrown), as `authorsOrNothing` does in src/pdf-read.ts.
  Metered under the `pdf-frontmatter` route, as the PDF call is; the cost lands on the article's
  `extract` step by `runStep`, so nothing new is needed for cost tracking.

**Not done, and why:**

- *A cheaper model* (the title tidier's DeepSeek). Greg chose "the same small model PDF imports
  use". That is in fact the **capable** tier (Sonnet 5.5, `pdf-frontmatter` in src/models.ts), on a
  route pinned to Anthropic; q-qjbb9a called it small. It costs half a cent here (below), which is
  what the question promised. Switching would mean a second route and a second measurement for a
  saving of a fraction of a cent.
- *Affiliations printed once for several authors.* The per-author check refuses them (2610.08750
  below, where the model also mixed two records). Accepting them would mean trusting the model's
  attribution across records, which is the very thing the check is for.
- *A cache on a content hash.* A re-extraction calls again. It is half a cent, and re-extraction is
  rare; the PDF authors pass has no cache either.
- *Commas between contacts.* With labels removed, `Department of … Engineering University of Bologna
  Bologna, 40126, Italy` reads with no comma where the page had a label. Adding one would be a
  character the page did not print; left as the page's own.
- *2A, the re-extraction of Greg's Attention import* (`arxiv-1706-03762-spya-wyt7j0`). A production
  write that needs this code deployed: recorded in q-qjbb9a as authorised, for the Overseer after
  the deploy.

*The simpler option passed over*: storing `ltx_role_affiliation` contacts by rule, no model. Measured
wrong on 7 of 19 pages (261007d). The model is what Greg approved.

## Measured

`evals/arxiv-affiliations/measure.ts` over live `arxiv.org/html/<id>` pages — the eleven papers the
title-block fixtures were cut from and five more from 261009d's twenty — each call recorded in the
ledger. Sonnet 5.5, standard power, 2026-10-09, on the final code (after the plan review):

| | |
|---|---|
| cost per import | **$0.002 – $0.010**, median about **$0.005** (820–1,700 tokens in, 44–660 out); 13 calls, $0.060 |
| every name given its affiliations, right | 10 of 13 called |
| refused, names stay plain | 2: 2610.08790 prints no affiliation in its title block; 2610.08750, where the model gave the first author "Bioinformatics Group … Wageningen" assembled partly from the second author's record — refused by the per-author check, rightly |
| some authors given none, rightly | Polosukhin in Attention (the page prints only his email), Bates in 2610.08785 (nothing beside his name) |
| no call | 3: 2610.08781, .10548, .10690 (no names read today either: several people in one `personname`, or institutions as creators) |
| wrong | 0 seen |

Attention reads `Ashish Vaswani — Google Brain`, `Niki Parmar — Google Research`, `Aidan N. Gomez —
University of Toronto` … as the PDF import did. Before the labels fix, 2610.08392 was refused and
2610.03261's one institution came back as three. Full output: the ledger line per paper is
reproducible with the command above.

**End to end, locally**: `scripts/stage.ts extract arxiv-1706-03762v7-spya-wv4w9s --force` (the
local database) stored the eight authors with those affiliations on the revision, and the ledger
booked the call as `extract` / `pdf-frontmatter` beside the title tidy, $0.0056 for the step.

High power runs the call on Opus 5.5, about five times the price: still under three cents.

## Stages

1. `latexmlTitleBlock`, `src/arxiv-affiliations.ts`, the `runExtract` option and the pipeline
   wiring; tests red first on the fixtures with a stub reader (no spend): the records, a name split
   refused, a name missing refused, an affiliation not on the page refused, an abort re-thrown, a
   `citation_author` page never asking, an end-to-end `runExtract` with a stub giving Attention its
   affiliations on `meta.authors`. The measurement above, re-run on the final code.
2. Docs (content-extraction.md's arXiv reader, a line in architecture's model-calls list if one
   lists them), GPT Sol's code review, the gates, push, the note, q-qjbb9a, `feedback-endings.ts`.

GPT Sol reviews this plan before stage 1 and the code before the push.

## The plan review

GPT Sol, read-only, 2026-10-09 ([the review](261009m-arxiv-affiliations-plan-review-sol.md)),
verdict *revise before build*. No P0. Each finding checked against the code; both P1s reproduced
by the reviewer and then pinned by a test that was red against the spike.

| | Sev | Finding | Outcome |
|---|---|---|---|
| 1 | P1 | Affiliations verified page-wide, so a printed institution could be given to the wrong author (Vaswani ↔ Shazeer swap passed) | Accepted: each affiliation must be in that author's own record; test; costs one paper of thirteen, rightly |
| 2 | P1 | Deleting `.ltx_contact_name` can fuse two words into one the page never printed, and removed any label unchecked | Accepted: only the measured labels, replaced by a space; a space after each name, contact and note; tests for both |
| 3 | P2 | Equal names do not prove the list came from the title block | Accepted: provenance asked in `readingArm`; the test uses the same eight names |
| 4 | P2 | Tests for the adversarial and placement cases | Accepted, bar one: a test that the prose-retention fallback calls once. The call is in `runExtract`, which runs once whatever `readingArm` does; building a page that rolls back was not worth it for that |

## Ledger

- 2026-10-09: prior-work check (plans 260929d, 261007d, 261009d; the note and q-qjbb9a; origin/dev;
  fleet: no other session on this). Spike and measurement: `latexmlTitleBlock`, the module, the
  measure script; labels fix after 2610.08392 refused. Plan written.
- 2026-10-09: GPT Sol's plan review, *revise before build*; all four taken (§ The plan review).
  Built red first: `tests/arxiv-affiliations.test.ts`, 20 tests on the real fixtures, stub reader.
  Five mutants (labels kept, names check off, per-author check off, provenance off, the gate off),
  each killed. Re-measured on the final code; a local stage-2 run stored the affiliations.
