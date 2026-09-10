# Review (findings only): Stage 3 of the recovery inventory — the fleet boundary and the page

Repo: /home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory (a linked worktree of
spideryarn/reading2), branch `worktree-recovery-inventory`. TypeScript, ESM, `tsx`; tests are
vitest; the dashboard client is React under `tools/fleet/web/`, built by `npm run build:fleet`.

**The tree is read-only for you. Do not change any file.** Spend the run on finding. Give each fix
as a code block or exact wording, and it will be applied by someone else. Write your answer before
you run out of time: a partial list with a verdict beats a complete one that never arrives.

## The candidate

The commit whose message begins "Recovery inventory stage 3"
(`git log -1 --grep='Recovery inventory stage 3' --format=%H`). Diff it against its first parent;
`git show --stat` gives the complete list of paths. Expected:

- `tools/fleet/wire.ts` (one appended type block);
- `tools/fleet/recovery-feed.ts`, `tools/fleet/routes-recovery.ts` (new);
- `tools/fleet/server.ts` (three lines);
- `tools/fleet/web/src/recovery-client.ts`, `tools/fleet/web/src/RecoveryPanel.tsx` (new);
- `tools/fleet/web/src/App.tsx` (one line);
- `scripts/overseer-recovery-drill.ts` (new);
- four new test files.

Start with `recovery-feed.ts` (the parser at the fleet boundary), `routes-recovery.ts`, and
`RecoveryPanel.tsx`.

## What it is meant to do

The plan is `docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md`
§6, plus Findings and every stage's status. **The contract the fleet side parses is what the
daemon writes**: `recoveryFileText` in `tools/overseer/store.ts`, and the types in
`tools/overseer/recovery-view.ts` and `recovery.ts`. In brief:

- A read-only, async `GET /api/recovery` projects `~/.overseer/recovery.json` into a first page
  (at most 100 records), with `olderCount`, `overflow`, the replay state and the view's clock.
- Every failure is its own arm: absent, unreadable, unsupported schema, oversized. None of them
  becomes an empty list.
- The section is mounted below the Overseer panel. It shows, per record: classification and why;
  the recorded directory and whether it exists; the transcript (a claim-only match labelled
  unverified; `cannot-tell` as its own state); last activity, with a floor marked `≥`; the latest
  evidence; resume support as a sentence; and, for shells, the host and the directory as plain text.
- **No buttons, no acting links, no command text, and nothing that starts anything.**
- Fleet code must not import `tools/overseer/store.ts` or `recovery.ts`: it parses the daemon's
  file itself.
- `scripts/overseer-recovery-drill.ts` builds a disposable store through the real daemon, and must
  refuse to touch `~/.overseer`.

## What you can run

`npx vitest run tests/<one>.test.ts`, and `node --import tsx scripts/typecheck.ts`. There is no
network. My raw gate results are appended below before launch.

## Attack it

Independently, before you read my suspicions. The invariants:

1. **Nothing the page renders can be mistaken for a fact the daemon did not state.** That covers:
   a missing or unreadable file drawn as "nothing interrupted"; a stale view drawn as current; a
   floor drawn as a reading; a claim drawn as verified; `cannot-tell` drawn as "not found".
2. **Nothing on the page can act.** No command string, and no element that sends a request other
   than the GET.
3. **The route cannot be made to block the dashboard's request thread, or to serve an unbounded
   body**: a huge, slow or hostile `recovery.json`.
4. **The drill cannot write to the real store**, whatever its argument, environment or symlinks.
5. **The browser parser and the server parser agree.** A payload one accepts, the other does not
   silently misread.

Each finding gets: an ID, numbered from F27; a severity (P0 data loss / security / broadly
unusable, P1 wrong behaviour or a contract violated, P2 design risk, P3 prose); whether it is
established or reasoned; (a) the input or mutation that shows it; (b) the smallest fix. Refuse only
on an established P0 or P1. One-line verdict at the top. Under 2,000 words.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

1. Whether the page's classification grouping handles a record with `classification: null`
   (resolved records, and every record while `view` is `null`).
2. Whether the byte ceiling is checked before the read, and what the route does when the file
   grows between the `stat` and the read.
3. Whether `App.tsx`'s mount and `server.ts`'s dispatch are really pinned by the wiring test, or
   only asserted by a source grep that a rename would still satisfy.

## Raw gate results (mine, on the committed candidate)

- `npm run typecheck`: `TYPECHECK_EXIT=0` (all four projects).
- `npx vitest run tests/fleet-recovery-feed.test.ts tests/fleet-recovery-route.test.ts
  tests/fleet-recovery-panel.test.tsx tests/fleet-recovery-wiring.test.ts tests/fixture-ids.test.ts`:
  `Test Files 5 passed (5)`, `Tests 67 passed (67)`, exit 0.
- The implementer's runs: `npm run build:fleet` exit 0; 27 focused files / 1,283 tests `EXIT=0`;
  the drill run for real, exit 0.
- Red first was shown by mutation, because the code came before its tests: skipping a malformed
  record, the inventory sentence on every row, a POST let through, and the `App.tsx` mount removed.
  Each turned exactly its tests red.
- The browser check, on a disposable store built by the drill and the implementer's own server:
  the page shows the four drill sessions as the plan's Stage 3 status describes, with 0 buttons and
  0 links, and nothing wider than the screen at 400 px.

`App.tsx` carries one import line beyond the approved mount line; the mount needs it.
