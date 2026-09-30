## Findings

- **N-1 — P1 — [src/citation-lookup.ts:264](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-lookup.ts:264)** — The DOI fallback accepts derivative documents. A page titled `Correction to: <whole original title>` whose extract mentions the original DOI passes both conditions, so `judgeLookup` assesses the correction’s extract as the cited work. The same applies to `Comment on…`, `Review of…`, or `Dataset for…`. The test at line 279 covers only a citing page with an unrelated title.

- **N-2 — P1 — [src/citation-lookup.ts:231](/home/greg/code/spideryarn2/.claude/worktrees/fb5g-citation-support-check/src/citation-lookup.ts:231)** — The truncated-title rule can accept a sibling paper sharing a long prefix when its search title truncates before the titles diverge and its extract contains the same author or merely the same year. It is broader still than documented: `containsRun(want, kept)` at line 240 accepts any internal run, not specifically a prefix. Both shapes reach `state: "assessed"` in direct probes.

Rule 3 has no finding: an over-cap field becomes `null`; `supports`/`partly` is then downgraded without a verified quote, while `paperDoes` is omitted unless its own quote verifies. Nothing unchecked is displayed.

`npx vitest run tests/citation-lookup.test.ts`: **53/53 passed**.

**Verdict: request changes—rules 1 and 2 admit wrong-document extracts; rule 3 remains fail-closed.**