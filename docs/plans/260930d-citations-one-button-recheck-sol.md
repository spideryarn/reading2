Verdict: **land**. No P0–P2 findings and no runtime breakage found.

- **R-1 · P3 — quote-contract comments are stale.** The prompt forbids all quotation marks, but comments still say it permits verified quotations: [citation-investigate.ts:175](/home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/citation-investigate.ts:175) and [investigate-quote-guard.ts:7](/home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/investigate-quote-guard.ts:7).  
  **Concrete change:** explain that the prompt forbids all quotes while the guard deliberately retains its verified-text allowlist as a fallback, avoiding failure for harmless noncompliance. No guard change is needed.

- **R-2 · P3 — the owning documentation describes the old provenance fallback.** [citations.md:273](/home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/docs/project/bibliography.md:273) says every unmatched investigation reports “could not confirm”; assessed/unreadable rows now truthfully credit an earlier quick check.  
  **Concrete change:** document the three current provenance branches from `investigationProvenance`.

- **R-3 · P3 — the budget explanation retains the pre-3,000-token arithmetic.** [citation-investigate.ts:136](/home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/src/citation-investigate.ts:136) and [citations.md:287](/home/greg/code/spideryarn2/.claude/worktrees/fb75-citations-one-button/docs/project/bibliography.md:287) still use `$0.33 × 55 ≈ $18`. At the current $10/M output-token price, another 1,500 tokens add at most $0.015: approximately `$0.345 × 55 = $18.98`. The 55-run fuse therefore remains below $20, but the explanation should say about $19. [OpenRouter pricing](https://openrouter.ai/anthropic/claude-sonnet-5)  
  **Concrete change:** update the two calculations; do not change `INVESTIGATE_RATE_POLICY`.

Other checks:

- No remaining operative permission to quote in `INVESTIGATE_SYSTEM` or `investigatePart`; the latter explicitly says “paraphrase, do not quote.”
- The shared plain-words text contains quoted examples and a generic copy-exactly rule, but also says the prompt’s more specific rules win; nothing in this request is told to be copied into the answer.
- “An earlier quick check” is true for both a lookup from this press and a retained older match.
- No-match retention remains hash-gated through `matchedPageOf`.
- Prompt version 4 is correctly used in production and the relevant assertions. Remaining `/1` strings are historical fixture data.
- `npx vitest run tests/citation-investigate.test.ts tests/citation-investigation-view.test.ts tests/citations-panel.test.tsx`: **3 files, 126 tests passed**.
- Read-only review; no files changed.