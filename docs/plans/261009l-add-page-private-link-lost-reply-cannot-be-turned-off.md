# A private link whose create reply was lost can now be turned off from the Add page

The bug part of queue item `qi-krppt8r9`, found in GPT Sol's plan review of
[261009i](261009i-add-page-sharing-clearer.md) (§ the P2 *a private link whose create reply was
lost cannot be turned off from this page*) and deferred there as older than that plan. Fixed under
Greg's standing rule:

> You are definitely authorised to fix bugs any time you notice them
>
> — Greg, 2026-10-09

The rest of `qi-krppt8r9` (the shared confirmation panel, the two privacy sentences, the tick-box
and help text) waits for Greg and is not touched here.

Up: [public-readable-sharing.md § While the article is still importing](../project/public-readable-sharing.md#while-the-article-is-still-importing)

## The bug

On the Add page, *Create the link* sends `POST /api/article/:slug/share-link`. If the reply does not
come back (a network drop, a `5xx`, a `200` that cannot be read), the link may or may not exist.
The controller (`src/web/add-share-link.ts`, `LinkAtAdd`) goes to `unknown` and, on purpose, sends
nothing by itself, because a second create would make a second key and turn off the first.

What `unknown` offers is *Check again*, a read. If the read succeeds, a link that is on is drawn
with *Turn off*. But `turnOff()` refuses `unknown`, so **while the reads keep failing, a link that
may be live cannot be turned off from the page that made it**. The reader can only wait for the
network to come back or go to the Metadata card. GPT Sol, 261009i plan review:

> If reads keep failing, a live private link cannot be disabled here. Add an idempotent "Turn off
> any private link" action from `unknown`, or explicitly narrow the requirement to public sharing.

The same holds after a lost **turn-off** reply, which also lands in `unknown`.

## The fix

**`turnOff()` is allowed from `unknown`**, and `AddShareLink.tsx` draws *Turn off* beside *Check
again* there. This is safe because the server's turn-off is idempotent
(`src/store/pg-share-link.ts` § `turnOff`): off already answers `{ on: false }` and writes nothing.

From `unknown` the answers mean:

| Answer to the `DELETE` | State | Why |
|---|---|---|
| `200 { on: false }` | `off` | What the server says now. |
| `404` | `off` | The turn-off's only 404 is that the reader owns no row at this slug (`ownedSlug`; signed out is a 401, before routing), and the key lives on the row, so there is no link. **From every state**, `on` included: a key on screen that opens nothing is not worth drawing (GPT Sol's plan review). |
| no answer, `5xx`, unreadable `200` | `unknown` | As every write already does. |
| any other `4xx` | `unknown` | A refusal wrote nothing, so what was unknown still is. `refused` with `link: null` would offer *Create a private link* over a link that may be on. |

The `unknown` sentence (`LINK_AT_ADD_UNKNOWN`, `src/messages.ts`) gains the new way out. This is
reader-facing wording, not a privacy sentence: it says what the buttons do and changes no promise.

## What was passed over

- **Re-reading automatically when the reply is lost.** The brief suggested it as one way. The page
  already re-reads on every return (`resume` → `ask` → `reconcile`), and *Check again* is the read on
  demand. An automatic read at the moment the reply is lost is the moment most likely to race a
  create the server is still processing: it would answer *off* and draw *Create a private link*,
  while the create then lands. That is this bug's own class (a link on that the page does not
  show), so it is not added. A read the reader presses for is later and rarer.
- **A create with `keepExisting`.** The `POST` takes it, and it would make a retried create
  idempotent, but resending a create on the reader's behalf is the thing the controller refuses to
  do, and turning the link off is the safe direction.

## The race that remains

A turn-off sent while a lost create is still in flight on the server can land first. The page then
says *off* and the create's key is on. The same is true of any read taken then: *Check again*, or a
return to the page, can answer *off* ahead of the create. No client can close this; it would take
the server ordering a create against a later turn-off (a cancellation recorded against the create),
and it needs a create whose reply was lost *and* still running when the reader presses. Accepted,
named here, and the sentence on screen does not promise more: *Check again to see, or turn it off*,
not *to be sure there is no link* (GPT Sol's plan review).

## Reviews

- **Plan**, GPT Sol, read-only:
  [261009l-…-plan-review-sol.md](261009l-add-page-private-link-lost-reply-plan-review-sol.md).
  BUILD WITH CHANGES, no P1. Taken: a turn-off's 404 is *off* from every state; the sentence no
  longer promises certainty; tests for the reattachment read overlapping the turn-off, the published
  hand-off, a 401 and both buttons together; `public-readable-sharing.md` updated. It agreed with
  passing over the automatic re-read.
- **Code**, GPT Sol, fixing inside the stage:
  [261009l-…-code-review-sol.md](261009l-add-page-private-link-lost-reply-code-review-sol.md).
  SHIP AFTER MY FIXES, no P1. It gave *Turn off* in `unknown` its own tooltip
  (`LINK_AT_ADD_UNKNOWN_STOP_TIP`), which names the race rather than promising the link stops
  (reworded afterwards in plainer words), made the tests assert the `DELETE` was sent, and covered
  a refused turn-off from `unknown` because of a failed read.
- **Browser**, a Sonnet subagent, Chrome at 1280 and WebKit iPhone 13: with the create and the reads
  aborted, both buttons show side by side with no overflow, *Check again* stays unknown, and *Turn
  off* sends one `DELETE` and the section offers *Create a private link* again. Pass at both widths.

## Tests

`tests/add-share-link.test.ts`, red first:

- from `unknown` after a lost create, with the reads failing, *Turn off* sends one `DELETE` and lands
  in `off`; no create is sent;
- the same from `unknown` after a lost turn-off;
- a `404` answer from `unknown` is `off`;
- a `5xx` or no answer from `unknown` is `unknown` again;
- a `4xx` refusal from `unknown` is `unknown`, not `refused`;
- *Turn off* pressed while *Check again*'s read is out: the read's late answer does not overwrite the
  turn-off's.

`tests/add-share-view.test.tsx` (if it draws `unknown`): the button is there.

Browser check by a Sonnet subagent at desktop and phone widths, with the create's reply cut off.
