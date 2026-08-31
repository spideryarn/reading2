# STOP

## BLOCKERS

1. **[P1] `npm run setup` can migrate production.** [setup-local.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/setup-local.ts:96) inherits the shell environment. [db-migrate.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-migrate.ts:60) deliberately prefers an exported `DATABASE_URL` and permits it when `DB_MIGRATE_ALLOW_REMOTE=yes`. Both exports can survive a rebuild in persistent `/home`. That contradicts “local by construction.” The setup wrapper must independently require the local stack and remove the remote opt-in.

2. **[P1] “No production Supabase credential” is false.** [gjd-remote-env.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-env.ts:40) sends `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` based only on their names. [buildEnvPayload](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-env.ts:207) does not verify local values. If the laptop’s `.env.local` ever points at production, the box receives production credentials. Therefore [README.md](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/README.md:466) and the generated-file banner are unsafe claims. Validate against `supabase status`, or generate the local values on the box.

3. **[P1] The Vercel policy is too weak for unattended agents.** [README.md](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/README.md:439) assumes normal mode means every non-denied mutation prompts. It may already be allowed by user/local settings or a permission hook. More importantly, `pause_project` can take production offline and changing deployment protection can expose it. `deploy_to_vercel` publishes code. These should be denied or explicitly forced to ask, not left unmatched. Audit other security-changing tools such as shareable-link creation too.

   Vercel says the MCP receives the same access as Greg’s Vercel account and recommends human confirmation for every workflow. That is incompatible with treating unmatched mutations as safe on an unattended box. [Vercel MCP security guidance](https://vercel.com/docs/agent-resources/vercel-mcp)

4. **[P1] The deny file is a guardrail, not enforcement.** A local/user `allow` cannot override the current denial: permission arrays merge and deny is evaluated first. But an authorized agent can edit or remove the project file, invoke another client, or use Vercel through CLI/browser/API instead. The box’s passwordless sudo also undermines machine-local managed policy. [remote-box.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/remote-box.md:50) must not say this “stops an agent buying things.”

   Real Claude enforcement needs managed policy, including disabling bypass mode; ideally server-managed policy that the box cannot edit. Even that does not constrain non-MCP access. [Claude settings precedence](https://code.claude.com/docs/en/settings), [permission modes](https://code.claude.com/docs/en/permission-modes)

5. **[P1] `doctor` does not “check the lot.”** The submitted version checks machine tools, browser and provisioning—not npm installation, the Supabase stack, migrations, owner seed, fixtures, environment contents, or MCP authentication. The live uncommitted work adds MCP checking only. Therefore [README.md](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/README.md:67) can report a successful rebuild while major First-run work is absent.

6. **[P2] Step 5 is not executable as written.** The sequence says commands run from the laptop, then gives raw `npm ci` and `npm run setup` while saying “on the box.” [README.md](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/README.md:48) needs an explicit SSH/shell command and remote `cd`.

## Direct answers

1. `.mcp.json` is right for Supabase. For Vercel and Sentry it is right only if every clone is intentionally meant to receive them. The stated requirement is box-specific, so user scope is the safer boundary. If provisioned there, use “get/compare/add-if-absent”; do not remove first.

   Current evidence suggests `mcp remove` does not clear OAuth state, and Claude documents clearing authentication as a separate operation—but that is not a contract worth depending on. [Claude MCP authentication](https://code.claude.com/docs/en/mcp)

2. The matcher syntax is right; the policy is not. Deny purchases, pause, protection changes, and probably deployment on unattended sessions. Prefer a least-privilege Vercel identity or project-specific endpoint.

3. Local/user settings cannot override the denial merely by adding `allow`. Editing/removing the project rule can. Document it as advisory defense-in-depth.

4. The order is otherwise sensible: clone → environment → install → local stack/migrate/seed → fixtures → OAuth. The production migration hole is inherited shell state, described above.

5. Other stale or false prose:

   - [gjd-remote-env.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-env.ts:29) says Supabase gets `--read-only`; it exposes two write tools.
   - “Once per box” should be “once per retained `/home` volume, until credentials expire or are revoked.”
   - The exact 11-tool list belongs in dated evidence, not the operational README.
   - “Four kinds” introduces only three grouped categories.
   - The pasted headless OAuth instructions were incomplete; the live tree’s `--no-browser` plus redirect-paste instructions fix that.

JSON parsing and `git diff --check` passed. The doc-link test could not start because the read-only sandbox blocked Vitest’s cache write.