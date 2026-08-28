# Debugging: which place answers your question

A signposting doc. Nothing is explained here that is explained somewhere else — the point is to stop
you searching the wrong place, which is where the time actually goes.

## Something is wrong in production

Three places, and they answer different questions:

```
  /api/health     is the deployment even wired up right?      right now
  Vercel logs     what happened during that request           1 day
  Sentry          something threw while nobody was watching   30 days
```

**Go in that order.** `curl -sL https://www.spideryarn.com/api/health` is one command and rules out
the commonest and dullest cause — a variable that was never set — and tells you *which commit* is
actually running, which has been the answer more than once.

- **[vercel-hosting-deployment.md](vercel-hosting-deployment.md)** — the ids, the two log calls, and
  the three traps. The one worth knowing before you need it: **the Vercel error dashboard does not
  show application failures**, because anything the app caught was answered with a 200. It was empty
  through an outage. Also: never filter logs by `level`, and always scope a log query to a
  deployment or it times out and returns nothing.
- **[sentry-error-monitoring.md](sentry-error-monitoring.md)** — it *is* installed and it *is* on,
  whatever a quick grep suggests. What reaches it, and the two gaps: nothing alerts, and
  `/api/health` cannot tell you whether it is alive.
- **[deployment.md](deployment.md)** — the deploy process itself, and **what is known to be broken
  in production today**. Check here before debugging something already written down.

## Something is wrong on my laptop

- **[setup-dev.md](setup-dev.md)** — the variables without which you get a blank page.
- **[supabase-local.md](supabase-local.md)** — the Docker stack, and the five ways it fails quietly.
- **[database.md](database.md)** — and read the `Target:` line, not the success line: which database
  a command reaches is not always the one on its command line.
- **[logging.md](logging.md)** — `npm run dev:pretty` for readable output.

## Something is wrong in the browser

- **[browser-testing.md](browser-testing.md)** — drive it from a subagent, and the several ways a
  page can look broken while being fine (a hidden tab does not animate, and `rAF` does not run).
- **[web-client.md](web-client.md)** — how a server error becomes a message a reader can read.

## A test is failing, or is not

- **[testing.md](testing.md)** · **[typechecking.md](typechecking.md)** ·
  **[code-quality-overview.md](code-quality-overview.md)** — which commands are gates.
- **[silent-success.md](../reusable/silent-success.md)** — read this one. Most of a day's bugs here
  have been something reporting success while doing nothing, with the obvious check agreeing because
  it shares an assumption with the code. **A check you have never seen fail is not evidence.**

## When you have found it

Root-cause it and write it up under [`docs/postmortems/`](../postmortems/) — the real cause rather
than the line that broke, the commit that introduced it, the fix that is right long-term, and what
would have caught the whole class. Several of the traps signposted above are there because somebody
did.

---

Up: [dev-and-deployment-overview.md](dev-and-deployment-overview.md)
