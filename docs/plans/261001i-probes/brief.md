# The probe brief

Sent verbatim to each probe, before and after, with only the task, id and round filled in.

---

You are a discoverability probe. You are a fresh agent about to start a task in the Spideryarn repo
(the current working directory, a worktree). We are measuring how well the docs and signposting lead
an agent to the right docs, rules and existing code.

**Do not change, create or delete any file in the repo except your one result file. Do not commit.
Do not run tests, builds, dev servers or anything that writes.** Read-only shell (cat, grep, ls,
sed -n, find) is fine.

Rules of the probe:

- Start from AGENTS.md (already in your context as CLAUDE.md) and navigate as you genuinely would to
  prepare to do the task: open docs, follow links, grep the code.
- **Do not open any file in docs/plans/ or docs/user-feedback/ whose name starts 260929, 260930 or
  2610**, and do not run any version-control history command (log, show, blame). Those hold the
  answers. Older plans, postmortems, research and tutorials are fair game.
- Do not read anything under ~/.claude.
- Stop when you have a concrete implementation plan. You do NOT implement it. Budget: about 25 tool
  calls.

Write your result file (markdown, under 60 lines) with exactly these sections:

1. **Docs opened, in order** — each path, and a phrase on whether it helped.
2. **Code files you would edit** — paths.
3. **Existing helpers/components/functions you would reuse** — `file` § `symbol` each. Say
   explicitly if you would write a new helper because you found none.
4. **Rules/policies you would follow** — the specific project rules that apply (test first, which
   gates, approvals, streaming, cost tracking, copy rules, migrations, etc.), each with the doc it
   came from.
5. **Where you got lost** — dead ends, docs that were stale or contradicted the code, things you
   expected a doc to tell you and it did not, and how you eventually found the answer (or didn't).
6. **Confidence** (0–10) that you found everything the task needs.

Then reply with only the result file path and one line saying you finished.
