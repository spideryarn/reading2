# Debate leads with who has cited this article, for and against

Up: [debate.md](../project/debate.md)

**Status:** stage 1 (the search for responses also looks for the papers that cite this one) is
built here. Stage 2 (a citation index, which would list every citer) needs a new outside service
and is **awaiting Greg** — § The question for Greg.

## What Greg asked for

> I find the debate mode a little bit strange. I think I was hoping it would emphasize more people
> that have cited this article. So it might be one of those things that's not very helpful, that's
> sort of more helpful for older and more famous articles. But that's what I'm really interested in.
>
> Has anyone cited this article either supporting or criticizing? I think it's helpful that debate
> mode also includes stuff like, oh, you know, are the claims corroborated? but I'd say that's
> secondary.
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-9D, report `spya-zuk4f7`), reading Melnikoff & Bargh
> 2018, *The Mythical Number Two*

## Why the panel's order is not the problem

Debate runs two web searches:

```
pass A  "who responds to this piece"   → rows About this piece
pass B  "what is said about its claims" → rows under each claim (corroboration)
```

The default order (*prioritised*) already draws pass A's rows first, and so does *by claim*. So
reordering changes nothing. On a paper like Greg's, pass A comes back thin, and the claims rows,
the corroboration Greg calls secondary, fill the panel.

Pass A is thin for three reasons. The first two were found by replaying what the model actually
said (§ Measured): **on the old prompt it often found exactly the right replies, and our checks
then threw them away.**

1. **We checked its quotes against only the first extract of each page.** The search often returns
   one page several times with a different extract each time, and the model reads them all; the
   shared collector kept the first (`collectSearchEvidence`, first sighting wins). Over 48 recorded
   Debate runs, 33 of the 76 quotations missing from a page's first extract were in a later one.
   Ioannidis's published reply to his critics was refused this way: the "Citation: …" line giving
   the title was in its second extract. A bug, not a prompt problem —
   [261002g postmortem](../postmortems/261002g-debate-refused-quotes-from-a-later-extract-of-the-same-page.md).
2. **The model's quotes failed the checks in ways it could avoid.** Its "this names the article"
   quote was often "the article published by Ioannidis [1]", without the title, on a page whose own
   headline carried it. And it tidied an extract's flaws while copying — a PDF's split word
   ("argu ing"), a stray space — so a correct quotation could not be found.
3. **A web search sees an extract, not the whole citing paper**, and is told to look for
   "replies", not for work that cites the piece. A citing paper names its sources in its reference
   list, which may or may not be in the extract the search engine chose.

Stage 1 fixes the first two and helps with the third. Only a citation index fixes the third.

## Stage 1 — pass A looks for the citers too, and stops losing them (built, no new service)

Same search provider, same inputs (title, byline, site, address), same caps, and every check in
code exactly as strict. Two changes.

**Every extract of a page is checked, not just the first.** `collectSearchEvidence` takes
`extracts: "all"`: a page's later, distinct extracts are joined to its first, in arrival order,
under the same 8,000-character cap, with a separator a quotation cannot run across (the matchers
collapse whitespace, so blank lines alone would let a quote stitch two extracts together, and a
test proves it). Opt-in: chat, explain, Citations and Dig deeper keep first-sighting-wins, which
matters for a streaming caller that checks a row before the rest has arrived. Debate checks once
the answer is complete, so it asks for all of them, both passes.

**Pass A's instructions** (`DIRECT_SYSTEM`, and one paragraph of the shared `QUOTING`):

- **What counts** widens from "responds to" to "**cites and says something about it**":
  scholarly papers, preprints, theses and book chapters that build on it, test it, dispute it or
  qualify it, as well as replies, reviews and commentary. A paper that cites it only in a list,
  saying nothing about it, is still left out — there is nothing to quote and nothing for or
  against.
- **How to search** — named, because a model left alone searches the topic: the exact title in
  quotes; the authors' surnames with the year; "reply to", "comment on", "response to" with the
  title. Still "a handful of searches, then stop" (`RESTRAINT`, unchanged; Stage 0b's cost finding).
- **The witness must contain the title or the address in full**, said outright, with where to
  find one in what it was shown: a headline that repeats the title, a sentence citing it in full,
  a reference-list entry. If there is none in the extract, leave the page out. `sourceQuote` is a
  different passage: what the page makes of the article.
- **Copy an extract's own flaws** (both passes): a split word, a stray space, `*` marks. A tidied
  quotation is one we cannot find.
- **Prefer** published work, named authors and established venues, and the responses that take a
  position over ones that only mention it.

Nothing is relaxed in code. In particular a bare "Melnikoff and Bargh (2018)" without the title or
address still does not identify the article: the same authors may have several papers that year,
and the identification rule is the one thing standing between this group and the topic-shaped
fabrication Stage 0 found.

`PROMPT_VERSION` goes to `debate/5`. Stored debates are not invalidated (staleness is on the
article's input, not the prompt), so a reader sees the change on the next search, or "Search
again".

### Measured

On the box, `npm run eval:debate -- run` (production's own `generateDebate`, journalled), three
runs of the old prompt and three of the new on each of two papers, twelve paid runs, $2.52 in all:

- Ioannidis 2005, *Why Most Published Research Findings Are False* (PLOS Medicine): open access,
  heavily cited, with published critiques (Goodman & Greenland 2007) and the author's reply. It
  stands in for Greg's paper, which has no open copy to import.
- Jain & Wallace 2019, *Attention is not Explanation* (arXiv; the abstract page only, which is all
  pass A needs): a published reply, *Attention is not not Explanation*, and blog posts by both
  sides.

Each run's journal was then replayed through production's readers, with and without the extract
fix. Since the replay re-reads the same recorded answers, the fix's effect is measured on
identical model output; the prompt's effect is across separate samples, so three runs per arm is
the control. Rows kept about the piece, of those the model reported:

| | Before the extract fix | With it |
|---|---|---|
| Old prompt (22 reported over 6 runs) | 4 (Ioannidis 0, 2, 1; Attention 0, 0, 1) | 7 |
| New prompt (19 reported over 6 runs) | 7 (2, 0, 1; 2, 1, 1) | **10** (2, 2, 1; 3, 1, 1) |

The kept rows are the ones a reader would want: Goodman & Greenland's critique (their published
letter, and their longer working paper), Ioannidis's reply to it; the ACL Anthology paper
*Attention is not not Explanation*, its authors' post, Wallace's answer to it, and a post of
clarifications on the original paper. Searches per run (2–5) and
cost (about $0.20) did not move. Claims rows were unchanged or slightly up (the fix applies to
pass B too). The prompt's effect on its own is modest — flat on Ioannidis, 1 → 4 on Attention —
and three runs per arm cannot separate it from noise on Ioannidis; the extract fix's effect is
not noise, because it is measured on the same answers.

**What stage 1 does not do:** list the hundreds of papers that cite a famous article. A web
search surfaces the handful of direct exchanges, and that is what this now keeps. The rest is
stage 2.

Also found, not fixed (outside this change): the eval's cost line still expects two search calls
per run and reports `not measured`, exit 1, for every completed run since `debate/4` added the
search-free themes call (`evals/debate/run.ts`).

## Stage 2 — a citation index (awaiting Greg)

The thing that knows who cited a paper is a citation index. Measured 2026-10-02 on Greg's article
(DOI `10.1016/j.tics.2018.02.001`):

| Service | Citing works | What it says about each | Terms |
|---|---|---|---|
| OpenAlex | 389 (its count) | title, authors, year, venue; no citing sentence | CC0. A free key and a daily budget are the normal route for production; anonymous access has a smaller budget |
| Semantic Scholar | 334 records, 332 distinct works | the same, plus **the sentence in which the citing paper cites this one** for 138 of them, and a coarse intent | **The standard licence is for non-commercial research only.** A paid product needs their expanded licence, by request; public display needs a link back with `utm_source=api`, plus their name and logo; access is at will |
| Crossref (already used) | count only | no list for non-members | — |

Semantic Scholar's list includes the two papers a reader of this article most needs, both in the
same journal that year: *The Mythical Dual-Process Typology* (Pennycook, De Neys, Evans, Stanovich
and Thompson's critique) and *The Insidious Number Two* (Melnikoff and Bargh's answer). The second
has **no** citing sentence on record, so a v1 that read only sentences would bury it.

### The question for Greg

Stage 1 is on dev whatever you decide. This is only about listing citers from an index. **Should
Debate also send an article's DOI to a citation index, and which?** What is sent: the article's
DOI, from our server, never its text or who is reading. For a private upload that tells the
service someone looked the paper up, as Citations already does with Crossref for the papers an
article cites. [privacy.md](../project/privacy.md) would name the service.

1. **OpenAlex — recommended now.** Licence-compatible today (CC0), stable, the larger list. It
   gives the **list and count of who cited it**, with titles, authors, years and venues, but not
   what each said, so for/against would be shown only where pass A or the citing sentence gives
   checked words. The rest are listed honestly as "cites this; stance not read". Costs: a free
   key (one more secret) and a daily budget to stay inside.
2. **Ask AI2 for Semantic Scholar's expanded licence first**, then come back with its price and
   conditions. It is the only source of the citing sentence, which is what would make "for or
   against" checkable across hundreds of citers, rather than across the handful pass A finds.
3. **Both, later**: OpenAlex for the list, Semantic Scholar for sentences if the licence comes
   through.
4. **Neither**: stage 1 is what Debate does.

Pick 2 over 1 if a stance on every citer matters more than having a list soon; pick 1 if a list of
who cited it, most-cited first, is already most of what you wanted.

### What a stage-2 v1 must get right (from GPT Sol's plan review, findings 5–8)

- **The identifier is verified before it is trusted.** `meta.doi` is checked only for shape, and
  a mistyped DOI resolves perfectly to another paper. Fetch the target record, require title
  agreement, refuse two identifiers that disagree, and put the chosen identifier in Debate's
  fingerprint.
- **Duplicates are merged** (two of Semantic Scholar's 334 records are the same DOI twice).
- **A truncated list says so** ("at least 1,000"), and a failed page fails the whole list rather
  than storing a partial count.
- **One labelled answer per citer, by id**; missing, duplicated or unknown ids are refused and
  counted; titles, authors and links come from the index, never from the model; stance reuses
  `relation` and `lean` unchanged.
- **A reply with no sentence on record is still shown**, as "cites this; stance not read" — never
  a stance guessed from its title.

## Deferred, named

- Stage 2, above, and with it: a title search when there is no DOI; reading the citing paper
  itself (Citations' Dig deeper) for a citer with no sentence; themes across the citers; a
  visitor's view of the citers on a public article.
- **The same first-extract refusal in Citations' finder** (`src/citation-find.ts:395`: a find is
  refused as `title-mismatch` unless the title is in the result's title or its *first* extract).
  Another stage, smaller exposure, not measured; queued, not built here (postmortem 261002g §
  Other callers).
- **The 8,000-character cap now covers a page's joined extracts**, so a quote in a late extract of
  a page with several long ones is still refused (counted, the safe direction). Keeping the
  extracts as a list and matching each would close it; not done because the cap was not seen to
  bite in the measured runs.
- Accepting author-and-year ("Melnikoff and Bargh (2018)") as identification without the title.
  It would find more, and would sometimes attach a different paper by the same authors. Not
  without a check that can tell the difference, which is the identifier stage 2 brings.

## Simpler options passed over

- **Reorder the panel only.** Pass A's rows already lead.
- **Crossref's count only** ("389 works cite this"). It answers "how many", not "who, and for or
  against".

## Reviews

- Plan, GPT Sol, read-only: [prompt](261002i-debate-who-cited-this-plan-review-prompt.md),
  [answer](261002i-debate-who-cited-this-plan-review-sol.md). It rejected the first draft's
  conclusion (build nothing, await Greg) in favour of stage 1, and found that Semantic Scholar's
  standard licence excludes commercial use. Both accepted, the licence checked on its page.
- Code, GPT Sol, workspace-write: [prompt](261002i-debate-who-cited-this-code-review-prompt.md),
  [diff it was given](261002i-debate-who-cited-this-code-review.diff),
  [answer](261002i-debate-who-cited-this-code-review-sol.md). It fixed two real faults in the join,
  each with a test it watched fail first: the copy check's word windows ran across the separator,
  so three short extracts copied from the article could escape `sourceIsCopy` (now windowed per
  extract, `src/shingles.ts`); and a later, wider extract was appended after the narrower one it
  contains, spending the cap on repeated text (now it replaces it). It re-derived the 48-journal
  figures and found no number in § Measured wrong. Approved.

## Evidence

2026-10-02, from the box: OpenAlex `works/doi:10.1016/j.tics.2018.02.001` → `cited_by_count: 389`;
Semantic Scholar `paper/DOI:…/citations?fields=…,contexts,intents` paged four times → 334 records
(332 distinct DOIs), 138 with a non-empty context. The licence read at
`api.semanticscholar.org/license/` the same day.

