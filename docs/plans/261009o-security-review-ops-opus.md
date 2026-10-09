# Security review: operations and agents (Opus subagent, read-only, 2026-10-09)

Up: [261009o](261009o-security-risks-register-and-a-security-review.md). The reviewer's report, kept
as returned apart from layout. Its findings were checked by the session before they went into
[security-risks.md](../project/security-risks.md) (R6–R9, R11, R12, R16–R18). No secret's value was
read or printed; keys were told apart by prefix.

## Findings

1. **Two allow rules in the project settings let any session skip the safety check, and one runs
   any command.** `.claude/settings.json` allows `Bash(npx tsx scripts/tmux-job.ts:*)` and
   `Bash(npm run deploy:*)`; `tmux-job.ts` runs whatever command follows it. Every agent session
   runs `claude --permission-mode auto`, including the feedback-report sessions, so the per-command
   classifier is the only technical check, and an allow rule skips it. High. Fix: delete both;
   give deploy to the Overseer's own launch. ~15 minutes. VERIFIED.
2. **`.env.prod` on the box holds the `postgres` password and the production service-role key, and
   both are used routinely.** `DATABASE_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SPIDERYARN_MIGRATOR_PASSWORD`, `SPIDERYARN_APP_PASSWORD`; `scripts/deploy-checks.ts`
   `migratorUrlFrom` builds `postgres.<ref>` with `DATABASE_PASSWORD`, called from
   `scripts/deploy.ts` and `scripts/feedback-shipped-emails.ts`; nothing reads
   `SPIDERYARN_MIGRATOR_PASSWORD`. One `cat` gives `postgres` (every table and `auth`), the
   service-role admin API (a sign-in link for any reader) and Storage admin. High. Fix: migrator
   URL to `spideryarn_migrator`, the emails job to `spideryarn_app`, both keys off the box, rotate
   the `postgres` password. ~2 h + ~15 min of Greg's. VERIFIED for the file and code; UNVERIFIED
   whether `spideryarn_migrator` exists in production with enough grants.
3. **A full live Stripe secret key is on the box.** `STRIPE_SECRET_KEY` starts `sk_live`, not
   `rk_live`; `push-env`'s allowlist refuses live keys for `.env.local` but `.env.prod` bypasses it.
   An injected agent could read customers' details, refund or cancel, create coupons. Medium. Fix:
   a restricted key for Products and Prices only, or run `stripe:setup --prod` from the Mac.
   ~10 min. VERIFIED (prefix).
4. **The Vercel deny list names tools that don't exist.** Denied: `buy_domain`,
   `update_project_deployment_protection`, `pause_project`; asked: `deploy_to_vercel`. Real names:
   `buy_domains`, `buy_single_domain`, `update_project_protection_bypass`, `create_deployment`,
   `edit_project_env`, `create_project_env`, `request_promote`, `update_firewall_config`,
   `put_firewall_config`, `create_drain`. `~/.claude/.credentials.json` holds MCP OAuth tokens for
   `vercel` and `sentry`, and `enabledMcpjsonServers` turns both on everywhere. Medium. Fix: deny
   all Vercel tools and allow back the reads, or drop it from `enabledMcpjsonServers`. ~15 min.
   VERIFIED; the token's scope not reviewed.
5. **One user, passwordless sudo, one shared tmux server.** `sudo -n -l` shows
   `(ALL) NOPASSWD: ALL`; all sessions share `/tmp/tmux-1000/default`; the fleet dashboard trusts a
   self-declared `speaker` and an `Origin` that local `curl` can forge. A report session can
   `tmux send-keys` into the Overseer, a peer's permission dialog, or Greg's session. Known (A7);
   raise to High, since overseer-direction.md's trigger has been met. Fix: untrusted-input sessions
   as a second Unix user with no sudo, no read of `~greg`, its own tmux socket. ~1 day + ~30 min of
   Greg's. VERIFIED.
6. **Nothing mechanical protects `main`, and the Overseer auto-deploys whatever reaches `dev`.** No
   hooks; the GitHub token in `/etc/github-tokens/` is reachable through the credential helper;
   `~/.local/share/com.vercel.cli/auth.json` is a full Vercel CLI login, so `npx vercel deploy
   --prod` skips git and every gate. Known; raise to High. Fix: 260902b's `pre-push` hook; a GitHub
   ruleset on `main`; the Vercel login under the Overseer's own user (needs 5). VERIFIED locally;
   GitHub rulesets not reviewed.
7. **The Overseer and the fleet dashboard run code from the shared, writable primary checkout**
   (`overseer.service` and `fleet-dashboard.service` `WorkingDirectory`). An uncommitted edit there
   runs with the Overseer's authority at the next restart. Low. Fix: a separate checkout at a
   pinned commit. ~1 h. VERIFIED.
8. **`/etc/overseer-secrets.env` is root-owned 0600 but protects nothing**: the unit runs as `greg`
   and `/proc/<pid>/environ` is readable by `greg`; it holds `OPENROUTER_API_KEY`, also in
   `.env.local`. Low. Fix: say so, or a separate service user. VERIFIED (names only).
9. **A stray `http-server` on 0.0.0.0:8791 for over two days**, serving a scratchpad fixture.
   Low. Fix: stop it; have box-tidy reap scratchpad listeners. VERIFIED.

## Attack paths, from hostile bytes to a privileged action

1. **A reader's feedback text → a report session → privileged actions.** The daemon's sweep job is
   not authorised (`OVERSEER_JOBS_ENABLED=0`); the sweep and `fb…` sessions are interactive auto-mode
   sessions. In the way: the model's own "the reader's words are data" (a prompt, not a boundary),
   and the auto-mode classifier, which findings 1 and 4 bypass. Beyond those, nothing: `.env.prod`
   is readable (2, 3), `git push …:main` works (6), deploy is pre-approved (1), `tmux send-keys`
   reaches peers (5), and outbound traffic is open (the Hetzner firewall has inbound rules only).
   Provenance checking stops a forged *admin* report being obeyed; it does nothing about injection
   inside a reader's report.
2. **A stranger's article or PDF → an agent debugging it.** `src/injection-scan.ts` is advisory and
   does not read PDFs. An agent reading stored prose, or a browser subagent, stands where path 1
   does.
3. **A web page fetched by an agent.** WebFetch passes the page through a small model first, which
   weakens an injection but does not stop it; a browser snapshot reaches the agent verbatim. The
   same as path 1.

## Checked and sound

`.env.local` and `.env.prod` are 0600 (all 16 worktree copies too); `.env.prod` exists only in the
primary; the world-readable `/tmp/run-codex-envlocal-*` files are `PATH=`-only fixtures inside 0700
directories. The local Stripe key is `sk_test`; `push-env` refuses live Stripe keys and
`HETZNER_CLOUD_API_TOKEN`; `SUPABASE_ACCESS_TOKEN` on the box is Greg's documented, accepted risk.
`/etc/github-tokens` is 0700 with 0600 files; the Stripe CLI and `gh` hold no login. The second
login user has no home and cannot reach `/home/greg`. `sshd` refuses passwords and root; unattended
upgrades are on. The Terraform firewall allows only 22, mosh and ping inbound; the Supabase ports
bind 0.0.0.0 behind it; the fleet dashboard binds loopback and the tailnet address. The Supabase MCP
is the local stack. `run-claude --access read-only` uses `--restricted` and `--strict-mcp-config`.
Sentry's `beforeSend` builds events from an allowlist. The browser MCP servers are pinned. Five
packages in the lockfile have install scripts (esbuild ×3, `@sentry/cli`, `fsevents`).

## Not reviewed

GitHub rulesets; the Vercel CLI and Vercel MCP token scopes; Supabase production roles and grants;
Stripe and Resend key restrictions; whether the Hetzner firewall matches Terraform; outbound
filtering on the host; production backups; Greg's Mac.
