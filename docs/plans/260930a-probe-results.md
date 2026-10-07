# 260930a — Investigate probe results

## Findings (written by hand after the run; the table and answers below are the script's)

- **Exa and the cap were honoured.** Every call ran 1 search (one ran 2), and annotations never
  exceeded `max_total_results` 8 (5 or 6 per call). `searchesFrom` was `server_tool_use_details` on all six.
- **`content` is present on the streaming wire**: 31 of 31 annotations carried a non-empty extract,
  94–9,998 characters. The 9,998 one (a whole PDF's text, call 1) is past `MAX_EVIDENCE_EXCERPT` (8,000).
- **`max_characters` is accepted and honoured** (the script's `maxchars` mode, two tiny calls, ~$0.03):
  8000 gave no 4xx under `require_parameters`, extracts 271–3,465; 500 gave extracts 254–496. So the
  model's per-result budget and our 8,000 cap can be made to agree with `max_characters: 8000`.
- **Caching works within a call, not across calls.** Each call reads about half its prompt from
  cache — the post-search pass reads what the pre-search pass wrote — so a press pays the article
  about twice. But call 6 (same article as call 4, about 30 s later) wrote the article again and cost
  the same ($0.1307 vs $0.1316): no reuse between presses. Check against explain's `cacheReadTokens`
  before the build assumes a warm cache.
- **Quote guard: 1 of 6 tripped, and both of its hits are false positives.** (a) the paper's own
  title in quotation marks (six words); (b) a quote of the article with American punctuation,
  `"…what's possible,"`: the article has no comma there, and `findQuote(…, "spaced")` fails with the
  trailing comma and passes without it. Needed: strip trailing punctuation inside the quote before
  matching, and either exempt the work's own title or tell the prompt not to quote titles.
- **Prompt drift: 2 of 6 claimed the full text** ("I found the full text…", call 1; "The full text
  found on cse.buffalo.edu", call 3) despite "Do not claim you read the paper", and call 1 opened
  with "I" narrating its search. That collides with the code-written *"We did not obtain the paper
  itself, or the full text of any page"* line, and in call 1 the extract really was ~10k characters
  of the PDF. Either that line softens, or the prompt names "full text" / "full paper" as forbidden.
- **Latency:** first token 5.3–8.1 s (mean 6.4), total 12.2–15.0 s (mean 13.7).
- **Allowance, from a $20/day worst-case loss:** worst observed $0.153 on a ~49k-token article; a
  press scales with article length (the article is paid about twice), so budget $0.30 per press for
  the longest articles. Global daily fuse 60 (60 × $0.30 = $18 ≤ $20; ≈ $7 at the $0.12 mean).
  Per reader: 20 a day (≤ $6), 8 an hour, concurrency 1.

Produced by `scripts/probes/260930a-investigate-probe.ts` on 2026-09-30, the stage-1 gate in [the plan](260930a-citations-investigate-one-work-on-demand.md). Draft prompt: `scripts/probes/260930a-investigate-prompt.ts`. Gateway job used: `explain` (its route; `citation-investigate` does not exist yet). Tool: `openrouter:web_search`, engine exa, max_total_results 8, max_results 5. Local articles, read only.

Both probe files were deleted on 2026-10-04 (plan 261004b § A5); read them with `git show 9b611dfe2:scripts/probes/260930a-investigate-probe.ts` and `…-prompt.ts`.

| # | work | link | prof | 1st tok s | total s | prompt | cached | write | out | searches (from) | annots | w/ content | content min/med/max | cost $ | finish | answer ch | quote guard |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | spider-silk-spya-ge30uz / Silk feeding as an alternative foraging  | doi | y | 6.3 | 14.5 | 71881 | 33643 | 38234 | 675 | 1 (server_tool_use_details) | 5 | 5 | 135/232/9998 | 0.1161 | stop / finished | 1840 | ok (1 article quote) |
| 2 | spider-silk-spya-ge30uz / Wunderbare Welt der Spinnen | search | n | 8.1 | 13.3 | 69685 | 33388 | 36293 | 694 | 1 (server_tool_use_details) | 5 | 5 | 246/541/1303 | 0.1114 | stop / finished | 1717 | ok |
| 3 | antikythera-mechanism-spya-z / Decoding the ancient Greek astronomical  | doi | y | 5.9 | 15.0 | 97959 | 46279 | 51676 | 770 | 1 (server_tool_use_details) | 5 | 5 | 94/255/6988 | 0.1532 | stop / finished | 1945 | ok |
| 4 | scaling-hypothesis / Santoro et al 2016 | arxiv | n | 6.4 | 14.4 | 83044 | 39371 | 43669 | 753 | 1 (server_tool_use_details) | 5 | 5 | 219/2083/3647 | 0.1316 | stop / finished | 1928 | ok |
| 5 | openai-huggingface / ExploitGym benchmark paper | search | y | 5.3 | 12.2 | 33058 | 12494 | 20560 | 688 | 2 (server_tool_use_details) | 6 | 6 | 251/2085/5407 | 0.0748 | stop / finished | 1611 | ok |
| 6 | scaling-hypothesis / Hernandez & Brown 2020 | search | n | 6.3 | 13.1 | 83322 | 39377 | 43941 | 597 | 1 (server_tool_use_details) | 5 | 5 | 249/825/7308 | 0.1307 | stop / finished | 1638 | TRIPPED (2; 0 in an extract) |

Model: anthropic/claude-sonnet-5. Total cost $0.7177 over 6 calls; mean $0.1196, max $0.1532. Mean total latency 13.7 s.

## Answers (truncated to ~600 characters)

### 1. spider-silk-spya-ge30uz / Silk feeding as an alternative foraging 

Sources: frank.itlab.us, sah.borca.ai, www.jstage.jst.go.jp, sah.borca.ai, zslpublications.onlinelibrary.wiley.com

```text
I found the full text, which gives a solid basis to write on.

Does it back the claim?
The full paper, found through a PDF host, studies Argyrodes flavescens, a small spider that steals prey from the webs of other, larger spiders. Its abstract and results describe how this spider sometimes eats the web silk itself rather than stealing insects, and that it switches between the two depending on how much prey is available: when insects are scarce it eats silk, and when insects are abundant it goes back to stealing them. This directly backs the article's plain claim that spiders may use silk as a  …
```

### 2. spider-silk-spya-ge30uz / Wunderbare Welt der Spinnen

Sources: psb.vufindnet.de, www.abebooks.com, www.natur-in-nrw.com, www.tierundnatur.de, exa.ai

```text
Does it back the claim?
The book is Stefan Heimer's Wunderbare Welt der Spinnen (The Wonderful World of Spiders), a German-language popular-science book about spiders published by Urania Verlag in 1988, as confirmed by library catalog entries and secondhand-book listings on sites such as abebooks.com and a German library catalog (psb.vufindnet.de). It runs 188 pages with drawings and photographs, and a bookseller's description on tierundnatur.de lists it among general reference works on spiders, with one chapter specifically on "Naturstoff Spinnenseide" (spider silk as a natural material). Thi …
```

### 3. antikythera-mechanism-spya-z / Decoding the ancient Greek astronomical 

Sources: www.nature.com, cse.buffalo.edu, econpapers.repec.org, www.researchgate.net, www.academia.edu

```text
Does it back the claim?
The full text found on cse.buffalo.edu and the abstract summarized on econpapers.repec.org confirm this is the primary technical report of the Cardiff/Athens/Thessaloniki team's imaging work: it describes using X-ray computed tomography and surface (polynomial texture) imaging to read fragments and reconstruct gearing, and it states the device contains 30 bronze gear wheels found in the surviving fragments (27 in the largest fragment alone, plus one each in three smaller ones). It does show the device predicted lunar and solar eclipses using Babylonian-style cycles, and …
```

### 4. scaling-hypothesis / Santoro et al 2016

Sources: arxiv.org, proceedings.mlr.press, web.stanford.edu, mlanthology.org, proceedings.mlr.press

```text
Does it back the claim?
The footnote lists this paper as one of several background readings "on implicit meta-learning," not as sole support for any single sentence in the main text. Its abstract, as shown on arxiv.org and in the ICML proceedings, describes a memory-augmented network (built on the Neural Turing Machine idea, a network with an external memory bank it can read and write to) that after seeing a mere handful of examples of a new category can classify further examples of it correctly, and can likewise fit new functions from just a few sample points. That is a direct demonstration o …
```

### 5. openai-huggingface / ExploitGym benchmark paper

Sources: arxiv.org, arxiv.org, rdi.berkeley.edu, www.cybergym.io, www.mpi-sp.org, metr.org

```text
Does it back the claim?
The abstract on arxiv.org and a summary on the Max Planck Institute site (mpi-sp.org) confirm ExploitGym is a real, published benchmark of 898 real-world software vulnerabilities (in ordinary programs, in Google's V8 browser engine, and in the Linux kernel), where an AI agent is given a bug and a proof that it exists, and has to turn it into a working attack that seizes control of the target program. Crucially, the paper describes a judge step: after an agent claims success, a separate "agent-as-judge" checks the record of what it did to confirm it actually used the int …
```

### 6. scaling-hypothesis / Hernandez & Brown 2020

Sources: openai.com, github.com, singularityhub.com, open-ia.org, www.greaterwrong.com

Quote guard tripped on: «Measuring the Algorithmic Efficiency of Neural Networks,»; «small & shallow compared to what's possible,»

```text
Does it back the claim?
The paper by Danny Hernandez and Tom Brown, titled "Measuring the Algorithmic Efficiency of Neural Networks," is described on openai.com as finding that since 2012 the amount of computing power needed to train a network to the same performance on the ImageNet image-recognition benchmark has fallen by half roughly every 16 months, a faster pace than the classic hardware improvement curve known as Moore's Law. That is the same halving-time figure the article leans on when it says GPT-3's architecture is "small & shallow compared to what's possible," implying that better m …
```
