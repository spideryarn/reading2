## Findings

1. **P1 — Unfixed, wider product decision:** [CommandBar.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-nkjpte-metadata-search-aliases/src/web/CommandBar.tsx:292). ⌘K `regenerate` on Metadata still navigates to the page already open; it does not reveal AI processing. Thus Greg’s report is only partially answered. The plan explicitly defers section-aware ⌘K behavior.

2. **P2 — Fixed:** [page-search.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-nkjpte-metadata-search-aliases/src/web/page-search.ts:179). The AND-miss retry discarded meaningful qualifiers: with experiments off, `redo whole article` became `redo` and returned a section lacking the requested control. Search now retains strict AND, so added content words only narrow results.

3. **P2 — Fixed:** [Metadata.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-nkjpte-metadata-search-aliases/src/web/Metadata.tsx:1420). `reset`, `whole`, and `over` are indexed only when the experimental whole-article control is present. Defining the keyword constants after the component is safe because module initialization completes before React invokes it.

4. **P2 — Fixed:** [CommandBar.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb-nkjpte-metadata-search-aliases/src/web/CommandBar.tsx:302). Metadata’s new `public` alias beat the established Shared articles row. It was removed. `share` still offers Metadata second while Shared articles correctly remains first.

5. **P2 — Fixed:** [page-search.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb-nkjpte-metadata-search-aliases/src/web/page-search.ts:134). Globally stopping `get` made Help’s `get it back` rank “Jumping around” above the matching archived-article FAQ. `get` is now ignored only in `get rid`; `with` was added as safe question furniture.

6. **P3 — Fixed:** Tests now assert first-result ranking, experimental on/off behavior, Help’s `get` behavior, and genuinely new per-section aliases. The exact `regenerate` rendered-page case is explicitly labelled a diagnostic control because it already passed before this change. The one-group-per-stem test correctly fails on duplicate normalized stems. [Tests](/home/greg/code/spideryarn2/.claude/worktrees/fb-nkjpte-metadata-search-aliases/tests/page-search.test.ts:215)

The [web-client documentation](/home/greg/code/spideryarn2/.claude/worktrees/fb-nkjpte-metadata-search-aliases/docs/project/web-client.md:29) is accurate: the ToC derives from rendered sections, and required keywords plus rendered phrase tests cover search upkeep.

Changed files:

- `docs/plans/261002c-metadata-search-aliases-and-keeping-its-search-current.md`
- `src/web/CommandBar.tsx`
- `src/web/Metadata.tsx`
- `src/web/page-search.ts`
- `tests/command-bar.test.tsx`
- `tests/metadata-contents-reveal.test.tsx`
- `tests/page-search.test.ts`

Verification:

- Requested focused suite: **184 passed**
- Equivalent non-IPC typecheck: **passed all four projects**
- Scoped lint and `git diff --check`: **passed**
- Exact `npm run typecheck`: sandbox blocked `tsx`’s IPC socket with `EPERM`
- Full `npm test`: could not start because the local database/Docker connection was unavailable
- No commit made

**Verdict:** The scoped implementation is sound after fixes, but Greg’s report is not conclusively closed until it is confirmed he meant the margin search rather than ⌘K on the Metadata page.