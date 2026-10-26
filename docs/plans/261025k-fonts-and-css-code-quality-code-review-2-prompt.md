# Code review: 261025k items 2 and 4

You are reviewing, and fixing, two committed changes in this worktree. **You may edit files**, but
stay inside these two changes: fix what is wrong in them, narrowly and red-first (a failing test
before the fix where there is a bug). Report, do not fix, anything wider you notice. Do not commit,
and run no git command that changes state.

**The candidate**: commits `85036122b` (item 2, voices in their own cascade layer, every rule
`:where()`) and `5ac90bfa4` (item 4, one name for the app's face, plus the `.matter-stub` fix), on
top of `21ccb3c56`. Diff: `git diff 21ccb3c56 5ac90bfa4`. Start with src/web/voices.css,
src/web/tailwind.css, src/web/styles/styles.css, tests/helpers/stylesheets.ts,
tests/voices-css.test.ts, styles/tokens.css, src/web/styles/prose.css,
tests/prose-centred-in-its-cell.test.ts and docs/postmortems/261025b-…; that list does not limit
scope. The plan is docs/plans/261025k-fonts-and-css-code-quality.md § 2 and § 4.

**What must hold**

- Item 2: every element computes the same font-family as before. A computed-style capture says it
  does (130,421 records, identical once class-name changes are normalised), but the capture
  sampled pages. Look for a selector that used to win on specificity and now loses to a layer
  order it did not face before: any rule in an earlier layer (`theme`, `base`, `app`) setting
  `font-family` on something voices.css also targets, now beaten by voices where it once won, or
  the reverse. Look especially at rules in `utilities` or `tone`, at `!important`, and at the
  `.passage-whole` resets that lost `:root`. Is the jsdom shim in tests/helpers/stylesheets.ts
  (`:not(#jsdom-voices-layer)` ×5) faithful, or could a test pass in jsdom and fail in the
  browser? Could it pass vacuously?
- Item 4: no use of `--font-reading`, `--font-brand`, `--font-prose`, `--font-serif` or
  `tw:font-prose` survives anywhere: code, tests, docs, generated files, the Chrome extension,
  evals, emails. Was `--font-sans` meant to stay? The old names were each a literal or `var()`
  alias of the same Geist stack; check nothing that read one now reads a different face.
  `.matter-stub` now takes `--font-author`. The new guard test ("every rule that measures the
  prose's measure says which face its `ch` is in") must not be vacuous. Does it actually find
  rules across every sheet that uses `--reading-measure`, including ones built with
  `min()`/`clamp()`? Is its one allowance right?

Run: `npx vitest run tests/voices-css.test.ts tests/type-roles.test.ts
tests/prose-centred-in-its-cell.test.ts tests/styles-entry-is-imports-only.test.ts
tests/css-tokens.test.ts tests/self-hosted-faces.test.ts tests/tailwind-utilities-resolve.test.ts`
and `npm run typecheck`. The full suite passed on 5ac90bfa4 (2,112 files).

**Severity**: P0 production breakage or data loss; P1 a stated property does not hold (renders
differently, a test that cannot fail); P2 a real smaller defect or a clearly simpler route; P3 a
nit. Give every finding an ID (D1, D2…), a severity, file:line evidence, and either "fixed: <what,
and the red→green>" or "reported".
