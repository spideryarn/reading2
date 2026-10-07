Approved after the fixes below. Nothing committed.

1. **Coverage:** Article-derived title, authors, year, reference, link/identifier, `why` and passages are fenced. Matched results and forced-search/library evidence are fenced too. `linkFrom` is a closed set, further narrowed by the branch that prints it. Reader profiles are trusted reader input. I fixed the remaining unfenced value: the remote hostname in four `paperSection` states.

2. **Escape:** Complete fake fences and longer bracket runs are broken up by `escapeUntrusted`. Fence labels are constants at these call sites. No literal delimiter escape found; semantic prompt injection remains possible.

3. **Tests:** The original regex could erase a leaked field containing a complete fake fence. The strengthened test checks expected labels and delimiter counts before stripping, verifies field presence, and includes controls for complete and nested fake fences.

4. **Versions/cache:** Correct: local `origin/main` has investigate `/7` and lookup `/6`; `/8` and `/7` enter their respective context hashes. Prompt-prefix caching follows changed text. No eval fixture invalidation issue found. **Wider decision:** settled upload-source guesses, including `none`, remain saved without a prompt version or recheck. Retrying old misses would require separate work.

5. **Information:** The referenced details remain present. The quick check’s explicit DOI/arXiv search instruction stays outside the fence. Our operational instructions remain outside the data regions.

6. **Unmeasured behavior:** Shipping this narrow boundary fix without a live-model eval is reasonable. Marker contamination is only one risk: changed weighting of identity fields or evidence could also affect queries, matches and answers. Tests establish layout, not model obedience or quality.

7. **Docs:** The changed `citations.md` section is accurate after adding the paper-source host. The plan now describes source-guess retention correctly.

Findings:

- **P2 — Fixed:** Remote hostname treated as trusted prompt text. Added a separate fence; all four new regression cases failed before the fix.
- **P2 — Fixed:** Test oracle accepted attacker-authored fence structure.
- **P3 — Fixed:** Plan incorrectly claimed found pages were checked on every use.
- **P3 — Fixed:** “Not measured” understated the possible behavioral regressions.

Validation: all **207 requested tests passed**. Typechecking passed via `node --import tsx scripts/typecheck.ts`; `npm run typecheck` was attempted but blocked by the sandbox’s IPC-socket restriction. Lint reported only an existing complexity advisory.

VERDICT: approve