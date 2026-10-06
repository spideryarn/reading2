# Raw notes: where a reader's paper link points (non-arXiv sources)

Raw research notes, 2026-10-05, for a registry of "pasted URL -> candidate full-text URLs". Not the final doc.

## Evidence legend and caveats (read first)

- **[CHK]** = checked by me on 2026-10-05, with `curl` from this machine (a Hetzner datacentre box, Linux, Chrome-like `User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36`). I did few fetches per site, 1 s apart.
- **[SRC url]** = from a source I read or a search result. **[MEM]** = from memory, unverified.
- **Big caveat on every "blocked/works" claim:** I tested from ONE IP (a datacentre one). Cloudflare/Akamai verdicts depend on IP reputation, headers, TLS fingerprint, and change over time. Vercel's IPs may fare differently. "Works from this box today" is not "works". Also curl's TLS fingerprint is not Chrome's, so a 403 here may be a fingerprint test a real fetch library also fails, or not.
- HEAD and GET sometimes differ. My first pass used `curl -I`; the second pass used GET. Where they disagreed I say so. GET is what counts.
- Example DOIs I invented for Zenodo (`10.5281/zenodo.3908672`) and PsyArXiv (`10.31234/osf.io/6kpgc`) did not resolve at doi.org (404): they are probably not real records, so I never proved those grammars. Marked unverified.
- Web-search results contained figures dated 2026 (e.g. arXiv "40,363 submissions in Sept 2026"). I took them from search snippets, not primary pages, so treat as [SRC, snippet only].

## 1. Longlist (45), with the most-likely-to-matter flagged

AI/ML-leaning audience tier (A), science-curious generalist tier (B), long tail (C).

| # | Source | Tier | Landing page IS full text? |
|---|---|---|---|
| 1 | bioRxiv | B | no (abstract + full-text tab; `.full` is the full text) |
| 2 | medRxiv | B | same as bioRxiv |
| 3 | PubMed | B | no (abstract only) |
| 4 | PubMed Central (PMC) | B | **yes** |
| 5 | Europe PMC | C | yes for OA (but Cloudflare-walled to me) |
| 6 | doi.org / dx.doi.org | A,B | n/a: redirects to publisher |
| 7 | OpenReview | **A** | no (forum page: abstract + reviews) |
| 8 | ACL Anthology | **A** | no (abstract page; PDF is one string-rewrite away) |
| 9 | SSRN | B | no |
| 10 | Semantic Scholar | A | no |
| 11 | PMLR (proceedings.mlr.press) | **A** | no (abstract page; PDF one rewrite) |
| 12 | NeurIPS proceedings (proceedings.neurips.cc, papers.nips.cc) | **A** | no (abstract; PDF needs a hash-bearing path) |
| 13 | CVF Open Access (openaccess.thecvf.com) | **A** | no |
| 14 | JMLR | A | no |
| 15 | AAAI (ojs.aaai.org) / IJCAI (ijcai.org) | A | no |
| 16 | Nature (and Nature Communications, Sci Reports) | **A,B** | OA articles: yes; else abstract |
| 17 | Science (science.org) | B | no (paywalled mostly; Cloudflare 403 to me) |
| 18 | Cell (cell.com) | B | partly |
| 19 | PNAS | B | OA after 6 months; 403 to me |
| 20 | Springer Link | B | OA yes, else no; JS "Client Challenge" to me |
| 21 | Wiley Online Library | C | mostly no |
| 22 | Elsevier ScienceDirect | B | mostly no; 403 to me |
| 23 | PLOS | B | **yes** |
| 24 | eLife | B | **yes** |
| 25 | Frontiers | B | **yes** |
| 26 | MDPI | B | **yes** (but Akamai "Access Denied" to me) |
| 27 | ACM Digital Library | **A** | no (abstract); Cloudflare 403 to me |
| 28 | IEEE Xplore | A | no; JS app, 202 to me |
| 29 | Oxford Academic | C | no |
| 30 | Taylor & Francis | C | no |
| 31 | Sage | C | no |
| 32 | ResearchGate | C | no (login/Cloudflare) |
| 33 | Academia.edu | C | login wall |
| 34 | Hugging Face papers | **A** | no (abstract + arXiv link) |
| 35 | alphaXiv | **A** | no (arXiv id in URL) |
| 36 | ar5iv | A | **yes** (arXiv HTML rendering) |
| 37 | Papers with Code | A | redirects to HF papers now [CHK] |
| 38 | OSF Preprints / PsyArXiv / SocArXiv | B | no |
| 39 | ChemRxiv | C | no |
| 40 | Research Square | C | no |
| 41 | Preprints.org | C | no |
| 42 | NBER | B | no (abstract + PDF link) |
| 43 | RePEc / IDEAS | C | no |
| 44 | Zenodo | A,B | no (record page + files) |
| 45 | HAL | C | no |
| 46 | PhilPapers / PhilArchive | C | no |
| 47 | JSTOR | C | walled |
| 48 | Google Scholar links | B | n/a: result pages / redirects |
| 49 | IACR ePrint | C | no |
| 50 | ECCC | C | no |
| 51 | DBLP | A | no full text at all |
| 52 | Connected Papers | C | no |
| 53 | scholar.archive.org | C | no |
| 54 | CORE | C | no |
| 55 | Unpaywall | C | no pages |
| 56 | Distill / transformer-circuits.pub / lab blogs | A | these are normal articles; not in scope but common for this audience (and OpenAI/DeepMind/Anthropic papers often PDFs on their own sites) |
| 57 | GitHub README / project pages linking a PDF | A | normal web page |

(57 rows, more than asked; items 56 and 57 are not "paper landing pages" but are a big share of AI-reader links [MEM].)

## 2. How common is each as a link target (evidence)

**No study I found gives a per-domain ranking of scholarly links pasted by readers of an AI/ML reading club.** I looked for altmetric studies of top domains on Twitter/HN. What I found:

- A search summary says the Guardian, NYT and publishers Wiley, Elsevier, T&F, Springer rank among the top domains for scientific sharing on Twitter [SRC snippet, search "altmetric top domains"; primary study not opened. Treat as weak].
- Altmetric's blogs: Twitter is the largest altmetric source after Mendeley; >1/5 of recent journal articles are tweeted [SRC https://www.altmetric.com/blog/twitter-in-scholarly-communication/ (snippet)].
- Meta-analysis of who tweets papers: https://doi.org/10.1162/QSS.a.464 and https://arxiv.org/pdf/2312.06399 (not opened).

So **ranking below is my judgement from volume numbers plus audience bias, not a measured link share.**

Volume numbers (items submitted/published):

- **arXiv** (comparison only): 20,569 submissions Sept 2024; 40,363 in Sept 2026 (record), cs.AI up more than 6x in two years; cap of 2/month from 2026-10-01 [SRC snippet from https://blog.arxiv.org/2026/10/01/updated-rate-limit-policy/ and https://arxiv.org/stats/monthly_submissions]. Earlier record post: https://blog.arxiv.org/2023/11/03/arxiv-sets-new-record-for-monthly-submissions/.
- **bioRxiv** 49,256 new manuscripts in 2025; **medRxiv** 14,973 in 2025; more than 8M page views and 6M downloads a month combined; ~80% later published [SRC https://openrxiv.org/2025-year-in-review/ (via search snippet)]. Note the operator is now "openRxiv".
- **SSRN**: over 250,000 new papers in 2025, +20% on 2024, 53M downloads, >1M papers total [SRC https://blog.ssrn.com/2025/12/16/2025-year-in-review-how-ssrn-enhanced-access-to-preprints-and-early-stage-research/ (snippet)].
- **ChemRxiv**: ~15,000+/yr, ~38,000 total [SRC snippet, https://chemrxiv.org/; weak].
- **Research Square**: >25,000 preprints; ~2,500 biomedical postings/month in 2020 [SRC snippet; dated, weak].
- **OSF Preprints** (incl. PsyArXiv, SocArXiv...): "over two million preprints" is the RePEc/aggregate figure [SRC snippet https://ideas.repec.org/s/osf/osfxxx.html]; not a posting rate. Not found: a clean per-year number.
- **Preprints.org**: not found.
- **Crossref**: 175M DOI records, 23,600 members as of Nov 2025 [SRC snippet https://www.crossref.org/publications/annual-report-2025/]. Per-publisher DOI counts: I did not find a public number in search; `https://api.crossref.org/prefixes/<prefix>` and `https://api.crossref.org/members/<id>` expose `counts` [MEM; I only used the prefix endpoint for the name]. A follow-up could pull `total-dois` for the prefixes in section 5 (cheap, one call each, no key).
- **Publisher shares**: the Big Five (Elsevier, Springer Nature, Wiley, T&F, Sage) ~53.2% of market revenue 2025 [SRC snippet, dataintelo; low quality]. MDPI's market share in Central/Eastern European output [SRC https://link.springer.com/article/10.1007/s11192-022-04586-1].
- **OpenAlex**: ~322M works, ~121M (37%) OA by its definition [SRC snippet https://help.openalex.org/data/works/open-access/]. Not found: a host-type split (publisher vs repository).
- **Site traffic ranks**: not found; I did not try SimilarWeb/Tranco (would be a good quick follow-up for the final ranking).

**Audience bias (my judgement, [MEM]-level):** an AI paper club and science-curious generalists mostly share: arXiv (handled), then Hugging Face papers / alphaXiv (arXiv mirrors), OpenReview (ICLR, NeurIPS reviews), ACL Anthology (NLP), PMLR (ICML), NeurIPS proceedings, CVF (CVPR/ICCV), Nature/Science/Cell news-driven links, bioRxiv/medRxiv for the "science-curious" side, PubMed/PMC for health links, SSRN for economics/AI-policy papers, NBER for econ. ACM/IEEE appear for systems/HCI papers. Elsevier/Wiley/Springer for the long tail.

## 3. Per-source URL grammar

Format: landing -> full text; derivable?; OA?; protection; robots; official routes.

### bioRxiv / medRxiv (DOI prefix 10.1101, Cold Spring Harbor)
- Landing [CHK, 200]: `https://www.biorxiv.org/content/10.1101/2020.03.22.002386v1`. Unversioned URL redirects to latest: `.../2020.03.22.002386` -> `...v3` [CHK].
- Full text HTML [CHK 200, 786 KB, real article]: `https://www.biorxiv.org/content/10.1101/2020.03.22.002386v1.full`
- PDF [CHK 200, application/pdf, 14.5 MB]: `https://www.biorxiv.org/content/10.1101/2020.03.22.002386v1.full.pdf`
- Derivable by string: **yes**, append `.full` / `.full.pdf` to the landing path. Version suffix: the versioned URL works; the unversioned one redirected to v3 on the landing page. I did not test `.full.pdf` without `vN` (unversioned `.full.pdf` is [MEM] to also redirect; unverified).
- `doi.org/10.1101/2020.03.22.002386` resolves to the bioRxiv page [CHK]. But **10.1101 does not say bioRxiv vs medRxiv**: the host is only known after the redirect (or from the API's `server` field). A candidate list can try both hosts, but see protection.
- Page carries `<meta name="citation_pdf_url" content="https://www.biorxiv.org/content/biorxiv/early/2020/03/22/2020.03.22.002386.full.pdf">` [CHK].
- Protection: **bioRxiv GET worked for me with Chrome-like UA (HTML and PDF). medRxiv returned 403 (Cloudflare-style page, 5 KB) [CHK, both HEAD and GET].** Same CSHL org, different result, so expect it to change. bioRxiv's robots.txt blocks named bots (BLEXBot, Bytespider, `openai`, etc.) and lists only admin/user/search paths under the general block as far as I saw [CHK: head and tail of file; I did not read the middle, so "nothing disallows /content/" is not proven].
- OA: all preprints readable (licence varies; some "no reuse").
- API [CHK 200 JSON]: `https://api.biorxiv.org/details/biorxiv/<doi>` (no key). Gives `jatsxml` link, version, `server` field. Official, but it is a lookup (network) so outside the "string only" rule.

### medRxiv: as above, 403 from here (`https://www.medrxiv.org/content/10.1101/2020.02.25.20021568v1`).

### PubMed
- Landing [CHK, HEAD 203 / GET fine]: `https://pubmed.ncbi.nlm.nih.gov/34265844/`. Abstract only.
- Full text: not derivable. PubMed -> PMC needs the PMID->PMCID map (API: ID converter `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/?ids=34265844` [MEM]; or E-utils elink). Only ~some articles have a PMC copy.
- robots: `Crawl-delay: 1`, disallows /api, /*/references/, etc. [CHK]. NCBI E-utilities are the official automated route (key optional: 3 req/s without) [MEM].
- Do-nothing vs. fix: landing page loses the paper entirely, but the fix needs a lookup.

### PubMed Central (PMC)
- Landing [CHK]: `https://pmc.ncbi.nlm.nih.gov/articles/PMC8371605/`. Old form `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8371605/` redirects to it [CHK]. Landing page IS the full text (when the article is in PMC).
- **Surprise:** with a Chrome-like UA I got a ~20 KB page with an empty `<title>` and no article text (looks like a JS/challenge shell); with `curl/8` UA I got a 270 KB page containing the article and `citation_*` meta tags [CHK]. So a "browser-like header" is *worse* here. I did not work out why (could be IP+UA rule). Do not conclude that a bare UA is policy-approved.
- PMC policy [SRC https://pmc.ncbi.nlm.nih.gov/about/faq/ via search snippet]: systematic/bulk downloading from the main site is prohibited; only the auxiliary services (OAI-PMH, FTP, Cloud/AWS) may be used for automated retrieval; unauthorised bulk activity gets IP ranges blocked. One article per paste is not "bulk", but this is their explicit crawler policy, so say so in the doc.
- robots.txt [CHK]: `User-agent: *` `Crawl-delay: 1`; Allow: /articles/ /api/ /tools/ /pub/; `Disallow: /` otherwise.
- PDF: `.../PMC8371605/pdf/` returned an HTML "Preparing to download ..." interstitial, not a PDF [CHK]. Real PDF needs the filename (`.../pdf/41586_2021_Article_3819.pdf` also returned text/html for me [CHK]). So PMC PDF is **not** derivable and not directly fetchable.
- Official no-key route [CHK 200]: Europe PMC REST `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC8371605/fullTextXML` returned 177 KB JATS XML. Also E-utilities `efetch.fcgi?db=pmc&id=8371605&rettype=xml` returned 172 KB JATS [CHK 200]. Both are string-derivable from a PMCID, no key. Note Europe PMC's REST returns full text only for OA-licensed items (that is [MEM]; my one test was OA). Europe PMC REST search `.../rest/search?query=EXT_ID:34265844&format=json` works [CHK] (PMID->PMCID lookup; network).
- The PMC OA Web Service URL I tried (`www.ncbi.nlm.nih.gov/pmc/utils/oa/oa.fcgi?id=...`) returned 404 [CHK]; its location has probably moved (PMC moved domains in 2024-25). Unresolved.

### Europe PMC (`europepmc.org/article/MED/34265844`)
- 403 Cloudflare "Just a moment..." for the site, including `europepmc.org/backend/ptpmcrender.fcgi?accid=...&blobtype=pdf` (the PDF render route) [CHK]. The REST API host `www.ebi.ac.uk/europepmc/webservices/rest/` was fine [CHK]. So: **map europepmc.org URLs (`/article/MED/<pmid>`, `/article/PMC/<pmcid>`, `/abstract/MED/<pmid>`) to the REST fullTextXML or to PMC.** `/article/PPR/<id>` preprints: needs lookup [MEM].

### doi.org / dx.doi.org
- Shape: `https://doi.org/10.xxxx/...`. Resolution by redirect (needs network). Statically, only the prefix tells you who (section 5).
- [CHK] results (GET -L, Chrome-like UA): 10.1101 bioRxiv 200; 10.1371 PLOS 200; 10.1038 Nature 200 (adds `?error=cookies_not_supported&code=...`); 10.1016 -> `linkinghub.elsevier.com/retrieve/pii/S0004370221000862` (200; then the ScienceDirect page 403s); 10.3389 Frontiers 200; 10.18653 -> aclanthology.org 200; 10.48550/arXiv.1706.03762 -> arxiv.org/abs/1706.03762 200; 10.1145 ACM 403; 10.1126 Science 403; 10.2139 SSRN 403 (`https://www.ssrn.com/abstract=4412788`). Springer/eLife see below.
- Elsevier's `pii` id appears in the `linkinghub` redirect, so the ScienceDirect URL is not derivable from DOI alone.

### OpenReview
- Landing: `https://openreview.net/forum?id=rkgNKkHtvB`; PDF: `https://openreview.net/pdf?id=rkgNKkHtvB`. Also `/pdf/<hash>.pdf` forms [MEM]. String-derivable: **yes** (forum `id` -> pdf `id`). Note the id is in the URL query; `?id=` may also be on `/forum?id=<forum>&noteId=<note>` (use `id`).
- [CHK] Forum page returned HTTP 200 but after redirect to `/challenge?redirect=...` in the HEAD pass; GET returned a 4.8 KB shell (JS app). The PDF URL returned **403** [CHK]. `api2.openreview.net/notes?id=...` also returned the 4.8 KB HTML shell, not JSON (so my API probe failed; the real API paths are `https://api2.openreview.net/notes?forum=<id>` and `api.openreview.net` [MEM], not verified). So OpenReview has a bot challenge to datacentre curl; **do not claim it works.**
- robots.txt [CHK]: only `Disallow: /*?*email=`.
- Official route: OpenReview API (no key for public reading) [MEM; unverified].

### ACL Anthology (DOI prefix 10.18653 / 10.3115)
- Landing [CHK 200]: `https://aclanthology.org/N19-1423/` (also `.../2020.acl-main.1/`, new style `https://aclanthology.org/2023.acl-long.1/`).
- PDF [CHK 200]: `https://aclanthology.org/N19-1423.pdf` -> append `.pdf` to the id, trailing slash removed. Derivable: **yes**. From DOI: `10.18653/v1/N19-1423` -> id `N19-1423` (suffix after `v1/`); `doi.org` of that redirected to the Anthology [CHK]. Same for `10.18653/v1/2020.acl-main.1` [MEM].
- Page has no `citation_pdf_url` in my grep output (the grep matched none) but the pattern above is enough.
- OA: everything. robots.txt: 404 (none) [CHK]. No bot wall seen.
- Good news: a perfect fit.

### SSRN
- Landing: `https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4412788`, also `https://ssrn.com/abstract=4412788`, `https://www.ssrn.com/abstract=4412788` [CHK via doi redirect]. PDF: `https://papers.ssrn.com/sol3/Delivery.cfm/SSRN_ID4412788_code...pdf?abstractid=4412788` needs a code [MEM]; not derivable.
- Protection: **Cloudflare challenge ("Just a moment...") 403** [CHK]. **Do nothing** (walled for us; the permitted-only rule applies).

### Semantic Scholar
- Landing: `https://www.semanticscholar.org/paper/<slug>/<40-hex sha>` [MEM; one request returned 202 with an empty-title JS shell [CHK]]. The arXiv id is not in the URL. `https://www.semanticscholar.org/arxiv/1706.03762` -> **404** [CHK] (that shape does not exist; I was wrong to propose it).
- API [CHK]: `https://api.semanticscholar.org/graph/v1/paper/arXiv:1706.03762?fields=title,openAccessPdf` returned **429 "apply for a key"** on first anonymous call. Outside the no-key rule in practice. Needs a lookup anyway.
- Verdict: do nothing (no id in URL; API rate-limited without a key).

### PMLR (DOI prefix not used; ICML/AISTATS/COLT)
- Landing [CHK 200]: `https://proceedings.mlr.press/v37/ioffe15.html`. PDF [CHK 200]: `https://proceedings.mlr.press/v37/ioffe15.pdf`. Derivable: **yes** (.html -> .pdf; for some volumes the PDF lives at `/v37/<name>/<name>.pdf`, the meta tag gives it; [MEM]). Page has `citation_pdf_url` = `http://proceedings.mlr.press/v37/ioffe15.pdf` [CHK] (note http, upgrade to https).
- robots: 404 (none) [CHK]. OA. No wall seen.

### NeurIPS proceedings
- Landing [CHK 200]: `https://papers.nips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html` (old host; also `https://proceedings.neurips.cc/paper/2017/hash/<hash>-Abstract.html`; newer years use `.../paper_files/paper/2023/hash/<hash>-Abstract-Conference.html`).
- PDF per `citation_pdf_url` [CHK]: `https://proceedings.neurips.cc/paper_files/paper/2017/file/3f5ee243547dee91fbd053c1c4a845aa-Paper.pdf`. Derivable by string: **yes** (hash and year are in the landing URL; the suffix is `-Paper.pdf` for old years, `-Paper-Conference.pdf` for newer, `-Paper-Datasets_and_Benchmarks*.pdf` for D&B tracks [MEM]), so a candidate list of 2-3 suffixes, or the meta tag.
- robots: 404 on both hosts [CHK]. OA. No wall seen.

### CVF Open Access
- Landing [CHK 200]: `https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html`. PDF: `.../content_cvpr_2016/papers/He_Deep_Residual_Learning_CVPR_2016_paper.pdf` (the meta tag points at the legacy `cv-foundation.org` host, which is a stale address [CHK]). Derivable: **yes** (`/html/X_paper.html` -> `/papers/X_paper.pdf`; newer years `content/CVPR2023/html/..._paper.html` -> `content/CVPR2023/papers/..._paper.pdf`) [MEM for the new-year form]. I did not fetch the PDF URL itself. robots 404 [CHK]. OA.

### JMLR
- Landing [CHK 200]: `https://jmlr.org/papers/v15/srivastava14a.html`. PDF per meta: `http://jmlr.org/papers/volume15/srivastava14a/srivastava14a.pdf`. Derivable: yes (`v15/<name>.html` -> `volume15/<name>/<name>.pdf`). robots 404 [CHK]. OA.

### AAAI / IJCAI
- AAAI: `https://ojs.aaai.org/index.php/AAAI/article/view/<articleId>`; PDF is `/article/download/<articleId>/<galleyId>` needs the galley id [MEM]. Not derivable. Needs the meta tag.
- IJCAI: `https://www.ijcai.org/proceedings/2023/0001` -> `.../2023/0001.pdf` [MEM, derivable: unverified]. DOI prefix 10.24963 [CHK prefix name].

### Nature (10.1038)
- Landing [CHK 200]: `https://www.nature.com/articles/s41586-021-03819-2` (CHECK: the final URL gained `?error=cookies_not_supported&code=...` because I sent no cookies; harmless but notable). Body 617 KB, full article text present for this OA paper. `citation_pdf_url` = `...s41586-021-03819-2.pdf` and the `.pdf` URL returned 200 [CHK].
- Derivable: yes (`.pdf` suffix) but for subscription articles the PDF is paywalled: I only tested an OA paper. I did not test a paywalled Nature article.
- robots [CHK]: disallows /search, `/*/figures`, `/*/tables`, `/*/metrics`, `*.otmi`, `/*proof=*`, etc. Does not disallow `/articles/<id>` or `.pdf` as far as the first lines show. (Nature's lines were cut at 25; I did not read the rest.)
- OA share: Nature Communications and Scientific Reports are fully OA [MEM]; Nature itself is mixed.

### Science / AAAS (10.1126), PNAS (10.1073), ACM (10.1145), ScienceDirect (10.1016), Wiley (10.1002)
- Landing shapes [MEM, plus CHK status]: Science `https://www.science.org/doi/10.1126/science.abj8754` (403 [CHK]); PNAS `https://www.pnas.org/doi/10.1073/pnas.1717883115` (403 [CHK]); ACM `https://dl.acm.org/doi/10.1145/3292500.3330701` -> PDF `https://dl.acm.org/doi/pdf/10.1145/3292500.3330701` (derivable from DOI by string, but both 403 with Cloudflare "Just a moment..." [CHK]); ScienceDirect `https://www.sciencedirect.com/science/article/pii/S0004370221000862` (403 [CHK]); Wiley `https://onlinelibrary.wiley.com/doi/full/<doi>` and `/doi/pdf/<doi>` [MEM, untested].
- **Do nothing** for these: walled by Cloudflare/bot checks from here, and many are paywalled. (ACM has a large OA portion now [MEM].) Not tested: Wiley, T&F, Sage, OUP, Cell. Mention for completeness: all likely Cloudflare/Akamai [MEM, unverified].

### Springer Link (10.1007, 10.1186) 
- Landing: `https://link.springer.com/article/10.1007/s10994-021-06121-4`. PDF: `https://link.springer.com/content/pdf/10.1007/s10994-021-06121-4.pdf` [MEM, derivable from DOI; not tested].
- [CHK] GET returned a 3 KB "Client Challenge" page (JS required) - no content. robots.txt body existed (3 KB) but I did not read its rules. **Blocked from here.** BMC / Springer Open (10.1186) articles are on `*.biomedcentral.com` etc. [MEM].

### PLOS (10.1371)
- Landing [CHK 200, 170 KB, full text in page]: `https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0000308`. Landing IS the full text. PDF per meta [CHK]: `https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0000308&type=printable`.
- From DOI alone: `plosone` is the journal slug, taken from the DOI's `journal.pone.` part: `pone`->`plosone`, `pbio`->`plosbiology`, `pcbi`->`ploscompbiol`, `pgen`->`plosgenetics`, `ppat`->`plospathogens`, `pntd`->`plosntds`, `pmed`->`plosmedicine`, `pdig`->`digitalhealth`, `pclm`->`climate` [MEM; only pone verified]. `doi.org/<doi>` also redirects [CHK].
- robots [CHK]: `Crawl-delay: 30`; disallows */search, */article/metrics, */user. OA 100%.
- Verdict: do nothing for landing pages (the full text is already there), only the extra case "DOI link" needs the doi.org redirect, which the fetcher follows anyway.

### eLife (10.7554)
- Landing: `https://elifesciences.org/articles/88891`. Landing IS the full text (OA).
- [CHK] **406 Not Acceptable** with a Chrome-like UA; with the default curl UA, a **3 KB "Client Challenge"** page like Springer's (fs-ch). I never got article text. Also `doi.org/10.7554/eLife.88891` 404 (my example id may not exist). robots [CHK]: `Crawl-delay: 10`, `Disallow: /search`, `/download/`; Amazonbot etc. blocked. eLife also exposes an API `https://api.elifesciences.org/articles/<number>` [MEM, untested; no key].
- DOI -> URL by string: `10.7554/eLife.88891` -> `https://elifesciences.org/articles/88891` [MEM, pattern is well-known]; not testable because of the block.

### Frontiers (10.3389)
- Landing [CHK 200, 808 KB, full text]: `https://www.frontiersin.org/articles/10.3389/fpsyg.2013.00863/full` (redirects to `.../journals/psychology/articles/10.3389/fpsyg.2013.00863/full`). PDF per meta [CHK]: `.../journals/psychology/articles/10.3389/fpsyg.2013.00863/pdf`. Landing IS full text; do nothing. robots [CHK]: `Allow: /`.

### MDPI (10.3390)
- Landing: `https://www.mdpi.com/2072-6643/12/1/1` (ISSN/vol/issue/article). Full text on the landing page; `/htm` and `/pdf` suffixes [MEM].
- [CHK] **403 "Access Denied" (Akamai-style)** for both URLs from here. Do nothing (blocked); landing page is already the full text for browsers, but we cannot fetch it from this IP.

### IEEE Xplore (10.1109)
- `https://ieeexplore.ieee.org/document/7780459`; PDF `https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=7780459` (needs auth for most) [MEM]. [CHK] HEAD returned 202 (JS shell). Do nothing.

### Oxford Academic, T&F, Sage, JSTOR, Cell
- Not tested. [MEM] all heavily bot-protected and mostly paywalled; JSTOR is login-gated. Do nothing.

### ResearchGate, Academia.edu, Google Scholar, Connected Papers, Unpaywall, DBLP, scholar.archive.org, CORE
- ResearchGate: `https://www.researchgate.net/publication/<id>_<title>` Cloudflare + login [MEM]; do nothing. Academia.edu: login wall [MEM]; do nothing.
- Google Scholar: result and "scholar_url" links are redirects to a publisher; `scholar.google.com/scholar?q=` is a search page, robots disallows /scholar [MEM]. Handle only by following a `scholar_url?url=<target>` param if we ever want to (string work, [MEM]).
- DBLP: `https://dblp.org/rec/conf/nips/VaswaniSPUJGKP17.html` gives bibliographic metadata and an `ee` link out; no full text; do nothing.
- Connected Papers: graph page; do nothing.
- Unpaywall: API `https://api.unpaywall.org/v2/<doi>?email=...` needs an email param, no key; outside "no outside service" and a lookup. Skip.
- scholar.archive.org: `https://scholar.archive.org/work/<ident>` (200 for even a bogus id [CHK], so a loose shape) is a Fatcat/IA page; full text is a `web.archive.org` or `scholar.archive.org/...pdf` link inside; not derivable. Do nothing.
- CORE: `https://core.ac.uk/download/pdf/<id>.pdf` and `core.ac.uk/reader/<id>` [MEM; ids are CORE-internal]. Not derivable from a DOI; skip.

### NBER
- Landing [CHK 200]: `https://www.nber.org/papers/w25555`. PDF per meta [CHK]: `https://www.nber.org/system/files/working_papers/w25555/w25555.pdf`. Derivable: **yes** (`wNNNNN` repeated; I did not fetch the PDF). Old `papers.nber.org/papers/w25555` / `www.nber.org/papers/w25555.pdf` redirect forms [MEM]. Free to read for recent papers (some are gated to subscribers in the first months, [MEM]). robots [CHK]: allow-all except /core/ /profiles/ /admin/ etc.

### RePEc / IDEAS
- `https://ideas.repec.org/p/nbr/nberwo/25555.html` -> links out; no PDF string-derivable. Do nothing.

### OSF Preprints / PsyArXiv / SocArXiv (10.31234, 10.31219, 10.31235 = Center for Open Science)
- Landing [CHK 200 but a 4 KB JS shell, title "OSF"]: `https://osf.io/preprints/psyarxiv/6kpgc`. Download: `https://osf.io/<id>/download` - [CHK] returned the same 4 KB HTML shell (SPA), not a PDF. `https://api.osf.io/v2/preprints/6kpgc/` returned 404 (my id guess or wrong shape). Older `https://psyarxiv.com/6kpgc/` [MEM].
- robots [CHK]: `Disallow: /api/*`, `crawl-delay: 10`; blocks GPTBot, PerplexityBot, Meta-ExternalAgent.
- Verdict: not workable by string; needs the OSF API (`api.osf.io`) and that is blocked for `/api/*` by robots. **Do nothing** for now.

### ChemRxiv (10.26434 is ACS-held)
- `https://chemrxiv.org/engage/chemrxiv/article-details/60c7588e469df44a40f4536d`: 403 Cloudflare [CHK]. Do nothing.

### Research Square (10.21203), Preprints.org (10.20944 MDPI)
- Not fetched. `https://www.researchsquare.com/article/rs-123456/v1` [MEM]; PDF `.../v1.pdf`? unverified. Low priority.

### Zenodo (10.5281, DataCite)
- Landing: `https://zenodo.org/records/3908672` -> 403 from me; `zenodo.org/api/records/<id>` also 403 [CHK]. Files at `https://zenodo.org/records/<id>/files/<name>?download=1` [MEM] need the filename. Do nothing (not derivable, 403 here). Note: DOI prefix 10.5281 is DataCite and `api.crossref.org/prefixes/10.5281` errored [CHK].

### HAL
- `https://hal.science/hal-01234567` -> `https://hal.science/hal-01234567/document` [MEM, derivable by string; untested]. Low audience fit.

### PhilPapers / PhilArchive
- `https://philpapers.org/rec/XXXXX` -> `https://philarchive.org/archive/XXXXX` [MEM]; untested. Niche; note for a "AI-philosophy" crowd.

### IACR ePrint
- `https://eprint.iacr.org/2019/001` (200 [CHK]) -> `https://eprint.iacr.org/2019/001.pdf` (**403 Cloudflare challenge** from me [CHK]). Derivable but blocked. Do nothing.

### ECCC
- `https://eccc.weizmann.ac.il/report/2019/001/` -> `.../download` [MEM]; untested; niche.

## 4. Mapping-only sources (an arXiv paper rendered elsewhere)

All [CHK] from this box on 2026-10-05, for arXiv id `1706.03762`:

| Page | URL shape | arXiv id in the URL? | Result |
|---|---|---|---|
| Hugging Face paper page | `https://huggingface.co/papers/1706.03762` | yes (path) | 200; links to `arxiv.org/abs/1706.03762` and `/pdf/` |
| alphaXiv | `https://www.alphaxiv.org/abs/1706.03762` (also `/overview/<id>` [MEM]) | yes (path) | 200; has `citation_arxiv_id` meta = `1706.03762` |
| ar5iv | `https://ar5iv.labs.arxiv.org/html/1706.03762` and `https://ar5iv.org/abs/1706.03762` (redirects to the former) | yes | 200. ar5iv is itself the full text as HTML (arXiv Labs). Mapping to `arxiv.org/abs/<id>` is the cleaner target |
| arXiv Vanity | `https://www.arxiv-vanity.com/papers/1706.03762/` | yes | **redirects to ar5iv** (200) |
| Papers with Code | `https://paperswithcode.com/paper/attention-is-all-you-need` | **no** (slug only) | **redirects to `https://huggingface.co/papers/1706.03762`** [CHK]; so no longer a separate target: the redirect carries the id. Needs a fetch to follow; slug alone does not give the id |
| Semantic Scholar | `https://www.semanticscholar.org/arxiv/<id>` | n/a | **404** [CHK]; real pages use `/paper/<slug>/<sha>`, no arXiv id |
| scholar.archive.org | `/work/<ident>` | no | not mappable |
| DOI form | `https://doi.org/10.48550/arXiv.1706.03762` | yes | 302 -> `arxiv.org/abs/1706.03762` [CHK]. Prefix 10.48550 is DataCite [CHK] |
| OpenReview | | no | not a mirror. Many ICLR papers have an arXiv copy but the forum URL carries no arXiv id |

robots: huggingface `Allow: /` [CHK]; alphaXiv allow `/` but disallows `/?` and `/signin?` [CHK]; ar5iv `Disallow: /log/` [CHK]. (Reminder: arXiv's own robots disallows `/e-print`, `/src`, `/ps`, `/dvi`; allows `/abs`, `/pdf`, `/html`; Crawl-delay: 15 [CHK].)

Old-style arXiv ids (`hep-th/9901001`) appear in the same mirror URLs [MEM].

## 5. DOI prefixes

Name from `https://api.crossref.org/prefixes/<prefix>` [CHK] or `https://doi.org/doiRA/<prefix>` [CHK].

| Prefix | Owner | Statically identifies the host? |
|---|---|---|
| 10.1101 | Cold Spring Harbor Laboratory | bioRxiv **and** medRxiv (and older CSH journals, e.g. Genome Research, Cold Spring Harb Protoc, which use 10.1101/gr.*, 10.1101/cshperspect.*, 10.1101/lm.*). Preprint DOIs are `10.1101/<yyyy.mm.dd.nnnnnn>` (bioRxiv: `YYYY.MM.DD.NNNNNN`; medRxiv: `YYYY.MM.DD.NNNNNNNN` 8 digits [MEM, consistent with the two examples: bioRxiv 2020.03.22.002386 has 6, medRxiv 2020.02.25.20021568 has 8]). Heuristic, [MEM] |
| 10.48550 | DataCite (arXiv) | yes: `10.48550/arXiv.<id>` [CHK redirect] |
| 10.1371 | PLOS | yes, and journal from `journal.<code>.` |
| 10.7554 | eLife | yes (`10.7554/eLife.<n>`) |
| 10.3389 | Frontiers | yes, but the URL needs the journal slug in new form; old `/articles/<doi>/full` still redirects [CHK] |
| 10.3390 | MDPI | yes; DOI `10.3390/nu12010001` does not give the URL path (needs ISSN, vol, issue); doi.org redirect needed. Not derivable |
| 10.1038 | Springer Nature | Nature portfolio: `10.1038/s41586-021-03819-2` -> `nature.com/articles/<suffix>` [CHK]; derivable for `10.1038/s4*` ids [MEM] |
| 10.1145 | ACM | yes; `dl.acm.org/doi/<doi>` and `/doi/pdf/<doi>` derivable, but 403 [CHK] |
| 10.1109 | IEEE | host yes; the article number is not in the DOI. Not derivable |
| 10.2139 | **Elsevier BV (SSRN registers under Elsevier)** | yes: `10.2139/ssrn.<id>` [CHK via Crossref name]; doi.org -> ssrn.com/abstract=<id> [CHK]; then Cloudflare wall |
| 10.31234 | Center for Open Science (PsyArXiv) | yes; ids are OSF ids. 10.31219 = OSF Preprints; 10.31235 = SocArXiv [CHK names] |
| 10.26434 | **American Chemical Society** (ChemRxiv is run with ACS et al.) | host yes (ChemRxiv), but the same prefix may be used by other ACS-run products [MEM] |
| 10.18653 | ACL | yes: `10.18653/v1/<anthology id>` -> `aclanthology.org/<id>/` [CHK]; `.pdf` [CHK] |
| 10.3115 | ACL (older, pre-2016) | same idea; `10.3115/v1/<id>` [MEM for the id mapping] |
| 10.21203 | Research Square | yes (`10.21203/rs.3.rs-<n>/v1`) |
| 10.5281 | DataCite (Zenodo, also CERN) | yes; `10.5281/zenodo.<id>` -> `zenodo.org/records/<id>` [MEM]; 403 anyway |
| 10.1126 | AAAS (Science) | yes; 403 |
| 10.1016 | Elsevier | host yes but needs the PII; not derivable |
| 10.1007 / 10.1186 / 10.1038 | Springer Nature | 10.1007 -> `link.springer.com/article/<doi>` [MEM] |
| 10.1002 | Wiley | `onlinelibrary.wiley.com/doi/<doi>` |
| 10.1073 | PNAS | |
| 10.1093 | Oxford University Press | |
| 10.1080 | Informa (Taylor & Francis) | |
| 10.1177 | SAGE | |
| 10.1162 | MIT Press (TACL, Neural Comp, Open Mind) | |
| 10.24963 | IJCAI | `ijcai.org/proceedings/<yyyy>/<nnnn>` from `10.24963/ijcai.<yyyy>/<n>` [MEM] |
| 10.1103 | APS; 10.1021 ACS; 10.1056 NEJM; 10.1136 BMJ; 10.1017 CUP; 10.1257 AEA; 10.7717 PeerJ; 10.3847 AAS; 10.1523 SfN; 10.21105 Open Journals (JOSS); 10.22541 Authorea | |
| 10.20944 | MDPI AG (Preprints.org) | |
| 10.31124 | SAGE (Sage preprints) | |
| 10.5555 | "Test accounts" (placeholder prefix; unusable) [CHK] | |

Not found by me: DOI prefixes for NeurIPS proceedings, PMLR, OpenReview, CVF, JMLR (they do not issue DOIs or use IEEE/ACM ones). PMLR/NeurIPS/JMLR papers are linked by their own URL, not a DOI.

**Derive-from-DOI-alone with no fetch (beyond arXiv): ACL, PLOS (journal slug from DOI), eLife (number from DOI, unverified), Nature (s4* ids), Frontiers (old URL redirects), IJCAI (unverified), bioRxiv/medRxiv (host ambiguous; try both).** bioRxiv's DOI-to-URL is `https://www.biorxiv.org/content/<doi>` [CHK] (+ `v1`, `.full`, `.full.pdf`).

## 6. Proposed ranking (worth code), and "do nothing" list

Scoring: (frequency for our audience) x (how badly the landing page loses the paper) x (simple and permitted), my judgement.

**Top 10 for worth code:**
1. **Hugging Face papers / alphaXiv / ar5iv / arXiv-Vanity / PwC redirect** (mapping to arXiv): most frequent for AI readers; the arXiv id is in the URL; all pure string work. Needs only the arXiv step to exist.
2. **doi.org DOI links with 10.48550 / 10.18653 / 10.1371 / 10.1038 / 10.3389**: the DOI prefix gives the host, and some give the URL. Cheap, high coverage, and 10.48550 maps to arXiv.
3. **ACL Anthology**: `.pdf` appended, no wall, no robots, OA. Cleanest rule found.
4. **PMLR**: `.html` -> `.pdf`, no wall.
5. **NeurIPS proceedings**: hash in the URL; one or two suffix candidates; no wall.
6. **CVF Open Access**: `/html/X.html` -> `/papers/X.pdf`; no wall.
7. **bioRxiv** (landing -> `.full` or `.full.pdf`): works from here; Cloudflare-prone; **medRxiv** same rule but 403 now (include both; fail cleanly).
8. **JMLR and NBER**: simple rewrites, OA/free, no wall; medium frequency.
9. **OpenReview** `/forum?id=X` -> `/pdf?id=X`: very common for AI readers and the rewrite is trivial, but I got a challenge page and a 403 from the PDF URL. Worth a candidate entry only if tested from the production network; otherwise rank lower. **Unproven.**
10. **PMC / Europe PMC / PubMed** via Europe PMC REST `fullTextXML` or the PMC page: common for science-curious readers; the PMCID is in the URL for PMC and Europe PMC; PubMed needs a lookup. PMC's own page needs care (crawler policy; UA-sensitivity). Rank it 10 on frequency vs policy risk.

Cheap extras: PLOS/Frontiers/Nature OA pages need nothing; IJCAI, HAL, PhilArchive guessed rewrites are niche.

**Do nothing:**
- **PMC, PLOS, eLife, Frontiers, MDPI, Nature OA, ar5iv**: the landing page is already the full text (blocks aside).
- **SSRN, medRxiv (today), ChemRxiv, ACM, ScienceDirect/Elsevier, Science, PNAS, IACR ePrint PDF, Zenodo, MDPI, Springer Link, eLife (from the test box)**: Cloudflare/Akamai/JS challenge or 403 from here. We will not get round a bot wall.
- **IEEE, Wiley, T&F, Sage, OUP, JSTOR, Cell**: paywalled (mostly) and bot-protected [MEM].
- **ResearchGate, Academia.edu**: login/Cloudflare.
- **OSF/PsyArXiv/SocArXiv**: SPA shell, API disallowed by robots.
- **Semantic Scholar, Connected Papers, DBLP, Google Scholar, scholar.archive.org, CORE, Unpaywall, RePEc**: no id-derived full text; or need an API/key.
- **Papers with Code**: now redirects to Hugging Face, so a fetch redirect solves it (no code of ours).

## 7. Surprises

1. Papers with Code and arXiv Vanity both now redirect: PwC -> `huggingface.co/papers/<arxiv id>` and arxiv-vanity -> ar5iv [CHK]. A registry entry for those is a freebie only after one redirect hop.
2. PMC served a **challenge shell to a Chrome-like UA** but the real article to `curl/8` [CHK]; browser-like headers made it worse. And PMC's FAQ says systematic downloading from the main site is prohibited [SRC].
3. SSRN's DOI prefix 10.2139 is registered to **Elsevier BV**, and 10.26434 (ChemRxiv) to the American Chemical Society [CHK]; and bioRxiv worked while medRxiv (same org, same DOI prefix) was walled. Also Springer Link and eLife both returned the same JS "Client Challenge" page from this box.

## 8. Method / commands used (so the claims can be re-run)

- Status/redirect checks: `curl -sIL -m 20 -A "<Chrome-like UA>" -o /dev/null -w '%{http_code} %{url_effective}\n' <url>` and GET equivalents saving the body and grepping for `<meta name="citation_pdf_url">`.
- robots: `curl -sL https://<host>/robots.txt`, grepped for user-agent/disallow/allow/crawl-delay lines, first 25 lines shown for long files (so long files are not fully read).
- Prefix owners: `https://api.crossref.org/prefixes/<prefix>`; registration agency `https://doi.org/doiRA/<prefix>`.
- Scripts were in the session scratchpad, not committed.
