# Review: the account registry and wizard learn `family: codex` (plan 260910b Stage 1)

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/codex-accounts`, branch
`worktree-codex-accounts`. TypeScript + ESM, run with `tsx`, tested with vitest.

**You may fix what you find**, inside this stage, red-first — this repo's reviewer writes the repair
as well as the finding. Anything wider than the stage, report instead of changing. Do not commit.

## The candidate

Committed: `09027869` (the stage) on top of `3c0f73fc`.

```
git diff 3c0f73fc..09027869
git show --stat 09027869
```

Changed paths: `tools/overseer/codex-auth.ts` (new), `tools/overseer/accounts.ts`,
`scripts/claude-accounts.ts`, `tests/codex-auth.test.ts` (new), `tests/overseer-accounts.test.ts`,
`tests/claude-accounts.test.ts`, `tests/run-claude.test.ts` (two characters), and the plan doc.

Start with `tools/overseer/codex-auth.ts` and the `addCodex` / `seedCodexConfig` /
`codexDoctorFailure` region of `scripts/claude-accounts.ts`. That is where to begin, not the limit
of scope — the manifest above is.

Background you should read rather than reconstruct:
`docs/plans/260910b-several-codex-chatgpt-account-subscriptions-on-the-box-same-shape-as-the-claude-ones.md`,
especially "Stage 0 — done" (measurements, all taken on this box) and "Round 2: Sol's Stage 0 design
ruling" (your own ruling from earlier today, including two places where the manager declined it and
said why).

## What it is meant to do

Let one CLI register and check both Claude and Codex account-subscriptions on one box, so work can
be spread across several paid subscriptions without ever misattributing which one paid.

A Codex account is a directory (`CODEX_HOME`) with its own `auth.json`. Identity is read **locally**
from that file — no network. The registry pins `providerAccountId` to `tokens.account_id`.

Invariants that must hold:

- A Claude registry entry still cannot exist without a non-empty `providerTenantId`.
- `claude-accounts list` output for existing Claude entries is unchanged.
- The wizard **never runs `codex login`**, and never replaces an existing credential.
- Nothing in this stage runs the real `codex` binary during tests.

Deliberately out of scope: launching (`run-codex --account`, `new-codex`) is Stage 2; per-account
usage is Stage 3. `resolveForLaunch` still refuses Codex on purpose.

## The claim I would least like to be wrong about

State it back to me as **accurate or not**, rather than as "is it sound":

> After this change, `claude-accounts add --family codex` cannot register an account whose
> `auth.json` does not corroborate its own identity, and cannot cause a login to happen — so it
> cannot rotate or replace a credential that live work is using.

Both halves are load-bearing. "Corroborate its own identity" means `tokens.account_id` equals the
id_token's `chatgpt_account_id`; it explicitly does **not** mean the token is authentic, and the
module says so — check I have not overclaimed anywhere else.

## Severity

P0 data loss, exploitable security, incorrect charging, or the service broadly unusable. P1
user-visible wrong behaviour or an authoritative contract violated. P2 design/maintainability risk
with no wrong behaviour today. P3 non-behavioural prose or comment defect. Grade by consequence, not
by which file it is in. Refuse only on an **established** P0/P1 — direct evidence, no unresolved
material inference. Give every finding a stable ID `F1`, `F2`, … and number new ones above the
highest issued.

## Independent pass first

Attack it however you like before reading the section below.

Two things worth knowing about the environment, so you do not spend the run on them:

- `tests/run-claude.test.ts` fails 11 tests **whenever `CLAUDE_CONFIG_DIR` is set in the shell that
  runs vitest**, because `run-claude.ts` routes on that variable and the tests' fake `claude` cannot
  answer the routed auth probe. Measured: 48/48 pass with it unset, 37/48 with it set. Pre-existing,
  outside this stage, already reported. Unset it before running that file.
- The focused gate is
  `npx vitest run tests/codex-auth.test.ts tests/overseer-accounts.test.ts tests/claude-accounts.test.ts tests/fixture-ids.test.ts`
  (141 tests, green at `09027869`), plus `npm run typecheck` — read its **exit code**, it prints `✓`
  to stdout and `✗` to stderr and its last two lines are always `✓`.

## My own suspicions — these are already mine, and worth less than what you find yourself

Spend most of the run above this line. Ordered by how much they would cost if I am wrong:

1. **`codexDoctorFailure` is the only thing standing between a registered account and a redirected
   one.** It refuses a `config.toml` carrying `chatgpt_base_url`, `openai_base_url`,
   `model_providers` or `profile`, and requires `model provider == openai`. Is that list reachable
   and sufficient, or can a home be redirected by something it does not name? Note the plan's
   Deviation 1: `forced_chatgpt_workspace_id` is checked only when present, and never written.
2. **`primaryRepoRoot()` strips `/.claude/worktrees/<name>` from the checkout path** to seed one
   trust entry for the primary. Does that produce the right root in every case a person will hit —
   nested worktrees, a checkout not under that layout, a symlinked path?
3. **The seed writes `config.toml` unconditionally for Codex**, ignoring `answers.seed`. I judged
   that defensible because a home without project trust is useless for `--sandbox review`, but it
   makes `--seed` a no-op for Codex, which the `--help` does not say.
4. **Idempotency is asserted on TOML text, not on parsed structure.** `smol-toml`'s `stringify` key
   order is what makes the "already matches" comparison work. Is that stable enough to rely on?
5. `codexTenantId` refuses a multi-workspace credential with no single default. Is the refusal
   message actionable enough for somebody who has to go and fix it in ChatGPT?
6. The `familyData` blob now stores `workspaces`; the registry's own `parseAccountRegistry` does not
   validate it. Does anything downstream trust it?
