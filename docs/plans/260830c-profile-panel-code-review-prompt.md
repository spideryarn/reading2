# Review prompt: the profile panel, as built

You reviewed the **plan** for this and found four blockers. This is the **code**, and your review of
built code is weighted higher than your review of a plan — a plan-stage review cannot find a handler
that writes one field and then rejects the request. Be adversarial. I want what is wrong.

Working directory is the repo root.

## What changed since your plan review

You said STOP and named four blockers. Three were taken as written, and the fourth was resolved by
the product owner choosing a smaller feature:

1. **`Tooltip` is not a click-popover.** Taken. `ProfilePanel` follows `ColourPicker`
   ([SearchPanel.tsx](../../src/web/SearchPanel.tsx)) — `useClick`, `useDismiss`,
   `useRole({role: "dialog"})`, `FloatingFocusManager modal={false}`. `Tooltip` is untouched.
2. **No single owner for the editor / the trigger vanishes for a reader with no profile.** Taken in
   part: only the *checkbox* is now conditional on `hasProfile`; the panel button always renders,
   and grows the words "Your profile" when the checkbox is absent. Two panels *can* still be open
   from two triggers — I judged that harmless now that nothing is editable. **Tell me if that is
   wrong.**
3. **A promise cache cannot implement `refresh()`.** Sidestepped entirely: `useHasProfile` is
   untouched, and the panel fetches `/api/reader?slug=` itself when opened. No store, no cache, no
   refresh.
4. **Dismissal loses edits and dictation.** Gone: Greg chose **read-only with links out**, so
   nothing is typed in the panel. No `usePurpose`, no change to `Metadata.tsx`, no save path.

Findings 5 (artefact lies after an edit) and 7 (`usePurpose` dragging Metadata in) are moot for the
same reason. Finding 9's `j` test was dropped — you were right that `keynav` handles only arrows and
already ignores typing targets, and that the wrapper `stopPropagation` would have swallowed Escape.

## What to read

- **The diff:** `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/b36c98ed-ec65-4770-916b-26bfe8f11401/scratchpad/profile-panel.diff`
- **Two new files**, untracked and so not in that diff — read them from disk:
  - `src/web/ProfilePanel.tsx`
  - `tests/profile-panel.test.tsx`
- **The plan as rewritten:** `docs/plans/260830c-profile-panel.md`
- **The docs:** `docs/project/reader-profile.md`, particularly § *The two controls* and the new
  § *And the third thing*.
- Prior art and neighbours: `src/web/SearchPanel.tsx` (§ `ColourPicker`), `src/web/Tooltip.tsx`,
  `src/web/useProfile.ts`, `src/web/lib/api.ts`, `src/web/router.ts`, `src/routes.ts`
  (`resolveProfileParts`, the `readerRoute` GET).

## Evidence, so you do not have to take my word for any of it

**The browser gate**, real Chrome, real pointer events, against the finished panel at 400px and
288px. `control` is the same `elementFromPoint` test on an ordinary in-flow link on the same page:

```
{ "state": "full", "panelOpened": true, "role": "dialog",
  "links": [ { "href": "/profile", "hitIsTheLink": true, "pointerEvents": "auto" },
             { "href": "/read/preview-article/metadata?...", "hitIsTheLink": true, "pointerEvents": "auto" } ],
  "control": true,
  "size": { "w": 320, "h": 285, "insideWindow": true },
  "focusAfterClick": "prof-panel-edit", "focusAfterTab": "prof-panel-edit :: Edit →",
  "closedByEscape": true, "focusReturned": true }
```

Same shape for `state=empty` (h 174) and `state=failed`. The same probe run against the **tooltip**
version returned `hitIsTheLink: false, hitTarget: "DIV.pv-page"` with `control: true` — so the probe
can report both answers.

**Every unit assertion was watched fail**, each against a mutation aimed at it:

| Mutation | Test that went red |
|---|---|
| `if (!hasProfile) return null` restored on `UseProfile` | is reachable by a reader who has no profile |
| the failure branch removed from `Box` | says it could not read a profile |
| the metadata `href` loses the slug | links to both halves |
| `disabled` put on the trigger `<button>` | still opens while a job is running |
| a real cache that skips the request | asks for nothing until it is opened |

`npm run typecheck` is clean on all three projects. `npm test`: 6024 pass; 10 fail across 5 files
(`auth-callback`, `doc-links`, `store-jobs-parity`, `store-shelf-reads`), none of which import
anything in this diff — a peer's broken doc link, a Supabase mock, Postgres job fencing and local DB
data.

## What I want you to attack

Rank by damage. Give the concrete sequence, not the category.

1. **`ProfilePanel`'s fetch-on-open.** `PanelBody` mounts only while open, has a `live` ref and no
   generation counter. Open, close, open again quickly; open, navigate, open; two panels open at
   once from two triggers. What goes wrong? Does the `live` ref actually cover unmount, given
   `useEffect`'s cleanup ordering and React 19 StrictMode's double-mount in development?
2. **`resolveProfileParts` and the route.** I changed `hasProfile` from `resolveProfile(at) !== null`
   to `renderProfile(parts) !== null`, and dropped a `Promise.all` that read the global profile
   twice. Are those two the same answer in **every** state, files store and postgres, including a
   slug that is not an article, a shelf read that throws, and whitespace-only stored values? The
   no-slug branch now goes through `renderProfile` where it used to be a bare `!== null`.
3. **`purpose` on `GET /api/reader`.** It is the reader's own words on a response that five hooks
   already fetch per page. Is there any path on which this reaches somebody who should not have it —
   the public/visitor projection, a shared article, the owner-isolation checks? Note
   `resolveProfileParts` calls `shelfStore.read(slug)` for **any** slug the caller names.
4. **The badge became a `<button>`.** It was a `<span tabIndex={0}>` inside a hover `Tooltip`. What
   did that change break — the reading view's own keyboard handling, tab order through a panel head,
   anything that queried `.prof-badge`, screen-reader semantics of a button whose accessible name
   differs from its visible text?
5. **`UseProfile` now always renders a wrapper `<span class="prof-row">`** where it used to return
   `null`. Three stylesheet rules moved from `.prof-use` to `.prof-row`
   (`.gloss-actions`, `.chat-composer`, `.review`). What did I miss — a selector, a `:has()`, a
   sibling combinator, a flex/gap assumption, an empty row now taking space where nothing rendered
   before? Check `styles.css` around every `.prof-use` and `.prof-badge` rule.
6. **The `slug` on the three owner interfaces.** It rides beside `hasProfile`. Is there any caller
   constructing one of those objects that I have not updated, any visitor arm that now needs a slug
   it does not have, any place where the object's slug could disagree with the article on screen
   after a navigation?
7. **The tests.** Which of the five would pass against a real bug of the kind it names? In
   particular: `open()` clicks and awaits one microtask — is that load-bearing or fragile? Does
   mocking the whole of `lib/api.js` hide anything real (`apiFetch` does a session `await` before it
   fetches)? Is dispatching `keydown` on `document` a fair stand-in for Escape?
8. **Anything the plan and I both missed.** Touch. The public shell. Two triggers. A panel open when
   its article unmounts. The `location.search` read inside `PanelBody` (not reactive).

Do not restate the code back to me. Where you agree, one line and move on.
