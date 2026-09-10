# Plan review findings — 260910f

Verdict: **refuse the plan as written**. F1–F6 and F9 are established P1s against the stated acceptance/contracts. F7–F8 are P2 simplifications/risks. No repository file was changed.

## F1 — P1 — established: the “global hard” budget has a bypass and a crash gap

**Scenario / contradicted contract.** Today `overseer attention` makes paid calls while being read-only by default; `--write` governs only `attention.json`, and it can run beside the locked daemon. D4/Stage 1 say “one ledger”, “refusal before a call”, and “one call in flight”, but never say that the daemon and CLI share an exclusion/reservation operation, that `--no-write` still records spend, or that the reservation is durable *before* the fetch. Two processes can both observe one remaining call and both spend it; a process can die after the request and before recording it, restart, and spend it again. A missing/unreadable ledger is also unspecified, so the natural “start empty” recovery resets the day. Recording tokens/cost after the response is accounting, not the roadmap’s hard token/cost limits.

**Smallest plan change — replace D4 and the Stage 1 budget bullet with:**

> `model-budget.ts` is the only entry to every paid attention call, daemon or CLI. Under one dedicated kernel-backed budget lock, it (1) refuses an absent-after-initialisation, unreadable, future-day or backward-day ledger loudly; (2) checks the global call, prompt-token, completion-token and cost reservations; and (3) atomically persists and fsyncs a worst-case reservation **before** issuing the request. The lock is held until reconciliation; a crash leaves the reservation spent. `--no-write` controls attention memory only, never budget accounting. Every request has a hard output-token cap. Tests race a daemon call with a CLI call, kill after reservation/before response, restart, cross UTC midnight during a call, and corrupt/delete an initialised ledger; none may exceed or reset the ceiling.

## F2 — P1 — established: additive `AttentionList.judgement` is silently ignored by old consumers

**Scenario / contradicted contract.** All three existing parsers project known fields and ignore extras. A new producer can publish `{kind:"list", items:[], judgement:{kind:"exhausted"}}`; an old fleet server or old browser ignores `judgement` and draws “nothing is waiting on you”. Conversely, D6 does not say how a new parser treats an old producer with no judgement field. Stage 2 specifies compatibility only for `AttentionItem.proposal`, not this more dangerous list field. That violates “exhausted is loud” exactly during rolling-version skew.

**Smallest plan change — replace D6 with:**

> Budget state is compatibility-safe, not an additive warning. A fully judged list remains `kind:"list"` and carries a required `judgement:{kind:"complete"}` for new readers. A stopped model pass is a new `kind:"limited"` arm carrying the mechanical items/counts plus `judgement:{kind:"exhausted"|"cooling-down", why, until}`. Old parsers already reject an unknown list kind into their loud `unknown`/`feed-unreadable` state; new parsers treat an old `kind:"list"` with no `judgement` as unknown (“this producer predates bounded judgement”), never complete. Test new producer→each old parser and old checkpoint→each new parser.

## F3 — P1 — established: the proposal cache has no failure-exclusion contract

**Scenario / contradicted contract.** D3/Stage 2 introduce a proposal cache, while `AttentionProposal` includes `not-reached` for budget, cooldown, 429, unreadable output and quote-validation failure. Nothing limits what may be stored. Caching the whole union makes a transient 429 or malformed answer a permanent fact for an unchanged tail—the precise class that `CacheableVerdict = Exclude<..., unreadable>` currently prevents.

**Smallest plan change — add after the proposal union:**

> Define a separate `CacheableProposal` type containing only successful model judgements (`proposed` and `unplaced`). `off`, `not-reached`, quota/cooldown/transport/parse failures, failed quote checks, and `from-report` projections are never written to model memory. A failure is retried subject to the shared budget and cooldown. Tests first observe 429/unreadable/missing-quote, then a good response for the unchanged key.

## F4 — P1 — established: two displayed judgements have no trustworthy speaker attribution

**Scenario / contradicted contract.** The model arm has free-form `by: string`, `from-report` has no source field, and `ProposalMark` has no actor/recorder. Any same-Unix-user process can invoke the proposed mark CLI. A card that merely shows “right”, “wrong”, or a report-derived instruction can therefore be read as Greg’s judgement even though the record cannot establish that. This contradicts “no proposal becomes Greg’s voice” and gate 1’s required attribution.

**Smallest plan change — replace the relevant shape/copy with:**

> `by` is producer-stamped structured data, never model output: `{kind:"model", model: ATTENTION_CLASSIFIER_MODEL, via:"overseer"}`. `from-report` carries `{reportedBy:{kind:"session", name, observedExecution}, eventId}` and renders “reported by session X; recorded by the Overseer; not Greg”. A mark carries `recordedVia:"local-cli"` and an optional `claimedBy`, both displayed; without authenticated identity the UI must say “marked via local CLI (identity not verified)”, never imply Greg marked it. All parsers validate these arms and tests assert that no rendered arm uses Greg as speaker without authenticated Greg evidence.

## F5 — P1 — established: `same-verified-run` at report receipt does not join the report to the current run

**Scenario / contradicted contract.** `ReportEvent.execution` is a comparison frozen when the daemon drains the report. D10 later joins on session name plus that historical string. If Claude exits and a new Claude starts in the same tmux session/name, the old blocked report still says `same-verified-run` and is attached to the new pane. `readReports()` also exposes `correctedBy`, but D10 does not exclude corrected reports. The result is a current proposal derived from a stale or explicitly corrected claim.

**Smallest plan change — replace D10’s eligibility sentence with:**

> Carry the current register’s verified execution token into `SessionToScan`. A report shortcut is eligible only when the row is uncorrected, its actor name matches, `event.execution === "same-verified-run"`, and `event.observedExecution` exactly equals the current session’s verified token. Missing/current-unverified/different execution or `correctedBy !== null` means no shortcut. The proposal records that token and the report event id. Test a same-name relaunch and a later correction.

## F6 — P1 — established: `K/N` cannot measure avoided waiting or decision value

**Scenario / contradicted contract.** Stage 3 calls `K` “would not have needed Greg” even though this stage sends nothing, so it cannot actually avoid waiting. It divides by every proposal, including wrong and unjudged proposals. A model that routes every item away from Greg scores highly even when every reviewed route is wrong; that can support the wrong “worth it” conclusion.

**Smallest plan change — replace the Stage 3 stats/evaluation wording with:**

> Report `N proposed; R independently marked right; W wrong; U unjudged; K of the R correct proposals named a non-Greg holder`. Call `K` “could have avoided asking Greg”, not “would not have needed Greg”; actual avoided waiting is explicitly **not measured** because this stage sends nothing. The decision metrics are proposal accuracy among judged items, correct non-Greg routes per surfaced true question, coverage, and cost per correct non-Greg route; unjudged items remain a separately visible denominator and cannot count as success.

## F7 — P2 — established: the second model call costs more machinery than it buys

**Scenario / contradicted principle.** D1’s reason is not technically binding: proposal mode can select a widened prompt/version only when `OVERSEER_PROPOSALS=1` or `--propose` is present. Enabling it causes one bounded cold reclassification, just as the separate proposer must make a cold call for every cached positive. For new tails the wider response produces verdict and route in one request; the proposed design adds a module, a second cache lifecycle, a second failure state, and a second billable request for each positive.

**Smallest plan change — replace D1/D2 with:**

> Use one classifier call. With proposals off, retain the current prompt/version and output. With proposals on, use a proposal-aware prompt/version whose `asked:true` arm also returns `recipient`, `reason`, and verbatim `asks`; validate the same closed union and substring rule. Enabling it creates one bounded cold reclassification under the day budget. Keep the single transport in `attention-classify.ts`; do not add `attention-propose.ts` or a second model call unless the evaluation demonstrates that the combined prompt damages question detection.

## F8 — P2 — reasoned: cached `reach` can become stale on an unchanged question

**Scenario / contradicted contract.** The cache key covers tail/reports/version, while `reach` lives inside the proposal and comes from a changing usage reading. Unless the implementation happens to split them, a Fable proposal cached while capacity is available can continue to say available after the account becomes limited, or remain unavailable after recovery.

**Smallest plan change — add after the `reach` paragraph:**

> `reach` is a live projection and is never stored in the model-result cache or included in the proposal id. Cache only the model’s recipient/reason/asks; derive reach on every pass from the current usage reading. Test available→limited→available with an unchanged tail and no additional model call.

## F9 — P1 — established: the veto log has multiple writers but no write protocol

**Scenario / contradicted contract.** D9 says the CLI directly appends `proposal-marks.jsonl`, while Stage 3 says the daemon appends `proposals.jsonl`; it specifies no lock, fsync, initialisation marker/lost state, idempotency key, parser, or concurrent-write test. The store’s established rule is that append-only history needs an enforced writer protocol; the existing decisions log is a deliberate exception with its own kernel lock, repair, init marker and validation. Two mark CLIs can race, a crash can tear a record, and deletion/truncation can read as “no veto”. A recorded wrong mark is the safety mechanism here, so silently losing it violates “vetoable”.

**Smallest plan change — replace D9/Stage 3’s two-log wording with:**

> Use one `proposal-events.jsonl` containing idempotent `proposed` and `marked` events. The daemon is its sole appender. `overseer-proposals mark` writes a bounded, atomically-renamed submission into `proposal-mark-inbox/`; the daemon validates and drains it under its existing ownership, then appends+fsyncs. An init marker makes an absent/empty log after first use loudly `lost`; a torn tail is repaired only by the owner. Bound directory scan, bytes and records per pass, and test concurrent submissions, retry/idempotency, crash after prepare/before append, torn tail, and lost log. If that machinery is disproportionate for default-off v1, keep marks in the explicit evaluation artifact and defer the live mark/log rather than adding an unsafe writer.

## Notes on the candidate’s named suspicions

- D3’s content+version key is sufficient for a pure model judgement because it covers model input, but it is not sufficient to establish current execution for D10 or to scope a human mark to a run. F5 fixes the former; if marks are intended to be per-run, their identity must additionally include execution.
- The `AttentionList` compatibility issue is F2.
- The extra-log concern is F9. `proposals.jsonl` should be omitted unless the corrected evaluation genuinely needs longitudinal live history; the checkpoint plus an explicit evaluation artifact may be enough for the default-off v1.
