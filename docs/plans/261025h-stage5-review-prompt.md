# Review: Stage 5 of plan 261025h — fixes from the persona reviews

Repo: this worktree (TypeScript/ESM, React + nuqs, vitest). You may fix what you find inside this
stage (house workflow: you fix, I read your diff and commit); report anything wider for me to decide.

## The candidate

Commit 9cfa803cc (`git show 9cfa803cc`), client-side only. Its message lists the ten fixes. The
plan: docs/plans/261025h-sources-becomes-three-chips-a-cost-ladder-and-experiments.md. Your earlier
reviews: docs/plans/261025h-stage{2,4}-review-sol.md. Contracts: docs/project/sources.md (§ Where it
sits, § The experiments), docs/project/controls.md (controls that do the same job look the same),
docs/project/narrow-windows.md, docs/project/fonts.md, docs/project/block-ids.md (the passage links),
docs/project/experimental-features.md, docs/project/url-state.md.

## What I want

An independent attack. In particular:

- **Nothing started or sent**: the tools row now reads Not cited's stored answer on Where it sits
  (`useRelatedWork`, `whereToolCounts`). Confirm that request only reads our table and can never
  start an OpenAlex search or paid work, on open, Back/Forward or a remount. Guess first and
  Evidence first must still persist and post nothing (per-passage guesses and reveals included).
- **Honest counts**: a tool's number shows exactly when its stored result has been read, 0 included.
  Could a stale count from a previous article (slug change) or an unread state show a number?
- **The year**: only `articleYear` (`publishedAt`, else `publishedYear`) is printed; the planner's
  year may only order the lists. Any path still printing the model's year?
- **`titleIsOnlyByline`**: false positives that would hide a real title (one-word titles, titles that
  are an author's surname)?
- **Passage links** (`FindingPassage`): the block-id link lost its visible id; is the jump, the
  `?at=` href and keyboard access intact? Is the quote in the author's face?
- **Guess first honesty**: does anything (order, aria, class, count) still give the kind away before
  a reveal? Evidence first's radio group: keyboard, focus, `tabIndex`.
- **Controls and layout**: the tools as part-switcher buttons each in its own outline; the crumb
  truncating rather than clipping chips at 460px.

Run the suites you touch (`npx vitest run tests/where-it-sits.test.tsx tests/sources-experiments.test.tsx
tests/situate-dossier.test.tsx tests/reception-lens-in-chat.test.tsx tests/sources-crumb-in-chrome.test.tsx`;
the Chrome test may not run in your sandbox — say so). Severity: P0 data loss / exploitable security /
incorrect charging / broadly unusable; P1 user-visible wrong behaviour or an authoritative contract
violated; P2 design/maintainability; P3 prose. IDs S5-F1…. For each: evidence file:line, and either
"fixed" (with the test that proves it, red first) or a suggested fix.
