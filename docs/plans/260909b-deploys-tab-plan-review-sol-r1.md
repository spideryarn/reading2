Verdict: not ready to build unchanged. No P0s, but four P1s affect the tab’s central truthfulness or the dashboard’s availability.

## P1 findings

1. The claimed ambiguity is partly resolvable without a Vercel token.

Production already publishes two token-free build stamps:

- `/build.json` contains the client commit and deployment ID, emitted specifically for this purpose ([vite.config.ts](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/vite.config.ts:351)).
- `/api/health` contains the API artefact’s compiled commit and deployment ID ([vercel-health.ts](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/src/vercel-health.ts:122)).
- The deploy script already fetches and cross-checks both endpoints ([deploy.ts](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/scripts/deploy.ts:1225)).

They cannot enumerate missing deploys or recover their timestamps, so the NDJSON remains the deploy list. But they can identify the build currently serving production and split the range into:

- commits after the recorded watermark that are included in the currently serving build;
- commits in cached `origin/main` that are not included in the currently serving build.

Use “not in the currently serving build,” not “undeployed”: a later commit might have deployed and then been rolled back.

Also delete “Everything on `main` has either shipped or is shipping.” The deploy script pushes first and only then waits for Vercel; a failed or timed-out build leaves `main` advanced ([deploy.ts](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/scripts/deploy.ts:1576)). Manual pushes are prohibited by convention, not mechanically impossible.

Recommended wording when live stamps are unavailable:

> The recorded deploy history ends at `8cd2206a`. This checkout’s cached `origin/main` contains 287 later non-merge commits. Some may already have deployed; this view cannot tell.

With a verified live stamp:

> Production currently serves `LIVE_SHA`. Of the commits after the latest recorded deploy, A are included in that serving build; B later commits are present in this checkout’s cached `origin/main` but not in the serving build.

The live lookup needs its own unavailable/malformed/client–API disagreement arms and must never prevent rendering the recorded list.

2. A ref’s mtime does not measure how stale the view is.

The claim at [the plan’s no-fetch decision](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/docs/plans/260909b-deploys-tab-most-recent-production-deploys.md:86) is false in two ways:

- A no-op `git fetch` that verifies the ref is current does not update the ref’s mtime. It records when the ref last advanced, not when anybody last checked it.
- `origin/main` may be packed, in which case there is no loose per-ref file to stat; `packed-refs` has one unrelated mtime for many refs.

I reproduced the first case: a second successful fetch advanced `FETCH_HEAD`’s mtime while the loose remote-ref mtime stayed unchanged.

Either label it exactly as “local `origin/main` last advanced …”, or remove it. If actual freshness matters, use an asynchronous, cached `git ls-remote origin refs/heads/main`, which reads the real remote SHA without mutating refs, or perform a background fetch and record `lastAttempt`/`lastSuccess` explicitly. Do not use `FETCH_HEAD`; it is per-worktree and may describe another ref.

3. The tolerant-reader design can turn corrupt changelog data into a quiet deploy.

The plan reports unreadable lines, but it does not say what happens when the line parses and its `entries` field does not. A missing/non-array `entries`, unknown section, or malformed title/body can easily become an accepted version with zero usable entries. The panel then says, implicitly or explicitly, “nothing a reader would notice”—the exact opposite of “we could not read what changed.”

Required distinction:

- `entries: []` plus a valid matching `invisible: true` → genuinely quiet deploy.
- Some invalid entries → render the valid entries and say how many could not be read.
- `entries` missing/non-array, or `invisible: false` with no readable entries → changelog unavailable for this deploy, never quiet.
- Unknown extra object fields → harmless and ignored.

This invariant is not one of the product-only checks like headline caps or link policy. It directly governs the fleet panel’s truthfulness and therefore belongs in its reader.

4. Three `spawnSync` calls in an HTTP route can freeze the whole control plane.

The dashboard is one Node process, and the Overseer depends on its `/api/state`/SSE output; when the dashboard is unresponsive the Overseer has no independent source ([overseer-direction.md](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/docs/project/overseer-direction.md:384)). A slow disk or loaded box can therefore make one Deploys request block every session, action, heartbeat, and health request for the sum of three command timeouts.

Use asynchronous `execFile`/`spawn`, bounded output, and a timeout. Prefer a short-lived/single-flight cache because none of these values needs recomputing several times concurrently.

## P2 findings

5. The route needs independent state axes, not merely `deploys` versus `unreadable`.

A successful file read and a failed git/live probe can happen together. Do not let a comparison failure blank a usable deploy list. At minimum distinguish:

| Condition | Honest result |
|---|---|
| File cannot open/read | Deploy record unavailable |
| Valid empty file | No recorded deploys |
| Some bad lines/entries | Partial list with placed/countable omissions |
| All non-blank lines bad | Corrupt record, not “no deploys” |
| No usable watermark | List available; comparison unavailable |
| SHA missing or not ancestor | List available; histories not comparable |
| Git timeout/ref missing | List available; local comparison unavailable |
| Live stamps unavailable | List available; serving build unknown |
| Client/API stamps disagree | List available; production build inconsistent |
| Browser/network/malformed wire | `no-answer`, not server `unreadable` |

Give the wire a schema number and reject unknown schemas before reading either arm, as the health-history client already does.

6. Pin `origin/main` once before running the remaining git commands.

Other worktrees fetching is safe, but it makes `origin/main` mutable between processes. If command one reports SHA A, command two checks ancestry against SHA B, and command three counts to SHA C, the response is not a snapshot.

First resolve `origin/main` to one full SHA. Use that literal SHA in every subsequent ancestry and count command. These read-only commands do not touch the working tree or index, so concurrent edits are otherwise not a concern.

The decision not to fetch per request is sound; “fetching would interfere with agents editing” is not the strong reason. Network latency, repeated work, and caller-triggered ref mutation are.

7. The real-file test does not prove the two parsers agree.

“One accepted version per non-blank line” can pass while the fleet parser defaults fields, drops entries, derives different meanings, or accepts records the canonical parser rejects.

Keep the separate runtime parser, but strengthen the compatibility test:

- parse the real file with both readers;
- require the canonical parser to report no problems;
- project both results onto every field the fleet uses and compare them;
- separately test malformed/missing entries and the `invisible` invariant.

A test-only import of `src/changelog.ts` does not add a runtime fleet dependency.

8. `Record<Mode, …>` cannot catch an entire mode being lost.

`Mode` is derived from `MODES` ([mode.ts](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/mode.ts:30)). If a merge drops `"messages"` from `MODES` and drops its corresponding map entries, every `Record<Mode, …>` remains perfectly typed.

Replace “count by eye” with explicit post-merge tests asserting all concurrently expected mode keys and that `#deploys` renders `DeploysPanel`.

9. Refresh semantics are missing.

The persistent dock’s Refresh button currently refreshes fleet state only ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/App.tsx:227)), while its tooltip presents it as the page’s refresh control ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/tools/fleet/web/src/Dock.tsx:116)). On Deploys, pressing it could visibly do nothing.

Specify whether Deploys polls, refreshes on visibility, or loads once, and either connect the global Refresh button to the active panel or give Deploys an explicit refresh control.

## P3 findings

- Stage 1 is coherent. Stage 2 combines comparison semantics, process execution, file I/O, HTTP, and wire design; split the pure/injected git-and-live probe from route composition. Stage 3 combines wire parsing, request lifecycle, rendering, and contested navigation integration; split the client state machine from the panel/mount.
- “Data at a path” is movable only if the Spideryarn repository root is injected or configured. A source-relative path merely hardcodes the present monorepo arrangement differently.
- Parse the entire file before applying `limit`, or older corrupt lines disappear from the reported denominator and release numbering can change.

## Decision on the duplicate parser

Keep the fleet-owned subset reader. Adding `src/changelog.ts` to `ALLOWED` would violate the stated exception: it is leaf and dependency-free, but explicitly product-specific, while the exception requires product-agnostic modules ([overseer-direction.md](/home/greg/code/spideryarn2/.claude/worktrees/deploys-tab/docs/project/overseer-direction.md:1538)). That is not “one harmless allowlist line.”

So the boundary decision is good, not rationalisation. The weak parts are the claimed drift mitigation and the incomplete failure vocabulary, not the decision itself.

Security-wise, fixed commands, argv arrays, no shell, validated 40-hex revisions, and a limit that never reaches argv leave no meaningful command-injection path. The practical attack surface is resource exhaustion from synchronous spawning, plus ensuring route errors/stderr are bounded and rendered only as escaped text.