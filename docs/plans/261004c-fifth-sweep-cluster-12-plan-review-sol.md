I would change the plan before building. The five cleanups are worthwhile; the main gaps are date handling and what the census test actually guarantees. No files edited.

1. **F1 — P1, established: the proposed HTTP-date parsing inherits a timezone bug.**  
   The letter guard admits all three HTTP-date forms, but `Date.parse` interprets the zone-less `asctime` form in local time. HTTP dates represent UTC. [RFC 9110 §5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7)

   Reproduced at `2026-10-04T12:00:00Z`:

   | Header | `TZ=UTC` | `TZ=Europe/London` |
   |---|---:|---:|
   | `Sun, 04 Oct 2026 12:00:30 GMT` | 30,000 ms | 30,000 ms |
   | `Sunday, 04-Oct-26 12:00:30 GMT` | 30,000 ms | 30,000 ms |
   | `Sun Oct  4 12:00:30 2026` | 30,000 ms | −3,570,000 ms |

   The planned positive-only parser therefore turns a valid future instruction into `null`. This is **pre-existing**, rather than a regression introduced by extraction, but the new shared parser would preserve it.

   **Change:** specify UTC handling for the zone-less form and test all three forms under UTC and London. Name this additional behaviour correction explicitly.

2. **F2 — P2, established: a filename census cannot enforce its stated promise.**  
   [The plan’s census](docs/plans/261004c-fifth-sweep-cluster-12-model-call-plumbing.md:63) compares sets of filenames. Adding `loadEnvLocal()` inside a request function in already allowlisted `pdf-read.ts` leaves that set unchanged. The promise that “a new request-path call turns it red” is therefore false.

   **Change:** retain the small census, but constrain the permitted calls within allowlisted files—especially `pdf-read.ts`’s CLI `main`. A filename allowlist alone is insufficient. This does not require a general import-policy framework.

3. **F3 — P2, reasoned: F11 should explicitly preserve streaming refusal read failures.**  
   Today [refuse](src/ai-call.ts:1760) uses `response.text().catch(() => "")`, then throws `ProviderRefused`. The image seam awaits `response.text()` without that catch.

   Copying the image seam literally would change a refused stream whose body fails to read into a transport exception, losing its status, classification and retry instruction. The priced-429 test would miss that change.

   **Change:** preserve the streaming drain catch and add a characterization case where a 429 body rejects while reading. It should remain `ProviderRefused`, produce exactly one error record, and expose no body text.

4. **F4 — P3, established: X13a names the wrong red cases.**  
   Current `effortFor` returns valid values correctly; it returns `""` for empty and `"hgih"` for invalid. The proposed expectations are red for **empty and invalid**, rather than the “last two” groups as written.

For each item:

| Item | Assessment of fix and tests |
|---|---|
| **R2** | The leaf is worth its keep: it avoids pulling fetching infrastructure into the gateway. The five-row table genuinely fails both existing parsers overall. Add F1’s date cases, whitespace cases and an explicit finite-result check. |
| **R3** | Deleting the seven unused checks is right. Retaining transcription’s 503 and embeddings’ explicit key semantics is right. The seven no-key characterizations should stay green; the census is genuinely red today, but needs F2. |
| **F11** | The metering change is right and the proposed test is genuinely red on both seams. Preserve F3’s drain behaviour, existing route-metadata handling, and assert exactly one record with `outcome: "error"`. |
| **R6** | The unified sentence is true of both discard paths. Centralizing it fixes the catalogue gap. Missing-export failure proves the move only; exact thrown-message assertions against existing discard fixtures provide the behavioural red-first evidence. |
| **X13a** | The tuple and shared helper are proportionate. Rejecting an invalid explicit override prevents a misleading eval. Reading it at call time preserves runtime overrides; unset production requests keep their defaults. Test each stage’s fallback, not merely the helper’s `undefined`. |

The remaining suspicions checked out as follows:

- **R3 catches and earlier work:** normal catch paths preserve `NOT_CONFIGURED`; `explainAbort` returns the original error when neither clock fired. Between the old checks and gateway calls, I found prompt construction, clock setup and local bookkeeping, with no I/O or reader events. Missing-key requests will additionally enter generic failure logging, but the gateway still checks the key before metering.
- **R3 entry points:** all 23 direct importers under `scripts/`, `evals/` and `tools/` either load the environment themselves or reach `db/client.ts`. Transitive offline consumers such as `reorder-quality.ts`, `structure-labels.ts`, `structure-whole-document/floor.ts`, `debate/label-sheet-cli.ts` and `skim-again-cap.ts` reach embeddings through model imports but do not invoke its key-loading path. I found no entry point needing a new load.
- **R2 zero policy:** `null` is a defensible conservative policy. The bibliographic change from one second to sixty seconds is substantial, but already explicitly named; add a caller-level cooldown assertion so that decision is executable. Zero remains valid HTTP syntax—treating it as fallback is application policy. [RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)
- **F11 accounting and bodies:** stubbed 429s carrying `cost: 0.125` currently produce one unpriced error record on each seam. `Meter.saw` overwrites figures; it does not accumulate them, and the refusal branch never enters the SSE loop. Failed streaming bodies are already read in full today, so this does not introduce unbounded reading. Non-JSON refusals must continue to become status-based failures.
- **Other gateway status sites:** image, transcription and decisions already meter usage before judging status.

VERDICT: change first

- Handle zone-less HTTP dates as UTC and add timezone coverage.
- Scope the census to permitted call locations.
- Preserve and characterize streaming refusal drain failures.
- Correct X13a’s red-case wording.