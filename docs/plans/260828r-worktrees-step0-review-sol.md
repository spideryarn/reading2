## Verdict

Do not run the trunk-flip runbook with this slice unchanged. The pure branch judgement is fine, but accepting `dev` exposes a missing trunk check in `preflight`. The database conclusion is also too strong.

## Findings

1. **High — a stale `dev` checkout can deploy code that omits commits already landed on the trunk.**  
   [scripts/deploy.ts](/home/greg/code/spideryarn2/scripts/deploy.ts:338), [tests/deploy-checks.test.ts](/home/greg/code/spideryarn2/tests/deploy-checks.test.ts:56)

   `preflight` fetches and compares only `origin/main`. Once `dev` is the trunk, that proves the candidate contains current production; it does not prove it contains current trunk.

   Example:

   ```text
   origin/main: A
   stale local dev: A-B
   origin/dev: A-B-C-D
   ```

   Deploying `B` passes because it contains `origin/main`, then promotes code missing `C-D`. The same hole allows a local `main` commit based on production rather than trunk to pass.

   Keep the `origin/main` ancestry check, but also fetch `origin/dev` and require the captured SHA to equal freshly fetched `origin/dev` at preflight. Equality is preferable to ancestry because otherwise an unpushed local commit can bypass the stated “push to `dev`, then deploy” workflow. The captured-SHA model means `dev` advancing after preflight need not invalidate a deployment unless you deliberately want that stricter rule.

   The new tests cover branch-name acceptance but never the consequential relationship between an accepted `dev` and `origin/dev`.

   This also answers **B**: `main` should expire when Runbook A is executed. The runbook should include changing the allowlist and its test to `["dev"]`. Binding every candidate to fetched `origin/dev` is the stronger safety property; branch naming alone is not enough.

2. **High — judgement A is wrong: Vercel documents the wildcard precedence, so default-allow should not remain.**  
   [vercel.json](/home/greg/code/spideryarn2/vercel.json:9), [worktrees.md](/home/greg/code/spideryarn2/docs/project/worktrees.md:191)

   Vercel now states that when several rules match, a deployment occurs if any matching rule is `true`. Therefore the exact `main: true` safely wins over a deny glob; it will not suppress the production build. [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)

   Use:

   ```json
   {
     "git": {
       "deploymentEnabled": {
         "**": false,
         "main": true
       }
     }
   }
   ```

   Use `**`, not `*`: Vercel specifies minimatch syntax, and ordinary `*` does not cover slash-containing names such as `agent/foo`; globstar does. I also confirmed this using the repository’s installed minimatch.

   Removing model keys from Preview remains worthwhile defense in depth. But uncertainty about exact-rule precedence is no longer a reason to defer default-deny.

3. **Medium — the database argument reaches the wrong absolute conclusion; schema-per-worktree is viable.**  
   [worktrees.md](/home/greg/code/spideryarn2/docs/project/worktrees.md:110)

   The narrow reasoning is sound:

   - A new bare database lacks `auth.users`.
   - PostgreSQL cannot enforce a normal FK across databases; a connection can access only its selected database.
   - A template copy gives each database a frozen copy of `auth.users`, so later signups in the original do not appear there.

   But this does **not** imply that real app-data isolation requires a full Supabase stack. PostgreSQL expressly supports multiple schemas with like-named tables, and objects in one schema can access objects in another schema in the same database. [PostgreSQL schemas](https://www.postgresql.org/docs/current/ddl-schemas.html) Supabase likewise describes app tables linking to the shared `auth` schema using foreign keys. [Supabase Auth architecture](https://supabase.com/docs/guides/auth/architecture)

   A cheaper arrangement is:

   ```text
   one Supabase stack
   shared auth.users
   worktree_a.<app tables> → auth.users
   worktree_b.<app tables> → auth.users
   ...
   ```

   A new GoTrue user is immediately visible to every worktree FK because there is only one `auth.users`. GoTrue needs no alternate search path. Its `DB_NAMESPACE` option merely prefixes table names; it is not an app-schema selector. [Supabase Auth README](https://github.com/supabase/auth/blob/master/README.md#database)

   This is not free to implement here: `pgSchema("spideryarn")`, the migration SQL, migration ledger, schema-drift checks, grants, and many direct SQL strings are hardcoded. Storage and Auth state would also remain shared. But it is materially cheaper at runtime than 20–30 stacks and should be the next option evaluated before full stacks.

   There is also a factual count error: the doc says six migrations and names five. The tree currently has **seven** migrations with FKs into `auth.users`: `0001`, `0003`, `0011`, `0015`, `0021`, `0040`, and `0043`.

4. **Medium — the operational workflow currently authorizes a command that AGENTS.md forbids.**  
   [worktrees.md](/home/greg/code/spideryarn2/docs/project/worktrees.md:43), [AGENTS.md](/home/greg/code/spideryarn2/AGENTS.md:135)

   “Allowed HERE” directly contradicts the current higher-level instruction banning rebases. A compliant agent cannot execute the documented landing workflow; a less careful one may treat the lower-level doc as permission to disregard AGENTS.md.

   Until Greg approves the rule change, say that rebase is the intended future workflow but is **not yet authorized**. Land the AGENTS.md exception no later than the first worktree-creation mechanism. The exception should identify a linked, one-agent worktree—not merely a branch name—and keep rebasing banned in the shared primary.

5. **Low — Runbook A leaves the version-control source of truth stale.**  
   [worktrees.md](/home/greg/code/spideryarn2/docs/project/worktrees.md:199), [version-control.md](/home/greg/code/spideryarn2/docs/project/version-control.md:8)

   The runbook names future AGENTS.md changes but not `version-control.md`, which still says “`main`, and only `main`” and describes a different deployment topology. After the flip, an agent following that doc could push to production or misunderstand which branch is authoritative. Updating it should be an explicit runbook step.

6. **Low — detached HEAD is handled correctly, but `--abbrev-ref` has one obscure false-refusal case.**  
   [scripts/deploy.ts](/home/greg/code/spideryarn2/scripts/deploy.ts:324)

   Detached HEAD returns `HEAD`, which is correctly refused; `HEAD` is not a valid branch name. A literal `dev` branch in a linked worktree would pass, because this function checks branch identity, not worktree topology.

   Git may return a longer unambiguous spelling such as `heads/dev` if another ref—commonly a tag—also has the short name `dev`. That would wrongly refuse a legitimate branch. `git branch --show-current` or reading the symbolic `HEAD` directly avoids this ambiguity. This is unlikely and not a blocker.

## Judgement calls

- **A:** Wrong. Adopt verified default-deny using `**`; exact `main: true` wins safely.
- **B:** Wrong indefinitely. Accept `main` only until Runbook A, and independently require the candidate to be the fetched `origin/dev` tip.
- **C:** Correct for v1. Keep production credentials and deployment in the primary. Greg’s own primary on `dev` can deploy. If deployment from a linked worktree is later wanted, provision it explicitly rather than allowing `worktree-*` generally.
- **D:** Wrong as currently worded. Document it as pending until the AGENTS.md exception lands.
- **E:** Reasonable given Greg’s decision. In addition to your list, it costs remote review/handoff pointers, easy inspection of unfinished branches, and turns integration into a retry loop where every rebase after a rejected push must be retested. Conflict resolution after rebase is new code and may require renewed review. The explicit `HEAD:dev` refspec and ancestry-based sweep are genuine simplifications.

## Runbook checks

`git switch -c dev` at the current `HEAD` is content-safe with uncommitted changes: because the new branch starts at that same commit, the index and working files need not change. Git documents `-c` as transactional. [Git switch](https://git-scm.com/docs/git-switch)

The proposed race does not create `dev` one commit behind: if a peer commits before the switch executes, current `HEAD` advances and `dev` is created there. The real race is that switching changes the shared branch underneath every session; a peer committing afterwards commits to `dev`. Briefly quiesce commits and announce the flip, even though editing can continue.

The `origin/HEAD` failure is stated strongly enough. Fetching `dev`, running `git remote set-head origin -a`, and asserting the resulting symbolic ref is exactly right; Git confirms that `-a` queries the remote and updates the clone-local symbolic ref. [Git remote](https://git-scm.com/docs/git-remote)

I made no changes. I attempted the targeted Vitest run, but this review environment is read-only and Vite could not create its temporary config under `node_modules/.vite-temp`; that is an environment limitation, not a test failure.