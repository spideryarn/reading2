- **Medium** — [src/web/FeaturesPage.tsx:316](../../src/web/FeaturesPage.tsx:316) still described Explore as an Experimental Feature. Fixed the copy and added a regression test at [tests/features-page-modes.test.tsx:141](../../tests/features-page-modes.test.tsx:141), observed failing before the fix.

- **Low** — [docs/project/learn-mode.md:381](../../docs/project/learn-mode.md:381) still described four chips as conditional on the switch, while [docs/project/experimental-features.md:461](../../docs/project/experimental-features.md:461) ambiguously described Explore as currently gated. Corrected both.

The behavioral test changes fail against the parent implementation in the Learn UI, command bar, Guide, and Tutorial prompt. The `chat-commands` change intentionally only replaces its experimental fixture and therefore passes before the change; two other test edits are comments only.

Verification: 11 focused/generated suites passed—260 tests, 3 skipped. Typecheck and touched-file lint passed. Full `npm test` could not start because the shared local Supabase database was unavailable. No wider findings; the remaining experimental wording is dated history, including the old changelog entry.

VERDICT: approve with changes (made)