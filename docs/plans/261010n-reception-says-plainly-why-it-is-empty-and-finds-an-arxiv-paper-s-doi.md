# Reception says plainly why it is empty, and finds an arXiv paper's DOI

Reports `spya-qtk3q2` (SPIDERYARN-READING2-GA), `spya-sbj3yk` (-GB) and `spya-vh0z7s` (-G8), all
Greg's, all filed 2026-10-09 from Sources › Reception on *Attention Is All You Need*
(`arxiv-1706-03762-spya-wyt7j0`). Queue item qi-wtq7c6e8. Session
`fbqtk3q2-sources-reception-messages`, 2026-10-10, built on the Sources rename
([261009w](261009w-peer-review-becomes-sources-all-the-way-down.md)), which had landed.

## What Greg said

> I have no idea what this means.
>
> "The search found 12 pages that might respond to this piece, but none could be checked against
> the words it returned."
>
> — Greg, 2026-10-09 (`spya-qtk3q2`)

> "This piece has no DOI on record, so we cannot look up who cites it."
>
> I can't tell if that means that we tried to find the DOI and failed, or we never tried. If we
> never tried, then we should. Perhaps there's a button, or perhaps it does it automatically. I
> mean, I thought it did that as part of the import process. If we tried and failed, then I suppose
> there should be a way to input it? And is there no way to sort of continue without the DOI?
>
> — Greg, 2026-10-09 (`spya-sbj3yk`)

> I don't really understand the difference between reception and claims. Is reception more broad,
> like which other particular articles wrote about this one, and then claims is more about themes?
> Or is it, I guess claims is about things the article says and whether other people have
> overturned it? I don't know. I mean, those seem kind of overlapping. I wonder if we could/should
> merge them somehow?
>
> — Greg, 2026-10-09 (`spya-vh0z7s`)

## What is actually going on

**1. The empty Reception sentence blurs two different things, and names neither.** It is
`emptyGroupNote` ([ReceptionAndClaimsPanel.tsx](../../src/web/ReceptionAndClaimsPanel.tsx)), and
it fires whenever the search returned pages (`returnedSources > 0`) and kept no row
(`keptRows === 0`). Behind that sit two cases the stored counts already tell apart:

- `reportedRows === 0`: the search returned pages, but the AI's answer contained no candidate row.
  The counts do not say that it read or judged every page. Nothing was "checked" at all; the
  sentence implies a check failed.
- `reportedRows > 0`: the AI's answer contained candidate rows, and none survived our rules — most often
  the quotation it gave could not be found in the slice of the page the search engine returned
  (`unverifiedSource`, `directnessUnverified`), sometimes the page is the article itself or a copy
  of it (`selfSource`, `sourceIsCopy`), or the AI named an address the search never returned
  (`uncited`).

"Checked against the words it returned" is the developer's description of the second case. A
reader cannot tell what "it" is, what was checked, or why.

**2. "No DOI on record" is wrong for this paper, and is a known gap.** An arXiv paper has a DOI,
`10.48550/arXiv.<id>`, registered by arXiv with DataCite. At import, `withRegistryFacts`
([article-registry.ts](../../src/article-registry.ts)) asks DataCite about the arXiv id, confirms
the record is this article (title and an author), and takes its journal and year — but puts the
DOI on the article only when the id it asked about was itself a DOI. So an agreeing lookup reached
through an `arxiv:` candidate never kept the DataCite record's DOI, and an arXiv paper with no
other DOI (the usual case: arXiv pages declare none) gets *Cited by*'s `no-doi` without anyone being
asked. (Not *every* arXiv import: a page-declared or model-read DOI is kept, and an import with no
authors, or a registry miss, asks nothing — GPT Sol's F3.) Plan
[261004h](261004h-reception-lists-the-papers-that-cite-the-piece-from-openalex.md) named this and
left it ("an arXiv preprint shows the `no-doi` sentence. Not built here").

Measured 2026-10-10: OpenAlex's `works/doi:10.48550/arxiv.1706.03762` resolves to W2626778328,
"Attention Is All You Need", Vaswani first, 26,917 citers. So the arXiv DOI is enough.

And when a piece really has no DOI (most web pages), the sentence still does not say we looked,
or what the reader can do.

**3. The Claims chip's card describes Reception.** `SOURCES_SUB_MODES` in
[sub-modes.ts](../../src/web/sub-modes.ts): Reception is *"What others say about this piece:
replies, reviews, and work that cites it"*, and Claims is *"What others say about each claim it
makes: …"*. Two cards that both open "What others say about" are the overlap Greg read. In fact
the two differ in what they start from: Reception starts from the piece (who has written about
it), Claims from the article's own sentences (its claims, which the reader picks and checks).

## What we will do

### Stage 1 — the words

- **The empty sentence becomes three**, chosen off the counts already stored, one per fact
  (wording as built, after Sol's F1):
  - no pages came back: unchanged (*"No page the search found responds to this piece by name."*);
  - pages came back and the AI put none forward: *"The web search returned 12 pages, but the AI
    put none forward as a response to this piece by name, so nothing is listed."*;
  - pages came back, the AI put some forward, none survived: *"The web search returned 12 pages.
    The AI put forward 3 possible responses to this piece. We list one only when we can confirm it
    ourselves, mainly by finding the words the AI quoted in what the search returned from that
    page. We could not confirm any of them, so nothing is listed."*
  The same three for the legacy Claims group (searched before `debate/7`), about "what this piece
  claims". The visitor's single sentence is untouched: it carries no counts.
- **The no-DOI sentence** says what a DOI is and that we have none (after Sol's F2, which found
  "we looked …, and found none" unrecorded and sometimes false): *"We could not list who cites
  this piece, because we have no DOI for it: a standard identifier used for research papers. Many
  web pages and blog posts do not have one."* The Google Scholar link under it is the way to carry on
  without one.
- **The Claims card stops describing Reception**: *"The claims this piece rests on, quoted from
  it: pick some to check against the web"*. Reception's stays *"What others say about this piece:
  replies, reviews, and work that cites it"*, which leads with Greg's frame for the mode.

### Stage 2 — the DOI

- **At import, an agreed arXiv record puts its DOI on the article** when the article has none:
  `10.48550/arxiv.<id>`, which is the record's own `doi` field. The record has already passed the
  title-and-author test, so this is a registry-agreed DOI like any other. (The Metadata page does
  not draw a DOI today, so nothing on screen changes there.) It is what covers an arXiv paper
  uploaded as a PDF, whose id is found in the document rather than in its address.
- **`citersOf` falls back to the arXiv id in the article's own address** when it has no usable DOI, so the
  articles imported before this change (the one in the report included) get *Cited by* without a
  production write. **Only an arXiv address** (Sol's F4): a `doi.org` address gets its DOI at
  import, and widening the fallback widens what the tests must hold. `ArticleIdentity` gains `url`; the fallback goes through `parseWorkId`, and the
  OpenAlex answer still has to pass the same title-and-author check, so an address that names
  somebody else's paper lists nothing.
- The old articles still lack `meta.doi` itself until `src/backfill-registry-facts.ts` runs against
  production, which is a write to production and is left to Greg. Nothing a reader sees needs it.

### Not built: the merge, entering a DOI by hand, and a title search

Greg's third report asks whether Reception and Claims should merge. Having read
[sources.md](../project/sources.md), [reception.md](../project/reception.md), q-fkq30v and
[261009b](../research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md),
the answer is not clear-cut, so it is a question file, not a restructure: they answer different
questions (who has written about the piece / is what it says right), cost very different amounts
(Reception is the dearest press in the app; the claims list is one cheap call and each check a
small search), and are pressed differently; but both are "the web on this piece", and Greg read
them as overlapping. The words in Stage 1 are the cheap half that is right whichever he picks.

Likewise "a way to input it" and "continue without the DOI" are new features with real costs (a
form and its validation; an OpenAlex title search, with more room for a wrong match), and once
arXiv papers find their DOI they matter only for papers with none. Asked in the same question
file.

## The simpler option passed over

Only rewording the two sentences. It would answer "what does this mean", but the DOI sentence
would still be wrong for nearly every arXiv paper, the commonest kind of paper here.

Simpler on the DOI half: the address fallback alone, with no import change (Sol's F5). It fixes
every arXiv import whose address is arxiv.org, old and new. Kept the import write as well because
an uploaded arXiv PDF has no arXiv address: its id is the stamp on page 1, and only the import sees
that.

## Done is

- `emptyGroupNote` picks among three sentences by `returnedSources` and `reportedRows`; a test
  per case, red first against today's two-way switch.
- An agreed arXiv record sets `meta.doi`; a test in `tests/article-registry*.test.ts`, red first.
- `citersOf` with no DOI and an arxiv.org address asks OpenAlex for `10.48550/arxiv.<id>`; with
  an address that is not arXiv, still `no-doi` and nothing asked. Tests red first.
- `npm test`, `npm run typecheck`, GPT Sol's plan review before building and code review before
  pushing.
- A question file for the merge and the no-DOI features; a note in `docs/user-feedback/`.

## GPT Sol's plan review

[261010n-plan-review-sol.md](261010n-plan-review-sol.md) (prompt:
[261010n-plan-review-prompt.md](261010n-plan-review-prompt.md)), `gpt-5.6-sol`, high, exit 0.
Verdict: blocked on F1 and F2, both false sentences to the reader; the DOI write and fallback sound
once narrowed. All six taken:

| | Finding | Taken as |
|---|---|---|
| F1 | `reportedRows === 0` proves the answer held no candidate, not that the AI read or judged every page; `reportedRows` counts rows, not pages | *"put none forward"* and *"N possible responses"*; the checks named as *mainly* the quotation one |
| F2 | "we looked on the page, PDF, address and registries" is not recorded per article and is false for some | the no-DOI sentence says what a DOI is and that we have none; Google Scholar under it is the next step |
| F3 | not every arXiv import lacks a DOI; Metadata does not draw a DOI | the account narrowed; "Metadata shows it" removed |
| F4 | the fallback took any address `parseWorkId` knows | arXiv addresses only; a `doi.org` address is tested to stay `no-doi` |
| F5 | reception.md, 261004h, the `no-doi` and `loadArticleIdentity` comments | all updated; a pointer at the top of 261004h, its history untouched |
| F6 | "in its own words" clashes with the claims' *In the AI's words* line | Claims' card: *"The claims this piece rests on, quoted from it: pick some to check against the web"*. Reception's card kept: it leads with Greg's frame (sources.md § The band) |

`loadArticleIdentity`'s new `url` is held by the compiler rather than a database test: the
`article` projection's row type has no `finalUrl` unless it selects it.

## GPT Sol's code review

[261010n-code-review-sol.md](261010n-code-review-sol.md) (prompt:
[261010n-code-review-prompt.md](261010n-code-review-prompt.md)), `gpt-5.6-sol`, high,
workspace-write, exit 0. Verdict: LAND AFTER FIXES; Sol fixed three in place, and I read its diff:

- **C1 (P2)**: a stored `doi` that is not a DOI hid the arXiv address under it. Only a usable DOI
  now takes precedence; a test that failed before.
- **C2 (P2)**: the question, the note and this plan still said "we looked" or that the AI read and
  judged every page. Corrected; the no-DOI sentence now reads *"…a standard identifier used for
  research papers. Many web pages and blog posts do not have one."*
- **C3 (P3)**: singular and plural pinned by tests.
- **C4**: `origin/dev` moved during the review; merged again before the push.

Gates after: the eight touched suites (362 passed), `npm run typecheck`. The full suite before the
review: one failure, the command-bar catalogue that carries the Claims card's words, regenerated.

## Log

- 2026-10-10: plan written. A read-only production query to see which case Greg's 12 pages were
  was refused by the session's permission classifier, so the plan does not depend on it: both
  cases get their own sentence.
