# NO-SHIP

## Findings

1. **HIGH — malformed baselines can still be mistaken for legitimate hash mismatches, silently re-minting every ID.**

   `SHAPE` only checks that `entries`/`ideas` is an array ([artifacts.ts:210](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts.ts:210)). It does not validate `sourceHash` or identity-bearing entry fields.

   Therefore an artefact such as `{entries: [...old entries...]}` or `{sourceHash: null, ideas: [...]}` is classified `ok` by both stores. The helpers return it as a valid baseline ([glossary.ts:795](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:795), [ideas.ts:570](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:570)). Its missing/invalid hash then fails the ordinary equality check:

   - Glossary sets both `existing` and `inherit` to null ([glossary.ts:1207](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:1207)), resets `passes`, mints every ID, and overwrites the baseline.
   - Ideas sets `inherit` to null ([ideas.ts:838](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:838)) and mints every ID.

   That is precisely the forbidden “unusable → ordinary mismatch → mint successfully” path.

   Missing entry IDs are also accepted. With a matching hash, ideas silently mint replacements; glossary does likewise on a prompt/profile rewrite. Baseline validation must cover the fields required to distinguish staleness and carry identity—not necessarily the complete artefact schema, but at least valid hash formats and usable, unique IDs plus matching keys.

2. **MEDIUM — the regression suite stays green on that silent-loss path.**

   Its “wrong shape” cases only test `entries` not being an array and `ideas` not being an array ([test:289](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/glossary-ideas-baseline.test.ts:289), [test:405](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/glossary-ideas-baseline.test.ts:405)). They repeat the production validator’s shallow assumption.

   Add both-store cases for missing/null/malformed `sourceHash`, missing IDs, and duplicate IDs, proving refusal before the model call or write. The pipeline wiring test is also only a whole-file set of called names, not proof that each step passes the corresponding result to its generator ([test:784](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/glossary-ideas-baseline.test.ts:784)).

## Trace

For fully valid artefacts, both stores and stages are correct:

- Filesystem and Postgres use the same top-level shape table; filesystem additionally detects parse failures and oversize files.
- Valid absence mints, explicit `unusable` fails, and thrown reads propagate.
- Glossary append is intact: matching hash/version/profile supplies `existing`, increments `passes`, merges entries, and preserves incumbent IDs. A version/profile change intentionally skips append while inheriting IDs.
- Ideas inherits by normalized name when the hash matches.
- Blocks remains on `hasEarlierBlocks`; the new generic method does not weaken its tri-state handling.
- Pipeline reads both baselines before invoking either generator. The new Postgres tests exercise baseline reads and returned IDs, not a subsequent `store.write`, so they do not independently prove Postgres write ordering.

Verification: all 15 focused filesystem/wiring tests passed; the seven Postgres cases were not executed. All three TypeScript projects passed typechecking.

