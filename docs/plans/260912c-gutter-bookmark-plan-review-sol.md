I would not approve Stage 2 as written yet. Option B is the right long-term model, and the gutter arithmetic is coherent, but there are three P1 gaps. No P0 findings.

## Findings

1. **P1 — The proposed union does not actually make a half-anchor impossible.**

   The plan says to copy `ChatAnchor`’s shape ([plan:131](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/docs/plans/260912c-gutter-bookmark-button-and-the-second-ellipsis.md:131)), but its block arm is merely `{ blockId }` ([types.ts:2973](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/types.ts:2973)). Because TypeScript is structurally typed, an object containing `blockId + quote` can satisfy that broad arm even though it lacks `start`.

   Converting `Comment` from an interface to a union also breaks `ClientComment extends Comment` ([useComments.ts:68](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/useComments.ts:68)).

   **Fix:** define a strict shared anchor:

   ```ts
   type WholeBlockAnchor = {
     blockId: BlockId;
     quote?: never;
     start?: never;
   };

   type SelectionAnchor = {
     blockId: BlockId;
     quote: string;
     start: number;
   };
   ```

   Use it in `Comment`, `NewComment`, `NewCommentInput`, and `PublicComment`; make `ClientComment` an intersection type rather than an extending interface. Keep the route and database checks as runtime fences.

2. **P1 — The bookmark button can appear before the comment list is known, then race and lose its own write.**

   Before the opening GET settles, `comments` is deliberately `[]`; its result later replaces the whole list ([useComments.ts:313](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/useComments.ts:313), [useComments.ts:322](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/useComments.ts:322)). This exact race is already documented, and Annotate waits for `loaded` because of it ([useComments.ts:117](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/useComments.ts:117), [Reader.tsx:2104](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/reader/Reader.tsx:2104)).

   If `onBookmark` is passed merely when there is an owner, every block initially looks comment-free. A quick press can be overwritten locally by the GET, or can create a second bookmark when the GET had failed and an existing comment was simply unknown.

   **Fix:** withhold the callback unless `owner.comments.loaded && !owner.comments.loadFailed`. Add a slow-opening-GET test proving the button is absent until the successful snapshot lands and that the snapshot cannot erase a bookmark.

3. **P1 — The database migration is safe in isolation, but the rollout is not backward-compatible with an old browser tab.**

   Once a new client creates a quote-less row, an old client can receive it from the unchanged comments endpoint. Its `anchorKey` immediately evaluates `c.quote.length` ([TableView.tsx:208](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/TableView.tsx:208)), so an owner using an older open tab can crash after another tab creates the bookmark.

   A database-first deployment prevents new rows before the writer lands, but it does not evict already-open JavaScript clients.

   **Fix:** explicitly choose a compatibility strategy. The robust version is a versioned comments response/header: new clients opt into block anchors; the old response omits those rows until refreshed. If the beta deliberately accepts old-tab breakage, say so in the plan rather than calling the change simply additive.

4. **P1 — The nullable-consumer and witness list is incomplete.**

   Missing or under-specified seams include:

   - Server input: `NewComment` still requires both fields ([comments.ts:62](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/comments.ts:62)).
   - Client input, optimistic row and JSON request: [useComments.ts:73](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/useComments.ts:73), [useComments.ts:561](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/useComments.ts:561).
   - Public mappings assign optional values directly instead of preserving absence: [public-reader.ts:759](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/store/public-reader.ts:759), [dto.ts:447](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/public/dto.ts:447).
   - The rollback export happens to drop nulls, but an `as Comment` masks mistakes ([export.ts:524](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/store/export.ts:524)).
   - The downloadable bundle does the opposite: `rowJson` retains `quote: null, start: null` ([export-bundle.ts:162](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/store/export-bundle.ts:162), [export-bundle.ts:479](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/store/export-bundle.ts:479)). The plan’s “absent case” therefore needs an explicit format decision.
   - The fixture seeder passes possibly absent properties without explicitly converting them to SQL nulls ([seed-reader-state.ts:211](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/helpers/seed-reader-state.ts:211)).
   - An existing route test specifically says `{ blockId }` is invalid ([routes.test.ts:1080](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/routes.test.ts:1080)).
   - Public DTO tests currently require `quote` and `start` in the key set ([public-dto.test.ts:1133](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/public-dto.test.ts:1133)).
   - JSX such as the opening-read harness will silently render nothing ([opening-read-gates-writes.test.tsx:633](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/tests/opening-read-gates-writes.test.tsx:633)).

   **Fix:** add an explicit implementation-and-witness matrix covering route creation and half-pair refusals, store round-trip/idempotency, public wire shape, both export formats, navigation ordering, Mirror, Dock/Dialog rendering and the load race. `store-migration-witness.json` does not need changing—it records the old filesystem-store test migration. Existing registered test files can hold these cases.

5. **P2 — “Opening words from the block” needs additional data plumbing and an orphan fallback.**

   `CommentDialog` receives only the comment ([CommentDialog.tsx:101](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/CommentDialog.tsx:101)); the Dock drawer likewise receives only comments ([Dock.tsx:380](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/Dock.tsx:380)). Neither can currently obtain the block opening promised by the plan.

   A block can also disappear from the current revision while its comment survives. A quote-less bookmark then has no preserved words to show.

   **Fix:** thread a `blockPreviewById` map from `Reader` to both surfaces, with explicit fallback copy such as “Whole paragraph — no longer in this version.” The smaller alternative is just “Whole paragraph,” but that makes a drawer containing several such bookmarks hard to scan.

6. **P2 — Hiding the disclosure remains operable, but an ✕ is the safer and simpler accessible design.**

   The second ellipsis diagnosis is correct: the open rule displays every child ([gutter.css:740](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/styles/gutter.css:740)). Keyboard opening moves focus to the first control, and Escape restores the disclosure after closing ([BlockGutter.tsx:392](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/BlockGutter.tsx:392), [BlockGutter.tsx:424](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/BlockGutter.tsx:424)). So hiding it is not a keyboard trap.

   However, the disclosure and its `aria-expanded=true` state disappear from the accessibility tree, Shift-Tab cannot return to it, and the plan relies on Chrome focus fix-up for an issue reported on iPad Safari.

   **Fix:** keep the control while open but render an ✕ with “Close paragraph controls.” It changes nothing about collapsed slot arithmetic and answers Greg’s complaint about a second ambiguous ellipsis. If hiding remains the choice, require an actual Safari/VoiceOver check, not only an iPad-sized Chromium pass.

7. **P2 — Do not widen `linkThread`; quote-less comments are already unreachable there.**

   The chat route calls it only for a selection anchor ([routes.ts:2877](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/routes.ts:2877)), and the store contract deliberately requires that selection ([contracts.ts:502](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/store/contracts.ts:502)).

   **Fix:** remove the planned null-safe `linkThread` change. Keeping its input selection-only preserves a useful type and security fence.

## Conclusions

- Option B is the right product choice over A. Underlining a paragraph the reader did not select—and turning every tap inside it into “open comment”—would make the iPad interaction worse.
- The database constraints should be written exactly as:

  ```sql
  CHECK ((quote IS NULL) = (start IS NULL))
  CHECK (quote IS NOT NULL OR status = 'none')
  ```

  Existing rows satisfy both, `DROP NOT NULL` does not rewrite them, `beginAnswer` only claims terminal/expired answering states ([pg-comments.ts:395](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/store/pg-comments.ts:395)), and `sweepPending` only touches `pending` rows ([pg-comments.ts:728](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/store/pg-comments.ts:728)). The public read intentionally admits `status none` ([public-reader.ts:489](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/store/public-reader.ts:489)).
- Third after permalink and chat, before “?”, is coherent. Because bookmark affordance and comment mark are mutually exclusive, owner gutters remain at four controls. The count must use the rendered condition, and the new class must join every explicit hidden/focus/hover/touch selector list around [gutter.css:489](/home/greg/code/spideryarn2/.claude/worktrees/fb37-38-gutter-icons-bookmark/src/web/styles/gutter.css:489).
- The simpler choices I recommend are: keep `linkThread` unchanged and use a visible ✕ while the gutter is open. I would not replace option B with A.

No files were edited.