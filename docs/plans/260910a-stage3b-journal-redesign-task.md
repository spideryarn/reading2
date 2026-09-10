# Task: Stage 3b — one file per refusal, because the append design is unsound

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility`, branch
`worktree-admission-visibility`. TypeScript + ESM, `tsx`, vitest.

**This replaces the storage layer of `admission-journal.ts`. You found the two defects that force
it** — F36 and F37 in `docs/plans/260910a-stage3-code-review-sol.md`, both open P1s you correctly
said needed a different design rather than a patch. This is that design.

## Why, in short

The journal is append-only JSONL with many writers and no lock, and the plan justified that by
claiming a sub-`PIPE_BUF` `appendFileSync` is atomic on Linux. **That claim was false.** `PIPE_BUF`
atomicity is a guarantee about pipes and FIFOs; for a regular file `O_APPEND` makes only the offset
update atomic, and a write that fails partway leaves a fragment. Reproduced directly: capping a file
with `RLIMIT_FSIZE` and appending a 217-byte line gave `EFBIG`, left **60 bytes of a JSON object on
disk**, and the next successful append joined that fragment so the reader lost both records as one
unparseable line. Disk full mid-line is the realistic version, and it is a state a journal *about
resource exhaustion* should expect to meet.

Your F37 is the second half: two consecutive rotations lose an append that returned success, because
the writer holds a handle on an inode the second rotation has unlinked. A record that reports
success and then does not exist is worse than no journal.

## The design

**One file per refusal.** In the journal directory:

1. serialise the entry;
2. write it to a **temporary name in the same directory** (`.tmp-<pid>-<random>` or similar);
3. `rename` it to its final name.

A rename within a directory is atomic, so a reader sees a whole record or no record and can never
see a fragment. There is no shared file, so there is no interleaving and no rotation. Pruning is
unlinking the oldest files, which cannot race a writer creating a new one.

**Naming.** The final name must sort oldest-first lexically and must not collide between concurrent
writers on the same millisecond: an ISO-ish timestamp plus pid plus a short random suffix. The reader
sorts by name, not by `mtime` — mtime is not stable across a copy and can go backwards if a clock is
adjusted.

**Cleanup.** A crash between step 2 and step 3 leaves a `.tmp-…` file. The reader must ignore
temporary names entirely, and pruning should remove stale ones (older than, say, an hour) so they do
not accumulate. **An ignored temp file is not an unparseable record and must not be counted as one.**

**Everything else about the module stays**: `recordRefusal` never throws and returns whether it
wrote; the entry's fields are unchanged; a record whose serialisation its own parser would reject is
refused rather than written (your F39); `readRefusals` keeps its `read` / `directory-absent` /
`unreadable` arms and its `unparseableLines` count; the panel keeps its wording, including your F40
and F41 fixes.

**Bounds — and this closes your F38 too.** Cap the number of retained records (a count, not a byte
total, since records are now uniform), and have the **reader** prune. State the cap in the module
and say on the panel that older records are discarded, which the panel already does. A count cap
also makes the read cost predictable in a way the old byte cap did not: your F38 measured 225 ms on
a 16.6 MB journal, which must not be reachable.

## The tests

Keep every existing test that still applies, and rewrite the ones that assumed a single file. Add,
each red first:

1. **A partial write cannot produce a visible fragment.** Reproduce F36's condition — `RLIMIT_FSIZE`
   via `prlimit`, or a full `tmpfs` — and assert the reader sees either the whole record or none,
   and that `unparseableLines` stays 0. **This test is the reason the stage was redone; it must fail
   against the old append implementation.**
2. **A writer paused mid-write across two prunes still ends up visible, or reports failure.** F37's
   scenario, adapted: no outcome where `recordRefusal` returns `true` and the record is absent.
3. Concurrent writers from separate processes lose nothing (keep your existing 4×40 test).
4. A leftover `.tmp-…` file is ignored, is not counted as unparseable, and is eventually removed.
5. Pruning keeps the newest N and removes the oldest, and a concurrent write during a prune is not
   lost.
6. Two records written in the same millisecond by different pids do not collide.
7. The reader's cost stays bounded at the cap — assert the retained count, and say what you measured.

## What you may and may not touch

In scope: `admission-journal.ts`, `tests/admission-journal.test.ts`, and only if the redesign forces
it, `tools/fleet/routes-admission.ts`, `tools/fleet/admission-wiring.ts`, `tools/fleet/wire.ts`,
`tools/fleet/web/src/admission-client.ts`, `tools/fleet/web/src/AdmissionSection.tsx` and their
tests. **The two writer call sites in `vitest.config.ts` and `scripts/readiness-loop.ts` should not
need to change** — if they do, say so loudly, because `vitest.config.ts` is evaluated by every test
run on this shared box and a mistake there fails every suite for every agent.

Do not touch `vitest-admission.ts`, `tools/fleet/collect.ts`, `routes-actions.ts`, `routes-new.ts`,
`health*.ts`, `actions.ts`, `tools/overseer/`, or the readiness files beyond what already changed.

**Do not create or write to `~/.fleet-admission/`** — that is the real journal on this box and a test
entry there would be a fabricated record. Use temporary directories. **Do not touch :8787.** **Do not
commit.**

## Running things

`npx vitest run tests/admission-journal.test.ts tests/fleet-admission-explain.test.ts tests/fleet-admission-route.test.ts tests/fleet-admission-panel.test.tsx`
Typecheck via `node --import tsx scripts/typecheck.ts`, judged by exit code. Not the full `npm test`.

## At the end

List every file changed, what each new test failed with against the old implementation, what you
measured the read at under the cap, and anything you could not make sound. **If any part of the new
design still cannot guarantee "returns true implies the record is readable", say so plainly rather
than narrowing the claim quietly** — that sentence is the whole point of the redesign.
