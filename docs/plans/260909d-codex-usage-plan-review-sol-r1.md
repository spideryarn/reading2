Verdict: **ready with changes; not ready to build as written.** I found no P0, but several P1s affect which credential and bucket are being measured, whether the reading is current, and whether it reaches disk/browser at all.

The review is pinned to commit `863742d9`. The shared worktree advanced during review; later commits appear to address some protocol mechanics, but they are not part of this verdict.

## Findings

### 1. P1 — ChatGPT credits do not establish the API-key fallback’s balance

Plan `863742d9:L110-L114` concludes that `credits.hasCredits: false` means `CODEX_API_KEY` has no funds. That inference crosses two distinct credentials.

The bindings generated locally from Codex 0.153.4 define separate `apiKey` and `chatgpt` account kinds. The measured response has `planType: "pro"` and came through `~/.codex/auth.json`; its nested credits describe that ChatGPT/Codex account, not a platform API key. The repo itself says withholding `CODEX_API_KEY` is how the ChatGPT subscription is selected ([run-codex.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/scripts/run-codex.ts:132)).

**(a) Construct:** configure a funded `CODEX_API_KEY` while the logged-in ChatGPT account reports:

```json
{"planType":"pro","credits":{"hasCredits":false,"balance":"0"}}
```

The plan would display “no API-key credits behind this” despite the key being funded.

**(b) Smallest change:** delete finding 3 and the proposed “no API credits” stat. If retained, label it narrowly as “ChatGPT/Codex credits” after independently confirming that meaning. Treat API-key fallback capacity as unknown unless separately queried.

---

### 2. P1 — The nine-second movement does not prove the useful numbers are live

The observation proves that one output field was recomputed from time. It does not prove where that computation happened or that `usedPercent` and the billable `codex` bucket were freshly fetched.

The moving field belongs to the unused `codex_bengalfox` 300-minute window and is effectively `now + 300 minutes`. A local adapter can reproduce the evidence perfectly while retaining a cached percentage:

```ts
return {
  usedPercent: cached.usedPercent,
  resetsAt: Math.floor(Date.now() / 1000) + 300 * 60,
};
```

Two calls nine seconds apart produce reset instants nine seconds apart without any new backend reading. A response assembled from partly cached and partly synthesized fields is another viable explanation.

**(a) Condition:** the CLI caches the last usage snapshot but synthesizes reset instants for unused windows. The plan accepts an old `codex.usedPercent` as live because an unrelated Spark reset moved.

**(b) Smallest change:** replace “proved live/no staleness arm” with:

> The call produces a freshly timestampable response, but the +9-second reset alone does not establish the cache provenance of every field.

Keep a defensive `expired`/unusable arm or enforce `resetsAt > sourceAt` for values, and re-evaluate expiry for the live card. For an independent check, inspect the exact 0.153.4 implementation or HTTP response, or prime once, block backend access, and see whether the same structured result remains available. I could not perform that network-dependent check here.

---

### 3. P1 — The collector must explicitly remove `CODEX_API_KEY`

The plan says it measures the ChatGPT subscription but does not specify the child environment. Codex prefers `CODEX_API_KEY` when it is present; this is why `run-codex.ts` deliberately removes it for the subscription attempt.

**(a) Condition:** start the Overseer with `CODEX_API_KEY` exported, then implement Stage 2 with an ordinary inherited environment. The child may authenticate as the API-key account, fail because rate-limit reads require ChatGPT auth, or report a different account. All three make the “Codex subscription” card wrong.

**(b) Smallest change:** add to Stage 2:

```text
Spawn app-server with CODEX_API_KEY absent while preserving HOME/CODEX_HOME.
Test the exact child environment through the fake executor.
```

The returned `accountId` should also be checked against the intended ChatGPT account whenever available.

---

### 4. P1 — There is no awaited path from the asynchronous collector to the synchronous recorder

`collectCodexUsage` necessarily returns a promise, but the existing retention hook is synchronous ([usage-history-wiring.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/usage-history-wiring.ts:26)). The daemon deliberately does not await promises returned by `onPass`; it only catches their later rejection ([daemon.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/overseer/daemon.ts:788)). Shutdown waits for `usageRunning`, then closes the writer.

**(a) Condition:** `onPass` starts the 1.9-second Codex collection, the daemon receives shutdown, `usageRunning` settles, and `usageRetention.close()` runs. The later append reaches a closed descriptor—or never happens—with no positional history marker.

**(b) Smallest change:** broaden the stated scope and make the hook awaited but failure-isolated:

```text
Allow onPass to return Promise<void>.
Include the awaited hook in usageRunning.
safeOnPass must swallow/log both synchronous and asynchronous failures so they
cannot turn a successful Claude pass into collector-failed.
The hook catches Codex collection failure and appends codex:{kind:"unknown"}.
```

That preserves one line per combined pass and makes shutdown ordering real. The current “nothing in the daemon loop beyond its existing hook” exclusion is incompatible with the proposed collection.

---

### 5. P1 — The field reaches the server decoder but is currently discarded at the browser boundary

I constructed a schema-1 history line containing top-level `codex`. `decodeUsageHistoryLine` retained it, but `parseUsageHistory` reconstructed the line with only `nextDueMs`, `recordedAt`, and `pass`; `codex` disappeared. This follows directly from [usage-history-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/web/src/usage-history-client.ts:181).

**(a) Reproduction result:**

```text
server decoder: line { kind: 'unknown', why: 'codex failed' }
browser parser: line { nextDueMs, recordedAt, pass }   // no codex
```

Thus Stages 2 and 3 can be green while the proposed card has no input.

**(b) Smallest change:** Stage 4 must explicitly include:

```text
usage-history-client.ts: tolerant Codex parser and browser view types
UsageHistory.tsx/UsagePanel.tsx: defined ownership of the newest Codex reading
An end-to-end test: route payload -> parseUsageHistory -> rendered Codex card
```

If the card uses the history route, its age must come from `codex.readAt`, not the enclosing Claude pass’s source instant.

---

### 6. P1 — Duration is suitable for a label, not as the sole storage key

The plan correctly proves that `primary` and `secondary` are positions. It then replaces one positional assumption with a duration-key assumption.

**(a) Conditions:**

- Both positions contain 10,080-minute windows: a map keyed as `weekly` silently overwrites one.
- `windowDurationMins: null`: the proposed unknown arm has neither duration nor slot, so the promised “named unknown” cannot be named.
- OpenAI introduces a 1,440-minute window: a closed duration-to-name mapping either drops it or marks a valid percentage unknown merely because the friendly label is unknown.

**(b) Smallest change:** preserve provenance as an array:

```ts
type CodexUsageWindow =
  | {
      kind: "value";
      slot: "primary" | "secondary";
      windowMinutes: number;
      usedPercent: number;
      resetsAt: string;
      resetsAtMs: number;
    }
  | {
      kind: "unknown";
      slot: "primary" | "secondary";
      windowMinutes: number | null;
      why: string;
    };

type CodexUsageBucket = {
  limitId: string;
  windows: CodexUsageWindow[];
};
```

Use 300 → “5 hours” and 10080 → “7 days” only as display aliases. An unfamiliar positive duration remains a value displayed by its raw duration.

---

### 7. P1 — Bucket precedence and the decision-relevant bucket are undefined

The response contains both a backward-compatible `rateLimits` snapshot and `rateLimitsByLimitId`. The plan does not say how to deduplicate them, adjudicate disagreement, or prevent the Spark bucket from standing in for general Codex headroom.

**(a) Conditions:**

```json
{
  "rateLimits": {"limitId":"codex","primary":{"usedPercent":24}},
  "rateLimitsByLimitId": {
    "codex":{"limitId":"codex","primary":{"usedPercent":31}},
    "codex_bengalfox":{"primary":{"usedPercent":0}}
  }
}
```

Or omit `rateLimitsByLimitId.codex` while leaving Spark at 0%. A plausible implementation can show 0%, duplicate Codex, or silently choose 24/31.

**(b) Smallest change:** state and test these rules:

```text
rateLimitsByLimitId is canonical when present; rateLimits is fallback only.
A duplicate codex snapshot that disagrees becomes unknown, not “first wins”.
Validate each map key against a non-null inner limitId.
The general `codex` bucket is the decision input; if absent, general headroom is
unknown. Other model buckets remain informational and cannot substitute for it.
```

This also adds a distinct absence: “target bucket absent,” separate from “bucket present but one window absent.”

---

### 8. P2 — The session-log fallback adds more uncertainty than v1 needs

The fallback lacks the live response’s account attribution, multi-bucket view, and reset-credit summary. Its percentage is an earlier observation, not current headroom; showing its age does not make it safe for a routing decision.

**(a) Condition:** app-server fails and the newest session snapshot is yesterday’s 24% weekly observation. The plan returns a value reading. The card can look healthy even though subsequent usage may have exhausted the account.

**(b) Smallest change:** move session-log fallback to follow-up work. V1 should return an explicit unknown when app-server fails. If retained now, model it as “last observed/lower-bound,” populate unavailable facts as their own unknown arms, and forbid it from positively clearing the account for more work.

This also simplifies Stage 2 substantially: one parser, one freshness story, one account identity source.

## Schema decision

Your central decoder reading is correct: bumping `SUMMARY_SCHEMA` from 1 to 2 would make all existing schema-1 lines unsupported because the decoder accepts only exact equality ([usage-history-record.ts](/home/greg/code/spideryarn2/.claude/worktrees/codex-usage/tools/fleet/usage-history-record.ts:304)). An additive optional field whose absence has explicit semantics should not bump it. Old readers safely continue drawing Claude and make no Codex claim.

Two qualifications:

- The decoder does not really “validate the fields it knows”; after a few envelope/source-time checks it casts the nested object to `UsageHistoryLine`. The new reader must validate Codex independently and degrade malformed Codex to `unknown` without discarding a valid Claude observation.
- Reconcile the `LINE_SCHEMA` comment saying it is bumped when the line shape changes. Either define schema bumps as breaking changes, or explain why an optional extension is not one.

There are more than three relevant absences:

1. No `codex` key: writer predates/does not know the field.
2. Codex collection attempted and failed.
3. Target `codex` bucket absent.
4. Bucket present, expected window absent.
5. Reading succeeded but `accountId` is null: observed but unattributed.
6. A source cannot provide a particular fact, such as reset credits from a session log.

Unreadable, unsupported, and omitted whole lines remain outer positional states already handled by the store.

## Coverage of your five questions

1. **Live versus cached:** answered logically; the evidence does not establish the claim. I could not perform the independent network check.
2. **Primary/secondary:** answered. They are positions, but duration should be a display discriminator while source slot remains preserved; bucket precedence also needs definition.
3. **Schema:** answered against the decoder. No `SUMMARY_SCHEMA` bump is the right choice, with the validation and browser-boundary qualifications above.
4. **Bad numbers reaching the decision:** answered. The largest paths are credential inheritance, irrelevant-bucket substitution, stale fallback, duration-key collisions, and the API-credit mislabel.
5. **Excess complexity:** answered. The session-log fallback is the clearest v1 cut; it creates most of the additional freshness and attribution states without evidence that the primary collector needs rescuing.