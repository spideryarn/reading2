# Prompt caching — noema-mythology-of-conscious-ai

Run 2026-10-01T12:50:57.636Z.

## Chat wire — search and chat

Article as `articleWithIds` renders it: about 13,768 tokens.
Costs in this table are computed from the list prices above, not read off the ledger.

| call | prompt | cache read | cache write | ms | cost | uncached |
|---|---:|---:|---:|---:|---:|---:|
| search #1 (cold — expect a write) | 19036 | 0 | 18985 | 7906 | $0.04756 | $0.03807 |
| search #2 (warm — expect a read) | 19035 | 18985 | 0 | 11494 | $0.00390 | $0.03807 |
| chat turn #1 (cold — expect a write) | 24083 | 0 | 23877 | 10547 | $0.06010 | $0.04817 |
| chat turn #2 (warm — expect a read) | 24687 | 23877 | 0 | 11314 | $0.00640 | $0.04937 |

**Total: $0.11796 against $0.17368 uncached** — 32% saved.

### search #2 (warm — expect a read)

**PASS.** The second call read 18,985 tokens from cache, against an article of about 13,768 — so it is the article being reused, not just the system prompt in front of it.

### chat turn #2 (warm — expect a read)

**PASS.** The second call read 23,877 tokens from cache, against an article of about 13,768 — so it is the article being reused, not just the system prompt in front of it.


## Messages wire — glossary then quotes, one cache group

The real stage functions (`generateGlossary`, `generateQuotes`) with `cacheArticle: true` forced. Article as `articleText` renders it: about 13,229 tokens. Tokens and cost are read off the `ai_calls` ledger rows.

**Checks** the Messages wire and the two stages' byte layout. **Does not check** the job wiring
that decides `cacheArticle` — that is tests/article-cache-call-site.test.ts.

| call | effort | input (uncached) | cache read | cache write | output | cost | provider | ms |
|---|---|---:|---:|---:|---:|---:|---|---:|
| glossary (cold — expect a write, no read) | medium | 4844 | 0 | 16192 | 4290 | $0.0931 | Anthropic | 39193 |
| quotes (same group — expect a read) | medium | 3730 | 16192 | 0 | 5898 | $0.0697 | Anthropic | 44420 |
| quotes at effort high (control — expect no read) | high | 3730 | 0 | 16192 | 7270 | $0.1206 | Anthropic | 54872 |

**Spent on this arm: $0.2834.**

### Verdict: **PASS**

- glossary wrote 16,192 tokens and read none — a true cold start.
- quotes read 16,192 (100.0% of glossary's write) — the two stages send the same prefix and the wire reused it.
- the control (effort high) read nothing, as effort being part of the cache key predicts.

