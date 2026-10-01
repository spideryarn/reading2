No P0–P2 findings remain. I found and fixed three P3 issues.

### Findings

1. **P3 — `data-spya-src` was allowlisted without being scrubbed on normal web extraction.**

   Evidence: `ARTICLE_DATA_ATTRS` includes every reserved attribute, including `sourceRef`, but `prepareDocument` previously scrubbed only the PDF marker. A publisher-supplied provenance stamp therefore survived extraction, contradicting the reserved-namespace invariant. No current browser handler reads it, so this was not immediately exploitable.

   Changed:

   - Scrub both reserved instrumentation-only attributes at [src/extract.ts:700](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/src/extract.ts:700).
   - Added hostile input and an assertion at [tests/extract-sanitize.test.ts:52](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/tests/extract-sanitize.test.ts:52) and [tests/extract-sanitize.test.ts:146](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/tests/extract-sanitize.test.ts:146).

   Red → green:

   - Before the fix: `1 failed, 14 passed`; extracted HTML still contained `<article data-spya-src="publisher-forgery">`.
   - After the fix: `15 passed`.

2. **P3 — the collision scanners missed several obvious source spellings.**

   Evidence: the data scanner only recognized literal `data-*` text; the class scanner omitted `dataset.foo`, `RESERVED_ATTRS.foo`, `*CLASS*` constants, direct `.className = …`, and `setAttribute("class", …)` forms.

   Changed the scanners at [tests/sanitize-allowlist.test.ts:46](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/tests/sanitize-allowlist.test.ts:46) and [tests/sanitize-allowlist.test.ts:94](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/tests/sanitize-allowlist.test.ts:94). The browser-collision assertion now accurately claims only that browser source names no surviving publisher attribute.

   This is test hardening, not a behavioral fix, so no product red→green applies.

3. **P3 — the Temml test and documentation overclaimed their coverage.**

   Evidence: the renderer battery exercised 28 of the 58 stylesheet-backed classes, while its old assertion only required more than five expressions to emit some styled class. It did not establish that every class survived.

   Changed:

   - Every declared Temml class is now tested synthetically on MathML and rejected on HTML at [tests/sanitize-allowlist.test.ts:307](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/tests/sanitize-allowlist.test.ts:307).
   - Each real-renderer expression has explicit positive-control classes, and the battery pins its actual coverage at 28 classes at [tests/sanitize-allowlist.test.ts:316](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/tests/sanitize-allowlist.test.ts:316).
   - Direct SVG and MathML integration-point behavior is asserted at [tests/sanitize-allowlist.test.ts:178](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/tests/sanitize-allowlist.test.ts:178).
   - Corrected the plan’s claims at [261001a…md:103](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/docs/plans/261001a-article-markup-keeps-only-what-we-allow-of-data-attributes-and-classes.md:103).

### Policy and consumer audit

The policy mechanics are correct:

- `ALLOW_DATA_ATTR: false` and `ADD_ATTR` are composed correctly at [src/sanitize-policy.ts:299](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/src/sanitize-policy.ts:299).
- Namespace discrimination, snapshot iteration, and empty-class removal are correct at [src/sanitize-policy.ts:739](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/src/sanitize-policy.ts:739).
- Both bindings install the same policy: [src/sanitize.ts:71](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/src/sanitize.ts:71) and [src/web/sanitize.ts:66](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/src/web/sanitize.ts:66).
- `SANITIZER_VERSION = 8` is the correct bump for a stricter stored-content policy at [src/sanitize-policy.ts:133](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/src/sanitize-policy.ts:133).
- Maths output is re-sanitized at [src/web/maths.ts:238](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/src/web/maths.ts:238).
- Citations rely only on the two retained publisher attributes.
- Notes and callout publisher metadata is consumed before sanitization.
- Figures/rehosting retain only the reserved PDF marker.
- Pipeline reads, publication validation, and export intentionally use raw stored HTML; the export remains a faithful data export, not a render path. The export suite itself could not run because local Postgres/Supabase was unavailable.

All four plan-review findings are now addressed: collision coverage is strengthened, `pdf-uncertain` is explicitly accepted, render-facing versus raw reads are distinguished, and SVG/MathML integration behavior has direct tests.

I also corrected stale or overbroad comments in [src/blocks.ts:1166](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/src/blocks.ts:1166), [src/sanitize-policy.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/src/sanitize-policy.ts:35), and [security.md:174](/home/greg/code/spideryarn2/.claude/worktrees/fb-5z-reserved-markings/docs/project/security.md:174).

### Commands and results

```text
npx vitest run --project unit tests/extract-sanitize.test.ts
```

Red: 1 failed, 14 passed. Green after fix: 15 passed.

```text
npx vitest run --project unit tests/sanitize-allowlist.test.ts tests/sanitize-client.test.ts
```

2 files, 71 tests passed.

```text
npx vitest run --project unit tests/sanitize*.test.ts tests/maths*.test.ts tests/reserved.test.ts tests/extract-sanitize.test.ts tests/citation-find.test.ts tests/citation-investigate-context.test.ts tests/citation-investigate.test.ts tests/citation-investigation-view.test.ts tests/citation-lookup.test.ts tests/citation-marks.test.ts tests/citation-reference-list.test.ts tests/citations.test.ts tests/citation-hover-card.test.tsx tests/citations-find-late-reply.test.tsx tests/citations-investigate-client.test.tsx tests/citations-panel.test.tsx tests/collect-citations.test.ts tests/notes*.test.ts tests/callouts.test.ts tests/blocks-structural-fixture.test.ts tests/blocks.test.ts tests/xref*.test.ts tests/xref*.test.tsx tests/prose-links*.test.ts tests/rehost.test.ts
```

34 files, 968 tests passed.

```text
npx vitest run --project unit tests/the-sanitiser-has-one-policy.test.ts
```

6 passed; one infrastructure failure because its `git ls-files` subprocess was denied with `spawnSync git EPERM`.

```text
npx vitest run --project private-postgres tests/store-export-bundle.test.ts
```

Could not start: local database unavailable, `connect EPERM 127.0.0.1:54362`. A preliminary invocation using nonexistent project name `private` also exited before collection.

```text
node --import tsx scripts/typecheck.ts
```

Passed all four TypeScript projects; all 2,474 source files covered.

```text
npx biome lint src/sanitize-policy.ts src/extract.ts src/blocks.ts tests/extract-sanitize.test.ts tests/sanitize-allowlist.test.ts
```

Exit 0; only the pre-existing informational complexity warning at `src/blocks.ts:523`.

```text
git diff --check
```

Passed. No commit or push performed.

**Verdict: approve with the review fixes now in the worktree; no P0–P2 defect or real-content regression found.**