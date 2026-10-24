No P1 findings remain.

Findings:

- **P2 — fixed:** `head.includes(readabilityTitle)` accepted empty/short substrings and metadata titles matching a suffix. An explicit `og:title` or JSON-LD title could be replaced with the full heading. [src/extract.ts](/var/tmp/spideryarn-worktrees/fbwhpceg-import-titles/src/extract.ts:1320) now accepts only the complete `<title>` or Readability’s precise `": "` suffix, and refuses when title metadata or JSON-LD is present.
- **P2 — fixed:** `latexmlTitleText` did not require an actual `br.ltx_break` and accepted one titled document among multiple roots, allowing coincidental or wrong-root matches. It now requires exactly one root, one title, and a measured break. [src/latexml.ts](/var/tmp/spideryarn-worktrees/fbwhpceg-import-titles/src/latexml.ts:189)
- **P3 — fixed:** `head > title` can differ from JSDOM’s `document.title`, which Readability uses. It now follows `document.title`.
- **P3 — fixed:** the private-use sentinel was attacker-controlled title text and could be mistaken for a break. Breaks are now represented structurally during an iterative traversal.

Tests added for every guard above, including metadata suffixes, JSON-LD, multiple roots, generic `<br>`, namespaced `<title>`, notes, consecutive breaks, and sentinel collisions. Five new regression cases were observed failing before the fixes.

Verification:

- Requested suite: **161 passed**
- Suite plus feedback/docs checks: **241 passed**
- Typecheck: all four projects passed; all 3,935 source files covered
- Real saved pages: both AGENTS.md and Tree of Thoughts titles correct
- Scoped lint passed; only three pre-existing informational complexity notices
- `npm test` could not start because this sandbox cannot reach Docker/Postgres (`EPERM`); the scoped unit suites completed normally

No commit made.

**Verdict: approve after fixes; no remaining scoped findings.**