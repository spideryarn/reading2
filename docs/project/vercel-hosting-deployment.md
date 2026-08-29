# Vercel hosting: reading what the platform knows

**This doc is the platform side — how to *inspect* what is running.** Its twin is
[deployment.md](deployment.md), which is the *process* side: the domain, the build, the env
variables, what is broken in production today, and the history of how each of those was got wrong.
Nothing is repeated between them; when you want a fact about deploying rather than about looking,
it is over there.

> This exists because on 2026-08-28 every ingest on the live site had been failing for hours, the
> Vercel error dashboard was empty, and the way we found out was Greg trying to read an article.
> Twenty minutes went into learning which query to run. That is what is written down here.

Start at [debugging.md](debugging.md) if you do not yet know which of the three places to look.

## The ids, and where they come from

Everything below needs a project id and a team id. Both are in `.vercel/project.json` — `projectId`,
and `orgId` is the team. That file is gitignored and appears when you link the project, so it is not
a link: a fresh clone does not have it, and the values are written out here for that reason.

    projectId  prj_I739wqovZ54zt2oTBbZjPIke4IEY      (project "spideryarn-reading2")
    orgId      team_Xu0cDrurD3h6PIeMZblXJEIL

The live site is `www.spideryarn.com`; the apex redirects to it. There is exactly one project.

## Look at `/api/health` first

One `curl`, no auth, and it rules out the whole class of "a variable was never set" — the most
common cause here and the least interesting:

```bash
curl -sL https://www.spideryarn.com/api/health
```

**Read `build.commit` before anything else.** More than once the answer has been that the deployment
is not the code you are reading. It also returns the store name and article count, a schema check,
and a present/absent list for the environment variables it knows about. What it will *not* tell you
is whether error monitoring is alive — see
[sentry-error-monitoring.md § the health check cannot see it](sentry-error-monitoring.md#the-health-check-cannot-see-it).

The field-by-field reading of that response, and the five failures it was built to catch, are in
[deployment.md § `/api/health`](deployment.md#apihealth-and-why-to-look-at-it-first).

## Runtime logs

Prefer the **Vercel MCP tools** to the CLI. Two calls matter.

### The trap: `get_runtime_errors` will not show you an application failure

It reports **uncaught** errors — the ones that became a 5xx. Anything the app caught and handled is
invisible to it.

That is not a corner case here. A failed ingest step is caught, recorded on the job, and answered
with **HTTP 200** — deliberately, and
[sentry-error-monitoring.md § why a failed step is a 200](sentry-error-monitoring.md#why-a-failed-step-is-a-200)
has the argument. So on 2026-08-28 the errors dashboard listed one `DOMMatrix` cluster from two days
earlier and nothing else, while every ingest on the site was dying at step 1.

**Use it to rule things in, never to rule them out.**

### Searching the logs, which is where handled failures actually are

```
get_runtime_logs  projectId, teamId, deploymentId, query: "ENOENT", since: "6h"
```

Three things, each learned by getting it wrong first:

- **Scope it to a `deploymentId`, or it times out** and returns *no logs* — which reads exactly like
  finding nothing. Take the id from `/api/health`'s `build.deploymentId`, or from
  `list_deployments`. `group_by: "requestPath"` is the other fast shape and is the quickest way to
  see which routes were touched at all.
- **`query` does reach inside our JSON.** Settled on a real deployment, 2026-08-28: searching
  `ENOENT` matched lines carrying that string only inside a nested `err` object, nowhere in the
  message or the path. Vercel's own two docs pages disagree about this; the pessimistic one is
  wrong, at least for `query`.
- **Never filter by `level`.** Settled the same day, and it went the other way: filtering
  `level: ["error","warning"]` returned *no logs* over a window containing two lines whose body reads
  `"level":"error"`. Vercel had tagged both `[info/serverless]`, because everything Pino writes goes
  to stdout and Vercel classifies the *stream*, not our JSON. Grep `"level":"error"` as a **string**.

That last one is the dangerous one: it answers a real outage with silence, and silence reads as
health. Why our lines look like that at all is
[logging.md § two traps](logging.md#two-traps-worth-knowing-before-they-bite).

### Retention is one day

Long enough for "I deployed and something is wrong". Useless for "a reader hit a bug on Tuesday" —
that is what [sentry-error-monitoring.md](sentry-error-monitoring.md) is for, at 30 days.
Observability Plus would raise it to 30 and has not been bought. The per-request line and byte
limits, and the logging rule they imply, are in [logging.md § Vercel](logging.md#vercel).

## Environment variables

The one thing the CLI does better than the MCP:

```bash
npx vercel env ls production      # names and dates only; values stay encrypted
```

Use it to answer "is this variable set?" — a question that has twice been the whole bug, once for
`SUPABASE_SERVICE_ROLE_KEY` and once for a Sentry DSN nobody had checked. Which variables are
required, and which of them fail *quietly* when missing, is
[deployment.md § Environment variables](deployment.md#environment-variables).

## The CLI is a fallback, and its version matters

`npx vercel` resolves to an old pin in this repo — **48.6.0** as of 2026-08-28. v48 can only *tail*:
roughly five minutes, no history, and it frequently captures nothing at all, which once again looks
like "no errors". If you must use it, use a current one (v59+ has history), request
`www.spideryarn.com` rather than the apex, and wrap it in `timeout`.

## Fluid Compute, and the one thing it breaks

One instance serves several requests concurrently, so **there is no "current request" at module
scope**. A module-level logger would attribute lines to the wrong article, intermittently. The rule
is a child logger passed down — [logging.md § Fluid Compute](logging.md#fluid-compute-keep-the-logger-stateless).

It also means **no instance affinity between requests**. Warm-instance reuse is an optimisation, not
durable state, which is why writing an artefact to `/tmp` in one step and reading it in the next
does not work — [deployment.md § What does not work in production yet](deployment.md#what-does-not-work-in-production-yet).

## Related docs

- [debugging.md](debugging.md) — the front door: which of the three places answers your question
- [deployment.md](deployment.md) — the deploy process, the domain, env vars, and what is broken today
- [sentry-error-monitoring.md](sentry-error-monitoring.md) — the 30-day half, and what reaches it
- [logging.md](logging.md) — why the lines are shaped the way they are, and what is never logged
- [database.md](database.md) — Supabase's own logs, which Vercel never sees

---

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md)
