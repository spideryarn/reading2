## Verdict

The Luna guard is reasonable as an instrumented beta trial, but the original conclusion overstated its evidence and understated its cost. I corrected the [plan section](/home/greg/code/spideryarn2/.claude/worktrees/fidelity-guard-probe/docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md:176), [scorer](/home/greg/code/spideryarn2/.claude/worktrees/fidelity-guard-probe/scripts/probes/261001h-fidelity-guard-probe.ts:362), and [borderline labels](/home/greg/code/spideryarn2/.claude/worktrees/fidelity-guard-probe/docs/plans/261001h-fidelity-guard-labels.json:35). No `src/` files or paid calls were involved.

1. Arithmetic:

- 33%, 7%, 17%, 11%, and 30% are correct under the pooled independent-retry model.
- The 7% is per requested level; among levels actually stored it is 8%.
- Because retries repeat the same level, a level-specific sensitivity calculation gives approximately 7% faulty, 18% faulty under store-the-retry, 13% unavailable levels, and 35% unavailable presses.
- The controls’ 0.2% was wrong under the stated borderline policy. Excluding the borderline gives 3/149 flagged levels: about 0.1% press loss under fail-closed and zero under store-the-retry.
- The claimed $0.0024 Luna press cost treated partial historical runs as full presses. It is $0.0027 across complete presses, or $0.0026 on `pidpre`.
- Most importantly, “about 2% more spend” counted only the checker. Including projected retries gives roughly 35% extra spend on the problem paper and roughly 4% on controls.

2. Adjudication:

- The three real alarms are correctly adjudicated: the Gwern melt/freeze reversal, PID entropy-direction error, and Olah composition/local-code confusion.
- The true-elsewhere calls checked out, including the moderate-correlation result in `spya-ybmve2`, monkey redundancy in `spya-t8fayf`, and Olah’s no-composition condition in `spya-xcrca8`.
- One blind-read borderline paragraph had not been copied into the structured labels. I added it, changing only denominators.

3. Conclusion:

- Luna remains the sensible starting model: on the matched subset it caught 12/17 versus Sonnet’s 11/17, raised 9 versus 13 alarms, and cost one tenth as much. This does not prove Luna is more accurate.
- The “Sonnet found none” comparison was unfair because Sonnet saw only one of the three newly found real faults. The plan now says so.
- Only two broader faults were found in the 150 control levels; the third was another PID fault. These post-hoc discoveries demonstrate possible reach, not general recall.
- Store the second attempt after a second flag and fail open on checker failure is a defensible availability decision, but retry effectiveness was not measured. The plan now states that clearly and covers validation already consuming `LEVEL_ATTEMPTS`.

4. Probe bugs fixed:

- Borderline adjudications now leave paragraph and output-level denominators.
- Cost and latency use complete three-level presses.
- The scorer reports the nine excluded writer failures and prints shipped results by level.
- All label sections are validated against corpus keys.

Verification:

- Corrected scorer: passed.
- Typecheck: passed via the IPC-free `node --import tsx` equivalent.
- Biome lint: passed, with two advisory complexity notices.
- `npm test` could not collect tests because this sandbox cannot reach the shared Postgres/Docker lane.
- The exact requested `npx tsx … score` was blocked by the sandbox’s Unix-socket restriction; the equivalent loader invocation succeeded.