# Situate spike: many cheap searches, one read — what it finds and what it costs

Owned by [investigations.md](../project/investigations.md). Report `spya-w95xmq` (#689), session
`fbw95xmq-sources-situate`, 2026-10-24. The plan it informs is
[261024o](../plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md).

**The question.** Greg's shape for situating a piece in the literature: *"a crapload of web searches
for each article and for the claims, and then feeding all of that in … as a gigantic input to a
small or medium-sized model like Haiku or Sonnet, along with the article … and make use of prompt
caching"*. Does one read over everything find things worth a margin note, which model, and at
what cost?

## How it was run

- `scripts/spikes/261024b-situate-dump.ts <slug>` copies one production article's blocks and
  Bibliography to `output/situate-spike/` in a **read-only transaction** (verified TLS,
  `.env.prod`). `--list` lists recent articles. Nothing is written to production.
- `scripts/spikes/261024b-situate-spike.ts <slug> --reader sonnet|haiku [--reuse]`, under
  `withLedger("eval")`:
  1. **plan**: Sonnet 5.5 reads the title, headings, the first 12,000 characters and the 20
     most-relied-on cited works, decides kind, year and angle (`since` / `now`), and writes ~16
     queries (a quarter on the piece, half on its claims, the rest on citations and omissions);
  2. **search**: each query is one forced Exa search on the quick tier (`searchWebRequest`, the
     `search_web` subagent's request), eight at a time, keeping the search's extracts; plus
     OpenAlex's 40 most-cited citing works with abstracts, when the slug yields a DOI;
  3. **read**: one call, the whole article behind a cache breakpoint, then every extract (clipped to
     2,500 characters) and citing work, then the instructions: up to 14 findings anchored by a
     quote, an overview and five questions;
  4. **check**: a finding is kept only if its quote is in its block and every source id exists.
- Output (gitignored, holds prose): `output/situate-spike/<slug>-{gathered.json,sonnet.md,haiku.md}`.

## Results

| Article | Kind, angle | Searches → pages | Citers | Read | Findings kept | Whole run |
|---|---|---|---|---|---|---|
| Butlin, Long et al., *Consciousness in AI* (2023), 38,400 words | review, since | 17 → 76 pages, 144k chars | 40 of 196 | Sonnet, 134k tokens in, 38 s, $0.363 | 12 of 12 | **$0.518, 63 s** |
| same evidence | | | | Haiku 5.5, $0.047 (with 85k tokens read from cache) | 8 of 11 | — |
| Webb et al., *Emergent analogical reasoning* (2023) | empirical, since | 16 → 64, 136k chars | 0 (no DOI from the slug) | Sonnet, 75k in, 33 s, $0.216 | 11 of 11 | **$0.362** |
| *Pain representations in LLMs* (2026 preprint) | empirical, now | 16 → 72, 142k chars | 0 | Sonnet, 76k in, 44 s, $0.227 | 14 of 14 | **$0.375** |

The searches are about $0.007 each (Exa through OpenRouter, plus a few hundred quick-tier tokens),
so 16 of them are about $0.12. **The read is most of the bill**, and most of the read is the extracts,
not the article.

**What it found** (the full lists are in the output files; three examples per article):

- *Consciousness in AI*: the 2025 *Nature* adversarial collaboration's challenge to global workspace
  theory, beside the passage on ignition; the 2023 letter calling IIT pseudoscience, four of whose
  lead signatories are this report's authors, beside the passage that sets IIT aside; Seth's 2025
  *BBS* critique of the neural-replacement argument, beside the footnote that leans on it.
- *Analogical reasoning*: Hodel & West and Lewis & Mitchell's counterfactual alphabets, under
  which GPT's performance fell while humans' held, beside "GPT-3 showed stronger overall
  performance"; Webb et al.'s 2024 reply; Schaeffer et al.'s "mirage" argument, beside the word
  *emergent*.
- *Pain axis*: an independent re-run whose random-vector control led the authors to withdraw v1's
  headline in v2; a reproduction of the numbers (cosine 0.9996); and a **citation** finding: the
  piece cites Seligman & Maier (1967) for passive coping, and Maier & Seligman's own 2016 review
  says the original theory "got it backward".

These are the notes Greg called gold: things a careful reader would not otherwise know to look for,
each beside its passage and each with its source. No finding failed the code check on Sonnet.

**Haiku 5.5** wrote 11 findings on the same evidence, lost 3 to the quote check, and called the
2023 IIT letter and the 2025 *Nature* paper something the 2023 report "omits", which it could not
have cited. It also found one good citation finding Sonnet missed (a cited 2022 paper more hedged
than the quote). An eighth of the price, but the errors are the kind a margin note cannot afford.

## What it decided

- **Sonnet reads; Exa searches on the quick tier; ~16 queries.** Cost $0.35–0.55 an article in the
  spike, the read dominating.
- **Planning by kind and angle works**: the planner chose `review`/`since`, `empirical`/`since` and
  `empirical`/`now` correctly, and the 2026 preprint's queries went after replications and the
  authors' own revisions rather than "what has been said since".
- **The check is cheap insurance, not a filter that bites on Sonnet**: 37 of 37 kept. It stays,
  because Haiku shows what it catches.
- Not measured here, and measured in the build instead: the second ("dive") pass, and the cost with
  the extracts clipped shorter.

## The built step, run for real (stage 4, 2026-10-24)

The shipped `situate` step, pressed once each in a local browser by a Sonnet agent, on the local
copies of two articles. Costs are from the local `ai_calls` ledger.

| Article | Press to dossier | Plan | 16 searches | Read | Whole run | Findings |
|---|---|---|---|---|---|---|
| Butlin, Long et al., *Consciousness in AI* (2023) | 56 s | $0.022 | $0.112 | $0.335 (38k in + 90k cache write, 3.3k out) | **$0.47** | 14 |
| *Don't Claim Benchmark-Oriented Optimization…* (2026) | 52 s | $0.023 | $0.112 | $0.193 | **$0.33** | 10 |

The read's cache breakpoint is written and not read back in an ordinary run (about 4.5 cents of
premium on the long article); it pays for itself only on a retry within five minutes. Kept, with
that said in the code.

**Hand check of the 14 findings on *Consciousness in AI*** (each source's checked quote against its
note):

- **Every source's quote is real and bears out the core of its note** — the 2025 *Nature*
  adversarial collaboration, Seth's *BBS* biological naturalism, Bradley & Saad on indicators not
  being computational, the authors' own 2025 *TiCS* follow-up, the IIT "pseudoscience" letter,
  *Taking AI Welfare Seriously*, Anthropic's introspection paper, the reply to Pennartz. The same
  findings the spike called gold came back from the built pipeline.
- **Two notes say more than their sources** (GPT Sol's C8, provenance not support): each names a
  second paper ("a 2026 preprint", "another tested schemas in multi-agent settings") with no source
  for it. The checked half is right; the unchecked clause is unverifiable.
- **Two kinds are wrong in time**: a 2020 study and a 2022 paper the report itself cites are filed
  under *Since*. The note text is accurate; the label is not.
- **No *Citation?* finding**: the local article has no stored abstract notes on its cited works, so
  the `A` evidence the citation rule requires was empty. That rule is untested on a real article.
- **No later papers from OpenAlex**: the DOI's OpenAlex record (`W4386113651`) carries another
  paper's title, so the shared identity check (`confirmedWorkOf`, also Reception's *Cited by*)
  refused it, correctly by its own rule. The spike, which took the DOI on trust, got 196 citers
  from the same record. Every finding came from the web searches alone.

So: worth a margin note on 10 of 14 as written, and on all 14 once the two over-reaching clauses
and the two labels are discounted. The two failure shapes are prompt work (a note names only its
sources; *Since* means after the piece's year), to be measured, not guessed — the queued paired
comparison is where.
