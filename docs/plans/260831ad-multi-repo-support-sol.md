The right v1 is smaller than the proposal: let cwd identify a repository, but never derive the remote path from the local directory name. Use the GitHub `owner/repo` as identity, keep a typed repo-policy map inside `gjd-remote`, refuse unknown env policies, use fixed non-colliding ports, and do not auto-clone or introduce a version manager yet.

Two concrete findings matter immediately:

- The Supabase stacks already collide on `edge_runtime.inspector_port = 8083`: [Spideryarn](/Users/greg/Dropbox/dev/experim/spideryarn2/supabase/config.toml:478), [hellozenno](/Users/greg/Dropbox/dev/experim/hellozenno/supabase/config.toml:258).
- I compared hellozenno’s env values without printing them. Its main URLs are loopback, but several credentials are identical to values in `.env.prod`, including provider keys, `FLASK_SECRET_KEY`, and a Supabase password. Its `.env.local` must not be copied or allowed wholesale.

## A. The local→remote mapping

Cwd is the right source of repository identity. It is the wrong source of the remote directory name.

Model this as two separate decisions:

1. What repository did the caller mean?
2. Where is that repository checked out on this box?

Repository identity should be the normalized GitHub `owner/repo` from `origin`, accepting local HTTPS and SSH forms. That makes `spideryarn2` versus `reading2`, duplicate local checkouts, and colliding basenames irrelevant.

Recommended resolution:

1. `--dir`: an explicit path on the box. Inspect its remote origin and report it. Arbitrary directories such as `~` remain allowed for `new`/`shell`, but not `push-env`.
2. New `--repo owner/repo`: useful outside a checkout and less ambiguous than a path-valued environment variable.
3. `GJD_REMOTE_REPO`, temporarily for compatibility. If cwd is a repo and the path resolves to a different repo, refuse and require explicit `--dir`; an invisible environment override must not redirect hellozenno work into Spideryarn.
4. Otherwise identify the repo from cwd.

Once there is an identity:

1. Use a typed policy override, e.g. `spideryarn/reading2 → /home/greg/code/spideryarn2`.
2. Search direct checkouts under `/home/greg/code` by normalized origin. Exactly one match wins.
3. If none exists, propose `/home/greg/code/<github-repo-name>`.
4. If that path exists with another origin, fail.
5. If several checkouts of the same origin exist, fail rather than choosing.

Keep the flat directory layout for now. `/home/greg/code/<owner>/<repo>` is more collision-proof, but changing the existing layout solves a hypothetical problem that loud collision detection already handles.

Special cases:

- Subdirectory: normal; `--show-toplevel` works.
- Git worktree: maps to the same remote repository identity. Do not imply that its local branch will be selected remotely; print the remote branch/HEAD.
- Submodule: refuse implicit selection because both the submodule and its parent are plausible:
  > cwd is inside submodule gregdetre/gjdutils of spideryarn/hellozenno. Refusing to guess. Run from the parent, or pass `--repo`/`--dir`.
- Outside Git:
  > `/path` is not inside a Git checkout, so I cannot choose a repository. Run from one, or pass `--repo owner/name` or `--dir <box-path>`.
- Missing remote checkout:
  > `spideryarn/hellozenno` is not checked out on the box. Expected `/home/greg/code/hellozenno`. Run: `gjd-remote clone spideryarn/hellozenno`. No session was created.
- Wrong repo at the destination:
  > Refusing `/home/greg/code/hellozenno`: asked for `spideryarn/hellozenno`, found `someone/other-repo`. Nothing was changed.

Do not add committed `.gjd-remote.json` for paths. Remote paths are laptop/box policy, not properties of a Git repository. For v1, do not add `~/.config/gjd-remote/repos.json` either: it would be untyped, unreviewed, and another file that can disappear. Put the two exceptional mappings in a typed registry beside the tool.

Represent the result as a discriminated union: a verified repository target, or an explicit arbitrary directory. That prevents `push-env` from accidentally accepting the latter.

## B. `push-env` and the allowlist

Choose option iii for v1: a typed policy map in the tool, keyed by canonical `owner/repo`.

The current allowlist is already deliberately testable and fail-closed in [gjd-remote-env.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-env.ts:11). Generalize it to something like:

```ts
type RepoEnvPolicy =
  | { mode: "disabled"; reason: string }
  | { mode: "enabled"; rules: readonly EnvRule[] };
```

No entry means refusal, never “push nothing”:

> `push-env` is disabled for `owner/repo`: no sending-side policy exists. No file was read and nothing was written.

Why not the other choices:

- A committed target-repo allowlist lets code being sent to the box enlarge its own secret entitlement. It is useful documentation, not a security authority.
- A laptop JSON file is on the correct side of the boundary, but loses types, review, tests, and reproducibility.
- The tool-owned map is small, reviewed, typed, and already where the security mechanism lives.

An allowlist of names is no longer enough. Add per-key value rules:

- `DATABASE_URL`: exact literal loopback host and the repo’s assigned port. Reject DNS names, hosted URLs, and unexpected ports.
- `SUPABASE_URL` and `PUBLIC_SUPABASE_URL`: exact loopback URL and assigned API port.
- `USE_LOCAL_TO_PROD`: exactly `0`.
- Local Supabase credentials: use known local-demo values or derive them from the local stack; do not accept an arbitrary value merely because its key is allowed.
- Provider API keys: allowed only by explicit policy. Prefer dedicated, capped, revocable box keys soon.
- `FLASK_SECRET_KEY`: generate a box-local development value; do not push the current value because it matches `.env.prod`.
- Management/deployment credentials such as `HETZNER_CLOUD_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`, and production deployment tokens: globally forbidden even if mistakenly added to a repo policy.

Do not reject every value also found in `.env.prod`. That would block legitimately shared provider keys while pretending all unmatched values are safe. Key-specific meaning is the real control.

Keep the exact `.env.local` filename rule, but strengthen it:

- The source must be a regular, non-symlink file directly in the selected local repo root.
- The destination must be `.env.local` in a remote checkout whose origin matches that same repo.
- `--file` must not cross repository roots.
- Continue reconstructing, atomically replacing, byte-reading back, reparsing, and checking mode `0600`; those guarantees are good [existing behaviour](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:888).
- `doctor` should fail if `.env.prod*`, `.env.security`, `.env.local_to_prod`, or another policy-forbidden env file exists on the box. The local siblings are gitignored and therefore harmless until someone explicitly copies them.

The fundamental boundary remains: any credential sent to this box is available to every agent. Repo-specific files do not create repo-specific confidentiality. If hellozenno ever needs credentials that Spideryarn agents must not possess, the answer is separate Unix users or separate boxes—not a cleverer allowlist.

## C. Collisions between concurrent repos

| Resource | Present state | Recommendation |
|---|---|---|
| Supabase host ports | Actual `8083` collision | Give every enabled port a unique assignment, not merely the 5432x block. |
| Supabase `project_id` | Distinct | Good; check uniqueness because it namespaces containers and persistent state. |
| Supabase CLI | One global pinned version | Verify both repos with that exact version. A compatible config cannot be assumed. |
| Vite | Both default to 5173 | Reserve 5173 for Spideryarn and 5174 for hellozenno; make URLs agree. |
| Flask | hellozenno uses 3000 | Reserve it explicitly. |
| Preview/e2e | hellozenno uses 4173 [here](/Users/greg/Dropbox/dev/experim/hellozenno/frontend/playwright.config.ts:3) | Reserve/check it during tests. |
| Storybook | 6006 | Reserve/check it when started. |
| Startup scripts | hellozenno kills whatever owns its ports | Must change. [It currently uses `lsof … | kill -9`](/Users/greg/Dropbox/dev/experim/hellozenno/scripts/local/run_backend.sh:30). Refuse a foreign owner instead. |
| Headless browser MCPs | Already isolated and headless | Multiple Chrome processes are fine; memory is the limit. Provisioning explicitly uses `--isolated` [here](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/provision.sh:434). |
| Repo Playwright tests | Not covered by the global MCP setup | hellozenno expects its own Playwright browser but provisioning intentionally installs no bundled Chromium. Configure its tests to use system Chrome, or install the lockfile-matched browser explicitly. |
| Xvfb/noVNC | One shared display and one input stream | Treat headed use as single-user. It is not needed for normal headless MCP work. |
| Docker | One daemon, global images/build cache/resources | Fine, but forbid indiscriminate prune commands and report disk/RAM pressure. |
| Docker data | Images on disposable root; Supabase data on persistent `/home` | Correct. Do not move Docker’s data root. |
| `/home` | 50GB for repos, caches, venvs, modules, Supabase data | `doctor` should report bytes and inodes for both `/home` and `/`; warn before either becomes operationally tight. |
| Claude config/auth | Shared user state | Expected. Keep repo MCPs project-scoped; detect name clashes with user-scoped MCPs. |
| Git identity/helper | Shared but intentionally identical | Fine. Token availability is repo/owner-specific. |
| Same checkout/branch | Agents can overwrite, stage, commit, regenerate, or truncate each other’s files | Warn when another session has the same `GJD_REMOTE_DIR`. Do not solve with worktrees yet. |
| Logs/generated files | hellozenno truncates shared logs and regenerates a committed types file on frontend startup | Concurrent sessions in the same checkout will interfere even if network ports do not. |
| Public listeners | A dev server bound to `0.0.0.0` is internet-facing | `doctor` should fail on unexpected non-loopback listeners. |
| Laptop tunnels | `tunnel` is fixed to 6080 | Add a boring `tunnel LOCAL:REMOTE` soon, with `ExitOnForwardFailure=yes`. |
| GitHub tokens | Stored under disposable `/etc/github-tokens` [here](/Users/greg/Dropbox/dev/experim/spideryarn2/infra/hetzner/provision.sh:351) | A rebuild loses them. Move them to protected persistent `/home` storage or make restoration an explicit failed doctor check. |
| CPU/RAM/processes | Every Claude session can spawn several MCP and Chrome processes | Report counts, memory and swap; do not build a scheduler until contention is observed. |

`doctor` should have two layers:

- `doctor box`: base tools, provisioning status, Docker, browser, filesystem capacity, exposed listeners, global MCPs and Git configuration.
- `doctor repo`: checkout origin, submodules, env policy, forbidden files, runtime/venv, setup proof, project MCPs, assigned ports and running service ownership.

Plain `doctor` should run the box checks plus the current repo. `doctor --all` can later run every repo in the typed registry.

## D. Toolchain provisioning

Use a hybrid of (a) and (b):

- `provision.sh` owns stable machine capabilities: Python 3.12, `venv`, required compiler/system libraries, Node, Docker, Chrome, Supabase CLI.
- Each repo owns its dependencies and an idempotent setup/check script.
- Do not add mise/asdf yet. Ubuntu 24.04 already has the Python family hellozenno wants, and there is no demonstrated version conflict.

hellozenno’s formatter/linter target is explicitly Python 3.12 [here](/Users/greg/Dropbox/dev/experim/hellozenno/pyproject.toml:13). Its setup should create a repo-local `.venv`, install from its requirements, initialize the submodule, run `npm ci --prefix frontend`, and prepare the local database. It must not use ambient `pip`, install global packages, kill arbitrary processes, or contact production.

Do not put an arbitrary `"setup": "..."` string in JSON and run it automatically. Use a fixed convention such as `.gjd-remote/setup.sh`, invoked explicitly. End it by calling `.gjd-remote/check.sh`; success requires the check’s sentinel, not merely exit zero.

This preserves cattle:

- Cloud-init recreates the machine layer.
- `/home` remains deliberately persistent and may retain repos, venvs and databases.
- After rebuild, `doctor --all` says which repo layers still work.
- On a new volume, the typed registry is the inventory for recloning; setup remains explicit in v1.
- If fully automatic recovery becomes valuable, add a later `reconcile` command. Do not make cloud-init execute mutable application repositories.

## E. Sessions, naming and `ls`

Use separate metadata, not prefixes or tmux groups.

At creation, store:

- `GJD_REPO=spideryarn/hellozenno`
- `GJD_REMOTE_DIR=/home/greg/code/hellozenno`

A repo prefix wastes title space and does not distinguish two worktrees. Tmux groups share window sets; they are not labels or namespaces.

`ls` should always show every session:

```text
NAME                 REPO                    AGE  ATT  TITLE
fix-auth             spideryarn/hellozenno   2h   no   Fix local auth
toc-scroll           spideryarn/reading2     8m  yes   Repair ToC scroll
```

An optional `ls --current` or `ls --repo owner/repo` is fine, but hiding sessions by default makes destructive operations less legible.

Command behaviour:

- `resume <name>`: exact global name, regardless of cwd.
- Bare `resume` inside a repo: most recent session for that repo.
- Bare `resume` outside a repo: attach only if exactly one session exists; otherwise list candidates and require a name.
- `kill <name>`: exact only, no fuzzy matching and no default. Read the session first and print its repo/title, kill it, then verify it is absent. I would not add an interactive confirmation yet.
- Legacy sessions without metadata appear as `REPO=(unknown)`. Do not infer from `pane_current_path`.

Extend the strict tmux record rather than parsing ad hoc. The current parser intentionally rejects incomplete records [here](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote-tmux.ts:76); preserve that property.

## F. Auto-clone

Do not auto-clone from `new`, and do not add `--clone` in v1.

Cloning has its own progress, authentication failures, destination-state rules and submodule failures. Folding it into `new` would still leave an unresolved question: should a session start in a cloned but uninstalled repository? The answer should be no, which turns `new` into an orchestration command.

For hellozenno:

1. Change the committed submodule URL to HTTPS. Its current SSH URL is [here](/Users/greg/Dropbox/dev/experim/hellozenno/.gitmodules:1).
2. Ensure both `spideryarn` and `gregdetre` owner tokens exist.
3. Clone the root repository.
4. Run `git submodule update --init --recursive` explicitly.
5. Have repo doctor verify `gjdutils` is present at the recorded commit.

Changing `.gitmodules` is better than global `url.insteadOf`: HTTPS works on both machines, while a global rewrite is hidden machine magic and still leaves ordinary later `git submodule update` dependent on that magic.

`clone` should distinguish “root checkout cloned” from “repo ready.” If submodule support later becomes part of `clone`, stage the whole clone under a unique temporary sibling, verify origins and submodule commits, then rename it into place. A failure must leave the requested destination absent and report the staging path.

## G. Where `gjd-remote` should live

Stay where it is for this v1. Then extract it, together with the Hetzner infra, into its own repository.

Do not put it in `gjdutils`. That would make a machine-management tool and its Terraform state part of a library that hellozenno itself consumes as a submodule—a circular and surprising dependency.

The CLI and infra should move together because `host()` reads Terraform state relative to the tool [here](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:101). Splitting them creates another path configuration problem without reducing coupling.

A later extraction must account for:

- The absolute `~/bin/gjd-remote` shim.
- CLI modules, tests, browser smoke test and credential helper.
- Infra docs and provisioning.
- Relative paths to `.mcp.json` and repo-specific doctor logic.
- The local, ignored `terraform.tfstate`, backup and `.terraform` directory. Copy and verify state; do not casually rename it in the shared tree.
- A forwarding stub or clean cutover of the old command.
- Repository-wide link and name sweeps.

Move only after repo identity and policy boundaries are stable; otherwise the extraction and redesign obscure each other.

## H. Priority

### Must do before hellozenno is genuinely usable concurrently

1. Resolve repos by canonical origin, not basename; verify the remote checkout before starting.
2. Add the typed repo policy map. Unknown env policy refuses.
3. Audit hellozenno’s allowed keys and add loopback/exact-port value validators. Do not send its current `FLASK_SECRET_KEY` or arbitrary Supabase password.
4. Fix `.gitmodules` to HTTPS, provide both owner tokens, and initialize the exact submodule commit.
5. Provision Python 3.12 plus venv/system build support; create an explicit hellozenno setup/check path.
6. Change one Supabase inspector port from 8083 and assign hellozenno a non-5173 Vite port.
7. Remove hellozenno’s “kill whatever owns this port” startup behaviour.
8. Make hellozenno’s Playwright tests use a browser that actually exists on the box.
9. Add `GJD_REPO` and `GJD_REMOTE_DIR`; show all repos in `ls`.
10. Make current-repo `doctor` check origin, env, submodule, runtime and reserved ports.
11. Keep `new` refusing missing checkouts with the exact clone command.

### Should do soon

- Dedicated capped provider keys for the shared box.
- `doctor --all`, disk/inode/RAM checks, exposed-listener checks and same-checkout warnings.
- Persist GitHub PAT files safely across rebuilds, or make their absence an explicit recovery step.
- General port tunnelling.
- Replace hellozenno’s “Flask exists, therefore dependencies are installed” test with a real venv check.
- Close the existing `confirmStarted()` hole: it currently proves tmux survived, not that Claude started.
- Extract CLI plus infra into its own repo.

### Only if it bites

- mise/asdf.
- Automatic cloning or full `reconcile`.
- Per-session Git worktrees.
- Separate Unix users or boxes for secret isolation.
- Dynamic port allocation.
- Nested owner/repo checkout directories.
- Containers per development repo.
- Resource quotas or a scheduler.

### The smallest correct v1

A typed `REPO_POLICIES` map inside `gjd-remote`, canonical `owner/repo` detection from cwd, origin-based remote checkout discovery, fixed ports, explicit clone/setup, default-deny env policy, and repo metadata in tmux. No JSON config, no auto-clone, no version manager, no dynamic ports.

Minimum red tests for the guards:

| Guard | Make it go red |
|---|---|
| Canonical identity | Two temp repos with the same basename and different origins must resolve differently. |
| Remote origin verification | Point the expected directory at a checkout of another origin; assert no tmux command runs. |
| Submodule ambiguity | Run resolution under a nested submodule; require the explicit ambiguity error. |
| Unknown env policy | Use a new `owner/repo`; assert failure before reading a file or opening SSH. |
| Hosted database rejection | Change hellozenno’s DB host to a hosted hostname; assert failure before transfer. |
| Local-to-prod rejection | Set `USE_LOCAL_TO_PROD=1`; assert failure. |
| Source-file binding | Make `.env.local` a symlink to `.env.prod`; assert refusal. |
| Transfer verification | Corrupt one byte in the simulated readback; assert no success line. |
| Port collision | Keep both inspector ports at 8083; repo doctor must fail. |
| Project namespace | Give both configs the same `project_id`; doctor must fail. |
| Foreign listener | Bind hellozenno’s assigned Vite port from another cwd; doctor must identify the owning PID/cwd and fail. |
| Setup proof | Remove `.venv/bin/python`, or make setup exit zero without its sentinel; doctor must fail. |
| Submodule readiness | Remove the checked-out submodule or move it off the recorded commit; doctor must fail. |
| Session metadata | Corrupt or omit the repo field in a new-format tmux record; the session list must be rejected as incomplete. |
| Kill verification | Fake `tmux kill-session` returning zero while the session remains; `kill` must fail. |
| Clone failure | Force submodule authentication to fail; the final destination must not be reported as ready. |

No files or remote state were changed during this review.