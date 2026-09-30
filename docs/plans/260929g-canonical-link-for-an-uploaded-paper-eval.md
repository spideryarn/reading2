# 260929g — the real-page eval of the guessed source link

The eval that [260929g-canonical-link-for-an-uploaded-paper.md](260929g-canonical-link-for-an-uploaded-paper.md)
§ Stages 2 calls for. It decides whether the judge's **content branch** (the opening prose's 4-word
shingles agree with the candidate's text) ships. Run 2026-09-29 against the local database.

**Verdict: ship the content branch.** It produced no wrong link, and every one of the three links
shown needed it — the identifier branch alone would have shown none.

## How it was run

`npx tsx scripts/eval-source-guess.ts` (the header says what it measures). For each uploaded PDF in
the local database, distinct by title, it runs the route's own path — `identityOf` →
`findWorkPage` under job `upload-source-guess` → `readPaperText` → `isSamePaper` — for real, with a
paid web search each. It writes no `upload_source_guesses` row and takes no allowance. It then runs
the judge a second time with the identity's shingles emptied, which is what the identifier branch
alone would decide. Exit code 0.

**The sample is 7, not 8–10**: the local database has 14 uploaded PDFs, and only 7 distinct titles.
None was skipped for a missing identity.

## Results

| # | Upload | Authors / DOIs / arXiv in identity | Search kept | Read | Verdict, full | Identifier only | Link shown |
|---|---|---|---|---|---|---|---|
| 1 | Distributed Representations: Composition & Superposition | no / – / – | transformer-circuits.pub/2023/superposition-composition | ok, HTML | same (content) | no (no-agreement) | transformer-circuits.pub/2023/superposition-composition |
| 2 | Revealing the Dynamics of Neural Information Processing with Multivariate Information Decomposition | yes / 10.3390/e24070930 / – | mdpi.com/1099-4300/24/7/930 | refused (403) | – | – | none |
| 3 | Analog Cognition and Consciousness | no / – / – | osf.io/preprints/psyarxiv/z48x7_v1 | no readable text | – | – | none |
| 4 | Stage E, and what a one page paper is for | no / – / – (0 shingles) | none (title-mismatch, 5 results) | – | – | – | none |
| 5 | A landscape of consciousness: Toward a taxonomy of explanations and implications | no / 10.1016/j.pbiomolbio.2023.12.003 / – | sciencedirect.com/…/pii/S0079610723001128 | refused (403) | – | – | none |
| 6 | A brief history of ball lightning observations by scientists and trained professionals | no / 10.5194/hgss-12-43-2021 / – | hgss.copernicus.org/articles/12/43/2021/… | ok, PDF via `citation_pdf_url` | same (doi) | no (no-agreement) | https://doi.org/10.5194/hgss-12-43-2021 |
| 7 | Forms of Memory in Post-colonial Australia | no / – / – | revistes.ub.edu/index.php/coolabah/article/view/15725 | ok, PDF | same (content) | no (no-agreement) | revistes.ub.edu/index.php/coolabah/article/view/15725 |

One billed search per paper, 7 in all.

## The human check, per paper

1. **Right.** The page is Chris Olah, *Distributed Representations: Composition & Superposition*,
   Transformer Circuits, 4 May 2023; it opens with the same sentences as the upload. There is no
   DOI or arXiv id to find, so only the content branch could ever link this one.
2. **Missed, and the page found was right.** Entropy 24(7) 930, DOI 10.3390/e24070930, which is in
   the upload's own first pages. MDPI answered our fetch with 403, so there was nothing to judge.
3. **Missed, probably right, unverified.** OSF preprint pages are rendered by JavaScript; neither
   `readPaperText` nor a manual fetch got any text from it.
4. **Correctly nothing.** A one-page note with no body prose (0 shingles); the search found nothing
   carrying the title. There is no public page to find.
5. **Missed, and the page found was right.** ScienceDirect's PII S0079610723001128 is Kuhn's
   paper, DOI 10.1016/j.pbiomolbio.2023.12.003, which is in the upload's first pages. ScienceDirect
   answered 403.
6. **Right.** doi.org resolves to hgss.copernicus.org/articles/12/43/2021/, Keul et al., HGSS 2021.
   Matched by DOI, but only allowed because the content also agreed: the upload has no authors, so
   the authorless rule demands content agreement.
7. **Right.** Lyn McCredden, *Forms of Memory in Post-colonial Australia*, Coolabah no. 3 (2009),
   the journal's own article page. The read PDF's meta author is McCredden.

## Totals

| Found | Right | Wrong | Missed (a right page existed) | Correctly none |
|---|---|---|---|---|
| 3 | 3 | **0** | 3 (#2, #5 bot-walled; #3 JS-only page) | 1 |

**Cost: $0.152** for 7 calls and 7 billed searches, about 2.2 cents a paper, in line with the
plan's "a few cents".

**The identifier branch alone found 0 of the 3.** No rule refused a readable right page: every miss
was a page `readPaperText` could not read, so it never reached the judge. The strict
identifier-conflict rule, the title rule and the missing sideways arXiv stamp cost nothing here
(there was no arXiv paper in the sample).

## Recommendation

**Ship the content branch.** The plan's condition holds: no wrong link, and it found links the
identifier branch missed — all three of them. The finding behind that matters more than the
branch: **6 of the 7 uploads have no authors in `meta.authors`**, so under the authorless rule
(Sol round 2, F1) the content branch is the only way *any* upload gets a link. Cutting it would
cut the feature.

Caveats: 7 papers is a small sample, the local corpus has no arXiv paper, and none of the three
right links was a near-miss the judge had to reject — the eval shows the branch finds right pages,
not how it behaves against a same-titled wrong one. The unit tests carry that case.

## Two misses that could be fixed safely (not implemented)

**Two of the three misses are publisher bot walls where the upload already prints its DOI**
(#2 MDPI, #5 ScienceDirect). A fix that stays inside the safety property:

- When the candidate is unreadable (`refused` / `paywall-or-empty`) **and** the upload's
  first-pages identifiers hold a DOI, ask doi.org for that DOI's registered metadata by content
  negotiation (`Accept: application/vnd.citationstyles.csl+json` — free, no key, no new
  dependency beyond a fetch).
- Show `https://doi.org/<doi>` as `canonical` only if the registered title passes the same exact
  title rule (`wordsOf`, both ways, same order) **and** the DOI appears on page 1 of the upload's
  pass-0 text (front matter), not only on page 2 where a reference list may start.

What it gives up, honestly: this is title + identifier with no author and no content check, which
is the combination Sol F1 refused for an authorless upload — a cited work with an identical title
whose DOI sits on the first page. The page-1 condition makes that rarer, not impossible. It is
also the "Crossref or another bibliographic API" that the plan deferred. So it is Greg's call, not
a bug fix. A cheaper and fully safe improvement is upstream: **extracting authors for PDF uploads**
would let the author rule do its job and make the identifier branch usable on its own.

The OSF miss (#3) needs a JavaScript-rendered page read, and is not worth a rule.
