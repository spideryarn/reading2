# A JSON extension does not identify an artefact

Review of sweep stage A found that `paperwork/modes.ts report` crashed once the
same harness had written a blind comparison. Nothing reached a reader; the
report could not finish showing its eval totals.

The class is **an output namespace mistaken for an input schema**. Commit
`956e8beb0` added both arm directories and `pairs-*` comparison directories under
one results root. The reporter read every directory's `.json` files as
`ArmFile`s. A comparison's `key.json` is an array, and its `exclusions.json` is a
different array; neither has `outputs`. The new totals tests in `32ed6903c`
covered only the already-decoded arm rows, so they could not catch the file
selection error. `paperwork/run.ts report` had already addressed this sibling.

The new fixture in [paperwork-modes-totals.test.ts](../../tests/paperwork-modes-totals.test.ts)
contains one real arm plus a comparison's Markdown, key and exclusions. Before
the fix it failed with `Cannot read properties of undefined (reading 'sketch')`.
Afterward it reports the real arm's exact totals. The durable fix is the shipped
fix: [modes.ts report](../../evals/paperwork/modes.ts) excludes the harness's
reserved `pairs-*` directories before decoding files.

Countermeasures ranked by ease against value:

1. **A fixture containing the producer's different output types together** —
   done; tests the boundary the pure totals test did not reach.
2. **Select the intended namespace before decoding** — done, matching the
   existing sibling reporter.
3. **Move comparisons to another root** — rejected here: changing existing
   result paths and their consumers is larger than the boundary fix.
4. **Silently skip JSON that fails schema validation** — rejected: a malformed
   genuine arm must fail rather than quietly disappear from the report.

Up: [postmortems.md](../project/postmortems.md)
