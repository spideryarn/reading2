# The changelog page, and a runner that can be asked to do the right thing

[260906d](260906d-retrospective-changelog-for-every-version-since-the-beginning.md) produced the
file. This is the other two halves: the page a reader opens, and enough committed machinery that
*"run `docs/project/changelog.md`"* is an instruction rather than a research project.

> Ok, finish off this work, build the complete /changelog page, running it retrospectively for all
> versions, and set things up so that we can say `run @docs/project/changelog.md` in future, and
> it'll do the right thing.
>
> Oh, perhaps we could also incorporate this changelog process as a later step in
> @docs/reusable/get-ready-to-deploy.md? … if you can't see a clean way to generate the changelog
> prior to the version being deployed, then ignore this idea.
>
> — Greg, 2026-09-06

## Three pieces

**1. The runner** — `scripts/changelog/changelog.ts`, six subcommands, one per deterministic stage.
The first run did all of this in throwaway scratchpad Python, and two of the run's six recorded
mistakes were in that code rather than in any model's output: the missing `--full-history` that
silently pruned a real change out of the code/non-code split, and the duplicate agent whose late
output overwrote a finished one. Committed code with the checks inside it is what stops those being
learnt again.

**2. The page** — `/changelog`, lazy-loaded, reading the NDJSON through Vite's `?raw`.

**3. The answer to the deploy-sweep question** — below, and it is *no*.

## The file format now has one definition

[`src/changelog.ts`](../../src/changelog.ts) — the schema and its reader, flat under `src/` rather
than beside the scripts, because the writer and the page are both callers. A format defined twice
drifts, and here the drift would show as a blank page rather than as an error.

**Flat, and one file, rather than the `src/changelog/` pair it started as.**
`tests/client-imports.test.ts` lets the client reach only modules resolved directly under `src/` and
named in its `SHARED` list, so a nested pair needs a second mechanism beside that one — and the
first version of this work added exactly that. `asset-delivery.ts` had already faced the same choice
and flattened; reusing the machinery that is here beats a second way to do the same thing.
The one exception that survives is the `?raw` import of the NDJSON itself, which is committed data
outside `src/` with no `src/` leaf to move a copy into, registered as a single exact specifier.

`parseChangelog` reports problems rather than throwing, because its three callers want three
different things from a bad line: the page renders around it, the writer refuses to append under it,
and `tests/changelog-file.test.ts` fails on it. **The test is what stops the page's tolerance from
becoming somewhere errors go to be quiet.**

*It found something on its first run.* The chain check — each line's `previous_sha` is the line
above's `sha` — reported a duplicate sha on 2026-08-27. That is a **redeploy**: `903b33e6` shipped
twice, thirty minutes apart, the second with zero commits and correctly marked quiet. So a repeated
sha is only a fault when the second line also claims commits, and the check says so now. The point
is not the fix; it is that an invariant asserted over real history immediately found a case the
process doc had never mentioned.

## What building the page found in the file

**Thirty-two entries linked to `/read`, which is a 404.** The shelf is at `/`; an address under
`/read/` needs an article slug after it, so `parseRoute` sends a bare one to the not-found page. The
links were labelled *your library* and had been on the copy stage's closed list of permitted
addresses since the day that list was written.

Every check in the process passed them, and each was a reasonable check: the copy agents were told
to use only listed addresses, and the validator confirmed they had. **Both asked whether the address
was permitted. Neither asked whether it existed.** The list was the thing that was wrong, so
agreement with it proved nothing — a single point of truth is only worth what it costs to verify,
and nothing had ever verified this one.

Fixed in the file (32 links repointed at `/`, via a script that first proves its own re-serialisation
is byte-identical to what is on disk, so the only change it makes is the one it intends), in
`OK_LINK_PATHS`, and in `copy-prompt.md`. The durable half is in `tests/changelog-file.test.ts`,
which now asks **`parseRoute` itself** about every in-app link in the file and every address on the
list. That also covers the version of this that has not happened yet: renaming a route silently 404s
every entry that ever linked to it, and nothing else in the repo would notice.

## The page's three open decisions, taken

[changelog.md § The page](../project/changelog.md#the-page) left these for whoever built it.

- **How the file reaches the browser: Vite `?raw`, inside the lazy route.** No API route, no
  database — the simplest thing that works, as that section proposed. The one refinement it did not
  say: at 210 KB the file must not be in the eager bundle, so the import lives inside the lazily
  loaded page module and the route uses `LazyPage`, the third to do so after `/admin` and `/design`
  ([`LazyPage.tsx`](../../src/web/LazyPage.tsx)). `tests/eager-client-graph.test.ts` is what holds it
  there.
- **Quiet versions collapse.** A run of consecutive invisible versions becomes one muted line
  between its neighbours rather than a row of empty blocks. Hiding them entirely would leave
  unexplained gaps in a dated list; showing them all would bury the 49 versions that have something
  to say under the 19 that do not.
- **A version's entry lands one deploy late**, unchanged, and the page does not claim otherwise.

**Commit links ship**, which that section had blocked: `spideryarn/reading2` was private and every
link would have 404'd for exactly the reader it exists for. It went public on 2026-09-06, confirmed
twice — the repository page answers, and Vercel's own `githubRepoVisibility` flips from `private` to
`public` between that day's 05:29 and 09:49 production deploys.

## The deploy sweep: no, and the reason is not the one in the question

Greg's worry was that the deploy has not happened yet. **That is a non-problem.** A changelog run
never describes a deploy that has not happened; it catches up the ones that have. Work sitting
uncommitted or unshipped belongs to no version yet and waits for a later run, which is already a
rule in the process doc. Put the run anywhere and the ordering is honest.

The objection that holds is a different one, and GPT Sol put it better than I had:

> The pre-deploy sweep exists to leave `dev` committed, green, and pushed. A late changelog step
> would instead dirty the tree after that work, perform an editorial decision during an unattended
> maintenance run, and make public claims unrelated to deploy readiness.
>
> — GPT Sol, 2026-09-06

[get-ready-to-deploy.md](../reusable/get-ready-to-deploy.md) also runs **unattended on a three-hour
timer**, and the failure that reaches a reader is not a crash — it is a plausible false sentence.
The copy stage is a model rewriting verified items, and it can strengthen *"code intended to do X"*
into *"X is now available"* while every structural check passes: the shas are real, the sources are
in range, the sections are ordered. Nothing downstream would notice, and the next deploy publishes
it.

So: **generation is separate from publication.** The run is a thing a person asks for, and a person
reads the new lines before they ship. `deployment.md` gets one line suggesting it after a deploy,
which is the moment the version you want written up has just become a fact. Sol's own summary:

> Generate retrospectively after facts exist, review explicitly, publish one deploy late.

The rejected alternative, for the record, was a **provisional entry** keyed to the candidate sha and
reconciled once the deploy lands. It buys nothing — the one-deploy delay is already accepted — and
costs provisional-versus-final states, invalidation, and cleanup after a failed deploy.

## The simpler option passed over

**Leaving the deterministic stages as prose in `changelog.md` and letting each run write its own
scripts.** That is what the first run did, and it is genuinely cheaper to build. Rejected because
the two failures worth preventing were both in that throwaway code rather than in any model's
judgment, and neither had a symptom: the pruned commit was found by enumerating the excluded set on
a hunch, and the overwritten output by checking file mtimes against the finished file. A prose
warning does not run. `git log --full-history` does.

## Results

**The runner was validated twice, and the second way is the one that counts.**

First by *replay*: driven over the first run's own artefacts — its spine, batches, trawl items, review
answers and copy outputs — it reproduces the committed 68-line file **byte-for-byte**, `generated_at`
aside. Every stage tally comes back identical (821 kept, 258 corrected, 36 sol-found, 995 commits in
and out, 236 entries, 619 commit links). That proves the port is faithful; it does not prove the
runner works, because a replay never touches Vercel, never launches an agent and never appends.

Then by *running it*, on the one production deploy that had happened since:

| Stage | |
|---|---|
| **Spine** | 2 READY production deploys, 1 already written; **1 version to do**. `previous_sha` taken from the watermark, ancestry checked and passed. |
| **Pre-filter** | 50 non-merge commits in range, **17 touching code**, 33 not. Leaks from the excluded set: **0**. |
| **Trawl** | 2 Sonnet agents, **9 items**. 17 commits in, 17 out — none missed, none twice, none invented. |
| **Review** | 1 GPT Sol call, all **6 user-facing items ruled**: 2 confirmed, **4 corrected**, 1 of those flipped to not-user-facing. Nothing missed, one regroup. |
| **Copy** | 1 Opus call, **5 entries** — 2 headline, 2 enhancement, 1 fix. |
| **Write** | 1 line appended, 13 commit links, **0 errors, 0 warnings**. The file is now 69 versions, 241 entries. |

Four in six items corrected, on a day the trawl had every advantage — seventeen commits, one day,
two agents. That is the same shape as the retrospective run's 51%, and the argument for the review
stage does not weaken as the batches get smaller.

### What the run changed in the runner

**`regroup` was the review's fourth question and the only answer nothing acted on.** Sol asked for
six PDF-groundwork commits to be folded into the entry that shipped the feature — *"stages A–D of
the same PDF-figure recovery feature"* — and the pipeline had no place to put that: the Python
printed it into an answer file and moved on. Unapplied, the entry would have cited two commits out
of eight. It cannot be applied mechanically, because deciding which item a commit belongs with is
the judgment the whole stage exists for. So `verify` now prints every regroup loudly and says what
to do, and `verify --reassign` rebuilds `assigned.json` from the files under `verified/` **without
rewriting them**, which is what a person needs after editing one by hand.

### What looking at the page changed

Two things the tests were happy with and a browser was not:

- **The same commit was linked twice** on most entries — once inline as *the change*, once in the
  muted sha row. A browser pass counted 855 commit links against the file's 619. The row now shows
  the remainder.
- **"N releases in between with nothing you'd notice"** was the page's opening line, because the
  newest release is usually a quiet one — and at the top there is nothing for it to be between.

Both now have tests, and both tests were checked red against the old behaviour before being kept. So
were the heading levels, which ran `h1 → h3 → h4 → h4`: a skipped level, and then a section heading
and the entries under it claiming to be siblings. It looked right because the sizes come from classes
rather than from the level, which is exactly why nobody would have noticed.

### What the cross-family review found, and why it mattered

GPT Sol reviewed the code and **verified its findings by running it rather than by reading it**. Its
verdict: the page was fit to ship, the runner was not yet a safety boundary. Three high findings, all
the same shape — a way to publish something wrong while every command exits 0.

- **The mandatory review was not enforced.** `verify` required Sol's answer file to exist but not a
  ruling for every user-facing item; a missing ruling only incremented a counter nothing failed on,
  and unknown verdicts and out-of-range indexes were accepted. Demonstrated: two user-facing items,
  one ruling, both shipped. Now the answer's schema is checked and an unruled item stops the stage
  unless `--allow-unreviewed` is passed.
- **The sha guarantee was circular.** The writer's rule is *every sha is present in that version's
  input* — but a review-found item carrying `[real sha, 40-character typo]` was assigned on the
  strength of the real one, the typo entered that input, and the writer then confirmed it against
  the input it had just polluted. A real-but-undeployed sha did the same and could date a change
  before it shipped. **This is the "a wrong sha is a 404" failure the process doc already names,
  still open in a different disguise** — the check had been written where the answer was already
  assumed. Now every sha on an assigned item must be reachable from the version it is assigned to,
  checked against one `git rev-list` per version.
- **The copy stage could erase a release.** Five verified changes in, `entries: []` out, and that was
  only a warning: the version shipped `invisible: true`. A release with five real changes became one
  that had none. Now an error, and an entry's commits are validated against the sources it actually
  cites rather than against the version-wide union.

And four smaller ones, all fixed: a dirty work directory could apply a stale review answer to a fresh
item set by index; `A → B → A` rollbacks passed a chain check that only immediate redeploys should;
the parser silently normalised an impossible date, a negative commit count and **an external link to
any URL at all**, which the page renders; and the append was not crash-atomic.

**The pattern worth keeping.** The first review of this pipeline corrected half the trawl's claims.
The second found that the machinery enforcing that review could be bypassed. Both were found by
handing the work to a different model and asking it to attack — and in both cases the failure was
invisible from inside, because every check that existed agreed with itself.

Two of the review's recommendations were not taken, and the reasons are in the code: a written reason
per deliberately-dropped input (the first run dropped 15 of 504 on purpose — the count carries the
signal at a fraction of the cost), and millisecond precision in the version stamp (that stamp is the
id of 69 existing lines; a collision is detected and refused instead). Content-hashed stage inputs —
the thorough fix for the stale-artefact finding — were deliberately left undone: only the cheap half
is in, a refusal to start on a dirty work directory.

### Checks

`npm run typecheck` clean. `npx tsx scripts/changelog/changelog.ts check` — 69 versions, no problems.
The targeted suites (`changelog-file`, `changelog-page`, `client-imports`, `site-footer`,
`eager-client-graph`, `page-title`, `doc-links`) all green. The page was driven in a real browser at
1280 and 390: no console errors, no horizontal overflow, the footer's *What's new* correctly absent
on its own page, and `/read` confirmed as the not-found page it turned out to be.
