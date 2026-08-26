# Prompt caching — writes

Article: about 893 tokens.

| call | prompt | cache read | cache write | ms | cost | uncached |
|---|---:|---:|---:|---:|---:|---:|
| search #1 (cold — expect a write) | 2107 | 2056 | 0 | 5759 | $0.00051 | $0.00421 |
| search #2 (warm — expect a read) | 2106 | 2056 | 0 | 6159 | $0.00051 | $0.00421 |

**Total: $0.00102 against $0.00843 uncached** — 88% saved.

> Note: call #1 read from cache too, so a previous run had already warmed it — the TTL is 5 minutes. The saving above is the warm case. For a true cold start, wait out the TTL or use an article this eval has not touched.

**PASS.** The second call read 2,056 tokens from cache. The article is about 893, so the prefix is being reused.
