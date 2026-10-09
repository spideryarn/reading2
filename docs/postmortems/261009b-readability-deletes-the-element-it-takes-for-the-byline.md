# Readability deletes the element it takes for the byline

Up: [postmortems.md](../project/postmortems.md)

Found 2026-10-09 from report `spya-xg4jyr` (Greg: *"The author import for this paper is still pretty
messy"*), fixed in [261009d](../plans/261009d-arxiv-html-title-block-tidied-at-import.md).

## What happened

On an arXiv HTML import, part of the author list was missing from the article's prose, and nobody
had noticed because the masthead looked right:

- *Attention Is All You Need* (`arxiv-1706-03762-spya-wyt7j0`): Ashish Vaswani's affiliation and
  email were gone. Every other author's were there.
- `arxiv-2609-01481-spya-jytq2h`: the first author, *Haoyang Yan*, was not in the prose at all.
- `2608-13566v1-spya-yurten`: the masthead's byline was `Timur Galimzyanov Affiliation: …` — the
  deleted element's text, shown as if it were the paper's authors.

## The root cause

Readability's `grabArticle` walks the page looking for a byline. The first element whose class or
id matches `/byline|author|dateline|writtenby|p-author/i` and whose text is under 100 characters
becomes `byline` — **and is removed from the document** (`Readability.js`, `_isValidByline` and the
`_removeAndGetNext` after it). LaTeXML names its title block `ltx_authors`, each author
`ltx_creator ltx_role_author`, and each author's details `ltx_author_notes`. So the first of those
under 100 characters was taken: a whole short creator, or, where the first creator ran long (Ashish
Vaswani's carries a 120-word contribution note), his `ltx_author_notes`.

`latexmlAuthorNames` (261005l, then 261007d) fixed the *value*: `metaAuthors` reads the names off
the title block before Readability runs, and the byline is built from them. It did not touch the
*side effect*, because nobody had read what Readability does to get the value. The masthead came
right and the prose stayed short of an author's details.

## The class

**A library call read for its return value, whose side effect on its input nobody read.**
Readability's byline is documented as metadata; the deletion that comes with it is an
implementation detail in the same twenty lines. It is the sibling of
[260928a](260928a-a-library-field-that-holds-one-value-for-a-list-keeps-one.md) (how Readability
chose the one byline it keeps) — both found only by reading the library's code for the field in
question — and of every "mutates its argument" surprise.

## Which commit introduced it

Not one line: it is Readability's behaviour on a page shape we started importing.
[8b66fa4fa](../plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md)
and 2fa74ca7b (2026-10-06, *"arXiv's HTML goes first"*) made an arXiv link import LaTeXML's HTML
rather than the PDF, which is when the class names started reaching Readability. Before that, an
arXiv import went through the PDF path, where the authors are read by a model and drawn as one clean
row each — which is why Greg remembered this as solved.

## The fix shipped, and the right one

Shipped: `tidyTitleBlock` (`src/latexml.ts`) rewrites the title block before Readability into plain
`<p>` rows with no LaTeXML classes, so there is nothing byline-shaped left to take. That covers the
title blocks it can read (16 of 20 live pages). **The other four keep the deletion**: their shape
refuses the rewrite (several people in one `personname`), and their `ltx_*author*` classes still
reach Readability.

The long-term fix is to stop Readability's byline search from deleting anything on any page: pass
it a byline it will accept as already known, or strip `author`-matching class tokens from elements
before the parse and restore nothing, since `keepClasses: false` drops them anyway. Either is a
change to every web import, needs the extraction corpus run before and after
(`evals/` — what does Readability's byline grab remove today that a reader needed?), and is queued
rather than done here.

## What would have caught it, ranked by ease against value

1. **When a stage takes a value from a library, read the code that produces it, side effects
   included** — the rule 260928a already states for *how* the value is chosen, widened to *what
   else that code does*. Free, and would have caught this in 261005l's review.
2. **An end-to-end test that the prose keeps every author's words** — now in
   `tests/latexml-title-block.test.ts` (`runExtract` → `splitIntoBlocks`, Ashish Vaswani's details
   present). Cheap; it would have been red on 2026-10-06.
3. **A corpus measurement of what Readability's byline search deletes**, across the extraction
   fixtures. Worth doing with the long-term fix above; queued with it.
4. A general "words in, words out" check across the whole of stage 2 — rejected: stage 2 removes
   furniture by design, so the check would be a list of exceptions, and the cheap version (2) is
   the one that pins this class where it bit.
