# Code review: showing the Codex usage reading (stage 4, the last)

You reviewed this plan and then stages 2 and 3 — twelve findings across those two rounds, all applied.
This is the final stage: making the reading visible. **Weight this above the plan review.** The bugs
that mattered most in the last two rounds (discarded spend-control states; a validator that guarded
against a bug while having it) did not exist until the code did, and the same holds here.

## The change under review

```
git diff 05d7f60d..f829277e
```

Branch `worktree-codex-usage`, 14 files, +1337/-80: the browser parser and view types
(`tools/fleet/web/src/usage-history-client.ts`), the card (`UsagePanel.tsx`), mount ownership
(`App.tsx`, `OverseerPanel.tsx`, `UsageHistory.tsx`), the CLI (`scripts/overseer.ts`), the doc
(`docs/project/usage-history.md`), and five test files including two new ones.

Implemented by GPT-5.6-Sol under `workspace-write`. I reviewed it, ran the checks, ran the real command,
fixed a label-alignment blemish, and committed.

## Context, in reading order

1. **`docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md`** —
   stage 4 is the specification; stage 1 holds the measured facts that constrain what may be drawn.
2. **`docs/plans/260909d-codex-usage-stage4-codex-task.md`** — the brief the implementer received.
3. **The thirteen cautions** the implementer itself raised for this stage, at the end of
   `docs/plans/260909d-codex-usage-stage3-report.md` (eight) and
   `docs/plans/260909d-codex-usage-stage3b-fix-round-report.md` (five). **Please check they are
   honoured, not merely mentioned.**
4. **`docs/project/usage-history.md`** § "What the chart may not claim" — eight rules that apply here.
5. Your own stage-2 and stage-3 reviews, in `docs/plans/260909d-codex-usage-stage*-code-review-sol-r1.md`.

## What this has to get right

A person and an autonomous orchestrator both read this to decide which of two paid accounts to spend on
the next piece of work. **A screen that looks calm while the account is exhausted is the failure**, and
so is a number attributed to the wrong window, the wrong bucket or the wrong moment.

Live values as I write this: Claude 76% of its weekly window, Codex 30% of its weekly window, two full
reset credits available. The Codex number moved 24% → 26% → 30% during today's work, so it is genuinely
live — and it is **non-monotonic at short range**, oscillating a full point between readings seconds
apart, which is measured and recorded in stage 1.

## Where I would look first

My own suspicions; rank them last if you cannot break them.

1. **Does anything render an absence as a number?** That is this codebase's signature failure. The
   parser has a legacy `absent` arm, a malformed `unknown` arm, and value arms with optional fields.
   Is there a path where a missing window, a missing bucket, a null `resetCredits` or a legacy line
   reaches the screen as `0%`, or as a calm tone?
2. **Newest-reading selection.** `UsageHistoryView.latestCodex` is chosen by file order, and a newer
   attempt is supposed to supersede an older value even when the newer one is unknown, absent, omitted,
   unreadable or unsupported. Is that true on every arm? A stale-but-valid reading winning over a fresh
   failure would be exactly the wrong direction.
3. **Two mounts, one reading.** Ownership was lifted into `App.tsx` so the Usage tab and Overseer tab
   cannot disagree. Can they still, on any path — a tab mounted before the first fetch, an error state,
   a refresh in flight?
4. **The absent-versus-malformed distinction**, which stage 3 built six absences around. `parseSample`
   uses `hasOwn` to decide whether to parse at all. Does that distinction survive all the way to what a
   person sees, or does the card collapse them?
5. **The CLI.** `--json` now carries `codex` beside the existing keys; the text path prints both
   accounts. Does a Codex failure degrade either output rather than costing the Claude reading? I ran
   both paths against the live box and they look right, but I have only seen the happy path.

## What I most want from you

- **Can this screen or this command state something false?** Not merely incomplete — false.
- **Are the tests real?** 520 green across seven suites is a number. The route→parser→DOM test is the
  one I care about most, because a whitelist is what it exists to catch; can it fail if the field is
  dropped again? In each of the last two rounds you found a test that could not fail for the reason it
  named, and one of those I had explicitly praised.
- **Anything in the thirteen cautions that is honoured in name only.**
- **Anything simpler.** 1337 lines to display one reading is a lot, though much of it is tests.

## How to report

Per finding: severity (**P0** must not land / **P1** fix before landing / **P2** worth doing / **P3**
opinion), then **(a)** an input or condition I can run or construct that breaks it, and **(b)** the
smallest change that closes it, as a code block. Rank by (a) and say when a finding has none. Please do
not patch the tree — hand me the mutation so I can watch it fail first.

You can run one test file (`npx vitest run tests/<one>.test.ts`) and `node --import tsx <script>`. There
is **no network at all**; `npm test` and `npm run typecheck` will not run. I have run typecheck (clean,
by exit code), the seven focused suites (520 green), lint on the touched files, and the real
`overseer usage` command in both text and `--json` form; the full suite is running as I write this and I
will not land without it. A red test inside your sandbox may be the sandbox — say so if you cannot tell.

Finally: **state an explicit verdict** — land as is, land with changes, or do not land — and say which of
my five suspicions you checked and which you could not, and why. Silence will not be read as agreement.
