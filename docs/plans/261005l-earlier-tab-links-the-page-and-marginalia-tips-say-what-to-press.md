# The Earlier tab links the page, and a Marginalia card says what to press

Up: [plans.md](../project/plans.md)

Two small reports from Greg, both filed on 2026-10-05 from the Feedback button.

## The reports

`spya-xf6m2u`, a problem:

> I'm looking at a citation in the Marginalia, and the tooltip says to "press it" but I don't see anything to press.

`spya-tqk7au`, a suggestion:

> In Feedback / Earlier:
> - It now shows the url where the suggestion was made. Make it a link.
> - And it should only show suggestions made by the current user, not by other people.

## First: can one reader see another's reports? No

Checked before anything else, because it would have been a privacy bug.

- `GET /api/feedback` calls `feedbackStore.listMine` and nothing else (`src/routes.ts`).
- `listMine` filters both of its statements on `owner_id = currentOwnerId()`
  (`src/store/pg-feedback.ts`). There is no admin branch: an admin gets the same query.
- `currentOwnerId()` is the signed-in account inside a request, and throws rather than falling
  back when the gate has not filled it (`src/owner.ts`).
- `tests/feedback-store.test.ts` already files reports as two owners and checks each lists only
  their own, with and without the shipped filter.

So the list already holds only the current reader's reports, for an admin as for anyone. Nothing to
build for that line. The code cannot say what Greg saw on the day: if a row looked like somebody
else's, the query says it is stored under his account, and which row it was is a question for him,
asked in the debrief.

## Stage 1: the page is a link

Each row says *on /read/some-slug*. That text becomes a link to the same path.

- The label is already the path of a page this app has, made on the server
  (`src/feedback-page.ts`): no origin, no query string, no fragment. It is used as the `href` as it
  is. No server change, no change to what is sent.
- The client's validator (`isEarlierFeedbackPage`) gets stricter: a `page` must start with one `/`,
  not be followed by a second slash or a backslash, and hold no backslash, whitespace or control
  character anywhere (a browser drops a tab or a newline before resolving, so `/<tab>/host` is
  another site). The server only ever sends such a path, so this refuses nothing real; it means a
  wrong value can never become a link to another site.
- An ordinary link, opening in the same tab. The dialog goes away with the page.

**What it gives up:** the link goes to the article, not to the paragraph and mode Greg was in. The
stored address has those (`?mode=…&at=spya-…`), and it is held back on purpose because a query
string can also carry search terms. Passing only `at=` through would be safe and is a small server
change; it is left as a question for Greg rather than built.

## Stage 2: the card says what to press

The citation line in Marginalia is itself a button: pressing it opens the work's by-line and its
reference entry underneath. But it is drawn as plain text with a small faint chevron hanging in the
gap, and the card says "Press it" without saying what "it" is. Two more things in the card are
out of date: since 261003j the open half no longer shows why the work is cited, and the card still
promises that.

- **Words** (`src/web/marginalia/tips.ts`): the three cards that say "Press it" (FAQ, Timeline,
  Cites) say "Press this line" instead, and the citation card promises what actually opens: who
  wrote the work and the article's reference entry for it. Its second paragraph stops mentioning
  the AI-written reason.
- **Looks** (`src/web/styles/marginalia.css`): the chevron is a shade darker at rest, and on hover
  or keyboard focus the line's words are underlined and the chevron darkens again, so the thing the
  card is talking about answers the pointer.

Passed over: a visible "Open" button on every line. It would say it plainly, but dozens of them
down the column is the clutter the shut lines were made to avoid.

## GPT Sol's plan review

Read-only, 2026-10-05. Four findings, verdict *revise URL validation and card promises before
building; owner isolation already holds*.

1. **Owner isolation holds** (P2). It found no path for another owner's report. It also said the
   plan claimed more than the code proves about what Greg saw; that sentence is reworded above.
2. **The first client check was too weak** (P2): one slash and not two still lets `/\host` and
   `/<tab>/host` through. Taken, as a character rule rather than its `new URL` comparison, because
   the rule has no dependence on `location`; tests cover backslash, tab and newline.
3. **The citation card still overpromised** (P1): a work with no authors and no entry opens to its
   title alone. Taken: the card now says "what the article gives for the work".
   It also noted that the Timeline card's "never guessed" sits badly beside "(year assumed)". True,
   and not part of either report; reported to the Overseer rather than changed here.
4. **Keep it small** (P2). Agreed; nothing added.

## Tests

- `tests/feedback-dialog.test.tsx`: the page is an `<a>` with the label as its `href`; a `page`
  that is not a single-slash path fails the whole answer. Red first.
- `tests/marginalia-note-cards.test.tsx`: no card says "Press it"; a card that tells the reader to
  press says "this line"; the citation card does not promise a reason. Red first.

## Docs

`feedback.md` § the Earlier tab (the label is now a link), `marginalia.md` if it describes the
card's words.
