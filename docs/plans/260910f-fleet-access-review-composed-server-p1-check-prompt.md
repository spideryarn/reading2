# Narrow check: were F11 and F12 closed, and closed without a new hole? (plan 260910f)

Repo: /home/greg/code/spideryarn2/.claude/worktrees/fleet-access-review, a git worktree. TypeScript,
ESM, Node `http`, vitest. **Read-only. Twenty minutes. Two questions only.**

## The candidate

Committed: `f3674e36` — `git show f3674e36`. It holds your own stage-review fixes for F11–F16 (see
`docs/plans/260910f-fleet-access-review-composed-server-stage-review-answer-findings.md`) plus two
test fixes made after your sandbox could not run the composed file (the plan's "Stage review"
section says what and why). Treat all of it as someone else's unreviewed code.

Start with: `tools/fleet/server.ts` (`unaddressedHost`, `authoritySuffixIsValid`, `rawHosts`, and the
top of `handler()`), `tests/helpers/fleet-child-owner.mjs`, `tests/helpers/fleet-child-server.ts`,
`tests/helpers/fleet-child-orphan-parent.ts`, and the "child ownership" and Host sections of
`tests/fleet-composed-access.test.ts`.

## The two questions

1. **F11.** Is it now true that if the process that called `startFleetChild()` dies without
   cleanup — SIGKILL, including when that process is vitest's worker — the composed server's
   listener closes and nothing it started keeps running? And does the parent-death test fail if the
   owner's `disconnect` handler is removed (the plan says it was mutated red — check the reasoning:
   the fixture waits for 1.5 s of silence so the EPIPE fallback cannot answer for it)? Also: can the
   owner ever signal a process group that is not its own?
2. **F12/F13.** Is it now true that `handler()` answers 421 to every request whose `Host` is not
   exactly one field holding exactly one `host[:port]` authority whose name `addressableHost`
   accepts — and that no legitimate caller is refused (`127.0.0.1:8787`, `localhost:8787`,
   `[::1]:8787`, `spideryarn-box:8787`, `<box>.<tailnet>.ts.net:8787`, and each without a port)?

State each guarantee at its true strength: "is this statement accurate?", not "is this sound?".

## Output

Findings as F17 onward: severity (P0/P1/P2/P3), established or reasoned, (a) the input or mutation
that shows it, (b) the fix. Refuse only on an established P0 or P1. **Write findings FIRST to
`/tmp/260910f-fleet-access-review-p1-check-findings.md`** (the tree is read-only to you), then answer
with a one-line verdict per question. If both statements are accurate, say so and stop. Do not
change any file other than that one in /tmp.
