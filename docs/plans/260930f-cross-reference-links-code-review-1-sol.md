Two P1 findings, both fixed. No unresolved findings.

- **C1 — P1 — Fixed:** The freshness hash covered supplements and nested tree nodes that the model never receives. Harmless hidden-data changes therefore marked a paid artefact stale, violating F11. The red test produced different hashes after changing only an omitted supplement. The fingerprint now hashes exactly the rendered article and skeleton strings in [src/crossrefs.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/crossrefs.ts:137), with supplement and nested-tree regressions in [tests/crossrefs.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/tests/crossrefs.test.ts:411). The plan was corrected too.

- **C2 — P1 — Fixed:** The server validated stored TeX while the client locates phrases after converting TeX to MathML. A raw-TeX phrase was accepted server-side but could never be marked. The red test retained the invalid maths link. Generation now lazily loads Temml and uses the established server/browser parity transform at [src/crossrefs.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/crossrefs.ts:528) and [src/quote-in-block.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/src/quote-in-block.ts:123). The regression is at [tests/crossrefs.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-cross-reference-links/tests/crossrefs.test.ts:428).

The remaining audit passed: validation/root cases, stored slices, caps, carry/reset, spend ledger and truncation, owner-only routing, registries, and real-run evidence. Crossrefs being posted in the first parallel group is intentional per §3. The nearby rule correctly uses full document order, matching the plan’s “adjacent block” wording even though supplements cannot be link endpoints.

Checks:

- `npx vitest run tests/crossrefs.test.ts`: 22 passed
- Scoped registry/route/freshness/maths suite: 631 passed
- Production build and cold-start lazy-import test: passed
- All four TypeScript projects: passed
- Scoped Biome lint: exit 0; advisory-only complexity notices remain
- Database-backed suites were not run, as requested
- No commit made

**Verdict: approve with these fixes.**