# Design question: the Codex registry identity shape, and the child-environment pin

You are reviewing a **design decision**, not a diff. Answer the three questions at the bottom.
Be concrete and pick one option per question; say what you would do and why, and name what it costs.

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/codex-accounts` (a linked git worktree).
Read `docs/plans/260910b-several-codex-chatgpt-account-subscriptions-on-the-box-same-shape-as-the-claude-ones.md`
first — it is your own round-1 review of this plan, and the context below is Stage 0 of it.

## What has now been measured (all on this box, codex-cli 0.153.4, 2026-09-10)

You wrote in round 1 that you *could not determine* whether the JWT's email or its `organizations`
array is the right workspace pin, and that the plan must not put the account id into both
`providerAccountId` and `providerTenantId`. Here is the missing data.

`$CODEX_HOME/auth.json` top level: `auth_mode` (string, `"chatgpt"`), `OPENAI_API_KEY` (null),
`tokens` (object), `last_refresh` (string).
`tokens`: `id_token`, `access_token`, `refresh_token`, `account_id` — all strings.

`tokens.account_id` is a 36-char uuid.

The `id_token` payload carries: `acr amr aud auth_provider auth_time email email_verified iss name
rat sid sub iat exp jti at_hash` and the namespaced claim `https://api.openai.com/auth`, which
contains: `chatgpt_account_id chatgpt_plan_type chatgpt_subscription_active_start
chatgpt_subscription_active_until chatgpt_subscription_last_checked chatgpt_user_id groups
organizations user_id`.

Traced equalities (computed, not assumed):

- `tokens.account_id == auth.chatgpt_account_id` → **true**
- `auth.chatgpt_user_id == auth.user_id` → **true**, and its shape is `user-…` (29 chars)
- `sub == auth.chatgpt_user_id` → **false**
- `auth.organizations` is an array; here `length == 1`, and each element is
  `{ id: string, is_default: boolean, role: string, title: string }`
- `auth.chatgpt_plan_type` is `"pro"`; `auth_provider` is `"google"`; `email` is present.

There is **only one** ChatGPT account on this box, so I cannot see what `organizations` looks like
for a personal account with no workspace (empty array? absent? one implicit org?). Assume I cannot
find out before Greg adds the second account.

There is also a real, typed config key `forced_chatgpt_workspace_id` (verified: a nonsense value
fails config load), which implies workspace is a separate axis from account.

## The registry as it stands

`tools/overseer/accounts.ts` — `AccountEntry` is one non-discriminated type:

```
name, family: "claude" | "codex", role: "orchestrator" | "pool", stateDir (absolute, no trailing
slash), providerAccountId: string, providerTenantId: string, displayEmail?: string, addedAt,
familyData: Record<string, unknown>
```

`providerTenantId` is **required and non-empty** for every entry. For Claude it is the org uuid from
`/api/oauth/profile`. Uniqueness is enforced on `name`, `stateDir` and `providerAccountId` — not on
tenant. At most one `orchestrator` per family.

Call sites of `providerTenantId` outside my file set (I am not allowed to edit these this stage):
`scripts/overseer.ts:435`, `scripts/run-claude.ts:515`, `scripts/gjd-remote-account.ts` (which
already types it `string | null` in its own resolve-payload type). Inside my file set:
`scripts/claude-accounts.ts:745,1080,1143,1449,1461,1619` and `tools/overseer/accounts.ts`
(including `LiveUsageIdentity = Pick<AccountEntry, "providerAccountId"|"providerTenantId"|"displayEmail">`).

## The child-environment finding, which may change your P0-1 remedy

Round 1 said "clear `CODEX_ACCESS_TOKEN` and `CODEX_API_KEY`, and also `OPENAI_API_KEY`". Measured:

1. `.env.local` on this box sets **both** `CODEX_API_KEY` and `OPENAI_API_KEY`, so the hazard is live.
2. `scripts/run-codex.ts` builds the child env with `sanitisedEnv(parent, passThrough, drop)` from
   `scripts/subagent-cli.ts`. That is a **name-pattern denylist** (`isSecretName`), not an allowlist:
   `SECRET_WORD = /SECRET|PASSWORD|PASSWD|CREDENTIAL|APIKEY|JWT|BEARER|_PWD$|KUBECONFIG|NETRC/i`,
   `SECRET_SEGMENT = /(^|_)(KEY|TOKEN|AUTH|COOKIE|PRIVATE|DSN|SIGNATURE)(_|$)/i`,
   `SECRET_VALUE_SHAPE = /^(DATABASE|REDIS|MONGO|AMQP|POSTGRES|MYSQL|CLICKHOUSE)_URL$|_URI$|_PROXY$/i`.
3. I extracted every `CODEX_*`/`OPENAI_*`/`CHATGPT_*` name from the 0.153.4 binary and ran each
   through the real `isSecretName`. **Dropped (9):** `CODEX_API_KEY`, `OPENAI_API_KEY`,
   `CODEX_ACCESS_TOKEN`, `CODEX_AUTH`, `OPENAI_IDENTITY_TOKEN_FILE`, `CODEX_AUTH_API_BASE_URL`,
   `CODEX_REFRESH_TOKEN_URL_OVERRIDE`, `CODEX_REVOKE_TOKEN_URL_OVERRIDE`, `CODEX_CONNECTORS_TOKEN`.
   **Kept — they cross into the child (18):** `CODEX_HOME`, `CODEX_SQLITE_HOME`,
   `OPENAI_FEDERATION_RULE_ID`, `OPENAI_WORKLOAD_IDENTITY_CONTEXT`, `OPENAI_BASE_URL`,
   `OPENAI_ORGANIZATION`, `CODEX_AUTHAPI_BASE_URL`, `CODEX_APP_SERVER_CHATGPT_BASE_URL`,
   `CODEX_APP_SERVER_LOGIN_CLIENT_ID`, `CODEX_CLOUD_TASKS_BASE_URL`, `CODEX_OSS_BASE_URL`,
   `CODEX_EXEC_SERVER_URL`, `CODEX_ROLLOUT_TRACE_ROOT`, `CODEX_MANAGED_PACKAGE_ROOT`,
   `CODEX_INTERNAL_ORIGINATOR_OVERRIDE`, `CODEX_AGENT_IDENTITY_JWKS_BASE_URL`, `CODEX_URL`,
   `OPENAI_CLUSTER`.
4. Live credential-precedence test against an **empty** alternate `CODEX_HOME`, three runs:
   - nothing set → `401 … Missing bearer or basic authentication in header`, exit 1. It does **not**
     fall back to the ambient `~/.codex` login. Your negative control holds.
   - `OPENAI_API_KEY=<bogus>` → byte-identical `Missing bearer` error. The ambient OpenAI key is
     **not** sent by `codex exec` on 0.153.4.
   - `CODEX_API_KEY=<bogus>` → error changes to `Incorrect API key provided: sk-notar***robe …
     auth error code: invalid_api_key`. So `CODEX_API_KEY` **does** cross and outrank the pinned
     home's stored login. With a *valid* key that run succeeds and bills the key.
5. `authPlan('subscription-first', haveKey=true)` returns `[false, true]` — attempt 1 without the
   key, attempt 2 with it. `AUTH_MODES = ['subscription-first','key-first','subscription-only']`,
   default `subscription-first`. `--pass-env CODEX_API_KEY` is already refused.

## Three questions

**Q1 — the tenant/workspace field.** Given the above, what should a `family: "codex"` registry entry
put in `providerTenantId`, and what should the schema be? Candidates I see:

  (a) Make `providerTenantId` optional at the type level, and require it at parse time only when
      `family === "claude"`. For Codex, set it from the **default** element of `auth.organizations`
      (`is_default === true`) when the token carries one, and omit it otherwise.
  (b) Same as (a) but never populate it for Codex at all; keep the org list in `familyData`.
  (c) Turn `AccountEntry` into a discriminated union on `family` so a Claude entry cannot compile
      without a tenant. This is better typed but `Pick<AccountEntry, …>` for `LiveUsageIdentity`
      stops working cleanly and it forces narrowing at ~4 call sites in files I am not allowed to
      edit this stage (`scripts/overseer.ts`, `scripts/run-claude.ts`).
  (d) Something else.

Say which, and say explicitly what the *pin* for a Codex account should be checked against at launch
and at `check` time — i.e. which fields a verifier must compare to refuse a home that is signed in to
the wrong account. Remember `chatgpt_user_id` is the person and `chatgpt_account_id` is the account,
and that two ChatGPT accounts belonging to the same human would share the former.

**Q2 — the child-environment pin.** Does finding 3 change your P0-1 remedy? Specifically: is the
right fix (i) an explicit `drop` list of the routing variables named above, passed only on the
account-pinned path; (ii) widening `isSecretName`, which is shared with the Claude wrapper; or
(iii) a positive allowlist for the Codex child, which the `sanitisedEnv` header argues against on
the grounds that these CLIs need an unenumerable slice of the environment? Which variables in the
"kept" list actually move billing or identity, and which are harmless? Note I must not edit
`run-codex.ts` this stage — I need the *decision* recorded so Stage 2 builds it.

**Q3 — what would you refuse.** Given `--account <name>` must force subscription-only semantics:
should `--account` + `--auth key-first` be a hard error, or should it resolve a distinct `api-key`
payer as you suggested in round 1? Name the simplest v1 that cannot silently misattribute.

Answer Q1, Q2, Q3 in that order with headings. Where you are uncertain, say so plainly rather than
picking confidently — the plan's biggest round-1 win was you saying what you could not determine.
