No P0 findings. I fixed three stage-scoped issues and did not commit.

1. **P1 — Real mouse clicks were treated as finger taps on hybrid devices.**  
   [ShelfEntry.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb9e-9f-9g-ipad-touch-targets/src/web/ShelfEntry.tsx:807) used only `any-pointer: coarse`, so a real mouse on a touchscreen computer made Re-fetch reveal instead of run. It now remembers the preceding `pointerdown`: iOS touch-down plus mouse-typed click remains a finger tap, while genuine mouse input is unchanged. Tests cover iOS compatibility events, stuck tooltips, mouse input, table behavior, and fine-pointer pen input in [shelf-action-touch.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb9e-9f-9g-ipad-touch-targets/tests/shelf-action-touch.test.tsx:462).

2. **P2 — The new stylesheet was missing from the independent manifest witness.**  
   The full manifest test failed because `close.css` was imported at runtime but absent from `MANIFEST`. Added it at the matching cascade position in [styles-entry-is-imports-only.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9e-9f-9g-ipad-touch-targets/tests/styles-entry-is-imports-only.test.ts:133).

3. **P2 — The close-size guard could miss nested or state-specific overrides.**  
   [close-cross.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb9e-9f-9g-ipad-touch-targets/tests/close-cross.test.ts:30) now finds rules inside media queries and selector lists, including pseudo-classes, and also rejects logical sizing properties.

The earlier plan-review findings are otherwise genuinely fixed: unavailable actions reveal their explanation without “Tap again”; Re-fetch reveals first and commits on the armed second tap; the Annotate gap is 8px; all seven close controls retain safe spacing, focus and hover behavior; both card action presentations remain above the stretched link; and the Tailwind container query compiles to `@container (width < 28rem)` as intended.

Checks:

- Five non-browser focused files: **85 tests passed**.
- Stylesheet manifest checks relevant to this change: **2 passed**.
- Typecheck via the same script using `node --import tsx`: **passed**, all four projects and 2,752 source files covered.
- The exact Chrome test could not launch Chrome in this sandbox: Crashpad’s socket call received `EPERM`; no assertions ran.
- `npm run typecheck` likewise hit sandbox `EPERM` creating tsx’s IPC socket, hence the equivalent direct invocation above.

Wider items left for you: the ChatPanel conversation-header X and pre-Safari-26.2 scrollbar fallback remain the plan’s explicit deferrals. The scrollbar colour still needs confirmation on Greg’s actual iPad.