# Prompt caching — constitution

Article: about 37,250 tokens.

| call | prompt | cache read | cache write | ms | cost | uncached |
|---|---:|---:|---:|---:|---:|---:|
| search #1 (cold — expect a write) | 47790 | 0 | 47739 | 12324 | $0.11945 | $0.09558 |
| search #2 (warm — expect a read) | 47789 | 47739 | 0 | 29038 | $0.00965 | $0.09558 |

**Total: $0.12910 against $0.19116 uncached** — 32% saved.

**PASS.** The second call read 47,739 tokens from cache. The article is about 37,250, so the prefix is being reused.
