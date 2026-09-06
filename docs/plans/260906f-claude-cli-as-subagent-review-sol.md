REFUSE. Established P0 credential-selection failures mean `--auth` does not reliably name the credential charged.

### Findings

**F1 — P0 — established: inherited provider controls override `--auth subscription`**

(a) [`claudeEnv()`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:345) removes credential-looking names and parent-session plumbing, but preserves Claude’s provider selectors.

Locally on 2.1.263:

```text
CLAUDE_CODE_USE_BEDROCK=1 claude auth status
→ loggedIn: true, authMethod: third_party, apiProvider: bedrock
```

The same occurred for Vertex and Foundry. `claudeEnv(..., "subscription")` retained that selector while [`credentialName()`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:353) returned `the logged-in account`.

Claude’s authoritative precedence puts cloud-provider credentials ahead of every first-party credential. It also puts `apiKeyHelper`, profiles, and gateway sessions ahead of `/login`. [Claude Code authentication precedence](https://code.claude.com/docs/en/team#authentication-precedence)

(b) Do not infer the effective source solely from sanitized variable names. Before the paid invocation, run `claude auth status` under the exact child environment, cwd, and settings mode; refuse when its effective provider/source conflicts with `--auth`, and derive the displayed credential from that result. At minimum, forcibly drop the three `CLAUDE_CODE_USE_*` selectors unless a separate explicit provider mode is introduced.

---

**F2 — P0 — established: `write` settings can put the stripped credential back**

(a) [`write` deliberately omits `--restricted`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:264), so user/project settings load after `claudeEnv()` has sanitized the process environment. Settings-file `env` entries overwrite inherited environment values. [Claude Code environment precedence](https://code.claude.com/docs/en/env-vars)

I created a temporary Claude config containing only:

```json
{"env":{"CLAUDE_CODE_USE_BEDROCK":"1"}}
```

With no provider or Anthropic credential exported:

```text
CLAUDE_CONFIG_DIR=<that-config> claude auth status
→ loggedIn: true, authMethod: third_party, apiProvider: bedrock
```

The wrapper’s write argv has no `--restricted`, preserves `CLAUDE_CONFIG_DIR`, and would still print `the logged-in account`. The same door permits settings `env.ANTHROPIC_API_KEY` or `apiKeyHelper`.

(b) The smallest strict fix is to use `--restricted` for write too:

```ts
'--restricted',
...(o.access === 'write' ? ['--permission-mode', 'acceptEdits'] : []),
```

Then revise the doc: project settings and hooks do not load; the prompt must explicitly tell Claude to read `AGENTS.md`. If retaining hooks is essential, the auth-status preflight in F1 is required instead.

---

**F3 — P0 — established: `--auth env` reports the wrong credential when several exist**

(a) [`ENV_CREDENTIALS`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:106) claims precedence order but puts `ANTHROPIC_API_KEY` first. Claude’s documented order is:

```text
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_API_KEY
apiKeyHelper
CLAUDE_CODE_OAUTH_TOKEN
subscription login
```

With both first-party env variables set, local 2.1.263 reported `authMethod: oauth_token`, confirming that `ANTHROPIC_AUTH_TOKEN` won, while `credentialName()` reports `ANTHROPIC_API_KEY`. [Claude Code authentication precedence](https://code.claude.com/docs/en/team#authentication-precedence)

(b)

```ts
const ENV_CREDENTIALS = [
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
];
```

Prefer passing only the selected variable rather than all three, and cover every pairwise combination in tests.

---

**F4 — P0 — established: `--auth env` with no env credential can spend the subscription**

(a) `parseArgs()` accepts `--auth env` when none of the three variables exists; the test even expects `credentialName()` to return “no credential in the environment.” Claude then continues down its authoritative precedence ladder through `apiKeyHelper`, profiles, and the saved `/login` subscription. Thus a supposedly env-funded invocation can make a paid subscription run. [Claude Code authentication precedence](https://code.claude.com/docs/en/team#authentication-precedence)

(b) Refuse before spawning:

```ts
if (args.auth === 'env' && !ENV_CREDENTIALS.some((name) => env[name])) {
  fail('--auth env requires ANTHROPIC_AUTH_TOKEN, ANTHROPIC_API_KEY, or CLAUDE_CODE_OAUTH_TOKEN');
}
```

The F1 preflight should additionally detect higher-precedence settings or provider sources.

---

**F5 — P1 — established: output/log aliasing silently destroys the transcript**

(a) [`logPath` is written first](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:424), then [`answerPath` is written](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:456). With:

```text
--output /tmp/same --activity-log /tmp/same
```

my fake-Claude run exited 0, printed both paths as `/tmp/same`, and the file contained only `OK`; the transcript had been overwritten. This directly contradicts the documented file guarantee.

(b) Resolve both destinations before the paid run and refuse aliases:

```ts
if (answerPath === logPath) {
  fail('--output and --activity-log must name different files');
}
```

Also compare inode/device when both paths already exist, covering symlink and hard-link aliases.

---

**F6 — P2 — reasoned: malformed result metadata fails open**

(a) [`is_error` is collapsed to `event.is_error === true`](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:318), and success checks only that boolean, exit 0, event presence, and non-empty text. Therefore this event is accepted as success:

```json
{
  "type": "result",
  "subtype": "error_during_execution",
  "is_error": false,
  "terminal_reason": "api_error",
  "result": "APPROVE"
}
```

Current Claude should emit error subtypes with a non-zero exit, so this is defensive rather than a demonstrated real-stream failure. Nevertheless, Anthropic defines `subtype` as the `ResultMessage` discriminant, and the doc says `terminal_reason` is trusted although the code never evaluates it. [Claude Agent SDK result contract](https://code.claude.com/docs/en/agent-sdk/agent-loop)

(b) Require both signals:

```ts
if (parsed && (parsed.isError || parsed.subtype !== 'success')) {
  fail(/* existing detailed error */);
}
```

Keep `terminal_reason` diagnostic unless its accepted-success values are explicitly enumerated and tested.

---

**F7 — P3 — established: `--quiet` documentation and test claim are false**

(a) The doc says `--quiet` “prints paths alone” and that both `--print` and `--quiet` are asserted. In reality, [`quiet` suppresses only the answer body](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/claude-cli-as-subagent/scripts/run-claude.ts:477); Done, credential/cost, session, and denial status still print. There is no quiet test.

(b) Replace the sentence with:

> `--print` lifts the cap; `--quiet` suppresses the answer body while retaining status and paths. The answer cap is asserted in `tests/run-claude.test.ts`.

### Codex extraction

I found no changed `run-codex.ts` behavior:

- `runCodex` still defaults `bin` to `codex`.
- Its omitted `env` still defaults to `childEnv(process.env)`.
- `childEnv` passes the same allowed-name set into the shared sanitizer; the empty `drop` list is a no-op.
- Adding `cwd: undefined` to `spawn` is behavior-equivalent to omitting it.
- The moved process, truncation, environment, and answer-usability bodies are otherwise unchanged.

The backwards result scan also has no demonstrated wrong-event case for this single-prompt, closed-stdin invocation, and spawn/overflow/timeout checks correctly precede parsed-result classification.

Validation after replacing sandbox-blocked nested `npx tsx` calls with equivalent `node --import tsx` launches:

```text
tests/run-claude.test.ts  28 passed
tests/run-codex.test.ts   69 passed
typecheck                 clean, 1413 source files covered
```

No paid Claude or Codex invocation was made.