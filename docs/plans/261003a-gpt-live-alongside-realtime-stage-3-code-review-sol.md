Four P1 findings fixed; changes are uncommitted.

| ID | Severity | Location | Finding / disposition | Test observed red |
|---|---|---|---|---|
| D1 | P1 | `useGptLive.ts:1282` | `pagehide` finalized accounting before final usage arrived. **Fixed:** nonterminal keepalive checkpoint. | “posts final usage delivered after pagehide, once, with keepalive” |
| D2 | P1 | `segments.ts:327` | Typed messages lost literal brackets and joined without spaces. **Fixed:** distinct literal-text event. | “keeps spaces and literal brackets between typed messages” |
| D3 | P1 | `useGptLive.ts:1213`, `segments.ts:531` | Typed questions could follow their answers after a timeline freeze, or merge into an already answered question. **Fixed:** observed timeline anchor and explicit boundary. | “keeps a typed question before its answer when the provider timeline freezes”; “begins a new typed question after even a short spoken answer” |
| D4 | P1 | `useGptLive.ts:840` | The channel remained active during final saves; fragments arriving during the second append missed persistence. **Fixed:** stop the producer before the final snapshot. | “ends the transcript producer before waiting for a slow final append” |
| D5 | P2 | `session-shared.ts:150` | Both engines accept unchecked passage IDs; server validation can subsequently reject the entire exchange. **Reported only:** inherited shared behavior, outside the permitted fix scope. | Invalid-ID assertion probe: `[null]` became `["null"]` |

Changed files:

- `src/web/live/gpt-live/{segments,stall,useGptLive}.ts`
- `src/web/live/meter.ts`
- `tests/gpt-live-{session-flow,meter}.test.*`
- Two root-cause notes under `docs/postmortems/261003{b,c}-*.md`

**Validation:** 219 tests passed across 10 files, including all GPT-Live tests and shared meter/import/doc guards. Complete typechecking passed through `node --import tsx scripts/typecheck.ts`; the npm launcher hit sandbox IPC restrictions. Lint reported only three complexity advisories.

**Please run:** `npm test`, `npm run typecheck`, and `npm run check` in the normal environment, then Stage 4’s real browser/provider checks, including overlapping delegations.

**Verdict: PASS for the scoped Stage 3 fixes.** D5 remains a separate shared issue; real browser/provider acceptance is still outstanding.

