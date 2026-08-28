# Review: two defects in `npm run deploy`'s gates

You are reviewing a proposed fix to `scripts/deploy.ts` in Spideryarn, a TypeScript/ESM
reading app deployed to Vercel. Please be adversarial. Some of my reasoning below is
probably wrong; I have already had one confident diagnosis collapse in this session and I
would rather it happen again here than after the change lands.

Context you need about the repo:

- Several AI agents commit into one shared working tree. HEAD moves every few minutes.
- `npm run deploy` gates the exact committed sha **in a `git worktree`**, never in the
  working tree, because committed code that imports a file still sitting untracked on
  somebody's disk has broken `main` three times.
- Gates are `build`, `typecheck`, `test`. Each can be forced individually with
  `--force-gate=<name>`, which is printed loudly in the summary. There is no blanket force.
- The script's stated design principle: *"an override is a debt entry, not a workflow."*
- `data/` (25MB) and `output/` (3.9MB) are both **gitignored** derived artefacts.

---

## Defect 1 — the `test` gate is structurally incapable of passing

`gatesAt()` sets the worktree up like this (scripts/deploy.ts ~line 574-589):

```ts
symlinkSync(path.join(ROOT, "node_modules"), path.join(wt, "node_modules"));
// ... build runs here, deliberately before .env.local exists ...
const envLocal = path.join(ROOT, ".env.local");
if (existsSync(envLocal)) symlinkSync(envLocal, path.join(wt, ".env.local"));
if (existsSync(path.join(ROOT, "data"))) {
  cpSync(path.join(ROOT, "data"), path.join(wt, "data"), { recursive: true });
}
info("tests run with .env.local linked and data/ copied — the suite is not hermetic");
```

`data/` is copied. **`output/` is not**, and 14 test files read from it
(`tests/helpers-load-article.ts`, `pipeline-artifact-store`, `helpers-seed-reader-state`,
`chat-anchor`, `artefact-copy`, `store-parity`, `store-roundtrip`, `store-export-raw`,
`doc-links`, and others). They `ENOENT` on `output/writes.html` and
`output/writes.blocks.json`.

### Measurements I took

I replicated the gate environment by hand (`git worktree add --detach` + the two symlinks
+ `rsync -a data/`) and ran the full suite.

| environment | result |
|---|---|
| working tree (has `output/`) | **4820 passed, 0 failed** |
| gate worktree, sha `7afab6c` | **13 failed / 9 files**, 4538 passed, **204 skipped** |
| gate worktree, sha `2ba408a` | **13 failed / 9 files**, 4596 passed, **204 skipped** — identical set |
| gate worktree + `rsync -a output/` | **1 failed / 1 file**, 4810 passed, **2 skipped** |

So the `test` gate can never go green, at any commit. Forcing it is therefore the only way
anyone deploys — which converts the override from a debt entry into the standard workflow,
and a permanently-forced gate swallows whatever real failure arrives next.

The single failure that survives copying `output/` is genuine and unrelated:
`docs/project/web-client.md` links to `tests/use-comments-load-state.test.ts`, which is
**untracked**. That is precisely the class of bug the worktree gate exists to catch, and it
is invisible in the working tree. I am not proposing to fix that one here — it is another
agent's in-progress file and committing someone else's work is forbidden in this repo.

### The 204 skips worry me more than the 13 failures

Copying `output/` moved skips from **204 to 2**. So the gate has been silently *not running*
~202 tests, and reporting nothing about it. Nothing in the output says "202 tests skipped
because a fixture directory was missing". That looks to me like the more dangerous half of
this defect, and I would like your view on whether the fix should make a fixture-driven skip
a hard error inside the deploy gate specifically (while leaving normal local runs free to
skip).

### Proposed fix 1

Copy `output/` next to `data/`, same guard, same `cpSync`, and extend the `info()` line.

### My own objection to it, which I want you to weigh

The gate's purpose is to answer *"does this **commit** work?"*. Feeding it two directories
of ungitted, laptop-local derived artefacts weakens that: the gate would pass or fail partly
because of what this machine happens to have built. A fresh clone or CI could not reproduce
the result. The counter-argument is that this objection already applies to `data/` and
`.env.local`, the script's comment openly says the suite is not hermetic, and refusing the
one-line fix leaves a permanently-red gate, which is strictly worse.

Questions:
1. Copy `output/`, or make the ~14 test files hermetic (build their own fixtures)? The
   second is much more work and touches tests other agents are editing right now.
2. Is there a third option — e.g. the gate asserting `output/` exists and failing with a
   clear message instead of 13 confusing `ENOENT`s?
3. Should skipped tests be a gate failure in this context? How would you draw that line
   without making ordinary local `npm test` runs miserable?

---

## Defect 2 — the log check reads before the logs exist

Final step of the deploy, `readLogs()` (scripts/deploy.ts ~line 1147):

```ts
const r = run("npx", ["-y", LOGS_CLI, "logs", "--scope", SCOPE,
  "--deployment", deployment.uid, "--json",
  "--since", since.toISOString(), "--limit", "100"]);
// ... parse JSON lines, filter by deploymentId ...
if (lines.length === 0) {
  record("read this deployment's logs", [
    `${LOGS_CLI} returned nothing for ${deployment.uid}.`,
    "That is not evidence of health. ...",
  ]);
  return;
}
```

`LOGS_CLI = "vercel@59.7.0"`. The check is well designed: it does not ask "are there no
errors", it asks "**is the line I know I caused here**" — a `/api/__deploy-smoke__/<uid>`
request the script itself makes — and only then treats the absence of errors as meaningful.

On a healthy deploy today it reported `vercel@59.7.0 returned nothing`.

### How I got the cause wrong the first time, which is itself evidence

I hand-ran `vercel logs https://www.spideryarn.com --scope greg-detre --since 40m`, got 6
records, and concluded the script was querying the wrong address (`--deployment <uid>` vs
the host). I wrote that up as fact. It was wrong: my hand-run differed from the script in
**two** variables at once — the address *and* ~90 minutes of elapsed time.

Re-running the script's exact argv unchanged, 90 minutes after the deploy, returns all 6
lines including the smoke request. So `--deployment` and `--json` are both fine. The real
variable is **log ingestion lag**: the script queries immediately after issuing the smoke
requests, and there is no retry.

### Proposed fix 2

Poll: query, and if the smoke line is absent, sleep and retry with backoff until either it
appears or a budget expires. Keep the existing "empty is a failure" semantics at the end of
the budget.

Questions:
1. What budget and backoff shape would you choose? The deploy already waits minutes for
   Vercel to build, so tens of seconds here is cheap — but I have no measurement of the
   true p95 ingestion lag, only one data point (absent at ~0s, present at ~90min). How
   would you get a defensible number rather than guessing?
2. After the budget expires with no smoke line, should this stay a hard failure? It runs
   **after** the push and after nine passing verification checks, so the deploy is already
   live and irreversible by then. A hard failure here cannot prevent anything; it can only
   inform. Does that change what it should be?
3. Is polling the right shape at all, or should the smoke request be issued, then the
   other verification work done, and the log read once at the very end — using the elapsed
   time that already exists rather than adding new waiting?

---

## What I am asking for

For each defect: is the diagnosis right, is the proposed fix right, and what would you do
instead? Please flag anything in my measurements that does not actually support the
conclusion I drew from it — I would rather find a second wrong diagnosis now than ship it.
