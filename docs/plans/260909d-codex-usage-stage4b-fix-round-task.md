# Apply the stage-4 code review findings

You implemented stage 4. The cross-family reviewer returned **six findings — four P1, two P2 — and the
verdict "land with changes"**. This is the last fix round of this plan.

Work in this checkout (git worktree, branch `worktree-codex-usage`), clean at `f829277e`. **Do not
commit**; I read the diff and commit from outside.

## The findings

**`docs/plans/260909d-codex-usage-stage4-code-review-sol-r1.md`** — read it in full and work from it
directly. Relayed unedited: nothing renumbered, merged, split or reordered.

Each carries **(a)** an input that breaks the current code and **(b)** a suggested change. **Apply (a)
first and watch it go red, then apply (b), then watch (a) get caught.** Never apply a (b) whose (a) you
could not make fail — say so and leave it. Report per finding: *reproduced / could not reproduce /
disagree*.

I verified finding 2 in the source myself before sending this. The others I have read but not
reproduced; if any is wrong, say so.

## Notes on specific findings

**Finding 2 is the most important one, and it is structural.** `codexAttempt` reads
`sample["line"]["codex"]` straight off the raw record, so there are two parsing paths where there
should be one. The consequences are worse than duplication: a sample that `parseSample` rejects (say
`pass: null`) contributes no sample to the history and *still* supplies a trusted percentage — and the
route→parser→DOM test cannot catch a reintroduced `parseSample` whitelist, because the selector never
goes through it. I described that test as the guard on the whitelist when I briefed you, and I was
wrong. Sol's fix removes the second path; take it.

**Findings 1, 3 and 5 are one family**: the screen stating in the present tense something the reading
only claimed at the moment it was taken, or drawing decision numbers beside a state that invalidates
them. Stage 1 established that the reading is a snapshot of a live counter; the card has to say *when*
a backend state was true, not merely that it was.

**Finding 3 deserves care.** Stage 3 deliberately made the persisted validator an independent boundary
so a producer regression could not resurrect the discarded-state bug from the very first review. That
argument only holds if the *renderer* also refuses to draw calm headroom beside an unmodelled spend
limit. Mirror stage 2's fail-closed rule at the rendering boundary, as Sol shows. Sol also suggests
mirroring it in `codexBucketLines` for the CLI; do that too — the CLI is safe only because today's
producer rejects those states first, which is the same accident stage 3 refused to rely on.

**Finding 6** is the same class as the composition-root assertion you fixed last round: use the Babel
machinery already in `tests/fleet-usage-history-wiring.test.ts` rather than adding anything.

## Constraints

- Files: `tools/fleet/web/src/usage-history-client.ts`, `UsagePanel.tsx`, `UsageHistory.tsx`,
  `scripts/overseer.ts` (the usage command and its helpers only), and the stage-4 tests.
- **Nothing in `tools/overseer/codex-usage.ts` or the history record** unless a finding genuinely
  requires it — say so if it does.
- **Do not import `scripts/subagent-cli.ts` or anything reaching `src/env.ts` from a file under
  `tools/`** — `tests/fleet-imports.test.ts` forbids it and it has reddened this suite once already.
- No new dependency. Babel is already a devDependency and is already used this way.
- Do not weaken or delete a test to make a change fit. Say which tests changed and why.

## Tests

Every finding gets a test that fails before its fix. Two specific ones Sol named:

- After finding 2, **deleting `codex` from `parseSample`'s whitelist must fail the route→parser→DOM
  test.** That is the whole point of the change; please verify it explicitly and report the red output.
- Finding 4 wants a deferred-promise hook test that resolves request 2 before request 1.

## How to run things

- `npx vitest run tests/<one>.test.ts` and `node --import tsx <script>` work.
- **`npm run typecheck` and `npm test` do not** — I run those. Your own direct TypeScript check does
  not cover the test projects; it has passed while the real typecheck failed on a test file.
- **No network, no live reading.**

## What to report

- Per finding: reproduced / could not reproduce / disagree, with red output then green.
- Explicitly: the red output for the `parseSample` whitelist mutation after finding 2.
- Any (b) you think is wrong, and what you did instead.
- Anything left undone, and anything you could not check.
