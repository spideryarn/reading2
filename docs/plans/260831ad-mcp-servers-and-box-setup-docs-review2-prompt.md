# Second review: the fixes for your six blockers

You said STOP on this change an hour ago. This is the same work after acting on it. Be adversarial
again: I want to know what I got wrong in the FIXES, and whether any of your blockers is still live
under a new coat of paint. Do not re-praise things that are now fine — say STOP or SHIP and give me
what is still broken.

## What I did with each blocker

**1. `npm run setup` can migrate production.** Verified your mechanism: `db-migrate.ts` really does
prefer an exported `DATABASE_URL` (deliberately — its docstring explains a 2026-08-27 accident where
`.env.local` overrode the shell and it migrated the laptop while reporting success), and
`setup-local.ts` uses `spawnSync` with inherited env. But it takes TWO exports, not one: the guard
refuses a non-loopback URL unless `DB_MIGRATE_ALLOW_REMOTE=yes` is also set. **Not fixed** — that
script belongs to another session in this shared tree and is outside my stage. Recorded in the plan
and raised with its owner and with Greg. Tell me if you think two deliberate exports is still an
unacceptable exposure for an unattended box, and whether "local by construction" in that docstring
should simply be reworded rather than the code changed.

**2. "No production Supabase credential" is false.** Agreed, and this was the finding of the review.
Measured first: every relevant value on the live box is loopback today, so it was latent rather than
live. Then made structural rather than lucky — new `MUST_BE_LOCAL` in `scripts/gjd-remote-env.ts`
refuses to send `DATABASE_URL`, `SUPABASE_URL` or `VITE_SUPABASE_URL` unless the value is loopback,
reusing the migrator's own `isLocalDatabaseUrl` so "local" cannot mean two things in one repo. Four
tests, watched red before the fix, including `postgres://user:p@localhost:5432@remote.example.com/db`
— the last-`@` shape that defeated a regex version of this check elsewhere in this repo. Verified the
real `.env.local` still pushes: 13 keys, no problems.

**3 and 4. The Vercel policy and the guardrail/enforcement confusion.** Added `buy_addon` (there are
four `buy_*`, I had three), `use_vercel_cli` (the escape hatch you and a spike both flagged),
`pause_project` and `update_project_deployment_protection`. Left `deploy_to_vercel` open on purpose
— deploying is ordinary work here and a session was mid-deploy while I wrote this — with the
reasoning written down and a note that it is one more line. The README now says "guard rail, not a
wall", says an agent that can edit the repo can edit the list, and says we have no managed-settings
file. `docs/project/remote-box.md` no longer says it "stops an agent buying things".

**5. `doctor` does not check the lot.** Rewritten. It now enumerates what doctor does and does not
cover, states plainly that a box skipping steps 3–7 gets a green doctor, and closes the runbook with
`REQUIRE_POSTGRES=1 npm test` as the step that actually proves that half.

**6. Step 5 not executable.** Now gives the ssh and the `cd`.

## Also changed, from other reviewers

- `infra/hetzner/README.md` was outside the doc-links gate (it globbed `docs/**` + `AGENTS.md`).
  Added. The gate immediately found a dead anchor of mine in that same file.
- `/var/log/provision.log` "must end with PROVISION OK" is false on the live box — cloud-init tees
  it on first boot only, so it still ends `PROVISION INCOMPLETE` while the status file says OK.
- A comment claiming the Supabase MCP "gets --read-only". No such mode exists.
- A new `mcp` check in `gjd-remote doctor`, with `scripts/gjd-remote-mcp.ts` and 13 tests,
  mutation-tested four ways. It reads the wanted names from `.mcp.json` rather than keeping a second
  list, and distinguishes a missing OAuth login from a stale checkout.

## Where I did NOT follow you

You wrote that `.mcp.json` is right for Supabase but that user scope is "the safer boundary" for
Vercel and Sentry, since the requirement is box-specific. I kept all three in `.mcp.json`. My
reasoning: the user asked specifically for something reproducible on FUTURE boxes, and a committed
file is reproducible by `git clone` where a provisioning entry is reproducible only by our
Terraform. You also wrote that "current evidence suggests `mcp remove` does not clear OAuth state" —
a spike measured the opposite on the box, watching `~/.claude/.credentials.json` shrink 1364→959 on
removing `vercel` and 959→523 on removing `sentry`, with a failing duplicate `add` as the control
leaving it byte-identical. I have documented the measurement. Tell me if you think either call is
wrong.

## Questions

1. Is the `MUST_BE_LOCAL` guard actually sufficient, or is there a value shape it lets through?
2. Is leaving `deploy_to_vercel` open defensible, given everything else?
3. Anything in the new prose that is now false, or that will go stale.

## The diff

```diff
diff --git a/.claude/settings.json b/.claude/settings.json
index d5271a1..993f91a 100644
--- a/.claude/settings.json
+++ b/.claude/settings.json
@@ -21,7 +21,11 @@
     "deny": [
       "mcp__vercel__buy_pro",
       "mcp__vercel__buy_domain",
-      "mcp__vercel__buy_credits"
+      "mcp__vercel__buy_credits",
+      "mcp__vercel__buy_addon",
+      "mcp__vercel__use_vercel_cli",
+      "mcp__vercel__pause_project",
+      "mcp__vercel__update_project_deployment_protection"
     ]
   }
 }
diff --git a/docs/plans/260831x-remote-box-dev-environment.md b/docs/plans/260831x-remote-box-dev-environment.md
index 847c934..4289853 100644
--- a/docs/plans/260831x-remote-box-dev-environment.md
+++ b/docs/plans/260831x-remote-box-dev-environment.md
@@ -327,6 +327,54 @@ are under `/home`, `findmnt /home` reports `/dev/sdb`, and that is the volume. S
 **Still manual, and unavoidably so:** `claude mcp login vercel` and `claude mcp login sentry`, in a
 browser, by Greg. Nothing else in stage 4 needs a human.
 
+**Sol reviewed it and said STOP, with one finding worth the whole review.** The banner
+`push-env` writes on the box says "production credentials are deliberately absent", and nothing made
+that true. The allowlist matches key *names*; `DATABASE_URL` is spelled the same for the throwaway
+container and for the one production database. Point `.env.local` at production for an afternoon,
+push, and the box quietly holds production under a file claiming it does not. Measured on the box
+the same day: every value there is loopback today — so this was latent, not live. Fixed by making it
+structural rather than lucky: `MUST_BE_LOCAL` in
+[`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts) refuses to send `DATABASE_URL`,
+`SUPABASE_URL` or `VITE_SUPABASE_URL` unless the value is loopback, reusing the migrator's own
+`isLocalDatabaseUrl` so "local" cannot mean two things in one repo. Four tests, watched red first,
+including the `user:p@localhost:5432@remote.example.com` shape that defeated a regex version of this
+check elsewhere.
+
+**The deny list was a claim, not a control, and the doc said otherwise.** Three corrections:
+`buy_addon` was missing (there are four `buy_*`, not three); `use_vercel_cli` runs the Vercel CLI and
+routes around every per-tool entry; and a session on the box can write
+`.claude/settings.local.json`, so any agent that can edit the repo can edit the list. It is a guard
+rail against the accidental reach, and the README now says exactly that rather than implying a wall.
+`pause_project` and `update_project_deployment_protection` are denied too — neither is routine and
+both reach production. `deploy_to_vercel` is deliberately left open, because deploying is ordinary
+work here.
+
+**`doctor` was oversold as "check the lot".** It knows nothing about the checkout, `.env.local`, the
+database, the migrations, the owner row or the fixtures, and the browser smoke deliberately uses a
+global `playwright-core` so it works on a clean `/home` with no checkout at all — so a box that
+skipped half of First run gets a green doctor. The runbook now says so and closes with
+`REQUIRE_POSTGRES=1 npm test`, which is the step that actually proves that half.
+
+**`infra/hetzner/README.md` was outside the doc-links gate**, which globbed `docs/**` plus
+`AGENTS.md` only. That is how it came to carry a link to a `#mcp-servers` heading that did not
+exist. It is in the gate now, and the gate immediately found a second dead anchor in the same file —
+a link of mine to this plan that used the short form of a heading ending "…, discovered by trying
+it". The runbook is the markdown most likely to be followed literally by someone who cannot yet ask
+the repo anything, and it was the only one not checked.
+
+**Two claims of mine that were wrong.** `/var/log/provision.log` "must end with PROVISION OK" is
+false on the live box — cloud-init tees that file on the first boot and never touches it again, so
+it still ends `PROVISION INCOMPLETE` from an old build while the status file says `PROVISION OK`.
+And a comment in `gjd-remote-env.ts` said the Supabase MCP "gets --read-only"; no such mode exists on
+that server or on Vercel's.
+
+**Still open, and not mine to fix:** `npm run setup` inherits the shell, and
+[`scripts/db-migrate.ts`](../../scripts/db-migrate.ts) deliberately prefers an exported
+`DATABASE_URL` and allows a remote one under `DB_MIGRATE_ALLOW_REMOTE=yes`. Both exports would have
+to be present, and the guard refuses a remote URL without the opt-in — so it is two deliberate acts,
+not one slip. But `setup-local.ts` calls itself "local by construction" and that is a shade stronger
+than what holds. Raised with Greg and with the session that owns that script.
+
 ## The `provision.sh` refactor — approved, with a correction
 
 Extract it from the cloud-init heredoc into `infra/hetzner/provision.sh`, so it is shellcheck-able
diff --git a/docs/project/remote-box.md b/docs/project/remote-box.md
index 3c25f20..11f78c0 100644
--- a/docs/project/remote-box.md
+++ b/docs/project/remote-box.md
@@ -49,7 +49,8 @@ and tmux refused the second one; on a box meant to hold many parallel sessions t
   stale copy.
 - [`.mcp.json`](../../.mcp.json) — the `supabase`, `vercel` and `sentry` MCP servers, at project
   scope so they arrive with the clone rather than with provisioning. The two OAuth logins, the deny
-  list that stops an agent buying things, and why Supabase needs no credential are in
+  list that makes it harder for an agent to buy things (a guard rail, not a wall — an agent that can
+  edit the repo can edit the list), and why Supabase needs no credential are in
   [infra/hetzner/README.md § MCP servers](../../infra/hetzner/README.md#mcp-servers).
 
 **Doing things on it**
diff --git a/infra/hetzner/README.md b/infra/hetzner/README.md
index 9da8792..9613e32 100644
--- a/infra/hetzner/README.md
+++ b/infra/hetzner/README.md
@@ -16,8 +16,8 @@ the server's own disk.
 
 ## First run
 
-Zero to a box an agent can work on. Everything is scripted **except three steps that need a human
-in a browser** — they are marked ⚑, and no amount of Terraform will remove them.
+Zero to a box an agent can work on. Everything is scripted **except four steps that need a human in
+a browser** — they are marked ⚑, and no amount of Terraform will remove them.
 
 You need, on the laptop: OpenTofu (or Terraform) ≥ 1.5, a Hetzner Cloud project, a Read & Write API
 token for it (Hetzner console → Security → API tokens), and an ssh keypair whose public half sits at
@@ -57,15 +57,28 @@ Then, in this order, from the repo root on the laptop:
 4. **Send the environment.** `npx tsx scripts/gjd-remote.ts push-env` — allowlisted key names only,
    rebuilt on the box rather than copied, and it prints what it skipped. It writes *into the
    checkout*, so it has to come after the clone and not before it.
-5. **Build it, on the box.** `npm ci`, then **`npm run setup`**
+5. **Build it, on the box** — `ssh greg@<ip>`, `cd ~/code/spideryarn2`, and there
+   `npm ci`, then **`npm run setup`**
    ([`scripts/setup-local.ts`](../../scripts/setup-local.ts)), which runs the local Supabase stack,
    the migrations and the owner seed in the one order that works. The first run pulls ~2GB of Docker
    images. `npm ci` stays outside it on purpose — you cannot run the script before installing.
    It is the same command on the laptop, which is why it is the one that gets exercised.
 6. **Copy the article fixtures**, which git does not carry — same section.
 7. ⚑ **Authenticate the MCP servers** that need it — [MCP servers](#mcp-servers).
-8. **Check the lot:** `npx tsx scripts/gjd-remote.ts doctor`. It exits non-zero if anything failed,
-   so it is usable as a gate rather than something to read hopefully.
+8. ⚑ **Log Codex in**, so cross-family review works without a 12-second tax per run:
+   `codex login --device-auth` — [Codex, for cross-family review](#codex-for-cross-family-review).
+9. **Check the machine:** `npx tsx scripts/gjd-remote.ts doctor`. It exits non-zero if anything
+   failed, so it is usable as a gate. But be clear what it covers: ssh, mosh, ten system binaries,
+   the browser stack, the MCP servers, and provisioning. It knows **nothing** about steps 3–7 —
+   there is no check for the checkout, `.env.local`, the database, the migrations, the owner row or
+   the fixtures, and the browser smoke deliberately uses a global `playwright-core` so that it works
+   on a clean `/home` with no checkout at all. **A box where you skipped 3 through 7 gets a green
+   doctor.**
+10. **Then check the work**, which is the step that actually proves 3–7: on the box,
+    `REQUIRE_POSTGRES=1 npm test`. That is stage 3's exit criterion in
+    [the plan](../../docs/plans/260831x-remote-box-dev-environment.md), and
+    [`tests/helpers/pg-ready.ts`](../../tests/helpers/pg-ready.ts) makes an absent database say so
+    rather than failing obscurely.
 
 ## Before every apply
 
@@ -215,10 +228,16 @@ Then, from the output:
 
 ```
 ssh greg@<ip>
-sudo tail -20 /var/log/provision.log    # must end with PROVISION OK
+cat /var/log/gjd-provision-status        # must end with PROVISION OK
 claude                                   # press c, open the URL on your laptop, paste the code back
 ```
 
+**Not `/var/log/provision.log`**, which this said until 2026-08-31 and which is actively
+misleading: cloud-init tees that file on the FIRST boot and never touches it again, so on the live
+box it still ends `PROVISION INCOMPLETE — see above` from a build months ago, while the status file
+from the most recent re-run says `PROVISION OK`. Both were true; only one was current. The log is
+for reading *why* something failed, and the status file is for deciding *whether* it did.
+
 **Read that log before trusting the box.** Provisioning ends with a block of explicit checks —
 volume mounted, swap on, claude and chrome and docker actually running, both MCP servers registered,
 password auth actually off. The list is at the bottom of
@@ -409,7 +428,7 @@ x11vnc and websockify are all bound to localhost and reached through the tunnel.
 
 ## MCP servers
 
-Four kinds, and only one of them needs anything from a human.
+Three kinds, and only one of them needs anything from a human.
 
 **Greg's account brings its own.** Canva, Zapier, Google Calendar, Gmail, Drive, Notion arrive on
 any machine he logs into and need nothing per-box. Do not register them here and do not count them
@@ -432,34 +451,95 @@ A project-scope server normally makes every session sit at `⏸ Pending approval
 approves it interactively. `enabledMcpjsonServers` in
 [`.claude/settings.json`](../../.claude/settings.json) pre-approves these three by name, which is
 why nobody gets a modal. That file is also where the deny list lives, and JSON cannot hold a comment
-saying why, so it is here instead: **Vercel's MCP can spend money** — `buy_pro`, `buy_domain`,
-`buy_credits` — and an autonomous agent must never reach them. The matcher is
-`mcp__<server>__<tool>` for one tool, **`mcp__<server>` with no trailing wildcard** for a whole
-server, and `mcp__*` for all of them; `mcp__vercel__*` is not the syntax, however much it looks like
-it. `deploy_to_vercel`, `pause_project` and `update_project_deployment_protection` are deliberately
-*not* denied — they are real work, and sessions here run in normal permission mode (there is no
-`--dangerously-skip-permissions` anywhere in `gjd-remote`), so they prompt.
+saying why, so it is here instead.
+
+**Vercel's MCP can spend money.** Four `buy_*` tools — `buy_pro`, `buy_domain`, `buy_credits`,
+`buy_addon` — and an autonomous agent must never reach any of them. Denied, along with
+**`use_vercel_cli`**, which is a general escape hatch: it runs the Vercel CLI, so leaving it open
+would route straight around every other name on the list. Also denied: **`pause_project`**, which
+can take production offline, and **`update_project_deployment_protection`**, which can expose it.
+Neither is routine work, and Vercel's own guidance is that its MCP has whatever access the account
+has and wants human confirmation for every workflow.
+
+**`deploy_to_vercel` is deliberately left open**, and that is a judgement rather than an oversight:
+deploying is ordinary work here, sessions run in normal permission mode (`gjd-remote` passes no
+`--dangerously-skip-permissions`), so it prompts. If unattended deploys ever become the worry, it is
+one more line.
+
+**Syntax.** `mcp__<server>__<tool>` for one tool, `mcp__<server>` for a whole server, `mcp__*` for
+every server. `mcp__<server>__*` works too, but the bare form is the one the CLI's own help
+documents. Denied tools are removed from the model's tool list rather than refused when called —
+proved on the box by denying `mcp__supabase__list_tables` and watching that one tool disappear while
+the other ten stayed. Deny also beat an explicit allow of the same name.
+
+**This is a guard rail, not a wall, and it matters which.** A session on that box can write
+`.claude/settings.local.json`, which takes precedence over the project settings — so an agent that
+edits the repo can re-allow what this denies. It stops the accidental reach, not a determined one.
+The only version an agent cannot touch is a managed-settings file deployed outside the repo, and we
+do not have one. Say "guard rail" when describing this to somebody; calling it a control would be
+false.
 
 ### ⚑ The one manual step, per box
 
 ```
 ssh -t greg@<ip>
 cd ~/code/spideryarn2
-claude mcp login vercel     # prints a URL; open it on the laptop, approve, come back
-claude mcp login sentry
-claude mcp list             # both must now say ✔ Connected, not ! Needs authentication
+claude mcp login --no-browser vercel
+claude mcp login --no-browser sentry
+claude mcp list        # both must now say ✔ Connected, not ! Needs authentication
 ```
 
+**It is an exchange, not a link.** `--no-browser` prints an authorization URL *and then waits*: you
+open it in a browser on the laptop, approve, and **paste the redirect URL back** at its prompt. Miss
+that second half and it sits there until it times out, which looks like a hang. Pass the flag
+explicitly rather than relying on the headless auto-detection added in 2.1.191 — a default is not a
+decision, and this is the same reasoning that makes `provision.sh` name `--browser chrome` out
+loud.
+
 **A rebuild does not undo this.** The tokens are in `~/.claude/.credentials.json` and
 `~/.claude.json`, `/home` is the volume (`findmnt /home` says `/dev/sdb`), and the volume outlives
-the server. So this is a once-per-*box* ceremony, not a once-per-`apply` one.
+the server. So the unit is not the box and not the `apply` — it is **the retained volume**, and it lasts until the tokens expire or are revoked.
+
+**But `claude mcp remove <name>` is a de-authentication.** Measured on the box, 2026-08-31:
+removing a server shrank `~/.claude/.credentials.json` from 1364 to 959 bytes for `vercel`, then
+959 to 523 for `sentry`, and re-adding restored nothing. The control was a duplicate `add`, which
+fails and leaves the file byte-identical — so the shrink is `remove`'s doing. And the store is keyed
+by **server name, not by scope**: the laptop's existing Vercel login was picked up by the new
+project-scope entry the moment the name matched. So `remove` at any scope destroys the one
+credential every scope shares. That is a trap for whoever next tidies up a duplicate registration,
+and it is the reason these three live in `.mcp.json` rather than in `provision.sh`: the provisioning
+helper for the browser MCPs does remove-then-add for idempotence, and copying that pattern here
+would log the box out of Vercel and Sentry on every re-provision. If you ever do script one, guard
+with `claude mcp get <name>` — exit 0 present, exit 1 absent — and add only when absent.
+
+**You do not have to remember the login**, because `gjd-remote doctor` fails when it has not been
+done:
+
+```
+✗ mcp  sentry, vercel not connected — on the box: claude mcp login sentry
+```
+
+It reads the wanted names out of `.mcp.json` rather than keeping a second list, so adding a server
+extends the check on its own. It tells a *missing login* apart from a *stale checkout* — a box that
+has not pulled the commit adding `.mcp.json` is told to pull, not sent off to do a browser ceremony
+that cannot help. [`scripts/gjd-remote-mcp.ts`](../../scripts/gjd-remote-mcp.ts),
+[`tests/gjd-remote-mcp.test.ts`](../../tests/gjd-remote-mcp.test.ts).
 
 ### Why Supabase needs no credential, and what that buys
 
-It is the **local** stack's own MCP on a loopback address, not Supabase's hosted one, so it is
-structurally incapable of reaching production — there is no production Supabase credential on the
-box at all, which is what lets `push-env`'s allowlist leave `SUPABASE_ACCESS_TOKEN` behind
-([`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)). It serves 11 tools, verified by a
+It is the **local** stack's own MCP on a loopback address, not Supabase's hosted one, so it cannot
+reach production. That is what lets `push-env`'s allowlist leave `SUPABASE_ACCESS_TOKEN` — the
+management token that can delete the production project — behind entirely.
+
+**And that claim is now enforced rather than merely true.** The allowlist matches key *names*, and a
+name says nothing about where it points: `DATABASE_URL` is spelled the same for the throwaway
+container and for the one production database. So "no production credential on the box" was
+something nobody was checking, and it would have gone quietly false the first afternoon somebody
+pointed `.env.local` at production and then pushed. Since 2026-08-31 `push-env` refuses to send
+`DATABASE_URL`, `SUPABASE_URL` or `VITE_SUPABASE_URL` unless the value is loopback
+([`MUST_BE_LOCAL` in `scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)), reusing the
+migrator's own `isLocalDatabaseUrl` so "local" cannot mean two different things in one repo. Found
+by GPT Sol. It serves 11 tools, verified by a
 `tools/list` call on 2026-08-31: `search_docs`, `list_tables`, `list_extensions`, `list_migrations`,
 `apply_migration`, `execute_sql`, `query_logs`, `get_advisors`, `get_project_url`,
 `get_publishable_keys`, `generate_typescript_types`.
@@ -472,7 +552,7 @@ every session on it, so `execute_sql` there is somebody else's data as well as y
 
 Two things a green `git clone` does not give you. Both were found by running the suite on a new box,
 not by reading anything, and both fail in ways that do not name the cause — the archaeology is in
-[the plan](../../docs/plans/260831x-remote-box-dev-environment.md#what-a-fresh-clone-cannot-do).
+[the plan](../../docs/plans/260831x-remote-box-dev-environment.md#what-a-fresh-clone-cannot-do-discovered-by-trying-it).
 
 **`npm run db:seed-owner`.** A freshly migrated database has no owner row, so every insert carrying
 an `owner_id` dies on a foreign key. It cost 18 failing test files and the error names neither the
diff --git a/scripts/gjd-remote-env.ts b/scripts/gjd-remote-env.ts
index e17129f..434742f 100644
--- a/scripts/gjd-remote-env.ts
+++ b/scripts/gjd-remote-env.ts
@@ -7,6 +7,7 @@
  * main() on import, and an entrypoint guard is a bad thing to depend on.
  */
 import { createHash } from "node:crypto";
+import { isLocalDatabaseUrl } from "../src/db/ssl.js";
 
 /**
  * THE ALLOWLIST. Every key that may reach the box, named.
@@ -25,8 +26,11 @@ import { createHash } from "node:crypto";
  *    the credential for its own deletion is one bad agent away from gone.
  *  - SUPABASE_ACCESS_TOKEN — a Supabase *management* PAT. `.env.example` says
  *    in its own comment that it can create and delete projects, which includes
- *    the production one. Nothing on the box needs it; stage 4's Supabase MCP
- *    is pointed at the local stack and gets --read-only.
+ *    the production one. Nothing on the box needs it: the Supabase MCP is
+ *    pointed at the LOCAL stack on a loopback address, which is what makes the
+ *    box able to do without this key at all. It has no --read-only mode — an
+ *    earlier version of this comment said it did — so two of its eleven tools
+ *    write; they just cannot write anywhere that matters.
  *
  * And one that is not here to be added by symmetry: **the local administrator's
  * password**. It is generated per machine into `~/.config/spideryarn/`
@@ -37,6 +41,26 @@ import { createHash } from "node:crypto";
  * The box is shared by many autonomous agents running as one user with
  * passwordless sudo, so "on the box" means "reachable by all of them".
  */
+/**
+ * Allowlisted keys whose VALUE must point at the throwaway container, not just
+ * whose name is on the list above.
+ *
+ * The allowlist matches names, and a name says nothing about where it points:
+ * `DATABASE_URL` is spelled the same whether it is the local Docker stack or
+ * the one production database we have no staging copy of. So the banner
+ * `buildEnvPayload` writes — "production credentials are deliberately absent" —
+ * was a claim nothing enforced, and it would have gone quietly false the first
+ * afternoon somebody pointed `.env.local` at production and then ran a push.
+ * Now the banner is true by construction rather than by habit. Found by GPT
+ * Sol, 2026-08-31.
+ *
+ * `isLocalDatabaseUrl` rather than a fresh test, deliberately: "local" must not
+ * mean one thing to the migrator's guard and another to this one, and that
+ * function already fails closed on a URL it cannot parse and already survives a
+ * loopback address hidden in a password (src/db/ssl.ts).
+ */
+export const MUST_BE_LOCAL: readonly string[] = ["DATABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL"];
+
 export const ALLOWLIST: readonly string[] = [
   "OPENROUTER_API_KEY",
   "OPENAI_API_KEY",
@@ -216,6 +240,21 @@ export function buildEnvPayload(localText: string): EnvPayload {
   }
   const skipped = [...local.keys()].filter((k) => !allowed.has(k)).sort();
 
+  /* Refused, not warned about. A push that went ahead with a note would put
+     production on a box shared by autonomous agents, under a header saying it
+     had not. The KEY is named and the value never is — the host would usually
+     be harmless, but "usually" is not a rule this file can apply to a string it
+     has not parsed. */
+  for (const key of MUST_BE_LOCAL) {
+    const value = pushed.get(key);
+    if (value !== undefined && !isLocalDatabaseUrl(value)) {
+      problems.push(
+        `${key} does not point at the local stack, and this only ever sends local ones. ` +
+          `Point it back at 127.0.0.1, or edit MUST_BE_LOCAL in scripts/gjd-remote-env.ts on purpose.`,
+      );
+    }
+  }
+
   // No timestamp in the banner: it would make every push a change even when
   // nothing changed, and the file's mtime already says when.
   const header = [
diff --git a/tests/doc-links.test.ts b/tests/doc-links.test.ts
index 613a4cc..cb907b6 100644
--- a/tests/doc-links.test.ts
+++ b/tests/doc-links.test.ts
@@ -36,7 +36,13 @@ import path from "node:path";
 import { globSync } from "node:fs";
 import { describe, expect, it } from "vitest";
 
-const DOC_FILES = ["AGENTS.md", ...globSync("docs/**/*.md")];
+// infra/hetzner/README.md is named explicitly rather than picked up by a glob,
+// because it is the only markdown outside docs/ that is a runbook someone
+// follows literally — and it was outside this gate until 2026-08-31, which is
+// exactly how it came to carry a link to a `#mcp-servers` heading that did not
+// exist. A dead anchor there costs more than one in docs/: it is read while
+// building a machine, by someone who cannot yet ask the repo anything.
+const DOC_FILES = ["AGENTS.md", "infra/hetzner/README.md", ...globSync("docs/**/*.md")];
 
 /** Everything that carries prose about the docs in a comment. */
 const SOURCE_FILES = [
diff --git a/tests/gjd-remote-env.test.ts b/tests/gjd-remote-env.test.ts
index 7bb18a2..304f5ad 100644
--- a/tests/gjd-remote-env.test.ts
+++ b/tests/gjd-remote-env.test.ts
@@ -125,3 +125,57 @@ describe("the change report", () => {
     });
   });
 });
+
+/**
+ * The banner `buildEnvPayload` writes says "production credentials are
+ * deliberately absent". Until 2026-08-31 nothing made that true: the allowlist
+ * matches KEY NAMES, and `DATABASE_URL`, `SUPABASE_URL` and `VITE_SUPABASE_URL`
+ * are the same names whether they point at the throwaway container or at the
+ * one production database. Point `.env.local` at production for an afternoon,
+ * run `push-env`, and the box silently gets production — with the file it just
+ * wrote claiming otherwise. Found by GPT Sol, 2026-08-31.
+ */
+describe("the local-only keys", () => {
+  const localEnv = [
+    "OPENROUTER_API_KEY=sk-test",
+    "DATABASE_URL=postgres://postgres:pw@127.0.0.1:54362/postgres",
+    "SUPABASE_URL=http://127.0.0.1:54361",
+    "VITE_SUPABASE_URL=http://127.0.0.1:54361",
+  ].join("\n");
+
+  it("pushes when every one of them is loopback", () => {
+    const got = buildEnvPayload(localEnv);
+    expect(got.problems).toEqual([]);
+    expect(got.pushed.has("DATABASE_URL")).toBe(true);
+  });
+
+  it.each(["DATABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL"])(
+    "refuses when %s points somewhere else",
+    (key) => {
+      const remote = localEnv.replace(
+        new RegExp(`^${key}=.*$`, "m"),
+        `${key}=postgres://u:p@db.prod.example.com:5432/postgres`,
+      );
+      const got = buildEnvPayload(remote);
+      expect(got.problems.join(" ")).toContain(key);
+      // The refusal must not carry the value it is refusing.
+      expect(got.problems.join(" ")).not.toContain("db.prod.example.com");
+    },
+  );
+
+  // The exact shape that defeated a regex version of this check elsewhere in
+  // the repo: userinfo runs to the LAST @, so the host here is the remote one.
+  it("is not fooled by a loopback address sitting in the password", () => {
+    const sneaky = localEnv.replace(
+      /^DATABASE_URL=.*$/m,
+      "DATABASE_URL=postgres://user:p@localhost:5432@remote.example.com/db",
+    );
+    expect(buildEnvPayload(sneaky).problems.join(" ")).toContain("DATABASE_URL");
+  });
+
+  // A key that is absent is a different complaint (`missing`), not this one.
+  it("does not complain about a key that is not there at all", () => {
+    const without = localEnv.replace(/^SUPABASE_URL=.*$/m, "");
+    expect(buildEnvPayload(without).problems.join(" ")).not.toContain("SUPABASE_URL");
+  });
+});
=== NEW FILES ===
--- .mcp.json ---
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "http://127.0.0.1:54361/mcp"
    },
    "vercel": {
      "type": "http",
      "url": "https://mcp.vercel.com"
    },
    "sentry": {
      "type": "http",
      "url": "https://mcp.sentry.dev/mcp"
    }
  }
}
--- scripts/gjd-remote-mcp.ts ---
/**
 * Is the box's Claude Code actually holding the MCP servers this repo declares?
 *
 * Split out from gjd-remote.ts so the parsing can be tested without a network,
 * the same reason gjd-remote-tmux.ts is its own file.
 *
 * ## Why doctor checks this at all
 *
 * Two of the three servers in .mcp.json need an OAuth login that only a human
 * with a browser can do, once per box (`claude mcp login vercel`). Nothing about
 * a box that has not had it done looks wrong: sessions start, tests pass, and an
 * agent simply never has the tool. The failure is an absence, and an absence is
 * exactly what nobody notices. So it becomes a check that goes red.
 *
 * See infra/hetzner/README.md#mcp-servers.
 */

/** What the repo says should be there — derived, never a second hardcoded list. */
export type Declared = { ok: true; names: string[] } | { ok: false; why: string };

/**
 * Read the server names out of a .mcp.json.
 *
 * Every failure here is an explicit `ok: false`, and there is deliberately no
 * path that returns an empty list as a success. An empty list would make the
 * verdict below pass while asserting nothing about anything, which is the shape
 * of bug this repo keeps a document about (docs/reusable/silent-success.md).
 */
export function declaredServers(text: string): Declared {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, why: `.mcp.json is not valid JSON: ${(e as Error).message}` };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, why: ".mcp.json is not an object" };
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (typeof servers !== "object" || servers === null) {
    return { ok: false, why: ".mcp.json has no mcpServers object" };
  }
  const names = Object.keys(servers as Record<string, unknown>);
  if (names.length === 0) return { ok: false, why: ".mcp.json declares no servers" };
  return { ok: true, names: names.sort() };
}

/**
 * A line of `claude mcp list` ends in a status. We want one word from it, and
 * matching on the tick alone is not enough: the box speaks over ssh, and a
 * mangled ✔ would silently turn every server into a failure.
 */
const CONNECTED = /-\s*(?:✔\s*)?Connected\s*$/;

export interface McpVerdict {
  ok: boolean;
  why: string;
}

/**
 * Which of `wanted` does the box report as connected?
 *
 * `listing` is the raw stdout+stderr of `claude mcp list` run on the box. It
 * contains Greg's account-level servers too (Notion, Zapier, …), and those are
 * none of our business — a Notion server needing auth must not redden a check
 * about this repo's three.
 */
export function mcpVerdict(listing: string, wanted: readonly string[]): McpVerdict {
  if (wanted.length === 0) {
    return { ok: false, why: "nothing to check for — refusing to pass by asserting nothing" };
  }
  // A listing that names none of them is a different problem from a listing
  // that names them and says they need a login, and the two want different
  // advice. `claude` missing, ssh failing, the wrong directory: all land here.
  const lines = listing.split("\n");
  const statusOf = (name: string): string | undefined =>
    lines.find((l) => l.startsWith(`${name}: `));

  const missing = wanted.filter((n) => statusOf(n) === undefined);
  if (missing.length === wanted.length) {
    return {
      ok: false,
      why:
        `the box listed none of them (${wanted.join(", ")}) — so this is not a missing login. ` +
        `Has it pulled the commit that added .mcp.json?`,
    };
  }
  const unconnected = wanted.filter((n) => {
    const line = statusOf(n);
    return line === undefined || !CONNECTED.test(line.trimEnd());
  });
  if (unconnected.length > 0) {
    return {
      ok: false,
      why: `${unconnected.join(", ")} not connected — on the box: claude mcp login ${unconnected[0]}`,
    };
  }
  return { ok: true, why: `${wanted.length} connected: ${wanted.join(", ")}` };
}
```
