# Review: Stage 1 of session continuity — the fleet dashboard's detail pane follows the execution, not the tmux handle

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/session-continuity` (a git worktree of
spideryarn2), branch `worktree-session-continuity`. TypeScript + ESM; the dashboard's browser code
is React 18 under `tools/fleet/web/src/`, compiled by a second, DOM-only tsconfig project that
cannot import anything reaching `node:`. Tests are vitest + jsdom.

## The candidate

Committed: commit `93c3af300e0194e57a7a503cbcc1ec1952c6f62f`
             git show 93c3af300e0194e57a7a503cbcc1ec1952c6f62f
             changed paths: `git show --name-only --format= 93c3af300e0194e57a7a503cbcc1ec1952c6f62f`

**Scope that diff to that one commit.** The branch has merged `origin/dev` more than once, so a
merge-base range would sweep up other sessions' files.

Start with: `tools/fleet/web/src/continuity.ts` (new), then `RecentMessages.tsx`,
`SessionDetail.tsx`, `SessionsPanel.tsx`, `App.tsx`, and the new tests in
`tests/fleet-web.test.tsx` under the describes "the detail pane's state follows the execution, not
the handle", "recent messages, when the execution reading contradicts the row's claim", and "the
two answering refusals, and who owns each". Where to begin, not the limit of scope.

**Uncommitted files in the tree that are NOT the candidate:** `tools/fleet/web/src/FeedPanel.tsx`,
`tools/fleet/web/src/feed-client.ts`, `tests/fleet-feed-panel.test.tsx` may carry uncommitted edits
from a parallel stage (Stage 3). Do not review them and **do not edit them**.

## What it is meant to do

Read `docs/plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md` — Stage 1,
the section "Withhold, caveat or relabel", and § Delivery. You reviewed revision 1 of that plan;
`docs/plans/260910c-plan-review-sol.md` is your answer. Your F1 was not accepted and the plan says
why, with the code references — please check that reasoning rather than taking it from me.

The guarantee this stage claims, at its true strength:

> No state the detail pane holds and draws about a session — the composer's text, the steer and
> queue outcome cards, the dialog refusal, the held transcript — can be presented under a
> conversation or execution other than the one it was created against. An execution reading that
> goes unverifiable and returns with the same token destroys nothing. Whether a keystroke *reaches*
> the right conversation is the server's `verifyTarget`, freshly, and is not this stage's claim.

Mechanism: `useExecutionEpoch(row)` in `continuity.ts` keeps the last verified token per `row.id`,
advances an epoch only on `continuityOf(...) === "replaced"`, and returns
`JSON.stringify([row.id, epoch])`. `SessionsPanel` mounts `SessionDetail` with that key. The
transcript reader's identity is that epoch key plus `row.claudeSessionId` (which is what
`server.ts:772` actually fetches); `conflicting` relabels the turns rather than hiding them;
`StaleNote` withdraws on a verified conversation. The `grants-permission` refusal is keyed by the
epoch plus `questionSafetyKey(rawQuestion)`. The `answering-disabled` refusal is a page latch in
`App.tsx`.

## What you can run, and what you may change

**You may edit this worktree.** Fix what is inside this stage — each finding red-first, with the
test that reproduces it — and leave everything wider as a finding for me to decide. Do not commit.
List every file you changed at the end.

You can run `npx vitest run tests/fleet-web.test.tsx` (large; it runs) and `npm run typecheck`
(read its exit code — its last two lines are always ✓, and failures go to stderr). You have no
network. `tests/fixture-ids.test.ts` fails if any uuid appears in two test files; check before
adding one.

The gates as I ran them on the committed tree, before your review: `npm run typecheck` exit 0
(logged at `logs/tmux-jobs/sc-s1b-typecheck-0800-154359.log`), and
`npx vitest run tests/fleet-web.test.tsx tests/fleet-overseer-badge.test.tsx tests/fleet-questions-panel.test.tsx tests/fixture-ids.test.ts`
— 4 files passed, exit 0 (`logs/tmux-jobs/sc-s1b-tests-0800-154610.log`). The full suite has not
been run yet; I will run it after your fixes land.

## Attack it

Independently, before you read my own doubts.

Is the guarantee above **accurate** as stated? I am asking whether that sentence is true of this
code, not whether the design is sound. The places I would expect it to break:

- **Render purity.** `useExecutionEpoch` calls `setState` during render (React's "adjusting state
  when a prop changes" pattern). Is it guarded against looping? Is it safe under StrictMode's double
  render and under a render React discards? Is there a frame in which the key is stale?
- **Every sequence of readings** — first sight, same, replaced, unknown/claimed-only/not-reported
  flicker, a row disappearing and returning, selection moving between two unverifiable rows, and a
  tab round-trip that unmounts `SessionsPanel` and loses its map. What does each do to the key, the
  transcript identity, and the dialog key?
- **The three consumers of the epoch** each hold their own `useState` map. Can they disagree in a
  way that matters?
- **Tests that pass for the wrong reason.** Several of these were hard to make red — the report said
  two passed on the old code until rewritten. Mutate the implementation (drop `row.id` from the key,
  use the raw token, move the latch into `SessionDetail`) and check each test actually fails.

For each finding: an ID (continue from **F10** — F1–F9 are the plan review's), a severity, and
established or reasoned; (a) the input or mutation I can run; (b) the smallest change that closes
it. Severity by consequence:

  P0  data loss, exploitable security, or the tool broadly unusable
  P1  user-visible wrong behaviour, or an authoritative contract violated
  P2  design or maintainability risk with no wrong behaviour today
  P3  non-behavioural prose or comment defect

Refuse only on an established P0 or P1, and name what established it.

## My own suspicions, worth less than yours

These are already mine; spend most of the run elsewhere.

- **Three instances of `useExecutionEpoch`, three maps.** `SessionsPanel` holds one that survives
  across selections; `useRecentMessages` and `SessionDetail` each hold one that is born fresh on
  every mount. So inside the detail pane the epoch is always 0 until a replacement the parent would
  already have remounted for. I believe that is harmless — each key is only ever compared with
  itself — but I have not tried to break it.
- **The App latch's "a payload received after the refusal"** is object identity on `feed.state`.
  The transport re-parses on every 5-second poll, so a re-served, unchanged snapshot is a new object
  and satisfies "after". I checked that the payload's `answeringEnabled` and the tap-time refusal
  read the same env var, which makes this benign in practice. Is it benign in principle?
- **`StaleNote` withdrawing on a verified conversation.** Its headline is "this may not be this
  session's conversation", and a verified conversation disproves that; but its body also offers
  "one very long tool call" as the other explanation for a stale write time, and that explanation
  is not disproved. Is withdrawing the whole note the right cut?
- **`QuestionsPanel` still holds its own `answering-disabled` state**, a second latch for one
  server-wide fact. It was outside this stage's brief; is it inside this stage's guarantee?
