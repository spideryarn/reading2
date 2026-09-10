# Task: Stage 1 — the registry and the wizard learn `family: codex`

You are implementing one stage of a plan. Work in this repo
(`/home/greg/code/spideryarn2/.claude/worktrees/codex-accounts`, a linked git worktree on branch
`worktree-codex-accounts`). **Do not commit** — the manager reads your diff and commits. **Do not
merge, rebase, or run any git command that discards work.**

## Read first

1. `docs/plans/260910b-several-codex-chatgpt-account-subscriptions-on-the-box-same-shape-as-the-claude-ones.md`
   — the whole thing, especially **"Stage 0 — done, 2026-09-10"** (every number in it was measured
   on this box; do not re-derive them, and do not contradict them) and **"Stage 1"**.
2. `docs/reusable/codex-subscriptions.md` § "Third pass, 2026-09-10, on the Hetzner box".
3. `tools/overseer/accounts.ts` and `scripts/claude-accounts.ts` in full. `scripts/claude-accounts.ts`
   is 1655 lines; the parts that matter are `ClaudeAccountsDeps` (~line 61), `claudeEnvironment`
   (~line 110), `assertIdentity`/`profileIdentityFailure` (~line 732), `listOrCheck` (~line 1110),
   `verifyForLaunch` (~line 1168), `AddAnswers`/`collectAddAnswers` (~line 1233), `add` (~line 1398)
   and `HELP` (~line 1505).

## Hard constraints

- **Never run `codex login`, `codex logout`, `codex update`, or anything that writes to `~/.codex`.**
  Reading `~/.codex` is allowed. There is exactly one real ChatGPT account on this box and rotating
  its credential would break live work.
- **Do not edit any file outside the file set below.** In particular `scripts/run-codex.ts`,
  `scripts/gjd-remote*.ts`, `tools/fleet/**`, `tools/overseer/usage.ts`,
  `tools/overseer/codex-usage.ts` and `scripts/overseer.ts` belong to other stages and other live
  agents. If you believe the stage cannot be done without one of them, **stop and say so in your
  answer** rather than editing it.
- **Tests must not invoke the real `codex` binary.** Every subprocess is a dependency-injected fake,
  exactly as the Claude side already does it. (Test homes under `os.tmpdir()` are fine *because* no
  real codex runs there — the plan's "`CODEX_HOME` must not be under `/tmp`" finding is about
  production homes and real invocations, not about unit-test fixtures. Do not "fix" the tests to
  avoid `/tmp`.)
- **Do not use uuid-shaped ids in new test fixtures.** `tests/fixture-ids.test.ts` fails the whole
  suite if any uuid string appears in two test files. Follow the existing convention in
  `tests/claude-accounts.test.ts`, which uses `uuid-pool1` / `org-pool1` style placeholders.
- **`claude-accounts list` output for existing Claude entries must not change.** There is a live
  registry on this box and other tooling reads that format.

## File set

- `tools/overseer/codex-auth.ts` — **new**. The strict local `auth.json` parser.
- `tools/overseer/accounts.ts` — the registry schema change.
- `scripts/claude-accounts.ts` — the wizard and the family branch.
- `tests/codex-auth.test.ts` — **new**.
- `tests/overseer-accounts.test.ts`, `tests/claude-accounts.test.ts` — extend, do not rewrite.

## What to build

### A. `tools/overseer/codex-auth.ts`

A pure parser plus one thin I/O function, following the testability split documented at the top of
`tools/overseer/accounts.ts` (pure functions above the boundary; failures are typed data, never
exceptions across the module boundary).

```ts
export type CodexIdentity = {
  accountId: string;          // tokens.account_id, corroborated by the id_token
  email: string | null;       // id_token `email`, when present
  planType: string | null;    // https://api.openai.com/auth → chatgpt_plan_type
  chatgptUserId: string | null; // the PERSON. Never the pin. Carried so a mismatch can be explained.
  workspaces: CodexWorkspace[];  // may be empty; see below
  expiresAt: string | null;   // id_token `exp` as ISO, reported not enforced
};
export type CodexWorkspace = { id: string; isDefault: boolean; title: string | null; role: string | null };

export type CodexAuthReading =
  | { kind: "value"; stateDir: string; identity: CodexIdentity }
  | { kind: "unknown"; stateDir: string; why: string };

export function parseCodexAuth(input: unknown, stateDir: string): CodexAuthReading;
export async function readCodexAuth(stateDir: string): Promise<CodexAuthReading>; // reads $stateDir/auth.json
```

The six rules, each of which needs a negative fixture:

1. `auth_mode` must be exactly `"chatgpt"`. Anything else — notably an API-key login, which this
   same file can hold — is `unknown` with a `why` that names what it found. **A home that has a
   credential is not a home that has a subscription.**
2. `tokens.account_id` must be a non-empty string. Do **not** require a uuid shape: only one account
   has ever been observed, so shape is not established.
3. `tokens.id_token` must decode and its `https://api.openai.com/auth`.`chatgpt_account_id` must
   **equal** `tokens.account_id`. A mismatch is `unknown`, not a preference for either value.
4. Parse the JWT **structurally only** — three dot-separated segments, middle segment base64url
   JSON. Do not verify the signature and **do not write a comment implying you did**. This function
   answers *which account is this file for*, not *is this file genuine*.
5. `exp` is read and reported as `expiresAt`; an expired token is **not** a refusal, because Codex
   refreshes on use and a stale `exp` on disk is normal.
6. Anything unreadable — missing file, bad JSON, wrong types, undecodable JWT — is
   `{ kind: "unknown", why }`. A missing file's `why` must be distinguishable from a malformed one's.

`workspaces` comes from the `organizations` array (`{id, is_default, role, title}`). It may legally
be **absent, empty, or populated** — with one account on this box we cannot tell which shape a
workspace-less account produces, so all three must parse to an empty array rather than to `unknown`.

### B. `tools/overseer/accounts.ts`

**`providerTenantId` becomes `string | null` — required, nullable, not optional.** Keep schema
version `1`. This is GPT Sol's ruling and it was chosen over making the field optional precisely so
that every entry keeps the same property, `Pick<AccountEntry, …>` keeps working for
`LiveUsageIdentity`, and absence is explicit rather than a missing key. `scripts/gjd-remote-account.ts`
already types its own copy of this field `string | null`, so this converges rather than diverges.

Parse rules, family-aware:

- `family: "claude"` → require a **non-empty string**. Unchanged behaviour; the existing negative
  test must still pass.
- `family: "codex"` → derive from the id_token's `organizations` array:
  - absent or empty → `null`;
  - **exactly one entry → that entry's `id`, whether or not `is_default` is set**;
  - several entries with exactly one `is_default === true` → that entry's `id`;
  - anything else (several entries, zero or several defaults) → **refuse as ambiguous**, and make
    the message say how to proceed rather than just that it failed.
  - Keep the full workspace list in `familyData` for diagnostics, alongside `planType` and
    `chatgptUserId`.

Note the single-entry rule deliberately differs from a stricter "must be flagged default": only one
ChatGPT account has ever been observed here, so we do not know that a personal workspace carries
`is_default`, and a rule built from that census would refuse Greg's second account with no way
forward. The plan records this as Deviation 2 — do not "correct" it.

**Do not** require or write `forced_chatgpt_workspace_id` (plan Deviation 1). `check` may refuse if
that key is *present in the home's config and disagrees with* `providerTenantId`; it must not
require the key to exist, and the seed must never write it.

Whatever the shape, keep these properties, which the existing tests already assert:

- a Claude entry with no tenant is still rejected at parse time;
- `parseAccountRegistry` still enforces unique `name`, `stateDir` and `providerAccountId`, and at
  most one `orchestrator` per family;
- `poolAccounts(reading, family)` keeps its current signature and its `"claude"` default.

### C. `scripts/claude-accounts.ts`

Extend `ClaudeAccountsDeps` with the Codex seams, all injectable:

```ts
codexAuth: (stateDir: string) => Promise<CodexAuthReading>;
codexDoctor: (stateDir: string) => CodexDoctorReading;   // runs `codex doctor --json`
```

`CodexDoctorReading` is `{ kind: "value"; codexHome: string; sqliteHome: string; modelProvider: string;
authFile: string; authStorageMode: string; authOk: boolean } | { kind: "unknown"; why: string }`,
parsed out of `doctor --json`'s `checks["config.load"].details` and `checks["auth.credentials"]`.
The real implementation runs the binary; **every test injects a fake**.

**1. `--family` is asked first.** Move the family question above `--name`, `--email`, `--role` and
`--config-dir`, and make it a real `answer()` question with default `"claude"`. Reject anything but
`claude` / `codex` with a `FATAL` naming both. Today the family check happens *after* the
Claude-shaped questions have already been asked (lines 1292/1294) — that ordering is the bug.

**2. The Claude-only questions are skipped for Codex.**

- `--email` is **not asked** for a Codex account. There is no `codex login --email`, and the address
  is discovered from the id_token. Supplying `--email` with `--family codex` is a `FATAL` that says
  the email is read from the credential.
- `--config-dir` stays the one flag for both families; its default becomes `~/.codex-<name>` for
  Codex and remains `~/.claude-<name>` for Claude. Update `HELP` to describe it as the account's own
  state directory (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`) rather than as a Claude config dir.
- `--seed` for Codex means the `config.toml` seed in D below, not the Claude `projects/` seed.
- The `AddAnswers.family` literal type becomes the union, and `email` becomes optional.

**3. `add --family codex` does not log in — it prepares, then refuses.** In order:

1. Refuse `role: orchestrator` with `--config-dir`, as the Claude path already does, and refuse a
   `--config-dir` that is `~/.codex` itself (the Codex twin of the existing `.claude` guard).
2. Create the directory `0700` if absent; report `found:`/`changed:` in the existing idiom.
3. Seed `config.toml` (see D).
4. Read `auth.json` through `deps.codexAuth`.
   - `kind: "unknown"` because the file is **missing** → print the exact command Greg must run
     (`CODEX_HOME=<dir> codex login`, single-quoted safely via the existing `shellQuote`), say the
     directory is prepared and the registry unchanged, and **return 1**.
   - `kind: "unknown"` for any other reason → refuse, name the reason, **do not** offer the login
     command (a credential is present and unreadable; replacing it is the thing the Claude path
     already refuses to do), return 1.
   - `kind: "value"` → carry on.
5. If a prior entry of that name exists and its `providerAccountId` differs from the one just read,
   `FATAL` and change nothing — same wording shape as the Claude path's pin check.
6. Write the entry, using the identity read from `auth.json`; `displayEmail` is the token's email
   when present and omitted otherwise.

**4. `list`, `check` and `verify` learn the family.** For `family: "codex"` they must use the local
`auth.json` identity in place of the live Claude profile, and must not call `deps.profile` or
`deps.usage`. `list`'s existing per-line format stays as it is for Claude entries. `check` for a
Codex entry asserts: the state dir exists; the parsed identity matches the registry pin; and
`doctor` reports the effective `CODEX_HOME` **equal to the registry `stateDir`** and
`sqlite home` **inside it** — that last one is what catches an inherited `CODEX_SQLITE_HOME`.

**5. `resolve` keeps refusing Codex**, with a message that says `new-codex` is deferred rather than
implying the account is broken. Launcher work is Stage 2 and is deliberately not in this stage.

### D. The `config.toml` seed

Idempotent, and **verified by reading back**, never by having written the file.

- Copy `model`, `model_reasoning_effort` and `approvals_reviewer` from `~/.codex/config.toml` when
  present (the source path is a dep so tests can point it elsewhere).
- Always write `[projects."<repo root>"] trust_level = "trusted"`. **One entry for the repo root
  only** — trust is inherited by subdirectories and worktrees. Do not copy the ambient config's
  `/tmp/…` trust entries.
- Never copy `[tui.*]`, and never write a key you have not verified exists (Stage 0 §3: **unknown
  keys are silently ignored**, so a typo is invisible).
- Re-running must report `found: … already matches` and change nothing — assert this with a
  byte-level before/after comparison, the way `tests/claude-accounts.test.ts` already does with
  `snapshotTree`.
- After writing, call `deps.codexDoctor` and refuse if `config.load` did not come back `value` with
  the expected `CODEX_HOME`. Say plainly in a comment why the read-back exists.
- **Say aloud what is not seeded.** The seed's output must include a line naming plugins as absent
  by design (`skipped: seed plugins are per-home and are not copied; this account has none`), because
  Stage 0's decision was to accept that gap rather than hide it.

## Tests — write these first and watch each one go red

In `tests/codex-auth.test.ts`:

1. a well-formed `auth.json` parses to the expected `CodexIdentity`, including `workspaces`;
2. `auth_mode: "apikey"` → `unknown`, and the `why` says so;
3. `tokens.account_id` missing / empty → `unknown`;
4. `chatgpt_account_id` ≠ `tokens.account_id` → `unknown` (**the corroboration rule**);
5. an id_token that is not three segments, and one whose payload is not JSON → `unknown`;
6. `organizations` absent, `[]`, and populated → all `value`, `workspaces` `[]`/`[]`/populated;
7. an expired `exp` still parses to `value` and reports `expiresAt`;
8. a missing file and a malformed file produce **different** `why` strings;
9. `readCodexAuth` on a directory with no `auth.json` → `unknown`, no throw.

In `tests/overseer-accounts.test.ts`: the schema rules from B, including that a Claude entry without
a tenant is still rejected and a Codex entry without one is accepted.

In `tests/claude-accounts.test.ts`:

10. `add --family codex` on a directory with **no** `auth.json` prints the `codex login` command,
    returns 1, and leaves the registry file **byte-identical**;
11. the same run **did** create and seed the directory — prepared-but-unregistered is the intended
    state, so assert it positively rather than only asserting the refusal;
12. `add --family codex` with a valid fake `auth.json` registers an entry whose `providerAccountId`
    is `tokens.account_id`, with no `--email` supplied and no `deps.profile` call;
13. `add --family codex --email x@y` is a `FATAL`;
14. re-running `add --family codex` is idempotent: same registry bytes, same `config.toml` bytes;
15. `add --family codex` against a home whose `auth.json` names a **different** account than the
    prior registry entry refuses and changes nothing;
16. `check` fails a Codex entry when `doctor` reports a `CODEX_HOME` other than the registry
    `stateDir`, and when it reports a `sqlite home` outside it;
17. `list` output for a registry of existing **Claude** entries is unchanged (assert against the
    current string, so a regression is loud);
18. the wizard asks `family` **before** `name`/`role`/`config-dir` — assert on the recorded order of
    `deps.prompt` questions, not on the answers;
19. `resolve --account <a codex account>` refuses with a message naming Stage 2 / `new-codex`.

## When you are done

- `npx vitest run tests/codex-auth.test.ts tests/overseer-accounts.test.ts tests/claude-accounts.test.ts`
  must be green. Run `npm run typecheck` too (it covers `tests/` as well as `src/`; a bare `tsc -p
  tsconfig.json` does not) and read its **exit code** — it writes `✓` to stdout and `✗` to stderr, so
  a tail of stdout reads clean over a red run.
- In your answer: list every file you changed, name any test you could not make red first and why,
  and name anything you wanted to change outside the file set.
