# Review: generating and displaying a one-sentence description of what each agent session is about

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/260909a-dashboard-descriptions`, branch
`worktree-260909a-dashboard-descriptions`. TypeScript + ESM, run with `tsx`, tested with vitest; the
browser client is React 18 built by Vite and tested in jsdom.

This is the **third** review on this plan. The first reviewed the plan
(`260909a-dashboard-session-descriptions-review-sol.md`, F1–F12); the second reviewed a UI change
(`…-review-e-sol.md`, F13–F18). **Number any new findings above F18.**

## The candidate

Committed. `git diff e8d69b37~1..db1ddb3e` — but that range includes merges from `dev` carrying other
sessions' work, so **the manifest is what defines the candidate**:

```
tools/fleet/transcript.ts          (readOpeningMessages only — the rest of the file is not new)
tools/fleet/describe.ts            (new)
tools/fleet/describe-store.ts      (new)
tools/fleet/describe-pass.ts       (new)
tools/fleet/collect.ts             (the `description` field and `readDescriptions` only)
tools/fleet/server.ts              (describeOnce / describeLoop only)
tools/fleet/wire.ts                (the SessionDescription block at the end only)
tools/fleet/web/src/types.ts       (parseDescription and the row field only)
tools/fleet/web/src/SessionsPanel.tsx (headingFor, the heading, the description line)
tests/fleet-describe.test.ts       (new)
tests/fleet-describe-store.test.ts (new)
tests/fleet-describe-pass.test.ts  (new)
tests/fleet-transcript.test.ts     (the opening block only)
tests/fleet-web.test.tsx           (the heading block only)
```

Start with `describe-pass.ts` and `collect.ts`. That is where to begin, not the limit of scope.

## What it is meant to do

Greg: *"For each session, provide a 1-2-sentence description of what it's about, and show in the
Session List."* A cheap model call (`gpt-5.6-luna` over OpenRouter) reads a session's **opening
turns**, produces a title and a sentence, and the list shows them.

### The invariants, each with an accident behind it

- **The page must never say something confident and untrue about a session.** `CLAUDE_SESSION_ID` is
  set once when a tmux session is created and **never updated** (`transcript.ts` says so), so a pane
  re-used for a second conversation still names the first. A description keyed on content alone would
  match, and conversation A's sentence would render on conversation B's row — well formed, correctly
  attributed, and wrong. Defended twice: a gate (`describeKey` requires a `verified` execution *and* a
  `verified` conversation) and the cache key (the execution token is *in* it, so a stale record is
  unreachable rather than merely unrendered).
- **An empty string is never a description.** Refused at the parse, at the store's read, and at the
  client's parse.
- **A reading that could not be taken must not render as a reading — or as silence.** A row with no
  description draws no line; `not-yet-described` is a real state with a reason, and it is the *normal*
  state until the dashboard and daemon are restarted onto execution readings.
- **No model call may run on the collector's clock.** `collect()` has a deadline; the describe pass
  runs on its own loop and writes a file, and `readDescriptions` only reads it.
- Thirty sessions must not mean thirty calls a minute: keyed on the opening (which does not change),
  budgeted by `maxCalls`, and what the budget drops is reported.

Out of scope: the idle summary (not built); the detail view (reviewed separately as F13–F18); the
Overseer notification (separate).

## What you can and cannot run

The tree is read-only; `/tmp` and node_modules caches are writable. **Please run the test files** —
they are pure and need no network, no tmux, no Postgres:
`npx vitest run tests/fleet-describe-pass.test.ts` (and the other three). `npm run typecheck` and
`npm test` are blocked by the sandbox; I have run both and they are clean — 973 tests across 15 fleet
suites, typecheck EXIT=0 across all projects.

What I cannot hand you is the screen. A browser check at 1280 and 390 confirmed: no overflow, no
overlap, zero console errors, a bare row draws no description line and no phantom gap, and the clamp
bites at 390 (2 lines with an ellipsis, `clientHeight` 38 vs `scrollHeight` 75).

## Attack it

Independently, and before you read my doubts at the bottom.

**The invariant I most want broken: find a path where a description is shown on a row it is not about,
or where a session that should be described silently never is.** Consider at least: two sessions whose
openings are byte-identical; a session re-executed in the same pane; a pane whose conversation changes
between the describe pass and the collection that joins it; a `descriptions.json` written by a
different build; the budget binding on a fleet where the same sessions always sort last.

**Second: is the money bounded in every path?** `describeOnce` runs on a 5-minute loop against a
`maxCalls` of 8. Find a sequence where it pays repeatedly for the same session, or where a pass makes
calls it did not need to.

For each finding give an ID (**F19 onwards**), a severity, and whether it is **established** or
**reasoned**; (a) the input or state that makes it fail its own claim; (b) the smallest change that
closes it. A finding with no (a) goes last.

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

**Refuse only on an established P0 or P1, and name what established it.**

## Give the question a floor

Three questions with answers:

1. **Is the claim "a stale description is unreachable rather than merely unrendered" accurate as
   stated?** The token is in the key and the gate checks the reading. Is there a sequence where a
   record written under one identity is read back under another?
2. **`readDescriptions` runs inside `collect()` and reads a file another loop writes.** Is there a
   torn-read or ordering problem, given `writeDescriptionMemory` is atomic (temp + rename)?
3. **Does the pass's bookkeeping actually balance?** `describeBreakdownBalances` asserts two
   equalities. Are they the right two, and can either be satisfied while a session has been dropped?

## My own suspicions — read last, worth less than anything you find yourself

- `openingFingerprint` is a 32-bit FNV-1a. Collisions are possible in principle; the key also carries
  the session and token, so a collision would need two sessions with the same id and token. Is that
  reasoning sound, or am I relying on something I have not stated?
- The pass rebuilds its memory from what it saw, so a session absent from one snapshot loses its
  description and pays again when it returns. Is that the right trade, or should it age out instead?
- `describeOnce` reads `snapshot?.rows` at the moment it runs, and the join happens on a later
  collection. Is that skew a problem?

Do not change any file.
