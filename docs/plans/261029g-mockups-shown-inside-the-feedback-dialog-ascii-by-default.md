# Mockups shown inside the Feedback dialog, ASCII by default

Queue item `qi-5qmsr8nb`; Greg's reply `spya-rrvwca` to question
[q-c8h4zg](../user-feedback/questions/q-c8h4zg.md), about his discussion report `spya-zytb0g`.
Follows [261028b](261028b-feedback-discussions-monospace-mockups-and-admin-mockups-page.md).

> I have to click the link, and then it opens in a separate page, and then the back button, because
> I'm in—it's like shared as a web app on my home screen on the iPad. So then the left arrow takes me
> back to the mockups page, but not to this feedback dialog. […] So whatever we do, I think we want
> to be able to embed them within this feedback dialog so I can see them. […] I guess life is
> simpler if we stick with ASCII diagrams. Then you don't need to worry about database tables. Let's
> try it with ASCII diagrams for a while.
>
> — Greg, 2026-10-28 (`spya-rrvwca`)

## What changes

1. **A mockup id in a question opens the mockup in place.** Today `m-k3m9qt` in a question's body
   is an `<a target="_blank">` to `/admin/mockups/m-k3m9qt`. In a home-screen web app that leaves
   the dialog with no way back. It becomes a toggle button: tap it and the mockup's text, ASCII and
   images are drawn after the surrounding plain-text run, inside the dialog; tap again to close it. The data comes
   from the same admin GET the mockup page already uses (`/api/admin/mockups/:id`, images through
   `apiFetch` into blob URLs), so there is no new route and no new permission. Only an admin sees
   questions, and only an admin can read that route.
   - Code: the mockup body renderer (text parts and `MockupImage`) moves out of
     `AdminMockupsPage.tsx` into `src/web/MockupView.tsx`, which both the page and the dialog use.
     `PlainTextBlocks` loses its `linkMockups` knowledge and gains a `paragraph` render prop, so the
     dialog's mockup-aware paragraph (`src/web/MockupsInText.tsx`) does not import a module that
     imports it back. `/admin/mockups` itself is unchanged.
2. **The default is written down** in feedback-reports.md § Asking Greg a question and in admin.md
   § `/admin/mockups`: ASCII inline in the question, in a fenced block, by default; a mockup file
   (a wireframe image, say) only when the look matters, and an agent opens any image it made and
   looks at it before naming it in a question. ask-me-questions.md already says "an ASCII sketch
   where shape matters"; it is a reusable rule doc and needs no change for this.
3. **The ASCII is already monospaced.** `.fb-mono` uses `--font-mono` (plan 261028b, Stage 2);
   nothing to do. The dialog's width stays as it is: Greg was unsure, and a `<pre>` scrolls
   sideways.
4. **What is left is asked, not decided.** Whether the `/admin/mockups` table is kept, grouped or
   removed, and whether style D (an image model, queue item `qi-2fs87mnx`) is still wanted, go to
   Greg as one new question with a recommendation. `qi-2fs87mnx` stays a proposal (unauthorised, so
   nothing dispatches it) until he answers.

## The simpler options passed over

- **Do nothing in code; ASCII only.** ASCII in a question already shows inline. But the mockup
  files that exist (and any wireframe made "when the look matters") would still be one tap away
  from a dead end on his iPad. The toggle is small and reuses everything.
- **Open the page in a popup or iframe.** An iframe of `/admin/mockups/m-…` would boot a second
  copy of the app inside the dialog. Drawing the parts directly is less.
- **Keep the link and add the toggle beside it.** Two controls for one id; the link is the one that
  strands him. Dropped. The mockup page stays reachable from `/admin`.

## Tests

- `tests/plain-text-blocks-links.test.tsx` becomes a test of the toggle: only a well-formed id
  becomes a button, nothing in a fence or in a mockup's own body does, tapping it fetches
  `/api/admin/mockups/<id>` and draws its text after the surrounding plain-text run, tapping
  again closes it, and there is no `<a target="_blank">`. Written red first against the current
  link.
- `tests/admin-mockups-page.test.tsx` keeps passing with the shared renderer.
- eager-client-graph / client-imports updated if the new modules show up in their lists.

## GPT Sol's plan review (2026-10-29), and what was done

1. *High*: the thread view is reused when paging, so an open mockup could stay open under the next
   question. **Taken**: each body is keyed by its question's id in FeedbackEarlier.tsx, with a test.
2. *Low*: the new renderer is certainly in the reader's startup graph. **Taken**: `MockupView.tsx`
   recorded in tests/eager-client-graph.test.ts with its reason; it is small and fetches nothing
   until an admin taps.
3. *Low*: the follow-up question is unnecessary, since Greg chose ASCII "for a while". **Taken**:
   no new question. The table stays as it is, and `qi-2fs87mnx` is parked (its waiting-on line
   says so), not dropped.

Also found while building: a run of plain text is everything between fences, blank lines and all
(src/plain-text-blocks.ts), so the mockup opens after that whole run rather than after one blank-
line paragraph. Good enough for a v1.
