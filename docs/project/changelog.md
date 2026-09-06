# The changelog

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

The page itself is not built yet. What follows is settled; the section on
[the page](#the-page) is the part still open.

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

One append-only NDJSON file, **`docs/changelog/versions.ndjson`**, one line per version, oldest
first. NDJSON because the job only ever appends: a run adds lines to the end and never rewrites what
is above, so two runs cannot lose each other's work and a diff shows exactly what a run decided.

**The watermark is the last line's `sha`.** "Since the last time it was run" needs no separate state
file: enumerate the production deploys, drop the ones whose sha already has a line, do the rest.

```jsonc
{
  "version": "2026-09-05T22:19:14Z",        // the deploy's `created`, UTC, and the version's id
  "deployment_id": "dpl_FxhrqYZ4M62WstKNP8mu4j4XUpk4",
  "sha": "fc1d64f6696b072b0f9029fe49d98e07dd44c703",
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
`https://github.com/spideryarn/reading2/commit/<sha>`. That repo is private as of 2026-09-06 and
[is being made public](version-control.md) — **the page must not ship its commit links before that
lands**, or every one of them 404s for the audience they exist for.

## The four stages

Each stage writes a file and the next one reads it. That is deliberate: a stage can be re-run on its
own against a version, the same way [every pipeline stage can](architecture.md), and the intermediate
files are the evidence for anything the finished copy claims.

### 1. Enumerate

Vercel's list, joined to git. Out: one row per unwritten version — `version`, `deployment_id`, `sha`,
`previous_sha`, and the commit list from `git log --no-merges <previous>..<sha>`.

Merge commits are dropped from the trawl (they carry no change of their own here — every one of them
is a `Merge remote-tracking branch 'origin/dev'`) but they stay in `commit_count`, which counts the
range.

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
npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --timeout-minutes 45 \
  --prompt-file <review-prompt> --output <review-answer>
```

It is asked for four things, per item: is the summary true of the diff; is `user_facing` right; should
two items be merged or one split; and is anything in the range missing. Each item comes back
`confirmed`, `corrected` (with the correction), or `rejected` (with why), and that ruling is what
lands in `provenance.verdict`. Hand it the diffs, not just the candidate JSON —
[codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md), and **check a verdict actually
arrived**, exit code *and* answer file.

An item Sol rejects is dropped. An item it corrects keeps the correction and records that it was
corrected. Its findings are not automatically right either — check the ones that surprise you.

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

## The page

Still open, and the decisions are small. Recorded here so the next agent decides them rather than
inherits them:

- **How the file reaches the browser.** Simplest first: the page imports the NDJSON with Vite's
  `?raw` and parses it, no API route and no database. That ships with the deploy and costs one
  request. It gets less simple as the file grows — at roughly 11 deploys a day it is a real number
  within a year — so the day it stops being free, it moves behind an API route. Say so when it does.
- **A version's entry lands one deploy late.** The file is committed, so the run that writes version
  N's line ships in version N+1. That is the honest ordering — the alternative is describing a deploy
  before it happened — but the page should not imply it is live-updating.
- **What the page shows for an invisible version.** Options are to hide them, to collapse them into a
  "12 behind-the-scenes deploys" line, or to show the lot. Hiding is likeliest right; the data
  supports all three.

Nothing about the page changes the file: the file is the product of this process, and the page is a
reader of it.

## The traps

- **A green run that read nothing.** Every stage here can succeed while doing nothing — a trawler
  that summarises subject lines, a Sol call that returned an empty answer file, a version whose
  commit range came back empty because the sha was not an ancestor. Each has a check named above, and
  they exist because [silent success](../reusable/silent-success.md) is how most of a day's bugs go
  here. Assert on `commit_count` per version and on entries-per-1000-commits across a run; a number
  that collapses is the signal.
- **Never quote a commit message to a reader.** They are written for us, they name internal files,
  and several of them describe production breaking. The copy stage translates; it does not excerpt.
- **Article prose never reaches the changelog.** Nothing in this process should touch reader data at
  all — it reads git and Vercel — but the rule is worth stating because the copy stage is a model
  call and model calls acquire context.
