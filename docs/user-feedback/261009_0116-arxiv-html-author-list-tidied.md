---
reports: spya-xg4jyr
ending: shipped
comment: New arXiv imports show one tidy row per author, and each name's affiliation on hover. Your Attention import is re-imported after the next deploy, as you asked.
---

# An arXiv paper's author list, tidied at import

A suggestion that reads as a bug report, from Greg (admin; `feedback-reporter.ts` exit 0 on the
production row), 2026-10-09 01:16 UTC, on `arxiv-1706-03762-spya-wyt7j0`
(`?mode=structure&margin=1&learn=quiz&stop=spya-t5yvtb`). Sentry SPIDERYARN-READING2-FG. Queue item
`qi-tfx8kg3j`.

> The author import for this paper is still pretty messy. You can read it from production, maybe
> take screenshots and you'll see what I mean. I thought we were fixing this as part of the import
> process with a small model that would tidy it up?

**Ending: shipped**, on `dev`, for new imports —
[261009d](../plans/261009d-arxiv-html-title-block-tidied-at-import.md).

The small model exists but only on the PDF path, and since 2026-10-05 an arXiv link imports the HTML
rendering instead. The mess was layout: arXiv's hover pop-ups (affiliation, email, `\thanks`) drawn
inline as one fused paragraph, and Readability deleting the first short author element it took for
the byline ([postmortem 261009b](../postmortems/261009b-readability-deletes-the-element-it-takes-for-the-byline.md)).
The title block is now rewritten at import into one row per author with the notes numbered
underneath; 16 of 20 live pages, no word lost. Screenshots of a local import:
`261009d-shot-*.png`.

Not done here, each written down:

- **Affiliations on the masthead tooltip by the small model**, and **re-extracting Greg's article**
  (a production write): asked in [q-qjbb9a](questions/q-qjbb9a.md). Greg answered 1A and 2A on
  2026-10-09 (`spya-fb8y50`). 1A shipped on `dev`:
  [261009m](../plans/261009m-arxiv-html-affiliations-by-the-authors-pass.md), about half a cent an
  import (queue item `qi-62h5hz6s`). 2A, the re-extraction of `arxiv-1706-03762-spya-wyt7j0` and
  that article only, ran on production on 2026-10-09 once both were deployed:
  [§ 2A, run on production](#2a-run-on-production-2026-10-09) below.
- LaTeXML's body footnotes drawn mid-sentence: queued, `qi-d7g2qmze`.
- Readability's byline deletion on the shapes the rewrite refuses, and on any web page:
  queued, `qi-yhkw2ej6`.
- The fold still does not fire on this paper (the licence line comes first): the long-term answer
  is front matter marked at import, 261007d's deferral.

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
