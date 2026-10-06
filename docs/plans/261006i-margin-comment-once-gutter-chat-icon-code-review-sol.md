1. **P2 — `lineOnly` exposed an ARIA disclosure state without any disclosed region. Fixed.**
   Evidence: the line-only branch has no `.marg-open` panel and no `aria-controls`; its full text is
   already present in the accessibility tree, and only its visual wrapping changes
   (`src/web/marginalia/MarginaliaColumn.tsx:260-288`). WAI-ARIA 1.2 defines `aria-expanded` as the
   state of an expandable grouping element owned or controlled by the control, so the former
   `aria-expanded={open}` asserted a relationship that did not exist
   ([W3C](https://www.w3.org/TR/wai-aria/#aria-expanded)). I removed `aria-expanded` from this branch;
   real panel disclosures retain it with `aria-controls` (`src/web/marginalia/MarginaliaColumn.tsx:298-313`).
   The regression assertion was seen red before the fix and now checks both states
   (`tests/marginalia-shut-notes.test.tsx:139-159`). This is new; the plan review recommended the
   line-only shape but retained `aria-expanded`.

2. **P3 — the icon sweep test could pass with the changed control wearing the wrong icon. Fixed.**
   Evidence: the test previously required any `<MessagesSquare>` somewhere in each whole file and
   no `<MessageSquare>`. `OriginChat.tsx` and `DebatePanel.tsx` already contained other
   `MessagesSquare` controls, so changing the reviewed mark to an unrelated glyph would still pass.
   The test now slices each of the six rendered sites (the five files, including both ChatDialog
   heads) and requires `MessagesSquare` inside that control
   (`tests/mode-icons.test.ts:50-74`). This is new; the plan review rejected a repository-wide import
   ban, but did not catch that the replacement was still asserted file-wide.

3. **P3 — two specified marginalia boundaries were not proved by behaviour. Fixed.**
   Evidence: the answer-only lone comment from the plan's shape table had no direct assertion, and
   the `[hidden]` test matched source text without proving that the cascade beat
   `.marg-open { display: grid }`. The tests now open an answer-only comment and require a non-empty panel
   (`tests/marginalia-shut-notes.test.tsx:213-228`), and load the stylesheet to verify computed
   `display: none` while hidden and `display: grid` while open
   (`tests/marginalia-shut-notes.test.tsx:186-201`). This is new test coverage, not a production-code
   failure.

4. **P3 — the icon sweep left two newly stale descriptions. Fixed.**
   Evidence: Help still told readers to find a singular “small speech bubble”; it now names the
   two-bubble chat icon (`src/web/help/help-modes.tsx:421-424`). The bookmark rationale still said a
   one-bubble mark would read as a second chat; it now records the actual one-bubble comment /
   two-bubble chat distinction (`src/web/BlockGutter.tsx:552-558`). This is new; neither string was
   named in the plan review.

No further issue found in the requested paths. The three lone comment shapes retain all content: an
answer opens a non-empty panel, words-only expands visually with no panel, and a wordless unanswered
AI comment is non-interactive. A lone question still uses its existing real panel, and multi-item
comments still render every body and answer. `.marg-open[hidden]` has no other selector or code
consumer; `useMarginLayout` observes the outer note, so both panel and line-only height changes still
schedule the same collision pass. No rendered bare `MessageSquare` remains in `src/` or `tools/`;
the `/design` page has none. The new `icons.md` section matches the five changed components and
explicitly records the two exceptions (`MessageSquarePlus` for New conversation and the Metadata
Debate row).

Checks: 12 focused test files, 256 tests, passed; both TypeScript projects and the fleet web project
passed via `node --import tsx scripts/typecheck.ts`; `git diff --check` passed. Scoped Biome lint
passed with one existing informational complexity warning in `BlockGutter`. The `npm run lint --
<files>` wrapper linted the whole repository despite the file arguments and reported the known
repository baseline (174 errors); none was in these touched files. `npm run typecheck` itself could
not create tsx's IPC socket in this sandbox (`EPERM`), so the documented no-IPC invocation above was
used.

VERDICT: ship with the fixes made
