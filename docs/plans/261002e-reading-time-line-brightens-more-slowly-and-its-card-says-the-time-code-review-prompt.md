You are reviewing code in this worktree (Spideryarn, TypeScript + React). The plan, with your earlier plan review folded in, is
docs/plans/261002e-reading-time-line-brightens-more-slowly-and-its-card-says-the-time.md. The change is commit d901ed89b:
run `git show d901ed89b` for the scoped diff (do not diff against dev — it includes others' merges).

Review for correctness: readLevel's new thresholds and every consumer of ReadLevel (spine widths, gutter opacity, quiz READ_ENOUGH);
useReadingTime's timeFor/lookup ref lifecycle (slug change, enabled off, StrictMode, unmount, an open card outliving the run);
BlockLinkCard's ReadingCard (live tick, key per block, contentFor's new parameter in every call site including the refresh effect,
the readingRef); Reader.tsx wiring (owner only); spentWords; the tests (would each go red on the bug it names?); docs accuracy
(docs/project/reading-time.md, quiz.md).

You may fix what you find inside this change's files (workspace-write). Do not commit. Run the focused tests afterwards:
npx vitest run tests/reading-time-card.test.tsx tests/reading-time.test.ts tests/read-filter.test.ts tests/use-reading-time.test.tsx tests/block-gutter.test.tsx
and `npm run typecheck`. Report each finding as P0-P3 with file:line and a concrete failure scenario, say which you fixed, and list
anything wider for the author to decide.
