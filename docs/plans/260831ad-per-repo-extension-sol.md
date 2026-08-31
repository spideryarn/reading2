The general seam exists, but I would change the framing slightly:

> Split by **authority**, not merely by execution location.

Use:

- A tool-owned control plane on the laptop for identity, destinations, credentials, and shared-box policy.
- One repo-owned executable on the box for setup and checking.

Do not add a declarative config, lifecycle hooks, or overrides yet.

## 1. The trust boundary

“Runs on the box” is mostly right, but it misses two cases.

First, automatic execution matters even when capability does not. An agent could run arbitrary code with sudo, but automatically running a newly cloned repo’s hook before an agent starts turns “code an agent may choose to run” into “code a checkout causes us to run.” Therefore repo extensions should be explicit commands, never `post-clone`, `pre-session`, or another automatic hook.

Second, repo output must not become authority. A box-side script may report facts, but it must not decide:

- Which laptop file is read.
- Which keys or values leave the laptop.
- The SSH host, user, or destination.
- The remote checkout receiving `push-env`.
- The canonical identity of the repo.
- Global allocations such as an enforced port reservation.
- Which local program or hook runs.

In particular:

- Never run a committed repo hook on the laptop.
- Never accept a remote directory emitted by a repo script.
- Never let a repo’s requested env keys enlarge the tool-owned allowlist.
- Resolve identity from canonical Git origin and verify the destination checkout independently.

A remote script reading or exfiltrating other box-side `.env.local` files is already inside the current shared-user trust model. If that becomes unacceptable, the answer is separate Unix users or boxes.

One extra hardening change follows from this boundary: non-interactive extension calls should explicitly use `ForwardAgent=no`, no TTY, no stdin, and a small explicit environment. Current SSH options do not force agent forwarding off if Greg’s SSH config enables it: [gjd-remote.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:66).

Ports are different. A repo squatting another repo’s port is an availability problem, not a confidentiality boundary. Under one passwordless-sudo user, no declaration can prevent a malicious repo binding or killing a port. The useful target is accidental-conflict detection.

## 2. The smallest extension mechanism

Use one committed executable:

```text
.gjd-remote/run setup
.gjd-remote/run check
```

That is one file, with a deliberately tiny typed protocol:

```ts
type RepoAction = "setup" | "check";
```

- `setup` is explicit, idempotent and non-destructive.
- After `setup`, the tool independently invokes `check`.
- `check` is read-only and non-interactive.
- Unknown actions fail.
- The tool appends its own nonce completion marker after the script exits successfully, distinguishing a complete response from a truncated SSH stream.

The script may dispatch internally however the repo likes:

- Spideryarn can call `npm run setup`, which already exists: [package.json](/Users/greg/Dropbox/dev/experim/spideryarn2/package.json:46).
- Hello Zenno can create `.venv`, initialise the submodule, run `npm ci --prefix frontend`, prepare its local database, and run pytest plus Svelte checks.

Do not automatically invoke it from `clone` or `new`.

I would not build:

- `.gjd-remote.toml` or JSON.
- Arbitrary command strings in config.
- Lifecycle hooks.
- Behaviour overrides.
- A start/stop/service supervisor.
- Runtime inference.
- Dynamic port allocation.
- A general plugin API.

If cross-repo inspection later proves necessary, add a third action such as `describe`, returning strictly validated, versioned JSON. Keep it in the same executable rather than adding another file.

The tool cannot prove that an arbitrary `check` is meaningful. That remains the repo’s responsibility. It can prove only that the command existed, ran, exited successfully, and completed its SSH response.

## 3. Discovery and checkout differences

A repo with no `.gjd-remote/` keeps every existing command working exactly as today. Only the new repo-specific commands should say:

> `owner/repo does not declare a gjd-remote setup/check command.`

That is “unsupported,” not green and not a failed box doctor. Spideryarn therefore remains zero-config.

Do not infer actions from `pyproject.toml`, `package.json`, lockfiles, or directories. Those can support a diagnostic hint, but must never cause execution or produce a successful readiness result. Hello Zenno itself demonstrates why: its Python config is at the root, npm is under `frontend/`, and a `pyproject.toml` does not say whether a venv exists.

Execute the extension from the box checkout. That is the tree being prepared and checked. Before execution, print:

- Canonical repo identity.
- Remote directory.
- Remote HEAD.
- Whether the working tree is dirty.
- Optionally the adapter’s blob hash.

Do not require the laptop and box checkouts to match. Different branches and uncommitted agent work are normal here. Equality would add friction without creating a security boundary.

Conversely, all sending-side policy stays in the laptop tool. The current implementation binds the default source env file to the Spideryarn checkout containing the tool and selects the destination through `GJD_REMOTE_REPO`: [source](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:910), [destination](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/gjd-remote.ts:938). That is exactly why Hello Zenno must not use the present `push-env`.

## 4. Existing conventions

| Candidate | Verdict |
|---|---|
| `.claude/settings.json` and hooks | Wrong layer. Claude-specific, may also run on the laptop, and unavailable before Claude starts. |
| `package.json` scripts | Good implementation detail, not the universal interface. Hello Zenno has no root npm project. |
| Existing `scripts/local/*.sh` | Reuse behind the adapter after correcting destructive and interactive behaviour. |
| Makefile | Genuine alternative, but neither repo has one. Do not introduce an entire build convention solely for two remote targets. |
| devcontainer | Far too large; it changes the execution model and complicates Docker/Supabase. |
| mise | Useful only if incompatible runtime versions become real. It does not solve setup, services, ports, env policy or checking. |
| `.mcp.json` | Already owns MCP declarations. Leave it alone. |

The non-interactive shell should source no profile. The adapter must use explicit paths such as `.venv/bin/python`, set or source its own repo-local environment deliberately, and fail clearly when a required machine capability is absent.

Hello Zenno’s existing migration script is not safe readiness evidence: declining the migration exits successfully [migrate.sh](/Users/greg/Dropbox/dev/experim/hellozenno/scripts/local/migrate.sh:70). Its adapter must verify the resulting schema rather than trust that exit code.

## 5. Ports

For v0, do not add port declarations to `gjd-remote`.

The present collision is real: both Supabase configs claim `8083`: [Spideryarn](/Users/greg/Dropbox/dev/experim/spideryarn2/supabase/config.toml:478), [Hello Zenno](/Users/greg/Dropbox/dev/experim/hellozenno/supabase/config.toml:258). But teaching the tool to parse Supabase, Vite, Playwright, Flask and Storybook would recreate the eleven special cases.

Use two levels:

1. Now: box doctor reports actual listeners, commands, container names and process cwd where attribution is possible. This detects current conflicts and public bindings, but honestly cannot predict future ones.
2. Later, if proactive checking becomes valuable: `.gjd-remote/run describe` derives port claims from the repo’s native files and emits strict JSON. `gjd-remote` compares claims across repos.

That is option (d), supplemented by (c). The repo owns technology-specific extraction; the tool owns cross-repo comparison. Exact port values are not copied into a second config.

Any implicit default that matters on a shared machine should first become explicit in its owning native config. The adapter must derive it from there, not repeat it.

A per-repo range is a legitimate global allocation rather than duplication, but it would force Hello Zenno’s scattered conventional ports into a new scheme. Do it only if more repos make that worthwhile.

Regardless of port machinery, Hello Zenno’s unconditional kill behaviour is its own bug and must change. It currently kills arbitrary owners of both Flask’s port and `5173`: [run_backend.sh](/Users/greg/Dropbox/dev/experim/hellozenno/scripts/local/run_backend.sh:30).

## 6. Reclassifying the earlier eleven items

| Earlier item | Where it belongs now |
|---|---|
| 1. Canonical repo identity and origin verification | Core `gjd-remote`; not extensible. |
| 2. Default-deny typed env policy | Core laptop tool. |
| 3. Hello Zenno per-key value rules | Tool-owned policy data; its production-equivalent local secrets are also a Hello Zenno hygiene problem. |
| 4. Submodule setup | Adapter. The SSH-only `.gitmodules` URL is a Hello Zenno portability issue: [.gitmodules](/Users/greg/Dropbox/dev/experim/hellozenno/.gitmodules:1). |
| 5. Python, venv and dependencies | Stable machine capabilities plus adapter-owned repo setup. No Hello-specific branch in the tool. |
| 6. Port assignments | Repo native configuration; generic observation/comparison later. |
| 7. Kill-whatever-owns-the-port | Hello Zenno bug. |
| 8. Playwright browser | Adapter/setup responsibility; the tool should not know which browser its tests use. |
| 9. Repo metadata in tmux | Core `gjd-remote`. |
| 10. Repo doctor | Adapter `check`; box-wide doctor remains in the tool. |
| 11. Refuse a missing checkout | Core `gjd-remote`. |

Thus the adapter absorbs setup, submodules, repo dependencies, repo health, and later perhaps derived port claims. The tool retains identity, targeting, env transfer, session semantics, clone safety and box-wide checks.

## Smallest safe v0 now

Hello Zenno can run badly but safely without first building the general extension support:

1. Use existing `clone` and an explicit `shell -d /home/greg/code/hellozenno`.
2. Add one Hello Zenno-owned adapter script for manual `setup` and `check`.
3. Change its startup script to refuse occupied ports rather than kill their owners.
4. Do not use `push-env`. Construct a box-local development env with a fresh Flask secret and only deliberately chosen provider keys.
5. Run only one repo’s application services at a time. Concurrent Claude sessions are fine; concurrent app stacks are deferred.
6. Skip Hello Zenno Playwright on the box for now.
7. Initialise the submodule explicitly, using a one-command HTTPS rewrite if its committed URL has not yet been cleaned up.
8. Verify venv, submodule commit, frontend dependencies and database schema independently.

The only optional `gjd-remote` addition for this v0 is explicit `setup`/`check` dispatch to `.gjd-remote/run`. Even that can wait until manually invoking the adapter becomes annoying.

Minimum red proofs:

- Make `setup` return immediately with dependencies absent; the separate `check` must fail by name.
- Remove `.venv/bin/python`; Hello Zenno check must fail.
- Remove or move the submodule off its recorded commit; check must fail.
- Truncate the SSH reply before the tool-owned marker; the command must fail.
- Have an adapter print a different destination or request `HETZNER_CLOUD_API_TOKEN`; neither may affect tool behaviour.
- Change one native port to `8083`; derived port comparison must fail without editing a second list.
- Bind a declared port from an unrelated process; listener doctor must report it.
- Run a repo with no adapter; existing session commands must still work, while `setup` fails clearly.

No files, tests, or remote state were changed during this review.