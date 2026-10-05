# The changelog

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md)

`/changelog` is the public page that says what changed and why, deploy by deploy, in language a
reader who has never seen the code can follow. This doc is the **process that writes it** — what a
version is, how the commits get turned into entries, and which of those steps is allowed to assert
anything.

> it will go through all the commits since the last time it was run, and write them up into a
> chunked/summary NDJSON file or similar, with metadata about provenance … the copy will be aimed
> at smart, non-technical users, but we'll still include links to the commits for curious technical
> users
>
> — Greg, 2026-09-06

The page has been built and the whole history has been through the process — every production deploy
since 2026-08-24. [§ Running it](#running-it) is what *"run this doc"* means; the file's own count is
what `changelog.ts check` prints, and is deliberately not written down here.

**Since 2026-10-01 a deploy's notes go out in that deploy**, not the one after —
[§ The pending release](#the-pending-release). Greg, 2026-10-01:

> I wonder if we can make sure that the latest release notes are included in the deploy itself
> going forwards.

## A version is a deploy

Not a semver number, not a date. **One production deploy on Vercel is one version**, and its name is
its timestamp. There is no tag, no `package.json` version to bump, and nothing to remember to do:
the deploys already happened.

The list of them is not in git. `main` is fast-forwarded one sha at a time by
[`scripts/deploy.ts`](../../scripts/deploy.ts) ([version-control.md](version-control.md)), so the
history alone cannot tell you which of those shas were deploy points and which were merely passed
through. **The source of truth is Vercel's own deployment list**, filtered to
`target: production`, `state: READY`:

```
GET /v7/deployments?projectId=<PROJECT_ID>&teamId=<TEAM_ID>&target=production&limit=100
```

with the ids in `scripts/deploy.ts` § `PROJECT_ID` / `TEAM_ID`. Each row gives everything a version
needs: `created` (the timestamp), `id` (the `dpl_…`), `meta.githubCommitSha` (the sha), and
`inspectorUrl`.

**A version's commits are `<previous version's sha>..<this version's sha>`.** Every deploy so far has
had its predecessor as a strict ancestor — checked with `git merge-base --is-ancestor` across all 20
deploys of 2026-09-04 to 09-06 — so the range is well-defined and nothing is counted twice. *Check
it anyway, per version*: a rollback or a `vercel deploy` from a working directory would break the
assumption without breaking anything else, and the failure looks like a version that quietly missed
its work.

Deploys are frequent — 20 in the 42 hours to 2026-09-06 05:29, ranges of 1 to 76 commits, typically
around 25. So **most versions have nothing a reader would notice**, and that is expected rather than
a bug in the process. Such a version still gets a line in the file, with an empty `entries` array and
`invisible: true`, because the provenance has to be complete for the watermark below to mean
anything. What the page does with those is a display question, not a data one.

## The file

One append-only NDJSON file, **`src/web/changelog-versions.ndjson`**, one line per version, oldest
first. NDJSON because the job only ever appends: a run adds lines to the end and never rewrites what
is above, so two runs cannot lose each other's work and a diff shows exactly what a run decided.
Since 2026-10-01 only `promote` appends to it — [§ The pending release](#the-pending-release).

**What a new release covers starts at the last line's `sha`**: `plan --upcoming` plans from there to
`dev`'s tip. The deployment id still keys the lines — `promote` will not write a second line for one
id, and `plan --deploys`, the recovery path, matches its watermark on it — because the same sha can be
deployed twice (2026-08-27 shipped `903b33e6` twice), and keying on the sha would swallow the second.

```jsonc
{
  "version": "2026-09-05T22:19:14Z",        // the deploy's `created`, UTC, and the version's id
  "deployment_id": "dpl_FxhrqYZ4M62WstKNP8mu4j4XUpk4",
  "sha": "fc1d64f6696b072b0f9029fe49d98e07dd44c703",
  "deployed_sha": "fc1d64f6696b072b0f9029fe49d98e07dd44c703", // since 2026-10-02 — § The pending release
  "previous_sha": "6eecb377f24d92446086a006d5b3103daae40aef",
  "commit_count": 28,
  "invisible": false,                        // no entry a reader would notice
  "generated_at": "2026-09-06T10:00:00Z",
  "generated_by": { "trawl": "claude-sonnet-5", "review": "gpt-5.6-sol", "copy": "claude-opus-5" },
  "entries": [ /* see below */ ]
}
```

And an entry. **A version's entries are divided into three, and the page shows them under three
headings** — *Headline changes*, *Minor enhancements*, *Bug fixes*, in that order. Greg, 2026-09-06:

> Maybe divide the user-facing text for each version into headline changes, minor enhancements, and
> bug fixes.

Three rather than four: **there is no section for engineering.** A behind-the-scenes change that is
big enough to mention takes whichever of the three it actually fits — a change a reader would notice
is a headline change, one that made a page faster is an enhancement, one that removed a class of
failures is a fix. If it fits none of them it does not go on the page at all. This is also the reason
an entry has one grouping rather than two: an earlier draft carried both a `section` and a
reader-facing `category` (`reading`, `speed`, `privacy`…), and the second one had nowhere to be
shown.

```jsonc
{
  "id": "link-hover-cards",
  "section": "headline",                     // headline | enhancement | fix — the heading it appears under
  "title": "See where a link goes before you follow it",
  "body": "…two or three sentences, reader-facing…",
  "where": "/read — the article's own hyperlinks",
  "commits": ["c28d05ed…", "eb6fdbd2…", "ac877560…"],
  "provenance": {
    "files": ["src/link-summary.ts", "src/web/LinkPanel.tsx"],
    "evidence": "…the file+symbol that proves the claim…",
    "confidence": "high",
    "verdict": "confirmed",                  // gpt-5.6-sol's ruling — see below
    "note": null                             // what the review changed or could not verify
  }
}
```

`commits` holds full shas so the page can link each one to
`https://github.com/spideryarn/reading2/commit/<sha>`. That repo **went public on 2026-09-06**, so
the links ship. Until it did they could not: every one of them would have 404'd for exactly the
curious reader they exist for. The confirmation was taken twice rather than once, because "is the
repo public yet" is the sort of thing an agent will cheerfully assume — the repository page answers
to a signed-out fetch, and Vercel's own `githubRepoVisibility` flips from `private` to `public`
between that day's 05:29 and 09:49 production deploys.

## The pending release

Until 2026-10-01 the notes for a deploy were written *after* it, from Vercel's list, and reached
readers with the deploy after that — so `/changelog` always ran one release behind, which is what Greg
noticed. Now they are written before it and ship in it. The design, and the two GPT Sol reviews that
shaped it, are [261001q](../plans/261001q-changelog-written-before-the-deploy-so-the-notes-ship-in-it.md).

**Two files, because a line of the history cannot be written before its deploy.** A line is a
permanent claim that *this was a release*; a deploy can fail, be retried, or be abandoned while its
change is reverted. So:

- **`src/web/changelog-pending.json`** holds the release about to ship — one object shaped like a
  line, with `deployment_id: null` and its planning time as `version` — or `null`. It is **replaced
  whole** by each `prepare`, never appended to, so a failed deploy's notes are simply rewritten to
  cover the retry too.
- **`changelog.ts promote`** appends it to the history once production is serving it, from
  production's own `/build.json`: the real deployment id, the build time as `version`, the
  deployed commit as `deployed_sha`, and as `sha` the deployed commit or, when commits landed after
  the notes, the last one they describe. Every production deploy gets one line, including one nobody described
  and a redeploy, so the history stays the deploy record the fleet dashboard reads.

**The page draws the pending release on top**, numbered as the line it will become, dated and linked
by the build carrying it (`ChangelogPage.tsx` § `withPending`). That is true by construction: the
bundle a reader is running was compiled from the commit that holds the file.

**The deploy gate makes sure notes were written for it.** `npm run deploy` refuses a commit that
carries no notes (`null`) yet ships something a reader could see since the last release — `prepare`
has not run since the last deploy was promoted (`deploy-checks.ts` § `changelogGap`). It also refuses
notes that do not parse or chain, and notes describing a commit the candidate does not contain.

**Commits that land after the notes roll to the next release's** — since 2026-10-02,
[261002h](../plans/261002h-late-commits-roll-to-the-next-release-notes.md). Until then the gate was
strict: nothing a reader could see could sit after the sha the notes describe. With half a dozen
sessions pushing to `dev`, every push between `prepare` and the deploy meant another 25-minute model
run, and every run gave the next push another window — a treadmill. Now the gate lets them through and
the deploy names them; `promote` stops that deploy's line at what was described, so the next
`prepare` plans from there and describes them. Greg, 2026-10-02:

> we don't want the perfect to be the enemy of the good, so consider whether there's a slightly
> simpler approach that would get us almost all of the value … not if it's going to involve a huge
> trade-off, but a small trade-off is fine.

And on the trade-off itself, the same evening:

> Yep. If commits arrive late, then it's okay for them to be described in the next releases notes.
>
> — Greg, 2026-10-02 ~20:45

**The trade-off:** a release's entry can miss a few late commits, which appear under the next release
instead, and the page says so under a release whose notes stopped short of its build. A revert that
lands after the notes is the sharp case, and the reason the gate was strict until then: the page
announces a feature the deploy never had, the next release says it went, and because the history is
append-only **the first claim stays wrong for good**. The gate also proves less than it did: notes
in the candidate show that a `prepare` ran since the last promote, not that it ran for this attempt —
a failed deploy's notes are reused by the retry, however much has landed since, and the lag has no
bound in age or count.

**So a line has two shas.** `sha` is the last commit its notes describe — the watermark the next
range starts from, which `previous_sha` chains. `deployed_sha`, written by `promote` since 2026-10-02,
is the commit production was built from; the fleet dashboard measures "commits since the newest
deploy" from it, falling back to `sha` on older lines, which have none.

`--force-gate=changelog` is the hotfix escape for the refusals that are left. The same gate also
refuses to deploy over a build that was never promoted (`servingUnrecorded`): `promote` can only
record what is serving, so a deploy replacing an unrecorded one would lose that deploy's line.

**What counts as something a reader could see** is one definition,
[`scripts/changelog/release-paths.ts`](../../scripts/changelog/release-paths.ts), asked by the planner,
`promote` and the gate. The changelog's own two files are excluded from it — they are under `src/`,
and every notes commit would otherwise need notes of its own.

## The four stages

Each stage writes a file and the next one reads it. That is deliberate: a stage can be re-run on its
own against a version, the same way [every pipeline stage can](architecture.md), and the intermediate
files are the evidence for anything the finished copy claims.

### 1. Enumerate

Vercel's list, joined to git. Out: one row per unwritten version — `version`, `deployment_id`, `sha`,
`previous_sha`, and the commit list from `git log --no-merges <previous>..<sha>`.

**Merge commits are dropped, and `commit_count` counts what is left.** They carry no change of their
own here — every one of them is a `Merge remote-tracking branch 'origin/dev'` — so counting them
would inflate a version by however many branches happened to land in it. This paragraph said the
opposite until 2026-09-06, when the runner was replayed against the file the first run had written
and the two disagreed: the 68 committed lines sum to 2,047, which is the non-merge total. The file
was right and the doc was wrong, which is the direction that matters, because a number meaning one
thing above a line and another below it is worse than either meaning.

**A commit that touches no code cannot change what a reader sees**, so it is classified without a
model call, with its path list as the evidence. That was 1,071 of 2,066 on the first run. The paths
that count as code are deliberately generous — `styles/` and `public/` are in, because a stylesheet
and a favicon are both things a reader meets.

**Use `git log --full-history -- <paths>` for that split.** Without it, default history
simplification prunes side-branch commits in a merge-heavy history and the excluded set silently
grows: the first run lost a real `src/store/pg-jobs.ts` change that way, and found it only by
enumerating every path prefix the excluded set touched instead of trusting the filter.

**An item belongs to the version containing its *last* commit** — the deploy that first shipped all
of it. An item whose commits straddle two deploys would otherwise be duplicated or cut in half, and
both lie about when a reader could first use the thing.

**An item whose commits are in no version yet is not dropped.** Work that is committed but not
deployed belongs to no version — check with `git merge-base --is-ancestor` against the last deployed
sha — and the watermark picks it up on the run after it ships.

### 2. Trawl — many small agents, in parallel

**Lots of subagents, Sonnet or Luna, one per batch of roughly six to ten commits.** They are reading
diffs and throwing most of them away, which is exactly the work that should not happen in the main
context.

Each is told: run `git show --stat`, then read the actual diff; group commits belonging to one piece
of work into one candidate item; every commit in the batch lands in exactly one item. Out: a JSON
array of candidate items, each with `summary`, `rationale`, `category`, `user_facing`, `where`,
`files`, `commits`, `evidence`, `confidence`, `uncertain`.

**Tell them not to trust the commit subject.** House style here is a literary subject line that names
the reasoning rather than the change — *"An out-parameter cleared when the attempt starts going well,
not when it starts"* — and a trawler that summarises subject lines produces something that reads
plausibly and is not about the code. Every claim is checked against the diff, and `evidence` names
the file and symbol that proves it.

**Tell them `user_facing` is a high bar**: a reader of an article notices a difference. Tests, docs,
plans, evals, agent tooling and worktree scripts are all `false`, and there are a lot of them.

### 3. Review — one big model, adversarially

The trawlers are cheap and will over-claim. **GPT Sol reviews the merged candidate set against the
diffs** — the cross-family check that [AGENTS.md](../../AGENTS.md) asks for everywhere else, and it
earns its place here because the failure mode is a confident sentence about a change that did not
happen.

```
npx tsx scripts/run-codex.ts --model sol --effort high --timeout-minutes 90 \
  --prompt-file <review-prompt> --output <review-answer>
```

It is asked for four things, per item: is the summary true of the diff; is `user_facing` right; should
two items be merged or one split; and is anything in the range missing. Each item comes back
`confirmed`, `corrected` (with the correction), or `rejected` (with why), and that ruling is what
lands in `provenance.verdict`. Hand it the diffs, not just the candidate JSON —
[codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md), and **check a verdict actually
arrived**, exit code *and* answer file.

**The answer is checked before any of it is believed** — one ruling per user-facing item, indexes
that name an item and name it once, a verdict from the vocabulary, and a correction on anything ruled
`corrected`. Requiring only that the answer file *existed* was the whole gate until 2026-09-06, and a
file ruling on one item out of two passed it: the other reached the page carrying whatever the cheap
trawler wrote, marked `unreviewed`, with nothing failing.

An item Sol rejects is dropped. An item it corrects keeps the correction and records that it was
corrected. Its findings are not automatically right either — check the ones that surprise you.

**This stage is not optional, and the numbers say why.** Across the 506 rulings of the 2026-09-06
retrospective run it **corrected 51%** of the trawl's user-facing items, found **36 changes no
trawler mentioned**, and moved **16 items back from invisible to visible** — those last are the
expensive ones, because they would have vanished from the page with nothing to notice. Of the entries
that shipped, only a third rest purely on claims the trawl got right first time.

### 4. Copy

The verified items go to one model call whose prompt is
[`scripts/changelog/copy-prompt.md`](../../scripts/changelog/copy-prompt.md) — kept as a file
because it is a machine input that gets iterated on, not prose about the project.

Its job is the thing the whole page is for: **what a reader will care about, and why**. Simple
language, no internal vocabulary, a link to the feature where one exists, and the commit links for
the curious. Big behind-the-scenes work gets a short entry too, framed as what it means for the
reader — faster, more reliable — rather than as engineering detail.

Three of the calls it makes are worth knowing without opening it, because they are the ones a future
agent would otherwise re-decide:

- **A translation table from our nouns to the reader's**, and none of ours may appear in an entry —
  the band, the spine, a block id, an artefact, the store, a model's name. The test it gives is
  whether somebody who has only ever *used* the app could picture the sentence.
- **Its `category` is the reader's grouping, not the trawl's** — `reading`, `adding`, `account`,
  `speed`, `reliability`, `privacy`, `under-the-hood`. A `fix` to the glossary is `reading`.
- **A closed list of app addresses it may link to**, because a guessed one is a 404 in the one place
  a reader is most likely to click.

**Re-verify every sha the copy stage emits** against the sources its own entry cites — 40 hex
characters, present in the version's input, and belonging to an item that entry says it drew on. The
last of those is what stops a well-formed entry attributing another change's commits to itself.
It is a model writing them out, and on the first run one agent reported catching and correcting a
mistyped sha in its own output, so the stage can produce one. A wrong sha is a 404 in the one place a
reader is most likely to click.

Upstream of that, **every sha on an assigned item is a commit that version actually contains**,
checked with one `git rev-list` per version. Otherwise a forty-character typo, or a real but
undeployed sha, rides into the copy input on the strength of whichever sha alongside it *did* map —
and by the time the writer sees it, it is already "present in the version's input", which is all the
writer was asking.

**A version whose copy came back empty is an error, not a warning.** Verified user-facing changes
went in; a line saying `invisible: true` came out, which reads exactly like the common quiet deploy
and leaves nothing anywhere to notice. Dropping *some* of them is a judgment the stage is allowed to
make — the first run dropped 15 of 504 — and the count is on `write`'s summary line.

**The copy stage may not introduce a fact.** It rewrites verified items; it does not learn anything
new about the code. Each entry carries `sources`, the indexes of the items it drew on, so an entry
with nothing behind it is detectable rather than merely wrong — and a number that is not in an item's
`evidence` may not appear in the copy at all.

## The first run is retrospective

There is no watermark to start from, so the first run enumerates every production deploy of
`spideryarn-reading2` and works forwards. That is a lot of commits — the project's first commit is
2026-08-24 — and it is the one run worth doing in a worktree overnight, in version order, appending
as it goes so a crash costs one version rather than all of them.

Two things make the early history harder than the recent history, and both are worth knowing before
starting rather than discovering at commit 900:

- **The domain moved on 2026-08-27** and the Vercel project before that was `spideryarn-reading`
  ([deployment.md](deployment.md)). Deploys before the move are a different project's list.
- **The first 239 commits were pushed in one go** when the remote was created
  ([version-control.md](version-control.md)), so they predate any deploy at all. They belong to the
  first version, whose entry is honestly just "the app existed".

**So the first version is a launch note, not a change list.** On the 2026-09-06 run it held 388
commits and 143 verified items, and nothing preceded them — there was nothing for them to be a change
*from*. It is written as what the app could do on the day it first went live, one entry per capability
area, and the two-headline cap is lifted for that version alone.

## The page

[`src/web/ChangelogPage.tsx`](../../src/web/ChangelogPage.tsx), at `/changelog`, reachable by two
doors and called *What's new* at both. The [site footer](../../src/web/SiteFooter.tsx) is the one a
signed-out visitor and a reader on the shelf meet; the **command bar** (⌘/Ctrl-K) is the one inside
the reading view, where there is no footer at all, and it answers to `changelog` as well as to the
label — [reading-view-overview.md § The command bar](reading-view-overview.md#the-command-bar), added
2026-09-07. That the two lists are separate is deliberate and the reasoning is at
`src/web/CommandBar.tsx` § `besideTheModes`. Nothing about either changes the file: the file is the product of this
process, and the page is a reader of it — through
[`src/changelog.ts`](../../src/changelog.ts), which is also what the writer and
`tests/changelog-file.test.ts` read it with, so the format has one definition rather than three.

The three decisions this section used to leave open, taken on 2026-09-06 in
[260906g](../plans/260906g-the-changelog-page-and-a-runner-that-can-be-asked-to-do-the-right-thing.md):

- **The file reaches the browser through Vite's `?raw`**, parsed in the page. No API route and no
  database. It gets less simple as the file grows — at roughly 11 deploys a day it is a real number
  within a year — so the day it stops being free, it moves behind an API route. Say so when it does.
  **The import lives inside the lazily loaded page module**: 210 KB has no business in what a reader
  downloads before asking for anything, so `/changelog` is the third `LazyPage` route after `/admin`
  and `/design`, and `tests/eager-client-graph.test.ts` is what keeps it there.
- **A run of quiet versions collapses into one line.** Hiding them outright leaves unexplained gaps
  in a dated list; showing all 19 buries the 49 that have something to say.
- **A version's entry used to land one deploy late**, until 2026-10-01, when Greg asked for the
  notes to ship in the deploy itself. The objection here — that the alternative is describing a deploy
  before it happened — is answered by keeping the not-yet-deployed release out of the history:
  [§ The pending release](#the-pending-release).

Four more, taken on 2026-09-07 in
[260907f](../plans/260907f-changelog-table-of-contents-collapsible-versions-version-numbers-and-an-opensource-page.md).
Greg had found the page hard to use, and it was: drawn out it stood **46,368 pixels tall**, fifty
releases with no way to see what was in it but to scroll all of it.

- **Each release is a `<details>`, shut but the newest**, and a contents list at the top jumps to
  one and opens it. Every contents row carries that release's *headline* titles, so it says
  something the shut row below it does not; a release with no headline entry falls back to its
  counts. `#release-42` in the address opens release 42.
- **A release is numbered by its line in this file**, counted from the oldest — display only, minted
  nowhere, and stable for ever because runs append. Quiet versions are counted although they are
  never drawn, so the page and the file stay in step; so is the one line that is a redeploy of the
  line above it.
- **The reader is told the sha rather than a version number**, and that is Fable's answer to Greg
  asking for *"a version number (semver?) as part of the deploy … and on tooltip for the Homepage
  logo"*, which he took. The deploy cannot honestly carry a number: production is built on Vercel's
  machine from a push to `main`, `deploy.ts` has no channel into that build's environment, and a
  version's line here is appended *after* it ships — so a running build's own sha is never in the
  copy of this file it is carrying (its pending release is, but without a number of its own until it
  is promoted). The logo's tooltip says *"built 7 Sep 2026 from 39282f8"*
  (`src/web/build-stamp.ts` § `buildDescription`), and the page's release number is the join.
- **An entry's commits appear in one place, as shas.** Greg: *"I found the difference between the
  link to the changes and the commit a bit confusing."* They were the same thing drawn twice — this
  process emits one commit inside `links`, labelled *the change*, and the rest in `commits`. The page
  now sorts an entry's links by **where they point**, not by which field they came in: a path is
  somewhere in the app, anything else is a commit and joins the sha row under a GitHub mark. **The
  copy stage is unchanged and may go on emitting that link** — 69 committed lines already carry it,
  so the page has to handle them regardless. Each release also links the commit it was built from.

And one on 2026-09-30, from Greg's feedback (SPIDERYARN-READING2-6P):
*"I wonder if we could show them as human readable, e.g. `3d ago`, `3h ago`"*.

- **A release's date says how long ago it shipped** — `3 days ago` in its heading, `3d ago` in the
  contents list — with the exact UTC stamp on hover, and back to the UTC date past a month. No
  library: it is `src/web/relative-time.ts`, the one the shelf already uses, on a `useNow` clock so a
  tab left open does not rot.
  [260930i](../plans/260930i-changelog-release-dates-as-relative-time.md).

And one on 2026-10-05, from Greg's feedback the day before (spya-ym9dum): *"Could you set this page
to somehow poll every 15 minutes or so, and if there's a new version, then refresh the page."*

- **The page reloads itself when a new build is live.** The list is compiled into the bundle, so a
  copy left open — for days, in the app opened from a home-screen icon — went on showing an old one.
  The app now asks `/build.json` whether a different build is live when the page wakes and every
  fifteen minutes while it is visible (`src/web/stale-shell.ts` § `watchForDeploy`), and
  `/changelog` reloads when the answer is yes, the page is being looked at, and nothing unsent would
  be lost: no Chat, Remember or Feedback draft held, no upload going, not offline
  (`src/web/safe-to-reload.ts`). At most once per build in a session; a refused reload is tried
  again at the next check. The address survives, `#release-126` included; which releases the reader
  had opened by hand does not. **No other page does this** — an unasked reload under an article
  somebody is reading is not what was asked for.
  [261005d](../plans/261005d-notice-a-deploy-on-wake-and-reload-the-changelog.md);
  `scripts/check-two-builds.ts` is the check that runs it against two real builds.

## Running it

**`run docs/project/changelog.md`** means this section, and since 2026-10-01 it is a command:
**`npm run changelog:prepare`** ([`scripts/changelog/release-notes.ts`](../../scripts/changelog/release-notes.ts)),
which the Overseer runs before every deploy ([overseer.md § Deploying](overseer.md#deploying)). It
holds the deploy's lock, promotes whatever production is serving, does steps 1 and 2 itself, runs
steps 3 to 6 as one `run-claude.ts` job on Opus briefed from
[`scripts/changelog/prepare-prompt.md`](../../scripts/changelog/prepare-prompt.md), commits and pushes
the pending file, and checks its own result with the deploy gate's function. The steps are written out
here because that job follows them, and because a person recovering a run needs them.

The deterministic stages are `scripts/changelog/changelog.ts`, so what an agent supplies is judgment
and subagents, not bookkeeping. Everything intermediate goes under `logs/changelog/`, which is
gitignored; `prepare` gives each run its own directory there.

1. **Promote.** `changelog.ts promote --serving <file>`, the file being production's `/build.json`
   saved — [§ The pending release](#the-pending-release). Planning on top of a serving release that
   is not yet in the history would fold it into the next one.
2. **`changelog.ts plan --upcoming <dev tip>`** — one version from the history's last line to the
   tip: the ancestry check, the code/non-code split, the batches. **When no commit in the range is
   one a reader could see, it plans nothing**, and the pending release is `null`. It **refuses to
   start on top of an earlier run's stage directories**, because the stages address each other by
   index and file name rather than by run — pass `--fresh` to empty them, or `--work <dir>`.
3. **Trawl.** One Sonnet subagent per batch file, briefed from
   [`scripts/changelog/trawl-brief.md`](../../scripts/changelog/trawl-brief.md), at most 20 at once.
   Launch each batch **once** — see § The traps.
4. **`changelog.ts review-prompt`**, then GPT Sol per day, then **`changelog.ts verify`**. Check the
   answer file arrived and the exit code was 0 before believing an empty finding — `verify` also
   checks the answer itself, and **fails on a user-facing item nobody ruled on** unless
   `--allow-unreviewed` says so. **`verify` prints
   the regroups the review asked for and applies none of them** — merging two items or splitting one
   is the judgment this whole stage exists for, so it is yours. Edit the file under `verified/`, then
   `verify --reassign`, which rebuilds the assignment without undoing your edit. Skipping this is not
   visible in the output: the first incremental run's one regroup was the difference between an entry
   citing eight commits and citing two.
5. **`changelog.ts copy-inputs`**, then one Opus subagent per version, briefed from
   [`scripts/changelog/copy-brief.md`](../../scripts/changelog/copy-brief.md).
6. **`changelog.ts write --pending --trawl-model <name>`** — validates, and writes the release whole
   to the pending file. It refuses rather than writing a bad file, and a release that does not fit
   after the history's last line is refused. `<name>` is the model step 3's subagents actually ran on
   (`sonnet`, or `opus` when Sonnet is rate-limited), and it is required, because a default would
   record the wrong one without anyone noticing.
7. **Commit and push it.** Nobody reads it first. Greg, 2026-09-10: *"I don't want there to be a
   human review/gate — just go live with them as part of the deploy."* The gates are Sol's review in
   step 4 and `write`'s checks in step 6. **One round**: `prepare` fast-forwards over whatever landed
   on `dev` while the model stages ran, says how many of those commits a reader could see, and pushes
   — they are the next release's (§ The pending release). Until 2026-10-02 it planned again, up to
   three rounds. It fast-forwards at the start too, rather than stopping because the primary was
   behind.

**Help reads the notes next.** Straight after `prepare`, the Overseer reads the pending release for
anything that makes `/help` untrue or incomplete, and updates it —
[overseer.md § Deploying](overseer.md#deploying), step 4, and
[help-page.md § Bringing it up to date](help-page.md#bringing-it-up-to-date).

**Write the notes even when nobody is about to deploy them.** Greg, 2026-09-10: *"it should write the
changelog docs, even if you can't actually deploy them."* Still true: `prepare` needs no deploy
credential and no Vercel access, and a pending release committed to `dev` ships whenever the next
deploy does — the next `prepare` before it simply rewrites it to cover whatever landed since.

**`plan --deploys <file>` is the recovery path, no longer the routine.** It enumerates Vercel's list
(`mcp__vercel__list_deployments` with the ids in [`scripts/deploy.ts`](../../scripts/deploy.ts) §
`PROJECT_ID` / `TEAM_ID`, saved to a file) and writes one line per deploy after the last line's
deployment id, appended by `write` without `--pending` — the process as it was until 2026-10-01. It is
for a deploy `promote` refuses, such as one made before the pending file existed; it refuses while a
release is pending, because both would describe the same commits. If Vercel cannot be reached, the
build-stamp fallback still applies: write **one** version from the watermark to the serving sha,
named by the stamp's build time, say so in `generated_by` and the commit, and never guess
intermediate deploy points from git alone (`8cd2206..c7d67cb5` covers about seven and cannot now be
split).

**Not a step inside `npm run deploy`**, though it now runs before it rather than after. The model
stages take ten minutes or more and carry their own Sol review; inside the deploy, a review timeout
would fail a deploy. So it is its own command, and the deploy's `changelog` gate is what joins them:
invalid notes are refused, as is a deploy with no pending notes and uncovered release commits. Valid
pending notes may leave late commits for the next release (§ The pending release). And a failure here
does not look like a failure: the copy stage can strengthen *"code intended to do X"* into *"X is now
available"* while every structural check passes — which is why step 4 is not optional. The earlier
reasoning for publishing one deploy late is in
[260906g](../plans/260906g-the-changelog-page-and-a-runner-that-can-be-asked-to-do-the-right-thing.md#the-deploy-sweep-no-and-the-reason-is-not-the-one-in-the-question);
what answered it is [§ The pending release](#the-pending-release).

## The traps

- **A green run that read nothing.** Every stage here can succeed while doing nothing — a trawler
  that summarises subject lines, a Sol call that returned an empty answer file, a version whose
  commit range came back empty because the sha was not an ancestor. Each has a check named above, and
  they exist because [silent success](../reusable/silent-success.md) is how most of a day's bugs go
  here. Assert on `commit_count` per version and on entries-per-1000-commits across a run; a number
  that collapses is the signal.
- **A late agent overwriting a finished output.** Launch a stage's agents once, and before you write
  the file check that no stage output is newer than it. On the first run two versions were re-copied
  by agents launched twice by mistake, after the NDJSON had already been written from the earlier
  answers, and it had to be regenerated.
- **A check that validates against an input it helped create proves nothing.** Twice now, a stage has
  confirmed something against a set that an earlier stage had already polluted: the writer asked
  whether a sha was *in this version's input* when a typo had entered that input upstream, and the
  copy validator asked whether an address was *on the allowed list* when the list itself was wrong.
  Both passed. Both were checking agreement rather than truth. **The fix in each case was to ask
  something outside the pipeline** — `git rev-list` for the sha, `parseRoute` for the address — and
  that is the move to reach for whenever a check and the thing it checks share an ancestor.
- **An address on the allowed list can still be a 404.** The closed list exists so the copy stage
  cannot guess an address, and it worked — every link in the first run's output was on it. The list
  itself said `/read` for *your library*, and the shelf is at `/`; a bare `/read` needs an article
  after it and lands on the not-found page. Thirty-two entries shipped that way, past a validator
  that checked membership rather than existence. `tests/changelog-file.test.ts` now asks
  `parseRoute` — the router itself — about every in-app link in the file and every address on the
  list, which also catches the version of this that has not happened yet: a route renamed under
  entries that link to it.
- **Never quote a commit message to a reader.** They are written for us, they name internal files,
  and several of them describe production breaking. The copy stage translates; it does not excerpt.
- **Article prose never reaches the changelog.** Nothing in this process should touch reader data at
  all — it reads git and Vercel — but the rule is worth stating because the copy stage is a model
  call and model calls acquire context.
