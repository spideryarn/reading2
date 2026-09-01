The gutter should not ship unchanged. The grouping and live-region architecture are sound, but the implementation still has two serious geometry/input problems and an asynchronous navigation bug.

## High severity

1. The actual targets are about 12×15px, not 2.1rem wide.

[styles.css:7818](/home/greg/code/spideryarn2/src/web/styles.css:7818) centers children in a 1.4rem container. [styles.css:7869](/home/greg/code/spideryarn2/src/web/styles.css:7869) gives each child only `min-height: 0.95rem`, no padding, and no minimum width. For a count-less icon, the SVG’s 12px width is therefore effectively the clickable width.

On touch, a reader must hit one of several 12×15.2px targets whose centres are only 15.2px apart. That fails WCAG 2.2’s 24×24px target-size or spacing requirement; the spacing exception also fails because the targets are too close together. [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

The comment at [styles.css:954](/home/greg/code/spideryarn2/src/web/styles.css:954) is consequently false: the gutter width is not the hit-target width.

Fix: make each target at least 24×24px. Since three such targets cannot fit vertically in a 39px row, this requires changing the arrangement—relocate chat, use a horizontal/flyout action tray, or accept taller rows.

2. The measured paragraph overhang becomes interactive in states the fixture omitted.

The third child is always the chat button ([BlockGutter.tsx:264](/home/greg/code/spideryarn2/src/web/BlockGutter.tsx:264)). On a one-line commented paragraph, it is the control extending into the following row.

It becomes pointer-active:

- On desktop whenever the block already has a chat, through `.block-chat.has` at [styles.css:7900](/home/greg/code/spideryarn2/src/web/styles.css:7900).
- On every `(hover: none)` device, through [styles.css:7927](/home/greg/code/spideryarn2/src/web/styles.css:7927).

Therefore a tap in the next row’s upper gutter can target the previous row’s chat button. If that overflowing descendant wins hit testing, [TableView.tsx:746](/home/greg/code/spideryarn2/src/web/TableView.tsx:746) also marks the previous row active while the pointer is geometrically in the next row.

`.blk-gutter { pointer-events: none }` does not solve this; these children explicitly opt back into pointer events. The browser check only established safety for a desktop row whose overhanging chat was hidden.

Fix: do not let any interactive child cross a row boundary. This reinforces the earlier recommendation to relocate chat; retaining the feature is reasonable, but retaining it specifically as a third vertical slot is not.

3. A commented heading is a second unmeasured overhang shape.

[styles.css:7858](/home/greg/code/spideryarn2/src/web/styles.css:7858) bottom-anchors the gutter, but bottom anchoring cannot make a 46px three-control stack fit inside the measured 33px heading row. A single-line commented heading therefore extends roughly 15px upward into the preceding row. A small first-row heading can extend into the table head.

On touch its permalink is active there; keyboard focus also reveals that permalink in the preceding row. This contradicts both “nothing overhangs anything” at [styles.css:7843](/home/greg/code/spideryarn2/src/web/styles.css:7843) and “exactly one row shape” at [prose-gutter-icons.md:141](/home/greg/code/spideryarn2/docs/plans/prose-gutter-icons.md:141).

A two-line heading is safer because the extra line supplies height; wrapping is not the problem.

Fix: same structural fix as finding 2, plus fixtures for first-row headings and commented headings of different levels.

## Medium severity

4. A delayed clipboard failure can unexpectedly navigate the reader.

The rejection path at [BlockGutter.tsx:158](/home/greg/code/spideryarn2/src/web/BlockGutter.tsx:158) announces failure and calls `onJump(id)`. The supplied jump at [App.tsx:1032](/home/greg/code/spideryarn2/src/web/App.tsx:1032) pushes `?at=` into history and smoothly scrolls.

Concrete sequence:

1. Click block A’s permalink.
2. While `writeText()` is pending, open a dialog, change mode, or move elsewhere.
3. The promise rejects.
4. The old operation pushes block A into history and scrolls the document back, potentially behind the dialog.

If `?at=` already names A, `jumpTo` still requests a history push, so Back can acquire a duplicate/no-op entry.

This is not a harmless fallback. The copied URL failed; moving the page later is surprising and does not make the URL conveniently selectable.

Fix: on failure, announce it without jumping. If a fallback is required, expose a selectable URL or explicit copy/share action. At minimum, replace rather than push and do not scroll.

5. The timer does not protect against stale promises or unmount.

The cleanup at [BlockGutter.tsx:102](/home/greg/code/spideryarn2/src/web/BlockGutter.tsx:102) clears only a timeout that already exists. The clipboard continuations at [BlockGutter.tsx:170](/home/greg/code/spideryarn2/src/web/BlockGutter.tsx:170) remain live.

Two failures follow:

- Click twice; the second write succeeds, then the older write rejects. The older result replaces the newer tick with an error and invokes the jump.
- Click, then unmount the gutter while the promise is pending. Its continuation later calls `setCopy`, announces, and creates a new timer after cleanup has already run.

Fix: keep a monotonically increasing operation token and a mounted ref. Ignore any completion whose token is stale or whose component has unmounted. Removing navigation from the failure path also limits the damage.

6. The tests do not exercise the feature’s main behavior.

[block-ref.test.ts:62](/home/greg/code/spideryarn2/tests/block-ref.test.ts:62) tests only URL construction. [comment-nav.test.ts:129](/home/greg/code/spideryarn2/tests/comment-nav.test.ts:129) correctly pins grouping and reading order, but never renders `BlockGutter`.

An implementation that always copied, copied on modified clicks, opened the last comment, used an optimistic tick, threw without Clipboard API support, or rendered no live region would pass. Likewise, grouping correctly but rendering markers only from resolved marks would pass the orphan unit test.

Add component tests using controlled clipboard promises and fake timers for:

- Pointer versus keyboard activation and modifiers.
- Success, rejection, and missing Clipboard API.
- Out-of-order resolution and unmount.
- Repeated announcements.
- Comment-marker count and opening the first comment.

The geometry, touch media query, real Enter event, target sizes, and hit testing belong in a retained browser fixture rather than a deleted one-off preview.

## Low severity

7. Repeated copies of the same block are silent to a screen reader.

[TableView.tsx:380](/home/greg/code/spideryarn2/src/web/TableView.tsx:380) acknowledges this. After the icon settles, copying the same block again writes identical `textContent`, producing no live-region mutation and therefore generally no new announcement.

Fix: clear and restore the message in a later task, or give announcements a sequence key in a small dedicated status component.

8. The failed-state opacity rule loses the specificity contest.

`tr:hover .blk-permalink` at [styles.css:7910](/home/greg/code/spideryarn2/src/web/styles.css:7910) is more specific than `.blk-permalink.failed` at [styles.css:7916](/home/greg/code/spideryarn2/src/web/styles.css:7916). Immediately after a pointer failure, while the row remains hovered, the alert is rendered at `opacity: 0.6`, not the promised full strength.

Fix: lower the hover rule’s specificity with `:where()`, or add an explicit `tr:hover .blk-permalink.failed` override.

9. Several documentation claims are still inaccurate.

- [BlockRef.tsx:5](/home/greg/code/spideryarn2/src/web/BlockRef.tsx:5) and [styles.css:995](/home/greg/code/spideryarn2/src/web/styles.css:995) say `BlockRef` still supplies a visible gutter block ID. It does not.
- “Fixed slots” at [styles.css:7814](/home/greg/code/spideryarn2/src/web/styles.css:7814) is not literal: the comment element is conditional at [BlockGutter.tsx:236](/home/greg/code/spideryarn2/src/web/BlockGutter.tsx:236), so chat moves from position two to three when a comment appears.
- The postmortem’s root cause at [block-chat-was-never-in-the-gutter.md:51](/home/greg/code/spideryarn2/docs/postmortems/block-chat-was-never-in-the-gutter.md:51) is really the escape mechanism. The implementation cause was the missing positioning/container; opacity concealed it, absent geometry coverage let it escape, and the comments reinforced the mistake. A CSS comment cannot itself cause the layout.
- “Being in the gutter is a fact about the DOM” at [block-chat-was-never-in-the-gutter.md:79](/home/greg/code/spideryarn2/docs/postmortems/block-chat-was-never-in-the-gutter.md:79) overstates it: the container is in the DOM, but its gutter position is still entirely a CSS fact.

## Specific questions that are otherwise fine

- `detail === 0`: an ordinary touch tap is a pointing-device click and should have a click count beginning at 1; non-pointing activation has no pointer type. [Pointer Events specification](https://www.w3.org/TR/pointerevents4/#the-click-auxclick-and-contextmenu-events) A phone’s ordinary tap should therefore copy, not jump. Enter and typical screen-reader virtual activation arrive on the navigation side. `HTMLElement.click()` also has detail 0 and navigates in place. Space normally does not activate a native link; it scrolls. AT that emulates a mouse can still produce detail 1, so the comment calling this “the whole test” is too strong. `nativeEvent.pointerType`, with `detail` as fallback, would express the distinction better.
- The live-region ref at [TableView.tsx:386](/home/greg/code/spideryarn2/src/web/TableView.tsx:386) is otherwise sound. React has no children to reconcile on that span, and the stable `useCallback([])` does not defeat memoisation. If React replaces the node, the ref tracks the replacement.
- `cmtsByBlock` at [TableView.tsx:368](/home/greg/code/spideryarn2/src/web/TableView.tsx:368) has the correct dependencies. It should not depend on `openComment`; the arrays change only when comments or blocks change, and `BlockGutter` is not memoised anyway.
- `.blk-gutter > *` currently matches only the intended anchor/buttons. It is broad but not presently wrong. `.block-chat.has` also has sufficient specificity.
- Opacity-hidden controls remain keyboard reachable and reveal on `:focus-visible`; that part is correct. The comment marker’s repeated accessible name is weaker in a controls list but not clearly a defect. I would change “paragraph” to “block” and include the ID, particularly because headings and captions are not paragraphs.

On the rejected recommendations: keeping one-click copy is defensible as a product choice, but the reason given is overstated. A link icon whose pointer activation copies and non-pointer activation navigates still has modality-dependent semantics, and touch users get no pre-activation tooltip. A normal anchor retains platform link actions on mobile. If copying must be the primary action, a separately named copy button is the honest control.

Keeping chat as a feature is also reasonable. Keeping it as the third vertical gutter control is not: the measured target-size and overlap constraints are precisely why relocation was recommended.

I could not rerun the tests in this read-only environment: Vitest attempted to write `node_modules/.vite-temp`, and the `tsx` typecheck runner could not create its IPC socket. Those are environment limitations, not observed test failures.