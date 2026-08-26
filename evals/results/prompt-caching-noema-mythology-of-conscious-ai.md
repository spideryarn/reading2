# Prompt caching — noema-mythology-of-conscious-ai

Article: about 13,893 tokens.

| call | prompt | cache read | cache write | ms | cost | uncached |
|---|---:|---:|---:|---:|---:|---:|
| search #1 (cold — expect a write) | 18844 | 18793 | 0 | 12375 | $0.00386 | $0.03769 |
| search #2 (warm — expect a read) | 18843 | 18793 | 0 | 17149 | $0.00386 | $0.03769 |

**Total: $0.00772 against $0.07537 uncached** — 90% saved.

**PASS.** The second call read 18,793 tokens from cache. The article is about 13,893, so the prefix is being reused.
