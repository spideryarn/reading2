# Dev tooling names model families, not versions

Greg, 2026-09-24:

> make sure we aren't specifying exact models anywhere in our dev tooling - e.g. instead of
> specifying GPT 5.6 Sol, we should be using the latest GPT Sol (currently v6, but that will change
> soon!), or instead of Opus 5 we want the latest (5.5, but that will change soon too), etc etc.

Scope is dev tooling only — `scripts/`, `tools/`, `.claude/`, `infra/`, and the docs that tell an
agent which model to call. The product's own model choices (`src/`, setup-dev.md's table,
ai-gateway.md) are product decisions and are listed for Greg, not changed.

## What was measured first

- **Claude:** `claude --model <alias>` takes a family. Measured 2026-09-24 on 2.1.281 with
  `claude -p --model X --output-format json`, reading `modelUsage`: `fable` → `claude-fable-5-1`,
  `opus` → `claude-opus-5-5`, `sonnet` → `claude-sonnet-5`, `haiku` → `claude-haiku-4-5-20251001`.
  `scripts/run-claude.ts` already defaults to `opus`. Nothing on the Claude side named a version.
- **Codex:** no family alias. `codex exec --model sol` is not a thing, and `~/.codex/config.toml`
  takes only an id. But `codex app-server`'s `model/list` (the same stdio protocol
  tools/overseer/codex-usage.ts already speaks) returns what this account is offered, free.
- **"Latest Sol" is not v6 for us.** `model/list` under the ChatGPT subscription lists
  `gpt-6-astra` (its `isDefault`), `gpt-5.6-sol`, `-terra`, `-luna`, `gpt-5.5`. OpenRouter lists
  `openai/gpt-6-sol`, but `codex exec --model gpt-6-sol` on the subscription returns *"The
  'gpt-6-sol' model is not supported when using Codex with a ChatGPT account."* So the newest Sol
  the subscription can run is still 5.6.

## The design

**`scripts/run-codex.ts` is the one place a family becomes an id.** `--model` accepts `astra`,
`sol`, `terra`, `luna`; the default is `sol`. For each credential it actually spends, the wrapper
asks `model/list` under that credential and takes the highest-versioned
`gpt-<version>-<family>` (anchored, so `-pro` does not count; `hidden` skipped; versions compared
numerically). A read-only run that falls
back from the subscription to `CODEX_API_KEY` resolves again, because the two accounts may be
offered different lists. A concrete id passes through untouched. If the list has no such model, or
codex cannot be reached, the run stops before exec — **no hardcoded fallback**, because a fallback
is the stale pin this removes and it would only ever fire when nobody was looking. The resolved id
is printed on the `Done —` line and in `--dry-run`, so a caller can prove which model ran.

Every caller then says `--model sol` (or `luna`) instead of an id.

### The simpler option passed over

**Use codex's own default** — omit `--model` or take `model/list`'s `isDefault`. Fewer parts, and
it tracks "latest" with no code of ours. Rejected because that default is `gpt-6-astra`, and Astra
is opt-in by Greg's decision of 2026-09-07 (*"We only want to use it for really difficult stuff…
because it uses up a lot of tokens"*); omitting `--model` would also hand the choice to each
machine's `~/.codex/config.toml`, which on the box already says `gpt-6-astra`.

**Spending the API key to get `gpt-6-sol`** is the other way to satisfy "v6 Sol" literally. Not
done: it moves every review from the subscription to metered spend. That is Greg's call; it is in
the debrief.

## What changes

| File | Change |
|---|---|
| `scripts/run-codex.ts` | `DEFAULT_MODEL = 'sol'`, `MODEL_FAMILIES`, `pickNewestInFamily`, `resolveModelFamily`, resolution in `main()` before the dry run and again in `runPlan` if the credential changes |
| `tests/run-codex.test.ts` | every stand-in answers `model/list` with an invented list; tests for the pick, pagination, protocol refusal and teardown, per-credential resolution, the default run, an unoffered family, a concrete id, and the dry run |
| `AGENTS.md`, `docs/reusable/git-resolve-merge-conflicts.md`, `docs/project/changelog.md`, `tools/fleet/actions.ts`, `scripts/changelog/changelog.ts` | `--model gpt-5.6-sol` → `--model sol` |
| `scripts/changelog/changelog.ts` | `GENERATED_BY` stamps families (`sonnet`, `sol`, `opus`) — a version there would be a claim nothing checks |
| `docs/reusable/codex-cli-as-subagent.md` | the model table becomes a family table; the config example drops `model`; raw `codex exec` shows `<id>` and how to get it |

## Left alone, on purpose

- **History** — plans, postmortems, research, dated measurements inside docs ("measured on
  gpt-5.6-sol, 2026-09-07"), the dated `generated_by` sample in changelog.md, and the process-table
  fixtures in tests/overseer-work.test.ts, which are real `ps` lines.
- **`tools/overseer/attention-classify.ts` and `tools/fleet/describe.ts`** (`openai/gpt-5.6-luna`).
  Both are deliberate copies of the product's `QUICK_MODEL_OPENROUTER`, with a test asserting they
  agree, because the Overseer may not import `src/`. OpenRouter does offer `~openai/gpt-luna-latest`,
  but moving these alone would split them from the product they mirror; they follow whatever Greg
  decides for the product.
- **Product** — `src/models.ts` and friends, setup-dev.md, ai-gateway.md.
