# Where a reader's paper link points: the other sources, measured and ranked

Up: [research.md](../project/research.md)

Researched and measured on 2026-10-05, for report `spya-ayettj` part 2 (queue entry `qi-5m89dnxa`).
The decision it feeds is in the plan,
[261005m](../plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md).
arXiv itself is part 1:
[261005l](../plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md).

> 2) and use web research to longlist and prioritise and optimise a lot of other common likely
> sources (like Arxiv) for other kinds of papers that we should create import optimisations for.
>
> — Greg, 2026-10-05, report spya-ayettj

## The question

A reader pastes the link they have. For a paper that is usually a **landing page**: the page with
the title, the abstract and a "Download PDF" button. We import that page. Nothing fails, the
article carries the paper's title, and it is a few hundred words long. Which sites does this happen
on, how often will our readers paste them, and for which of them can we fetch the paper itself
with nothing but the address they gave us?

## How it was done, and how far to trust it

Three sources of evidence, in descending order of how much weight they bear.

1. **Measured through our own fetcher and extractor** (first-hand, 2026-10-05). 92 real papers
   across 45 sources, 174 fetch cases over 157 distinct addresses: each landing page, and the address of the paper as best it can
   be built from the landing address. Every address went through `fetchDocument` with its default
   options, and every HTML page through our own stage-2 extraction. No model was called and nothing
   was written to a database. The script is `evals/paper-sources/landing-vs-paper.ts`, the cases
   `evals/paper-sources/cases.json`, the output `evals/results/paper-sources-261005/summary.md` and
   `results.json`. A PDF was fetched and its pages counted; it was **not** read, so nothing here says
   how well a source's PDFs extract.
2. **Web research** (a Sonnet subagent, 2026-10-05): the longlist, each source's address grammar,
   its robots file and any wall, checked with `curl` where it could be. Its notes, with every fact
   marked as checked, sourced or from memory, are
   [the raw notes](261005e-where-a-reader-s-paper-link-points-raw-notes.md).
3. **Our own readers** (first-hand, 2026-10-05): the hosts of every article in production that was
   imported from an address, counted read-only with `evals/paper-sources/host-census.mjs`. Counts
   only; the output is not in the repo.

**Three limits that apply to everything below.**

- **One network.** Every fetch left from the Hetzner box, a datacentre address. Production fetches
  from Vercel, also datacentre addresses, but different ones. A wall that refused us here may let
  production through and the reverse. "Fetched" below means *fetched from this box on this day*.
- **Two papers per source.** Enough to see a landing page is a stub; not enough to know every shape
  of a site's addresses across twenty years of proceedings.
- **No measured share of pasted links exists.** No study found ranks the sites that readers' paper
  links point to, and our own data is 36 articles. So "how common" below is a judgement from
  submission volumes and from who our readers are, and it is labelled as one.

## How common: what there is to go on

**Our readers so far** (production, 36 articles imported from an address, 2026-10-05): arXiv 9,
`nature.com` 2, `pmc.ncbi.nlm.nih.gov` 1, `jneurosci.org` 1, one PDF from Academia's file host; most
of the rest are essays and blogs, with a few papers on their authors' own sites. So at least 14 of
the 36 are papers and 9 of those are arXiv's. That confirms part 1's priority and is too small to
rank anything after it.

**Who they are.** The report's own link came from an AI paper club. The first readers are
AI-leaning and science-curious. So the ranking weights the places AI papers live above their raw
size: a preprint server with 250,000 papers a year that our readers rarely cite counts for less
than a conference site with 4,000 that they cite weekly. That weighting is a judgement.

**Volumes** (from search-result snippets of the sites' own reports, not the primary pages; treat as
orders of magnitude): arXiv about 40,000 submissions a month in 2026; SSRN about 250,000 papers in
2025; bioRxiv 49,256 and medRxiv 14,973 in 2025; ChemRxiv about 15,000 a year. Conference
proceedings are smaller and denser: NeurIPS, ICML (PMLR), ICLR (OpenReview), CVPR/ICCV (CVF) and
ACL each publish a few thousand papers a year, nearly all of them also on arXiv.

## What a landing-page link imports today

Measured. "Words" is what our extractor kept from the page.

### The landing page is a stub, and the paper is one fetch away

These import today **without any error**, as a short article under the paper's title.

| Source | Landing page imports as | The paper, fetched by us | Address derivable from the landing address alone? |
|---|---|---|---|
| Hugging Face paper pages | 358–380 words | arXiv's PDF, 15 and 86 pages | yes: the arXiv id is the path |
| alphaXiv | 673–1,022 words | arXiv's PDF | yes: the arXiv id is the path |
| ACL Anthology | 339–397 words | PDF, 10 and 21 pages | yes: add `.pdf` |
| PMLR (ICML, AISTATS, COLT) | 917–973 words | PDF, 16 and 9 pages | yes, two shapes by volume |
| NeurIPS proceedings | 198 words | PDF, 11 and 25 pages | yes: the hash is in the path; the file name's ending varies by year |
| CVF Open Access (CVPR, ICCV) | 286–339 words | PDF, 9 and 11 pages | yes: `/html/X.html` → `/papers/X.pdf` |
| JMLR | 123–197 words | PDF, 30 and 6 pages | yes |
| NBER working papers | 407–490 words | PDF, 41 and 28 pages | yes |
| bioRxiv | 347–452 words | full-text HTML, 7,515 and 9,803 words; PDF, 37 and 55 pages | yes: add `.full` or `.full.pdf` |
| IACR ePrint | 338–429 words | **PDF refused, 403** | yes, but it does not help us |
| Zenodo | 147–187 words | not tested | no: the file name is the uploader's |
| Nature, a paywalled paper | 1,336 words, the abstract | PDF failed, a redirect loop into the login | not ours to fetch |

### The landing page fails today, and the paper is one fetch away

| Source | Landing page today | The paper, fetched by us |
|---|---|---|
| OSF Preprints, PsyArXiv, SocArXiv | refused: the page is an empty shell that JavaScript fills | PDF from `osf.io/download/<id>/`, 40 and 11 pages |

### The landing page already is the paper: nothing to do

PLOS (5,315–6,926 words), Nature open-access papers (10,366 and 11,260), Frontiers (4,469 and
7,540), ar5iv (5,638 and 8,949). A `doi.org` link to any of these lands on the same page and
imports the same article. eLife and MDPI belong here by design but refused us (below).

### Refused, whichever address we ask for

| What we got | Sources |
|---|---|
| HTTP 403 on every address | medRxiv, Europe PMC, Wiley, ACM Digital Library, SSRN, Science, PNAS, MDPI, ScienceDirect, ResearchGate, ChemRxiv, Oxford Academic, Taylor & Francis |
| HTTP 406 | eLife |
| A challenge page instead of the document | PMC (a reCAPTCHA page), OpenReview (redirected to `/challenge`), HAL (an Anubis proof-of-work page) |
| A shell that needs JavaScript | Springer Link, IEEE Xplore, Semantic Scholar |
| A page our extractor refused | PubMed (28 characters kept from a 5.6 KB answer with status 203), `doi.org` links to Elsevier |

All but one of these **fail legibly today**: the fetch fails or the extractor refuses the page for
having too little text, and the reader is told. That is the right behaviour for a wall, and no
import optimisation changes it. A `doi.org` link behaves exactly as the publisher it resolves to.

**The exception is HAL**, and it is a bug rather than a ranking fact: its challenge page is long
enough to pass, and imports as a 178-word article titled *"Making sure you're not a bot!"*. Queued
separately (the plan names the entry).

## The longlist, ranked

The score is three things multiplied, each a judgement informed by the measurements above: how
often our readers will paste it, how much of the paper the landing page loses, and how simple and
permitted the fix is. "Permitted" means a plain request through our existing fetcher works: no key,
no login, no wall to get round.

### Worth code

Ranked. **The plan builds rows 1 to 6 first.** Rows 7 to 10 each turned out, at the plan's review,
to need something the first six do not: bioRxiv a choice between its free HTML and its paid PDF;
OSF and the DOI link a way to find an article by the address it was asked for, because where their
fetch ends up is not an address anyone would paste; NBER a look at what a subscriber-only paper
answers. The plan's § Deferred has each, with its queue entry.

| # | Source | Why here |
|---|---|---|
| 1 | **Hugging Face paper pages, alphaXiv** | Where AI readers find papers now, and Papers with Code redirects to Hugging Face. The landing page loses the whole paper. The fix is a mapping to an arXiv paper that part 1 already knows how to fetch, so it also gets arXiv's HTML when part 1 turns that on, and the same article as the arXiv link |
| 2 | **ACL Anthology** | All of NLP. Cleanest rule found: add `.pdf`. No wall, no robots file, everything open |
| 3 | **PMLR** | ICML, AISTATS, COLT |
| 4 | **NeurIPS proceedings** | |
| 5 | **CVF Open Access** | CVPR, ICCV, WACV |
| 6 | **JMLR** (and TMLR lives on OpenReview, below) | Lower volume; the rule is trivial |
| 7 | **bioRxiv** | The largest source outside AI that let us in. The science-curious half of the readership |
| 8 | **OSF Preprints, PsyArXiv, SocArXiv** | Psychology and social science preprints. The only source where a fix turns a failure into an import |
| 9 | **NBER** | Economics working papers; trivial rule; some recent papers are subscriber-only for a while |
| 10 | **A `doi.org` link that resolves to any of the above** | A DOI is how papers are cited, so it is how a careful reader links one. It needs one new thing: looking at where the redirect ended |

### Worth code, but not yet: each needs something first

| Source | What it needs first |
|---|---|
| **OpenReview** (ICLR, TMLR, NeurIPS reviews) | Would rank second on frequency. The rule is trivial (`/forum?id=X` → `/pdf?id=X`), but both addresses met a challenge from this box. Needs one test from production's network before any code; if production is challenged too, nothing permitted helps |
| **bioRxiv's full-text HTML** instead of its PDF | Free and seconds against a paid PDF read, exactly arXiv's trade-off. Needs the same eval part 1 ran for arXiv: is the HTML extraction correct? Only word counts were measured here |
| **medRxiv** | Same rule as bioRxiv, same operator; refused us with 403 on all six requests. Goes with bioRxiv only if a later check gets in |
| **PubMed and PMC** | The most common biomedical link by far. PMC *is* the full text and PubMed links to it, but PMC answered our browser-like request with a challenge and a plain `curl` with the article. Getting through means changing how we announce ourselves to one site, which is a call about a bot wall and so Greg's. PubMed → PMC also needs a lookup, not string work |
| **Any landing page that names its PDF** in a `citation_pdf_url` tag | The general answer for the long tail: university repositories, small journals, Zenodo, IACR, AAAI, and every site in the table above carry the tag. It is a second mechanism (read the fetched page, decide it is a stub, follow a link the page chose), it turns some free imports into paid PDF reads, and deciding "this page is a stub" is a judgement. Named in the plan as the deferred half |

### Do nothing

| Source | Why |
|---|---|
| PLOS, Frontiers, Nature open access, ar5iv | The landing page is the paper |
| eLife, MDPI | The landing page is the paper, and they refused us. Nothing permitted helps |
| SSRN, ChemRxiv, ACM, ScienceDirect, Science, PNAS, Wiley, Oxford Academic, Taylor & Francis, Sage, Springer Link, IEEE Xplore, Europe PMC | Walled against us, most of them paywalled as well. The reader's route is to download the PDF and upload it, which works today |
| ResearchGate, Academia.edu, JSTOR | Login |
| Semantic Scholar, Google Scholar, DBLP, Connected Papers, RePEc/IDEAS, CORE, Unpaywall | The address carries no id a paper's address can be built from; their APIs want a key or a lookup |
| IACR ePrint | The PDF is refused (403) though the landing page is not |
| Zenodo, HAL, PhilArchive, Research Square, Preprints.org, AAAI, IJCAI | Rare for our readers; unverified or not derivable. The `citation_pdf_url` route would cover most of them |

## Address grammar for the sources worth code now

Each was fetched on 2026-10-05 unless marked. The plan's tests are written from these.

| Source | Landing | The paper |
|---|---|---|
| Hugging Face | `huggingface.co/papers/1706.03762` | arXiv `1706.03762` |
| alphaXiv | `www.alphaxiv.org/abs/1706.03762`; `/overview/<id>` (from memory, unverified) | arXiv `1706.03762` |
| ACL Anthology | `aclanthology.org/N19-1423/`, `aclanthology.org/2023.acl-long.1/` | `aclanthology.org/N19-1423.pdf`. DOI `10.18653/v1/<id>` names the same id |
| PMLR | `proceedings.mlr.press/v139/radford21a.html` | `…/v139/radford21a/radford21a.pdf` (newer volumes), `…/v37/ioffe15.pdf` (older) |
| NeurIPS | `proceedings.neurips.cc/paper_files/paper/2017/hash/<hash>-Abstract.html`; `papers.nips.cc/paper/2017/hash/…`; newer years end `-Abstract-Conference.html` | `…/paper_files/paper/2017/file/<hash>-Paper.pdf`; newer `-Paper-Conference.pdf`; other tracks other endings (from memory) |
| CVF | `openaccess.thecvf.com/content_cvpr_2016/html/X_paper.html`, `…/content/ICCV2021/html/X_paper.html` | the same with `/papers/X_paper.pdf` |
| JMLR | `jmlr.org/papers/v15/srivastava14a.html` | `jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf` |
| NBER | `www.nber.org/papers/w30000` | `www.nber.org/system/files/working_papers/w30000/w30000.pdf` |
| bioRxiv | `www.biorxiv.org/content/10.1101/2025.08.25.672055v2`; without `vN` it redirects to the latest | add `.full.pdf` (PDF) or `.full` (HTML). Whether the unversioned address takes `.full.pdf` is unverified |
| OSF | `osf.io/preprints/psyarxiv/np2vd`, `osf.io/preprints/osf/vxh6m` | `osf.io/download/np2vd/`, which redirects through `files.osf.io` to Google's storage |

Two traps found on the way. CVF's own `citation_pdf_url` tag points at a retired host, so the tag
is not always better than the rule. And the DOI prefix `10.1101` is shared by bioRxiv, medRxiv and
Cold Spring Harbor's journals, so a `10.1101` DOI does not say which site it is until it is
resolved.

## Dead ends

- **`semanticscholar.org/arxiv/<id>`** does not exist (404). Semantic Scholar's pages carry a hash,
  not an arXiv id, and its API answered 429 "apply for a key" on the first anonymous call.
- **Europe PMC's REST full text** answered the researcher's `curl` with JATS XML and answered our
  fetcher with 403. It would also be a new document format for stage 2.
- **OSF's API** is disallowed by its robots file (`/api/*`). The download address is not.
- **A ranking from altmetrics studies.** They rank news sites and the big publishers by tweets,
  which measures a different population from readers pasting a paper into a reading tool.
- **A ranking from our own data.** 36 articles.

## What would change the ranking

- A production host census once there are a few hundred imported papers: re-run
  `host-census.mjs` and compare with the table above.
- One fetch of an OpenReview forum page and PDF from Vercel. If it comes back as the PDF,
  OpenReview goes to second place and is a ten-line source.
