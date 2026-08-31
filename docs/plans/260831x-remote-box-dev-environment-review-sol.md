# STOP

The plan has three blockers. All can produce a green-looking result without proving the claimed environment works.

## Ranked findings

1. **BLOCKER — Certain: `doctor` reports failure but exits successfully.**

   [`cmdDoctor()`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:424) prints red crosses but never accumulates failures or sets a non-zero exit code. Stage 5 can therefore “pass” in automation while Chrome, provisioning, or tools are broken.

   Smallest fix: make every failed assertion set a failure flag, require exactly one final `PROVISION OK` and no `FAIL`, then exit 1. Mutation-test one check. “Goes red” is insufficient; require a non-zero status.

2. **BLOCKER — Certain: Stage 5 cannot prove fresh recovery.**

   A server replacement reattaches the populated `/home`, inheriting the repo, `.env.local`, GitHub configuration, Claude credentials, MCP registrations, and caches. It proves root-disk recreation, not recovery from the laptop sources.

   Worse, [`push-env` happens after cloud-init](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260831x-remote-box-dev-environment.md:126), so `provision.sh` cannot clone a private repo during first boot without violating the secret boundary.

   Smallest fix:

   - Keep `provision.sh` for OS-level setup only.
   - Add a laptop-driven `gjd-remote bootstrap` after `push-secrets`; it configures Git, clones/updates, runs `npm ci`, starts/migrates Supabase, and registers secret-dependent integrations.
   - Test empty-home recovery separately using a disposable server/volume or clean temporary home. Do not claim the ordinary replacement proves it.

3. **BLOCKER — Certain: refusing `.env.prod` does not establish a production boundary.**

   `.env.local` itself contains a Hetzner write token and a Supabase management PAT. The repo already describes the latter as able to create and delete projects ([`.env.example`](/Users/greg/Dropbox/dev/experim/spideryarn2/.env.example:82)). `0600` offers no protection between autonomous sessions: they all run as `greg`.

   Smallest fix: generate the remote `.env.local` from an explicit allowlist. Do not push:

   - `HETZNER_CLOUD_API_TOKEN`
   - `SUPABASE_ACCESS_TOKEN`
   - optional `OPENAI_API_KEY`
   - production Vercel/Sentry management credentials

   Give the box a separate budget-capped OpenRouter key. Add Google’s secret only when testing Google login. The local Supabase MCP is already exposed by the CLI at the local API’s `/mcp` endpoint, so it needs no production PAT ([Supabase MCP documentation](https://supabase.com/docs/guides/ai-tools/mcp)).

4. **HIGH — Certain: the “all code is pushed” durability premise is false in the current workflow.**

   The current checkout reports `main...origin/main [ahead 113]` and has substantial uncommitted work. A fresh clone today would not contain the tree being developed. The remote box will eventually have the same kind of unpushed work.

   Smallest fix: before bootstrap, compare laptop `HEAD`, remote `HEAD`, and `origin/main`, and refuse to describe them as synchronized when they differ. Back up at least remote working trees and `~/.claude` off-box, encrypted. Delete protection does not protect against corruption, compromised credentials, or accidental removal after protection is disabled.

5. **HIGH — Certain: Stage 3 can be green with every Postgres suite skipped.**

   The shared probe deliberately converts an unavailable database into `describe.skip` and only writes a warning ([`pg-ready.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/pg-ready.ts:121)). The deploy code already calls this a hole because the process exits green ([`deploy.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/deploy.ts:380)).

   Smallest fix: add `REQUIRE_POSTGRES=1 npm test`; in that mode `pgReady` must fail, not skip, when the database or required migration is absent. Stage 2 runs without it; Stage 3 requires it.

6. **HIGH — Certain: the “one principle” has the wrong number of layers.**

   The repo and its lockfile are a third source of truth. Putting every non-secret into root provisioning encourages global, drifting installations of project tools and makes Stage 5’s “fold every stage into `provision.sh`” impossible.

   Use three layers:

   - OS provisioning: Docker, `gh`, system packages.
   - Repo bootstrap: `npm ci`, migrations, project scripts and pinned CLI dependencies.
   - Secrets/authentication: laptop push plus explicitly recorded interactive ceremonies such as Claude OAuth.

   A hand-run diagnostic is not a bug. Undocumented state required for recovery is the bug. Provide `gjd-remote reprovision` and `bootstrap` so inconvenient recurring commands do not become SSH folklore.

7. **HIGH — Certain: the proposed GitHub token will not automatically reach Claude sessions.**

   The generated job explicitly notes that non-login execution sources no shell profile, then starts Claude without loading secrets ([`gjd-remote.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:341)). `gh auth setup-git` can configure a helper successfully, but later Git operations still need `GH_TOKEN`; a login-shell test can pass while the actual agent fails.

   Smallest fix: load only the GitHub token file in the generated job before Claude starts, or use a credential helper that reads that file on each invocation. Test `git ls-remote` and `git push --dry-run` from an actual generated tmux job.

8. **HIGH — Certain: the PAT approach is right, but organisation approval has an ambiguous failure mode.**

   Fine-grained PATs are enabled by default. Organisation approval is required by default, except tokens created by an organisation owner are automatically approved. If fine-grained PATs are blocked, the organisation does not appear as a possible resource owner. If approval is pending, the token can read only public resources. A private clone can then say “Repository not found,” which conflates a missing repo with missing permission ([GitHub PAT policy](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization), [clone errors](https://docs.github.com/en/repositories/creating-and-managing-repositories/troubleshooting-cloning-errors)).

   `Contents: Read and write` is sufficient for ordinary Git pushes. Add `Workflows: Read and write` only if agents must change workflow files.

   Use:

   - A short-expiry fine-grained PAT owned by `spideryarn`, selected only for `reading2`.
   - Explicit HTTPS clone: `https://github.com/spideryarn/reading2.git`.
   - No global `url.insteadOf`; it surprises other repos and submodules.
   - `gh auth setup-git --hostname github.com --force`, because the command otherwise fails when it sees no authenticated host ([CLI documentation](https://cli.github.com/manual/gh_auth_setup-git)).

   The laptop’s SSH remote is unaffected because `.git/config` is checkout-local.

9. **HIGH — Certain mechanism, decision needs measurement: do not create one Supabase stack per session.**

   The CLI supports multiple local instances through distinct `project_id`s, workdirs, and ports; `--workdir` is supported and `supabase stop --all` explicitly recognizes multiple instances ([CLI reference](https://supabase.com/docs/reference/cli/getting-started)). But every stack needs unique values for all the fixed `5436x` ports, a different `.env.local`, and different MCP URLs. Supabase recommends roughly 7GB RAM per full stack. N stacks will consume this box quickly.

   Start with one shared stack. Before adding global serialization, run two complete test commands concurrently: the stale global constraint cited by the plan has already been removed, and the repo now has a cross-process advisory lock for job-running suites ([`run-lock.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/run-lock.ts:1)).

   If failures remain, serialize whole Postgres test runs with a mandatory process-wide lock. Note that serializing tests does not exclude a concurrently running dev ingest. If that occurs regularly, use one shared dev stack and one shared test stack—not one per agent.

10. **MEDIUM — Certain: keep Docker on the ephemeral root.**

    Re-pulling 2GB after an intentional rebuild is cheaper than spending scarce pet-volume space on replaceable images and Docker internals. Treat the local database as disposable test data.

    If you do move it, `data-root` alone may silently leave image snapshots under `/var/lib/containerd` on fresh Docker Engine 29+ installations ([Docker daemon documentation](https://docs.docker.com/engine/daemon/)). Verify actual disk use, not only `docker info`.

    Also correct the durability table: `db:reset && db:migrate` restores schema, not local users, Storage objects, ingested articles, or manual database work.

11. **MEDIUM — Certain: extract `provision.sh`, but never pass it through `templatefile()`.**

    The refactor is worthwhile. Use `file()` or preferably `filebase64()` to inject the script literally; HashiCorp explicitly distinguishes `file` as literal from `templatefile`, which interprets every `${...}` ([Terraform documentation](https://developer.hashicorp.com/terraform/language/functions/templatefile)).

    Put Terraform values in a tiny generated JSON/env configuration file or pass constrained arguments. In cloud-init, write the script using base64 encoding. This gives shellcheck, direct reruns, and no Terraform parsing of shell expansions or comments.

    The existing embedded script is already exposed to Terraform because the whole cloud-init file is templated ([`main.tf`](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/main.tf:100)); extraction with literal `filebase64` removes that risk.

12. **MEDIUM — Certain: Stage 4 expands the MCP fleet without resolving the existing capacity warning.**

    The box documentation says the list is deliberately two and warns to argue before adding a third ([README](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/README.md:174)); the plan adds three while the session concurrency cap remains unmeasured ([README](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/README.md:221)).

    Smallest fix: make these opt-in and project-scoped. Use local Supabase at `http://127.0.0.1:54361/mcp?read_only=true&features=database`. Scope Vercel to the project-specific URL and retain human confirmation because its MCP can manage deployments, not merely read logs ([Vercel MCP documentation](https://vercel.com/docs/agent-resources/vercel-mcp)).

## Stage verdict

- Stage 1 is abandonable after `doctor` gains real exit semantics. Its title incorrectly promises “the repo.”
- Stage 2 is abandonable, but use `npm ci`, not `npm install`, and prove it cloned the intended commit.
- Stage 3 is abandonable only with a require-Postgres test mode.
- Stage 4 is optional and should remain optional.
- Stage 5 needs to become two proofs: ordinary root-disk replacement and a separate clean-home recovery drill.

The thing most likely to hurt in three weeks is not Docker image download time. It is discovering that five sessions have unpushed work, stale exported credentials, and different assumptions about the single database while the green doctor still exits zero.