# A landing-page link imports the paper: the other paper sources

Status as of 2026-10-05: **plan, not yet reviewed, nothing built** — evidence: no source but arXiv
in `src/paper-sources.ts`, which is itself not on `dev` yet (see § What this waits on).

Report `spya-ayettj` (Sentry SPIDERYARN-READING2-DH), from Greg, 2026-10-05. This plan is **part 2
of 2**, queue entry `qi-5m89dnxa`. Part 1 is arXiv:
[261005l](261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md),
queue entry `qi-jqtexyzq`.

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

- **Ten sources are worth code now**: the landing page is a stub, the paper's address can be built
  from the pasted address alone, and our fetcher got the paper. They are this plan's stages.
- **Thirteen publishers and preprint servers refuse us whichever address we ask for** (403, a
  challenge, a JavaScript shell). Nothing permitted helps, and they fail legibly today.
- **Four big open-access publishers need nothing**: their landing page is the paper.
- **Four things are worth code but need something first.** They are § Deferred, each with a queue
  entry.

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
  is done, the build is re-queued and the note says so (§ Bookkeeping).

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

### A: nine more sources, each one object in the list

Every source below follows the rules part 1 set for arXiv:

- **It matches an origin, not a hostname**: http or https, the named host exactly, no port, no
  credentials.
- **Every candidate address is a fixed string built from an id the pattern matched**, never text
  copied from the pasted address. Each id pattern is a closed character class, so nothing in the
  pasted address can reach a candidate except characters the pattern allows.
- **The landing page and the PDF's own address resolve to the same paper**, so a reader who pastes
  either gets one article, and the shelf, the hover card and "already in Spideryarn" agree.
- **A resolved slug that would not pass `isSlug` makes the source answer `null`**, and the address
  is handled as an ordinary page (part 1's F16).

| Source (`name`) | Recognises | Candidates, in order |
|---|---|---|
| `huggingface`, `alphaxiv` | `huggingface.co/papers/<arxiv id>`; `alphaxiv.org/abs/<arxiv id>`, `/overview/<arxiv id>` | **arXiv's own**: these resolve to exactly what `arxiv.org/abs/<id>` resolves to (`source: "arxiv"`, the same key and slug), so they are the same article as the arXiv link and get arXiv's HTML when part 1 turns that on |
| `acl` | `aclanthology.org/<id>/`, `<id>.pdf`; `doi.org/10.18653/v1/<id>` | `aclanthology.org/<id>.pdf` |
| `pmlr` | `proceedings.mlr.press/v<N>/<name>.html`, `/v<N>/<name>.pdf`, `/v<N>/<name>/<name>.pdf` | `/v<N>/<name>/<name>.pdf`, then `/v<N>/<name>.pdf` |
| `neurips` | `proceedings.neurips.cc` and `papers.nips.cc`: `/paper[_files/paper]/<year>/hash/<hash>-Abstract[-<track>].html`, `/file/<hash>-Paper[-<track>].pdf` | `/paper_files/paper/<year>/file/<hash>-Paper-<track>.pdf` when the link named a track, then `-Paper-Conference.pdf`, then `-Paper.pdf` |
| `cvf` | `openaccess.thecvf.com/<collection>/html/<name>.html`, `/papers/<name>.pdf` | `/<collection>/papers/<name>.pdf` |
| `jmlr` | `jmlr.org/papers/v<N>/<name>.html`, `/papers/volume<N>/<name>/<name>.pdf` | `/papers/volume<N>/<name>/<name>.pdf` |
| `nber` | `www.nber.org/papers/w<N>` | `/system/files/working_papers/w<N>/w<N>.pdf` |
| `biorxiv`, `medrxiv` | `www.biorxiv.org/content/10.1101/<id>v<N>` with or without `.full`, `.full.pdf`, `.abstract`, `.full-text`; the same on `www.medrxiv.org` | `…/<id>v<N>.full.pdf`. **Only a link that carries its version**: see below |
| `osf` | `osf.io/preprints/<server>/<id>`, with or without `_v<N>` | `osf.io/download/<id>/` |

**The last candidate of every source in this table is the landing page itself** (`expect: "html"`),
except for the two arXiv mirrors, which take arXiv's list as it is. So when a paper's PDF is not
where the rule says (a NeurIPS track this table does not know, an NBER paper still held for
subscribers, a volume laid out differently), the reader gets what they get today, not a failure.
The job card then says `… KB, NeurIPS HTML` where a successful one says `NeurIPS PDF`.

Why that differs from arXiv, which fails: arXiv's address grammar is documented and complete, so a
missing PDF there is news. Ours for these sites was learned from two papers each.

**It stays a failure when the site refuses us** (a 403 on the PDF): part 1's loop does not move on
from a refusal, and this plan does not change the loop. That is a change from today for one case:
a site that serves us its landing page and refuses its PDF. Of the sources in the table none did
that when measured; IACR ePrint does, which is one reason it is not in the table.

**A bioRxiv link without a version is left alone in stage A.** `…/10.1101/2025.08.25.672055`
redirects to `…672055v2`, and whether `.full.pdf` works on the unversioned address is unverified.
Stage B picks it up, because it looks at where the redirect ended.

**What the fix costs the reader.** Every source in the table serves the paper as a PDF only (bioRxiv
has HTML too; see § Deferred). A PDF is read by a model: around ten US cents and one to three
minutes, against a landing page's free few seconds. That is the cost of importing the paper rather
than its announcement, and it is the same cost as pasting the PDF's own address today.

### B: one look at where a redirect ended

A `doi.org` link, a link shortener, a Papers with Code page (which now redirects to Hugging Face)
and an unversioned bioRxiv link all have one thing in common: the pasted address says nothing, and
the address the fetch *ended on* is one a source recognises.

```
 pasted address ── resolvePaperSource ──► a paper: its candidates (stage A, and arXiv)
                          │
                          └► null ──► fetchDocument(pasted address)
                                              │
                                              ▼
                                 resolvePaperSource(doc.url)        ← new, at most once
                                   │                    │
                                   ▼ null               ▼ a paper
                             this document,       that paper's candidates,
                             as today             through the same loop
```

- **Once.** The documents the second loop fetches are not looked at again, so a chain cannot form.
- **Only for an address no source recognised.** A source's own candidates are never re-resolved.
- **Every request is still `fetchDocument`, unchanged**, and the candidates are still fixed strings
  on the source's own host. A stranger's page that redirects to `arxiv.org/abs/<id>` gets the
  reader that arXiv paper, which is what following the redirect gave them before, minus the
  abstract page.
- **If the second loop fails, the step fails** with that failure, by part 1's rules. With the
  landing page as every stage-A source's last candidate, "the PDF is not there" already ends on the
  landing page; the cost is fetching that page a second time.
- **The article is not joined to its other addresses.** The job was queued under the pasted
  address's key, and the article's address afterwards is the PDF's. Pasting the same `doi.org` link
  again imports it again, exactly as a `doi.org` link to any publisher does today. Pasting the
  source's own link afterwards *does* find it. Joining the DOI too needs the article to remember
  the address it was asked for as well as the one it came from, which is the second address column
  part 1 has already put to Greg.

### What is not touched

`src/fetch.ts`, the SSRF and address checks, the redirect and byte caps, `enqueue`, `urlKey` and
`slugFromUrl` (they already ask the registry), stage 2, and everything in
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live).
No new dependency, no key, no outside service, no login, no changed header.

## The simpler options passed over

- **Follow the page's own `citation_pdf_url` tag wherever it appears**, instead of a rule per site.
  One mechanism instead of nine objects, and it reaches the long tail. Passed over *for now*
  because it is a second mechanism beside part 1's, the address is the page's choice rather than
  ours, it cannot tell a stub from a full-text page that also names its PDF (PLOS, Nature and
  Frontiers all do, and following it there would swap a good free import for a paid one), and CVF's
  tag points at a retired host. It is the first item in § Deferred.
- **Only the arXiv mirrors.** The smallest useful slice, and it is the first thing built. Stopping
  there leaves ACL, NeurIPS, ICML and CVPR, which are where our readers' non-arXiv papers are.
- **Fail when the PDF is absent**, as arXiv does, instead of ending on the landing page. Simpler by
  one candidate per source. Passed over because a rule learned from two papers will be wrong
  somewhere, and wrong should cost the reader nothing they have today.

## Stages

### Stage 0: research and measurement (done)

- [x] Web research: the longlist, address grammars, walls, robots files (raw notes beside 261005e).
- [x] `evals/paper-sources/landing-vs-paper.ts`: 174 addresses through `fetchDocument` and stage 2.
- [x] Production host census, read-only, counts only.
- [x] 261005e written.
- [ ] GPT Sol reviews this plan and 261005e's ranking (read-only).

### Stage A: the nine sources

Waits on part 1's stage 1 being on `dev`.

- [ ] Tests first, red, in `tests/paper-sources.test.ts`: for each source, every recognised shape
      resolves to one key and slug and the candidates in the table; the landing page is the last
      candidate; near-misses resolve to `null` (a look-alike host, a port, credentials, an id with
      a character outside its class, a path with something after the id, `huggingface.co/papers`
      alone, `huggingface.co/papers/<not an arXiv id>`, an over-long CVF name whose slug would not
      pass `isSlug`); Hugging Face and alphaXiv resolve to a value deep-equal to arXiv's for the
      same id; every candidate's host is the source's own.
- [ ] A property test over all sources: for a spread of hostile inputs (`..`, `%2f`, `@`, `\`,
      a second `//`, upper case, a query, a fragment) every candidate is `https:`, on an allowed
      host, and contains no character outside `[A-Za-z0-9._/-]` plus the scheme's `:`.
- [ ] Build the nine. Display names in `PAPER_SOURCE_LABEL`.
- [ ] Live check, free: `evals/paper-sources/resolve-live.ts` runs every case in `cases.json` for
      these sources through `resolvePaperSource` and the step's own loop with the real
      `fetchDocument`, and prints which candidate answered. Every paper measured in 261005e must end
      on a PDF. Also settles, by fetching: PMLR's two layouts, NeurIPS's endings (does a wrong one
      answer 404?), and whether bioRxiv's unversioned `.full.pdf` exists. Output under
      `docs/plans/261005m-evidence/`.
- [ ] Mutate: drop the landing-page candidate, loosen one id class, swap two hosts; each must turn
      a test red.
- [ ] Docs: `fetching.md` (the sources table, beside part 1's section), `ingest-queue.md`,
      `/help` if it says what pasting a link does.
- [ ] `npm run typecheck`, the touched tests, `npm run lint` on touched files. GPT Sol code review
      (write-capable, fixes inside the stage). Commit, push.

### Stage B: where the redirect ended

- [ ] Tests first, red, over an injected fetch: a non-source address whose document's final address
      is a source's landing page → the paper's first candidate is fetched and stored; final
      address not a source → one request, as today; the second loop's document is not looked at
      again (a PDF candidate that itself "redirects" to another source's page is stored as it is);
      the second loop fails with a 503 → that failure; Stop during the first fetch → no second.
- [ ] Build it in the fetch step. The step's detail and log line name the source as for stage A.
- [ ] Live check: a `doi.org/10.18653/…` link not caught statically (the older `10.3115` prefix), a
      `doi.org/10.1101/…` bioRxiv link, an unversioned bioRxiv link, a Papers with Code link.
- [ ] Mutate: allow a second look; skip the first. Each must turn a test red.
- [ ] Docs, gates, GPT Sol code review, commit, push.

### Stage C: bookkeeping

- [ ] The deferred items below each have a queue entry (ids recorded here) **before** the note says
      shipped.
- [ ] `docs/user-feedback/261005_1912-…-part-2.md` (`reports: spya-ayettj`, `parts: 2`),
      `npx tsx scripts/feedback-endings.ts`, `overseer-queue.ts done qi-5m89dnxa`.

## Deferred, each with its own queue entry

| What | Why not now | Queue entry |
|---|---|---|
| **Follow a stub landing page's `citation_pdf_url`**, for the long tail (university repositories, Zenodo, AAAI, small journals) | A second mechanism and a judgement about what a stub is (§ The simpler options passed over). Wants its own plan | *(to be added)* |
| **bioRxiv's full-text HTML before its PDF** | Free against paid, but only if our extractor reads it correctly. Needs the eval part 1 ran for arXiv, and part 1's eval harness to be on `dev` | *(to be added)* |
| **OpenReview** | Challenged from the box. One fetch of a forum page and its PDF from production's network decides whether a ten-line source is worth adding. That is the Overseer's to run | *(to be added)* |
| **HAL's bot-check page imports as an article** (*"Making sure you're not a bot!"*, 178 words, no error) | A bug found on the way, in a different place: stage 2's refusal of a page with too little text. Any Anubis-protected site will do the same | *(to be added)* |

## For Greg: not built, and why

- **PubMed and PMC.** The commonest biomedical links. PMC's page *is* the full text, and PubMed's
  page links to it. PMC answered our request, which announces itself with a browser's name, with a
  bot-check page; the researcher's plain `curl`, which announces itself as `curl`, got the article.
  PMC's own guidance forbids systematic downloading from the site and offers bulk services for it;
  one reader importing one paper is not that, but **changing what we tell one site we are in order
  to be let in is a decision about a bot wall, and it is yours**. If you say yes it is a small
  change in the fetcher's headers for one host, plus a PubMed → PMC lookup that needs NCBI's
  id-converter service (free, no key, a new outside call). Today both fail with a sentence, and the
  reader's route is to download the PDF and upload it.
- **The publishers that refuse us** (Science, PNAS, ACM, Wiley, Elsevier, Springer, IEEE, SSRN,
  medRxiv, eLife, MDPI, and the rest of 261005e's table). No code. The upload route works.

## Questions and decisions

Nobody is reading the chat, so decisions taken on Greg's behalf are recorded here.

- **A paper whose PDF is not where the rule says ends on the landing page**, as today, rather than
  failing. § A.
- **A Hugging Face or alphaXiv link is the arXiv paper**, the same article as the arXiv link, and
  its source link afterwards opens arXiv. The reader pasted a page *about* the paper; what they
  wanted to read is the paper.
- **ar5iv is left alone.** Its page is the paper already, free. Mapping it to arXiv would make it a
  paid PDF read until part 1 turns arXiv's HTML on.

## Reviews

- Plan review, GPT Sol: *(pending)*
- Code review, GPT Sol: *(pending)*
