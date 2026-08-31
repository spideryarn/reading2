# Review: MCP servers for the remote box, and the setup docs

You are reviewing a small change to a repo called Spideryarn. It is documentation plus two config
files. Be adversarial: I want defects, not encouragement. Say STOP if anything here would mislead
somebody rebuilding this machine, or would let an autonomous agent do something it should not.

## The situation

Greg runs an always-on Hetzner box where many autonomous Claude Code sessions work in parallel on
this repo. The server is disposable; a 50GB volume is bind-mounted over `/home` and survives being
destroyed and recreated. He asked for two things: (1) make sure setting all this up again in future
is documented and/or scripted, and (2) a step-by-step for the MCP servers that will be easy to
reproduce on future boxes.

## What I did

**Docs.** Filled in `infra/hetzner/README.md`'s `## First run`, which was an EMPTY heading — the one
section a second box would need most. Added `## What a fresh clone cannot do` (the owner-seed step
and the gitignored article fixtures, neither of which was written down anywhere a person would
look; the fixture rsync command existed only in a chat transcript). Added `## MCP servers`.

**Config, both newly committed to the repo.** `.mcp.json` at project scope registers three HTTP MCP
servers so a new box gets them from `git clone` rather than from the provisioning script.
`.claude/settings.json` gains `enabledMcpjsonServers` (so the three do not sit at "Pending approval"
for every session) and a `permissions.deny` list for Vercel's three purchase tools.

## What I verified, and how — do not take these on trust, but do not re-derive them either

- `https://mcp.vercel.com` → HTTP 401 `invalid_token`; `https://mcp.sentry.dev/mcp` → HTTP 401. So
  OAuth, and there is no static-token path for either.
- The local Supabase MCP at `http://127.0.0.1:54361/mcp` answers `initialize` (serverInfo `supabase`
  0.10.0) with no auth, and `tools/list` returns 11 tools, two of which write (`execute_sql`,
  `apply_migration`). Port 54361 comes from `supabase/config.toml`, which is in git, so the same URL
  is correct on every machine that runs this repo's stack.
- The deny matcher, from the Claude Code 2.1.251 binary's own help string: "Use 'mcp__<server>' to
  deny one server's tools ('mcp__<server>__<tool>' for one tool), or 'mcp__*' to deny every MCP
  server's tools." NOTE the whole-server form has no trailing `__*`. I had guessed `mcp__vercel__*`
  and that would have denied nothing.
- After writing the deny list, `mcp__vercel__buy_pro`, `buy_domain` and `buy_credits` disappeared
  from my own live session's toolset. So it binds from project scope.
- `gjd-remote` (the CLI that launches sessions on the box) passes no `--dangerously-skip-permissions`
  anywhere, so sessions run in normal permission mode and a deny list is not theatre.
- `/home` is `/dev/sdb`, the volume. `~/.claude/.credentials.json` and `~/.claude.json` are under it,
  so a rebuild does not force MCP re-authentication.

## What I could NOT establish, and want your view on

Whether `claude mcp remove <name>` followed by `claude mcp add <name>` destroys that server's OAuth
credential. It matters because the provisioning script's existing helper for the two browser MCPs
does remove-then-add for idempotence, and if that pattern were copied for the HTTP servers, every
re-provision might silently log the box out of Vercel and Sentry. I sidestepped it by putting the
three in `.mcp.json` instead of the provisioning script — but tell me if you think that sidestep is
hiding the problem rather than removing it.

## Questions I specifically want answered

1. **Is `.mcp.json` in git the right call**, versus registering these in `infra/hetzner/provision.sh`
   at user scope like the two browser MCPs? The committed file reaches every clone — including the
   deploy gate's worktree and any future contributor — not just this box. Argue the other side.
2. **Is the deny list right?** I denied only the three purchase tools. I deliberately did NOT deny
   `deploy_to_vercel`, `pause_project` or `update_project_deployment_protection`, on the grounds
   that they are real work and will prompt anyway. Is that the wrong trade for a box running
   unattended agents?
3. **Can a session on that box get round the deny list** — by writing `.claude/settings.local.json`,
   by user-scope settings, or by any other means? An agent that can edit the repo can edit
   `.claude/settings.json`. Does that make this advisory rather than enforcing, and if so should the
   doc say so instead of implying it is a control?
4. **Does the README's First run sequence hold?** Particularly: is any step out of order, and is
   there a step that could point a database migration at production? There is one production
   database and no staging copy, so that specific failure is the one that matters most.
5. Anything in the prose that is now false, or that duplicates a fact that lives somewhere else and
   will therefore go stale.

## The diff

```diff
diff --git a/.claude/settings.json b/.claude/settings.json
index fc73cdd..d5271a1 100644
--- a/.claude/settings.json
+++ b/.claude/settings.json
@@ -11,5 +11,17 @@
         ]
       }
     ]
+  },
+  "enabledMcpjsonServers": [
+    "supabase",
+    "vercel",
+    "sentry"
+  ],
+  "permissions": {
+    "deny": [
+      "mcp__vercel__buy_pro",
+      "mcp__vercel__buy_domain",
+      "mcp__vercel__buy_credits"
+    ]
   }
 }
diff --git a/.gitignore b/.gitignore
index d3ca82e..bda8f71 100644
--- a/.gitignore
+++ b/.gitignore
@@ -26,3 +26,9 @@ scratch-bakeoff
 # a scan for `sk-or-v1-`, `sb_secret_` and `ANTHROPIC_API_KEY=`. The review it
 # produced belongs in git; the log of how it got there does not.
 *.activity.log
+
+# @playwright/mcp writes here when it runs with a non-isolated profile — traces,
+# a user-data dir, whatever a session downloaded. It appeared in the box's
+# checkout, not on any laptop, so it would only ever be committed by accident
+# from over there.
+.playwright-mcp/
diff --git a/docs/plans/260831x-remote-box-dev-environment.md b/docs/plans/260831x-remote-box-dev-environment.md
index 82ec8a6..847c934 100644
--- a/docs/plans/260831x-remote-box-dev-environment.md
+++ b/docs/plans/260831x-remote-box-dev-environment.md
@@ -288,6 +288,45 @@ credentials must be told to run against a scratch config with fake tokens, and I
 Note this token is the *laptop's*, and unrelated to the box's — see stage 2, where the box gets its
 own tokens and never runs `gh auth login`.
 
+**2026-08-31, stage 4 landed, and it needed no provisioning code at all.** The three service MCPs
+are in a committed [`.mcp.json`](../../.mcp.json) at project scope, so a new box gets them from
+`gjd-remote clone` rather than from `provision.sh`. That is fewer moving parts than the plan
+assumed: nothing to add to the provisioning script, nothing that can drift between a box built
+today and one built next year, and the browser MCPs stay where they are because they genuinely are
+per-machine.
+
+Measured rather than assumed, all on 2026-08-31:
+
+- The local Supabase MCP serves **11 tools** (`tools/list` over curl, `serverInfo` `supabase`
+  0.10.0): `search_docs`, `list_tables`, `list_extensions`, `list_migrations`, `apply_migration`,
+  `execute_sql`, `query_logs`, `get_advisors`, `get_project_url`, `get_publishable_keys`,
+  `generate_typescript_types`. Two of them write, and it is loopback-only, so it cannot reach
+  production — which is the thing that lets the `push-env` allowlist keep leaving
+  `SUPABASE_ACCESS_TOKEN` behind.
+- `https://mcp.vercel.com` → HTTP 401 `invalid_token`. `https://mcp.sentry.dev/mcp` → HTTP 401.
+  OAuth is the only way into either; there is no static-token path.
+- **`sentry-error-monitoring.md` was wrong** and has been corrected. It said "There is no Sentry
+  MCP" — in a doc whose own opening lesson is *check before concluding we do not have this*.
+- A project-scope server otherwise leaves every session at `⏸ Pending approval`. Seen on the box,
+  fixed with `enabledMcpjsonServers` in `.claude/settings.json`, and confirmed absent on the laptop
+  afterwards.
+
+**The deny syntax is not what it looks like.** The whole-server form is **`mcp__vercel`**, with no
+trailing `__*`, from the 2.1.251 binary's own help string: *"Use 'mcp__<server>' to deny one
+server's tools ('mcp__<server>__<tool>' for one tool), or 'mcp__*' to deny every MCP server's
+tools."* I had guessed `mcp__vercel__*` when briefing the spike, and it would have silently denied
+nothing. Vercel's `buy_pro`, `buy_domain` and `buy_credits` are now denied in
+`.claude/settings.json`, and the proof is that they vanished from this session's own toolset the
+moment the file was written. `gjd-remote` passes no `--dangerously-skip-permissions`, so the deny
+list genuinely binds on the box.
+
+**A rebuild does not force re-authentication.** `~/.claude/.credentials.json` and `~/.claude.json`
+are under `/home`, `findmnt /home` reports `/dev/sdb`, and that is the volume. So the two
+`claude mcp login` runs are a once-per-*box* ceremony, not a once-per-`apply` one.
+
+**Still manual, and unavoidably so:** `claude mcp login vercel` and `claude mcp login sentry`, in a
+browser, by Greg. Nothing else in stage 4 needs a human.
+
 ## The `provision.sh` refactor — approved, with a correction
 
 Extract it from the cloud-init heredoc into `infra/hetzner/provision.sh`, so it is shellcheck-able
diff --git a/docs/project/remote-box.md b/docs/project/remote-box.md
index 3767ba9..9b0bb65 100644
--- a/docs/project/remote-box.md
+++ b/docs/project/remote-box.md
@@ -44,6 +44,10 @@ and tmux refused the second one; on a box meant to hold many parallel sessions t
 - [`scripts/remote-smoke-browser.mjs`](../../scripts/remote-smoke-browser.mjs) — the committed proof
   the browser stack works. `gjd-remote doctor` copies it up and runs it every time, so it is never a
   stale copy.
+- [`.mcp.json`](../../.mcp.json) — the `supabase`, `vercel` and `sentry` MCP servers, at project
+  scope so they arrive with the clone rather than with provisioning. The two OAuth logins, the deny
+  list that stops an agent buying things, and why Supabase needs no credential are in
+  [infra/hetzner/README.md § MCP servers](../../infra/hetzner/README.md#mcp-servers).
 
 **Doing things on it**
 
diff --git a/docs/project/sentry-error-monitoring.md b/docs/project/sentry-error-monitoring.md
index fa36ca7..6638213 100644
--- a/docs/project/sentry-error-monitoring.md
+++ b/docs/project/sentry-error-monitoring.md
@@ -14,7 +14,11 @@ The other two places to look are in [debugging.md](debugging.md).
 
 ## How to look at it
 
-There is no Sentry MCP, so this one is a browser tab rather than a tool call. `SENTRY_ORG` and
+**There is a Sentry MCP**, at `https://mcp.sentry.dev/mcp`, and this repo registers it in
+[`.mcp.json`](../../.mcp.json) — so this is a tool call once you have run `claude mcp login sentry`
+in a browser, and a browser tab until you have. This doc said the opposite until 2026-08-31, which
+is the mistake in its own opening paragraph made a second time: the Sentry MCP had shipped and
+`claude mcp add --help` was already using it as its worked example. `SENTRY_ORG` and
 `SENTRY_PROJECT` are set on the Vercel project (`npx vercel env ls production` lists them; the values
 are encrypted, so read them from the Sentry UI or ask Greg).
 
diff --git a/infra/hetzner/README.md b/infra/hetzner/README.md
index c654857..b5175fc 100644
--- a/infra/hetzner/README.md
+++ b/infra/hetzner/README.md
@@ -57,11 +57,11 @@ Then, in this order, from the repo root on the laptop:
 4. **Send the environment.** `npx tsx scripts/gjd-remote.ts push-env` — allowlisted key names only,
    rebuilt on the box rather than copied, and it prints what it skipped. It writes *into the
    checkout*, so it has to come after the clone and not before it.
-5. **Build it, on the box.** `npm ci`, then `npm run db:start` (first run pulls ~2GB of Docker
-   images), `npm run db:migrate`, and **`npm run db:seed-owner`** — all four, in that order.
-   The last one is the one everybody misses; see
-   [What a fresh clone cannot do](#what-a-fresh-clone-cannot-do) and
-   [supabase-local.md](../../docs/project/supabase-local.md).
+5. **Build it, on the box.** `npm ci`, then **`npm run setup`**
+   ([`scripts/setup-local.ts`](../../scripts/setup-local.ts)), which runs the local Supabase stack,
+   the migrations and the owner seed in the one order that works. The first run pulls ~2GB of Docker
+   images. `npm ci` stays outside it on purpose — you cannot run the script before installing.
+   It is the same command on the laptop, which is why it is the one that gets exercised.
 6. **Copy the article fixtures**, which git does not carry — same section.
 7. ⚑ **Authenticate the MCP servers** that need it — [MCP servers](#mcp-servers).
 8. **Check the lot:** `npx tsx scripts/gjd-remote.ts doctor`. It exits non-zero if anything failed,
@@ -407,6 +407,67 @@ start-vnc                                 # on the box
 Then open <http://localhost:6080/vnc.html>. Nothing listens on a public port for this — Xvfb,
 x11vnc and websockify are all bound to localhost and reached through the tunnel.
 
+## MCP servers
+
+Four kinds, and only one of them needs anything from a human.
+
+**Greg's account brings its own.** Canva, Zapier, Google Calendar, Gmail, Drive, Notion arrive on
+any machine he logs into and need nothing per-box. Do not register them here and do not count them
+when someone says the list is too long.
+
+**The two browser servers are provisioned.** `playwright` and `chrome-devtools`, at *user* scope,
+pinned and heap-capped by [`provision.sh`](provision.sh) — see its `=== mcp servers ===` block, and
+[browser-control.md](../../docs/project/browser-control.md) for what they can and cannot prove.
+
+**The three service servers travel in git**, in [`.mcp.json`](../../.mcp.json) at the repo root, so a
+new box gets them from `gjd-remote clone` and no provisioning code has to know about them:
+
+| | url | credential |
+|---|---|---|
+| `supabase` | `http://127.0.0.1:54361/mcp` | none — it is the local stack |
+| `vercel` | `https://mcp.vercel.com` | OAuth, in a browser |
+| `sentry` | `https://mcp.sentry.dev/mcp` | OAuth, in a browser |
+
+A project-scope server normally makes every session sit at `⏸ Pending approval` until someone
+approves it interactively. `enabledMcpjsonServers` in
+[`.claude/settings.json`](../../.claude/settings.json) pre-approves these three by name, which is
+why nobody gets a modal. That file is also where the deny list lives, and JSON cannot hold a comment
+saying why, so it is here instead: **Vercel's MCP can spend money** — `buy_pro`, `buy_domain`,
+`buy_credits` — and an autonomous agent must never reach them. The matcher is
+`mcp__<server>__<tool>` for one tool, **`mcp__<server>` with no trailing wildcard** for a whole
+server, and `mcp__*` for all of them; `mcp__vercel__*` is not the syntax, however much it looks like
+it. `deploy_to_vercel`, `pause_project` and `update_project_deployment_protection` are deliberately
+*not* denied — they are real work, and sessions here run in normal permission mode (there is no
+`--dangerously-skip-permissions` anywhere in `gjd-remote`), so they prompt.
+
+### ⚑ The one manual step, per box
+
+```
+ssh -t greg@<ip>
+cd ~/code/spideryarn2
+claude mcp login vercel     # prints a URL; open it on the laptop, approve, come back
+claude mcp login sentry
+claude mcp list             # both must now say ✔ Connected, not ! Needs authentication
+```
+
+**A rebuild does not undo this.** The tokens are in `~/.claude/.credentials.json` and
+`~/.claude.json`, `/home` is the volume (`findmnt /home` says `/dev/sdb`), and the volume outlives
+the server. So this is a once-per-*box* ceremony, not a once-per-`apply` one.
+
+### Why Supabase needs no credential, and what that buys
+
+It is the **local** stack's own MCP on a loopback address, not Supabase's hosted one, so it is
+structurally incapable of reaching production — there is no production Supabase credential on the
+box at all, which is what lets `push-env`'s allowlist leave `SUPABASE_ACCESS_TOKEN` behind
+([`scripts/gjd-remote-env.ts`](../../scripts/gjd-remote-env.ts)). It serves 11 tools, verified by a
+`tools/list` call on 2026-08-31: `search_docs`, `list_tables`, `list_extensions`, `list_migrations`,
+`apply_migration`, `execute_sql`, `query_logs`, `get_advisors`, `get_project_url`,
+`get_publishable_keys`, `generate_typescript_types`.
+
+Two of those write. They cannot touch production, but the box runs one Supabase stack shared by
+every session on it, so `execute_sql` there is somebody else's data as well as yours —
+[supabase-local.md](../../docs/project/supabase-local.md).
+
 ## What a fresh clone cannot do
 
 Two things a green `git clone` does not give you. Both were found by running the suite on a new box,
@@ -415,7 +476,8 @@ not by reading anything, and both fail in ways that do not name the cause — th
 
 **`npm run db:seed-owner`.** A freshly migrated database has no owner row, so every insert carrying
 an `owner_id` dies on a foreign key. It cost 18 failing test files and the error names neither the
-constraint nor the fix.
+constraint nor the fix. **`npm run setup` now runs it for you** — that script exists because of this
+— so this one is only a trap if you assemble the steps by hand.
 
 **The article fixtures.** `data/` and `output/` are gitignored — about 62MB and 11MB — and roughly
 19 test files need an article with both `blocks.json` and `tree.json`. Only two of the nineteen say
=== NEW FILE .mcp.json ===
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
```
