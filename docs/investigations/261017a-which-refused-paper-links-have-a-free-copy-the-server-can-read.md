# Which refused paper links have a free copy the server can read

Up: [investigations.md](../project/investigations.md)

The measurement Greg's reply asked for before building option A of
[q-fp8tqr](../user-feedback/questions/q-fp8tqr.md) (find a free copy automatically when a site
turns us away). His reply, `spya-wm83gt`, 2026-10-17:

> A and/or B as you see fit. Look for a way that's clean and good for the user.

The plan that acts on it is
[261017b](../plans/261017b-a-refused-site-the-free-copy-and-the-bookmarklet-after-greg-s-reply.md);
the earlier research is
[261015a](../research/261015a-getting-a-page-behind-a-bot-check-extensions-bookmarklets-open-access-copies.md).

## The sample is built, not drawn from readers

The plan said "twenty real refused links". Production has one: `spideryarn.jobs` keeps 24 import
jobs (older ones are pruned), and the only refusal among them is Greg's cell.com link (read-only
query, 2026-10-17, `Target: aws-0-eu-west-2.pooler.supabase.com:6543`). So a Sonnet subagent
assembled 36 real article pages, with their DOIs checked in Crossref, from 20 publishers that
commonly wall automated readers: roughly half open access and half closed, mostly psychology,
neuroscience, medicine and economics. Greg's own link makes 37. **This sample leans towards the
life sciences**, where PubMed Central is strongest, so the share below is likely an upper bound for
a general reader.

## How

From the box, 2026-10-17. The scripts are kept as `.ts.txt` so the typecheck does not take them
for a project's code; copy one to `.ts` to run it again. [`probe.ts`](261017a-evidence/probe.ts.txt): our own `fetchDocument` on each
pasted address (one attempt), `challengeIn` on any HTML, and OpenAlex through
`fetchBibliographicJson`. [`epmc.ts`](261017a-evidence/epmc.ts.txt): Europe PMC's search by DOI for a
PMCID and its open-access flag, then `fullTextXML` for that PMCID, and OpenAlex's open repository
locations. Input [`sample.tsv`](261017a-evidence/sample.tsv), output
[`results2.json`](261017a-evidence/results2.json).

## What it found

Counted mechanically from `results2.json` (a 2xx HTML answer under 5,000 bytes is a stub; the
count was wrong by hand in the first draft, and GPT Sol's plan review caught it):

| | Links |
|---|---|
| Sample | 37 |
| Refused with a `403` (Cloudflare's challenge, by its headers, bar ScienceDirect's own) | 23 |
| Refused in effect: a 2–3 KB challenge page (IEEE ×2, JSTOR ×2, Springer ×2), which `challengeIn` does not recognise | 6 |
| Imported normally (Cambridge ×2, PLOS ×2, Nature ×3, Frontiers) | 8 |
| **Refused: 29**, of which | |
| — full text from Europe PMC's fixed XML endpoint | **6** (cell.com TICS, SAGE, PNAS, OUP Brain, ACS, BMJ) |
| — open access by OpenAlex's flag, copy elsewhere only (a university repository, SSRN, DOAJ, a publisher OA page that also refuses us); **those copies were not fetched** | 8 |
| — open copy on arXiv | 0 |
| — closed by OpenAlex's flag | 15 |

- **OpenAlex does not give the PMCID** for any of the 37, Greg's paper included (`ids` lacks
  `pmcid`), so DOI → PMCID needs Europe PMC's own search, at `www.ebi.ac.uk`.
- **A PMCID is not enough.** The Neuron paper has one (PMC10524518) but is not in the open-access
  subset, and its `fullTextXML` answers 500.
- **Every readable copy is JATS XML**, from `www.ebi.ac.uk` (`application/xml`) or the PMC
  open-data bucket on S3 (`binary/octet-stream`); neither offers a PDF for Greg's paper.
- **Not recorded**: each copy's licence, and whether it is the published version or an accepted
  manuscript.
- The six 2–3 KB pages are a separate finding. IEEE answers a request that accepts HTML, as ours
  does, with **202** and a 2,058-byte AWS WAF challenge page, and a request with no `Accept` header
  with an empty 202: three runs of each, with status, final address, type, length and hash, in
  [`ieee-status.txt`](261017a-evidence/ieee-status.txt) (from
  [`ieee-status.ts`](261017a-evidence/ieee-status.ts.txt)). Springer and JSTOR answer 200 with the same
  3,038-byte "Client Challenge" page, bar a token. `fetchDocument` accepts all three as HTML;
  stage 2 then refuses them as too little text, or as no article, not as bot checks. The captured
  pages are in the evidence folder.

## What it means for option A

**The narrow result: Europe PMC's fixed XML endpoint recovered 6 of the 29 refusals in this
constructed sample.** That is not a reader success rate: the sample was built about half open
access, and leans to the life sciences. The 8 open copies held elsewhere were not fetched, so A's
wider coverage is unknown, not zero. The other 15 had no open-access location known to OpenAlex
in this measurement; no other finder was tried, so whether anything automatic could reach them is
unknown too. What is certain is that A does nothing for a news site or a blog. Where it works, it works for free and with no step by the
reader.

**Building it means editing `src/fetch.ts`**, which
[security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
lists as a defence. The smaller of the two designs (Sol's suggestion) is a fixed-host, capped
Europe PMC door like `fetchBibliographicJson`, for the search (JSON) and the `fullTextXML` (XML),
followed by a JATS→HTML converter, rather than widening `fetchDocument`'s two document kinds. So
under the rules of this run it is written up for Greg rather than built.
