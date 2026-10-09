Code review of a small dependency-security change, in the worktree at the current directory. You may fix what you find inside this change (lockfile and the three docs below); report anything wider instead of doing it. Do NOT run `npm audit fix`, change package.json, bump dompurify, or touch anything else.

The change (see `git diff HEAD`):
- package-lock.json: brace-expansion 5.0.9 -> 5.0.12, source-map-js 1.2.1 -> 1.2.2, made with `npm update --package-lock-only --ignore-scripts brace-expansion source-map-js`, then `npm install --ignore-scripts`.
- docs/plans/261009r-dependabot-alerts-triage-and-patch-bumps.md: the triage table and evidence (your earlier plan review is beside it, `-plan-review-sol.md`; its findings were folded in).
- docs/project/security-risks.md: the register's line about the Dependabot alerts, updated.

Evidence already gathered (verify what you can):
- `npm audit` after the change: {"low":1,"moderate":6,"high":0}, remaining: @esbuild-kit/core-utils @esbuild-kit/esm-loader dompurify drizzle-kit esbuild fast-copy smol-toml.
- Build comparison: two baseline builds and the post-change build were hashed per file after replacing ISO timestamps and 8-char content-hash suffixes with placeholders (script: /tmp/claude-1000/-home-greg-code-spideryarn2/3070b120-4877-490a-a17c-2ee8f1a82539/scratchpad/normhash.sh; outputs norm-b.txt, norm-c.txt, norm-after.txt beside it). The two baselines agree; after the change all 172 dist/ files are identical; api-dist/vercel.js differs only in builtAt and the embedded index.html's hashed script name + sha256 (both derived from the timestamp).
- `npm run typecheck` green. Full `npm test` was still running at review time.

Check:
1. The lockfile diff is exactly those two records and is internally consistent (integrity, resolved, every dependent's range satisfied). `npm ls brace-expansion source-map-js` agrees with it.
2. The normalisation script cannot hide a real difference (e.g. would a changed file whose only difference matched the regexes be masked? is that plausible here?). Is the conclusion "no browser smoke needed" justified?
3. Are the docs accurate against the code and the audit output: every claim in the table, the register wording, links resolve (run `npx vitest run tests/doc-links.test.ts`).
4. Anything wrong or overclaimed.

Output: a verdict line first (APPROVE / APPROVE WITH CHANGES / REJECT), then numbered findings with file:line, and a list of any edits you made.
