# Review round 2: execution identity — did the P1 fixes actually close the holes?

You reviewed this stage in round 1 (your answer is checked in at
`docs/plans/260908f-exec-identity-code-review-sol-r1.md`). You found no P0 and two P1s. Both are
now fixed, along with three of the P2s. **This round is mainly: did the fixes work, and did they
introduce anything worse?** Weight that above finding new things.

Repo `/home/greg/code/spideryarn2`, worktree `.claude/worktrees/260908f-exec-identity`. Scoped diff
against the branch point at `docs/plans/260908f-exec-identity-review-diff-r2.txt`, with the two new
modules appended whole. Read the tree directly where it is easier.

## What changed since round 1

**P1-1 (the sticky register never learned after an unverified sample).** `diff()` now takes a third
input, `KnownExecutions` — a `ReadonlyMap<SessionKey, string>` of the register's last-verified
tokens, built by the daemon at `tools/overseer/daemon.ts` and passed in. No import of `store.ts`, so
no cycle. `executionChange` compares the CURRENT row against that map rather than against the
previous snapshot's row.

`previousToken` became `string | null`. Null is a **first sighting** — the register knows the
session and has never verified a run for it, which is the upgrade path you reproduced. The fold
treats the two differently, and this is the part I most want you to attack: a first sighting records
the token and **deliberately does not reset `statusSince`**, because on the first collection after
this ships every existing session learns its token at once, and resetting there would wipe every
measured age on the box in one go. A real replacement (non-null `previousToken`) does reset it.

**P1-2 (a `verified` reading assembled from two processes).** I did not take your suggested second
`ps`. Instead the reading cross-checks the two sources it already has: `ps` reports elapsed time,
`/proc/<pid>/stat` reports start ticks, and one `/proc/uptime` read per collection puts them on one
clock. Disagreement beyond `START_AGREEMENT_TOLERANCE_S` (5 s) returns
`unknown`/`process-changed-under-read`; an unreadable uptime returns `unknown`/`uptime-unreadable`,
on the rule that an unmade check is not a passed one. `USER_HZ` is hardcoded to 100 as a procfs ABI
constant rather than read from `getconf`.

**Is that cross-check actually sound?** It is the change I am least sure of. Specifically: is the
tolerance right in both directions; can a replacement process land inside 5 s of the original's
start and pass; is `uptime - (atMs - started.atMs)/1000` the correct reconstruction given
`parseProcessTable` derives `started.atMs` from whole-second `etimes`; and does anything about
suspend/resume, clock steps or a container's `/proc/uptime` break it?

**P2-3.** New leaf `tools/fleet/execution-token.ts` — only type imports — holding
`executionTokenText`, `isExecutionTokenText`, `continuityOf`, `identityWriteGate`.
`execution-identity.ts` keeps the machine reads and the classification. `diff.ts` and `store.ts`
import the leaf, which also removes the braid you named.

**P2-4.** `identityWriteGate` now also requires an addressable harness (`claude-code` only). Both row
parsers gained a `coherentWith` step: a `verified` conversation whose id is not the row's claim, or
one asserted on a harness that cannot hold one, is downgraded to `unverifiable` — reusing an
existing arm rather than adding a ninth cause. Is downgrading right, or should it fail the row?

**P2-4b.** `isExecutionTokenText` is now used by `parseVerifiedExecution` and by
`parseExecutionChanged`, so the "malformed present values fail" claim is enforced rather than
asserted. The regex is `^[^:\s]+:[1-9]\d{0,9}:\d{1,19}$` — deliberately loose about the boot id,
strict about the two numbers. Too loose? Too strict?

**P2-5.** Taken as documentation: the plan now scopes the contract to one process incarnation in this
collector's PID namespace and notes that `execve` preserves the token.

**Not done, deliberately, and I want your view on whether that is defensible:** narrowing
`claimed-only`'s `conversation` so `conflicting` is unrepresentable there (you noted the arm is
"semantically odd"; a reader of this file independently mis-inferred that `conflicting` was
reachable from it and nearly shipped a dead branch). It is recorded in the plan as decided-but-not-
applied because it changes runtime behaviour in both parsers late in the stage.

## Evidence

- `node --import tsx scripts/typecheck.ts` exits 0.
- Focused suites green: `fleet-execution-identity` (44), `overseer-diff`, `overseer-store`,
  `overseer-daemon`, `overseer-cli`, `overseer-observation`, `fleet-web`.
- Full suite: running as this prompt is written; the tail is at
  `docs/plans/260908f-exec-identity-suite-r2.txt` if it landed before you read this. If that file is
  absent or has no final Vitest summary, **say so** rather than assuming it passed — you were right
  to flag that last round.

## What I want back

Ranked findings again, but lead with a verdict on the two P1 fixes: closed, partly closed, or
replaced by a different bug. Then anything new. Check the conclusions as well as the code — in
particular the first-sighting / replacement split in the fold, and the elapsed-time cross-check,
which are the two places I have substituted my own judgement for your suggested fix.
