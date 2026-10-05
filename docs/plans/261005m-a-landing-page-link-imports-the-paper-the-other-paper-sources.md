# A landing-page link imports the paper: the other paper sources

Status as of 2026-10-06: **plan, revised after GPT Sol's two reviews, nothing built** — evidence:
no source but arXiv in `src/paper-sources.ts`, which is itself not on `dev` yet (see § What this
waits on).

Report `spya-ayettj` (Sentry SPIDERYARN-READING2-DH), from Greg, 2026-10-05. This plan is **part 2
of 2**, queue entry `qi-5m89dnxa`. Part 1 is arXiv: plan
`261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md`
(not a link, because it is not on `dev` yet), queue entry `qi-jqtexyzq`.

## Goal

> If I include a link like this, the right move is to grab either the html or the pdf, rather than
> reading in this exact link. […]
>
> 2) and use web research to longlist and prioritise and optimise a lot of other common likely
> sources (like Arxiv) for other kinds of papers that we should create import optimisations for.
>
> — Greg, 2026-10-05, report spya-ayettj

**What happens today**, measured on 2026-10-05 through our own fetcher and extractor
([261005e](../research/261005e-where-a-reader-s-paper-link-points-the-other-sources-measured-and-ranked.md)):
a reader pastes the page a paper is *announced* on, and we import that page. An ACL Anthology link
imports as 339 words, a NeurIPS link as 198, a bioRxiv link as 452. Nothing fails, and the article
carries the paper's title.

**What should happen:** for the sources our readers are likeliest to paste, the link imports the
paper. For the rest, nothing changes, and the plan says which they are and why.

## What the research decided

The longlist (45 sources), what each imports as today, and the ranking are in 261005e. In short:

- **Ten sources are worth code**: the landing page is a stub, the paper's address can be built
  from the pasted address alone, and our fetcher got the paper.
- **Seven of them are built by this plan**, the ones AI readers paste: Hugging Face paper pages,
  alphaXiv, ACL Anthology, PMLR, NeurIPS proceedings, CVF Open Access and JMLR. GPT Sol's review cut
  the first draft's eleven to these (G8), and § Deferred says what each of the others waits on.
- **Thirteen publishers and preprint servers refuse us whichever address we ask for** (403, a
  challenge, a JavaScript shell). Nothing permitted helps, and they fail legibly today.
- **Four big open-access publishers need nothing**: their landing page is the paper.

## What this waits on

Part 1 builds the mechanism: `src/paper-sources.ts`, a list of sources, each a function from a
pasted address to the paper it names and the addresses to try for it; and the fetch step's loop
over those addresses (`fetchFirstCandidate` in `src/pipeline.ts`). As of 2026-10-05 23:30 that is
committed in part 1's worktree (`0f63486a2`) and **not on `dev`**: its code review came back *do not
ship* with three findings, none about the registry's shape or the fetch loop (F14 and F15 are in
`enqueue`; F16 is a slug longer than 60 characters).

This plan adds sources to that mechanism and does not build a second one. So:

- The plan and the research are reviewed now.
- **Nothing is built until part 1's stage 1 is on `dev`.** If it has not landed when the plan review
  is done, the build is re-queued and the note says so (§ Stage B).

## Design

### The shape part 1 gives us

```ts
interface PaperSource { name: string; resolve(url: URL): ResolvedPaper | null }
interface ResolvedPaper {
  source: string;          // "arxiv"
  versionedId: string;     // the id, with a version if the link carried one
  workId: string;          // the id, never a version
  canonicalUrl: string;    // the address the paper is known by
  key: string;             // what urlKey answers, so every shape of the link is one article
  slug: string;            // passes isSlug: [a-z0-9-], at most 60 characters
  candidates: readonly { url: string; expect: "html" | "pdf"; marker?: string }[];
}
```

The fetch step tries `candidates` in order through `fetchDocument`, unchanged. It moves to the next
candidate only when the far end says the document is not there (404 or 410) or sends the wrong kind
of document. Any other failure (a 403, a timeout, a 503) is the step's failure.

### The rules every source here follows

- **It matches an origin, not a hostname**: http or https, the named host exactly, no port, no
  credentials. (Part 1's rule.)
- **Every candidate address is a fixed string built from an id the pattern matched**, never text
  copied from the pasted address. Each id pattern is a closed character class, so nothing in the
  pasted address can reach a candidate except characters the pattern allows.
- **The landing page and the PDF's own address resolve to the same paper**, so a reader who pastes
  either gets one article.
- **The address the fetch ends on resolves to the same paper too** (Sol's G1). The article's
  address afterwards is where its bytes came from, and "do we already have this?" asks that
  address. A source whose PDF ends up somewhere its own pattern does not recognise would be
  imported, and paid for, again on every paste. This is a test for every source, and the live
  check asserts it on real fetches. It is what rules OSF out for now.
- **Every candidate is the paper. The landing page is never one** (Sol's G5). The first draft ended
  each list on the landing page, so that a PDF missing from where the rule expects it cost the
  reader nothing they have today. But the stub would then be stored under the paper's key, and a
  reader who pasted the PDF's own address to recover would be told they already have it. So a
  missing PDF fails, with the sentence a missing page gets today.
- **A long id gets a cut slug, not a refusal** (Sol's G4). The key keeps the whole id; the slug is
  cut to fit `isSlug`, as `slugFromUrl` cuts any long address. CVF's file names run to 90
  characters.

### The arXiv mirrors are arXiv

`huggingface.co/papers/<arxiv id>` and `alphaxiv.org/abs/<arxiv id>` (with or without `www.`) are
pages *about* an arXiv paper, with the arXiv id as their path. They are not new sources: they are
two more shapes of address that the arXiv source recognises, beside `abs/`, `pdf/` and arXiv's DOI.
So they resolve to exactly what `arxiv.org/abs/<id>` resolves to, they are the same article as the
arXiv link, and they get arXiv's HTML when part 1 turns that on.

**Three other places ask "is this an arXiv paper?", each with its own parser today** (Sol's G7,
then G11, which showed the first fix was a sentence and not a trace): `identityOf` in
`src/cited-in-spideryarn.ts` (an article we hold), `keysOf` in `src/citations.ts` (a work an
article cites) and `arxivPdfUrl` in `src/paper-text.ts` (which address to read a cited paper
from). At part 1's commit none of them calls the registry's `arxivIdOf`. This stage points all
three at it, so a citation to a Hugging Face page gets the arXiv work's key, matches the arXiv
article we hold, and is read from arXiv's PDF. The test is end to end: `matchOf` with a work whose
address is the Hugging Face page and a candidate whose address is the stored arXiv PDF.

What that gives up, deliberately: a Hugging Face or alphaXiv link in an article's prose is treated
as the arXiv paper everywhere, so its hover card shows the paper and not the mirror page's own
commentary.

alphaXiv's `/overview/<id>` is recognised too: probed on 2026-10-05, it redirects to `/abs/<id>`.

### Five sources, each one object in the list

| Source (`name`) | Recognises | Candidates, in order |
|---|---|---|
| `acl` | `aclanthology.org/<id>/`, `<id>.pdf`; `doi.org/10.18653/v1/<id>` | `https://aclanthology.org/<id>.pdf` |
| `pmlr` | `proceedings.mlr.press/v<N>/<name>.html`, `/v<N>/<name>.pdf`, `/v<N>/<name>/<name>.pdf` | `/v<N>/<name>/<name>.pdf`, then `/v<N>/<name>.pdf` |
| `neurips` | `proceedings.neurips.cc` and `papers.nips.cc`: `/paper[_files/paper]/<year>/hash/<hash>-Abstract[-<track>].html`, `/file/<hash>-Paper[-<track>].pdf` | `https://proceedings.neurips.cc/paper_files/paper/<year>/file/<hash>-Paper[-<track>].pdf`, the track exactly as the link carried it |
| `cvf` | `openaccess.thecvf.com/<collection>/html/<name>.html`, `/<collection>/papers/<name>.pdf` | `/<collection>/papers/<name>.pdf` |
| `jmlr` | `jmlr.org/papers/v<N>/<name>.html`, `/papers/volume<N>/<name>/<name>.pdf` | `/papers/volume<N>/<name>/<name>.pdf` |

NeurIPS's file name ends differently by year and track (`-Paper.pdf`, `-Paper-Conference.pdf`, and
others). The first draft guessed a list of endings. This one guesses nothing: the abstract page's
own address carries the same ending (`-Abstract-Conference.html`), so the PDF's is read off it.
Probed on 2026-10-05: 2023 has `-Conference` (3,218 papers) and `-Datasets_and_Benchmarks` (322),
2021 has none; the PDF of each answered 200, and the wrong ending answered 404.

**What a wrong rule costs.** These grammars were learned from a few papers per site. Where a
paper's PDF is not where the rule says, the import fails, where today it imports the abstract page.
That is a change a reader can meet. It is the right way round: the report is about an abstract
page passing for the paper. Nothing is charged: the fetch is the first step, no model has run, and
a failed import releases its slot.

**The failure needs a sentence of its own** (Sol's G12). The sentence a missing page gets today
tells the reader to check the address for a slip, and their address is fine: what is missing is a
PDF address we derived and they never saw. So when a paper source's last candidate is absent, the
card says, under a new code `[fetch-paper-missing]`, blocked rather than retryable:

> We found the page for this paper, but not the paper itself where this site usually keeps it.
> Download the PDF from the site and upload it here.

**This is a new reader-facing sentence, written without Greg.** It is here so he can change it.

**And a line in the log** (Sol's G13). Today's log line is written only when the fetch succeeds. A
failed paper-source fetch logs the source's name, how many candidates were tried and the failure's
code, and no address, so a rule that keeps missing shows up as that source's name repeating.

Both are small changes around part 1's loop (what its caller does with a terminal failure), not to
which candidate it tries or when it moves on.

**What the fix costs the reader.** Every source here serves the paper as a PDF only. A PDF is read
by a model: around ten US cents and one to three minutes, against a landing page's free few
seconds. That is the cost of importing the paper rather than its announcement, and it is the same
cost as pasting the PDF's own address today.

### What is not touched

`src/fetch.ts`, the SSRF and address checks, the redirect and byte caps, which candidate the fetch
step tries and when it moves on, `enqueue`, `urlKey` and `slugFromUrl` (they already ask the registry), stage 2, and everything in
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live).
No new dependency, no key, no outside service, no login, no changed header.

## The options passed over

- **Follow the page's own `citation_pdf_url` tag wherever it appears**, instead of a rule per site.
  One mechanism instead of five objects, and it reaches the long tail. Passed over *for now*
  because it is a second mechanism beside part 1's, the address is the page's choice rather than
  ours, it cannot tell a stub from a full-text page that also names its PDF (PLOS, Nature and
  Frontiers all do, and following it there would swap a good free import for a paid one), and CVF's
  tag points at a retired host. § Deferred.
- **Only the arXiv mirrors.** The smallest useful slice, and it is the first thing built. Stopping
  there leaves ACL, NeurIPS, ICML and CVPR, which are where our readers' non-arXiv papers are.
- **End every list on the landing page**, so a missing PDF costs nothing. The first draft. Withdrawn
  for G5, above.
- **Look at where a redirect ended** (the first draft's design B): fetch a `doi.org` link or a
  shortener, and if the address it ends on is one a source recognises, fetch that paper. It makes
  a DOI link work for every source at once. **Deferred, because of what it does to charging**
  (Sol's G1): the article's address afterwards is the PDF's, the DOI link's key matches nothing on
  the shelf, and a second paste of the same DOI link imports and charges again. That is true of a
  `doi.org` link today, but today the second import is a free abstract page and afterwards it would
  be a paid PDF read. It needs the shelf lookup to know the address an article was *asked for* as
  well as the one it came from, which is a change to identity in `enqueue` and the store, where
  part 1 is still fixing P0s. **`article_revisions.requested_url` is not that address** (Sol's
  G14): for a paper source it holds the candidate we derived, because that is what `fetchDocument`
  was asked for. The job's own address has to be kept as well, which is a new column and so
  Greg's call. § Deferred.

## Stages

### Stage 0: research and measurement (done)

- [x] Web research: the longlist, address grammars, walls, robots files (raw notes beside 261005e).
- [x] `evals/paper-sources/landing-vs-paper.ts`: 174 fetch cases over 157 distinct addresses,
      through `fetchDocument` and stage 2.
- [x] Production host census, read-only, counts only.
- [x] 261005e written.
- [x] GPT Sol reviews this plan and 261005e's ranking (read-only). Round 1: *do not build*.

### Stage A: the arXiv mirrors and the five sources

Waits on part 1's stage 1 being on `dev`.

- [ ] Tests first, red, in `tests/paper-sources.test.ts`:
      - the two mirrors resolve to a value deep-equal to arXiv's for the same id, with and without
        a version; `huggingface.co/papers` alone, `huggingface.co/papers/<not an arXiv id>`,
        `huggingface.co/<user>/<model>` and `alphaxiv.org/` do not resolve;
      - `identityOf`, `keysOf` and `arxivPdfUrl` each give a Hugging Face and an alphaXiv address
        what they give the arXiv address, and `matchOf` matches a work cited by its Hugging Face
        page to a candidate stored under arXiv's PDF address; their existing tests stay green;
      - a paper source whose last candidate is absent fails with `[fetch-paper-missing]`, blocked,
        and logs the source and the count; an ordinary address that is absent fails exactly as
        today;
      - for each of the five: every recognised shape resolves to one key, one slug and the
        candidates in the table; **every candidate's own address resolves back to the same key**;
        near-misses resolve to `null` (a look-alike host, a port, credentials, an id with a
        character outside its class, a path with something after the id);
      - the 90-character CVF name from the measurement resolves, with a slug that passes `isSlug`
        and a key that holds the whole name; two CVF names that share their first 60 characters
        have different keys.
- [ ] A property test over all sources: for a spread of hostile inputs (`..`, `%2f`, `@`, `\`,
      a second `//`, upper case, a query, a fragment) a resolved paper's every candidate is
      `https:`, on that source's own host, and its path holds no character outside
      `[A-Za-z0-9._/-]`.
- [ ] Build it. Display names in `PAPER_SOURCE_LABEL`.
- [ ] Live check, free: `evals/paper-sources/resolve-live.ts` resolves each landing address and runs
      the step's own loop with the real `fetchDocument`. For every source: both papers measured in
      261005e end on a PDF, and **`urlKey` of the address the fetch ended on equals the paper's
      key**. New cases added for what the first measurement did not cover (Sol's G9): a NeurIPS
      paper of each ending found (`-Conference`, a Datasets and Benchmarks one), a PMLR paper of
      each layout over `https`, an old-style ACL id through its DOI, alphaXiv's `/overview/`. A
      shape that does not fetch is taken out of the pattern, not left in on trust. Output under
      `docs/plans/261005m-evidence/`.
- [ ] Mutate: loosen one id class, swap two hosts, drop the slug cut, make a mirror its own source;
      each must turn a test red.
- [ ] Docs: `fetching.md` (the sources table, beside part 1's section), `ingest-queue.md`,
      `/help` if it says what pasting a link does.
- [ ] `npm run typecheck`, the touched tests, `npm run lint` on touched files. GPT Sol code review
      (write-capable, fixes inside the stage). Commit, push.

### Stage B: bookkeeping

- [ ] The deferred items below each have a queue entry (ids recorded here) **before** the note says
      shipped.
- [ ] `docs/user-feedback/261005_1912-…-part-2.md` (`reports: spya-ayettj`, `parts: 2`),
      `npx tsx scripts/feedback-endings.ts`, `overseer-queue.ts done qi-5m89dnxa`.
- [ ] If part 1 has not landed: stage A goes back on the queue as its own entry, this plan as its
      brief, and the note's ending is `awaiting`, not `shipped`.

## Deferred, each with its own queue entry

| What | Why not now | Queue entry |
|---|---|---|
| **A `doi.org` link or a shortener that ends on a known source imports the paper**, and an article is found by the address it was asked for as well as the one it came from | § The options passed over, last item. Waits on part 1 being on `dev` and its `enqueue` fixes settled. Sol's G6 belongs to it: the document already fetched must be allowed to satisfy a candidate, not be fetched twice | `qi-fbrh4kck` (needs Greg: the column) |
| **NBER** and **OSF Preprints / PsyArXiv / SocArXiv** | NBER: a recent paper held for subscribers would turn today's abstract into a failure, and that wants a look at what the PDF address answers for one. OSF: its download ends on a signed, expiring Google Storage address, so the article's address would be useless for a refresh, a source link or finding it again (Sol's G2). OSF needs the asked-for address from the row above | `qi-fbrh4kck` |
| **bioRxiv and medRxiv**, with the eval that decides between bioRxiv's full-text HTML and its PDF | The HTML is free and seconds; the PDF is paid. A pasted `.full` page must stay the HTML (Sol's G3). bioRxiv's robots file was only half read (G9). medRxiv refused us (403), so it is included only if a later check gets in. Needs part 1's eval harness on `dev` | `qi-w49m6b3d` |
| **Follow a stub landing page's `citation_pdf_url`**, for the long tail (university repositories, Zenodo, AAAI, small journals) | A second mechanism and a judgement about what a stub is. Wants its own plan | `qi-nyd8f2w6` |
| **OpenReview** | Challenged from the box. One fetch of a forum page and its PDF from production's network decides whether a ten-line source is worth adding | `qi-smqhdmcm` |
| **HAL's bot-check page imports as an article** (*"Making sure you're not a bot!"*, 178 words, no error) | A bug found on the way, in a different place: stage 2's refusal of a page with too little text. Any Anubis-protected site will do the same | `qi-ptvjnvdm` |

## For Greg: not built, and why

- **PubMed and PMC.** The commonest biomedical links. PMC's page *is* the full text, and PubMed's
  page links to it. PMC answered our request, which announces itself with a browser's name, with a
  bot-check page; the researcher's plain `curl`, which announces itself as `curl`, got the article.
  PMC's own guidance forbids systematic downloading from the site and offers bulk services for it;
  one reader importing one paper is not that, but **changing what we tell one site we are in order
  to be let in is a decision about a bot wall, and it is yours**. If you say yes it is a small
  change in the fetcher's headers for one host, plus a PubMed → PMC lookup that needs NCBI's
  id-converter service (free, no key, a new outside call). Today both fail with a sentence, and the
  reader's route is to download the PDF and upload it. Queue entry `qi-azad3wfd`, waiting on you.
- **The publishers that refuse us** (Science, PNAS, ACM, Wiley, Elsevier, Springer, IEEE, SSRN,
  eLife, MDPI, and the rest of 261005e's table). No code. The upload route works.

## Questions and decisions

Nobody is reading the chat, so decisions taken on Greg's behalf are recorded here.

- **A paper whose PDF is not where the rule says fails**, rather than importing the abstract page
  as today. § What a wrong rule costs.
- **A Hugging Face or alphaXiv link is the arXiv paper**, the same article as the arXiv link, and
  its source link afterwards opens arXiv. The reader pasted a page *about* the paper; what they
  wanted to read is the paper.
- **ar5iv is left alone.** Its page is the paper already, free. Mapping it to arXiv would make it a
  paid PDF read until part 1 turns arXiv's HTML on.
- **Seven sources, not the eleven first planned.** The four dropped are deferred with their
  reasons, not forgotten.

## Reviews

- **Plan review, GPT Sol, round 1** (`261005m-other-paper-sources-plan-review-sol.md`, on commit
  `016a63565`): *do not build*, ten findings. Each was checked against the code and the data.

  | ID | Finding | Disposition |
  |---|---|---|
  | G1 (P0) | The redirect look, NBER and OSF each leave an article that a second paste of the same link cannot find, so it is imported and charged again, now as a paid PDF read | **Accepted.** The redirect look is deferred until the shelf lookup knows the asked-for address; NBER and OSF are deferred with it; "the address the fetch ends on resolves to the same paper" is now a rule and a live-checked test for every source |
  | G2 (P1) | OSF's stored address is a signed, expiring Google Storage URL | **Accepted**: OSF deferred |
  | G3 (P1) | A pasted bioRxiv `.full` page would become a paid PDF read | **Accepted**: bioRxiv deferred to the entry that carries its eval, with this recorded |
  | G4 (P1) | The slug rule refuses the measured 90-character CVF name | **Fixed**: a cut slug, the whole id in the key |
  | G5 (P1) | A landing-page fallback stores a stub under the paper's key, and a later paste of the PDF cannot replace it | **Accepted**: no landing-page candidates; a missing PDF fails |
  | G6 (P1) | The redirect look refetches a document it already holds | Gone with its cause (deferred); recorded in the deferred entry |
  | G7 (P1) | Hugging Face and alphaXiv identity does not reach citation matching | **Fixed by design**: the mirrors are shapes of the arXiv source, so `identityOf` and `arxivPdfUrl` learn them; tested at each caller |
  | G8 (P2) | medRxiv was planned though it refused every request; eleven sources is too broad | **Accepted**: Sol's core of seven |
  | G9 (P2) | alphaXiv `/overview/`, NeurIPS's endings, OSF `_v<N>` and bioRxiv's robots file were unverified | **Fixed**: NeurIPS's ending is read off the link; each remaining shape is live-checked or removed |
  | G10 (P3) | "174 addresses" is 174 cases over 157 distinct addresses | **Fixed** here and in 261005e |

- **Plan review, GPT Sol, round 2** (`261005m-other-paper-sources-plan-review-2-sol.md`, on commit
  `5c94e073e`): *build it after fixing G11–G14*. G1–G6 and G8–G10 confirmed closed; the cut of
  seven confirmed.

  | ID | Finding | Disposition |
  |---|---|---|
  | G11 (P1) | G7's fix was not traced: `identityOf`, `arxivPdfUrl` and `keysOf` each have their own arXiv parser and none calls `arxivIdOf` | **Fixed in the plan**: all three are pointed at it, with an end-to-end `matchOf` test. This fix was not in the round-2 snapshot, so the code review checks it first |
  | G12 (P1) | A missing derived PDF tells the reader to check an address that is fine | **Fixed in the plan**: `[fetch-paper-missing]`, with a sentence flagged for Greg |
  | G13 (P2) | A failed paper-source fetch logs neither the source nor the count | **Fixed in the plan** |
  | G14 (P2) | `requested_url` holds the derived candidate, not the pasted address | **Accepted**: the deferred entry says the job's address needs a column of its own |

  Discovery on the plan is closed at two rounds.
- Code review, GPT Sol: *(pending)*
