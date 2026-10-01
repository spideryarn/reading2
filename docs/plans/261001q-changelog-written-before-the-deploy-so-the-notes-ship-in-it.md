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
- **Its `sha` is the tip the notes describe, not the deployed commit.** The deployed commit is that
  tip plus the notes commit, plus anything that landed on `dev` in between. Recording the deployed
  commit would put those late commits inside a range whose entries never mention them and the next
  range would start after them, so they would never be described. With the described tip, the next
  run's range starts there and picks them up. The page's per-release link therefore says *"Changes up
  to commit abc1234"* rather than *"Built from commit"*, which is true of every line, old and new.
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
4. It re-checks the result itself — the same `changelogGap` the deploy gate uses, on `origin/dev`
   after its push — and exits non-zero if the notes do not cover the tip.

### The deploy gate, `changelog`

In `deploy.ts` preflight, a pure `changelogGap()` in `deploy-checks.ts`, judged against **the
candidate commit's own files** (`git show <sha>:…`, what actually ships). Let *described* be the
pending release's `sha`, or the history's last `sha` when nothing is pending. It fails when:

- *described* is not an ancestor of the candidate (the notes are about some other history); or
- `described..candidate` has release-path commits **and** *described* is already contained in
  `origin/main` — the notes were not written for this deploy.

A release-path commit *after* fresh notes (one that landed on `dev` during the ten-minute job)
passes. Sol suggested failing on that too; we do not, because the job takes as long as it takes for
another commit to land on a busy `dev`, so a strict rule is a treadmill, and the late commit is
picked up by the next `prepare` from the described tip. That is today's one-deploy lag for that
commit alone, which the brief allows. `--force-gate=changelog` is the existing named, printed
override, for a hotfix that cannot wait for notes; the next `prepare` folds the forced deploy's work
into its own release.

### Cases

| What happens | Reader sees |
|---|---|
| prepare, deploy, promote | release N with its notes, from the moment it is live |
| deploy fails, retried after a new prepare | release N once, covering both attempts' work, dated when the retry built |
| deploy abandoned, change reverted, then prepare + deploy | one release covering both commits; Sol reviews the net diff |
| a commit lands mid-job | it is in production one release before it is described |
| forced deploy without notes | the previous pending, dated by the forced build; next prepare covers the rest |
| promote never run | next prepare promotes first; history is late, the page is not |
| Vercel rollback | the older build's own files — correct for that build |

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
`changelog-runner`, `changelog-file`, `changelog-page`, `deploy-checks` · docs: changelog.md,
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
