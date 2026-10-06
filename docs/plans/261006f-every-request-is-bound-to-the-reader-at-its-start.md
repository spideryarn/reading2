# Every request is bound to the reader at its start

Up: [plans.md](../project/plans.md)

Queue items `qi-x28as2f2` and `qi-59ycdavk`, 2026-10-06. Both are what
[the postmortem 261006g](../postmortems/261006g-work-made-for-one-reader-outlives-a-change-of-reader.md)
left open after the add page was fixed in
[261006e](261006e-add-page-forgets-everything-when-the-reader-changes.md).

## What this is for

One browser can hold two accounts. Another tab signs in as reader B while this tab, opened by
reader A, is still on screen; this tab's session becomes B's. Two things can then go wrong, and the
postmortem names them:

- **Owed.** A request A's page had begun, not yet sent, goes out with B's token.
- **Shown.** A's unsent words (a comment draft, a chat message being typed) stay on screen for B.

261006e closed both for the add page and gave `apiFetch` a third argument, `madeFor`, that a caller
may pass. About 115 call sites pass nothing. This plan closes the owed form for all of them in one
place, and then audits the reading view for both forms.

## Stage 1: `apiFetch` binds every request (`qi-x28as2f2`)

**The change.** `apiFetchOwned` reads, synchronously as it is called and before anything is awaited,
the reader this tab holds (`heldReader()` in `src/web/lib/session.ts`). A caller that names nobody is bound to that
reader. The existing check then does the rest: after the token lookup, if the token is known to be
another reader's, nothing is sent and the caller gets `NotThisReader`. The 401 retry uses the same
bound reader.

The rules, each with a test in `tests/api-fetch.test.ts` § *a request that names no reader*:

| At the call, the tab holds | The token that comes back is | Result |
|---|---|---|
| A | A's (a refreshed token included) | sent |
| A | B's | not sent, `NotThisReader`, logged `not-sent` |
| A | nobody's (signed out meanwhile) | sent with no token; the server answers 401 |
| A | a session that names nobody | sent (unknown is not another reader) |
| nobody (signed out, or the SDK has not spoken yet) | anybody's | sent, as before |
| B, with `madeFor` A passed | A's | sent: the name is believed over the tab |

**Why the tab's reader is the reader of the screen that made the call: there is one of it.**
`src/web/lib/session.ts` makes the only identity subscription to the SDK and holds the last
session it heard. `useSession` draws the screen from that, and `apiFetch` binds to it. On each
event it replaces what it holds, then empties the reader-keyed stores, then tells its subscribers,
and a subscriber that arrives late is told what is held, not what storage says.

The first version of this paragraph argued from order instead: `api.ts` subscribed to the SDK at
import, before any component, so its listener ran first. That was wrong. The SDK sends each new
subscriber its own `INITIAL_SESSION`, read from storage at that moment, so a `useSession` that
mounted after another tab had written B's session was told B while `api.ts` still held A, and B's
own request was refused. GPT Sol reproduced it against the installed SDK
([review](261006f-plan-review-sol.md), F1).

**A refusal moves the tab on.** When a token lookup answers as a different known reader from the
one held, `session.ts` adopts that session and tells its subscribers. The request that noticed is
still refused, since it was made for the earlier reader; the screen redraws for the reader the
token belongs to. A lookup's word never signs the tab out, and is ignored if an SDK event arrived
while the lookup was out.

**Why nobody is not bound.** A call made signed out and sent with the token of the reader who then
signed in carries nobody else's words and reads only that reader's data. Binding it would refuse
the first requests after every sign-in whenever the lookup beat the event.

**The refusal is logged** to the browser log buffer (`outcome: "not-sent"`, `error:
"NotThisReader"`), so a bug report shows it. To a caller it is one more failed request.

**What it does not cover**, by construction: a request *made* late. A timer, a retry loop or an
unmount flush calls `apiFetch` after the reader may already have changed, and the tab's reader at
that moment is B. Those still need `madeFor`. `leavingFetch` is always one of these.

**The simpler option passed over:** leave it as a rule in `auth.md` ("pass `madeFor` when you send
late"). That is what five earlier local fixes amounted to, and three features in a row on the add
page missed it.

**The retreat, and why it was not taken.** This adds a refusal on every request a reader makes.
The fallback decided beforehand was: if any ordinary request by a reader for themselves is found
to reach the throw, keep the log line, drop the throw for unnamed callers, and send. The review
met that condition (F1). The retreat would have reopened the hole the stage exists to close, so
the cause was removed instead: the screen and the fence now read one session. The retreat stands
for any further case found: a reader's own request refused while the screen shows that reader.

Docs: `auth.md` § *A request made for one reader is never sent as another* rewritten to match;
`security-map.md` gets the signpost and a row in its table; `web-client.md` one line.

## Stage 2: the reading view (`qi-59ycdavk`)

An Opus subagent audited everything `ArticlePage` mounts, read-only. Two things it found change
the shape of the work:

- **The reading view already unmounts when the reader changes.** `useArticleAccess`
  (`src/web/article/access.ts`) is keyed on `readerId` and answers `LOADING` in the very render
  where it changes, so `OwnedArticle` and everything under it goes. A comment draft or quiz answer
  held in component state is therefore already gone. `key={user.id}` on `ArticlePage` would close
  nothing.
- **That unmount is what sends A's words as B.** The tab's held session (`lib/session.ts`) becomes B's
  before React re-renders, so every write made from an effect cleanup is *made* under B, and stage
  1 cannot see it. These are the real leaks.

### What leaks, and what this stage does about each

**Owed: writes made as the view unmounts, sent with B's token.** Fixed by naming the reader the
view was mounted for (`madeFor`), taken from the render that set the cleanup up.

| Write | Where | What B gets |
|---|---|---|
| *About me* | `leaveProfile`, from `ProfilePanel` | **A's profile text overwrites B's.** Needs no shared slug; the worst one |
| Purpose | `leavePurpose`, from `PurposePrompt`, `ProfilePanel`, `Metadata` | A's purpose on B's article of the same slug |
| A draft comment | `AnnotateDialog`'s cleanup, `useComments` § create and `createOnLeave` | A's comment on B's article of the same slug |
| Reading time | `useReadingTime`'s unmount and `pagehide` flushes | A's seconds counted for B |

**Shown: module-level stores keyed by slug, which outlive the unmount.** Fixed by one mechanism:
the stores are emptied when a known reader is replaced by anybody else, sign-out included, by
`lib/session.ts` before it tells any subscriber, so it has happened before React draws anything
for B.

| Store | What B saw |
|---|---|
| `chat-draft.ts` | A's unsent chat and Learn words in B's box, on the same slug |
| `search-draft.ts` | A's typed search words |
| `link-facts.ts` (`shelf`, summaries) | "on your shelf" from A's library; summaries written from A's profile |

**The Feedback dialog** (`FeedbackHost`, above `ArticlePage` and unkeyed): a half-written report
of A's may stay open for B. To be confirmed by a test and, if so, keyed on the reader.

**Found by the review, outside the reading view's unmount**, and fixed in this stage:

| Leak | Fix |
|---|---|
| `/profile` is not under the article's gate: A's *About you* stayed in the box for B, and its next save went to `/api/reader` as B | `ProfilePage` is keyed on the reader in `App.tsx`; its saves name the reader it was mounted for |
| A spoken exchange is retried after a gap (`appendSpoken` in `chat/effects.ts`), and a first exchange creates its thread, so A's transcript could be stored for B | every attempt names one reader: the band's, or the tab's as the call is made. A refusal ends the loop as a plain failure |
| A, then signed out, then B: the stores survived the signed-out moment | they are emptied on departure from a known reader, not on arrival of the next |

### Not done here, and reported

- **The live meter's flush on stop** (`live/meter.ts`): unfenced on the client. The server checks
  that the session is the caller's, so B is not charged for A; its post is injected, so a fence
  is more than a line. Left.
- **`spya.lastView.<slug>` and the thorough-search pair in browser storage** carry no reader id.
  B is restored to A's view position. No words are shown. Low; reported.

### The simpler option passed over

Reload the page when the reader changes (sign-out already does: `AccountSection.tsx`). It would
empty every module store at once. It does not help the owed writes, because the reload's `pagehide`
flushes are the same writes, and it throws away B's place on a page that is otherwise fine. The
fences are needed either way, so the reload adds nothing they do not.

## Done looks like

- Stage 1: the new tests seen red, then green; `npm test`, `npm run typecheck`; GPT Sol's
  security-focused code review.
- Stage 2: each leak found has a test seen red first; a browser check at desktop, iPad and phone
  widths.

## What happened

- 2026-10-06, stage 1: four of the eleven new tests were red before the change (the three refusals
  and the log line) and all eleven are green after it. The other seven pin what must still be sent.
- 2026-10-06, stage 2, the owed writes: one hook, `useMadeFor` (`src/web/lib/made-for.ts`), reads
  the reader from a context `App` provides and keeps the one a component was *mounted* with. The
  profile panel, the first-open purpose prompt, the metadata page, `useComments` (create and
  `createOnLeave`) and `useReadingTime` (both flushes) pass it. `saveProfile`, `leaveProfile` and
  `fetchOk` gained the `madeFor` argument. Six cases in
  `tests/reading-view-owed-writes-on-reader-change.test.tsx`, each red first against the real
  `api.ts`: a write left carrying B's token.
- The same stage, the stores: `src/web/lib/reader-change.ts`, called as the tab's session changes.
  `chat-draft.ts`, `search-draft.ts` and `link-facts.ts` (the shelf and the summaries) register a
  forget. The shelf also needed a fence: a read sent with A's token and answered after the change
  installed A's shelf for B. `jobEngine.epoch()` was looked at and not reused: it moves in a layout
  effect, after the render that first sees B. `tests/reader-change-empties-the-stores.test.tsx`.
- The same stage, the Feedback dialog: confirmed by test. The draft, a pending prefill and the open
  box all stayed for B. `FeedbackHost` now takes `readerId` and keys the dialog on it; keying the
  host itself would have remounted every page. `tests/feedback-dialog.test.tsx` § *a half-written
  report, when the tab's reader changes*.
- **Found, wider than the table above.** `/profile` (`useProfile`) is not under the article's gate,
  so it stayed mounted across the change with A's *About you* in the box, and its idle save would
  have written that as B. The write is refused, and after the review the page is keyed on the
  reader, so the words go too.
- 2026-10-06, after GPT Sol's review refused (six findings, [the review](261006f-plan-review-sol.md)):
  - **F1, one session.** `src/web/lib/session.ts` is now the only identity subscription.
    `api.ts`, `useSession` and the experimental-features store read it; `url-session-kind.ts`
    keeps its own, because it needs the event's name and gives no reader to a screen.
    `tests/session-one-snapshot.test.tsx` models the SDK's per-subscriber first answer and was
    red on stage 1 as built: the screen was B's and its request came back `NotThisReader`. The
    convergence cases are in `tests/api-fetch.test.ts`.
  - **F2, the spoken retry.** `tests/chat-spoken-reader-change.test.ts`, red first: two requests
    went out with B's token.
  - **F3, `/profile`.** `tests/profile-page-reader-change.test.tsx` renders the whole `App`, red
    first. It is also the one check that `App` provides the reader late writes are named for:
    with the provider's value taken out, the unmount save goes out as B and the test fails.
  - **F4 and F5** were already built; each now has a test by name in
    `tests/reader-change-empties-the-stores.test.tsx`, and the shelf's failed state is reset too.
- **Not checked in a browser yet**: the stage's *done* asks for desktop, iPad and phone widths.
  - **Tests adapted for the one subscription: four.** `use-session.test.ts` (its harness was the
    hook's own SDK listener), `add-page-reader-change.test.tsx` (it cleared the SDK's listeners
    between cases, which now removes the only one), `the-enter-key-really-sends.test.tsx` (its SDK
    stand-in had no `onAuthStateChange`, and the experimental-features store now reaches
    `session.ts` at import) and `eager-client-graph.test.ts` (two new modules every reader
    downloads, each a decision recorded there). `resetSessionForTests` exists for the first two.
