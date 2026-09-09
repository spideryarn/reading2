# A "Deploys" tab on the fleet dashboard

Greg, 2026-09-08:

> add a tab for "Deploys" that shows information about the most recent deploys (e.g. time, changelog)

A fourth mode on the fleet dashboard (`tools/fleet/`, port 8787), beside Sessions, Box health and
Overseer: the most recent production deploys, newest first, each with when it shipped, what a reader
would have noticed, and the commits behind it.

## What a deploy is here, and where the record lives

There is no deploy table and no tag. [changelog.md](../project/changelog.md) settles it: **one
production deploy on Vercel is one version**, named by its timestamp, and the list of them is not in
git — `main` is fast-forwarded a sha at a time by [`scripts/deploy.ts`](../../scripts/deploy.ts), so
history alone cannot say which shas were deploy points.

Vercel's deployment list is the source of truth, and **this box cannot reach it**: there is no
`VERCEL_TOKEN` here and the CLI is logged out ([`scripts/changelog/changelog.ts`](../../scripts/changelog/changelog.ts)
says so at its Vercel call, and it is why step 1 of *Running it* uses the MCP tool rather than a
fetch). So the record this tab can read is the committed one:

**`src/web/changelog-versions.ndjson`** — append-only, one line per version, oldest first, 74 lines
tonight. Each line carries `version`, `deployment_id`, `sha`, `previous_sha`, `commit_count`,
`invisible`, `generated_at`, `generated_by` and the reader-facing `entries`. It is the same file
`/changelog` renders, and it is **only as fresh as the last time somebody ran the changelog job**.

That constraint is the design, not a limitation to route around. The tab reads the file, says plainly
how stale it is, and never asks for a token.

### The honest sentence this tab must not get wrong

The last recorded version tonight is `2026-09-08T05:32:17Z` at `8cd2206a`, and `origin/main` is 287
non-merge commits ahead of it. **That number is not "undeployed work".**

The first draft of this section then said *everything on `main` has either shipped or is shipping,
since `main` is written only by `npm run deploy`* — and **that is false**, which GPT Sol caught and
which I verified: [`scripts/deploy.ts`](../../scripts/deploy.ts) pushes to `main` and only *then*
waits for Vercel, so a build that failed or timed out leaves `main` advanced with nothing serving
from it. So the count mixes three things: deploys that happened and have not been written up, a tip
that has not been deployed, and pushes whose build never succeeded.

The tab therefore says the literal thing — *later non-merge commits in this checkout's cached
`origin/main`* — and adds that some may already have deployed and this view cannot tell which.

**A token-free way to do better exists, and it is the named next step rather than this pass.**
Production publishes its own build stamps: `/build.json` carries the client bundle's commit
(`vite.config.ts`) and `/api/health` carries the function's (`src/vercel-health.ts`), and
`scripts/deploy.ts` already fetches and cross-checks both. They cannot enumerate deploys or recover
their timestamps — the NDJSON stays the record — but they name **the sha currently serving**, which
splits the vague count into *commits included in the serving build* and *commits that are not*. Left
out here because it is an outbound network call from the dashboard and so needs its own
unavailable/malformed/client-disagrees-with-API arms, its own cache, and a guarantee that it never
delays or prevents rendering the recorded list.

`--no-merges`, because `commit_count` in the file is a non-merge count (changelog.md § Enumerate:
merge commits are dropped, and the doc was wrong about this until the file contradicted it). A count
taken the other way would be a bigger number sitting next to a smaller one with nothing saying they
were measured differently.

## Decisions

### The fleet reads the file; it does not import `src/changelog.ts`

[`src/changelog.ts`](../../src/changelog.ts) is a complete, dependency-free parser for exactly this
format, and reusing it is the first instinct — AGENTS.md § *reuse the machinery that's already here*.
**Passed over, and this is the decision most worth arguing with.**

`tests/fleet-imports.test.ts` walks the fleet's whole transitive import graph and asserts the set of
`src/` files it reaches is exactly its `ALLOWED` list. The rule behind that list
([overseer-direction.md](../project/overseer-direction.md) § Principles) is that this tool *"runs on
the box, spans repos, and must not depend on the product database or on anything under `src/`"*,
narrowed on 2026-09-08 to permit **leaf, browser-only, product-agnostic** modules. `src/changelog.ts`
is leaf and browser-safe but not product-agnostic: it hardcodes `REPO_URL`, `LAUNCH_VERSION` and the
product's three section names. If the fleet ever moves to its own repo it will still want to read
*this* repo's ndjson — as **data at a path**, the way it already reads tmux and `~/.claude/projects`.
So the coupling belongs on the path, not on the type.

**The cost is real**: two readers of one format, and the second one can drift. The mitigation is not
a comment, it is a check that can go red — `tests/fleet-deploys.test.ts` reads the **real committed
file**, not only a fixture, and asserts the reader found one version per non-blank line and zero
lines it could not read. The day the format moves, that test fails here as well as in
`tests/changelog-file.test.ts`. Two independent readings that are able to disagree is the only kind
of agreement worth having.

The alternative — one line added to `ALLOWED` — stays on the table and goes to Sol explicitly. If Sol
prefers it, it is a small edit in one direction and this section records why it went the other way.

### A tolerant reader that reports what it could not read

The fleet's own posture, from `routes-health-history.ts`: an empty list and a failure are different
claims, and drawing them the same way manufactures an outage. So the reader returns versions **and**
`unreadableLines`, and the panel shows the count rather than swallowing it. A field this reader does
not recognise is not an error; a line it cannot parse is counted and named.

It reads a subset — the header fields plus `entries[].section/title/body/where/commits` — because
that is what the tab draws. It does not re-validate the chain, the headline cap or the link scheme:
`src/changelog.ts` and `tests/changelog-file.test.ts` own those, and a second opinion on them here
would be a second place to be wrong.

### No `git fetch` from the route

The route runs three read-only git commands and **not** a fetch. A dashboard polled from a phone must
not be writing refs in a checkout eight other agents are working in, and a fetch is network work on
every request.

The consequence is that `origin/main` is *this checkout's view* of production, which may be behind.
Rather than pretend otherwise, the payload carries how old that view is (the mtime of the
`origin/main` ref) and the panel says so. In practice the ref is minutes old, because a dozen agents
fetch all night — but "in practice fresh" is not a thing to render as "fresh".

### Simplest version first: no Vercel, no token, no triggering

No live deployment list, no `npm run deploy` button, no changelog run from the dashboard. All three
are Greg's. **What live Vercel data would need**, so the question is answered rather than left open: a
`VERCEL_TOKEN` on the box, which is a change to `infra/` provisioning
([hetzner-remote-server-box.md](../project/hetzner-remote-server-box.md) § A change to the box is a
change to a file) and therefore Greg's call, not a thing this branch can decide. With one, the route
would gain a fourth arm — the recorded file joined to the live list, with deploys that exist and have
no line yet drawn as such, which is precisely the ambiguity § *The honest sentence* is stuck with.

### `zonedLine` comes from `tools/fleet/zones.ts`, not from here

Session `260908f-roadmap-usage` is landing it tonight (confirmed by message, signature quoted below);
a second formatter would be a second answer to *what time is it in Athens*. `zonedLine(iso)` returns
`"2026-09-08 23:40 UTC · 00:40 London (+1d) · 02:40 Athens (+1d)"`, or `null` for anything it cannot
read. The `(+1d)` is the part worth not reinventing: a 23:40 UTC deploy is 02:40 Athens the next day,
and printed bare beside the UTC time that reads as three hours in the past.

## Stages

### Stage 1 — the reader

`tools/fleet/deploys.ts`: pure, no HTTP, no clock. Takes the file's text, returns
`{ versions, unreadable, lines }` with versions **newest first** (the file is oldest first; the tab
is not). Plus `tests/fleet-deploys.test.ts` against a fixture cut **and** the real committed file.

- [x] **Done.** 47 tests. Three deliberate breaks were checked red before the stage was believed:
  dropping the newest-first reversal (5 fail), counting successes rather than lines for the release
  number (1), and no longer recognising the `entries` field (4).
- [x] **Reworked after the plan review.** `readChangelog()` was lifted out of `readVersion` and now
  answers three ways rather than two — see § What the review changed. Sentinels (`-1`, `""`) went to
  `null` before the review: a line that has forgotten how many commits it shipped has not shipped
  zero, and zero is a number a panel would draw and a reader would believe.

### Stage 2 — the route

`tools/fleet/routes-deploys.ts`: `GET /api/deploys`, two arms (`deploys` / `unreadable`) like
`routes-health-history.ts`, a `limit` clamped the way `windowHoursFrom` clamps hours, and the git
probe in `tools/fleet/git-probe.ts`. One mount line in `server.ts`, one composition in
`deploys-wiring.ts` (the lesson `health-wiring.ts` exists for), one block at the **end** of
`wire.ts`. Tests drive `deploysPayload` and `makeDeploys` directly, plus a real throwaway repository.

- [x] **Done**, and then substantially reworked by the review: the probe is asynchronous, takes one
  snapshot against one resolved sha, and caches behind a single flight. See § What the review
  changed.
- [x] Verified against reality rather than only against fixtures: the route answers 287 commits since
  the newest recorded deploy, which is what `git rev-list --count --no-merges` says by hand. Two
  independently-built joins agreeing is worth more than one.

### Stage 3 — the client, the panel, the tab

`web/src/deploys-client.ts` (four arms, per `health-history-client.ts`: `deploys`, `unreadable`,
`no-answer`, `loading`), `web/src/DeploysPanel.tsx`, one additive mount in `App.tsx`, and my own
entries in `mode.ts` § `MODES`/`MODE_LABELS` and `Dock.tsx` § `MODE_ICONS`/`MODE_TIPS` — key
`deploys`, agreed with session `usage-limits-tab`, which asked that the registrations land in the
same commit as the panel so nobody clicks a tab with no mount behind it. Component tests per
`tests/fleet-web.test.tsx`.

**Three sessions are adding entries to the same `MODES` array tonight** (`usage`, `messages`,
`deploys`) and git will merge all three without a conflict marker while being free to drop one.
I planned to rely on `Record<Mode, …>` plus a count by eye. **That was wrong, and Sol said why:**
`Mode` is *derived from* `MODES`, so a merge that drops `"deploys"` from the array **and** its four
map entries leaves every `Record<Mode, …>` perfectly typed and the tab simply gone. There is now an
explicit assertion that `"deploys"` is in `MODES` — the only thing that can catch it.

- [x] **Done.** Panel, client, four registrations and the `App.tsx` mount, all in one commit, per the
  convention `usage-limits-tab` set tonight so nobody clicks a tab with no mount behind it.
- [x] The missing-mount test was checked red by removing the `App.tsx` arm: 11 of the tab's tests
  fail. It is the one the type system cannot do.
- [x] Two bottom-bar tests that hard-coded three mode labels now derive from `MODES`, so the next tab
  does not go red in a file four sessions are editing.

### Stage 4 — gates and review

`npm test`, `npm run typecheck`, lint the touched files, GPT Sol on the scoped diff plus raw test
output, two rounds.

- [x] Round 1 on the plan: `260909b-deploys-tab-plan-review-sol-r1.md`. Verdict *not ready to build
  unchanged* — four P1s. Every factual claim in it was checked before acting; all held.
- [x] Round 2 on the code: `260909b-deploys-tab-code-review-sol-r1.md`. **Four more P1s**, and the
  code round earned its higher weighting — see § What the code review changed. None of them were
  findable from the plan.
- [x] Round 3, verifying the fixes: `260909b-deploys-tab-code-review-2-prompt.md`.
- [x] `npm run typecheck` clean; lint clean on the touched files.
- [x] `zonedLine` from `tools/fleet/zones.ts` swapped in when it landed (`af1ec002`), which was the
  one line the seam existed for.
- [x] **Looked at in a real browser**, which is the half no jsdom test covers — a Sonnet subagent
  driving Playwright against a *private* instance on `FLEET_PORT=8799`, never the live dashboard on
  8787. See § What the browser check found.

## What the review changed

Worth its own section, because three of the four P1s were about the tab **telling the truth**, which
is the only thing it is for.

- **The claim about `main` was false.** See § The honest sentence, rewritten.
- **"We could not read what changed" was rendering as "nothing changed".** `invisible` was derived as
  `entries.length === 0`, so a line whose `entries` was missing, not an array, or full of unreadable
  objects came out as a *quiet deploy* — and the panel says *Nothing a reader would notice*, which is
  the opposite of the truth and looks exactly like the common case. A deploy that shipped a headline
  feature would have rendered as one that shipped nothing, with no error anywhere. There are now
  three outcomes and `changelogReadable` on the wire.
- **Three `spawnSync` calls in an HTTP route can freeze the whole control plane.** The dashboard is
  one Node process and the Overseer has no independent source of fleet state, so a slow disk would
  let one Deploys request block every session, action and heartbeat for the sum of three timeouts.
  Now `execFile`, one snapshot, single flight, 15 s TTL.
- **The staleness number measured the wrong thing.** Measured on this box rather than argued about:
  `FETCH_HEAD`'s mtime does advance on a no-op fetch, so it says when we last *asked* — but it names
  whatever was last fetched, so it does not prove `origin/main` was refreshed, and the loose ref may
  be packed and have no mtime at all. Relabelled to exactly what it measures.
- **The drift mitigation was too weak.** "One version per non-blank line" passes while the two
  readers disagree about every field. The test now runs both over the real file and compares
  `release`, `sha`, `previous_sha`, `deployment_id`, `commit_count`, `generated_at`, `invisible` and
  every entry's `section`/`title`/`body`/`where`/`commits`. The import of `src/changelog.ts` is
  test-only and adds no runtime dependency, because `tests/fleet-imports.test.ts` walks the graph
  rooted at `tools/`.
- **The dock's Refresh did nothing on this tab.** Its tooltip presents it as the page's refresh
  control and it called `feed.refresh()` only — so on a panel with its own route, pressing it was
  indistinguishable from a broken button, on the one page whose job is to say whether things are
  broken.

**One finding deliberately not taken**, and it is the most interesting: production publishes its own
token-free build stamps, so *"commits included in the serving build"* and *"commits that are not"* is
answerable without Vercel. See § The honest sentence for what it would take. It is the right next
step and it is not this branch.

## What the code review changed

The plan round could not have found any of these, which is why AGENTS.md weights the second review
higher — *"a plan-stage review can't find a `PATCH` that writes one field and then rejects the
request"*. Four P1s:

- **The tab re-fetched once a second, aborting the previous request each time.** `api =
  httpDeploysApi()` in a default argument builds a new object on every render, `useNow` re-renders
  this page once a second, and the panel's effect depends on the api's identity. So the browser
  aborted and restarted `/api/deploys` every second for as long as the tab was open, while the box
  went on working on every abandoned one — and a response slower than a second would never have been
  accepted at all. **The tests could not see it because they inject a stable fake**, which is the
  precise shape of hole a code review exists for. It is a module-level `const` now, like
  `httpHistoryApi` and `httpActionsApi` beside it.
- **A stale cached ref was drawn as a rollback alarm.** Any non-ancestor produced *"a rollback, or a
  deploy from a working directory"* — including the commonest benign state, a checkout that has not
  fetched since the changelog job last ran. An alarm that fires on the normal case is an alarm nobody
  reads. The probe asks the ancestry question in both directions now and answers four ways, and the
  count is withheld unless the histories are comparable, because `rev-list A..B` across a divergence
  is a set difference that reads like a distance.
- **The route's worst case was longer than the browser's timeout** — four sequential waits at 5 s
  against a 15 s client deadline — so a merely slow git would have let the browser replace a
  perfectly readable deploy list with "no answer". There is an 8 s budget for the whole snapshot now.
- **A corrupt newest line let the header measure from the wrong deploy.** The record is append-only,
  so its last line is its newest deploy; when it failed, everything downstream called the survivor
  "the newest recorded deploy" and computed a confident distance from it. The earlier tests covered a
  corrupt *oldest* line, which costs a row and nothing else — the difference between a test suite
  that looks thorough and one that is.

**And one of my own tests proved nothing.** The cache test compared two snapshots for equality —
which only shows git is deterministic — and counted calls to the injected *clock*, so deleting the
cache entirely would have left it green. It counts real command executions through an injected runner
now.

That was the fourth instance in one night of a check that could not fail in the case it was written
for, across five sessions on this subsystem; `dashboard-modes-doc` has put the pattern to the
Overseer as a queue item. The others here: a source guard satisfied by the line inside a `//`, a
`toContain` on copy that flagged a true sentence, and `Record<Mode, …>` proving a half-added mode and
not a wholly-removed one.

## What the browser check found

Nothing wrong, which is worth recording as a fact rather than assumed: the tab renders correctly at
1280px and at 390px, **no horizontal overflow at phone width** (checked programmatically —
`scrollWidth === clientWidth === 390` and zero elements past the viewport edge — rather than by
looking at a screenshot), no console errors or warnings, and "show more" really does grow the list
from 10 rows to all 70 remaining. The three-zone time line renders as
`2026-09-08 05:32 UTC · 06:32 London · 08:32 Athens`.

**One operational trap, and it is worth more than the result.** The agent launched the private server
with `npx tsx tools/fleet/server.ts &` and captured `$!` as briefed — and that pid was the **`npx`
wrapper**, which exits immediately and leaves the real server running as a detached child. So
`kill $!` succeeds, reports nothing wrong, and leaves the server up: a successful kill of the wrong
process looks exactly like a successful cleanup. It was caught only because the brief also said to
verify the port stopped answering. The instruction to give next time is *kill by port* —
`ss -ltnp | grep <port>` names the listener — *and then check the port*. Port 8787 was confirmed
answering throughout and afterwards.

## What this deliberately does not do

- **Not a deploy button.** Deploying is `npm run deploy` and it is Greg's.
- **Not a changelog runner.** Step 7 of *Running it* is a person reading public claims a model wrote,
  and a dashboard cannot be that person.
- **No per-deploy build logs.** They are on Vercel, behind the token this box does not have.
