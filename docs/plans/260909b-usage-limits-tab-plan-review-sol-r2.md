Verdict: **reframed again**. The daemon/composition-root writer choice is sound and I am not reopening it. The remaining problems are in the persisted record, cross-process retention reporting, and writer lifecycle. Several can still silently erase or misrepresent history.

## Findings

### G1 — P0 — Stage 2/3, `keep-stored`: a publication decision is being mistaken for an unusable utilisation observation

At 10:00 a complete report records 60%. At 10:05 the same account’s cache says 80%, but one transcript is unreadable. `chooseUsage` correctly keeps the complete 10:00 report for the live checkpoint.

The revised plan persists the fresh cache but explicitly tests that a `keep-stored` line contributes no utilisation point. The chart therefore drops a valid, attributed 80% observation even though only the transcript scan was inconclusive.

`take-fresh`/`keep-stored` should be metadata about checkpoint publication, not the top-level historical fact. A report pass should independently record:

- its account-attributed cache observation, usable for utilisation history;
- its rate-limit scan and coverage, possibly inconclusive;
- the publication decision and carry reason.

The fresh 80% should become a point; the rejection evidence for that pass should become unknown/inconclusive. This simplifies the “discarded observation” arm: it was not wholly discarded, only declined as the replacement checkpoint.

### G2 — P0 — Stage 2/5, incidents: the ID is stable, but the incident is mutable across samples

Your narrow F2 claim is correct: `UsageIncident.id = window@resetsAt` is stable across passes, and `firstHitAt`/`lastHitAt` are real event instants.

The conclusion “dedupe by id” is nevertheless insufficient. The committed test itself constructs this sequence:

- first pass: incident X has one rejection;
- second pass: incident X has two rejections and another conversation;
- both have the same ID.

If Stage 5 keeps the first occurrence, it permanently reports one rejection and a truncated span. If it keeps an arbitrary or file-last occurrence, an incomplete later scan can replace richer evidence with poorer evidence.

Specify a cross-sample merge contract now. At minimum, for the same ID:

- `firstHitAt` is the earliest non-null value ever observed;
- `lastHitAt` is the latest;
- the displayed count has a named meaning, probably the maximum count from a complete scan;
- invariant fields such as window/reset must agree or the incident becomes unreadable.

Without raw hit IDs, counts from disjoint incomplete scans cannot be unioned exactly. That is acceptable only if the UI labels the count as the largest complete-scan count observed, rather than “rejections in these 24 hours.”

Also persist a narrower history incident than the full UI `UsageIncident`: the chart does not need every conversation UUID repeated every five minutes.

### G3 — P0 — Stage 4, retention: the accepted F6 status cannot cross the new process boundary

Health exposes `status()` because its writer and route share one dashboard process. The revised design puts the writer in the daemon and the route in the dashboard.

Sequence:

1. `usage.jsonl` becomes unwritable.
2. The daemon’s append records `failure`, `lastAttemptAt`, and `poisoned` in its in-memory store object.
3. The dashboard opens the still-readable old file in another process.
4. Its route has no access to the daemon’s in-memory status.
5. The chart grows an unexplained right-edge hole.

That is F6 relocated, not fixed.

Choose an explicit transport for writer status: checkpoint field, durable status sidecar, or a deliberately weaker route contract that reports “the recorder is overdue” from the records themselves. `lastAttemptAt`, `failure`, and `poisoned` cannot simply be “carried from the store” when the route holds a different store instance in another process.

### G4 — P0 — Stage 3/4, locking: the plan retains a second writer election after declaring it moot

D9 says the Overseer daemon’s existing lock guarantees one writer. Stage 3 nevertheless copies health’s independent writer-lock machinery.

Two simultaneous starts can elect different winners:

1. Process A wins `usage-history/writer.lock`.
2. Process B wins the main Overseer lock.
3. A exits because it cannot become the daemon.
4. B runs as the real daemon with a permanently read-only history handle.

No history is written until another restart. G3 then prevents the dashboard from explaining why.

There is a second ambiguity: Stage 3 specifies one `openUsageHistory()` providing append and bounded read, while Stage 4 says the dashboard reads without taking a lock. If the dashboard uses that opener, starting the dashboard first can claim the writer lock and prevent the daemon writing.

Rely on the already-held Overseer lock for writer exclusivity. Keep partial-write poisoning, repair, rotation safety, modes, and read retry, but remove the second election. Provide a separate stateless/read-only API for the dashboard, and ensure repair/open-for-write occurs only after `runOverseer` has acquired the main daemon lock.

### G5 — P0 — Stage 4, `onPass`: callback failure can become a false collector failure or an unhandled rejection

The existing promise chain is:

```text
usage.run().then(collection-success).catch(collection-failure)
```

If `onPass` performs the synchronous append inside `.then()` and that append throws:

1. the `.catch()` interprets the retention failure as a failed `collectUsage`;
2. the live checkpoint is changed to `{kind:"none"}` even though collection succeeded;
3. calling `onPass` again for that apparent failure can throw again;
4. the promise can become an unhandled rejection and terminate the daemon.

The plan’s statement that F6’s crash path is wholly moot is therefore too broad. The request-path crash disappeared; a daemon-promise crash remains.

Add a failure-isolated `safeOnPass`: callback errors must update/log retention state without entering the collector’s `.catch()`, changing the live usage result, or preventing later passes. Test a throwing callback on all three outcomes and prove the next pass still fires.

### G6 — P1 — Stage 2: “a type and tests, no behaviour” cannot satisfy its own acceptance criteria

A TypeScript type is erased at runtime. It cannot round-trip bytes or reject a record missing its source instant.

As written, Stage 2 can either:

- write compile-time fixture tests that do not prove disk parsing; or
- quietly introduce a parser/serializer/constructor despite saying it contains no behaviour.

Then Stage 3 must still invent the actual persistence boundary.

Make Stage 2 a real codec/schema stage—typed constructor/encoder plus loose read-side parser—or fold it into the beginning of Stage 3. Given the migration cost of a wrong V1, a separate codec stage is defensible; the current type-only stage is not.

The schema should explicitly settle fields still left implicit:

- `nextDueMs`;
- the fresh report’s source instant on a carry;
- cache `fetchedAt`, account attribution, window reset instants and window arm;
- incident merge fields;
- whether a carry names the held report’s source instant;
- bounds on every persisted string/list.

`summarySchema` is necessary. A separate line/envelope schema is also useful. `checkpointSchema` is not useful provenance here: the record is produced from an in-memory `UsageReport`, and any checkpoint envelope constructed in `scripts/overseer.ts` is synthetic. Drop it unless actual checkpoint bytes are the source.

### G7 — P0 — Stage 3, unknown schemas: “tagged and skipped” can reconnect a line across unread history

Suppose schema 2 writes twelve samples, then the dashboard is rolled back to a schema-1 reader. The plan says those lines are “tagged and skipped.”

If “skipped” means removed from `samples`, the chart can connect the last schema-1 point before that hour to the first one after it, claiming continuous observation across data this reader explicitly could not interpret.

An unknown-summary record must survive positionally as an unsupported sample or a bounded hole. It should break every affected series and contribute to an explicit unsupported/unreadable count. It must not merely disappear.

### G8 — P1 — D6/Stage 2: the record still does not actually contain the promised cadence

D6 and Stage 5 say recorder gaps are derived from source instants and “the recorded cadence.” The Stage 2 record checklist never adds the equivalent of health’s `nextDueMs`.

With a ten-minute injected interval—or a future production cadence change—a reader assuming five minutes marks every ordinary interval as a recorder failure. Adding the field later is a persisted-format change.

Put the expected next-pass interval on every arm, including collector failure and omission records, and validate it as finite and positive.

### G9 — P2 — F11: `recordedAt` does not by itself surface a clock regression

At 10:05 a report is collected and appended. NTP steps the wall clock backwards. The next report is collected and appended at 10:00. Both `collectedAt` and `recordedAt` regress together.

Keeping the two clocks separate is useful, but nothing in the revised tests detects this sequence. A reader copied from health can still draw a backwards segment or calculate gaps against the wrong predecessor.

Add a reader/series test for non-increasing source or append times. Preserve file order, break the affected series, and report a clock regression. Do not sort it into plausibility. A per-run sequence number would make detection simpler but is not required.

### G10 — P1 — F13/multi-account appendix: the ruling and the plan still contradict one another

The rulings table says the “nothing in the store” claim was softened because an old account becomes an opaque UUID. The appendix still begins:

> **Nothing in the store.** Every line already carries `accountUuid`…

Sequence:

1. Account A produces history.
2. Greg switches to B.
3. The current checkpoint can describe only B.
4. A remains only as `acct-…`.
5. A future picker cannot give A a meaningful label without a record migration or external mapping.

Stage 2 must either store a stable display descriptor or explicitly accept UUID-only historical labels as the product decision. The current text does neither.

### G11 — P1 — Stage 4/5 boundary: the route contract omits fields Stage 5 already depends on

The Stage 4 tests do not pin the health precedent’s `schema`, `fromMs`, `toMs`, `predecessor`, `earliestAt`, `rotated`, or `refreshMs`, although Stage 5 needs them for the server-clock axis, left-edge classification, “before history began,” and right-edge overdue detection.

If the implementation follows only the listed route tests, Stage 5 must reach backward and change the route contract, or compute the display window from the browser clock and misplace history under skew.

Pin the entire route envelope in Stage 4. Also move the `~/.overseer/usage.jsonl` seam-table documentation into Stage 4; otherwise stopping after the live writer lands leaves the architecture documentation false until Stage 6.

### G12 — P2 — D8/Stage 2 wording: freeze at collection time, not literal write time

The detailed text says “as it was at its own `collectedAt`,” which is correct. The repeated phrase “freeze validity at write time” is not.

Concrete boundary:

1. Collection starts at 11:59:50 with a valid 70% window resetting at 12:00.
2. The transcript scan takes 40 seconds.
3. The record is appended at 12:00:30.
4. Literal append-time validation changes a valid historical observation into expired.

Persist the producer’s discriminated window arm as adjudicated against the collection instant, plus percentage/reset/source facts. Do not add a second `valid` boolean or re-run expiry at append time.

A historical point remaining visible after its reset is correct. It is an observation at 11:59:50, not a claim that the window remains current. The live card may simultaneously say the window has reset; the chart should label its points as “as observed.”

### G13 — P3 — Plan structure: superseded analysis is now obscuring executable decisions

The duplicated “The reason that was wrong,” obsolete dashboard-writer fork, and long history of the seam dispute make the live requirements harder to locate and have already left contradictions such as D9 versus Stage 3 and the F13 ruling versus the appendix.

Keep the settled composition-root decision and a short rationale. Move the forensic narrative to the round-one review or a research note. The next implementer needs the record contract, invariants, and stage checklist more than the history of each abandoned branch.

## Direct answers to the requested questions

Freezing validity is the right answer to F1, provided it means preserving the producer’s collection-time arm. Recomputing validity from raw ingredients in the reader is not strictly better: it duplicates the authority’s rule and can reinterpret old data after a deployment. Store the auditable ingredients alongside the adjudicated arm, but do not let the current viewing clock change it.

The F7 invariant is substantively sufficient only when all its terms are executable:

- “record size” means the full newline-terminated serialized line;
- every legal record is bounded;
- production has a defined minimum pass interval;
- oversized records produce positional omission markers;
- the test appends maximum-sized valid lines through more than two rotations and queries immediately before and after rotation.

A constant assertion such as `MAX_FILE_BYTES >= 288 * MAX_LINE_BYTES` is tautological and misses rotation behavior. I would keep a generous 64 KiB line ceiling, narrow the historical incident payload, and raise the file cap—32 MiB is cheap here—rather than make today’s 6.8 KiB observation the legal ceiling.

Stage safety:

- Stage 1 is a good, safe stopping point.
- Stage 2 is not deliverable as written; make it a codec stage or merge it into Stage 3.
- Stage 3 is safe while inert, after removing the independent writer election and defining the read-only API.
- Stage 4 is safe only once callback containment, writer-status transport, and the complete route contract are joined. Route-first against an empty fixture is otherwise fine.
- Stage 5 is a safe visible stopping point.
- Stage 6 should contain explanatory/polish docs, not the first documentation of a store already writing production files.

Rulings most in need of correction are F2, F4, F6, F9, F10, F11, and F13. F1, F3, F5, F7, F8’s separate-summary-schema conclusion, and F12 are directionally right.

I attempted:

```text
npx vitest run tests/overseer-usage-carry.test.ts tests/overseer-store-usage.test.ts
```

Vite failed before loading any test because the sandbox could not create `node_modules/.vite-temp` (`ENOENT`). **No tests ran.** The carry and incident conclusions above are therefore source-derived; the committed incident test does directly demonstrate that one stable ID can have richer contents on the next pass.

Final verdict: **reframed again**—keep the daemon/composition-root writer, but redesign the record around independent observations, remove the second writer election, and explicitly solve retention status across the daemon/dashboard boundary before building Stage 2.