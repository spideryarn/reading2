No P0 or P1 findings.

- P2 — fixed: [FeedbackEarlier.tsx:115](/home/greg/code/spideryarn2/.claude/worktrees/fby4upzw-feedback-carries-url/src/web/FeedbackEarlier.tsx:115). A new client can read the old API after a production rollback or alias reassignment; the strict validator previously broke the whole Earlier tab because old rows lack `page`. Missing `page` is now normalized to `null`, while malformed present values still fail. The regression test was observed red before the fix.

- P2 — not fixed; wider architectural decision: [feedback-page.ts:36](/home/greg/code/spideryarn2/.claude/worktrees/fby4upzw-feedback-carries-url/src/feedback-page.ts:36). Server code imports `src/web/router.ts`. It currently runs no browser-only side effect, and browser-global router functions are tree-shaken, but the API bundle retains `import "react"` and router parsing code. Contrary to the stated precedent, `messages.ts` and `public/page.ts` only mention the router in comments. The durable fix is extracting the pure parser into a shared non-web module.

The URL boundary otherwise holds:

- Unknown, doubled-slash, wrong-case, extra-segment, malformed, and encoded-slash paths return `null`.
- Exact metadata, callback, and admin routes survive.
- `/add/<remainder>` and upload routes collapse to `/add`; bare `/add/` remains `/add/`.
- Off-origin URLs are accepted only when their normalized pathname is a recognized app route; the origin never survives.
- Percent-encoded valid slugs retain their encoded spelling, but decode to the same constrained 60-character slug vocabulary.
- No route carries arbitrary text except the validated slug and the `/add/` remainder, which is discarded.

All new tests can fail meaningfully. I also corrected the plan’s claim that encoded labels are necessarily only 60 characters.

Checks: focused suites 142/142 passed; production client/API builds passed; all four TypeScript projects passed directly; scoped lint and `git diff --check` passed. The Postgres store suite could not start because this sandbox was denied access to `127.0.0.1:54362`. No commit made.

Verdict: safe after the rollback-compatibility fix, with one non-blocking server/client module-boundary cleanup left for you to decide.