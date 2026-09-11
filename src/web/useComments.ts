/**
 * The client half of comments — see docs/project/comments.md.
 *
 * **Closed to new arrivals since 2026-08-26.** Selecting text used to create a
 * comment here and spend a model call on the spot; it now opens a conversation
 * instead — docs/plans/260826ab-chat-as-gateway.md. So this hook reads the explanations
 * a reader already has, and offers the two ways to ask one again: `retry` for a
 * model call that failed, `deepen` for an answer they have read and judged thin.
 *
 * That is why there is no longer an `ask`, and why the id is no longer minted
 * here: both re-ask paths send an id the server already knows, and the server
 * refuses one it does not. The rule lives there rather than here, because
 * deleting a function closes the React path and nothing else.
 *
 * The POST is also the answer: it streams, and the terminal frame carries the
 * finished comment, so there is nothing to poll.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockId, Comment } from "../types.js";
import { readEvents, StreamStalled, STREAM_STALL_MS } from "./lib/sse.js";
import { wentQuiet } from "../messages.js";
import { apiFetch, failure, fetchOk, readJson } from "./lib/api.js";
import { openingRead } from "./lib/opening-read.js";
import type { Mark } from "./PlaceOnCriterion.js";

/**
 * What to say when the request never reached the server.
 *
 * `fetch` rejects with a bare `TypeError: Failed to fetch` for every
 * transport-level failure — server down, connection reset, request cut off
 * mid-flight — and that message tells a reader nothing they can act on. It is
 * also the failure they are most likely to hit: an explain call takes 15-25
 * seconds, and `npm run dev` restarts whenever vite.config.ts changes, so the
 * window for a request to be orphaned is wide. Greg hit exactly this on
 * 2026-08-25, with the dev server simply not running.
 *
 * The original text is kept in parentheses so the message is still searchable.
 */
export function describeFetchFailure(error: Error): string {
  /* A stream that stopped delivering bytes. `StreamStalled`'s own message is
     written for whoever is reading a stack trace — "the stream sent nothing for
     60s" — and `wentQuiet` is the same fact said to a reader, with the bracketed
     code every other failure here carries. Handled in the one function all three
     hooks describe their failures through, rather than at each of the three
     `catch` blocks, because a raw class message reaching a reader is exactly the
     kind of thing that only shows up when the failure does. */
  if (error instanceof StreamStalled) return wentQuiet(error.seconds).message;
  // A TypeError from fetch means the request never got a response at all; an
  // Error we threw ourselves already carries a real message from the server.
  return error instanceof TypeError
    ? `Couldn't reach the dev server — is \`npm run dev\` still running? (${error.message})`
    : error.message;
}

/**
 * A stored comment, plus what only this tab knows about it.
 *
 * `replacing` marks the one state the stored shape cannot express: a `pending`
 * row whose `answer` is the *previous* answer, kept on screen while a deeper
 * search is running. Without it the panel cannot tell that from an answer
 * arriving a few words at a time — both are `pending` with text — and would put
 * a typing cursor on the end of an answer that finished five minutes ago.
 *
 * It is never sent and never stored. `pgCommentStore.create` builds its row
 * from named fields (src/store/pg-comments.ts), so there is nowhere for it to
 * leak to even if it were sent.
 */
export interface ClientComment extends Comment {
  replacing?: true;
}

/** What a selection knows about the passage it is marking. */
export interface NewCommentInput {
  blockId: BlockId;
  quote: string;
  start: number;
  /** The reader's words, or nothing at all for a bare bookmark. */
  body?: string;
  /**
   * The id for this Save, minted **once per draft** by whoever opened the box.
   *
   * It is the idempotency key, and minting it here per call would defeat the
   * whole point: a reader whose first Save got a response we never saw would
   * press Save again and store a *second* comment on the same words, because
   * the server's same-id rule would have nothing to match. GPT Sol, reviewing
   * the built code, 2026-08-28.
   */
  id: string;
  /**
   * **The referee's own placement of this passage**, if they made one.
   *
   * Absent on every ordinary reading note, which is nearly all of them. Both
   * fields go over the wire only when they are really there: a `valence: 0`
   * sent because a `Mark` had a null in it would be a fabricated *"counts
   * neither way"* — a judgement the referee did not make — and nothing would
   * error. See `create` below for the check that keeps `0` and *nothing* apart.
   */
  mark?: Mark;
}

export interface CommentsApi {
  comments: ClientComment[];
  /**
   * Has the first fetch come back?
   *
   * **`comments` is `[]` both before we have asked and after the answer was
   * "none", and the drawer cannot tell those apart without this.** It said
   * "Nothing asked yet." for the length of the request, to readers who had
   * asked plenty — Greg hit the same thing in chat mode on a slow connection,
   * 2026-08-27, and the sibling flag is `ChatApi.loaded`.
   *
   * It means *we have asked*, not *it worked*: a failed fetch sets it too, so
   * the drawer stops claiming to be waiting. Which is why it is not enough on
   * its own — see `loadFailed`.
   * docs/project/web-client.md § Empty is not the same as not asked yet.
   *
   * **`AnnotateDialog` waits for it before it saves** (2026-09-11): the GET's
   * answer replaces the list, so a comment created while it was out vanished
   * from the tab when it landed —
   * docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md. "Has
   * come back, either way" is the right thing to wait on: a failed read has no
   * snapshot left to erase anything with, and one that never answers is given
   * up on at a deadline (src/web/lib/opening-read.ts).
   */
  loaded: boolean;
  /**
   * Did that fetch fail?
   *
   * **The second half of the same bug, and the half the first fix missed.**
   * `loaded` alone turns "the server did not answer" into "you have asked
   * nothing" the moment the request gives up — the identical false claim, one
   * beat later. GPT Sol, reviewing the first fix, 2026-08-27.
   *
   * Not `error !== null`, which is a different question. `error` carries any
   * transport failure, including a retry or a delete that failed long after the
   * list arrived, and it is cleared when one succeeds. This one is about the
   * one fetch that fills the list, and nothing else ever sets it.
   */
  loadFailed: boolean;
  /* **No `ask`.** Selecting text used to create a comment and spend a model
     call on the spot; since 2026-08-26 it opens a conversation instead
     (docs/plans/260826ab-chat-as-gateway.md), so nothing creates a new explanation and
     this hook is a reader of old ones plus the two ways to re-ask them.

     The rule is not enforced here. `POST /api/comments/:slug` refuses an id it
     has not already stored, because deleting a function closes the React path
     and nothing else — a stale tab in another window would still have bought
     one. See `answer` in src/routes.ts. */
  /**
   * Make a **free** comment — the reader's mark on a passage. No model call.
   *
   * Optimistic: the row goes in with the id we minted and the mark appears at
   * once, because the whole point of a bookmark is that it costs nothing and
   * happens immediately. Resolves to the stored comment, or `null` if the
   * server refused — the caller needs to know before it opens a chat about it.
   */
  create(input: NewCommentInput): Promise<Comment | null>;
  /** Change the reader's words, or clear them back to a bare bookmark. */
  edit(id: string, body: string | null): Promise<void>;
  /**
   * **Change the referee's placement on a comment that already exists**, or
   * clear it with both fields `null`.
   *
   * Its own operation and its own route, for the reason
   * docs/project/comments.md gives about all five: `PATCH …/:id` takes
   * `{ body }`, and folding the placement into it would put partial-update
   * semantics on the wire — absent means *leave alone*, `null` means *clear* —
   * one missing branch away from a plain body edit silently deleting a
   * judgement. A named path cannot express the ambiguity.
   */
  place(id: string, mark: Mark): Promise<void>;
  /**
   * Remember locally that this comment started that conversation.
   *
   * **Not a request.** The link is written server-side from inside the chat
   * stream; this only keeps the browser in step so the mark and the dialog are
   * right before the next reload.
   */
  noteThread(id: string, threadId: string): void;
  /** Ask the same question again — for a comment whose model call failed. */
  retry(id: string): void;
  /**
   * Ask again, and search properly this time — for an answer the reader has
   * read and judged thin. Replaces the answer in place.
   */
  deepen(id: string): void;
  remove(id: string): void;
  /** A failure of the *transport*, not of the model. Model failures live on the comment. */
  error: string | null;
}

/**
 * A placement as a **request body** carries it: present, or absent — never
 * `null`.
 *
 * The wire has two shapes for this and they are not interchangeable. `POST`
 * takes the fields as optional, so absent means *there is no placement*; the
 * `mark` route takes both always, so `null` means *clear the one that is
 * there*. This turns the second into the first.
 *
 * Two traps, both of which would fail silently:
 *
 * - **`valence !== null`, never truthiness.** `0` is a real placement meaning
 *   "counts neither way", and it is the commonest of the five. A `mark.valence
 *   && …` here would drop exactly that answer and store a review comment with
 *   no number under it.
 * - **A valence with no criterion is dropped whole**, rather than sent for the
 *   server to refuse. It is not reachable from the instrument — the five
 *   buttons only exist once a criterion is chosen — and a number against
 *   nothing is not a thing to ask about.
 */
function markFields(mark: Mark | undefined): { criterionId?: string; valence?: number } {
  if (!mark || mark.criterionId === null) return {};
  return {
    criterionId: mark.criterionId,
    ...(mark.valence !== null ? { valence: mark.valence } : {}),
  };
}

export function useComments(slug: string): CommentsApi {
  const [comments, setComments] = useState<ClientComment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Ids the reader has deleted while their answer was still in the air.
   *
   * A POST takes 15-25 seconds and the reader is free to do anything at all
   * while it is out. Deleting during that window used to bring the comment
   * *back* when the answer landed: the response is the whole comment, and
   * storing it re-added a row the reader had already removed, mark and all.
   * This tombstone is what makes the delete win.
   *
   * A ref, not state: nothing renders from it, and a stale closure here would
   * defeat the entire point.
   */
  const deleted = useRef(new Set<string>());

  /**
   * The last PATCH in flight for each comment, so a second one waits for it.
   *
   * The same ref `useCriteria.recolour` and `useSearch` keep, for the same
   * reason and deliberately not a third invention of it. Here it is doing two
   * jobs at once, and the second is the one that is easy to miss:
   *
   * 1. **Two placements cannot land out of order.** Every click used to launch
   *    its own PATCH, and two independent requests may reach the server in
   *    either order — so the *first* click could be what ends up in Postgres,
   *    with the browser showing whichever answer arrived last. A referee who
   *    corrects themselves would be stored as having said the thing they
   *    corrected.
   * 2. **A late answer cannot restore a field the reader has since changed.**
   *    Both PATCHes answer with the *whole* comment and both replace the whole
   *    stored row (see `edit`), so a body answer that crosses a mark answer on
   *    the wire puts the old mark back on screen, and the other way round. They
   *    touch disjoint columns on the server, so nothing is lost on disk — but
   *    the screen disagrees with it until the next reload, which is the shape
   *    docs/reusable/silent-success.md is about.
   *
   * Only the two PATCHes queue here. `send` streams for 15-25 seconds and
   * putting an edit behind it would freeze the reader's own note for the length
   * of a model call; `forget` is a DELETE the tombstone already makes win.
   * GPT Sol, reviewing the built code, 2026-09-01.
   */
  const patching = useRef(new Map<string, Promise<void>>());

  // Switching article throws the tombstones away with the comments they name.
  useEffect(() => {
    const gone = deleted.current;
    const chains = patching.current;
    return () => {
      gone.clear();
      chains.clear();
    };
  }, [slug]);

  /**
   * Send a write behind whatever is already out for *this* comment.
   *
   * **The thing that keeps the chain alive is `write`'s own `try/catch`**: it
   * swallows the failure, so the promise it returns never rejects and the next
   * write is always sent. The second handler in `.then(write, write)` is a
   * backstop for the day someone takes that `catch` out — it costs nothing, and
   * it would then be the only thing standing between one dropped connection and
   * that comment being unwritable for the rest of the session. It is not what
   * is doing the work today. (The same note is on `useCriteria.recolour`, where
   * it was got wrong the other way round first.)
   *
   * The chain is returned rather than swallowed, so `await comments.edit(…)`
   * still means *this write is done* — which is what
   * tests/refused-writes-are-reported.test.tsx waits on.
   */
  const queue = useCallback((id: string, write: () => Promise<void>): Promise<void> => {
    const next = (patching.current.get(id) ?? Promise.resolve()).then(write, write);
    patching.current.set(id, next);
    return next;
  }, []);

  useEffect(() => {
    let live = true;
    setComments([]);
    /* Both cleared alongside the comments, not left over from the last article
       — the whole point of them is that they describe *this* slug's fetch. */
    setLoaded(false);
    setLoadFailed(false);
    /* With a deadline, because `loaded` is what lets `AnnotateDialog` save —
       see `loaded` in CommentsApi and src/web/lib/opening-read.ts. */
    const read = openingRead<{ comments?: Comment[]; error?: string }>(
      `/api/comments/${encodeURIComponent(slug)}`,
    );
    read.body
      .then((body) => {
        if (!live) return;
        /* A body with an `error` in it is a failed load as much as a thrown
           one is: there are no comments in it, and drawing "nothing asked yet"
           off it is the same false claim. */
        if (body.error) {
          setError(body.error);
          setLoadFailed(true);
        } else setComments(body.comments ?? []);
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!live) return;
        setError(describeFetchFailure(e));
        setLoadFailed(true);
        /* `loaded` on the failure path too. Otherwise a drawer opened while the
           network is down waits for ever, spinner turning, next to an error
           message — one of them lying. See `loaded` in CommentsApi. */
        setLoaded(true);
      });
    return () => {
      live = false;
      read.abandon();
    };
  }, [slug]);

  /** Replace one comment in place, or append it if it is new. */
  const put = useCallback((next: ClientComment) => {
    setComments((prev) =>
      prev.some((c) => c.id === next.id)
        ? prev.map((c) => (c.id === next.id ? next : c))
        : [...prev, next],
    );
  }, []);

  /** The DELETE itself, checked. Also used to re-delete after a late answer. */
  const forget = useCallback(
    async (id: string) => {
      try {
        // A DELETE that 500s used to remove the comment from the screen and say
        // nothing, so the reader saw it gone and found it back after a reload.
        // `fetchOk` is that check made unforgettable — lib/api.ts.
        await fetchOk(`/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
      } catch (e) {
        setError(describeFetchFailure(e as Error));
      }
    },
    [slug],
  );

  /**
   * Ask the server, and read the answer as it is written.
   *
   * `deep` is the reader saying the answer they have is not good enough — see
   * src/explain.ts. It is passed straight through; nothing about the request
   * shape changes, deliberately, because the tool definition is part of the
   * cached prefix.
   */
  const send = useCallback(
    (input: Comment, deep = false) => {
      /* What is on screen right now, kept so a failed re-ask can put it back.
         Without this, pressing "Search the web properly" on a good answer and
         having the second call fail leaves the reader with an error where their
         answer used to be, and no way back to it. The server has already
         overwritten the stored one by then, so this copy is the only one left. */
      const previous = deep ? input.answer : undefined;

      // Drop whatever the previous attempt left behind, so a retry shows a
      // spinner rather than the old error with a spinner under it. A deep
      // re-ask keeps the old answer on screen instead: the reader is replacing
      // something they can still read, not waiting on nothing.
      /* **Spread the stored comment, then override.** It used to be built from
         five named fields, which was complete when a comment was five fields;
         it now has a body, an edit time and a linked conversation, and naming
         the fields would blank all three on screen the moment somebody pressed
         Try again. The server keeps them — `beginAnswer` writes only the answer
         columns — so dropping them here would be the client disagreeing with
         the disk until the next reload. */
      /* `answer` and `replacing` are *dropped* rather than set to undefined —
         `exactOptionalPropertyTypes` is on, and an explicit `undefined` is a
         different shape to an absent key, which is the same distinction the two
         stores are compared on. */
      const { answer: _prevAnswer, replacing: _wasReplacing, ...carried } = input as ClientComment;
      const pending: ClientComment = {
        ...carried,
        status: "pending",
        ...(previous ? { answer: previous, replacing: true as const } : {}),
      };
      put(pending);
      setError(null);
      // Asking again un-deletes: the reader is plainly no longer finished with
      // it, whatever they clicked a moment ago.
      deleted.current.delete(pending.id);

      /* The id the *server* is using. It is normally the one we minted, but
         `commentStore.create` re-mints a malformed or colliding one, and the
         `begin` frame is how we find out. Everything after that point addresses
         the row by this, not by `pending.id`. */
      let id = pending.id;
      let text = "";
      let settled = false;

      void (async () => {
        try {
          /* **The id is in the path and the anchor is not in the body at all.**
             Answering is its own route since 2026-08-28, and it reads the
             stored passage rather than accepting one — so a retry cannot move a
             comment to different words, and cannot blank the reader's note by
             resending a subset of the row. docs/plans/260828a-comments-and-bookmarks.md. */
          const r = await apiFetch(
            `/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(pending.id)}/answer`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...(deep ? { deep: true } : {}) }),
            },
          );
          /* A failure before the stream opens is ordinary JSON — the server
             validates before it writes a header. A failure after it opens is a
             `done` frame carrying `status: "error"`. Two shapes, because they
             are two different things, and only the first can be an HTTP code. */
          if (!r.ok || !r.body) throw await failure(r);

          /* A clock on the bytes. Nothing here can *recover* the way chat does —
             there is no `pending` comment row for a watcher to adopt, and the
             answer the server finished writing simply appears on the next
             reload — so all this buys is a failure the reader can see instead
             of a spinner that never stops. That is most of the value: the bug
             this was built for was a panel that said "thinking…" for ever.
             `sse(res)` beats every 15 seconds on this route too, so the same
             60-second silence means the same thing here. */
          for await (const event of readEvents(r.body, { stallMs: STREAM_STALL_MS })) {
            /* **Read to the end even when the reader has deleted it.** Breaking
               out here was the obvious thing and it loses the row: the server
               writes the answer on its own `done`, *after* our DELETE has run,
               so the comment comes back on the next reload. The `done` branch
               below is what re-sends the DELETE once the write it is racing has
               definitely landed — so the loop has to reach it. Until then the
               deleted row is simply not drawn. */
            const gone = deleted.current.has(id);
            if (event.name === "begin") {
              const begun = event.data as Comment;
              if (begun.id !== id) {
                /* The server re-minted. Drop the row we invented before the
                   real one lands, or the reader ends up with two of the same
                   comment — `put` appends anything it does not recognise, so
                   the optimistic one would simply stay. */
                const stale = id;
                setComments((prev) => prev.filter((c) => c.id !== stale));
                id = begun.id;
              }
              if (!gone) {
                put({ ...begun, ...(previous ? { answer: previous, replacing: true as const } : {}) });
              }
              continue;
            }
            if (event.name === "delta") {
              // The first delta is where the old answer goes: from here on the
              // reader is watching the new one, and showing both would read as
              // a rendering fault.
              text += (event.data as { text: string }).text;
              // `replacing` deliberately dropped: from the first word on, what
              // is on screen is the new answer, not the old one being held.
              if (!gone) {
                /* Spread, for the reason on `pending` above: a delta must not
                   be the moment the reader's own note leaves the screen.
                   `replacing` goes, because from the first word on what is on
                   screen is the new answer, not the old one being held. */
                const { replacing: _held, ...rest } = pending;
                put({ ...rest, id, status: "pending", answer: text });
              }
              continue;
            }
            if (event.name === "done") {
              settled = true;
              const done = event.data as Comment;
              if (deleted.current.has(done.id)) {
                /* Deleted while the answer was in the air. The DELETE we sent
                   may have run *before* the server finished writing, so the row
                   can be back on disk; send it again now that nothing else will
                   write it. */
                void forget(done.id);
                return;
              }
              put(done);
              return;
            }
          }

          /* The stream ended without a `done`. The connection dropped, or a
             proxy cut it — either way nobody is coming, and leaving the row
             `pending` is a spinner that never stops. Chat learned this the same
             way; see the `!finished` guard in useChat.ts. */
          if (!settled && !deleted.current.has(id)) {
            throw new Error("The answer stopped arriving. Try again.");
          }
        } catch (e) {
          if (deleted.current.has(id)) return;
          const message = describeFetchFailure(e as Error);
          setError(message);
          put({
            ...pending,
            id,
            status: "error",
            error: message,
            /* Whichever we have: what arrived before it broke, or — if nothing
               did and this was a re-ask — the answer the reader already had.
               Losing a good answer to a failed attempt at a better one is the
               one outcome this button must not produce. */
            ...(text.trim()
              ? { answer: text.trim() }
              : previous
                ? { answer: previous, replacing: true as const }
                : {}),
          });
        }
      })();
    },
    [slug, put, forget],
  );


  /**
   * Make a free comment.
   *
   * **The id is minted here**, so the mark can be drawn and the dialog opened
   * in the same frame the reader lets go of the mouse. The server takes it as
   * given unless it is malformed or already used — and "already used by a
   * different comment" is a 409 rather than an overwrite, which is what stops a
   * collision from quietly eating somebody else's note.
   *
   * The optimistic row is **removed again** if the request fails. A bookmark
   * that stays on screen after the server refused it is worse than one that
   * never appeared: the reader believes the passage is marked, and finds out it
   * is not on their next visit.
   */
  const create = useCallback(
    async (input: NewCommentInput): Promise<Comment | null> => {
      const id = input.id;
      const optimistic: ClientComment = {
        id,
        blockId: input.blockId,
        quote: input.quote,
        start: input.start,
        createdAt: new Date().toISOString(),
        ...(input.body ? { body: input.body } : {}),
        /* The placement goes on the optimistic row too, so the dialog that
           opens over it is already showing the judgement the referee just
           made rather than catching up a beat later. */
        ...markFields(input.mark),
        status: "none",
      };
      /* What was under this id before, if anything, so a failure can put it
         back rather than delete it. Blindly filtering by id on the way out
         would remove a *legitimate* comment in the one case that matters — an
         id collision — which is the failure the rollback exists to prevent.
         GPT Sol, reviewing the built code. */
      let displaced: ClientComment | undefined;
      setComments((prev) => {
        displaced = prev.find((c) => c.id === id);
        return prev.some((c) => c.id === id)
          ? prev.map((c) => (c.id === id ? optimistic : c))
          : [...prev, optimistic];
      });
      setError(null);
      try {
        const r = await fetchOk(`/api/comments/${encodeURIComponent(slug)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            blockId: input.blockId,
            quote: input.quote,
            start: input.start,
            ...(input.body ? { body: input.body } : {}),
            ...markFields(input.mark),
          }),
        });
        const { comment } = await readJson<{ comment: Comment }>(r);
        /* The server may have minted a different id. Drop the row we invented
           before putting the real one, or `put` appends it and the reader has
           two marks over one passage. */
        if (comment.id !== id) setComments((prev) => prev.filter((c) => c.id !== id));
        put(comment);
        return comment;
      } catch (e) {
        setComments((prev) =>
          displaced
            ? prev.map((c) => (c.id === id ? displaced! : c))
            : prev.filter((c) => c.id !== id),
        );
        setError(describeFetchFailure(e as Error));
        return null;
      }
    },
    [slug, put],
  );

  /**
   * Change the reader's words on a comment they already made.
   *
   * **The shape this must never take** is "build an optimistic comment out of
   * the body alone", which blanks the answer, the citations and the linked
   * conversation in memory until the next reload. GPT Sol's review named this
   * as the client half of the field-mutability rules.
   *
   * **Queued per comment** — see `patching`. Replacing the whole row with the
   * server's answer is only safe while the answers arrive in the order the
   * writes were sent, and two independent PATCHes give no such promise.
   */
  const edit = useCallback(
    (id: string, body: string | null): Promise<void> =>
      queue(id, async () => {
        setError(null);
        try {
          const r = await fetchOk(
            `/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ body }),
            },
          );
          const { comment } = await readJson<{ comment: Comment }>(r);
          /* **The server's comment replaces the stored one; it is not merged
             over it.** A merge cannot express a *removal*: clearing the body
             returns a comment with no `body` key, and `{ ...c, ...comment }`
             keeps the old one — so a reader who emptied the box watched their
             words come straight back. The response is the whole row, so
             replacing is both correct and the only thing that can clear a
             field. The one client-only field, `replacing`, deliberately does
             not survive an edit. GPT Sol, reviewing the built code, 2026-08-28.

             Replacing is also why this had to be queued: it carries the mark
             the server held when it answered, so out of order it is a mark the
             referee has already changed. */
          setComments((prev) => prev.map((c) => (c.id === id ? comment : c)));
        } catch (e) {
          setError(describeFetchFailure(e as Error));
        }
      }),
    [slug, queue],
  );

  /**
   * Change the referee's placement on a comment, or clear it.
   *
   * **Deliberately not optimistic**, which is the opposite call from `create`
   * and from `recolour` in useCriteria.ts, so it is worth saying why. A colour
   * that flicked back would read as the app arguing with the referee; a
   * *judgement* that flicked back is the app telling the truth. The rule this
   * hook keeps everywhere is that a failed write must not leave the screen
   * showing success — and here the cheapest way to keep it is to not show the
   * new value until the server has it. The write costs no model call, so the
   * wait is a round trip rather than a spinner.
   *
   * That only works because the instrument is controlled by the stored comment
   * rather than by state of its own. If it ever grows local state, this becomes
   * optimistic-with-rollback and the rule moves into the component.
   *
   * **The server's comment replaces the stored one; it is not merged over it.**
   * Same reason as `edit`: a merge cannot express a *removal*, and clearing a
   * placement returns a comment with no `criterionId` and no `valence` — so
   * `{ ...c, ...comment }` would put the cleared placement straight back.
   *
   * **Queued per comment** — see `patching`. Not showing the new value until
   * the server has it is what keeps a failed write from looking like a success;
   * it does nothing about a *succeeded* write being overtaken by an older one,
   * and a referee pressing two positions in a second is the ordinary way to
   * change your mind. The buttons stay enabled through the wait deliberately:
   * with the queue there is no order left to get wrong, and disabling them
   * would need local state in an instrument whose whole design is that it has
   * none.
   */
  const place = useCallback(
    (id: string, mark: Mark): Promise<void> =>
      queue(id, async () => {
        setError(null);
        try {
          const r = await fetchOk(
            `/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/mark`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              /* **Both fields, always** — this route reads `null` as *clear
                 it*, which is the whole reason it is a route of its own rather
                 than a pair of optional fields on the body patch. Named rather
                 than spread, so a `Mark` that ever grows a third field cannot
                 start travelling by accident. */
              body: JSON.stringify({ criterionId: mark.criterionId, valence: mark.valence }),
            },
          );
          const { comment } = await readJson<{ comment: Comment }>(r);
          setComments((prev) => prev.map((c) => (c.id === id ? comment : c)));
        } catch (e) {
          setError(describeFetchFailure(e as Error));
        }
      }),
    [slug, queue],
  );

  /**
   * Remember, **locally**, that this comment started that conversation.
   *
   * There is no request here and there must not be: the link is written by the
   * server from inside the chat stream, which is the only place a real thread
   * id exists. This is the browser catching up with a write that has already
   * happened, so that the mark and the dialog behave correctly *now* rather
   * than after the next reload — without it, clicking the passage you have just
   * annotated opens the chat instead of your note.
   *
   * The id it is given converges: `ChatDialog` reports the optimistic one and
   * then the server's correction, and the last word wins. A wrong value in the
   * gap is invisible — it only fails to match a chat summary, which falls back
   * to the behaviour there was before.
   */
  const noteThread = useCallback((id: string, threadId: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, threadId } : c)));
  }, []);

  /**
   * Re-ask a question whose model call failed.
   *
   * Reads `comments` from the closure rather than from a `setComments` updater.
   * An updater must be pure — React StrictMode invokes it twice — and the first
   * version of this fired the POST from inside one, which sent two requests,
   * spent two model calls, and left the dialog watching an id neither of them
   * came back with. The server is idempotent on the id as well (src/comments.ts),
   * so a duplicate would now be harmless; this is the belt.
   */
  const retry = useCallback(
    (id: string) => {
      const existing = comments.find((c) => c.id === id);
      if (existing) send({ ...existing, status: "pending" });
    },
    [comments, send],
  );

  /**
   * Ask again, and this time go and look.
   *
   * The same call as `retry`, with `deep` set — the reader has read an answer
   * and said it was not enough, which is a different statement from "that
   * failed" and gets a different sentence in the prompt (src/explain.ts).
   *
   * It **replaces** the answer rather than adding one. A comment is one
   * question and one answer; a second would need a schema that can hold two and
   * a panel that can show them. The old answer stays on screen until the new
   * text starts arriving, and comes back if the re-ask fails — see `send`.
   */
  const deepen = useCallback(
    (id: string) => {
      const existing = comments.find((c) => c.id === id);
      if (existing) send(existing, true);
    },
    [comments, send],
  );

  const remove = useCallback(
    (id: string) => {
      deleted.current.add(id);
      setComments((prev) => prev.filter((c) => c.id !== id));
      // If a POST is still out, its `.then` re-sends the DELETE once the write
      // it is racing has definitely landed. Doing it only here would let the
      // POST write the row back after we deleted it.
      void forget(id);
    },
    [forget],
  );

  return {
    comments,
    loaded,
    loadFailed,
    create,
    edit,
    place,
    noteThread,
    retry,
    deepen,
    remove,
    error,
  };
}
