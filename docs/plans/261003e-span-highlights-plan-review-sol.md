No P0 security or permanent-data-loss issue is inherent in the model. “A highlight is a comment with an optional colour” is the right foundation, but the plan is not ready to build unchanged—especially the floating menu.

## Findings

### S1 — P1 — One-press highlight bypasses the opening-read write gate

The plan says a swatch calls `useComments.create` directly ([plan:108](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003e-span-highlights-with-a-colour.md:108>)). But `create` does not enforce readiness: the gate lives in `AnnotateDialog` ([AnnotateDialog.tsx:209](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:209>)), while the opening GET later replaces the whole list ([useComments.ts:288](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:288>)). This is precisely the reproduced race in [260908c:15](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md:15>).

The server row survives, but the newly saved highlight disappears from the tab, so this is P1 rather than P0.

Concrete plan change: gate the menu’s swatches in both the button state and handler on `owner.comments.loaded`, matching AnnotateDialog. Add a mounted test where GET A remains pending, the swatch is refused without dismissing the selection/menu, then after GET A settles the POST creates B and both A and B remain. Preserve the current contract that a failed or timed-out opening read sets `loaded` and permits saving.

### S2 — P1 — The annotation cache will make recolouring and ✳ changes appear not to work

`annotateHtml` receives only `Mark`; comments currently become `{ id, start, end }` ([TableView.tsx:245](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:245>)). More importantly, `anchorKey` deliberately excludes every non-anchor field ([TableView.tsx:204](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:204>)), and `marksByBlock` reuses the old resolved marks whenever that key matches ([TableView.tsx:894](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:894>)).

Therefore:

- Recolouring an existing comment leaves the cached old colour.
- Removing its colour may leave the wash.
- Adding or removing `body` may leave the old ✳ state.

Concrete plan change: carry the visual facts needed by drawing on each comment mark—at least colour, whether this comment earns a marker, and a deterministic creation priority—and either include those facts in the cache key or apply them in a separate cheap pass analogous to `applyOpen`. Add mounted tests for recolour, colour removal, adding a body to a wordless highlight, and clearing that body again.

### S3 — P1 — Colour PATCH must join the existing per-comment write queue

Both existing PATCH operations return a complete comment and replace the complete client row. That is why body and referee-placement writes share `patching`: otherwise crossing responses put old fields back on screen ([useComments.ts:228](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:228>), [useComments.ts:631](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:631>), [useComments.ts:667](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:667>)).

A separately launched colour PATCH can race a body or placement PATCH. Disk remains correct because the SQL updates disjoint columns, but whichever full response lands last can restore stale colour/body/placement in the tab.

Concrete plan change: add `recolour` to `CommentsApi` and put it through the same `queue(id, …)` as `edit` and `place`. Make the picker controlled by the stored comment, or implement explicit optimistic rollback. Test all three crossing-write pairs with deliberately reversed responses.

### S4 — P1 — Nullable colour currently permits an invisible “whole-paragraph highlight”

The plan puts the swatch row in `CommentDialog` generally ([plan:89](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003e-span-highlights-with-a-colour.md:89>)). Whole-block comments have no quote by design ([types.ts:2854](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/types.ts:2854>)) and are explicitly skipped by inline drawing ([TableView.tsx:256](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:256>)). Colouring one would therefore store an object described as a highlight that cannot paint anything, and may be labelled “Highlight” despite remaining only a gutter mark.

`comments_whole_block_is_free` does not prevent this; it constrains `status`, not colour ([schema.ts:1902](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/db/schema.ts:1902>)).

Concrete plan change: require colour to have a selection anchor:

- SQL: `colour is null or quote is not null`.
- POST and colour PATCH: refuse colour on quote-less comments.
- `CommentDialog`: hide the colour picker when `comment.quote === undefined`.
- Tests for both POST and PATCH refusals.

### S5 — P1 — “Newest colour wins” can visibly identify one comment while clicking opens another

Overlapping comment IDs are currently emitted in input order ([annotate.ts:460](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/annotate.ts:460>)). The click handler opens the first comment ID unless a linked comment/chat pair takes precedence ([TableView.tsx:1443](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:1443>)).

If the newest comment supplies the visible green wash but the oldest ID remains first, pressing the green words opens the older yellow/comment object. “All IDs still listed” does not solve that interaction.

Concrete plan change: define one total priority—`createdAt`, then `id`—for both the colour winner and the primary clickable comment. Emit all IDs, but newest-first, or add an explicit primary-comment attribute. Preserve the existing linked comment/chat exception deliberately. Test the actual `onMouseUp` path, not only generated markup.

The newest-wins rule itself is reasonable once these are aligned.

### S6 — P1 — Highlight colour takes a rendering channel already owned by search confidence

Comments deliberately use an underline because selection, active gist state, and other features already use fills ([annotations.css:33](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/styles/annotations.css:33>)). Search hits use `background-color` for confidence ([annotations.css:315](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/styles/annotations.css:315>)). A comment and a hit are one `<mark>`, so both cannot independently own that background.

Depending on CSS order, either the highlight disappears while Search is active or the search-confidence wash disappears. The plan only checks that their colours differ; it does not decide overlap semantics.

Concrete plan change: state and test the precedence. The simplest coherent rule is:

- A reader-authored highlight wash wins on the exact overlapping words.
- Search identity remains in its hue stripes and paragraph rail.
- Opening the comment adds an outline/border rather than replacing its chosen colour with the generic orange wash.
- Term, citation, and cross-reference lines remain visible.

Browser-test `cmt + hit`, open highlight, dark mode, and active native selection.

### S7 — P1 — The floating menu can become detached from its passage and save stale state

The proposed dismissal set is Escape, outside click, or a new selection ([plan:115](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003e-span-highlights-with-a-colour.md:115>)). Current Reader state retains only the anchor ([Reader.tsx:854](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:854>)), and deliberately leaves the browser selection alone ([Reader.tsx:2128](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2128>)).

A reader can select A, scroll or change mode, then press a fixed menu still carrying A. Also, a multi-block selection is stored only against its clamped first block ([selection.ts:90](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/selection.ts:90>)); positioning from the browser’s unclamped last rect could place the menu beside text that will not be saved.

Concrete plan change:

- Return geometry from the same clamped range used to construct the anchor.
- Store `{anchor, rect, selectionToken}` as one draft.
- Dismiss on scroll, resize, article/mode change, and loss/change of the browser selection.
- Re-read and compare the live selection immediately before saving.
- Add a test proving a stale menu cannot POST.

### S8 — P1 — The menu needs to enter the existing foreground-surface and Escape contract explicitly

Today `selectProse` closes the open comment/chat before opening annotation ([Reader.tsx:2125](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2125>)). Annotate yields Escape while Comment or Chat is in front ([Reader.tsx:2962](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2962>)). The shared Escape hook otherwise lets every mounted surface react to the same press ([useEscapeToClose.ts:28](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useEscapeToClose.ts:28>)).

There are several concrete seams:

- Menu and AnnotateDialog must never both own Escape.
- “Comment…” must newly mount AnnotateDialog so its mount-only autofocus runs ([AnnotateDialog.tsx:200](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:200>)).
- The new menu state must join `surface.current`; otherwise a late gutter-bookmark confirmation can open a CommentDialog over it ([Reader.tsx:2042](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2042>)).
- Referee mode must enter the dialog phase directly, and switching into Referee mode must dismiss a pre-existing menu.
- The owner check must happen before menu state is created, preserving visitors’ silent selection behavior.
- Outside-click handling must ignore clicks within the menu; otherwise pointerdown can unmount a swatch before its click saves.

Concrete plan change: specify one selection-draft state machine—`menu → dialog → saved/cancelled`—with mutually exclusive rendered surfaces. Add tests for one Escape/one surface, Comment autofocus, visitor silence, Referee bypass, and late bookmark completion.

### S9 — P1 — The promised “Highlight” classification conflicts with current AI precedence, margin filtering, and dialog labels

`commentKind` currently gives AI involvement priority over body/bookmark ([comment-nav.ts:222](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/comment-nav.ts:222>)). Adding `highlight` naïvely can erase “Comment + AI” from a coloured, wordless comment that started a chat.

Two further paths will disagree:

- Marginalia currently includes every kind except `bookmark`, so a new `highlight` will be included despite the plan saying wordless highlights stay out ([marginalia/notes.ts:281](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/marginalia/notes.ts:281>)).
- `CommentDialog` independently labels `status:none` plus no body as “Bookmark”, so clicking a wordless highlight opens a box headed Bookmark ([CommentDialog.tsx:341](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/CommentDialog.tsx:341>)).

Concrete plan change: define precedence explicitly:

1. `comment-ai`
2. `comment`
3. `highlight`
4. `bookmark`

Exclude both `highlight` and `bookmark` from Marginalia, but retain a wordless highlighted `comment-ai` because it has something beyond the highlight. Use `commentKind` for the dialog’s owner and visitor labels as well as the drawer. Test each combination.

### S10 — P1 — Creation idempotency must include colour

Postgres decides whether a duplicate client-minted ID is the same Save by comparing every meaningful creation field ([pg-comments.ts:251](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/pg-comments.ts:251>)). If colour is omitted from that equality, the same ID resent with a different colour returns the old row as success instead of reporting a collision.

Concrete plan change: add colour to `NewComment`, the inserted fields, `toComment`, and same-Save equality. Test:

- Same ID and same colour is idempotent.
- Same ID and different colour is 409.
- Absent colour and a named colour differ.

Also clarify representation: the database column and PATCH body are nullable, but `Comment.colour` should be optional/absent in TypeScript, matching the codebase’s existing null-to-absence convention.

### S11 — P1 — Public sharing and export are hand-maintained allowlists, not conditional follow-up work

The plan says to update export “if `export.md` lists comment fields” ([plan:126](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003e-span-highlights-with-a-colour.md:126>)). The need is definite:

- The rollback exporter manually enumerates comment fields and will otherwise drop colour ([store/export.ts:534](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/export.ts:534>)).
- The reader bundle uses whole-row `rowJson`, so it should gain the column automatically ([export-bundle.ts:505](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/export-bundle.ts:505>)).
- The public SQL query explicitly selects every comment column ([public-reader.ts:564](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/public-reader.ts:564>)).
- The public store mapping and DTO each rebuild the object field by field ([public-reader.ts:899](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/store/public-reader.ts:899>), [public/dto.ts:919](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/public/dto.ts:919>)).
- `PublicComment` is another explicit shape ([public-types.ts:781](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/public-types.ts:781>)).

The existing SQL exclusions for referee and unfinished/failed comments remain correct; colour does not weaken them.

Concrete plan change: make all those locations explicit Stage 1 work and add public owner/visitor equivalence plus rollback/bundle export tests. This must not be deferred: otherwise a shared highlight stops being a highlight, and one exporter drops reader state.

### S12 — P2 — Stage 3 depends on an unanswered product decision

The plan calls the menu “the part that needs Greg’s decision” ([plan:96](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003e-span-highlights-with-a-colour.md:96>)), but its final “question” records no answer or feedback-note path ([plan:155](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/docs/plans/261003e-span-highlights-with-a-colour.md:155>)).

Concrete plan change: either record the decision and exact interaction contract before Stage 3, or move the floating menu into a follow-up plan. “Whichever shape Greg chooses” is not an implementable stage.

## Direct answers

1. The data model is right, provided colour is constrained to selection-anchored comments. It does not inherently break the sweep, `linkThread`, or public filtering. The missed invariants are whole-block colour, same-Save equality, per-comment PATCH ordering, and the manual public/export projections.

2. Newest-wins is implementable, but not by `annotateHtml` as currently fed: `Mark` lacks colour, body/marker state, and creation priority, and the cache discards all of those changes. The rule is reasonable if the same winner also becomes the primary click target.

   Removing ✳ is safe for an ordinary mark because clicks use `mark.cmt` and `data-comment`, not the pseudo-element. It is not universally clickable: author links and cross-references deliberately win before comments ([TableView.tsx:1405](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:1405>)). Such highlights remain reachable through the gutter and drawer. The plan should state that exception rather than promise every coloured phrase itself opens.

3. The specific menu seams are the opening-read gate, stale captured anchor, clamped-range geometry, menu/dialog autofocus transition, Escape ownership, existing-surface clearing, the late-bookmark surface snapshot, visitor silence, Referee bypass, and inside-versus-outside pointer handling.

4. The simpler version that gets most of the value is: implement data, drawing, and colour pickers inside the existing `AnnotateDialog` and owner `CommentDialog`; keep the current selection flow. That delivers coloured sentence-level highlights and notes while reusing the proven loaded gate, focus handling, draft ID, and Escape contract.

   I would also omit the proposed Copy button from a future lightweight menu initially. If the menu does not take focus, native ⌘C already works; the existing explicit Copy control remains in AnnotateDialog. A second clipboard surface otherwise inherits the failure/token states documented in [AnnotateDialog.tsx:365](</home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/AnnotateDialog.tsx:365>).

5. Defer the floating menu to a follow-up unless Greg’s answer is recorded and the lifecycle above is designed. Keep touch and multi-block highlights deferred. Do not defer public projection, export fidelity, overlap precedence, or recolouring/write ordering; those are correctness requirements of the colour model itself.

Overall verdict: **build with changes**.