# Prompt caching — noema-mythology-of-conscious-ai

Run 2026-10-01T13:11:22.229Z.

## Messages wire — cold effort control, then glossary and quotes

The real stage functions (`generateGlossary`, `generateQuotes`) with `cacheArticle: true` forced. Article as `articleText` renders it: about 13,229 tokens. Tokens and cost are read off the `ai_calls` ledger rows.

**Checks** the Messages wire and the two stages' byte layout. **Does not check** the job wiring
that decides `cacheArticle` — that is tests/article-cache-call-site.test.ts.

| call | effort | input (uncached) | cache read | cache write | output | cost | provider | ms |
|---|---|---:|---:|---:|---:|---:|---|---:|
| quotes at effort high (cold control — expect a write, no read) | high | 3730 | 0 | 16192 | 7179 | $0.1197 | Anthropic | 55896 |
| glossary (cold — expect a write, no read) | medium | 4844 | 0 | 16192 | 8627 | $0.1364 | Anthropic | 72972 |
| quotes (same group — expect an exact read) | medium | 3730 | 16192 | 0 | 5907 | $0.0698 | Anthropic | 44968 |

**Spent on this arm: $0.3259.**

### Verdict: **PASS**

- quotes at effort high (cold control — expect a write, no read) wrote 16,192 tokens and read none — a true cold start.
- glossary (cold — expect a write, no read) wrote 16,192 tokens and read none — a true cold start.
- quotes read exactly the 16,192 tokens glossary wrote — the two stages send the same prefix and the wire reused it.
- the cold writes at efforts high and medium establish two separate cache keys.

