# Sources digest: how others show a paper's citations and reception

Owned by [research.md](../project/research.md). Report `spya-vqmfrs` (#740), session
`fbvqmfrs-sources-digest`. Written 2026-10-30, one pass by a Sonnet web-research subagent, checked
against the plan it feeds: [261030b](../plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md).

**What this is for.** Greg asked for a *sources digest*: one readable text about a piece's outbound
citations and links, its inbound ones, what it should have cited, and what it cites that does not
say what it claims, built from many web searches read by small-model sub-agents and written by a
big one, and asked us to look at how others have done it. This adds to
[261024a](261024a-situating-a-paper-in-the-literature-how-researchers-read-and-check.md), which
covered how researchers situate a paper; it does not repeat it.

## What we take from it, in short

1. **Nobody we found writes a prose digest.** The tools show badges, counts and a snippet under a
   claim. A text that reads like Summary's Fuller, tied to the passages, is new ground; the risk is
   that prose hides how thin the evidence for a sentence is, so every paragraph keeps its sources one
   press away.
2. **Readers return quotes; code checks them.** Ai2 Scholar QA extracts per-paper quotes before it
   synthesises, and Anthropic's research system adds citations in a separate pass. Ours: each reader
   returns a verbatim quote from a page the run fetched, the code checks it against that page's
   text, and the writer may cite only checked quotes.
3. **"Worth checking", not "wrong".** People miscite often (about 1 in 7 to 1 in 4 citations do not
   clearly support their claim, below), but an LLM judge gives false "supported" when support is
   partial, and false "does not support" when it has only an abstract. So the fourth section is
   headed as something to check, and *partly* is a verdict of its own.
4. **Cap the fan-out.** Multi-agent research spends about 15× the tokens of a chat. Its failure
   modes are too many sub-agents for a simple question, endless searching for something that does
   not exist, and preferring SEO pages to papers. So the plan fixes the number of leads, the searches
   per lead and the follow-ups, rather than letting a model decide them.

## Products

- **scite** ([help](https://help.scite.ai/en-us/category/getting-started-l8jc5a)): *Smart
  Citations* label each citing sentence supporting, contrasting or mentioning, with the snippet
  around it. Works from full text, so coverage is limited to publisher deals and preprint servers.
  The nearest thing to our inbound half and to "does the citation say that". (Its own help page
  failed to load; details are from third-party descriptions.)
- **Semantic Scholar** ([paper](https://arxiv.org/pdf/2301.10140)): TLDRs, citation intent
  (background, method, result) and "highly influential citations", which the paper describes as a
  heuristic and some third-party guides call ML.
- **Semantic Reader** ([site](https://openreader.semanticscholar.org/),
  [CACM](https://cacm.acm.org/research/the-semantic-reader-project)): press an inline citation
  for a card with the abstract and TLDR; *Skimming Highlights* (goal, method, result) with density
  the reader can turn up and down. The model for our block-link card, which we already have.
- **Elicit**: a table with a source quote under every cell. **Consensus**: a colour "meter" of
  agreement, a heuristic. **Undermind**: an iterative citation-trail search, criticised as opaque.
  (All three from [a third-party comparison](https://casrai.org/compare/elicit-vs-consensus).)
- **Ai2 Scholar QA** ([paper](https://arxiv.org/html/2504.10861v2)): retrieve, rerank, extract
  quotes per paper, cluster, outline, write. The answer has sections that open and citations that
  reveal their excerpt: the nearest layout to the digest.
- **OpenScholar** ([paper](https://arxiv.org/abs/2411.14199)): GPT-4o without retrieval invented
  citations 78–90% of the time. The reason every source the digest shows must be one the run
  fetched.

Not confirmed in this pass: Connected Papers, Litmaps, ResearchRabbit, Paper Digest, alphaXiv,
SciSpace, and the layout of OpenAI's, Google's and Perplexity's deep research.

## How often citations are wrong

| Field | Citations that do not clearly support the claim | Source |
|---|---|---|
| Marine biology | 6% no support, 10.6% ambiguous | [MEPS 408](https://www.int-res.com/abstracts/meps/v408/p299-303/) |
| Physical geography | at least 19% | (third-party summary) |
| History journals | 24.3% | [report](https://themichiganstar.com/news/nearly-one-in-four-history-journal-citations-are-inaccurate-study/mistarstaff/2023/07/16/) |
| Top science journals | about 1 in 4 wrong or misleading | [THE](https://timeshighereducation.com/news/quarter-citations-top-journals-wrong-or-misleading) |
| Mogull's review of 15 studies | 14.5% | (secondary) |

No pooled meta-analysis was found. **Automated checks**: CiteAudit
([arXiv 2602.23452](https://arxiv.org/abs/2602.23452)) is claim extraction, evidence retrieval,
passage matching, reasoning, verdict, the same shape as our reader; an ICCS 2025 paper
([pdf](https://www.iccs-meeting.org/archive/iccs2025/papers/159110235.pdf)) finds LLMs give false
entailment when a claim is only partly supported. Audits of AI answer engines (DeepTRACE, arXiv
2509.04499; Rao et al. 2026, arXiv 2604.03173) find citation accuracy of roughly 40–80% by system
and invented URLs in 3–13% of answers, worst in deep-research agents, which cite the most.

## Planner, many readers, one writer

- **Anthropic's multi-agent research system**
  ([post](https://www.anthropic.com/engineering/multi-agent-research-system)): an Opus lead with
  Sonnet sub-agents beat a single Opus agent by 90.2% on their eval, at about 15× a chat's tokens;
  token use explained 80% of the variance on BrowseComp. Effort scales with the question: one agent
  and 3–10 calls for a simple one, 2–4 sub-agents with 10–15 calls each for a comparison. Failures
  were 50 sub-agents for a simple question, endless searches for sources that do not exist,
  duplicated work, and SEO farms preferred to academic PDFs; the fixes were tight briefs (objective,
  output format, boundaries) and sub-agents that write to a store and hand back references.
- **STORM** ([arXiv 2402.14207](https://arxiv.org/abs/2402.14207)): the writer inherits the
  sources' bias, and links facts that are not related.
- **Scholar QA**: the writer works from extracted quotes, not whole pages.

## Ways to show it, already proven elsewhere

A card on a citation (Semantic Reader); a section that opens, with a citation revealing its
excerpt (Scholar QA); a quote under each claim (Elicit); a badge with the citing sentence (scite);
highlight density the reader controls (Semantic Reader). The digest takes the second and third:
short paragraphs whose *More* opens the detail and the quoted sources.
