# Review: moving an agent dashboard's conversation section to the top of its detail view

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions`, branch
`worktree-260909a-dashboard-descriptions`. TypeScript + ESM, React 18 client built by Vite, tested
with vitest in jsdom. **This is a code review of a landed-but-uncommitted change**, and it is the
second review on this plan — the first reviewed the plan and its findings are in
`docs/plans/260909a-dashboard-session-descriptions-review-sol.md`.

## The candidate

Live pre-commit; base `af68a154`.

- Scoped paths, all tracked and modified:
  - `tools/fleet/web/src/RecentMessages.tsx`
  - `tools/fleet/web/src/SessionDetail.tsx`
  - `tests/fleet-web.test.tsx`
- Untracked files: **none.**

`git diff af68a154 -- tools/fleet/web/src/RecentMessages.tsx tools/fleet/web/src/SessionDetail.tsx tests/fleet-web.test.tsx`

(Not durable — I will record the resulting commit SHA here once it lands.)

Start with `RecentMessages.tsx`, then `SessionDetail.tsx`. That is where to begin, not the limit of
scope.

## What it is meant to do

Greg, 2026-09-09: *"In the Session Detail section, show the most recent message (perhaps with a
summary if idle) prominently near the top, with the input-box and command-lists underneath, with a
button to click to open up the previous messages in a popup panel or something."*

So the session detail's conversation section moved from **last** to **second**, and split: the newest
turn renders under a heading *Latest message*, and the earlier turns plus all the provenance sit
behind a native `<details>` disclosure. The composer, the action buttons and the queue moved below it.
*What it needs from you* stays first. *Where it is* stays last.

**The reading is unchanged.** One `useRecentMessages` hook, one fetch, one `MessagesView`; only the
rendering is split into `LatestMessage` and `EarlierMessages`, both taking the same view, so the
newest turn and its older siblings cannot disagree about what was read.

### The invariants it must not break

- **A reading that could not be taken must not render as a reading — or as silence.** The four states
  with no newest turn (`not-found`, `unreadable`, `no-answer`, and *not read yet*) must surface at the
  **top**, with the latest message. If they rendered only inside the closed disclosure, the top of the
  page would draw nothing and read as *a session that has said nothing*, which is a confident false
  statement about a session. This is the house rule in
  `docs/project/overseer-direction.md` § "A higher bar for robustness here than elsewhere".
- **A caveat that changes what you DO belongs with the thing it qualifies; one that changes what you
  BELIEVE may live one tap away.** That is why the stale-transcript warning moved up with the newest
  turn and the byte-count provenance did not. The disclosure is closed by default, so anything inside
  it is something the reader may never see.
- **`DELIVERY_HEADLINE` in `SessionDetail.tsx` must be byte-identical.** It is another workstream's
  four-armed delivery-outcome rendering; this change may re-parent it but must not alter a word.
- `tools/fleet/wire.ts` is untouched here and must stay so.

Deliberately out of scope: the idle summary (it needs a describer that is blocked on another
session); rendering markdown in turn bodies; the server-side mid-word truncation of long turns.

## What you can and cannot run

The tree is read-only; `/tmp` and the node_modules caches are writable. **You can and should run the
test file**: `npx vitest run tests/fleet-web.test.tsx` — it is jsdom-only, needs no network, no
Postgres and no tmux, and it is 345 tests including six new ones. `npm run typecheck` and `npm test`
are blocked by the sandbox; I have run both and they are clean.

What I cannot hand you is the screen. A browser check at 1280×900 and 390×844 reported: correct
section order by vertical position at both widths; `scrollWidth === clientWidth === 390` open and
closed; console completely silent. It also found the defect I had shipped — the disclosure summary was
styled exactly like a section heading, so it did not read as a control at all. That is fixed and is in
the candidate.

## Attack it

Independently, and before you read my own doubts below.

**The invariant I most want broken: is there any path through this change where the top of the detail
view renders nothing, or renders something untrue, about a session?** Consider at least: every arm of
`MessagesView`; a `found` view with zero turns; a `found` view with exactly one turn; a row whose
status is `shell` (which short-circuits the sections below the conversation); the transition when a
pane keeps its handle and changes its conversation; and the first render before the fetch resolves.

**Second: are the six new tests capable of failing for the right reason?** I mutated the code once —
rendering every turn in `LatestMessage` instead of only the newest — and exactly one test went red.
That is one mutation. Find an edit to this diff that the suite would not catch and that a reader would
care about.

For each finding give:

- an ID (F13, F14, … — **numbered above F12**, which is the highest issued on this plan so far;
  reuse an earlier ID only for the same finding)
- a severity (P0/P1/P2/P3) and whether it is **established** or **reasoned**
- (a) the input or state that makes it fail its own claim
- (b) the smallest change that closes it

A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Refuse only on an established P0 or P1, and name what established it.**

## Give the question a floor

I am not asking whether the layout is nice. Three questions with answers:

1. **Is the claim "the newest turn and its older siblings cannot disagree about what was read"
   accurate as stated?** Both components take the same `MessagesView`, but `EarlierMessages` takes
   `reading.view` while `LatestMessage` takes the whole `reading`. Is that a distinction that can
   produce two different readings on one screen?
2. **Is the refusal-at-the-top guarantee complete?** Name any state in which the top renders neither a
   turn nor a refusal.
3. **Does `turns.slice(0, -1)` in `EarlierMessages` agree with `turns[turns.length - 1]` in
   `Latest` for every array length, including 0 and 1?**

## My own suspicions — read last, and worth less than anything you find yourself

- `Latest` computes `transcriptAge` and `Found` computes it again from the same `view`. Two call
  sites, one input — harmless duplication, or a seam where they could diverge?
- The disclosure content is capped at `max-h-[60vh]` with `overflow-y-auto`. Does that hide anything
  with no indication there is more, on a short viewport?
- `EarlierMessages` returns `null` for every non-`found` view. That is intentional (the refusal is
  upstairs), but it means the component silently renders nothing in four states. Is `null` the right
  answer, or should it be unrepresentable?

Do not change any file.
