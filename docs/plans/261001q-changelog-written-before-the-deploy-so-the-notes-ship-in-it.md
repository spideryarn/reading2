# 261001q — the changelog written before the deploy, so the notes ship in it

Up: [changelog.md](../project/changelog.md) · [overseer.md § Deploying](../project/overseer.md#deploying)

## Why

Greg, 2026-10-01 ~19:50, to the Overseer:

> I'm increasingly sure that the changelog lags behind a deploy. I'm not certain, but I'm looking at
> the changelog for release 1.1.2 as the most recent release that's shown. And yet what you're
> telling me is a whole bunch of other different stuff. And I wonder if we can make sure that the
> latest release notes are included in the deploy itself going forwards.

He is right, and it was by design. The Overseer deploys, *then* runs a changelog job that asks Vercel
which deploys happened and appends a line for each to `src/web/changelog-versions.ndjson` on `dev`.
That line reaches production with the **next** deploy — changelog.md § The page: *"A version's entry
lands one deploy late … the alternative is describing a deploy before it happened."* Checked
2026-10-01 20:00: production's `build.json` names `6bdf24dc` (the 18:39 deploy) and its bundled file
has 112 lines; `dev`'s has 113, the 113th being the 18:39 deploy describing itself.

And the process lives in the Overseer's scratchpad (`deploy.sh`, `changelog-after-deploy.sh`,
`prompt-changelog.md`), so it dies with that session.

## Round 1, and why it was wrong

The first draft of this plan appended a line *before* the deploy, with `deployment_id: null` and the
planning time as its stamp, arguing it was true whenever a reader could see it. GPT Sol blocked it
(review in the scratchpad, 2026-10-01 20:10), and was right: an append-only line is a permanent
claim that *this was a release*. A deploy that fails and is retried leaves two releases on the page,
the first stamped with a time nothing shipped at; a deploy abandoned and its change reverted leaves a
release describing a feature that was never live. The fleet dashboard reads the same file from the
checkout, so it would have shown the unshipped line as a deploy immediately. **A line cannot mean
both "a production release" and "a deploy attempt not yet known to have succeeded."** So the two get
two homes.

## The design: a pending release, promoted once it is serving

- **`src/web/changelog-pending.json`** — the notes for the deploy about to happen: one object in
  the same shape as a line, with `deployment_id: null`, or the literal `null` when there is nothing
  pending. **Replaceable, not appended**: a failed deploy's notes are overwritten by the next run's,
  which cover everything from the history's last line to the new tip.
- **`src/web/changelog-versions.ndjson`** — unchanged in meaning: append-only, one line per
  production deploy, each with its real `deployment_id`. Only **promotion** appends to it now.
- **The page** shows the history and, above it, the pending release, numbered as the next line
  would be (it keeps that number when promoted). Its date is **the running bundle's own build time**
  (`src/web/build-stamp.ts` § `buildTime`) — true by construction, because the pending file the
  reader is looking at was compiled into the build they are running. Off a build (dev, tests) it
  falls back to the planned time.
- **Promotion** (`changelog.ts promote`): read production's `/build.json` (`commit`,
  `deploymentId`, `builtAt`, token-free), `git show <commit>:src/web/changelog-pending.json`, and if
  that pending release is not already in the history, append it with the real `deployment_id` and
  `version` = the build stamp, and clear the local pending file if it is still that same release. It
  refuses rather than guesses: a serving pending that does not chain onto the history's last line (a
  rollback, a stale fetch) is an error with both shas named.
- **Its `sha` is the deployed commit** — the build stamp's `commit` — so the fleet dashboard, which
  measures "commits since the last deploy" from it, is unchanged, and *"Built from commit"* stays
  true. That is exact because the gate below is strict: between the tip the notes describe and the
  deployed commit there is nothing a reader could see (the notes commit, docs, merges). **The one
  exception is a forced deploy** that shipped release commits the notes do not cover: then the line
  stops at the described tip, so the next `prepare`'s range starts there and describes them, rather
  than nobody ever doing so. (Round 2 of this plan had the described tip always; Sol's round-2
  finding 2 showed that breaks the fleet tab's distance, and the strict gate made it unnecessary.)
- **Every production deploy gets one line** (Sol's round-2 finding 3): with notes; with none (a
  `null` pending — nothing a reader would see — still gets a quiet line); a redeploy of a release
  already promoted gets a line with nothing in it. Idempotence is keyed on the deployment id.
- **Promotion, prepare and the deploy share one lock**, the deploy's own (finding 4), so notes are
  never planned against a history a finishing deploy is about to promote onto.
- **The fleet dashboard** reads only the history, so it never shows an unshipped release. It is
  untouched.

### The order the Overseer runs

```
pull; read migrations                    (as now)
npm run changelog:prepare                (promote what is serving; plan, trawl, Sol, copy;
                                          write the pending file; commit + push to dev)
pull
npm run deploy                           (gate `changelog`: the candidate's notes cover it)
npm run changelog:promote                (seconds; commit + push the history line)
```

`prepare` promotes first, so a skipped or failed `promote` is caught by the next `prepare`.
The six-hourly loop is retired: the gate is the backstop now.

### `changelog:prepare` — `scripts/changelog/release-notes.ts prepare`

The repo's copy of `changelog-after-deploy.sh`, under a lock file (`scripts/lockfile.ts`, already
used by `deploy.ts`) so two runs cannot race, in a **unique** work directory
(`logs/changelog/<stamp>/`) so neither can read the other's stage files. In the primary on `dev`,
level with `origin/dev`:

1. `promote` (above). If production cannot be read, stop: planning on top of an unpromoted serving
   release would fold it into the next one.
2. `changelog.ts plan --upcoming <origin/dev sha>` — one spine row, `previous_sha` = the history's
   last `sha`, ancestry checked. **Nothing to describe → writes an empty pending (`null`) and says
   so.** "Nothing" means no commit in the range touches a release path — and the two changelog files
   are excluded from the release paths (they are under `src/`, so the existing classifier counted
   them; Sol's finding 4). That exclusion is one function both `plan` and the deploy gate call.
3. The agent job: `run-claude.ts` on Opus with the committed
   **`scripts/changelog/prepare-prompt.md`** — the scratchpad prompt with step 1 replaced by the
   above, so **no Vercel MCP**. Trawl, Sol review, copy, then `changelog.ts write --pending`, which
   validates as `write` does and writes the pending file whole instead of appending.
4. It fetches; if `dev` gained a release commit meanwhile it fast-forwards and plans again (up to
   three rounds), otherwise it commits and pushes the pending file and re-checks the result with
   `notesAt`, the function the deploy gate uses, exiting non-zero if the notes do not cover the tip.
   It never runs an ordinary merge: the primary holds other agents' uncommitted edits, and a refused
   merge on a dirty tree has reset tracked files there before.

### The deploy gate, `changelog`

In `deploy.ts` preflight, a pure `changelogGap()` in `deploy-checks.ts`, fed by `notesAt()` in
`release-paths.ts` (which `prepare` also calls to check its own result), judged against **the
candidate commit's own files** (`git show <sha>:…`, what actually ships). Let *described* be the
pending release's `sha`, or the history's last `sha` when nothing is pending. It fails when the
files do not parse or do not chain, when *described* is not in the candidate, or when **any**
release-path commit sits in `described..candidate`.

**Strict, as Sol's round-2 finding 1 required.** Round 2 of this plan let a commit that landed after
fresh notes through, to avoid a treadmill on a busy `dev`. Sol's counter-example: the notes describe
a feature, a revert of it lands during the job, the gate passes, and the page announces a feature the
deployed tree does not have — permanently, if no deploy follows. So the treadmill is handled in
`prepare` instead: after the model stages it fetches, and if `dev` gained a release commit it plans
again (up to three rounds); the window that is left is the seconds between `prepare` and the deploy's
preflight. `--force-gate=changelog` is the hotfix escape, and `promote` keeps what it ships in front
of the watermark.

### Cases

| What happens | Reader sees |
|---|---|
| prepare, deploy, promote | release N with its notes, from the moment it is live |
| deploy fails, retried after a new prepare | release N once, covering both attempts' work, dated when the retry built |
| deploy abandoned, change reverted, then prepare + deploy | one release covering both commits; Sol reviews the net diff |
| a release commit lands mid-job | prepare plans again; the deploy gate refuses notes that stop short |
| forced deploy without fresh notes | the previous pending (or none), dated by the forced build; promote stops its line at what was described and the next prepare describes the rest |
| promote never run | next prepare promotes first; the history is late, the page is not |
| redeploy of the same release | the same page; promote records a line with nothing in it |
| Vercel rollback | the older build's own files — correct for that build; promote refuses to chain it and says so |

## The option passed over: read the entries at runtime

The page could fetch the file at runtime — from GitHub's raw `dev` (the repo is public) or through an
API route — so a line written after the deploy appears without the next one. Passed over: it still
lags by the job's length and is not what Greg asked for (*"included in the deploy itself"*); it is
more parts (a fetch with a fallback and a CSP entry, or a route and a table); it sends every reader's
request to GitHub; and raw `dev` would show notes for code that has not shipped, which is the very
claim round 1 got wrong.

## Also passed over

- **Round 1's null-id line** — above.
- **Pinning the deploy to the described sha.** `deploy.ts` deploys `HEAD` and refuses unless it is
  level with `origin/dev` (`trunkGap`); loosening a production gate to save a release-note lag is
  the wrong trade.
- **The notes as a step inside `npm run deploy`.** A ten-minute model job with its own Sol review
  inside the deploy would fail deploys on a review timeout. Separate commands plus a gate keep the
  failure modes apart.

## Out of scope, named

**A merge commit that carries code of its own** (a conflict resolution) is invisible to every range
here, because enumeration is `--no-merges` — Sol's finding 6. It is how the process has always
worked, it is not made worse by this change, and it is the next thing worth doing to it: queued in
[overseer-queue.md](../project/overseer-queue.md) rather than left as a sentence.

## Backfill

Vercel's list against the file, 2026-10-01 20:05: the twelve READY production deploys from
2026-09-30 15:28 to 2026-10-01 18:39 all have lines on `dev`, ids matching. Nothing is missing; the
lag is the only gap, and the first `prepare` ships the 18:39 line with it.

## Files

`scripts/changelog/changelog.ts` (`plan --upcoming`, `write --pending`, `promote`, the release-path
exclusion) · `scripts/changelog/release-notes.ts` and `prepare-prompt.md` (new) · `package.json` ·
`src/changelog.ts` (parse the pending file) · `src/web/changelog-pending.json` (new, `null`) ·
`src/web/ChangelogPage.tsx` · `scripts/deploy.ts`, `scripts/deploy-checks.ts` · tests:
`changelog-before-deploy` (new), `changelog-file`, `changelog-page` · docs: changelog.md,
overseer.md § Deploying and the standing-jobs line, build-stamp.ts's comment that lines are written
after the deploy, the copy prompt's "what shipped" (still true: it describes what the deploy ships).

## Verification

- Tests, each seen red first: `plan --upcoming` row and range; nothing-to-describe for a docs-only
  and a changelog-only range, something for mixed; non-ancestor refused; `write --pending` writes the
  file whole and refuses a pending that does not chain; `promote` appends with the stamp's id and
  time, is a no-op when already promoted or nothing is pending, refuses a non-chaining serving
  pending; `changelogGap` for nothing-to-ship, fresh notes, stale notes, a late commit after fresh
  notes, notes off-history; the page draws a pending release above the history with the next number.
- `npm test`, `npm run typecheck`, `npm run check`.
- `plan --upcoming` and `promote --dry-run` against the real file and production, read by eye.
- GPT Sol on this plan (round 2, read-only) and on the code (workspace-write).

## Results

Built 2026-10-01. What was checked, and how:

- **Every new check watched red.** Sixteen mutations, one per guard (the release-path exclusion, both
  halves of `changelogGap`, `servingUnrecorded`, the empty-history gate, `parsePending`'s id and
  chain, `plan --upcoming`'s nothing-to-describe, `promote`'s already-recorded, predates, forced,
  compare-before-clear, both redeploy cases, the page's pending release, the committed pending
  file), each turning its test red and restored.
- **Against the real file and production**: `promote --dry-run` against today's `/build.json` says
  the 18:39 deploy is already line 113 (the transition case); `plan --upcoming origin/dev` plans one
  version of 7 commits, 3 a reader could see; `notesAt` refuses today's `dev` tip (3 undescribed
  commits) and refuses the commit production is serving (12 — the lag Greg saw, caught by the gate).
- **`vite build`** carries the pending file through `?raw`.
- **GPT Sol, three times**: the plan twice (both blocked, both taken — above), and the code once, in
  workspace-write. It fixed five findings itself (an empty history passing the gate vacuously; a
  second redeploy refused; a redeploy matched on too little; the page calling a forced line's
  watermark the build commit — history lines now say *"Changes through commit"*; `write --pending`
  exiting 0 having written nothing), each with a test, and reported one for decision: a deploy over
  one that was never promoted loses its line. Taken: `servingUnrecorded`, the gate's second question.
- **Not exercised end to end**: `release-notes.ts prepare` itself, because it commits and pushes to
  `dev` from the primary and runs a model job. Its first real run is the Overseer's next deploy.
