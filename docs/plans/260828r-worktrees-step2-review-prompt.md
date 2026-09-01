# Review: worktrees step 2, the parts that cannot disturb a shared tree

You have reviewed this plan three times and its step-0 slice once
(`260828r-worktrees-step0-review-sol.md` — your two High findings were both right and both landed).
This is a **code review** of the next slice. Weight the code over the prose.

## The constraint, which is the whole shape of this slice

Greg, 2026-09-01:

> Other agents are working in this primary checkout, and we'd prefer not to disrupt them. So that
> probably rules out the switch from main to dev for the primary checkout.
>
> If there are other aspects of the plan that you can proceed with that won't disrupt the other
> agents, then proceed, with help from GPT Sol.

So the trunk flip is off. I picked the subset of step 2 and step 3 that is **inert in this checkout
today** — plus one deliberate exception, below, which I want you to attack.

## What was built

1. **`.gitignore`** gets `.claude/worktrees/`. Claude Code's own docs recommend it. `.claude/` itself
   stays tracked (settings, hooks), so the line names only the subdirectory.
2. **`.worktreeinclude`** (new) listing `.env.local` and `.env`. Verified against the Claude Code docs
   rather than taken from the plan: the file is real, uses `.gitignore` syntax, sits at the project
   root, and copies only files that match *and* are gitignored. `.env.prod` is deliberately absent.
3. **`scripts/typecheck.ts`** — `.claude` added to `SKIP`. This is the one scanner that actually walks
   into a worktree: it recurses from the repository root and matches `SKIP` by basename, so a
   worktree's `tsconfig.json` becomes a project of the primary's. **Verified by breaking it**: with a
   probe `tsconfig.json` at `.claude/worktrees/probe/`, removing `.claude` from `SKIP` produced
   `✗ .claude/worktrees/probe/tsconfig.json: resolved 0 files.` and restoring it produced nothing.
   Probe deleted. I also checked and did **not** change biome (`includes` is an anchored allowlist),
   knip (`project` globs anchored), and jscpd (explicit `src api scripts evals`) — please confirm that
   reasoning, since "no change needed" is the kind of conclusion that is wrong silently.
4. **`vite.config.ts`** — `server.watch.ignored` gains `**/.claude/worktrees/**`. Safe because Vite
   *appends* this list to its own defaults: `resolveChokidarOptions` builds
   `["**/.git/**", "**/node_modules/**", "**/test-results/**", cacheDir, ...arraify(ignoredList)]`, which
   I read in `node_modules/vite/dist/node/chunks/node.js` rather than assuming.
5. **`scripts/worktree-port.ts` + `tests/worktree-port.test.ts`** (both new, 16 tests) — the port
   allocator, replacing the hash you correctly killed in review 2. **Nothing reads it yet**, on purpose.
6. **`vite.config.ts`** — `port: Number(process.env.SPIDERYARN_DEV_PORT) || 5273` and
   **`strictPort: true`**. This is the exception. See below.

## The judgement call I most want attacked

**`strictPort: true` is the one change that alters behaviour in this shared checkout today.** My
argument that it is a fix rather than a disruption: `docs/project/setup-dev.md` already documents the
current behaviour as an afternoon-waster —

> **And the port has to be 5273.** Several agents run `npm run dev` in this one tree; if 5273 is
> taken, Vite quietly picks 5274 or 5275, which is not on the allow-list, and Google sign-in fails
> for a reason that has nothing to do with your code.

The allow-list in `supabase/config.toml` names 5273 by number and GoTrue bakes it in at start. So
today an occupied 5273 gives a *working-looking* dev server whose Google sign-in succeeds and then
drops the reader at the bare site URL. `strictPort` turns that into an error at startup. No running
process is affected — it only changes what a *new* `npm run dev` does.

**Is that right, or am I trading a limp for a stop in a tree where a dozen agents are mid-task?**
Consider specifically: an agent that today limps along on 5274 doing work that never touches
sign-in — does it now just fail and get stuck? Is there a better shape, e.g. keeping `strictPort`
false but failing loudly in a `configureServer` hook that checks the resolved port against the
allow-list?

## The allocator, which is the substance

Design decisions I want checked:

- **The lease lives in the shared git directory** — `git rev-parse --path-format=absolute
  --git-common-dir`, then `spideryarn-worktree-ports/<port>.lock`. Rationale: worktrees have separate
  working directories and exactly one repository, so this is the only location every worktree can see,
  and it can never be committed by accident. Is there a case where `--git-common-dir` is the wrong
  answer — a worktree of a worktree, a submodule, a `WorktreeCreate` hook that put the worktree
  outside `.claude/worktrees/`?
- **`claimPort` walks the range low to high and returns the first lease it can create**, so the claim
  *is* the test — no scan-then-pick. It continues past `LockHeldError` and **rethrows everything
  else**, because "could not write the lease" and "this port is taken" are opposite diagnoses and
  treating the first as the second walks the whole range, calls it full, and reports a wrong reason.
  There is a test for that.
- **A requested port outside the range is refused, not clamped**, and the message names the real
  consequence rather than the rule. The range is one constant, `WORKTREE_PORT_RANGE = {first: 5273,
  count: 30}`, per Greg wanting headroom for 20–30.
- `release()` deletes the lease file, so only a `SIGKILL` leaks one, and the "range is full" message
  tells you the leases are files and to read who holds one before deleting it. Inherited from
  `lockfile.ts`, which never steals.

**One test caught me out and I want to know if it points at a real weakness.** My first version
asserted `claimPort({want: 5300})` throws, having assumed a 30-wide range from 5273 stops short of
5300. It does not — it ends at 5302, so 5300 is legitimately inside. The test failed and I rewrote it
to compute `first + count`. Is there anywhere else in this file or its tests where a literal encodes
an assumption about the range that widening `count` would silently invalidate?

## Also worth your attention

- Is `portInRange` right to reject non-integers, and does anything upstream pass a string? `vite.config.ts`
  does `Number(process.env.SPIDERYARN_DEV_PORT) || 5273`, so an unparseable value becomes `NaN` and
  falls back to 5273 rather than reaching the allocator. Is silently falling back correct here, or
  should a set-but-garbage `SPIDERYARN_DEV_PORT` be a hard failure? My instinct is that it should fail,
  because a worktree whose port variable is malformed would otherwise collide with the primary — but
  nothing sets that variable yet.
- The plan says step 3 must land "as one unit" because each half hides the other's failure. I have
  landed the allocator and `strictPort` but **not** the Supabase allow-list range and **not** the
  identity endpoint. Does that leave a half that hides something? My reasoning: with nothing setting
  `SPIDERYARN_DEV_PORT`, every server is on 5273 exactly as before, so no port outside the allow-list
  can be reached yet.
- `leasedPorts` treats `ENOENT` as "nothing leased" and rethrows the rest. Right shape?
- Anything a plan review could not have seen.

## Files

Read these in the working tree; `step2.diff` in the session scratchpad has the three modified files,
and the two new ones are best read whole:

- `scripts/worktree-port.ts` (new)
- `tests/worktree-port.test.ts` (new)
- `.worktreeinclude` (new)
- `vite.config.ts` — the `server` block
- `scripts/typecheck.ts` — `SKIP`
- `.gitignore` — the last stanza
- `docs/project/worktrees.md` and `docs/plans/260828r-worktrees.md` for the design

Answer with findings ranked by severity, each naming the file and what goes wrong. Say plainly if
`strictPort` is the wrong call, and if the "no change needed" conclusion about biome, knip and jscpd
is wrong.
