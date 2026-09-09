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
`{ versions, unreadableLines }` with versions **newest first** (the file is oldest first; the tab is
not). Plus `tests/fleet-deploys.test.ts` against a fixture cut **and** the real committed file.

- [ ] not started

### Stage 2 — the route

`tools/fleet/routes-deploys.ts`: `GET /api/deploys`, two arms (`deploys` / `unreadable`) like
`routes-health-history.ts`, a `limit` clamped the way `windowHoursFrom` clamps hours, and the git
probe — three `spawnSync` calls with argv arrays, no shell, a timeout each, every failure an arm
rather than a throw. One mount line in `server.ts`; one block at the **end** of `wire.ts` for the
payload type. Tests drive `deploysPayload` directly and a fake git.

- [ ] not started

### Stage 3 — the client, the panel, the tab

`web/src/deploys-client.ts` (four arms, per `health-history-client.ts`: `deploys`, `unreadable`,
`no-answer`, `loading`), `web/src/DeploysPanel.tsx`, one additive mount in `App.tsx`, and my own
entries in `mode.ts` § `MODES`/`MODE_LABELS` and `Dock.tsx` § `MODE_ICONS`/`MODE_TIPS` — key
`deploys`, agreed with session `usage-limits-tab`, which asked that the registrations land in the
same commit as the panel so nobody clicks a tab with no mount behind it. Component tests per
`tests/fleet-web.test.tsx`.

**Three sessions are adding entries to the same `MODES` array tonight** (`usage`, `messages`,
`deploys`) and git will merge all three without a conflict marker while being free to drop one.
`Record<Mode, …>` is what saves it — a dropped entry makes the maps over- or under-specified — but
only on the post-merge tree, so: merge `origin/dev`, then typecheck, then count the entries by eye.

- [ ] not started

### Stage 4 — gates and review

`npm test`, `npm run typecheck`, lint the touched files, GPT Sol on the scoped diff plus raw test
output, two rounds.

- [ ] not started

## What this deliberately does not do

- **Not a deploy button.** Deploying is `npm run deploy` and it is Greg's.
- **Not a changelog runner.** Step 7 of *Running it* is a person reading public claims a model wrote,
  and a dashboard cannot be that person.
- **No per-deploy build logs.** They are on Vercel, behind the token this box does not have.
