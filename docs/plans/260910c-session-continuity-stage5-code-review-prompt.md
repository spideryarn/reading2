# Review: Stage 5 of session continuity — the regressions extended, a named region, and an abort that reaches the server

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/session-continuity`, branch
`worktree-session-continuity`. TypeScript + ESM; the dashboard's browser code is **React 19**
(19.2.8) under `tools/fleet/web/src/`; tests are vitest + jsdom. React 19 no longer warns about a
state update on an unmounted component, so count requests and timers rather than spying on
`console.error`.

## The candidate

Committed, in order:

1. `05990f06c995eadc2b37aaaf76a9643ff013774f` — **5a**: the new-session panel (`NewSessionPanel.tsx`)
   — one press is one launch (a `posting` guard in the action itself), and the absolute discovery
   deadline beats a late poll answer; `tests/fleet-new-session-deadline.test.tsx`.
2. `c2d1c19159a7aca6bacb04c8093ec0583c0609ec` — **5c**: the per-session transcript reader
   (`RecentMessages.tsx`) on the shared single-flight reader — one read per double tap on *Read
   again*, teardown on unmount, a 30-second deadline — and the detail pane's focus target as a named
   `<section>` (`SessionsPanel.tsx`); `tests/fleet-detail-reader.test.tsx`.
3. `f5fe6fec30a7d8628ca73703dbda352c20600bba` — the abort signal carried through `MessagesApi.recent`
   in `messages-client.ts` to `fetch`, so an abandoned transcript read stops costing the server —
   including through `withClockSkew`, the wrapper `App` actually hands the page.

No browser-check fixes: the check found nothing that needed one (below).

       git show <each>

**Scope the diff to those commits.** The branch has merged `origin/dev` many times and carries every
other stage's commits; a merge-base range would sweep them up.

**Another reviewer is working in this worktree at the same time**, with write access, on Stages 2
and 4. These files are theirs and **not yours to edit**, and may change under you:
`SessionDetail.tsx`, `drafts.ts`, `MessageOverseerCard.tsx`, `BroadcastCard.tsx`, `useActions.ts`,
`actions-client.ts`, `ActionButtons.tsx`, `FeedPanel.tsx`, `feed-client.ts`,
**`single-flight-reader.ts`** (5c uses it, but it is Stage 4's), and the tests `fleet-web`,
`fleet-drafts`, `fleet-overseer-message`, `fleet-broadcast-card`, `fleet-actions-freshness`,
`fleet-feed-freshness`, `fleet-feed-panel`, `fleet-single-flight-reader`. If a whole-project
`npm run typecheck` or a test goes red in one of those, it is almost certainly them mid-fix: name
the file and re-run your own. **Your write scope:** `NewSessionPanel.tsx`, `RecentMessages.tsx`,
`SessionsPanel.tsx`, `messages-client.ts`, `tests/fleet-new-session-deadline.test.tsx`,
`tests/fleet-detail-reader.test.tsx`. If a Stage 5 fix genuinely needs the shared reader changed,
report it rather than making it.

**Three plans share the letter `260910c` today**; `260910c-stage2-code-review-*` belong to a
*different* plan. Do not read them as context and do not edit them.

## What it is meant to do

Read `docs/plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md` — Stage 5,
including 5a's and 5c's status notes and the abort follow-up, and the roadmap checkboxes it answers
(`docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § Session continuity, checkboxes 4
and 6).

**The guarantees, at their true strength:**

> **5a.** One activation of Start launches at most one session, however fast the second tap comes
> and whatever path calls the action; a thrown POST cannot leave the button dead. A poll begun before
> the absolute four-minute discovery deadline but answering after it does not update the launch or
> erase the give-up state; the deadline wins, the late answer is discarded, and no further poll
> starts. The existing deadline regressions are unchanged.
>
> **5c.** A second activation of *Read again* while a transcript read is in flight starts no second
> read. Unmounting the detail pane during a read leaves nothing drawn from its answer and starts
> nothing further. A read that never answers is released after 30 seconds as a visible refusal,
> never left as "Reading…". The detail pane's focus target is a named region whose label a screen
> reader announces when focus moves into it.
>
> **5d.** When the page stops waiting for a transcript read — a deadline, an unmount, a newer
> identity — the fetch is aborted, not merely ignored.

**The browser check's findings, for context.** A Playwright run against a build of `03743ea3`, at
390 px and 1280 px, keyboard-only and through an offline return, with every `/api/*` answered from
fixtures: **Stages 1–4 passed every bullet.** Keyboard: every control reachable by Tab with a visible
focus ring; *Read again* comes before the composer in tab order, which is DOM order. Offline: the
page kept its rows, said STALE, and recovered unprompted. **Touch targets:** several controls are
under ~44 px in their shorter dimension, among them two new to this stage — the composer's Clear
(51×28) and the actions age line's tooltip trigger (70×17). **Sessions list:** 25 rows at 390 px
span about 4.5 screen-heights, and a known title mid-list took 6 scroll gestures to reach; no text
filter was built. Neither the touch targets nor the filter is this review's question, but if a
Stage 5 control you are reviewing is one of the small ones, say so.

## What you may change

**You may edit this worktree**, inside your write scope above: fix what you establish, red-first,
and report anything wider. Do not commit. List every file you changed.

Gates as I ran them: `npx vitest run tests/fleet-` passed **99 of 99 files** on the tree merged
with `origin/dev` at `03743ea3`, which contains all three commits above
(`logs/tmux-jobs/sc-m4-tests-1026-1319380.log`); `npm run typecheck` exit 0
(`logs/tmux-jobs/sc-m4-typecheck-1026-1319477.log`).

## Attack it

Independently. Is each guarantee **accurate**?

- **5a.** Two taps before the redraw; a tap after a give-up (a fresh deadline, not the old one); a
  POST that throws; a poll answer landing exactly on the deadline tick, just after it, and after the
  give-up. Does anything else call `start`?
- **5c.** The shared reader's `stop()` is final, so the reader is built per effect run — check
  StrictMode's rehearsal mount and a real unmount both behave. A tap in the frame before `busy`
  disables the button; an identity change during a read (the claim moving from null to a value while
  the first read is still out); and the interaction with Stage 1's identity and provenance checks —
  a dropped tap must never be the one that would have read the *new* identity.
- **5d.** Does the signal reach `fetch` on every path, through `withClockSkew` included, and is an
  aborted fetch reported as the page stopping rather than the server failing?
- **The region.** Is a `<section>` with `aria-label` and `tabIndex={-1}` announced on programmatic
  focus, and does it stay out of the tab order?

Findings **start at F80** (Stage 1 used F10–F24; Stages 2 and 4 start at F25; Stage 3 used
F50–F57). Each: ID, severity, established or reasoned; (a) the input or mutation I can run; (b) the
smallest change.

  P0  data loss, exploitable security, or the tool broadly unusable
  P1  user-visible wrong behaviour, or an authoritative contract violated
  P2  design or maintainability risk with no wrong behaviour today
  P3  non-behavioural prose or comment defect

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions, worth less than yours

- **5c drops, rather than coalesces, a tap during a read.** The implementer's argument: the button
  disables while busy, so such a tap lands only in the frame before the redraw and duplicates the
  tap that started the read. Is there a path where the tap is *not* a duplicate — the identity
  changing between the two taps?
- **5c's 30-second deadline is a guess.** `/api/messages` has no server-side limit. If a real read on
  a loaded box takes longer, the page now shows a refusal where it used to wait. Is 30 s right, and
  does the refusal invite trying again rather than read as a failure?
- **5a's F9 trade-off** throws away a genuine `started` arriving a second after the deadline. The
  banner sends the reader to the session list; check it says so plainly.
