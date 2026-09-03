# Deployment

Spideryarn on Vercel: how it gets there, what is live, and the five things that
break without saying so.

> I'm inclined to think we should set up a new Vercel project, rather than
> interfering with the existing one there too. […] Ideally we'd get to the point
> where we're live in Vercel (though using a temporary url rather than the proper
> spideryarn.com domain — that's a later step)
>
> — Greg, 2026-08-26

The plan behind this is [260825d-deploy-and-repo-move.md](../plans/260825d-deploy-and-repo-move.md),
which is still the place for *why a new project*. **The domain move happened on
2026-08-27** — see [The domain](#the-domain). This file is what exists now.

## Where it is

| | |
|---|---|
| Vercel project | **`spideryarn-reading2`**, team `greg-detre` — a new project, [dashboard here](https://vercel.com/greg-detre/spideryarn-reading2). Created as `spideryarn` and renamed by Greg on 2026-08-26. `spideryarn-reading` is the old app; since 2026-08-27 it has no custom domain and is the rollback |
| Git | **connected** since 2026-08-26 to [`spideryarn/reading2`](version-control.md), production branch `main` — so a push to `main` deploys. `vercel deploy` from a working directory still works and is still useful; see [Deploying](#deploying) for why the two differ |
| Region | `lhr1` (London), chosen to match the Supabase project in `eu-west-2`. The edge answers from wherever you are; the *function* runs in London, next to the database |
| Node | 24.x. Greg, 2026-08-26: *"I'm happy to use Node 24 unless there's a good reason not to"* — there was one candidate reason and it turned out to be false, see [require(ESM)](#the-runtime-has-requireesm-turned-off) |
| URL | **`www.spideryarn.com`** since 2026-08-27, with the apex 307ing to it. Also a per-deployment `spideryarn-<hash>-greg-detre.vercel.app`, which asks for a login, and `spideryarn-greg-detre.vercel.app`, which does not. See [The domain](#the-domain) and [Who can reach it](#who-can-reach-it) |

**`spideryarn.vercel.app` was removed and `spideryarn-greg-detre.vercel.app` was
not**, which is why the app is currently readable by anybody who has that second
address. Vercel generates *two* of these, and removing one of them looks exactly
like removing the problem — see [Who can reach it](#who-can-reach-it).

## The domain

**`spideryarn.com` moved from `spideryarn-reading` to `spideryarn-reading2` on
2026-08-27.** Greg: *"Don't worry about old.spideryarn.com for now. Proceed."*

**The registrar was never touched, and that is the whole point.** The domain is
registered at Namecheap, on Namecheap's own nameservers
(`dns1`/`dns2.registrar-servers.com`), and its records point at Vercel's *shared*
edge rather than at any project:

```
spideryarn.com       A      76.76.21.21
www.spideryarn.com   CNAME  cname.vercel-dns.com
```

Which project answers is decided inside Vercel, by a domain→project mapping. So a
move between two projects in one team is a Vercel-side operation and nothing else
— no DNS edit, no propagation wait, no rollback window at the registrar. Vercel's
own `GET /v6/domains/<domain>/config` says as much before you start, and it is the
check worth running first:

```
configuredBy: A / CNAME     misconfigured: false
acceptedChallenges: ["http-01"]
ipStatus: "optional-change"
```

Two things fall out of that. **No `_vercel` TXT record was needed** — the domain
was already verified under this team, and verification is a team-level fact rather
than a per-project one, so it arrived at the new project already `verified: true`.
(An earlier draft of this section credited `acceptedChallenges: ["http-01"]` for
that, which GPT Sol correctly called a conflation: that field is about which ACME
*certificate* challenge Vercel can run, not about Vercel's own ownership check.
The conclusion was right and the reason was wrong.) And `optional-change` is
Vercel recommending its newer
values (`216.150.1.1`, `63e40ce30383a400.vercel-dns-016.com`) while ranking the
current ones second — the dashboard shows this as "DNS Change Recommended" on both
rows, which looks like a problem and is not one. It is unrelated to the move and
still not done.

### How it was done

Not through the dashboard. We drove it and **found no control that moves a domain
from one project to another** — the per-domain rows offer Refresh and Edit, and
the account-level **Move** is a different thing entirely, transferring ownership
to another *team* while warning that project domains deliberately stay behind. The
dashboard route is to add the domain to the new project and let it detach from the
old one silently. (Stated as what we found rather than what exists: this is UI, it
was true on 2026-08-27, and a 2022 changelog describes a move prompt we did not
see.)

The API has a purpose-built endpoint instead:

```
POST /v1/projects/<source-project>/domains/<domain>/move?teamId=…
     {"projectId":"<target project id>"}
```

The path project is the one **losing** the domain; the body's `projectId` is
documented as *"the unique target project identifier"*. Getting that backwards is
easy and the error it gives you is `not_found`.

**One call moved both names.** The endpoint also moves "all redirects pointed to
that domain in the same project", and `spideryarn.com` was a redirect pointing at
`www.spideryarn.com` — so moving `www` brought the apex along, redirect config
intact. The second call, for the apex, then returned `not_found`.

**The lesson is the state check, not the error.** `not_found` means the domain was
not at the source you named; here that was because it had already left, but it
means the same thing when you have typed the projects the wrong way round, and
those two readings are opposite. So do not learn "`not_found` means it worked" —
learn to answer it with `GET /v9/projects/<project>/domains` on **both** projects
before concluding anything.

The CLI can do it too, `vercel domains add <domain> <project> --force` (*"Force a
domain name for a project and remove it from an existing one"*). It was not used,
because nothing in `--force` promises to carry the apex's redirect across. Note
that `vercel domains move` is the team-transfer command, not this one, and that
`vercel domains ls` prints **zero domains** here while the dashboard lists
`spideryarn.com` perfectly well — do not read that as the domain being missing.

**No downtime was observed, and the served certificate did not change.** Both are
worth stating that carefully. Curls after the cutover show it completed, not that
no request failed during it. And the certificate claim rests on `notBefore Aug 18
2026` — the cert being served afterwards predates the move, so the cutover did not
need a replacement. It does not prove Vercel issued nothing in the background.
Either way the domain never stopped pointing at Vercel's edge, which is the reason
there was nothing to wait for.

**It did quietly cost the app its `noindex`**, which is a property of the address
rather than of the project and so is not the kind of thing a move checklist asks
about. That, and the `robots.txt` that answered `200 text/html`, are in
[Who can reach it](#who-can-reach-it).

### The apex is pinned to 308

`redirectStatusCode` came across as `null`, which Vercel serves as **307** — a
*temporary* redirect, for a relationship that is permanent. Pinned to **308** on
the day, with `PATCH /v9/projects/<project>/domains/<domain>` and a body of
`{"redirect":"www.spideryarn.com","redirectStatusCode":308}`. Two reasons, both
GPT Sol's: apex→www is canonical whoever owns the apps, and a default nobody
documents is a thing that can change under you.

### Rollback

The same call with the projects swapped — the apex should follow `www` back the
same way it came, since it is still a redirect pointing at it in the same
project. The old project is kept deployed and domainless precisely so this stays
true. "About a minute" is what it took, not a guarantee; check both projects'
domain lists and both live names afterwards rather than assuming.

### What happened to the old app

`spideryarn-reading` still runs and still answers on
`spideryarn-reading.vercel.app` — measured 200, not a login wall. It just has no
memorable address any more. The plan's kindness for its few non-paying users was
[`old.spideryarn.com`](../plans/260825d-deploy-and-repo-move.md), and **that one does need
Namecheap**: a new `old` CNAME at the registrar, plus the domain added to the old
project. Deferred by Greg, not forgotten.

## Deploying

```
npm run deploy
```

**That is the whole of it**, since 2026-08-27. It runs the gates against the
commit you are about to push, applies any pending migrations to the remote,
pushes, waits for Vercel, checks nine things about what came out, and reads that
deployment's logs. The plan, the nine measurements behind it and GPT Sol's review
are in [260827v-deploy-pipeline.md](../plans/260827v-deploy-pipeline.md);
[`scripts/deploy.ts`](../../scripts/deploy.ts) is the file and its header is the
short version.

| | |
|---|---|
| `npm run deploy` | the whole thing |
| `-- --dry-run` | every local gate, nothing external. Nothing pushed, no migration applied |
| `-- --verify-only` | check what is live right now, deploy nothing |
| `-- --force-gate=test` | named, never blanket, and printed in the summary as `DEPLOYED WITH … FORCED` |
| `-- --host <url>` | verify a host other than `www.spideryarn.com` |
| `-- --skip-migrations` | do not **apply** them. Still checks, and **refuses to ship** if any are pending |

Three things about it are worth knowing before you read the rest of this section,
because each one is a mistake this page already records:

- **The gates run in a `git worktree` of the exact commit**, not in your working
  tree, which is the only check that can catch the failure below —
  [committed code importing a file still on somebody's disk](#the-two-do-not-agree-and-git-is-the-one-telling-the-truth).
  It costs about two seconds.
- **It pushes by name**, `git push origin <sha>:refs/heads/main`, so the commit
  that was gated is the commit that ships. Several agents commit into this tree,
  and a plain `git push origin main` would gate one commit and ship another.
- **Every post-deploy check is anchored to the commit**, not to liveness, because
  nearly every check anybody would write passes over a perfectly healthy
  deployment three commits old. Both artefacts now carry a
  [build stamp](#the-build-stamp).

### The gate needs both halves of the artefact store

The test suite is **not hermetic**, and the worktree is empty of everything
gitignored, so the gate materialises `data/` **and `output/`** in it and links
`.env.local`.

For its first day it copied only `data/`. `output/` is the other half of the same
filesystem artefact store ([`src/store/artifacts-fs.ts`](../../src/store/artifacts-fs.ts)),
fourteen test files read from it, and the result was **13 failures and 202
cascade-skips at every commit** — so the `test` gate could not go green, and
`--force-gate=test` became the only way anybody deployed. Measured on two
different shas: identical failure set both times; the same suite in the working
tree passed 4820/4820; copying `output/` took it to a single failure.

That single survivor was real, and is the argument for the whole design: a
committed `docs/project/web-client.md` linking to an **untracked** test file.
Invisible in the working tree, which has the file. Exactly the class the worktree
exists to catch.

There is a named `fixtures` gate that says which sentinel file is missing,
because a missing fixture and a broken commit are opposite diagnoses that used to
produce identical output.

It names a **floor, not the whole corpus**, and should not be widened to name
everything — a list that long stops being read. The gate asks *is the worktree
viable at all*; whether a particular suite's fixture is present is asserted by
`requireFixture` at that suite's own consumption site, where the failure can name
the slug and say who wanted it.

#### Where those two halves come from, and why it changed

They used to be copied out of **the laptop's own** `data/` and `output/`, which
are gitignored. So the gate really asked *did whoever is deploying happen to have
run the pipeline here* — a question about a person, not about a commit — and it
could not pass in a fresh clone, on the remote box, or in a worktree.

They now come from the tracked corpus at `tests/fixtures/data-root/`, copied out
of **the gate's own worktree** rather than out of this tree, so a commit that
deleted a fixture cannot pass on the strength of the laptop still having one. The
sentinel list is `GATE_FIXTURES` in
[`scripts/deploy-checks.ts`](../../scripts/deploy-checks.ts), and the plan is
[260901b-committed-fixture-corpus.md](../plans/260901b-committed-fixture-corpus.md).
The interim coupling to the old filesystem-store layout is deliberately visible
in that path: underneath it sit a `data/` and an `output/` shaped exactly as the
store expects, so the gate can materialise both by copying. Still copied rather
than symlinked, because the tests create and delete directories underneath — a
link would point that at the committed fixtures.

#### What a fresh clone actually costs: 50, not 13

Two smaller numbers were in circulation and **both described something other than
a fresh clone**. The distinction is the whole point, because it is what made them
misleading:

| | |
|---|---|
| **13** failures, 202 cascade-skips | `data/` copied, **only `output/` missing** — one half of the store, not both. This is the figure quoted above and in `deploy.ts`. |
| **13** failures (a second time) | An experiment through `SPIDERYARN_DATA_ROOT`, which redirects the store *adapters* but not the many tests that compute `const ROOT = path.resolve(import.meta.dirname, "..")` themselves. So the run was **split-brain**: adapters saw an empty corpus while direct readers went on reading the full laptop `data/`. That the two 13s agreed was taken as corroboration and was not — [260901b](../plans/260901b-committed-fixture-corpus.md) has the post-mortem. |
| **50** failures | **Both halves absent**, measured 2026-09-01 by `npm run deploy -- --dry-run` in the gate's own clean worktree. This is the real fresh-clone state, and it supersedes both figures above. |

Fifty is therefore the number the corpus has to move, and re-running the dry-run
after a change to the corpus is a real measurement of whether it is complete
rather than merely present. That the earlier two agreed with each other, while
neither described the situation everyone thought it did, is
[silent-success.md](../reusable/silent-success.md) in one paragraph.

Two honesty limits remain, and they are limits rather than bugs:

- **`.env.local` is still linked from the laptop.** It is the only personal state
  the gate now depends on.
- **A bare `npm test` in an unprepared checkout is still not hermetic.** Only the
  gate materialises the corpus; the ~76 test files that compute their own
  `ROOT/data` path are deliberately left until stage 4 of the store migration
  gives them a durable target, rather than migrated twice.

One consequence of the old arrangement outlived it: `doc-links` will accept a
link into gitignored `output/`, which nobody else can follow.

This is also what closes the "article fixtures are not in git, so a fresh clone
cannot run the suite" entry under Known in
[hetzner-remote-server-box.md](hetzner-remote-server-box.md) — for the gate. The bare-`npm test` half of
that entry stays open until the sweep above happens.

### Reading the logs is a poll, not a question

The last step asks one thing: **is the line I know I caused here** — a
`/api/__deploy-smoke__/<deployment id>` request the script makes itself. Only once
that is found does the absence of errors beside it mean anything.

It used to ask exactly once, immediately after making the request, and Vercel's
log ingestion is slower than that — so a healthy deploy reported *"returned
nothing"*. It now retries at 0, 2, 5, 10, 20, 40, 70, 100 and 120 seconds,
accumulating rows across attempts so that an error seen early cannot vanish from a
later, narrower window. **That budget is an operator's patience, not a measured
p95**; the one observation behind it (absent at ~0s, present at ~90min) supports
no percentile at all, and measuring it properly needs dozens of samples with
timeouts recorded as censored observations.

Two things that made the old version worse than useless, both now separated:

- **A failed command is not an empty log.** The exit code was ignored and every
  unparseable line silently dropped, so a CLI that could not authenticate, a
  changed output format and a genuinely quiet app all arrived as "returned
  nothing".
- **A log-only failure cannot mean the code did not ship.** It runs *after* the
  push and after nine passing liveness checks. It used to print
  `SCHEMA ADVANCED; CODE MAY NOT HAVE` and offer a rollback anyway, because the
  exclusion list held one string literal that no longer matched the name being
  recorded. Rolling back for it would have been actively harmful — a rollback
  silently turns off production-domain auto-assignment.

### The build stamp

`dist/build.json` for the client and a `build` block on `/api/health` for the
function, both from [`scripts/build-stamp.ts`](../../scripts/build-stamp.ts).
Live, 2026-08-27:

```json
"build": { "commit": "718c1bf2…", "builtAt": "2026-08-27T17:34:06.662Z",
           "source": "VERCEL_GIT_COMMIT_SHA", "deploymentId": "dpl_G6pVxpaFN1AXj…" }
```

This is what [the env block section](#the-env-block-was-a-report-not-a-check)
said was "the real answer and is not built". Note that it is **beside** the
existing `commit` field rather than replacing it: that one is
`process.env.VERCEL_GIT_COMMIT_SHA` read when the request arrives, which says
what Vercel believes it deployed rather than what compiled. Keeping both means
the day they disagree is a day you hear about.

Two artefacts rather than one, because the failure worth catching is them
disagreeing: an older client bundle in front of a newer function is a page that
loads perfectly and calls an API that has moved. And a **deployment id** as well
as a commit, because a commit can be deployed twice and every commit-based check
passes over the wrong one of the two — it is also what makes an edge-cached
response detectable, since a cached copy carries the id of whichever deployment
made it. `VERCEL_DEPLOYMENT_ID` is available at build time; verified in
production rather than assumed.

`"unknown"` never matches, including itself, which is the load-bearing part.

### There are still two ways in, and they build different code

That is the whole thing to understand about the rest of this section.
`npm run deploy` drives the first of them.

### From git — a push to `main`

Since 2026-08-26 the project is connected to
[`spideryarn/reading2`](version-control.md), production branch `main`. **A push
to `main` builds and deploys to production**, with no command to run.

The build machine clones the repo, so what ships is **the commit** — nothing on
anybody's disk reaches it. That is the point of connecting it: a deploy stops
depending on whose working tree was current when somebody typed a command.

### From the working tree — `vercel deploy`

```
vercel deploy --prod --scope greg-detre
```

This uploads the working directory (minus
[`.vercelignore`](../../.vercelignore)), installs, builds, and prints a URL. It
is still here on purpose — it is how you ship something that is not committed
yet, which with the database work in flight is often what you want.

**It deploys your working tree, not a commit.** With several agents live in this
directory that is worth saying out loud: whatever is on disk is what ships,
including someone else's half-finished edit. Check `npm test` and
`npm run typecheck` before deploying and read whose errors they are.

### The two do not agree, and git is the one telling the truth

The first git-sourced deploy, 2026-08-26, **failed** — and the same code built
fine from the working tree, because the working tree had files in it that git
did not:

```
[MISSING_EXPORT] "readRaw" is not exported by "src/fetch.ts"       src/routes.ts:93
[MISSING_EXPORT] "normaliseUrl" is not exported by "src/ingest.ts"  src/routes.ts:94
```

`src/routes.ts` had been committed importing two exports whose *definitions* were
still sitting uncommitted in `src/fetch.ts` and `src/ingest.ts`. This is the
second time on this page: the earlier one was committed imports of two whole
files nobody had `git add`ed. Same cause, one level down — and it is precisely
what the [named-pathspec commit rule](version-control.md) costs you. Naming only
your own files is what keeps you from committing somebody else's half-finished
work, and it is also what lets you leave your own dependency behind.

**So a green `npm run build` on this laptop says nothing about whether `main`
builds.** Before pushing anything that adds a cross-file import, check that the
file you imported *from* has no uncommitted changes of yours left in it:

```
git status --short src/
```

Note that looking for *missing files* is not enough. That check passes here —
both files are committed, and it is an export inside them that is missing. The
only test that actually answers the question is a build of the committed tree,
which is now what a push gets you.

### "The repository couldn't be found" is usually not about the repository

Connecting the repo failed first time with:

```
The repository "reading2" couldn't be found. Make sure there are no typos
and that you have access to it.
```

Every word of which points at the repo, and none of it was the problem. The
Vercel **GitHub App** was installed on the `spideryarn` org with access to all
repositories, and Greg is an org admin — that side was fine. What was missing was
the *account-level* GitHub login connection on the Vercel side: `GET /v2/user`
reported `githubLogin: null`, and listing git namespaces returned GitHub's
`401 Bad credentials`.

Two different things, and Vercel needs both:

| | What it is | Where to fix it |
|---|---|---|
| GitHub **App** installation | the org granting Vercel access to repositories | GitHub org settings |
| GitHub **login connection** | your Vercel account knowing who you are on GitHub | `vercel.com/account/settings/authentication` |

Reconnecting the second one — one button, no consent screen, since the
authorization was already on file — made the repo visible immediately. So when
Vercel says it cannot see a repo, check `githubLogin` before you go looking at
permissions.

### The build is two passes, and the second one is the point

```
npm run build          # = build:client, then build:api
```

**One command since 2026-09-03**, and the reason it is one is that it used to be
two: the full recipe lived here and in `vercel.json` and nowhere a developer ran,
so `npm run build` on a laptop meant something narrower than `npm run build` on
Vercel. `npm run build:client` and `npm run build:api` are still there
separately for when you want one of them.

The first pass builds the client into `dist/`. The second compiles the API into
`api-dist/vercel.js`, and [vite.api.config.ts](../../vite.api.config.ts) explains
at length why it has to exist: Vercel compiles TypeScript under `api/` with this
repo's **TypeScript 7**, which its builder cannot drive, and then *reports
success and ships a function that fails on every request*. So `api/` holds one
hand-written JavaScript file — [`api/index.js`](../../api/index.js) — and the
real handler is [`src/vercel.ts`](../../src/vercel.ts), compiled by the same tool
that compiles the client.

This is the same shape as [linting.md](linting.md): TypeScript 7 removed the API
ESLint needed, and it removed the one Vercel's builder needs too.

### Everything that bundle imports at module scope is paid for by every request

`api/index.js` answers a request by `await import`ing the whole 3.5 MB
`api-dist/vercel.js`, and the server's own clock — every `GET /api/library 200
10ms` line you have ever read — starts **after** that. So a static import in any
of the ~200 modules that bundle reaches is initialised before the shelf's query
runs, whether or not the request could ever use it.

Measure it with `npm run build && npx tsx scripts/bench-cold-start.ts`, which
refuses rather than shrugs on a stale or missing bundle and prints the box's load
average beside the numbers. In production the two `component: "health"` lines
`cold start: module import` and `cold start: first request` report the same thing
once per instance ([`src/cold-start.ts`](../../src/cold-start.ts)); both exist
because moving work *inside* the handler improves the first number and not the
second.

Three packages are therefore reached only when something needs them, and the
seams are documented where they live: **jsdom** through
[`src/jsdom-lazy.ts`](../../src/jsdom-lazy.ts) (a synchronous `createRequire`,
because `splitIntoBlocks` and `sanitizeHtml` are synchronous and would otherwise
have to become async everywhere), **pdf-lib** inside `cutPages`, and the
**Stripe SDK** inside `stripeClient()`. That was ~940 ms off a ~2,400 ms module
import on a quiet box, measured paired against the previous build.
`tests/cold-start-lazy-imports.test.ts` fails if any of them goes back to module
scope, and `tests/pdf-bundle-trace.test.ts` asks the real Vercel tracer whether
they still *ship* — which is the half that is an outage if it is wrong.

**drizzle and Sentry stay at module scope on purpose.** The shelf's own query
goes through drizzle, and error reporting has to be up before the code that might
fail; they are the floor under this, not the next target.
docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md § Stage 4.

## Who can reach it

**Anybody with the address can read the app right now.** That is a deliberate
choice as of 2026-08-26, not an accident — but it was an accident first, and the
shape of the mistake is worth keeping.

**Vercel Authentication is on, set to "production deployment URLs and all
previews".** It works. Per-deployment URLs redirect to a Vercel login and only
Greg gets in:

```
spideryarn-123clvpp1-greg-detre.vercel.app   302 -> login    protected
spideryarn-greg-detre.vercel.app             200 -> the app  open
```

The trap is what Vercel counts as a *production domain*. On Pro those cannot be
covered by Vercel Authentication at all, and the auto-generated `.vercel.app`
addresses **are** production domains. So the setting reports itself as enabled,
and is, while the app is served to the world.

**Vercel generates two of them** — `<project>.vercel.app` *and*
`<project>-<team>.vercel.app`. Only the first was removed. This page then said
"removing the domain is what actually closed it", and that sentence was wrong
from the day it was written: `spideryarn-greg-detre.vercel.app` had been serving
the whole app the entire time. Verified 2026-08-26 with an unauthenticated
`curl` from outside — the check nobody had run, because the dashboard says
"Protected" and the per-deployment URL really does ask for a login. A textbook
[silent success](../reusable/silent-success.md): the obvious check shares its
assumption with the thing it is checking.

**Deleting it is not available either.** A `--prod` deploy regenerates it, and
Vercel staff have confirmed there is no way to stop the generated production
alias existing. The only lever is deployment-protection *scope*, and "All
Deployments" needs the **Advanced Deployment Protection** add-on — $150/month,
30-day minimum — on top of Pro.

So the options were: pay $150/month; stop deploying to production and use
protected preview deploys only; or accept it. Greg, 2026-08-26, chose to accept
it: there was no database attached yet, so there was nothing behind the URL to
leak, and the responses carry `x-robots-tag: noindex`.

**Both halves of that reassurance have since expired, on consecutive days.** The
database arrived on 2026-08-27, so there is now a real shelf behind the address —
the beta gate below is what stands in front of it, not the absence of anything to
steal. And the `noindex` is a property of the *address*, not of
the app: Vercel stamps it on generated `.vercel.app` addresses and does not stamp
it on a custom domain, so [the domain move](#the-domain) removed it without
touching a line of code. Measured the same day:

```
spideryarn-reading2-greg-detre.vercel.app   x-robots-tag: noindex
www.spideryarn.com                          (none)
```

There was no `robots.txt` to fall back on either, and the reason is the SPA
catch-all: every path that is not a real file returns `index.html`, so
`/robots.txt` answered `200 text/html`, which a crawler reads as *no such file*
rather than as a rule. A path returning 200 is the worst way to be missing.

Both are fixed. [`public/robots.txt`](../../public/robots.txt) is a real file, so
Vercel's filesystem check answers it before the rewrite ever runs, and
[`vercel.json`](../../vercel.json) adds `X-Robots-Tag: noindex, nofollow` to
every response. **Read the header as the backstop, not as reinforcement** — a
crawler that honours the `Disallow` never fetches a page and so never sees the
header. They cover different crawlers rather than the same one twice, and the
comment at the top of `robots.txt` says what to do if a URL ever needs
*de-listing* rather than merely not crawling.

### The one hole: two preview bots

Greg, 2026-08-30, on shared reading links: *"let's name those two preview bots"*.
`facebookexternalhit` and `Twitterbot` now have `Allow: /read/` groups of their
own. Without them a link pasted into WhatsApp, Messenger, Facebook or Instagram
shows a bare URL — those services fetch the page like any other crawler and were
obeying the blanket `Disallow`. Slack was already unfurling, because Slackbot
honours only rules that name it.

**A bot obeys exactly one group and inherits nothing from `*`**, so each named
group carries its own `Disallow: /` as well. A named group without one is not a
narrow hole, it is an open door, and in a diff it looks like the tidier version
of the file. `tests/public-read-rewrite.test.ts` pins both lines for both bots;
what it deliberately does not do is model how a crawler resolves them, because
the only honest check for that is pasting a link after a deploy and looking.

**This is permission to fetch, not permission to index.** `X-Robots-Tag` and the
`<meta name="robots">` are untouched and still say `noindex, nofollow` on
everything; neither of those two robots reads them for anything, because a card
is not a search result. Indexing public articles would be a different change and
a larger one — see [page-titles.md](page-titles.md).

**Still: do not treat this as private.** `robots.txt` is a request, the gate is
the enforcement, and the shell of the app is served to anybody who asks.

The real answer is [the beta gate](../plans/260825d-deploy-and-repo-move.md#the-beta-gate),
which is what the custom domain needs anyway — application-level auth, which no
plan tier can take away. **It is built**, in [`src/auth.ts`](../../src/auth.ts),
and it is what made [the domain move](#the-domain) safe to do: `www.spideryarn.com`
is a production domain, Pro cannot put SSO in front of one, and the gate does not
care. An unauthenticated `/api/library` on the real domain returns
`401 [auth-none]`.

**The rename moved the address, and there are three of them now.** Measured
2026-08-26, after the project became `spideryarn-reading2` and was connected to
git:

```
spideryarn-greg-detre.vercel.app                    200   the app — last good build, pre-rename
spideryarn-reading2-greg-detre.vercel.app           404   DEPLOYMENT_NOT_FOUND
spideryarn-reading2-git-main-greg-detre.vercel.app  200   "Deployment has failed"
```

The new-name aliases exist the moment you connect git, and they point at
whatever the production branch last produced — which so far is a failed build.
So the app is still answering on its **old** address, and will keep doing so
until `main` builds. Vercel does not guarantee a pre-rename generated URL keeps
working, so do not write this one down anywhere that matters.

The `-git-main-` one is a *branch* alias — connecting a repo adds one per
branch, and it will track `main` from now on.

## Environment variables

Set on the project, for `production` and `preview`. None of them lives in a file
here; [`.env.prod`](../../.env.example) is a record of what production needs and
is read by nothing.

| | |
|---|---|
| `SPIDERYARN_STORE=postgres` | which store serves reads. **Unset means `files`**, and on a host with no durable disk that is an empty shelf and a 200 |
| `DATABASE_URL` | **set on Production, 2026-08-27** — `/api/health` reports `store: postgres` and reads work. Supabase's **transaction** pooler, port 6543. See [database.md § Connecting to the remote](database.md#connecting-to-the-remote) for why that one and not the other two. **Production only, deliberately, as of 2026-08-27** — there is one remote database and no staging copy, so putting it on Preview would point every branch build at the real data. A preview therefore still has no database, and `SPIDERYARN_STORE=postgres` *is* set there, so a preview fails at the store rather than serving an empty shelf. That is the intended failure until somebody decides otherwise |
| `PGSSLROOTCERT=certs/supabase-ca.crt` | **required here, unlike locally** — see [the certificate](#the-certificate-moved-and-nothing-would-have-said-so) |
| `NODE_OPTIONS=--experimental-require-module` | see [require(ESM)](#the-runtime-has-requireesm-turned-off). **Set on Production and, since 2026-08-27, Preview.** It was Production-only until then (measured 2026-08-26), which meant a preview deployment used to check anything failed for a reason unrelated to whatever you were checking |
| `NODEJS_HELPERS=0` | see [the request body](#the-request-body) |
| `OPENROUTER_API_KEY` | **every paid call in the app**, since 2026-08-27 — the pipeline as well as explain, chat, search, PDF reading and embeddings. Without it nothing can be ingested at all. [ai-gateway.md](ai-gateway.md) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | the gate verifies tokens with these. `SUPABASE_ANON_KEY` is the legacy fallback and is what is set today |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | **set on Production, 2026-08-27 — and they are read at BUILD time**, which is the part to remember. Vite compiles them into the bundle, so setting them after a deploy changes nothing until the next build. Missing means [`src/web/lib/supabase.ts`](../../src/web/lib/supabase.ts) throws at module load and the site is a **blank page** — which is what `www.spideryarn.com` was for a few hours that day. **Set on Preview too, 2026-08-27** — until then a preview was a blank page for this reason and no other, which looks identical to a build that never ran. Note that Preview builds predating that setting keep the missing values baked in; only a new build picks them up. The values came from `.env.prod`, where the publishable key lives under the legacy name `SUPABASE_ANON_KEY` and its value is an `sb_publishable_…`. [auth.md](auth.md), [260826ae-auth-ui-and-production.md § The release fence](../plans/260826ae-auth-ui-and-production.md#the-release-fence) |
| `STRIPE_SECRET_KEY` | **set on Production, 2026-09-03** — the `sk_live_…` for `acct_1UBW3NLv4piDbwcb`, and it must be the **live** key here and nowhere else. A production deployment on `sk_test_…` takes test cards, writes `active` subscription rows and grants real quota, while every "is it set" check stays green; [`src/billing/stripe.ts`](../../src/billing/stripe.ts) refuses to construct a client in that state and `/api/health` warns. Absent is fine and means everybody is on the free tier. [billing.md](billing.md) |
| `STRIPE_WEBHOOK_SECRET` | **set on Production, 2026-09-03.** The signing secret of the **dashboard** webhook endpoint (`we_1UBXjMLv4piDbwcbrLUPudWD` → `/api/webhooks/stripe`), which is a different value from the one `stripe listen` mints locally — that is why this is not on the `gjd-remote push-env` allowlist. Unset refuses every delivery rather than skipping verification, deliberately: the alternative turns one missing variable into an endpoint that grants subscriptions to anyone who can POST JSON |
| `SPIDERYARN_BASE_URL` | **must stay unset here**, and it is listed so nobody adds it. It is where Stripe returns a reader to after Checkout or the Portal, and production reads no variable for that at all — `billingReturnOrigin()` ([`src/billing/checkout.ts`](../../src/billing/checkout.ts)) answers `PUBLIC_ORIGIN` before it looks. It exists for a **worktree's** dev server, which lands on 5274, 5275… and would otherwise send a test purchase back to somebody else's checkout |
| ~~`STRIPE_PRICE_*`~~ | **Gone, deliberately.** Tiers and their Stripe price ids live in the `billing_tiers` table since 2026-09-02, so they can be changed without a deploy and without pasting an id onto every machine. `npm run stripe:setup -- --prod --apply` reads the rows, makes Stripe match, and writes the id back — and `--prod` is how you reach production, because naming the target on the command line silently does not. [billing.md](billing.md#setting-it-up) |
| `SPIDERYARN_OWNER_ID` | the uuid in `auth.users` that rows are stamped with **when there is no signed-in reader** — the CLI and the pipeline. Inside a request the session user wins and this is ignored, and that ordering is load-bearing: were it the other way round, setting this here would have handed every signed-in stranger Greg's own shelf and every query would have matched. Unset in production is a thrown error rather than a default. [`src/owner.ts`](../../src/owner.ts), [auth.md](auth.md) |
| `LOG_LEVEL=info` | [logging.md](logging.md) |

**`ANTHROPIC_API_KEY` was a row in that table until 2026-08-31, described as "the pipeline stages".**
It stopped being that on 2026-08-27, when the pipeline moved to OpenRouter
([ai-gateway.md](ai-gateway.md)), and no deployment has wanted it since. It is not in the table, it
is not in `/api/health`'s `env` block, and setting it on Vercel does nothing at all. The one thing
left in the repo that reads it is an eval that runs on a laptop — the PDF bake-off's
`transport: "anthropic"` arms, whose whole question is Anthropic-direct versus OpenRouter
(`bakeoff-anthropic-transport` in [`src/spend-declarations.ts`](../../src/spend-declarations.ts)).

## `/api/health`, and why to look at it first

`GET /api/health` reports what the deployment **is**, rather than what we believe
we configured: which store is serving reads, whether TLS verifies the server,
what `req.url` looked like when it arrived, the Node version, the region, and
which environment variables are set — names only, never values.

It is deliberately hard to please. Anything in `warnings` makes it 503. An
earlier version returned 200 whenever nothing threw, which meant it went green
with the wrong store, with unverified TLS, and with an empty database — the three
things it exists to catch. A health check that passes when the deployment is
wrong is worse than none, because it is the thing you point at to argue nothing
is wrong. [silent-success.md](../reusable/silent-success.md).

### The env block was a report, not a check

**And on 2026-08-27 it did it again anyway**, in the one place nobody had looked: the list of
environment variables. `EXPECTED` was a flat list of names rendered to booleans, and *nothing ever
compared one of those booleans against anything*. So production served this, for a day:

```json
{ "ok": true, "warnings": [], "env": { "SUPABASE_SERVICE_ROLE_KEY": false } }
```

Healthy on line one; the fault printed in full four lines later. Both halves are in the same
response, and the endpoint had no opinion about the contradiction. A boolean nobody reads is not a
check — it is a report that looks like one, which is worse, because the `env` block is exactly what
you scroll to in order to reassure yourself.

Each entry now carries a `breaks` string, and a missing one whose `breaks` is set produces a warning
naming **what stops working** rather than merely which name is empty — the name is already visible
in `env`, so repeating it there would add nothing. What nobody could see was where the bytes were
going.

Not every variable is required, deliberately. `breaks: null` means one of two things:

- **Nothing needs it.** `LOG_LEVEL` has a default in [`src/log.ts`](../../src/log.ts).
- **Something else already says it better.** A missing `DATABASE_URL` is reported by the `ssl` block
  with its reason attached; a missing `PGSSLROOTCERT` surfaces as `TLS mode is …, not verified`,
  which is the truer statement, since the certificate can also be present and unused. And a missing
  `SPIDERYARN_STORE` never reaches this handler at all — [`src/store/index.ts`](../../src/store/index.ts)
  throws at *import* when a filesystem store is live in production, and this module imports it. The
  `STORE !== "postgres"` warning below is therefore a local-development signal, not a production one.

The rule, then: **warn here only about what nothing else notices.** Warning twice about one fault
teaches whoever reads the list to skim it, and then the next real line gets skimmed too — which is
how a `false` sat in this response for a day.

### Three ways the first version of that table still lied

GPT Sol reviewed it the same day and found it giving both false-green and false-red answers. Each is
worth knowing as a shape, because none of them is specific to this file:

- **A required *need* is not a required *name*.** It demanded `SUPABASE_ANON_KEY`, but
  [`src/auth.ts`](../../src/auth.ts) takes `SUPABASE_PUBLISHABLE_KEY ?? SUPABASE_ANON_KEY` — the
  fallback exists precisely so that rotating a key and deploying need not happen in the same minute.
  A deployment whose sign-in worked would have been failed by its own health check. Entries can now
  carry an `or`.
- **Presence is not correctness.** `NODEJS_HELPERS` has to be the exact string `0` — the table above
  says so, and the [request body](#the-request-body) section explains why. Set it to `1` and bodies
  arrive empty while every line here reads green. The first version dismissed it as "a platform flag
  no code in this repo reads", which is true and beside the point: the *platform* reads it. Entries
  can now carry a `valid`, and it is checked only when `VERCEL` is set, since the flag means nothing
  on a laptop.
- **A wrong consequence is worse than none**, because it sends you to the wrong file. The first
  version had `ANTHROPIC_API_KEY` gating "every model call the reader waits on". It does not — it is
  the *pipeline*, in the Anthropic SDK spelling. `OPENROUTER_API_KEY` is the one every reader-facing
  call goes through: explain, chat, search, PDF reading, embeddings.

Two further things it changed, both about what a check can honestly claim:

- `Boolean(process.env[name])` counted `" "` as configured — and so does `configured()` in
  `src/store/blobs.ts`, so a stray space in a dashboard field would have taken this green while every
  Supabase call failed on an invalid key. Values are trimmed now. It still cannot catch the literal
  strings `"undefined"` or `"false"`, which are a real shape of this mistake and which nothing here
  can tell from a secret.
- **`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are the weakest lines on the page and
  should be read as such.** [`src/web/lib/supabase.ts`](../../src/web/lib/supabase.ts) throws at
  module load without them — a blank reading view while every server-side line stays green — so they
  are worth checking. But they are compiled into the client bundle at *build* time, and what this
  endpoint sees is the current project setting. Add them and never redeploy, and it goes green over a
  blank page. Absent is conclusive; present is not. A build-stamped sentinel is the real answer and
  is not built.

The whole thing is written up in
[260827b-health-check-green-while-uploads-dead.md](../postmortems/260827b-health-check-green-while-uploads-dead.md) —
including the part that is not about this endpoint at all: four places in this codebase ask "am I in
production with a development-only fallback?", three of them refuse, and the fourth is the one that
writes the bytes. One of the three shipped in the *same commit* as the fourth.

### And one that was never about the environment

The store check is cached so that an anonymous flood costs one query per window. It was written
*after* the `await`, so a hundred requests arriving **together** on a cold cache all missed, all ran
the expensive query, and all set the cache. The test that vouched for it awaited three requests one
after another — the single arrival pattern that cannot show the bug. The in-flight promise is shared
now, and the test fires twenty-five at once against a query that does not resolve until they have
all arrived.

## The five that fail quietly

Each reported success while being wrong. The first four were found on 2026-08-26
by the deployment itself and are written up in
[260826g-first-vercel-deploy-silent-failures.md](../postmortems/260826g-first-vercel-deploy-silent-failures.md);
the fifth was found in review before it could bite, which is the only reason it
is not in there too.

### The build compiles TypeScript it cannot compile

`error TS2688: Cannot find type definition file for 'node'` appears in the build
log, and then the build **succeeds** and uploads a function that answers
`FUNCTION_INVOCATION_FAILED` on every request, with the reason in no log at all.
Fixed structurally — there is no TypeScript under `api/` for it to find. If you
ever add a `.ts` file there, this comes back.

### `[...path]` is not a catch-all

Vercel's filesystem routing treats **every** bracketed filename as one segment;
the `...` is a Next.js convention and is not honoured here. Measured:

```
/api/library         -> reached the function
/api/article/writes  -> 404 NOT_FOUND, from the platform
/api/jobs/abc/retry  -> 404 NOT_FOUND, from the platform
```

That is nearly every route in [`src/routes.ts`](../../src/routes.ts), failing
before any of our code runs and therefore appearing in no log we write. The
catch-all is an explicit rewrite in [`vercel.json`](../../vercel.json) instead,
carrying the real path in `__spy_path`, and `originalUrl` in
[`src/vercel.ts`](../../src/vercel.ts) puts `req.url` back together before
anything routes on it. [`tests/vercel-url.test.ts`](../../tests/vercel-url.test.ts)
pins the two nasty cases: a second `__spy_path` supplied by the client, and the
decode that has to happen **exactly once** because Vercel encodes exactly once.

### The runtime has `require(ESM)` turned off

`jsdom` → `html-encoding-sniffer` (CommonJS) → `@exodus/bytes` (ESM) throws
`ERR_REQUIRE_ESM` in the deployed function and **works on every Node we could
test locally**, 22, 24 and 26 alike. So the difference is Vercel's runtime, not
the code, and nothing on a laptop will ever reproduce it.
`NODE_OPTIONS=--experimental-require-module` turns it back on.

It was findable only because [`api/index.js`](../../api/index.js) imports the
compiled handler *inside* the request handler rather than at module level. A
module-level import that throws takes the function down before anything of ours
runs; inside a `try`, the same failure answers with a stack you can read. Keep it
that way.

### The certificate moved, and nothing would have said so

[`src/db/ssl.ts`](../../src/db/ssl.ts) finds the CA certificate by walking up
from `src/db/`. In production that file is **bundled**, so `import.meta.dirname`
is the bundle's directory and the walk lands somewhere else — which does not
error. It degrades to `encrypted-unverified`: still encrypted, no longer checking
who it is talking to, and identical from the outside. Hence `PGSSLROOTCERT` is
set explicitly, which makes a missing certificate throw instead, and hence
`/api/health` reports the mode.

There is a second way to lose the same guarantee, found by GPT Sol in review:
`pg` **discards** an explicit `ssl` object if the connection string carries
`sslmode`, `sslrootcert`, `sslcert` or `sslkey`. The CA is then loaded, reported
as verified, and not used. `/api/health` warns when `DATABASE_URL` carries any of
them; keep them out of it.

### The request body

`readBody` in [`src/routes.ts`](../../src/routes.ts) consumes the raw request
stream with `for await (const chunk of req)`. Vercel's request helpers read that
stream **first** and replay it through `req.on("data")` — not through the async
iterator — so with helpers on, every `POST` body arrives **empty**. Nothing
errors: each route reports a missing field, as though the client had sent a bad
request. `NODEJS_HELPERS=0` turns the helpers off and hands the function the raw
Node request, which is the shape `handleApi` was written against anyway.

Found by GPT Sol in review, 2026-08-26, from Vercel's own source rather than its
documentation.

**`POST /api/health` is how you check it is still true**, after a platform change
or a runtime bump:

```
curl -X POST .../api/health -d '{"hello":"world"}'
```

It reports `bytes`, and it counts them with the *same* `for await` loop
`readBody` uses. A check that reads the body a different way from the code it is
vouching for can pass while the real path fails. `bytes: 0` against a request
that had one means something read it first.

### The `sources` bucket has to exist on the remote too

Uploading a PDF (2026-08-27) puts bytes in Supabase Storage, in a bucket called `sources`.
[`supabase/config.toml`](../../supabase/config.toml) declares it, and **that only creates it
locally** — a remote project needs `supabase seed buckets --project-ref <ref>`, or the equivalent
insert into `storage.buckets`.

**And declaring it does not update one that already exists — anywhere, including locally.** Nothing
in this repo applies the block below to a bucket that is already there, so editing it is not a
change to any running system. Adding `text/html` on 2026-08-27 left the local bucket PDF-only for
seven hours, during which every HTML fetch threw a 415 that nobody saw. Read
[260828a-the-config-file-is-not-the-bucket.md](../postmortems/260828a-the-config-file-is-not-the-bucket.md) before
changing a bucket setting, or before trusting one.

**`npx tsx scripts/check-buckets.ts` is what says whether they still agree.** Read-only, one
`GET /storage/v1/bucket`, non-zero when they differ, and pointing it at production is the intended
use. It does not repair the drift: widening an allowlist is a security decision, not a side effect
of running a check.

> **It exists on the remote as of 2026-08-27**, and it did not until then: `GET /storage/v1/bucket`
> on the production project returned `[]`, an empty list, on the day this paragraph had been warning
> about it for hours. Created with the REST API rather than the CLI, which needs no access token and
> takes the settings straight from the block below:
>
> ```bash
> curl -X POST "$SUPABASE_URL/storage/v1/bucket" \
>   -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
>   -d '{"id":"sources","name":"sources","public":false,"file_size_limit":52428800,
>        "allowed_mime_types":["application/pdf","text/html"]}'
> ```
>
> Found exactly the way the paragraph below predicts — by dropping a file at the live site and
> watching the reader's own error message, `Storage sign failed (404): The related resource does not
> exist`. Nothing before that point knew. **The check is one command and it is worth running after
> any project change**, because an empty list is what a working configuration also looks like until
> somebody uploads something:
>
> ```bash
> curl -s "$SUPABASE_URL/storage/v1/bucket" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
> ```

This is on the "fails quietly" list rather than beside it because of *how* it fails: nothing checks
for the bucket at boot. `POST /api/uploads` mints a grant against a path in a bucket that is not
there, the browser gets a signed URL that looks perfectly good, and the `PUT` is what discovers it.
The reader sees an upload failure on a file that is fine.

The other half of the same setting: `SUPABASE_SERVICE_ROLE_KEY` must be present in the deployed
environment, because minting a grant is server-only by construction — the anon key gets
`403 Unauthorized: new row violates row-level security policy`, which is the right answer. Without
the key, `uploadGrants()` returns `null` and `POST /api/uploads` answers 503 saying uploading is not
switched on, which is at least honest.

**And on 2026-08-27 it was found never to have been set at all** — `vercel env ls production` did not
list it, while the value sat in `.env.prod` the whole time. This paragraph had said to set it since
the day uploads landed. Writing the requirement down is not the same as checking it, which is the
entire lesson.

The reason a day went by is the *quieter* half, which the paragraph above misses.
`SUPABASE_SERVICE_ROLE_KEY` gates **two** functions in
[`src/store/blobs.ts`](../../src/store/blobs.ts), through one `configured()`, and only one of them
is honest about losing it:

| Without the key | What happens | Does anyone find out? |
|---|---|---|
| `uploadGrants()` | returns `null`, `POST /api/uploads` → 503 | **Yes.** A reader gets an error and can report it |
| `blobStore()` | falls back to `fsBlobs()` | **No.** Raw source bytes are written to a serverless filesystem that does not outlive the request. Nothing logs, nothing throws, the write returns success |

The fallback itself is right and should stay — a laptop with no Supabase container is a real case,
and the function comment says so. What was missing is any signal that it happened *in an environment
where it is wrong*. That is now [`/api/health`'s](#apihealth-and-why-to-look-at-it-first) job, below.

## What does not work in production yet

Reading an article, the shelf, comments, **chat and meaning-search** all come
from Postgres now — the last two since step 10 landed on 2026-08-26. What still
writes to a local filesystem, which a serverless host does not have:

- **adding an article** — **fixed on 2026-08-30, and everything below it is the
  history of a wall that is no longer there.** An article pasted at the live site
  is fetched, extracted, split, given its hierarchy, published and readable. Production
  `a63a5592`; the plan is
  [260830d-v1-imports-on-vercel.md](../plans/260830d-v1-imports-on-vercel.md).

  Three things made it work, and none of them was the storage rewrite this
  section spent three days pointing at. The root became explicit and **scoped to
  one job** rather than derived from a bundled module's location; **one claim
  walks the whole job** in one invocation, so the steps share a scratch directory
  instead of each landing on a different disk; and a decorator on the session
  copies what the stages wrote into a draft and **publishes it in the same
  transaction that finishes the job** — because until then a job could go `done`
  having published nothing at all, which nothing in this file had noticed.

  **What is still broken, stated plainly:** re-running one step against an
  existing article. A `{steps:["arc"]}` job gets its own job id and therefore its
  own empty scratch, and cannot see what the ingest wrote — so opening an article
  that has no arc fails with the same `ENOENT` one directory deeper. The article
  reads fine without it.

  The rest of this entry is kept because the diagnosis took four wrong answers to
  reach, and each wrong answer is written below in the order it was believed.

- *(historical)* the queue assumes one long-lived process.

  **Confirmed on the live site, 2026-08-27**, and worth recording as the exact
  string somebody will one day search for. Everything in front of the pipeline
  now works: a dropped PDF mints a grant, `PUT`s to Storage, queues a job, and
  the ingest page draws its five steps. Then step 1 says

      ENOENT: no such file or directory, mkdir '/var/data'

  because the stages still write `data/<slug>/` directly and Vercel has no
  writable disk. Nothing is wrong with the upload half — it got all the way to
  the wall. The wall is [260827j-transactional-stage-runner.md](../plans/260827j-transactional-stage-runner.md),
  and [database.md § Writes do not](database.md) is the same fact from the
  storage side

  **It is not the upload path, and it is not PDFs.** Greg pasted an ordinary
  HTML article URL on 2026-08-28 and got the same string from step `fetch`. The
  same wall stops every URL and every document; stages 1 and 2 run fine on that
  article locally, so nothing about the *content* is involved. `/var/data` comes
  from [`artifacts-fs.ts`](../../src/store/artifacts-fs.ts)'s
  `path.resolve(import.meta.dirname, "..", "..")` — on a laptop that is the repo
  root, and in a bundle at `/var/task/api-dist/vercel.js` it is `/var`. It
  therefore cannot fail on anybody's machine.

  **`/tmp` is not the shortcut it looks like**, and this is written down because
  it is the first idea everybody has. `/tmp` *is* writable on Vercel, but
  `advanceJob` runs **one step per HTTP request**, so step 2 is a different
  invocation and finds nothing — and on a warm instance it would sometimes find
  a *stale* file and skip real work. GPT Sol's review of the whole question,
  with the interim options and why each is refused, is in
  [260828at-html-ingest-var-data-sol.md](../plans/260828at-html-ingest-var-data-sol.md). It also
  names one thing the storage fix does not cover: `articleExists` and
  `urlForSlug` read `data/<slug>/meta.json`
  ([`pipeline.ts`](../../src/pipeline.ts)) on the live enqueue path, so once
  ingest works, a Postgres article with no local file reads as a free slug.

  **How to find this class of failure yourself** — the route answers `200` and
  Vercel's error dashboard stays empty, so the recipe matters:
  [logging.md § where to look](logging.md#where-to-look-when-production-breaks)
- **`deleteGlossary`** — **fixed 2026-09-03.** It was refused by `notMigrated` in
  [`src/store/index.ts`](../../src/store/index.ts) on the belief that mutating a
  *published* revision was an open decision. It was not open — nothing else
  mutates a published revision in place; every job drafts and publishes, per
  [database.md](database.md) — and the delete is now the one deliberate
  exception, built in
  [260903e-glossary-delete-in-postgres.md](../plans/260903e-glossary-delete-in-postgres.md).
  It also answers **409** when a live queued or running job holds a draft for
  the article, so the reader is told to wait for the job and press the button
  again rather than the delete racing that job's publish.

Greg, 2026-08-26, chose to ship with these broken rather than wait for them.

**Chat and meaning-search were the dangerous pair, and it is worth knowing why
the danger did not show up here.** Until that day they did not check
`SPIDERYARN_STORE` at all — they called `node:fs/promises` unconditionally, so
what stopped them in production was the host refusing the write rather than the
app refusing to try. That is fine here and was quietly wrong everywhere else: on
a laptop running `SPIDERYARN_STORE=postgres` there is a writable disk, and the
same two calls **succeeded, reported success, and landed in a store every
Postgres read ignores** — the outcome `src/store/index.ts` calls the worst
available. A read-only disk is not a guard; it just happened to be standing in
the same doorway. `tests/store-writes-land-in-postgres.test.ts` is the guard, and
it asserts no file appears rather than trusting the host to make one impossible.

## What the reader sees when the server fails

Worth knowing because the first deployment demonstrated it: while every API route
was returning Vercel's plain-text 500, the homepage rendered

    Unexpected token 'A', "A server e"... is not valid JSON

and logged **nothing** to the browser console. Twelve call sites had each written
`await r.json()` *before* checking `r.ok`, so the parser threw first and the line
that turns a server error into a readable message never ran.

That is fixed in [`src/web/lib/api.ts`](../../src/web/lib/api.ts), which every
client `fetch` now reads its response through — see
[web-client.md § Reading an API response](web-client.md#reading-an-api-response).
It matters here rather than only there: when this deployment breaks, what the
reader is told about it is the only symptom most people will ever report.

## Still to do before this is a real deployment

0. ~~**Get `main` building**~~ — green on 2026-08-27, commit `6e0d62f`.

   **It broke the same way a third time first, and that is the point of this
   entry.** The push that was meant to fix the blank page failed on
   `[UNRESOLVED_IMPORT] Could not resolve './LandingPage.js'` and `'./perf.js'` —
   `src/web/App.tsx` had been committed importing two modules still sitting
   untracked on somebody's disk. Same cause as both earlier times: see
   [the two do not agree](#the-two-do-not-agree-and-git-is-the-one-telling-the-truth).
   It went green once those two files were committed, with nothing else changed.

   Three times is a pattern rather than an accident, and the
   [named-pathspec commit rule](version-control.md) is what causes it — naming
   only your own files is exactly what lets you leave your own dependency
   behind. The cheap habit that would catch it: after committing, ask git what
   the *commit* contains rather than what your disk does.
1. ~~**The database.**~~ **Done, 2026-08-26.** Schema applied to
   `alschkahzfagtppxspfq`: 14 migrations, 14 tables, `spideryarn_app` granted and
   verified, `spideryarn` confirmed invisible to the Data API by a real anonymous
   request. [database.md § Roles](database.md#roles) records what was actually run,
   which is **not** what that section used to say — the migration role the plan
   called for cannot be granted `REFERENCES` on `auth.users`, and the grant that
   was supposed to do it is a silent no-op.
2. ~~**An owner in `auth.users`**~~ — `greg@gregdetre.com` →
   `001bb7a0-7720-4f1b-8b9d-1ee6e63d132a`, and `SPIDERYARN_OWNER_ID` is set to it on
   Production and Preview. **It is no longer what decides whose rows a request touches**
   — inside an API request the signed-in user wins and the environment gets no vote, which
   is the whole of [the ownership work](auth.md#whose-data-is-it). This variable now only
   answers for the CLI, the pipeline and anything else with nobody to ask.
   [`src/owner.ts`](../../src/owner.ts).
3. ~~**`DATABASE_URL`**~~ — set on Vercel production 2026-08-27, transaction
   pooler, no `ssl*` parameters, verified by connecting with the exact value
   Vercel holds. `SPIDERYARN_OWNER_ID` too; the rest were already there.
4. ~~**Import the articles**~~ — done 2026-08-27. Five articles, 635 blocks, 24
   comments, 56 chat messages, and reads verified through the store seam over the
   transaction pooler. `ball-lightning` and `coolabah-memory` have no
   `blocks.json`/`tree.json` yet, so the importer correctly skipped them.
5. ~~**[The beta gate](../plans/260825d-deploy-and-repo-move.md#the-beta-gate)**~~ — built,
   [`src/auth.ts`](../../src/auth.ts), enforcing on the live domain. It is what made
   a stable URL possible, and [the domain move](#the-domain) followed it the same
   day.

## It is up, and here is the reading of it

**2026-08-27, commit `bfe3a77`.** `/api/health` on the production alias:

```json
{ "ok": true, "warnings": [], "node": "v24.18.0", "region": "lhr1",
  "store": { "name": "postgres", "articles": 5 },
  "ssl": { "mode": "verified", "why": "verified against certs/supabase-ca.crt" } }
```

Three things that reading tells you which a `Ready` status does not: reads are coming from Postgres
rather than an empty disk, the server's certificate is being *checked* rather than merely encrypted
against, and the commit is the one you think it is.

**And one thing it does not tell you, learned later the same day: whether the page renders.**
`/api/health` is served by the API; the reading view is a separate bundle, and it was throwing at
module load while every line above stayed green — see [auth.md](auth.md). A healthy `/api/health` and
a blank site are perfectly compatible. **Load it in a browser.**

**On the domain, 2026-08-27, commit `6e0d62f`:**

```
spideryarn.com      308 -> https://www.spideryarn.com/
www.spideryarn.com  200   commit 6e0d62f, postgres, 5 articles, lhr1
/api/library        401 … [auth-none]
/robots.txt         200 text/plain          Disallow: /
x-robots-tag        noindex, nofollow
```

The apex `308` is deliberate rather than the default: it was `307` (Vercel's default when
`redirectStatusCode` is `null`) until GPT Sol pointed out that apex→www is a permanent canonical
relationship whatever app happens to own it, and that relying on an undocumented default is a second
reason not to. `PATCH /v9/projects/<project>/domains/<domain>` sets it.

Getting there needed one fix, and it is the best example this repo has of why `Ready` means nothing.
The first successful build in seven hours returned `500` to every request, because
[`src/pdf.ts`](../../src/pdf.ts) imported pdf.js at module scope and Vercel's tracer had left
pdf.js's own optional native dependency out of the bundle — so *loading* the API threw
`DOMMatrix is not defined`, on every route, PDF or not, and never on a laptop.
[260827a-pdfjs-dommatrix-serverless.md](../postmortems/260827a-pdfjs-dommatrix-serverless.md).

**The API routes are gated and `/api/health` is not.** An unauthenticated request to `/api/library`
returns `401 You need to be signed in to do that. [auth-none]`; the health endpoint answers anybody,
which is what a health endpoint is for. It reports environment variable *names* only. Note the
production hostname cannot be SSO-protected on the Pro plan, so the gate in
[`src/auth.ts`](../../src/auth.ts) is the thing standing between a stranger and the shelf — not
Vercel.

## See also

- [260825d-deploy-and-repo-move.md](../plans/260825d-deploy-and-repo-move.md) — the plan, the
  domain move, and the beta gate
- [database.md](database.md) — the roles, the three hosts, and the enforced SSL
- [architecture.md](architecture.md) — the single-process assumption this runs into
- [debugging.md](debugging.md) — start here when something is broken: which of the
  three places to look, and in what order
- [vercel-hosting-deployment.md](vercel-hosting-deployment.md) — the other half of
  this page: how to *inspect* what is running, and why the error dashboard was
  empty through an outage
- [sentry-error-monitoring.md](sentry-error-monitoring.md) — the 30-day half, past
  Vercel's one day
- [logging.md](logging.md) — why the lines are shaped the way they are
- [silent-success.md](../reusable/silent-success.md) — the pattern every failure
  on this page is an instance of
