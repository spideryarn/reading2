# An arXiv paper with no `\title` takes its title from its own opening

*Status as of 2026-10-17: decided, being built — evidence: this file; nothing under `src/` yet.*

Report `spya-mx3wz0` (#591, `SPIDERYARN-READING2-JD`), from Greg, filed 2026-10-17 13:14 UTC on
`arxiv-2308-08708-spya-xax6v4`:

> Why does the title for this article have a "1" at the beginning?

## What is actually wrong

The stored title is `1Indicator Properties` (production, read-only, `article_revisions.title`,
`title_original` null). The paper is *Consciousness in Artificial Intelligence: Insights from the
Science of Consciousness* (arXiv:2308.08708). So the "1" is not a stray mark on a right title; the
title is a numbered part of the paper with its number glued on.

It is arXiv's own `<title>`, byte for byte. The raw bytes we stored (`raw_sha256 805e9d3b…`)
match a fresh fetch of `https://arxiv.org/html/2308.08708`, and that page's head says
`<title>1Indicator Properties</title>`. The paper sets its title page by hand (a bold centred
paragraph and a table of authors) rather than with `\title`, so LaTeXML had no document title and
filled `<title>` with something else. The page has **no `h1.ltx_title_document`** and no `<meta>`
tags at all. Three other arXiv HTML papers checked the same day (2402.13659, 2609.16247, 1109.1875)
each have an `h1.ltx_title_document` and a `<title>` that equals it.

Readability takes `<title>`, the rule and model tidiers keep it (it is mixed case, no trailing mark),
and it is stored. One arXiv HTML article in the ten on production has it.

**The class: a LaTeXML page whose document has no title of its own, where `<title>` is LaTeXML's
fallback and names a part of the paper, not the paper.** With `<title>` gone, Readability's own
fallback is no better: the first heading, `1 Introduction`.

The same paper also has no authors (`authors` null): LaTeXML's author markup is absent too, so
`latexmlAuthorNames` finds none and the front-matter pass is not called. Out of scope here, said in
the report note.

## The decision

1. **Detect it** in src/latexml.ts, by the file's rule 1 (a supported LaTeXML source address and an
   `article.ltx_document`): `latexmlUntitled(doc)` is true when there is no
   `.ltx_title_document` anywhere in the page. Read in `readArticle` on the document as it arrived.
2. **Then the page's `<title>` is not used.** `runExtract` asks a new injected seam,
   `titleFromOpening(opening)`, for the title. `opening` is the `pageOpening` records
   (src/front-matter-authors.ts) that the front-matter authors pass already reads, so there is no
   second reader of the page's top.
3. **The seam is one cheap model call, held to the page's words by code** (new
   src/opening-title.ts, job `opening-title`): the model sees the opening records as inert JSON and
   answers with a record id and the title. Code accepts it only if the answer, whitespace-collapsed,
   is a contiguous run of that record's text, between 3 and 300 characters, and stores **the
   page's characters**, never the model's. Anything else — refusal, timeout, mismatch — is no
   answer.
4. **No answer: the slug** (`{ title: slug }`, the existing no-title path), not LaTeXML's guess. A
   title we know is a section heading is worse than one that is plainly a placeholder, and the
   reader can rename either.
5. Whatever the seam returns then goes through the title tidier exactly as `<title>` would.
6. **Held steady across re-extraction**, for `stepTitleTidier`'s reason (`title` is in every mode's
   fingerprint): when the previous revision's `titleOriginal ?? title` is printed verbatim in one
   of the opening records, it is reused and no call is made.

### Options passed over

- **arXiv's own record** (`arxiv.org/abs/<id>`'s `citation_title`, or the export API). Authoritative
  and model-free, and it would give the missing authors too. Passed over because it is a second
  fetch from inside stage 2, works only for arXiv ids (not for a LaTeXML page from anywhere else),
  and Greg, 2026-10-09, in src/front-matter-authors.ts: *"I don't think we should be building things
  that are specific to a particular site unless we really have to … this kind of thing is the sort
  of thing I'd hope we could do with an LLM in a general way"*. The trigger is LaTeXML-specific
  (it has to be: only LaTeXML's markup says the title is missing); the cure is not.
- **The first opening record, no model.** Right on this paper, but a hand-set title page can open
  with a date, a "Preprint" line, a logo's words or an institution; one measured page is not a
  shape (latexml.ts rule 2).
- **Trigger on any page whose `<title>` is not printed in its opening.** General, but it would
  call a model on a large share of ordinary web pages whose `<title>` carries a site name or SEO
  wording, for a fault measured only on LaTeXML. Simplest version first.
- **Strip a leading digit off the title.** Fixes the symptom and leaves `Indicator Properties`.

## Stages

1. Failing tests: the real page's head and title block, trimmed, as a fixture; `runExtract` with a
   fake seam must not return `1Indicator Properties`; with no seam, the slug. Red first.
2. `latexmlUntitled`, the seam, src/opening-title.ts with its check, models.ts job + model
   (`FRONT_MATTER_AUTHORS_MODEL`'s tier), pipeline wiring with the steady-title rule. Tests for the
   check (accepts a run of a record, refuses an invented or edited title, refuses the wrong id).
3. Docs: content-extraction.md § title, the note in docs/user-feedback/.

The production article is not rewritten (the brief); it gets the right title when it is next
extracted, or Greg can rename it.

## References

- src/latexml.ts (rule 1, `hasLatexmlSource`), src/extract.ts (`readArticle`, `runExtract`),
  src/front-matter-authors.ts (`pageOpening`, the held-to-the-page pattern),
  src/pipeline.ts (`stepTitleTidier`, `frontMatterAuthorsReader` wiring)
- docs/plans/261005g, 261005j (title tidying), 261010d (front-matter authors),
  docs/investigations/261005e (arXiv HTML through our pipeline)
- docs/user-feedback/261004_2039-light-tidying-of-an-imported-title.md
