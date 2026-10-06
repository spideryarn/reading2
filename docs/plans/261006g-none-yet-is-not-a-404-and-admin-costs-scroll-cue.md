# "None yet" is not a 404, and a sideways-scroll cue on /admin/costs

Two small, unrelated queue items handed over by the Overseer on 2026-10-06 (`qi-gwwtz6v7`,
`qi-gwdj4gyj`). One commit each. Owner: the session in worktree
`qi-none-yet-404-and-costs-scroll-cue`. Indexed under [plans.md](../project/plans.md) by file name.

## Stage 1 — `qi-gwwtz6v7`: an ordinary page load leaves no 404 in the console

### What is wrong

Three reads are mounted on every owner's article view, whichever mode is open:
`useCrossrefs` (prose underlines), `useCitationsRead` and `useQuizRead`
(`src/web/article/ArticlePage.tsx`). For most articles none of the three artefacts has been made,
and the store says so by throwing a 404 (`src/store/pg.ts` § `loadQuiz`, `loadCrossrefs`,
`loadCitations`). The clients already read that 404 as "none yet", so nothing is broken for the
reader — but a browser prints a red console error for every 4xx, so every ordinary load shows three
failures that are not failures, and a real one is harder to see among them.

### The change

A "none yet" read of these three routes answers **200 with a JSON `null` body** to a client that
asks for it, and the three clients ask and read `null` as "none yet".

- **Server.** The three store loaders throw one typed error for "this article exists and this
  artefact has not been made" (`CitationsListNotFound` is already that for citations; chat catches
  it by class, so it stays or becomes a subclass — builder's call, smallest diff). It still carries
  `status: 404`, so every other caller (chat tools, jobs, Investigate) is unchanged. One helper in
  `src/routes.ts` wraps the three GET handlers: if the request carries the opt-in header and the
  loader threw that typed error, send `200 null`; anything else propagates as today. **"No such
  article" stays a 404** — it is a different fact and the helper must not swallow it.
- **Client.** The three hooks send the header and treat a `null` body as their existing "none"
  branch. They keep the `404` branch too, so a new client against an old server (the minutes of a
  deploy) still works.
- **Offline cache: a `null` from these three is not saved.** The offline cache keys on reader and
  URL only (`src/web/lib/offline-store.ts`) and replays whatever it holds as a 200 whatever the
  request's headers, so a `null` saved by a new tab would be replayed to an old tab offline and put
  back the very error the header exists to prevent (Sol F1). A 404 was never saved either, so this
  keeps today's offline behaviour exactly. A test pins that the `null` is not written.
- **`Cache-Control: private, no-store`** on these three responses, the legacy 404 for a missing
  artefact included, so no HTTP cache holds a response that depends on a header it was not told
  about (Sol F4).

### Why an opt-in header, and the simpler option passed over

The simpler version is to answer `200 null` to everyone. It was passed over because of tabs left
open across the deploy: the old `useQuizRead` and `useCitationsRead` do `loaded.quiz.…` /
`loaded.citations` on the parsed body, so a `null` there throws and the band shows an **error**
where it used to show its "Write the questions" button — and "none yet" is the commonest state for
both. That trades console noise no reader sees for an error a reader does see. There is no
client-version boundary to lean on (`src/routes.ts` § `withOldClientBands` is kept for the same
reason). A request header rather than a query parameter, because the offline cache and several
tests match these URLs with patterns that end at the slug.

Cost named: one header name and one branch that outlive the old tabs. It can be deleted, making
`200 null` unconditional, once a client-version boundary exists.

**Scope: these three routes only.** About fifteen other artefact routes use the same 404-means-none
convention (`useIdeas`, `useFaq`, `useTimeline`, …). They are read only when their mode is opened,
so they are not on "ordinary page loads", and they are left alone here. The helper and the typed
error are written so that moving another route over is two lines; whether to do all of them is a
question for the debrief, not this stage.

### The Quiz count (the "also low")

Quiz's (i) card says "12 questions" while the band, under the *Only what I've read* filter, says
"Question 1 of 5". Both are true and neither says what it counts. Make each say it: the card's
count is the whole batch; the band's "of N" is the questions left in after the filter, and when the
filter hides some, the band says so in words (for instance "Question 1 of 5 from what you've
read · 12 in all" — builder picks the wording after reading `QuizPanel.tsx`, which already computes
`hiddenCount`). The panel's existing hidden-count sentence is drawn only while the list is open
(`{listing && …}`) and "Question N of M" shows with it closed, so the explanation has to show
whenever `hiddenCount > 0`: move the existing sentence beside the count rather than adding a second
(Sol F3). Plain words, no new state.

### Done looks like

- A failing test first for each of: the three routes answering `200 null` with the header for a
  made-less article; still 404 without the header; still 404 for an unknown slug with the header;
  each hook reading `null` as none; the `null` not being written to the offline cache; the quiz wording.
- `npm test` on the touched files, `npm run typecheck`, lint on touched files.
- Browser: an owner's article with none of the three artefacts loads with no 4xx in the network
  log or console, at desktop, iPad and phone widths; Quiz and Citations bands still offer their
  buttons; an article that has them still shows them.
- Docs: wherever a project doc states "404 means none yet" for these three routes is brought up to
  date.

## Stage 2 — `qi-gwdj4gyj`: /admin/costs tables say when they scroll sideways

At 390px the Failures and retries columns start off-screen inside each table's own scroll box
(`src/web/AdminCostsPage.tsx`: the pivot's box, `SCROLL_BOX` used by `FailureCountsTable` and the
causes table, and whatever box the shared `DataTable` draws for `Ranking`), and nothing shows there
is more to the right.

**The change:** one small component for the page's scroll boxes that draws a fade on the right
edge while there is content hidden to the right, and on the left while there is content hidden to
the left. The fade is not part of the scrolled content, so it sits on a non-scrolling wrapper
around the `overflow-x-auto` box; whether there is hidden content is measured
(`scrollWidth - clientWidth - scrollLeft`) on mount, on scroll, when the box changes size **and
when the table inside it changes size** — the pivot's columns change with *then by* while the box
stays the same width, so both the box and the inner table are observed (Sol F2). The fades paint
above the sticky label cells, which are `z-10`. It is decoration: `aria-hidden`,
`pointer-events: none`, and colours from the existing tokens so it works in both themes. Every
scroll box on the page uses it.

**Simpler option passed over:** a CSS-only "scroll shadow" (`background-attachment: local`). It
paints *behind* the cells, and the pivot's cells and the sticky label column have their own
backgrounds, so it would be invisible exactly where it is needed. A literal "scroll →" label was
also passed over: it needs the same measurement to know when to hide, and takes a line of height on
every table.

**`DataTable` is shared with the shelf and the users table.** If its scroll box is inside
`DataTable` (it is: `src/web/lib/DataTable.tsx`), the cue reaches `Ranking` by an opt-in prop that
uses that real scroll box — a wrapper outside it would measure the wrong element (Sol) — and the
shelf, which readers see, does not change in this stage.

### Done looks like

- A failing test first: the component marks "more to the right" when content overflows and not when
  it fits, and clears it at the end of the scroll; the costs page's tables are all inside it.
- `npm test` on touched files, typecheck, lint.
- Browser on `/admin/costs` at 390px, iPad and desktop: the fade is there when columns are hidden,
  goes when scrolled to the end, and is absent at desktop where everything fits; both themes.
- `docs/project/admin-costs.md` gets a sentence.

## Reviews

GPT Sol on this plan before building (read-only), and on each stage's code after (write-capable).

**Plan review, 2026-10-06** — [the answer](261006g-none-yet-plan-review-sol.md), of commit
`82e72480f`. Verdict: build it after the P1. All four findings accepted and folded in above: F1
(P1, a cached `null` reaches tabs that never opted in — the plan's first version asked for the
`null` to be cached and replayed, which was wrong), F2 (remeasure when the table's content changes),
F3 (the hidden-count sentence is conditional on the open list), F4 (`no-store`). It confirmed the
old-tab argument for the header and found no other caller of the three GETs.
