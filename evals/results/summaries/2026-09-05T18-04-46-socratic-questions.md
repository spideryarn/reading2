# Socratic summaries — 2026-09-05T18-04-46

Model: `anthropic/claude-sonnet-5` · corpus root `output/summaries-corpus` · depth 1 · judged by `codex`

**What this eval cannot claim.**
- Every arm is a `bakeoff`, the control included: production asks for structure, titles, gists and questions in ONE long-context response, and this asks only for wording over a fixed tree.
- Nothing here sees an interaction between the new wording and the structure the model proposes in the same breath — that is what the cheap design buys its cheapness with.
- Nothing here touches `EXPAND_SYSTEM` (src/hierarchy-expand.ts), which has no question field at all, so no result covers the deepening cascade.
- A win is a reason to put a variant in front of Greg RENDERED (the plan's stage 2), never a reason to ship it.
- Depth-2 gists at two sentences are deferred, not measured: they raise TOKENS_PER_NODE and break evals/hierarchy-structure's baseline.

## Coverage

```
  854 of 854 calls came back.
  — every call came back and named the model it was sent to (an upstream swap
    serving the same model would not show here; see the comment at the check)
```

## Shape facts — observations, never scores

| arm | questions kept | never written | dropped by the rule | invented ids | median words | ends "?" | yes/no | bracketed hint | counted hint | hint after "?" | gists with meta-narration |
|---|---|---|---|---|---|---|---|---|---|---|---|
| incumbent | 61 | 0 | 0 | 0 | 10 | 100% | 16% | 0% | 0% | 0% | 0 |
| incumbent-repeat | 61 | 0 | 0 | 0 | 10 | 100% | 20% | 0% | 0% | 0% | 0 |
| gists-only | 61 | 0 | 0 | 0 | 11 | 100% | 15% | 0% | 0% | 0% | 0 |
| v1 | 61 | 0 | 0 | 0 | 16 | 100% | 13% | 92% | 15% | 0% | 0 |
| v2 | 61 | 0 | 0 | 0 | 14 | 100% | 13% | 84% | 13% | 0% | 0 |
| v3 | 61 | 0 | 0 | 0 | 17 | 100% | 39% | 100% | 8% | 0% | 0 |
| v4 | 61 | 0 | 0 | 0 | 18 | 10% | 18% | 100% | 20% | 90% | 0 |

## Calibration — FAILED

Five known-bad lines (#1 fabricated count — the child count (6) where the text says four; #2 neutral lookup question; #3 answer-leaking question; #4 title-only line; #5 the gist with a question mark on it) went into the question lineup for `noema-mythology-of-conscious-ai`/`n0048`. Checked over 3 lineup(s).
- noema-mythology-of-conscious-ai-r1/n0048: anchor-4 ranked above v1
- noema-mythology-of-conscious-ai-r1/n0048: anchor-2 ranked above incumbent
- noema-mythology-of-conscious-ai-r1/n0048: anchor-2 ranked above v2
- noema-mythology-of-conscious-ai-r1/n0048: anchor-2 ranked above v3
- noema-mythology-of-conscious-ai-r1/n0048: anchor-2 ranked above v1
- noema-mythology-of-conscious-ai-r2/n0048: anchor-2 ranked above v3
- noema-mythology-of-conscious-ai-r2/n0048: anchor-2 ranked above incumbent
- noema-mythology-of-conscious-ai-r2/n0048: anchor-2 ranked above gists-only
- noema-mythology-of-conscious-ai-r2/n0048: anchor-2 ranked above v2
- noema-mythology-of-conscious-ai-r2/n0048: anchor-2 ranked above incumbent-repeat
- noema-mythology-of-conscious-ai-r2/n0048: anchor-2 ranked above v1
- noema-mythology-of-conscious-ai-r3/n0048: anchor-2 ranked above incumbent
- noema-mythology-of-conscious-ai-r3/n0048: anchor-2 ranked above v2
- noema-mythology-of-conscious-ai-r3/n0048: anchor-2 ranked above v1
- noema-mythology-of-conscious-ai-r3/n0048: anchor-2 ranked above gists-only

**No ranking is reported.** The judge did not put every anchor below every real line, so it is measuring something other than the door-or-wall criterion and its ordering of the real arms says nothing. This is a result, not a failure of the run.

## Arms needing a change to production code if they win

v4
(`v4` puts the shape hint after the question mark, which `questionFor` would turn into "…? (4 arguments)?" — variants.md § The code change V4 needs.)
