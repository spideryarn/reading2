1. **P1 — Unauthorized title cuts. Fixed.** The guard accepted subtitle cuts when a common word or one-letter site name occurred anywhere in the removed text. It also accepted hyphenated word breaks and bracketed prose. It now requires the entire site name, proper separator boundaries, and a bracketed identifier.

2. **P2 — Valid Unicode edits refused. Fixed.** Lowercase offsets could not safely address the original string. Cuts now use original code-point boundaries, then compare retained text. Turkish `İ`, Greek sigma, NFC and astral cases pass.

3. **P2 — Cancellation could return success. Fixed.** Already-cancelled calls, skipped titles and answers returned after cancellation now stop. The model’s own deadline still falls back to the rule.

4. **P2 — Stored originals could miss repeat-title matching. Fixed.** The pipeline now compares incoming titles through the same `plainTitle` normalization used by storage. Added coverage for all three seams, first imports and *Read this*.

5. **P2 — Tests could hide provider calls. Fixed.** Added the missing spy in `acquire-extract-blocks-end-to-end.test.ts`. Strengthened the default-path test to count calls explicitly, the request test to check the complete schema, and the timeout test to control its timer.

6. **P2 — Evaluation conflated inputs and fallback results. Fixed.** Equal titles with different page contexts now have separate IDs. Reports distinguish raw refusals from actual stored-title disagreement.

7. **P3 — Investigation overstated its evidence. Fixed.** Narrowed the claims about harm, hidden instructions and another judge. Historical numbers remain historical; the stricter guard has not been re-evaluated.

8. **P3 — Unused public constants. Fixed.** Removed three unnecessary exports. Source and runtime checks found the job registries, accounting and privacy model registration present.

9. **P2 — Rewriting deeply encoded titles can change them again. Unfixed and why:** `plainTitle` decodes another entity layer on each write, including a reused stored pair. This predates the change and needs a decision about the shared storage normalization contract.

Ran 54 guard cases, six parser cases, 19 mutation checks, 12 real pipeline scenarios with dependencies injected, gateway/request/deadline/evaluation probes, targeted Biome and whitespace checks. Vitest, typecheck and Knip could not start because the shared lock remained held; earlier targeted batches remain queued. No commit made.

**Verdict: scoped fixes are in place; approval awaits targeted tests and typechecking.**