## Q1 — Tenant/workspace field

I would choose **(d): make `providerTenantId` required-but-nullable**:

```ts
providerTenantId: string | null
```

Keep registry schema version `1`, with family-aware parsing:

- Claude: require a non-empty string.
- Codex:
  - If `organizations` is absent or empty, store `null`.
  - If it has exactly one `is_default === true` entry, store that entry’s `id`.
  - If it is non-empty but has zero or multiple defaults, refuse it as ambiguous.
- Keep the complete organization list in `familyData` for diagnostics.

This is preferable to optionality because every entry retains the same property, `Pick<AccountEntry, …>` continues to work, and absence is represented explicitly. It avoids the out-of-stage narrowing forced by a discriminated union.

The cost is that TypeScript still cannot prove a Claude entry has a tenant; the parser owns that invariant. A discriminated union remains the better eventual type once its callers can move together.

The Codex verifier used by both launch and `check` should require:

1. `auth_mode === "chatgpt"` and no active stored API key.
2. A non-empty `tokens.account_id`.
3. A decodable ID-token payload whose `chatgpt_account_id` exactly equals `tokens.account_id`.
4. That account ID exactly equals the registry’s `providerAccountId`.
5. When `providerTenantId !== null`, the unique default organization ID exactly equals it.
6. The effective `forced_chatgpt_workspace_id` equals `providerTenantId`; when the tenant is null, that setting must be absent.

Never pin on `email`, `sub`, `chatgpt_user_id`, or `user_id`. They can be displayed or recorded in `familyData`, but they do not distinguish two accounts owned by the same person.

OpenAI documents workspace as a separate authentication restriction and says ChatGPT-authenticated Codex follows the selected workspace’s controls, which supports treating the default organization as the tenant rather than duplicating the account ID. [Authentication documentation](https://learn.chatgpt.com/docs/auth)

One uncertainty remains: it has not been demonstrated that `organizations[].is_default` is precisely the billed workspace for a multi-workspace token. I would use it for v1, enforce it through `forced_chatgpt_workspace_id`, and make the first multi-workspace account an acceptance test.

## Q2 — Child-environment pin

Choose **(i): an account-pinned drop list**. Do not widen `isSecretName`, and do not replace the child environment with a positive allowlist.

For a registered-account launch:

1. Run the existing sanitiser.
2. Remove all 18 discovered `CODEX_*`/`OPENAI_*` routing and state variables.
3. Set only `CODEX_HOME` back to the resolved account directory.
4. Reject `--pass-env` for any protected name—or delete protected names after pass-through processing—because `sanitisedEnv` currently re-adds allowed names after applying `drop`.

The credential-shaped variables are already removed by `isSecretName`; subscription-only mode must additionally ensure that `CODEX_API_KEY` is never deliberately re-added.

The measured or documented classifications are:

| Effect | Variables |
|---|---|
| Direct account/auth selection | `CODEX_HOME`, `OPENAI_FEDERATION_RULE_ID` |
| API-organization selection | `OPENAI_ORGANIZATION`—relevant in API-key mode |
| State association, not billing | `CODEX_SQLITE_HOME`, `CODEX_ROLLOUT_TRACE_ROOT` |
| Documented audit-only, not authentication | `OPENAI_WORKLOAD_IDENTITY_CONTEXT` |
| Endpoint/provider/auth routing; potentially identity-changing, but not individually proven in this executable path | `OPENAI_BASE_URL`, `CODEX_AUTHAPI_BASE_URL`, `CODEX_APP_SERVER_CHATGPT_BASE_URL`, `CODEX_APP_SERVER_LOGIN_CLIENT_ID`, `CODEX_CLOUD_TASKS_BASE_URL`, `CODEX_OSS_BASE_URL`, `CODEX_EXEC_SERVER_URL`, `CODEX_AGENT_IDENTITY_JWKS_BASE_URL`, `CODEX_URL`, `OPENAI_CLUSTER` |
| Apparently non-payer metadata/install controls; inference, not measured | `CODEX_MANAGED_PACKAGE_ROOT`, `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` |

I would still drop the last two on a pinned launch. They are ambient Codex-specific overrides with no necessary role in account selection, and retaining them buys little.

The official environment reference confirms that `CODEX_HOME` contains authentication while `CODEX_SQLITE_HOME` relocates state; it also says workload-identity context does not affect authentication or authorization. [Codex environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables)

Why not the alternatives:

- Widening `isSecretName` conflates secret-exfiltration protection with process-routing isolation and would unexpectedly affect the Claude wrapper.
- A positive allowlist would make plugins and ordinary CLI behavior depend on continuously enumerating their environment requirements.

The cost of the explicit drop list is maintenance: a Codex upgrade can introduce another routing variable. Record the list as version-scoped and repeat the binary inventory when upgrading.

This environment fix also does not replace validation of the selected home’s effective `config.toml`: custom providers, profiles, base URLs, login method, and workspace restrictions must still be checked.

## Q3 — What to refuse

Make `--account` plus `--auth key-first` a **hard error**. Do not create an `api-key` payer in v1.

More precisely:

- A registered account resolution makes the effective mode `subscription-only`.
- No explicit `--auth`, or explicit `--auth subscription-only`: allowed.
- Explicit `--auth key-first` or `--auth subscription-first`: hard error before spawning.
- The ambient, non-account-pinned path may retain today’s auth behavior.

An API-key payer would require its own identity, organization attribution, selection rules, and launch-record shape. Adding only the label would recreate the same false-attribution problem under a nicer name.

The cost is intentional: a depleted subscription fails instead of falling back successfully. To use the API key, the caller must launch without an account pin. That is the simplest v1 that cannot silently name the wrong payer.