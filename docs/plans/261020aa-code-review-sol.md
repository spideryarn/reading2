1. **Blocker — fixed.** The prompt/version change left three independent request pins on
   `toc/12`, so the suite failed even though the four named test files passed: the version and
   whole-request key in `tests/structure-step-prompt-hoist.test.ts:66,132-135`, the model-neutral
   request digest in `tests/structure-step-slices-request.test.ts:37-40`, and the byte-for-byte
   prompt in `tests/structure-whole-document-request-parity.test.ts:118-120,234-240`. I re-pinned
   all three to the reviewed `toc/13` request. This also proves the canonical digest moved with the
   prompt and schema, so a `toc/12` checkpoint cannot replay under the new contract.

2. **Should — fixed.** The measuring harness converted the line arm's integer answer back to ids
   before calling production's parser. Its validity score therefore bypassed `startAsId`, the exact
   new seam the eval was meant to measure. `evals/structure-id-pattern/run.ts:268-275` now passes
   the original answer to `wholeDocumentAnswerFields`; the id-shaped copy remains only for
   cross-arm classification and top-start scoring.

3. **Should — fixed.** No integration test proved that a number is resolved against a slice's own
   zero-based block array rather than the whole article. I added a later-slice integer answer at
   `tests/structure-slices-adversarial.test.ts:47-67`; it would fail if local `0` were resolved
   against body block 0. The runtime audit found the wiring sound: `src/structure-slices.ts:698-713`
   requests and parses the same closure-local `blocks`, including halves and refills. One-pass
   `treeFrom` and the checkpoint gate likewise parse the same `body` that was prompted
   (`src/structure.ts:873,2853,2927`).

4. **Should — fixed.** Deleting line-number recovery also deleted the only test of `treeFrom`'s
   failure suffix for an earlier unresolved start. The branch is still reachable when the last
   answer drops one child and then fails on a nested start. I restored coverage with the current
   `(dropped)` outcome at `tests/structure-whole-document-reask.test.ts:394-405`, and changed that
   file's successful nested answer and out-of-range/re-ask/checkpoint cases to live `toc/13`
   integers at `tests/structure-whole-document-reask.test.ts:103-198,359-391`.

5. **Low — fixed.** Decoder-era state and wording survived after the decoder went. I removed the
   now-unused recovery-window bookkeeping and made dropped placeholders explicit in
   `src/start-ranges.ts:108-149,240-259`; corrected checkpoint, telemetry and failure comments in
   `src/structure.ts:870-873,1137-1144,2825-2883` and `src/structure-starts.ts:11-17`; and qualified
   261019l's status so “all four refuse” means the first-answer reading
   (`docs/plans/261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md:12-17`).
   `startAsId` does not lose kernel evidence: invalid numbers reach `nameValue` unchanged, drop
   accounting records the original child value, and the shallow copy preserves `sourceHeading`.

6. **Low — left deliberately.** The live prompt still ends with “Use only block ids that appear in
   the input” (`src/structure.ts:225`), although its only boundary field is now an integer. That is
   stale and internally contradictory, but the paid line arm and the blind panel use these exact
   bytes; changing a third passage during the panel would make the reviewed code differ from the
   evidence. The strict integer schema prevents an id there, and the measured arm built 35/35, so
   this is not a ship blocker. Remove or rewrite the sentence in a separately measured prompt
   revision.

7. **Low, wider — left.** Historical/auxiliary eval helpers still assume the old wire shape:
   `evals/long-structure/fake-model.ts:79-100,223-227` emits id starts and mutates only quoted id
   starts, while `evals/long-documents/spike-inspect.ts:29-35` types and looks up raw starts as ids.
   Two comments also call the current imported prompt/parser `toc/12` or `toc/11`
   (`evals/long-structure/prompts.ts:43`, `evals/paperwork/structure-parse.ts:2-11`). These are outside
   the listed measuring harness and changing them would broaden this review; production and the
   real long-structure arms request and parse matching arrays.

8. **Informational — verified.** The eight focused/regression files pass: 121 tests. The requested
   `npm run typecheck` could not start under this sandbox because `tsx` was denied its Unix socket
   (`listen EPERM /tmp/tsx-1000/14.pipe`); running the same script without the CLI IPC layer,
   `node --import tsx scripts/typecheck.ts`, passed all four TypeScript projects and confirmed all
   3,879 source files are covered. Scoped lint completed with only existing advisory complexity and
   style findings; `git diff --check` is clean.

ship after my fixes
