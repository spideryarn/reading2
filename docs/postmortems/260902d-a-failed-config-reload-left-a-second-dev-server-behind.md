# A failed config reload left a second dev server behind

**Found 2026-09-02**, in the primary checkout. One `npm run dev` process (PID 1959837, started
2026-09-01 22:13) was holding **eleven** listening sockets — `[::1]:5273` through `[::1]:5283`, every
one of them a live, fully-working dev server answering `200` on `/` and `401` on `/api/jobs`. The
count had grown from 7 to 11 over the course of an afternoon, in steps, at moments nobody could
name.

Ports 5273–5303 are the whole dev range ([`scripts/worktree-port.ts`](../../scripts/worktree-port.ts),
`DEV_PORT_RANGE`) and the exact set allow-listed for sign-in redirects in
[`supabase/config.toml`](../../supabase/config.toml). One process had squatted eleven of the
thirty-one.

## What broke

**A `configureServer` hook that throws during a restart leaks a whole second dev server**, watcher
and all — and each leaked server later grabs its own port.

Vite reloads the server whenever [`vite.config.ts`](../../vite.config.ts) or anything it imports
changes. In a tree a dozen agents share, that is constant: this one process logged **492**
restart triggers and 193+ completed restarts in eighteen hours.

`restartServer` (`node_modules/vite/dist/node/chunks/node.js:26812`, vite 8.2.2) is:

```js
let newServer = null;
try {
  newServer = await _createServer(inlineConfig, { listen: false, ... });
} catch (err) {
  server.config.logger.error(err.message, { timestamp: true });
  server.config.logger.error("server restart failed", { timestamp: true });
  return;                       // ← nothing is cleaned up
}
await server.close();
Object.assign(server, newServer);
...
if (!middlewareMode) await server.listen(port, true);
```

And inside `_createServer`, the order is the whole bug:

| line | what happens |
|---|---|
| ~26410 | the chokidar `watcher` is created |
| **26608** | `watcher.on("change", …)` is wired to `handleHMRUpdate(…, server)` — closing over the **half-built** server object |
| **26631** | `for (const hook of …("configureServer")) await hook(…)` — *our* hook runs here, 23 lines later |

So when `createApiMiddleware()` throws, `_createServer` rejects **after** the new server's file
watcher is live and already wired to restart-on-config-change. `restartServer` catches, logs, and
returns. It cannot close the half-built server, because the promise it was going to arrive on
rejected. Nothing else holds a reference to it — except its own chokidar watcher, which keeps it
alive and *active* for the life of the process.

From that moment there are **two independent restart chains** in one process. Each has its own
watcher, its own module graph, its own middleware stack, its own API instance. The next config
change fires both. The first one closes and rebinds 5273; the second finds 5273 taken and — because
this config deliberately does **not** set `strictPort` — walks up to 5274 and binds it.

The staircase in the log is exactly that walk:

```
     10 Port 5273 is in use
      9 Port 5274 is in use
      8 Port 5275 is in use
      ...
      1 Port 5282 is in use
```

Ten chains scanning up from 5273, each stepping over everything the chains ahead of it had already
claimed.

## Reproduced in an isolated project, in twenty lines of log

A throwaway Vite 8.2.2 project, one plugin, one `configureServer` that throws iff a marker file
exists. Touch the config to force a restart; count the process's listening sockets.

```
baseline                       1 listener
after 1 good restart           1 listener      ← good restarts leak nothing
after 2 good restarts          1 listener
after a FAILING restart        1 listener      ← still 1; the orphan has not listened yet
after the next good restart    2 listeners     ← 5901 and 5902
```

and the log for those last two events:

```
vite.config.ts changed, restarting server...
simulated store-unreachable failure
server restart failed
vite.config.ts changed, restarting server...     ← now TWO triggers per change
vite.config.ts changed, restarting server...
server restarted.
Port 5900 is in use, trying another one...
Port 5901 is in use, trying another one...
server restarted.
  ➜  Local:   http://localhost:5902/
```

Then, with two chains running, one more failing config change:

```
vite.config.ts changed, restarting server...     ×2
server restart failed                            ×2   ← both chains fail, both leak
vite.config.ts changed, restarting server...     ×4
Port 5900/5901/5902 in use …                          → 5903
Port 5903 in use …                                    → 5904
```

**Four listeners.** Every failed restart adds exactly one permanent chain; with N chains running, one
failure adds N. The primary's 13 failures got it to 11.

The proximate cause is Vite's, not ours — see
[vitejs/vite#22460](https://github.com/vitejs/vite/issues/22460) ("Failed automatic server restarts
don't release the port immediately") and
[vitejs/vite#19333](https://github.com/vitejs/vite/issues/19333) (a watcher listener added in
`configureServer` survives restarts) for two upstream reports of the same family. But **what we
control is whether our hook throws**, and we made it throw on purpose.

## Why nobody saw it

Everything reports success. Each of the eleven servers boots clean, prints nothing alarming, and
serves the app correctly. The only trace is one line — `Port 5273 is in use, trying another one...` —
printed by a process that *is* the thing using 5273, buried in a log with 8,000 other lines.

And the guard we built for exactly this said nothing. The `spideryarn-port-warning` plugin in
[`vite.config.ts`](../../vite.config.ts) warns when the bound port is **outside** the Supabase
allow-list. 5274 through 5283 are all inside it. So the one mechanism watching the port stayed
silent through eleven leaks, because it was asked *"is this port allowed?"* and the useful question
was *"is this the port I asked for?"*.

This is [silent-success.md](../reusable/silent-success.md)'s shape, and it is the second one in this
file in a day: [260902a](260902a-a-dev-server-that-ignored-its-own-source.md) was a dev server that
could not see its own source. The two share a parent — **the dev server is infrastructure that
nothing tests, and its failures are indistinguishable from working**.

The cost, concretely:

- **Eleven of thirty-one dev ports gone.** A worktree that lands outside 5273–5303 gets a Google
  sign-in that *appears* to work and drops the reader at the site root
  ([worktrees.md § Ports and the ceiling](../project/worktrees.md#ports-and-the-ceiling)).
- **An agent or a browser tab on 5274–5283 is talking to a different server** than one on 5273. They
  are usually in step, because a config change restarts all of them — but they diverge precisely
  when a restart fails on some chains and succeeds on others, which happened 13 times. Anything
  measured on one port and reasoned about on another is unsound, and nothing on the page says which
  one you are on.
- **Eleven of everything else.** The log records **172** `database pool created` lines; each chain
  re-runs the whole `configureServer` on every restart, so a config change now costs eleven config
  builds, eleven store probes and eleven pools.

## The commit that introduced it

Two commits, and they are worth separating, because one made it *possible* and one made it
*routine*.

**`23388ad`, 2026-08-28, "Building the client booted a store, and three docs said that was
deliberate"** made `configureServer` `async` and moved `import("./src/routes.js")` inside an awaited
`createApiMiddleware()`. That is the first version of this file whose `configureServer` hook could
reject at all — a module-load throw anywhere under `src/routes.ts` would have done it. It never
fired often enough to notice.

**`bf1372f`, 2026-09-02 15:56, "npm run dev serves from Postgres, and stops when Postgres does
not"** added `assertStoreReachable()`, which throws *by design* whenever Postgres does not answer.
That is a good guard — a server that boots happily onto a dead database is exactly the failure it
was written to kill — but it converted "a hook that can throw in principle" into "a hook that throws
every time the containers are down or slow", in a tree where the containers are down or slow
regularly.

The first leak in the log is at **15:25:01**, half an hour before that commit landed, and the error
is:

```
SPIDERYARN_STORE is "postgres", but the database did not answer: Failed query: select 1/0
```

`select 1/0` — somebody deliberately breaking the query to prove the new guard fired. **The guard's
own smoke test created the first orphan.** Of the 13 failures since, 11 are `assertStoreReachable`
(nine of them `timed out after 5s`) and 2 are a syntax error while the function was being typed
(`Identifier 'assertStoreReachable' has already been declared`). Those last two leak nothing —
a config-*load* failure happens before `_createServer` runs, so there is no watcher yet. Only the
ones that get as far as our hook leak.

## The fix

Ranked by value, and the first is the one to do.

**1. A `configureServer` hook must not throw on a restart.** Refusing to boot is right the first
time — `npm run dev` against a dead database should stop, loudly, and it does. Refusing to *restart*
is a different thing: the old server is already serving, the process is staying up either way, and
throwing buys nothing but a leaked twin. So: keep a module-level flag; on the first
`configureServer`, throw as now; on every later one, log the same message at `error` and mount a
middleware that answers every `/api` request `503` with that text. The reader gets a refusal they
can read, the next restart heals it, and nothing leaks.

**2. Warn when the bound port is not the port we asked for.** The `spideryarn-port-warning` plugin
already hooks `listening` and already knows `actual`. It should compare against
`config.server.port` as well as against the allow-list, because *"Vite fell back"* is a fact worth
saying out loud on its own — it is the first observable symptom of this bug, of a stale peer
process, and of a port collision between worktrees. Two lines, and it turns a silent leak into a
banner. `strictPort` stays off, for the reasons already written into that file.

**3. Upstream.** `restartServer`'s catch should close what `_createServer` half-built, or
`_createServer` should clean up its own watcher before rejecting. Worth adding our reproduction to
[vitejs/vite#22460](https://github.com/vitejs/vite/issues/22460); not worth waiting for.

Restarting the process clears all eleven ports at once, and it is safe — but it is not a fix. The
next time Postgres is slow for five seconds during a config reload, the count starts climbing again
from one.

## What would have caught the class

Not a test of `vite.config.ts`. The class is bigger than this file:

> **A hook that runs inside somebody else's lifecycle must not throw once that lifecycle is already
> running.** At startup a throw is a refusal, which is what you want. At restart the same throw is a
> resource leak, because the framework's error path was written to abandon a half-built object, not
> to dismantle it.

The same question applies to every `configureServer`, every `buildStart`, every `configResolved`
in this repo, and to anything we add to `handleHotUpdate`: *what does the framework do with the
half-built thing when I throw here, and is that different on the second call than the first?*

Two cheap detectors that would each have caught this one:

- **The port check in fix 2** — it fires the first time, on the first leak, in the log the developer
  is already watching.
- **A "how many dev servers am I actually running" check.** `ss -ltnp | grep <pid>` returning more
  than one line is always wrong and takes a second to run. It belongs in
  [debugging.md](../project/debugging.md)'s list of things to check when the dev server is behaving
  strangely, alongside 260902a's *"is this server seeing my source?"*.

And one habit, which is what actually found it: **a log that has been running for eighteen hours is
evidence, and almost nobody reads one.** Everything above was reconstructed from
`nohup`'d stdout — the restart triggers doubling from 1 to 2 to 4, the `Port … is in use` staircase,
the exact error on the first failure, and the minute it started. That file cost nothing to keep and
answered every question. Keep pointing `npm run dev` at a log.
