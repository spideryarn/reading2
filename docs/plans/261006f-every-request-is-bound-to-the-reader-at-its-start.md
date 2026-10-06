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
the reader this tab holds (`cachedTokenOwner`, which the auth listener at the bottom of
`src/web/lib/api.ts` writes on every auth event). A caller that names nobody is bound to that
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

**Why the tab's reader cannot be behind the screen that made the call.** `useSession` gets the user
from the same `onAuthStateChange` events, and `api.ts` subscribes when the module is first
imported, before any component mounts, so its listener runs first. By the time React draws a screen
for B, `cachedTokenOwner` is B.

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

**The retreat, decided now.** This adds a refusal on every request a reader makes. If any ordinary
request by a reader for themselves is found to reach the throw (a path where the tab's reader is
stale while the token is right), the fallback is: keep the log line, drop the throw for unnamed
callers, and send. That would be recorded here as *documented, not closed*.

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
- **That unmount is what sends A's words as B.** The auth listener in `api.ts` hears about B
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
the stores are emptied when the tab's reader changes from one known reader to another, called from
the auth listener, so it has happened before React draws anything for B.

| Store | What B saw |
|---|---|
| `chat-draft.ts` | A's unsent chat and Learn words in B's box, on the same slug |
| `search-draft.ts` | A's typed search words |
| `link-facts.ts` (`shelf`, summaries) | "on your shelf" from A's library; summaries written from A's profile |

**The Feedback dialog** (`FeedbackHost`, above `ArticlePage` and unkeyed): a half-written report
of A's may stay open for B. To be confirmed by a test and, if so, keyed on the reader.

### Not done here, and reported

- **A spoken turn retried after a gap** (`chat/effects.ts`) and **the live meter's flush on stop**
  (`live/meter.ts`): suspected only, and both carry A's thread id, which B's token should not
  open. Reported to the Overseer rather than fixed on a guess.
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
