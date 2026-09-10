# Review: Stage 2 of the recovery inventory — the view, the dispositions and the CLI

Repo: /home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory (a linked worktree of
spideryarn/reading2), branch `worktree-recovery-inventory`. TypeScript, ESM, `tsx`; tests are
vitest. The daemon in `tools/overseer/` folds fleet snapshots into an append-only JSONL event log
plus atomic checkpoints. Stage 1 (committed and reviewed; you reviewed it as F11–F14) added
`recovery-candidate` events and a recovery fold persisted in `~/.overseer/recovery.json`.

## The candidate

Committed: the single commit whose message begins "Recovery inventory stage 2" (`git log -1
--grep='Recovery inventory stage 2' --format=%H`). Diff it against its first parent:
`git diff <sha>^1 <sha>`, and `git show --stat <sha>` for the complete list of changed paths. The
expected set is `tools/overseer/recovery-view.ts` (new), `tools/overseer/recovery.ts`,
`tools/overseer/store.ts`, `tools/overseer/daemon.ts`, `scripts/overseer-recovery.ts` (new),
`tests/overseer-recovery-view.test.ts` (new), `tests/overseer-daemon-recovery.test.ts`, and the
plan doc. The `--stat` output is the authority, not this list.

Start with: `recovery-view.ts` (the classification and the evidence pass); the disposition code in
`recovery.ts`; the view pass and the inbox drain in `daemon.ts`. These are where to begin, not the
limit of scope.

## What it is meant to do

Read `docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md` §2
(dispositions), §4 (the view) and §5 (dismissal), with Findings F1–F10 (your plan review) and
Stage 2's status. In brief:

- Every unresolved record is classified against the daemon's current accepted inventory, first
  match wins: `unknown` when the inventory cannot be trusted; `already-live`;
  `present-but-unmatched`; `ended-before-reboot` (only from a watched `lastSeen`); `interrupted`
  (only `changed`, or `unverifiable` with the producer run `changed`); otherwise `unknown`.
- Evidence for the first page is checked by the daemon, never on a request: directory existence,
  and the transcript by the **verified** conversation. A claim-only match is labelled unverified.
  Resume support and a manual SSH path for shells follow.
- `resumed` needs the same verified conversation **and** a different token; `superseded` needs the
  same verified conversation.
- An operator's dismissal travels CLI → drop directory → daemon → `recovery-disposition` event,
  idempotent by request id.
- Resolved records older than 30 days leave the index; unresolved records never do.

**Nothing may start, resume or offer a command.**

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage under review, each finding red-first with
the test that reproduces it, and leave everything wider as a finding for me to decide. Do not
commit. List every file you changed at the end. You can run a test file
(`npx vitest run tests/<one>.test.ts`) and the typecheck script directly
(`node --import tsx scripts/typecheck.ts`, because `npm run typecheck`'s tsx IPC may be refused in
your sandbox); you have no network. My raw gate results are at the bottom of this prompt.

## Attack it

Independently, before you read my suspicions. The invariants to break:

1. **No record is classified `interrupted`, `ended-before-reboot` or `already-live`, and no record
   is disposed `resumed` or `superseded`, on evidence that does not support it.** That includes a
   stale inventory after a failed or refused collection, a claim standing in for a verified
   conversation, and a filesystem read standing in for a disposition.
2. **The daemon remains the only writer of `events.jsonl` and `recovery.json`**, and a request
   replayed after a crash is applied at most once.
3. **No request path does I/O that is unbounded or synchronous on the daemon's tick** — the evidence
   pass is bounded to the first page.

For each finding: an ID (F15 upwards; F1–F14 are taken), a severity (P0 data loss / security /
broadly unusable; P1 wrong behaviour or an authoritative contract violated; P2 design risk; P3 prose),
established or reasoned, (a) the input or mutation that shows it, (b) the smallest fix. Refuse only on
an established P0 or P1. One-line verdict at the top.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. Whether `already-live` and `resumed` read the verified conversation from `lastSeen` and never
   from `entry.claimedConversationId`.
2. Whether the view's "inventory trustworthy" test can be fooled by a duplicate payload or a held
   baseline after a refused one.
3. Whether the inbox drain can apply a malformed or hostile request file (a symlink, a huge file,
   an id that names a resolved record) rather than refusing it with a note.
4. Whether the 30-day retention can evict a record that a pending entry or a later disposition still
   names.

## Raw gate results (mine, on the committed candidate)

- `npm run typecheck`: `TYPECHECK_EXIT=0` (four projects, all 1,969 source files covered).
- `npx vitest run tests/overseer-recovery-view.test.ts tests/overseer-daemon-recovery.test.ts
  tests/overseer-recovery.test.ts`: `Test Files 3 passed (3)`, `Tests 89 passed (89)`, exit 0.
- The implementer's run of every file importing the changed modules (26 files, 773 tests):
  `EXIT=0`.
- The implementer's red evidence: both new files failed at import before the code existed, and five
  mutations each turned their targeted tests red (listed in the plan's Stage 2 status).

The implementer added one file outside the expected set, `tools/overseer/recovery-inbox.ts`: a
leaf that the daemon and the CLI share. It is in scope. Also check its drain against suspicion 3
below.
