# Cited by confirms a DOI when the evidence is clear: arXiv's own record, the last author, and names with footnote marks

Report `spya-ufn2xj` (#715), Greg (admin), 2026-10-26, on Sources for
`arxiv-2308-08708-spya-xax6v4` (Butlin et al., *Consciousness in Artificial Intelligence*):

> "We could not confirm that the DOI on record is this piece's own, so we have not listed who cites it."
>
> Why is this so hard to do? It feels like we should be able to figure out if the DOI is correct, no?

Builds on plan 261025h and investigation 261025a, which added the arXiv-address exception for this
very paper. No model call anywhere: the OpenRouter key is spent until 1 Nov, and none is needed.

## Why it refused, for this article

- **The DOI** is not stored on the article (`doi` is null). It is `10.48550/arxiv.2308.08708`,
  derived from the article's own address, `https://arxiv.org/html/2308.08708` (`citersIdOf`).
- **The article's own facts are broken.** Production's only revision is from 2026-10-17, before
  the arXiv-title fix (261017a, deployed 10-18): title `1Indicator Properties`, no byline, no
  authors, no year. Re-importing it on `dev` today gets the right title and all 19 authors
  (note 261023_2327); that is a production write and is not done here.
- **OpenAlex's record** (W4386113651) has the right 19 authors and 196 real citers, but a merged
  Zenodo deposit's title (*Cheap Correlate or Discriminating Property? …*).
- **What `isThisArticle` compares**: the whole title (token-for-token, `registryIsThisArticle`)
  **and** one author (`registryAuthorIsOurs`); or, for the arXiv DOI named by the article's own
  address, two structured authors (`twoStructuredAuthorsAgree`). Our title is wrong and we have no
  authors, so neither route can pass. The check is doing its job on the evidence it is given; the
  evidence is the article's stale metadata.

## How often it refuses a DOI that is right — the measurement

`isThisArticle` run against live OpenAlex records for every article with a DOI or an arXiv
address (script and results in § Evidence).

**Production, 28 articles: 21 confirm, 7 refuse — and all 7 are the piece's own DOI.**

| article | why it refused |
|---|---|
| 2308.08708 Consciousness in AI | our title/authors stale (above) |
| 2607.22753 Real-time Reconstruction … fMRI | title matches; we have no authors at all |
| 2212.09196 Emergent Analogical Reasoning | byline `Taylor Webb1,*, Keith J. Holyoak1 , …`: footnote digits glued to names (`webb1`) |
| 2508.05776 Whither symbols … | byline `Thomas L. Griffiths1∗, …`: the same |
| 2608.13566 Don't Claim Benchmark-Oriented … | our `—` vs OpenAlex's `--`: `registryIsThisArticle` keeps `-` as an operator, so the token counts differ |
| s41597-021-01033-3 Narratives fMRI dataset | byline `Hasson, Uri`, the **25th** of 25 authors; we keep OpenAlex's first 20 |
| s41593-022-01026-4 Shared computational principles | `Hasson, Uri`, 32nd of 32: the same |

**Local, 33 articles: 30 confirm, 2 not indexed, 1 refuses — correctly.** OpenAlex resolves
BERT's arXiv DOI, `10.48550/arxiv.1810.04805`, to an unrelated 2025 paper (*AI-Assisted Pipeline
for Dynamic Generation of Trustworthy Health Supplement Content at Scale*, Kefallinos et al.). This
is the control: **"trust the arXiv address alone" would hand BERT a stranger's citers**, so the
address cannot be the whole evidence.

## The fix — three parts, all in the check's inputs, none in its bar

1. **arXiv's own record stands in for stale facts.** When the article's own title and authors do
   not confirm the record, and the DOI asked is the arXiv DOI named by the article's own arxiv.org
   address, ask arXiv's registry record for that id — DataCite, through the existing
   `lookupWork(arxiv:<id>)` (src/bibliographic.ts: a found record cached 180 days in Postgres, the
   shared polite limiter, free) — and run **the same `isThisArticle`** with that record's title and structured
   authors as the identity. The question becomes "is OpenAlex's record for arXiv DOI X the same
   work as arXiv's own record for X", which is exactly the right question. The bar does not move:
   title + one author, or the bounded structured-author lists agree as specified below.
   - 2308.08708: DataCite and OpenAlex have the same bounded author list → confirmed.
   - The other four arXiv refusals: DataCite's title and authors match → confirmed.
   - BERT: DataCite says *BERT: …* by Devlin, Chang, Lee, Toutanova; OpenAlex's record shares
     neither title nor any author → still refused.
   - Asked only on the failure path, so a piece that already confirms costs nothing more. A
     DataCite miss leaves the answer `unconfirmed`; an outage is `unavailable`, so the reader can
     try again and no stale list is served without confirmed identity.
   - Not for any DOI the article merely carries (a page's `citation_doi`, which can be a cited
     work's), nor an arXiv DOI the address does not name: those keep the article's own facts only.
2. **Keep the last author.** A target's authors are capped at 20 by the CHECK
   `citation_index_lookups_shape`; keep the first 19 and the last, instead of the first 20, for a
   DOI's target and a title search's alike (citer rows unchanged). The last author is
   conventionally the senior one and is often who a page's byline names. No migration.
3. **Footnote marks and arXiv's `--` are punctuation.** On the article's side only, digits glued
   straight after a letter are dropped from a name (`Webb1` → `Webb`; a registry's `Working Group
   1` keeps its number), and `registryIsThisArticle` reads a whitespace-surrounded `--` as the
   dash it stands for (Unicode dashes already were). A single hyphen, spaced or not, stays an
   operator. Both are shared with the import's Crossref check, which gains the same correctness.

**With the title disagreeing, the author lists must be the same list** (Sol's P1, below): at
least two matched one to one, and at least four in five of the longer list, both cut to the same
first-19-and-last. Duplicate spellings of one person are removed before the article/registry list
is cut, so repeats near the front cannot hide later authors and lower the four-in-five bar. This
replaces 261025a's bare "two authors" for the article's own authors too,
so there is one rule; a page whose own author list is partial falls through to arXiv's full one.
**A registry that cannot be reached is `unavailable`**, with its Try again, never `unconfirmed`.
**arXiv's record is read once per request**, however many times a record is checked.

**Measured after** (2026-10-27, the real path, `confirmedWorkOf`, OpenAlex and DataCite live):

| | before | after |
|---|---|---|
| production, 28 with a DOI or arXiv address | 21 confirm, 7 refuse | **28 confirm** |
| local, 33 | 30 confirm, 2 not indexed (toy DOIs), 1 refuses | unchanged: BERT still refused |

**Would any wrong one confirm?** Every production pair whose OpenAlex title differs from ours was
read by hand. Two: 2308.08708 (this report: the right authors, the Zenodo title) and 2609.16247,
*The Pain Axis* against OpenAlex's *Left Alone with a Pain Button*, the same three authors —
confirmed **before** this change too, by 261025a's two-author exception, and DataCite's title is
ours, so it reads as arXiv retitling between versions. The 21 that confirmed before still do. The
one known wrong record (BERT) is refused.

## What it keeps refusing

- A cited work's DOI on the page: its title is not the piece's, and the arXiv fallback does not
  apply to a non-arXiv-address DOI.
- An arXiv DOI OpenAlex has attached to a different work (BERT).
- A later page by the same authors carrying their earlier arXiv DOI: the address must name it.

## Simpler options passed over

- **Trust the arXiv address alone.** No extra request, but BERT shows it would list a stranger's
  citers.
- **Re-extract this article.** Fixes one article, needs a production write, and leaves the other
  six and every future stale import. Worth doing separately; offered to Greg in the note.
- **Loosen the title rule** (a prefix or fuzzy match). Moves the bar for every DOI, including a
  cited work's that shares words; none of the seven needed it.
- **Widen the author cap to all authors.** Needs a migration of the CHECK and bigger rows; first-19
  + last covers the measured cases.

## Stages

One stage. `src/citation-index.ts` (a `confirms` step used by `askWork`, the cache-hit and stale
paths via `answerFor`, and `confirmedWorkOf`; `lookupWork` as an injectable dep), the target's
author cap; `src/article-registry.ts` (two normalisations); tests in
`tests/citation-index.test.ts` and `tests/article-registry.test.ts`, each red first; the header
comments of both files and of `src/situate-citers.ts`; `docs/project/sources.md` if it states the
rule. Then the after-measurement, Sol's code review, gates, push.

## GPT Sol's plan review

[261027c-plan-review-sol.md](261027c-plan-review-sol.md) (exit 0, answer arrived). It kept the
design ("DataCite is the right independent identity source and is simpler than weakening title
matching") and found four P1s, all taken, each with a test that was red against the first version:

- **P1, the same team's other paper**: with the title disagreeing, two shared authors admitted it.
  Now the lists must agree (above).
- **P1, a spaced ` - ` is a minus sign**: only a spaced `--` is normalised.
- **P1, digits are part of some names** (organisational creators): only digits glued to a letter,
  only on the article's side.
- **P1, an outage is not a disagreement**: tri-state, `unavailable` propagated.
- **P2s, taken**: the lookup memoised per request; a title search's target uses the same author
  selection.
- **P3s, corrected**: the cache is 180 days for a found record; the CHECK is
  `citation_index_lookups_shape`.
- **Noted**: `parseWorkId` also reads Hugging Face and alphaXiv paper pages as arXiv ids. Those
  pages are the arXiv paper too, and ingest canonicalises them to arxiv.org, so no change.

## GPT Sol's code review

[261027c-code-review-sol.md](261027c-code-review-sol.md) (exit 0, answer arrived). No P1. Fixed in
place, and read: deduplicate an author list before the 20-name cut (repeated spellings could hide
later people and lower the four-in-five denominator); exactly `--`, not `---`; `targetAuthorsOf`
keeps at most 20 names while walking a list of thousands; tests that pin every confirmation path
(fresh, just written, stale, topic, Situate). Sol checked that 13 new test cases fail against the
code before this change. Gates re-run here afterwards, and the after-measurement re-run on the
final code: the same 28/28 and BERT refused.

## Evidence

- Measurement script: `measure.ts` (scratch; reads `articles` ⋈ `article_revisions` inside
  `begin read only`, asks OpenAlex `works/doi:` politely, runs the exported `isThisArticle`).
  Its outputs are summarised in the tables above.
- DataCite records checked by hand for the five arXiv refusals and BERT.
