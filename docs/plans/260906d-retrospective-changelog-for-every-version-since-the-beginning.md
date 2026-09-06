# The retrospective changelog run

Run the process in [changelog.md](../project/changelog.md) over the whole history — every production
deploy since the project started, 2026-08-24 — so `/changelog` has something to show on the day it
is built.

> Then run retrospectively for all versions since the beginning.
>
> — Greg, 2026-09-06

This is the "first run is retrospective" section of that doc, actually done. Everything here that
turns out to be a permanent property of the process rather than of this one run gets folded back
into `changelog.md` at the end.

## What we are working with

Measured 2026-09-06, on `dev` at `a1893e7b`:

| | |
|---|---|
| Commits, non-merge | **2,066**, back to `cd7fc572` on 2026-08-24 |
| Of those, touching code | **994** — `src/`, `drizzle/`, `styles/`, `public/`, `api/`, `index.html`, `vercel.json`, the vite configs, `package.json`, `components.json` |
| Touching none of that | **1,072** — docs, plans, postmortems, tests, evals, `scripts/` |
| Days with code commits | 14, from 8 on the first day to 159 on 2026-08-26 |
| Production deploys | enumerated from Vercel; see § The version spine |

## The three decisions this run takes

**Commits that touch no code at all are classified without a model.** A commit that changes only
`docs/`, `tests/`, `evals/` or `scripts/` cannot change what a reader sees, so it is marked
non-user-facing by construction, with the path list as its evidence. That is 1,072 of 2,066 — more
than half the history — and spending a model call on each of them would buy nothing. The paths that
count as code are listed above and are deliberately generous: `styles/` and `public/` are in there
because a stylesheet and a favicon are both things a reader meets.

*The check that keeps this honest:* if the rule is wrong it is wrong silently, so the excluded set
is sampled rather than trusted, and the sample is recorded below.

**The trawl is batched by day, not by version.** Versions here run from 1 to 76 commits and
frequently split one piece of work down the middle — the link hover cards landed across three
commits inside one version, but the store deletion landed across two. Batching by day gives the
trawler a coherent stretch of work to group, and costs nothing, because an item carries its commit
shas and the version is derived from them afterwards.

**An item belongs to the version containing its last commit** — the deploy that first shipped all of
it. An item whose commits straddle two deploys would otherwise have to be either duplicated or cut in
half, and both lie about when a reader could first use the thing. This is a permanent rule and goes
back into `changelog.md`.

## The simpler option passed over

**One agent per version, reading that version's diffs, with no pre-filter.** It is the obvious shape
and it is what `changelog.md` describes. Rejected for this run only, on arithmetic: 2,066 commits at
the pilot's six-per-agent is 344 agents, more than half of them reading a doc commit to conclude that
a doc commit changes nothing. The day batching and the code pre-filter bring it to 89 agents over 994
commits, and neither changes what the output can say — the pre-filter's exclusions are recorded with
their reason, and the day batches still resolve to versions by sha.

## Stages

- **1. The version spine.** Every production `READY` deployment from Vercel, oldest first, with its
  timestamp, id and sha. Paged through the MCP tool, because this box has no `VERCEL_TOKEN` and the
  CLI is logged out. Then the commit range per version, with `git merge-base --is-ancestor` checked
  on each pair rather than assumed.
- **2. Pre-filter.** The 1,072 non-code commits, recorded as excluded with their path list.
- **3. Trawl.** 89 Sonnet subagents, 12 commits each, briefed from one file on disk
  (`cl-BRIEF.md`) so the brief is identical for all of them. Run in waves.
- **4. Review.** GPT Sol, one call per day of history, checking every claim against the diffs. The
  pilot run is the argument for this stage existing: of eight items it corrected five, found a
  user-facing fix that all three trawlers had missed, caught a change attributed to the wrong
  version, and rejected the trawl's central claim outright.
- **5. Copy.** [`scripts/changelog/copy-prompt.md`](../../scripts/changelog/copy-prompt.md), one call
  per version that has items, into headline changes, minor enhancements and bug fixes.
- **6. Write.** `docs/changelog/versions.ndjson`, oldest first, one line per version including the
  versions with nothing to say.

## What this run must not do

- **No commit message reaches a reader.** They name internal files and several describe production
  breaking.
- **No commit link ships while the repo is private.** The shas go in the file; whether the page
  renders them as links is the page's decision, and it must not until
  [`spideryarn/reading2`](https://github.com/spideryarn/reading2) is public.
- **Nothing touches the production database.** This run reads git and Vercel and writes one file.

## Results

Run on 2026-09-06. Output: **`docs/changelog/versions.ndjson`**, 68 lines, 236 entries.

| Stage | |
|---|---|
| **1. Spine** | 79 production `READY` deploys → **68 versions**. Zero `merge-base --is-ancestor` failures. The 11 earliest carry no sha — they predate the git integration, and `vercel deploy` from a working directory attaches no ref ([deployment.md](../project/deployment.md)) — so they collapse into version 1. |
| **2. Pre-filter** | 995 code-touching commits, 1,071 not. Leaks from the excluded set: **0**. |
| **3. Trawl** | 89 Sonnet agents, **782 candidate items**. Every commit handed out came back in exactly one item: 995 in, 995 out, none missed, none invented. |
| **4. Review** | 14 GPT Sol calls, **506 rulings, zero unruled**. 247 confirmed, **258 corrected (51%)**, 1 rejected, **36 changes no trawler found**, 35 items flipped to invisible and **16 flipped back to visible**. |
| **5. Copy** | 49 Opus calls (19 versions had nothing to say). 236 entries: 56 headline, 86 enhancement, 94 fix. |
| **6. Write** | 68 lines, oldest first. **619 commit links**, every sha re-verified as 40 hex characters *and* present in that version's own input. Zero validation errors. |

**The review stage paid for itself.** Of the 284 shipped entries' source items, 137 entries rest on
at least one item Sol corrected and 23 on an item no trawler reported at all. Only 93 entries are
built purely from claims the trawl got right first time. The correction rate was steady across all
fourteen days — this is not one bad batch, it is what a cheap model reading diffs produces.

### The sample that keeps the pre-filter honest

The 1,071 excluded commits were enumerated by every distinct top-level path prefix they touch. One
`src/` hit turned up — `b64c7b7c` , three lines in `src/store/pg-jobs.ts` — because
`git log --no-merges -- <paths>` had silently pruned it. See the trap below. After `--full-history`,
re-verified: **0 leaks**.

## What this run found out, that the process doc did not say

Folded into [changelog.md](../project/changelog.md):

- **`git log -- <paths>` needs `--full-history`.** Default history simplification prunes side-branch
  commits in a merge-heavy history, so the code/non-code split silently loses commits. Caught only
  because the excluded set was enumerated rather than trusted.
- **An item belongs to the version containing its *last* commit.**
- **Work that is committed but not deployed belongs to no version yet.** Five items' commits were not
  ancestors of any production sha. They are not dropped and not guessed at — the watermark picks them
  up on the run after they ship.
- **The first version is a launch note, not a change list.** 388 commits and 143 items, and nothing
  preceded them. Written as what the app could do on day one; the two-headline cap is lifted there.
- **Re-verify every sha in the copy against that version's input.** A copy agent reported catching
  and fixing a mistyped sha in its own output, so the stage can emit one. A wrong sha is a 404 for
  the reader.
- **A duplicate agent can overwrite an output after the file is written.** Two versions were rewritten
  by a second agent launched by mistake; the NDJSON had to be regenerated. Check no output is newer
  than the file before committing.
