# Plan review prompt: 261019n

You are reviewing a plan in the Spideryarn repo (this working tree). Read-only: do not edit any
files. Read CLAUDE.md first, then:

- the plan: `docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md`
- the research behind it: `docs/research/261019a-admin-impersonation-best-practice.md`
- the defences it would edit: `docs/project/security-map.md`, `docs/project/auth.md`,
  `docs/project/admin.md` (§ What it deliberately does not show), `src/routes.ts` (the gate around
  `requireUser` / `setRequestOwner`, and `AUTH_ROUTES`), `src/owner.ts`, `src/auth.ts`,
  `src/ai-spend.ts` (`beginSpend`), `src/web/lib/api.ts` (`apiFetch`, `NotThisReader`, `saving`),
  `src/web/lib/session.ts`, `src/web/App.tsx`, `src/web/main.tsx`.

Part 1 of the plan is already built (uncommitted in this tree: `git diff HEAD`). Parts 2 and 3 are
a proposal to put to Greg, the product owner. They are not built, because they edit a security
defence.

Review:

1. **Part 1.** Is the diagnosis right? Check the claims against the code. Is the fix in
   `src/web/article/StillBeingAdded.tsx` correct? Consider the ordering of `live`, `followed`,
   `completed` and `failed`, and a failed job for a slug whose article later published under a
   retry with the same slug. Does the new `published` field on `AdminArticle` leak anything about
   another reader's private article?
2. **The view-as proposal.** Find the holes. Specifically:
   - Is the per-tab sessionStorage + header design sound? Is there CSRF? Can a header set by a
     non-admin do anything?
   - Is the route classification complete and enforceable? Are there routes that are not in
     `AUTH_ROUTES`, such as streams, uploads or assets served elsewhere?
   - Does `beginSpend` really catch every paid call? Do after-response tasks inherit the scope?
   - On the client, will substituting the reader id break or mix anything: the offline cache,
     `NotThisReader`, the job engine, `forgetOnReaderChange`?
   - What would the log line leak?
   - What is missing that would make this unsafe to ship as v1?
3. **Simpler.** Is there a materially simpler design that gives Greg most of reports 2 and 3, for
   a one-admin beta? Name it if so.
4. **The three questions for Greg.** Are they the right ones, framed fairly, with the right
   recommendations? Is any of them answerable by us instead of by him?

Be concrete: cite file:line. Rank findings by severity. Write your findings to the output file.
