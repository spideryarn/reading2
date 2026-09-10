# Review: Stage 3 of session continuity — the Recent messages feed knows when it last read, keeps its errors, and re-reads on evidence

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/session-continuity` (a git worktree of
spideryarn2), branch `worktree-session-continuity`. TypeScript + ESM; the dashboard's browser code
is **React 19** (19.2.8) under `tools/fleet/web/src/`, compiled by a DOM-only tsconfig project.
Tests are vitest + jsdom. React 19 no longer warns about a state update on an unmounted component,
so a `console.error` spy cannot catch that class of teardown bug — a request count or a timer count
can.

## The candidate

Committed: commit `8465380d600f1a93235942b7897a4b09edf5d4fa`
             git show 8465380d600f1a93235942b7897a4b09edf5d4fa
             changed paths: `git show --name-only --format= 8465380d600f1a93235942b7897a4b09edf5d4fa`

**Scope the diff to that one commit.** The branch has merged `origin/dev` and carries other stages'
commits; a merge-base range would sweep them up.

Start with: `tools/fleet/web/src/FeedPanel.tsx` (`useFeed` and the digest), `feed-client.ts`
(`FeedApi.recent(limit, signal?)`), and `tests/fleet-feed-freshness.test.tsx` (new). Where to begin,
not the limit of scope.

**Another reviewer is working in this same worktree at the same time**, on Stage 1, with write
access to these files — which are therefore not yours to edit, and may change under you:
`tools/fleet/web/src/SessionDetail.tsx`, `SessionsPanel.tsx`, `RecentMessages.tsx`, `App.tsx`,
`continuity.ts`, `tests/fleet-web.test.tsx`, `tests/fleet-overseer-badge.test.tsx`. **Do not edit
them.** If a whole-project `npm run typecheck` or a test goes red in one of them, it is almost
certainly the other reviewer mid-fix: name the file, and re-run your own files alone. Your write
scope is `FeedPanel.tsx`, `feed-client.ts`, `tests/fleet-feed-freshness.test.tsx`,
`tests/fleet-feed-panel.test.tsx`, and `docs/project/fleet-recent-messages.md` § "Cost, and why it
is not polled".

## What it is meant to do

Read `docs/plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md` — Stage 3,
and ledger rows F5 and F6. You wrote F5 and F6. **Note how F6 was changed in the build**: its
wording made every verified ↔ unknown execution flip count as evidence, which on this box is a
re-read a minute for nothing; the digest now carries the last verified token per row instead. Check
that reasoning rather than taking it from me.

The guarantee, at its true strength:

> The feed is never polled on a timer. It re-reads on changed snapshot evidence — the session set, a
> row's status, its dialog, its conversation claim, a replaced run, a different tmux server — no
> sooner than `FEED_REREAD_FLOOR_MS` after the last read started, and only while the tab is visible.
> At most one read is in flight; a refresh asked for during one produces exactly one more. A read
> that never settles is released by the hook's own deadline whether or not the API honours abort.
> A failure never replaces the last good feed. The panel says when it last read successfully, and
> does not claim to notice a session that writes turns without changing status.

## What you can run, and what you may change

**You may edit this worktree.** Fix what is inside this stage — each finding red-first, with the
test that reproduces it — and leave everything wider as a finding for me to decide. Do not commit.
List every file you changed at the end.

You can run `npx vitest run tests/fleet-feed-freshness.test.tsx tests/fleet-feed-panel.test.tsx` and
`npm run typecheck` (read its exit code; its last two lines are always ✓). No network.
`tests/fixture-ids.test.ts` fails if any uuid appears in two test files.

The gates as I ran them on the committed tree, before your review: `npm run typecheck` exit 0
(`logs/tmux-jobs/sc-s3-typecheck-0814-243457.log`), and
`npx vitest run tests/fleet-feed-freshness.test.tsx tests/fleet-feed-panel.test.tsx tests/fixture-ids.test.ts tests/doc-links.test.ts`
— 4 files passed, exit 0 (`logs/tmux-jobs/sc-s3-tests-0814-243304.log`). The full suite has not
been run yet; I will run it once every stage's review has landed.

## Attack it

Independently, before my doubts. Is the guarantee above **accurate** as stated?

- **Can it loop, or fire on nothing?** Try every way the digest could change without the fleet
  changing: prose, ordering, a row's object identity, a re-served identical snapshot, an execution
  flip, a pid going to and from null.
- **Can it go silent when it should not?** A real replacement, a claim change, a new session, a
  dialog appearing — each must produce exactly one read, under the floor.
- **Fake timers and promises.** A test that advances time without flushing microtasks can pass for
  the wrong reason. Mutate the implementation and check each test actually fails.
- **Teardown.** Unmount, a limit change and a world change during a read: no request left open, no
  listener left attached, no late result drawn.

For each finding: an ID **starting at F50** — F1–F9 are the plan review's, and the Stage 1 review
running beside you is numbering from F10, so this range is reserved to keep the two apart — a
severity, and established or reasoned; (a) the input or mutation I can run;
(b) the smallest change that closes it. Severity by consequence:

  P0  data loss, exploitable security, or the tool broadly unusable
  P1  user-visible wrong behaviour, or an authoritative contract violated
  P2  design or maintainability risk with no wrong behaviour today
  P3  non-behavioural prose or comment defect

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions, worth less than yours

- The floor is measured from when the last read *started*. A read that hits the 15 s deadline
  therefore permits the next one 5 s later. Is that the right anchor?
- The per-row "last verified token" memory is a `useRef` map updated where the digest is computed.
  It only decides whether to schedule a read and never what is drawn, which is why a ref seemed
  acceptable. Is there a render React discards that could leave it wrong in a way that matters?
- The Read again button is disabled while a read is in flight, so the "one pending refresh" path is
  reachable only through the hook. Is that a promise the UI keeps, or only one the hook keeps?
