# Codex usage-limit fixtures

The four payloads the Codex usage reading is parsed from, for
[plan 260909d](../../../docs/plans/260909d-read-the-codex-subscription-usage-limits-and-show-them-beside-claude-s.md).

Two are **real**, captured on the Hetzner box on 2026-09-09 against `codex-cli 0.153.4` on a
`plan_type: pro` ChatGPT subscription. Two are **synthetic**, built from the app-server's own JSON
Schema to hold arms the live account does not currently produce. Each file says which it is.

| File | Source | Holds |
|---|---|---|
| `app-server-rate-limits.json` | **real** — `account/rateLimits/read` | the ordinary reading: 24% of a weekly window, two per-model buckets, two reset credits |
| `app-server-not-authenticated.json` | **real** — the same call with `CODEX_HOME` pointed at a directory holding no `auth.json` | the JSON-RPC error the `unknown` arm quotes |
| `session-rollout-token-count.json` | **real** — one line of `~/.codex/sessions/**/rollout-*.jsonl` | the fallback source, in the real envelope |
| `app-server-degenerate-windows.json` | **synthetic** | null durations, null resets, a reversed primary/secondary, a limit actually reached, an unrecognised window length |

## Two things the real files show that a tidied fixture would hide

**The two sources spell the same fields differently, and not only in case.** The app-server replies in
camelCase with `windowDurationMins`; the session log writes snake_case with `window_minutes`. A parser
that assumes a mechanical snake↔camel conversion gets `windowMinutes` and reads `undefined` — which,
if a missing duration were treated as anything but unknown, is how every window silently acquires the
wrong name. The two shapes are parsed separately on purpose.

**`usedPercent` is an integer from the app-server (`24`) and a float in the session log (`24.0`).**
Same number today; not the same type. Whatever holds it must accept both and must not assume the
value is already rounded.

## Redaction

`accountId` and the reset-credit ids in `app-server-rate-limits.json` are replaced with zero-filled
placeholders — they identify Greg's account and nothing in the parsing depends on their contents. The
capture script keeps everything else verbatim, including the reset-credit prose, because a fixture
that has been tidied stops being evidence about the source. Token counts in the session fixture are
real and say nothing about any person or project.

Re-capture with the scripts recorded in the plan's stage 1; the `resetsAt` values move every time,
which is itself the measurement that the reading is live rather than cached.
