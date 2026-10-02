# 261002h — late commits roll to the next release's notes

Up: [changelog.md](../project/changelog.md) · [overseer.md § Deploying](../project/overseer.md#deploying)
· the design this loosens: [261001q](261001q-changelog-written-before-the-deploy-so-the-notes-ship-in-it.md)

## Why

Greg, 2026-10-02, to the Overseer:

> I don't know how often this is a problem where the release notes get into a bin because dev keeps
> moving. If you think it is a problem, then we don't want the perfect to be the enemy of the good, so
> consider whether there's a slightly simpler approach that would get us almost all of the value, and
> if so, update, deploy, approach, and dox accordingly.
>
> As I say, not if it's going to involve a huge trade-off, but a small trade-off is fine.

It is a problem. On 2026-10-02, with about six sessions pushing to `dev`, the Overseer saw
`changelog:prepare` stop twice on *"HEAD is not origin/dev — pull first"*, one prepare take a second
model round because release commits landed during the first (about 25 minutes of Sonnet trawl each),
and then `npm run deploy` must still start level with `origin/dev` while its `changelog` gate
(`deploy-checks.ts` § `changelogGap`) refuses if **any** release-path commit sits after the sha the
notes describe. A push in that gap means preparing again. On a busy `dev` the gap is never empty for
long, so the gate and the trunk gate together are a treadmill: each lap is a model run, and every lap
gives the next push another window to land in. Step 4 of the Overseer's deploy (bring `/help` up to
date) feeds it too: a Help commit is a release commit, so it means preparing again.

## What 261001q wanted, and what this keeps

1. **The notes ship in the deploy they describe.** Kept: `prepare` still runs before the deploy and
   commits the notes into the candidate.
2. **Every production deploy gets one line, and the one a deploy replaces is recorded.** Kept
   unchanged: `servingUnrecorded` and `promote` are not touched.
3. **Strict coverage** — no release commit may ship undescribed. **This is the part given up.**

## The design: late commits are described by the next release

**The mechanism already exists.** `changelog.ts` § `planPromotion`, written for the forced-deploy
escape: when a deploy shipped release commits after the sha its notes describe, the history line
stops at the described sha rather than the deployed commit (*"so the next `prepare` describes
them"*), and `plan --upcoming` starts its range at the last line's `sha`. Checked in the code, not
the docs: `planPromotion` sets `sha = uncovered.length === 0 ? serving.commit : described`, and
`plan --upcoming` takes `previous_sha` from the last line. So the next `prepare` really does start
from the last *described* sha, not from the last deploy, and late commits are not lost. There is
already a test for it (`promote` › *stops the line at the notes when the deploy shipped more than
they cover*). What changes is that this path becomes routine rather than a hotfix's.

### The gate (`changelogGap`, `notesAt`)

- **Notes present, release commits after them → passes**, and the deploy report names them:
  *"N release commit(s) after `<described>` are not in these notes — the next release's notes
  describe them"*. `notesAt` returns them as `late`.
- **No notes pending (`null`), release commits since the history's last line → still refuses.** A
  `null` pending in a candidate means either `prepare` has not run since the last deploy was
  promoted (`promote` clears the pending file), or it ran and found nothing and then `dev` gained
  something. The first is exactly what 261001q fixed — notes one release behind — and keeping the
  refusal is what still makes the gate mean "a `prepare` ran since the last promote". The second
  costs one re-run of `prepare`, which now has something to describe and does one round.
- **What a present pending proves is weaker than the first draft said** (Sol's finding 3): that a
  `prepare` ran since the last promote, not that it ran for this attempt. A failed or abandoned
  deploy's notes are reused by the retry however much has landed since, and the lag has no bound in
  age or count. Accepted: reuse loses nothing — the line stops at the notes and the next `prepare`
  describes the rest — and a bound would bring the treadmill back at its edge. Notes already
  promoted fail the chain check, and an unrecorded serving deploy is refused by `servingUnrecorded`.
- **Still hard failures, unchanged:** files that do not parse or do not chain; `described` not in the
  candidate; the empty history; the unrecorded serving deploy.

### `prepare` (`release-notes.ts`)

- **One round.** `MAX_ROUNDS` and the re-plan loop go. After the model stages it fetches, fast-forwards
  to `origin/dev` if that moved (still `--ff-only`, never a merge — the header's reason stands), logs
  the late release commits as rolling to the next release, commits, pushes, and checks the result
  with `notesAt` as now.
- **It fast-forwards at the start too**, instead of stopping on *"HEAD is not origin/dev — pull
  first"* when the primary is merely behind. Ahead or diverged still stops.
- **Both through `fastForwardTo`** (Sol's finding 2, P1): `merge --ff-only` alone says *"Already up
  to date"* from a HEAD that is *ahead*, and the first implementation relied on it. Now: capture the
  target sha once, refuse unless HEAD is its ancestor, fast-forward to that sha, and check HEAD equals
  it after.

### Promote, and a second sha on the line

The watermark logic is unchanged. Its note for the uncovered case stops saying *"(a forced
deploy?)"*, since that is now the ordinary case.

**Added after review: `deployed_sha`** (Sol's finding 1, P1). The first draft accepted that the fleet
dashboard's "commits since the newest deploy" would overcount, because it measures from the line's
`sha`. Sol: routine rolling makes that *"a routine, confidently wrong operational reading"* — and it
counts the notes and docs commits too, not only the late ones. So `promote` now writes
`deployed_sha = serving.commit` on every new line, beside `sha`, which stays the coverage watermark
that `previous_sha` chains — no chain check changes meaning. Both readers (`src/changelog.ts`,
`tools/fleet/deploys.ts`) validate it when present; the fleet reads `deployed_sha ?? sha` for its
watermark and its row, and shows *"built from"* in a release's body when the two differ. A pending
release may not carry one. `commit_count` is relabelled as the count the notes cover.
**And the public page** says, under a release whose notes stopped short of its build, that a few
later changes are described under the next one (Sol's finding 4).

## The trade-offs, named

1. **A release's entry can miss a few late commits**, which then appear under the next release. That
   is the trade Greg allowed.
2. **A revert landing after the notes ships notes for a feature the deploy never had** — Sol's
   round-2 finding 1 on 261001q, which is why the gate was strict. The next release's notes describe
   the revert, so the page says it arrived and then went, one release apart. **The first claim stays
   wrong for good**: the history is append-only and nothing corrects a line (Sol's finding 4 on this
   plan, correcting the first draft's "until the next deploy"). Accepted as the small trade-off; the
   page says under such a release that later changes are described under the next one.
3. ~~**The fleet dashboard's "commits since the newest deploy" overcounts by the late commits**~~ —
   built after review, below: lines carry `deployed_sha`.

## Options passed over

- **Pin the deploy to the prepared sha** rather than to `origin/dev`'s tip, so notes and deploy match
  exactly. The first draft's reason was wrong — it said deploying an older commit means checking one
  out in the primary, but `deploy.ts` already tests a detached temporary worktree and pushes a
  captured sha (Sol's finding 5). The real reasons: it loosens `trunkGap`, a production gate; pinning
  the notes commit `prepare` pushes only closes the last handoff, because `prepare` fast-forwards over
  whatever landed during its model run before committing, so exact correspondence would also need
  the notes committed onto the planned tip before absorbing those — more machinery in `prepare`, not
  less. Sol agreed: *"I favor roll-forward with the fixes above."*
- **A bounded lag** (pass only if at most *N* late commits, or only those newer than the notes'
  `generated_at`). Every late commit is newer than the notes by construction when notes are present,
  and a count threshold reintroduces the treadmill at its edge. The `null` rule above is the bound
  that matters: it is what tells "prepare ran" from "prepare did not".
- **Keep the strict gate and make prepare faster** (incremental trawl of only the late commits). Still
  a treadmill, shorter laps; more code in the model stages.

## Files

`scripts/deploy-checks.ts` (`changelogGap`), `scripts/changelog/release-paths.ts` (`notesAt`),
`scripts/deploy.ts` (report the late commits), `scripts/changelog/release-notes.ts` (one round,
`fastForwardTo`), `scripts/changelog/changelog.ts` (promote writes `deployed_sha`; wording),
`src/changelog.ts` (`deployed_sha`), `src/web/ChangelogPage.tsx` (the sentence),
`tools/fleet/deploys.ts`, `routes-deploys.ts`, `wire.ts`, `web/src/DeploysPanel.tsx`; tests:
`changelog-before-deploy`, `changelog-page`, `fleet-deploys-route`, two fleet fixtures; docs:
changelog.md § The file, § The pending release and § Running it, overseer.md § Deploying steps 3–5,
a forward pointer at the top of 261001q.

## GPT Sol on this plan

Read-only, 2026-10-02: **APPROVE WITH CHANGES.** It confirmed the key claim against temporary git
histories — notes present, notes null, a redeploy, an already-promoted pending, two deploys without a
prepare between — *"I found no path that silently puts late release commits behind the
watermark."* Its five findings, all taken: 1 (P1) `deployed_sha` now; 2 (P1) ff-only from an ahead
HEAD; 3 (P2) a present pending proves less than claimed; 4 (P2) the revert misattribution is
permanent, and the page should say a release is partial; 5 (P2) the pinning premise was wrong. Each
is folded in above.

## Verification

- Tests, each seen red first against today's code: the gate passes notes with a late release commit
  and returns it as `late`; still refuses a `null` pending with a release commit after the last line;
  `notesAt` against a real temp repo for both. The remaining refusals' existing tests stay green, and
  each is re-mutated once to see it go red.
- `npm test`, `npm run typecheck`.
- `notesAt` against today's real `dev` tip, by eye.
- `prepare` itself commits and pushes to `dev` from the primary and runs a model job, so its first
  real run is the Overseer's next deploy, as 261001q's was. A dry run is not available; its new code
  is the deletion of a loop and a fast-forward.
- GPT Sol on this plan (read-only), then on the code (workspace-write).
