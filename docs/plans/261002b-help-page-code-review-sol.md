All in-scope P1 findings are fixed. One pre-existing P1 and one documentation P2 remain reported.

## Findings

- C1 — P1 — FIXED — [HelpPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/HelpPage.tsx:235): ordinary fragment clicks allowed the browser’s native jump and then performed the page’s smooth scroll/flash. They now prevent the native action, add one history entry with `pushState`, and arrive exactly once. Direct loads, aliases, same-hash clicks, Dock navigation, `hashchange`, cleanup, and modified clicks retain their intended behavior.

- C2 — P2 — FIXED — [help-faq.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-faq.tsx:80), [help-content.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-content.tsx:104): natural searches had ranking/matching surprises. “Where did my article go?” ranked “beyond the article” first; questions about mode duration and visitor comments were fragile. The titles, keywords and synonym table now resolve those queries correctly.

- C3 — P1 — FIXED — reader-facing factual inaccuracies:
  - [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-topics.tsx:144): bottom-bar inventory omitted Help.
  - [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-topics.tsx:306): visitors can see existing public comments/bookmarks in the gutter; it is not “only the link.”
  - [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-topics.tsx:379): Escape can still act while typing; Ctrl/Cmd-Enter is handled by the focused box rather than being the sole global exception.
  - [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-topics.tsx:509): automatic preparation does not prepare every non-experimental mode; it prepares modes with generation steps plus cross-references.
  - [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-topics.tsx:626): the sharing discount is not retroactive to unresolvable old billing rows.
  - [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-topics.tsx:767): the Plans section now states the same historical allowance boundary.
  - [help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-topics.tsx:786): High-powered AI also stops when the allowance cannot cover it.
  - [help-modes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-modes.tsx:380): Force, Drift and Trail use an embedding model; they are code-assembled diagrams, not “not AI.”
  - [help-faq.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-faq.tsx:84): “Everything else works from the article” omitted several web/fetch paths and reader-profile influence.

- C4 — P2 — FIXED — [HelpPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/HelpPage.tsx:324): every `#` self-link had the identical accessible name “Link to this section.” Each now names its destination.

- C5 — P2 — FIXED — [help-page.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/tests/help-page.test.tsx:112): `PINNED_ANCHORS` only checked old entries still resolved; a new live anchor could ship without being pinned. The test now checks both directions.

- C6 — P2 — REPORTING — [help-page.md](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/docs/project/help-page.md:58): “Every link into Help goes through `helpHref`” overclaims both current usage and type safety. Top-level Help links correctly use `HELP_HREF`, and a hand-written fragment string can bypass `HelpAnchor`. No production link currently does so. This normative section requires explicit before/after approval, so I left it unchanged. Proposed wording:

  > Every code link to a Help section must go through `helpHref`, which takes a `HelpAnchor`. A link built that way does not compile if the section does not exist; a hand-written `/help#…` string would bypass the type, so do not write one.

- C7 — P1 — REPORTING, wider than this change — [BlockGutter.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/BlockGutter.tsx:589): visitors receive the owner’s public comments read-only, but their tooltip and accessible name say “Your note(s).” Per scope, I did not change this existing component.

I sampled more than 12 claims across the spine, gutter, waiting/generation, billing, sharing, visitors, experimental features, keyboard behavior, Diagram, and FAQ sections. Metadata search behavior remains unchanged. The Overseer/changelog deploy loop is accurate, and all eight plan-review findings are represented in the implementation after these fixes.

## Files changed

- [src/web/help/HelpPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/HelpPage.tsx)
- [src/web/help/help-content.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-content.tsx)
- [src/web/help/help-faq.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-faq.tsx)
- [src/web/help/help-modes.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-modes.tsx)
- [src/web/help/help-topics.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/src/web/help/help-topics.tsx)
- [tests/help-page.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb85-help-page/tests/help-page.test.tsx)

The pre-existing untracked review-prompt file was untouched. Nothing was committed.

## Commands and results

- Required Vitest command, baseline: `6 passed (6)` files; `222 passed (222)` tests.
- Red navigation/accessibility run: `1 failed (1)` file; `2 failed | 23 passed`.
- Search red run: `1 failed (1)` test; `24 skipped`.
- Final required Vitest command: `6 passed (6)` files; `223 passed (223)` tests.
- `npm run typecheck`: failed before checking any project because `tsx` could not open `/tmp/tsx-1000/14.pipe` (`EPERM`).
- Equivalent `node --import tsx scripts/typecheck.ts`: four project checks passed; all `2656` source files covered.
- Focused Biome lint: `Checked 6 files`; no diagnostics.
- `git diff --check`: passed.

Verdict: the Help-page change is ready to land after the fixes; C6 awaits normative-doc approval, and the pre-existing wider C7 should be handled separately.