1. **P1 — A comment-load failure is falsely announced as a failed write.**  
   [useComments.ts:298](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/hooks/useComments.ts:298), [Dock.tsx:1235](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/Dock.tsx:1235), [Dock.tsx:1624](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/Dock.tsx:1624), [Dock.tsx:3106](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/Dock.tsx:3106)

   `useComments` sets both `error` and `loadFailed` when the initial GET fails. Dock treats every non-null `error` as a mutation failure, so a load failure announces “A change to your comments didn’t save”, although no change was attempted. Opening Questions then shows both the precise drawer error and the generic load-failure message.

   The existing load test constructs `loadFailed: true, error: null`, a state the real hook does not produce: [dock-questions-loading.test.tsx:62](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/tests/dock-questions-loading.test.tsx:62).

   I would model load and mutation errors separately, or at minimum branch on `loadFailed`: announce “Couldn’t load your comments” for loads, reserve “didn’t save” for mutations, and avoid the duplicate drawer error. Add a regression using the reachable `loadFailed: true, error: "…"` state.

2. **P1 — `DockTab` prevents floating-ui from associating the tooltip with the trigger.**  
   [Dock.tsx:2762](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/Dock.tsx:2762), [Dock.tsx:2809](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/Dock.tsx:2809), [Tooltip.tsx:224](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/Tooltip.tsx:224)

   The comment says floating-ui takes over `aria-describedby` while the tooltip is open. The actual merge does the opposite: `children.props` wins over `useRole`’s generated attribute. Because React includes the prop even when its value is `undefined`:

   - With a failure note, the trigger keeps only the note ID; the open tooltip is unassociated.
   - Without a note, the explicit `undefined` still suppresses floating-ui’s tooltip ID.

   Thus the new failure note remains available, but the Comments tooltip description is lost in every state.

   I would compose the persistent note ID and floating tooltip ID inside `Tooltip`, preserving the note when closed and exposing both IDs when open. Test all three cases: ordinary open tooltip, closed failure note, and open tooltip plus failure note.

3. **P2 — The new tests leave both integration seams unprotected.**  
   [layout.test.ts:453](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/tests/layout.test.ts:453), [Reader.tsx:1891](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/src/web/reader/Reader.tsx:1891), [a-failed-comment-write-is-said-on-the-dock.test.tsx:57](/home/greg/code/spideryarn2/.claude/worktrees/fb2e-black-bar/tests/a-failed-comment-write-is-said-on-the-dock.test.tsx:57)

   The bar tests exercise `barHasContent` alone. They still pass if Reader ignores the predicate and always renders `.controls`. Add at least one real Reader mount for each significant branch and assert whether `.reader > .controls` exists.

   The Dock helper always renders with `panel: "questions"`. The suite therefore passes if the failure marker and description incorrectly appear only while the drawer is open. It also never opens/focuses the tooltip, which is why finding 2 passes. Test the closed-drawer state first, then open it through the trigger.

   For preserving the reader’s position when a 44px bar disappears mid-document, **you have not shown this**. Initial `?at=` restoration follows the current DOM correctly, but add a browser check that switches modes while scrolled and asserts the same block remains at the same visual position.

I found no defect in the other challenged paths:

- `controlsBar()` selects the outer Reader before any authored descendant; the named standalone pages do not call the reading-position helpers.
- `barHasContent` currently complements every occupant in Reader’s JSX.
- The CSS specificity ladder, narrow-window rule, design override, and inline preview overrides resolve as documented.
- `fitSignature` receives `own.error` at its live Dock call site.
- Moving the two fixtures beneath `.reader` reflects the production DOM contract rather than bending the tests.

**Verdict: not safe to land on `dev` yet.** Fix the two P1 error/accessibility defects and add reachable-state regressions first. The targeted tests passed (123 tests), and direct web/test TypeScript checks passed; the full database-backed suite could not run because local Postgres/Supabase was unavailable.