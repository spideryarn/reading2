---
id: q-qjbb9a
report: spya-xg4jyr
status: answered
asked: 2026-10-09
title: arXiv papers: read affiliations with the small model, and re-import your Attention paper?
refs: qi-tfx8kg3j · SPIDERYARN-READING2-FG · docs/plans/261009d-arxiv-html-title-block-tidied-at-import.md · docs/user-feedback/261009_0116-arxiv-html-author-list-tidied.md · qi-62h5hz6s · docs/plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md
acted: spya-fb8y50
---
The messy author list is fixed for new arXiv imports, without a model. Two follow-ups are yours to decide.

1. Should arXiv imports also get each author's affiliation on the masthead names (the hover tooltip), read by the same small model PDFs use?
   1A (recommended). Yes. One small model call per arXiv import (a fraction of a cent), checked against the page's own words as the PDF one is, so it cannot invent an institution. Gives the tooltip PDF imports already have.
   1B. No. The names stay plain on the masthead; the affiliations are still in the author rows under it.

2. Your "Attention Is All You Need" import (the one you reported from) still has the old messy rows, because the fix applies at import time. Shall I re-import it?
   2A (recommended). Yes, re-extract it. Every paragraph keeps its id, so your comments and highlights stay put; only the old author paragraph is replaced, so anything attached to that one paragraph would come loose. The Structure and summaries are rebuilt (cents).
   2B. No, leave it as it is.

Details

What you reported (2026-10-09): the author list on your arXiv import of Attention Is All You Need was messy, and you thought a small model was tidying authors at import.

What was going on. That small model exists, but only for PDFs. Since 2026-10-05 an arXiv link imports arXiv's HTML version instead of the PDF (it has better maths), and the HTML path never had the model. In fact you have this paper twice: a PDF import from 2026-10-05 with clean rows ("Noam Shazeer, Google Brain, noam@google.com") and the HTML one from last night with one 194-word paragraph full of "thanks:", "11footnotemark: 1" and "Affiliation:" labels.

The cause was layout, not reading. arXiv's HTML hides each author's affiliation, email and footnote in a pop-up that only appears on hover; we drop arXiv's styling, so every pop-up label became text and all eight authors ran into one paragraph. Separately, the library that finds the article on a page (Readability) quietly deleted the first author's details, because it took them for the byline.

What shipped. At import, the author block is now rewritten into one row per author (name, then affiliation and email on their own lines), with the footnotes written once underneath, numbered ("1 Equal contribution. Listing order is random…"), and each name carrying the numbers of the notes that apply to it. It is all the page's own words, moved rather than retyped, and a check refuses the rewrite if a single word would be lost. 16 of 20 recent arXiv papers get it; the other 4 have an author block in a shape it does not recognise and stay as before.

Not changed: the rows still show by default on this paper. The "fold the front matter away" feature does not fire because the very first line is Google's licence notice, which does not look like an author line.

Question 1 in more detail. The masthead already shows the names (read from arXiv's markup without a model). What it lacks is the hover tooltip with each author's institution, which PDF imports get from the model. Reading affiliations by rule was tried on 2026-10-07 and was wrong on 7 of 19 papers, silently, so a model is the way to get them. The model is not needed for the tidy rows.

Question 2 in more detail. Re-importing means running your article through the import again with the new code. It is a write to your production data, so I am asking rather than doing it.

## Greg's answer, 2026-10-09 11:17 UTC (in the Feedback dialog, reply `spya-fb8y50`)

> 1A as long as it's not too complicated or costly. 2A but just for that one because it's a prominent paper that we're sharing publicly.

Acted on 2026-10-09.

1A, built and on dev, not yet deployed: docs/plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md. Not complicated: the PDF path's authors pass is reused as it is, with two extra checks (the names must come back exactly as arXiv's markup has them, and each affiliation must be printed beside its own author). Not costly: about half a cent per arXiv import ($0.002 to $0.010 on 13 live papers). One correction to the question: the model PDFs use is the capable one (Sonnet 5.5), not a small one; the half-cent is measured on it. 11 of 13 papers got their affiliations, all right; 2 were refused and keep plain names; none wrong.

2A, authorised by this reply for that one article only (arxiv-1706-03762-spya-wyt7j0, Greg's HTML import of Attention Is All You Need), and not done here: it is a write to production and needs 261009m deployed first, together with the earlier tidy-rows fix (261009d). The Overseer runs the re-extraction after the deploy that carries both. No other article is re-imported.

## 2A, run on production (2026-10-09)

Production was on 8bd1e67b, which carries both 261009d (c1b82989) and 261009m (14a38a26) —
`git merge-base --is-ancestor` against origin/main, both yes.

**The path.** The app's own refresh is the shelf row's *Refresh* (`POST /api/jobs { slug, force }`),
which needs Greg's signed-in session, so it was not reachable from the box. The same request was
made through the same function instead: `enqueue({ slug, force: ["extract"] })` with the default
steps, driven by `advanceJob` as `scripts/stage.ts § drive` does, from a detached worktree at the
production commit (so the code that ran is the code production runs), with `.env.prod`'s
credentials and no `.env.local` to override them. `force: ["extract"]` rather than `["fetch"]`:
both fixes act at extraction, so the stored arXiv HTML is re-read rather than fetched again, which
is what "re-extract" meant in 2A. `scripts/stage.ts` itself could not say this: its one-step
`extract --force` would not cascade to blocks and structure, and `ingest <url> --force` adopts by
address, which for a paper Greg holds twice (PDF and HTML) is not certain to pick this one.

**The command**, from `/var/tmp/spideryarn-worktrees/prod-reextract-attention` (detached at
8bd1e67b): `npx tsx <scratch>/reextract-one.ts`. Its dry run printed:

```
Target:    postgresql://spideryarn_app.alschkahzfagtppxspfq@aws-0-eu-west-2.pooler.supabase.com:6543/postgres
Storage:   alschkahzfagtppxspfq.supabase.co
Article:   arxiv-1706-03762-spya-wyt7j0
Owner:     001bb7a0-7720-4f1b-8b9d-1ee6e63d132a
Request:   enqueue({ slug, force: ["extract"] })  — default steps
```

Steps: fetch (skips on the stored source), extract, blocks, structure, assets — this article's own
new revision only. Nothing else is touched; no row is deleted.

**Before.** Revision 4e2bdb6f, 149 blocks; block 2 (`spya-v8atxk`) is the one 194-word author
paragraph; eight masthead authors, no affiliations; no comments on the article.

**What ran** (2026-10-09 19:18 UTC). The real run printed the same `Target:` line as the dry run
above (`spideryarn_app.alschkahzfagtppxspfq`), then job `spya-bvaqmb`:

```
  fetch        skipped   already done
  extract      done      Attention Is All You Need
  blocks       done      159 blocks, 11 new ids (148 kept)
  structure    done      32 sections over 159 blocks
  assets       done      3 images stored, 5 left hot-linked
```

Publishing queued the article's usual labels follow-up, `spya-u2gxc9`, which Greg's browser would
otherwise have driven on his next visit; it was driven from the same place so that a visitor does
not see "Paragraph labels are still arriving": `labels done, 149 paragraphs labelled`. "5 left
hot-linked" is what the original import (`spya-xhqbkz`) reported too, so it is not new.

**After** (read back with `BEGIN READ ONLY`). Revision 68b5974f, based on 4e2bdb6f, published.
The masthead authors now carry affiliations: Vaswani, Shazeer and Kaiser *Google Brain*; Parmar,
Uszkoreit and Jones *Google Research*; Gomez *University of Toronto*; Polosukhin none, which is
right, because the page gives him only a gmail address. The old 194-word paragraph
(`spya-v8atxk`) is gone; in its place are eight author rows (`Ashish Vaswani1 Google Brain
avaswani@google.com` …) and three numbered notes (`1 Equal contribution. …`, `2 Work performed
while at Google Brain.`, `3 Work performed while at Google Research.`). Every other block kept its
id (148 kept). The article had no comments, so nothing came loose. The worktree was removed and
the one-off script, which read `.env.prod` at run time, was deleted straight after use.

**In the browser**, signed out, on https://www.spideryarn.com/read/arxiv-1706-03762-spya-wyt7j0:
it opens (as shared, view only), shows the eight author rows and the numbered notes, has no
"thanks:" or "footnotemark" anywhere, and logs no console errors. The masthead names have no
affiliation tooltip **signed out, by design**: a visitor is sent `byline` and never `authors`
(src/public/dto.ts § `publicAuthorNames`), so the tooltip is for Greg's own, signed-in view, which
this check could not reach.
