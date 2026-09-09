# Review this plan before it is built: a "Deploys" tab on an internal agent dashboard

You are reviewing a PLAN, not code. Be adversarial. I want P0/P1/P2/P3 findings, and I especially
want you to attack the two decisions I flag below — I have argued myself into both and would rather
be corrected now than after the code exists.

## Context you need

The repo is Spideryarn, a reading app. Separately, `tools/fleet/` is an internal dashboard, served on
port 8787 on an always-on Hetzner box, that shows the ~40 Claude Code agent sessions running in tmux
on that box. It is read by one person (Greg) on his phone. It has three "modes" (tabs): Sessions, Box
health, Overseer. Greg asked for a fourth: "add a tab for Deploys that shows information about the
most recent deploys (e.g. time, changelog)".

Key facts about the environment, all verified by me tonight:

- A "deploy" is one Vercel production deploy. There is no tag and no version number. `main` is
  fast-forwarded one sha at a time, so git history alone cannot say which shas were deploy points.
- Vercel's deployment list is the source of truth, and **the box has no VERCEL_TOKEN and the Vercel
  CLI is logged out there**. So the dashboard cannot ask Vercel anything.
- What it CAN read is a committed file, `src/web/changelog-versions.ndjson`: append-only, one line
  per version, oldest first, 74 lines. Fields: version (an ISO stamp, which is the version's id),
  deployment_id, sha, previous_sha, commit_count, invisible, generated_at, generated_by, entries[]
  (reader-facing changelog copy: section/title/body/where/commits/links). It is written by a
  multi-stage agent pipeline that Greg runs by hand every so often, so it lags reality.
- Measured tonight: last recorded version is 2026-09-08T05:32:17Z at sha 8cd2206a; `origin/main` is
  at 8985e7b6; `git merge-base --is-ancestor` says the recorded sha IS an ancestor of origin/main;
  `git rev-list --count --no-merges 8cd2206a..origin/main` is 287.
- `tests/fleet-imports.test.ts` walks the fleet dashboard's whole transitive import graph and asserts
  the set of files it reaches under `src/` is exactly an ALLOWED list (13 entries, all
  browser-audio/dictation leaves). The architectural rule is that the fleet tool must be movable to
  its own repo.

## The two decisions I most want attacked

1. **I chose NOT to import `src/changelog.ts`** — an existing, dependency-free, well-tested parser
   for exactly this file — and instead to write a second, tolerant, subset reader inside
   `tools/fleet/`. My reasoning is in the plan under "The fleet reads the file; it does not import
   src/changelog.ts". The house rule elsewhere in this repo is emphatically "reuse the machinery
   that's already here rather than adding a second way to do the same thing", so I am going against
   it deliberately. Is my reasoning good enough, or am I rationalising? The alternative is one line
   added to that ALLOWED list.

2. **The claim the tab makes about commits since the last recorded deploy.** See the plan section
   "The honest sentence this tab must not get wrong". I believe "287 commits on main that no recorded
   version accounts for" conflates (a) deploys that happened but the changelog job has not recorded
   and (b) commits on main not yet deployed, and that the tab cannot separate them without Vercel.
   Is that right? Is there any read-only, token-free signal on the box that WOULD separate them? And
   is my proposed wording actually honest, or does it still imply something false?

## Also please look for

- Failure modes I have not given an arm to. The house discipline here is that "we looked and there is
  nothing" and "we could not look" must never render the same way, because on a health chart a blank
  reads as "the box was down". What are the equivalent confusions for a deploys list?
- Anything about running `git` from an HTTP route in a checkout that eight other agents are actively
  editing. I decided NOT to `git fetch` (read-only view of origin/main, plus the ref's mtime so the
  page can say how stale that view is). Attack that.
- Whether the stage split is sensible, and whether any stage is doing too much to review.
- Security: this server has no auth (reachability via Tailscale is the access control) and refuses
  wildcard binds. The new route is read-only. Is there anything in "spawn git with a caller-influenced
  argument" that I should be worried about? (My intent: no caller-supplied value reaches an argv slot
  — the only query parameter is a numeric limit, clamped.)

## The plan

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
non-merge commits ahead of it. **That number is not "undeployed work".** Everything on `main` has
either shipped or is shipping — `main` is written only by `npm run deploy`. What the number actually
says is *no recorded version accounts for these commits*, which lumps together two different things:
deploys that happened and have not been through the changelog job yet, and the tip that has not been
deployed. This tab cannot tell them apart without Vercel, so it must say the weaker true thing rather
than the stronger false one. The wording is fixed in stage 3 and the reason is here.

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
