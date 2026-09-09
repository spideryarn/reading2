# Implement stage 2: the Codex usage reading

You are implementing one stage of a plan that has already been researched and cross-reviewed. Work in
this checkout (a git worktree, branch `worktree-codex-usage`). The tree is committed and clean, so
`git diff` afterwards shows exactly your work — please do not commit; I read the diff and commit from
outside.

## Read these first, in this order

1. **`docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md`** —
   the plan. **Stage 2 is your specification**, and stage 1 is the measured evidence behind it. Read
   the whole file: the stage-1 findings are what the stage-2 design is made of, and several of them are
   traps you would otherwise walk into.
2. **`docs/plans/260909d-codex-usage-plan-review-sol-r1.md`** — the review that shaped stage 2. Your
   own predecessor's findings, in effect. Findings 3, 6, 7 and 8 are directly about the code you are
   writing.
3. **`tools/overseer/usage.ts`** — the Claude-side module this one mirrors. **Copy its shape.** Read
   its header carefully; it explains the pure/impure split and why every reading has an explicit
   unknown arm. Do not restate its reasoning in your own file, cite it.
4. **`docs/reusable/silent-success.md`** — the failure class this codebase cares most about. Short.
5. **`tools/fleet/wire.ts`** — where every shape that crosses to a renderer is declared, once. Read the
   header for why nothing but types lives there.

## What to build

Exactly what stage 2 of the plan specifies, and nothing beyond it:

- **`tools/fleet/wire.ts`** — add `CodexUsageWindow`, `CodexUsageBucket`, `CodexUsageReading` as the
  plan gives them. Types only; a `const` in this file gets bundled into the browser.
- **`tools/overseer/codex-usage.ts`** — the new module. Every `parse*` / `derive*` function pure, with
  `now` taken as a parameter so a test can pin it. Exactly one function (`collectCodexUsage`) touches
  the process or the filesystem. Nothing at module scope does I/O.
- **`tests/codex-usage.test.ts`** — the tests, against the checked-in fixtures in
  `tests/fixtures/codex-usage/`. Read that directory's `README.md`: it says which fixtures are real and
  which are synthetic, and what each degenerate bucket is for.

**Do not touch** `~/.overseer/usage.jsonl`, the history record, `scripts/overseer.ts`, `UsagePanel.tsx`
or anything under `tools/fleet/web/`. Those are stages 3 and 4. Do not modify `run-codex.ts` or
`daemon.ts`. Do not add a dependency.

## The five things most likely to go wrong

These are measured, not hypothetical. Each is in the plan with its evidence; they are collected here
because they are the ones that would produce a plausible-looking module that is wrong.

1. **`primary`/`secondary` are positions, not window names.** `primary` is the weekly window on the
   `codex` bucket and the five-hour window on `codex_bengalfox`. Keep the slot *and* the duration, in
   an array. Do not key a map by a derived name — two 10080-minute windows would silently overwrite
   each other, and a null duration cannot be named at all. Duration-to-label is display-only.
2. **`CODEX_API_KEY` must be absent from the child environment**, with `HOME` and `CODEX_HOME`
   preserved. Codex prefers that key whenever it is set, so inheriting it can make the module report a
   different account's headroom under a card that says "the subscription". `scripts/run-codex.ts`
   already does this withholding for the same reason — look at how, and be consistent with it.
   **Assert the exact child environment in a test**, through the injected executor.
3. **Bucket precedence.** `rateLimitsByLimitId` is canonical when present; the bare `rateLimits` is a
   fallback only. A `codex` snapshot that disagrees between the two becomes `unknown`, never
   first-wins. Only the general `codex` bucket is a decision input; if it is absent, general headroom is
   `unknown` and no other bucket may substitute for it.
4. **Two error arms, not one.** `-32600` (not logged in) is persistent and needs a person; `-32603`
   (fetch failed) is transient. The `unknown` arm carries `retryable` to keep them apart.
5. **The protocol mechanics**, all settled by the spike at
   `tests/fixtures/codex-usage/capture/spike-app-server-from-node.ts` — read it, it is short and it is
   the working reference. In particular **stdin must stay OPEN**: this is the opposite of
   `run-codex.ts`'s rule that fd 0 must reach EOF, and reasoning from that file will hang you. Also:
   match the reply by its own JSON-RPC id (a `remoteControl/status/changed` notification arrives in
   between), send `initialized` before the call, and kill the whole process group on timeout.

## Tests: red first, and one specific test must be red before it is green

The house rule is that a reproduction which was never red proves nothing. **Write the
positional-mapping test first and run it against a deliberately naive implementation** (map
`primary → five_hour`) so you watch it fail, then implement properly and watch it pass. Say in your
report that you did this and what the failure output was.

> **This instruction was wrong, and Codex caught it.** `primary → five_hour` is *correct* for the
> `reversed` fixture, whose primary really is the 300-minute window — so that mutation cannot make
> that test red. The naive mapping the test actually detects is `primary → weekly`, which is what was
> used. Left uncorrected above so the brief stays what was actually sent; noted here because a
> mutation specified without checking that it fails is a red-first ritual that proves nothing, which
> is the very thing the rule exists to prevent.

That test: the `reversed` bucket in `app-server-degenerate-windows.json` has `primary` at 300 minutes
and `secondary` at 10080. It must not report the 300-minute window as the weekly one.

Then cover: null duration, null reset, unrecognised window length, limit reached
(`rateLimitReachedType` set), both error arms, both bucket-disagreement cases from Sol's finding 7, the
withheld-`CODEX_API_KEY` assertion, `resetsAt > sourceAt` rejection, and the real session-log fixture's
different key names (`window_minutes`, and a float `used_percent`) — **as a parser test only**; the
session-log *fallback path* is explicitly out of v1 scope per Sol's finding 8.

**Inject the spawn.** No test may talk to OpenAI or spawn `codex`. Follow whatever injection pattern
`usage.ts` uses for its own command execution.

## How to run things here

- One test file: `npx vitest run tests/codex-usage.test.ts` — this works.
- `node --import tsx <script>` works. **`npm run typecheck` and `npm test` do not** (the sandbox denies
  the socket they need). I will run both and hand you the output if anything is red.
- There is **no network at all**, not even loopback. So you cannot take a live reading; the fixtures are
  there precisely so you do not need to. Do not report a failure to reach the network as a finding.

## What to report back

- The files you changed, and the shape you settled on for each type.
- **The red-then-green evidence** for the positional-mapping test: the actual failure output, then the
  pass.
- Anything in stage 2's specification that turned out to be wrong, ambiguous, or impossible — I would
  much rather have that than a faithful implementation of a bad instruction. Say so plainly and say
  what you did instead.
- Anything you noticed that belongs to stage 3 or 4 and that those stages, as written in the plan,
  would get wrong.
- Anything you could not check, and why.
