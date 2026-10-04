Four code/test findings fixed red-first, plus the tooltip documentation correction. No commits made. No additional production changes remain.

1. **CF1 — P2, established, fixed: fingerprint scanner confused text with imports.**  
   **(a)** A single-quoted `from './paperwork.js'` left the fingerprint unchanged after editing that dependency. Import-like comments and prompt prose added phantom dependencies.  
   **(b)** Replaced the regex with the existing Babel parser, preserving static imports and re-exports. The header now explicitly describes the hand-kept registry and one-hop limit.

2. **CF2 — P2, established, fixed: modes reporting consumed its comparison outputs.**  
   **(a)** Put a normal `pairs-*` directory beside an arm, containing `key.json` and `exclusions.json`; `report()` crashed reading `sketch`. This predates the candidate.  
   **(b)** Exclude comparison directories, matching the sibling reporter. The regression now verifies the real arm’s totals.

3. **CF3 — P2, established, fixed: invalid argv depended on runtime configuration.**  
   **(a)** Run `ingest --froce` with production mode, empty `VITEST`, and pinned empty Supabase Storage credentials. The candidate reported a Storage boot error instead of the flag error.  
   **(b)** Import step names from their existing leaf module and refuse invalid arguments before `loadRuntime()`. The same command now reports `--froce`, prints usage, and exits 1.

4. **CF4 — P2, established, fixed: a negative tooltip assertion could finish too early.**  
   **(a)** Set `DELAY.open=1000` and deliberately wrap the criteria numeral in `Tooltip`. The candidate’s absence assertion still passed after advancing 400 ms.  
   **(b)** Advance by `DELAY.open`. The same mutation then failed on the unwanted tooltip.

5. **CF5 — P3, established, fixed: jsdom guidance described real waits.**  
   **(a)** Its “two 300ms waits” wording contradicted the converted fake-clock helpers.  
   **(b)** Updated it to describe clock advances, timer restoration, grouped delays, and separate render/close advances.

6. **CF6 — P2, reasoned, unpatched: the failed-navigation cleanup test has no successful sibling.**  
   **(a)** Before returning `failedToOpen` in `checkPair`, insert:
   ```js
   started.splice(0, started.length, ...started.filter(h => !h.ok));
   ```
   This loses successful handles, but the named test uses global `--blank`, so both clients already self-close.  
   **(b)** Add `--blank-for <marker>` to fail only one client and verify the other PID closes. I left this unchanged because subprocess restrictions prevented the required red-first mutation run. The implementation’s cleanup is correct.

The abstractions earn their keep:

- **`sourceFingerprint`:** useful across seven consumers; its bounded coverage is now honest.
- **`env-value.sh`:** worthwhile shared parsing for two callers. No established real-env regression found.
- **Recursive `waitUntilBlockedBy`:** necessary for waiter 2 → waiter 1 → holder; distinct counting is sound.
- **`checkPair` / `checkServer`:** make client lifetime, overlap, rereading, and cleanup explicit.
- **950-line agreement test:** substantial, but exercises recorded stamps and independently derived inputs. Its writes target one unique revision, restore temporary changes, and delete the fixture afterward; I found no cross-file state leak.

The modes `--partial` extension is appropriate. Valid CLI paths assign runtime bindings before use. Remaining grouped literal delays reflect explicit surface overrides. I could not establish whether every real Supabase response includes `github`; neither shell check reached real services.

Validation: **531 tooltip tests passed; 46 relevant eval tests passed; shell tests and 24 pure argv cases passed.** Final typecheck passed all four projects through `node --import tsx`, covering 2,943 sources. Lint reported one existing warning; diff checks passed. Full `npm test` stopped at database preflight. Postgres and spawned MCP checks were not revalidated here.

Changed files:

```text
docs/project/tooltips.md
evals/paperwork/modes.ts
evals/plain-words/source-fingerprint.ts
scripts/stage.ts
tests/eval-source-fingerprint.test.ts
tests/paperwork-modes-totals.test.ts
tests/referee-criteria-explained.test.tsx
tests/stage-argv.test.ts
docs/postmortems/261004b-argument-refusal-depends-on-unrelated-runtime-configuration.md
docs/postmortems/261004b-matching-source-text-is-not-parsing-imports.md
docs/postmortems/261004c-a-json-extension-does-not-identify-an-artefact.md
docs/postmortems/261004c-an-absence-assertion-needs-to-outlast-the-effect-it-forbids.md
```

The checked candidate with these fixes has no established P0/P1 blocker. This conclusion follows from the checks above, with the stated database and subprocess limits.

VERDICT: land