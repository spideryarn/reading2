# Review: the arriving list of chat conversations, and the seam test under it

You are reviewing **built code**, not a plan. Two changes, both in the web client of Spideryarn (a
TypeScript + React reading app). Read the files themselves — the paths below are real and the
working tree is the code under review.

Be concrete and adversarial. For each finding give a severity (HIGH / MEDIUM / LOW), the file and
line, and **a reachable sequence of user or network events that produces the bad state**. If you
cannot construct one, say so and downgrade it. A finding I cannot reproduce in my head from your
description is not usable to me.

Note: this is a shared working tree with other agents in it. Files other than the ones listed below
are being edited by other people, and `npm test` and `npm run typecheck` both have unrelated
failures from that work right now (Postgres schema drift, `transcribe`, `doc-links`, `ai_calls`
columns, `evals/`). Ignore those. Biome currently aborts with a stack overflow on **every** file in
this tree, including untouched ones, so lint output is unavailable.

## Change 1 — the load on arrival merges instead of replacing, and numbers its loads

`src/web/useChat.ts`. `useChat(slug)` fetches `GET /api/chat/:slug` once from a mount effect. Until
now the response was written straight over the state: `setThreads(fresh)`.

The claim: that is unsafe for exactly as long as the fetch takes, because the reader can act inside
that window, and because two loads of one article can be in flight at once.

1. press `+` (`begin`) and get a local-only conversation — wiped by the arriving list;
2. type into it and send (`send(null, …)`) — the conversation is wiped while its POST carries on,
   and every later frame of the answer calls `put`, which only patches a thread it can find, so the
   answer arrives nowhere;
3. delete a conversation (`remove`) — an older snapshot puts it back;
4. two loads of one article, in either order. `StrictMode` runs the mount effect twice in
   development; production reaches the same thing by leaving an article and coming straight back,
   because `showing.current` distinguishes *articles* and both of these are the same article.

The fix is `mergedArrival` plus a `load` generation counter. The whole diff against the previous
version of this file:

```diff
diff --git a/src/web/useChat.ts b/src/web/useChat.ts
index 0bba232..aae4218 100644
--- a/src/web/useChat.ts
+++ b/src/web/useChat.ts
@@ -115,12 +115,22 @@ export interface ChatApi {
      * asked. `withRetry` on the server carries the stance over from the answer
      * it is replacing; `withEdit` takes it from the answer being replaced. If
      * this rode along instead, moving the picker and then pressing retry would
      * silently rewrite the instruction attached to a stored turn.
      */
     stance?: ReviewStance,
+    /**
+     * The comment this conversation is being started from — **only on the send
+     * that creates the thread**, and passed straight through to the server.
+     *
+     * The link is written *there*, once the real thread id exists, because the
+     * id this function returns is minted optimistically and the client only
+     * hears about an overrule when there is one. See
+     * docs/plans/comments-and-bookmarks.md § the Save & ask choreography.
+     */
+    sourceCommentId?: string,
   ): string;
   /**
    * Answer the same question again, replacing the answer in place.
    *
    * Only the last answer in a thread — the server refuses anything else with a
    * 409, and the panel only offers the button there. See `retryTurn` in
@@ -258,12 +268,69 @@ export function withServerIds(
  * GPT-5.6 review, 2026-08-26.
  */
 export function withoutEmpty(threads: ChatThread[], id: string): ChatThread[] {
   return threads.filter((t) => !(t.id === id && t.messages.length === 0));
 }
 
+/**
+ * The list the server has just handed us, on top of what this tab already
+ * knows — used only for the load on arrival.
+ *
+ * The arriving list used to be written straight over `threads`, on the
+ * reasoning that there is nothing on screen when a panel has only just mounted.
+ * That is true for exactly as long as the fetch takes, and no longer: on a slow
+ * connection the reader can press `+`, type a question, send it and watch the
+ * answer arrive, all before the response to a request made at mount lands.
+ * Every one of those is in the list the snapshot then replaced, and the send is
+ * the one that costs — its rows go, and each later frame of the answer patches
+ * a row that is not there, so the answer arrives nowhere and the reader is
+ * looking at a list with no sign they ever asked. Greg hit the visible half of
+ * this on a slow connection, 2026-08-27; GPT Sol found this half while
+ * reviewing the composer under the list, which made it easy to reach.
+ *
+ * So the server's list is **added to** what is on screen and never applied over
+ * it. Two rules:
+ *
+ * - **A row already on screen wins.** Not "unless the server's is newer",
+ *   because ours is newer by construction: the mount effect empties the list
+ *   before it fetches, so everything in `prev` was put there afterwards, by
+ *   this tab, from a send this tab is watching. The server's copy of the same
+ *   conversation is at best equal and at worst the half-written one it had when
+ *   it answered — the question stored, the answer still streaming — and a
+ *   response that crawls back over a slow connection can be that stale even
+ *   after the send it is behind has finished. Preferring ours needs no timing
+ *   argument at all, which is what makes it right; a narrower rule that only
+ *   protected conversations with a send **still running** left exactly that
+ *   window open.
+ * - **Deletions win**, which `put` has always said and the arriving list did
+ *   not. A conversation the reader deleted while the fetch was out is still in
+ *   the snapshot, because the send that created it told the server; putting it
+ *   back reads as the delete button not working.
+ *
+ * Both rules are the arrival load's alone. Neither is safe for `refresh(only)`,
+ * where the screen is the thing known to be wrong and a thread the server does
+ * not have is one somebody else deleted — which is why that branch takes the
+ * server's copy, and deletes on its absence.
+ *
+ * `deleted` is passed in rather than read from `gone` here, so this stays a
+ * pure function of its arguments: it runs inside a `setThreads` updater, which
+ * React invokes twice under `StrictMode`, and this file has been bitten by an
+ * impure updater before.
+ */
+export function mergedArrival(
+  prev: ChatThread[],
+  fresh: ChatThread[],
+  deleted: ReadonlySet<string>,
+): ChatThread[] {
+  const ours = new Set(prev.map((t) => t.id));
+  /* Appended rather than merged into place, because nothing downstream reads
+     this order: ThreadList sorts by `updatedAt`, and the panel finds the open
+     conversation by id. */
+  return [...prev, ...fresh.filter((t) => !ours.has(t.id) && !deleted.has(t.id))];
+}
+
 /**
  * A lost stream goes back and looks for its answer before it gives up.
  *
  * The server does not stop working when a reader's connection dies — see the
  * note on `stopChat` in src/routes.ts, where letting an abandoned answer finish
  * is a deliberate choice — so by the time the client has noticed the silence,
@@ -549,20 +616,38 @@ export function useChat(slug: string): ChatApi {
    * Only `refresh` reads it, and only to answer one question: is anything on
    * screen for this conversation newer than what the server is about to say?
    * See the note there.
    */
   const running = useRef(new Map<string, number>());
 
+  /**
+   * Which load on arrival is the current one.
+   *
+   * Bumped by every `refresh()` that asks for the whole list, and read again
+   * after the await: a response whose number is no longer the latest belongs to
+   * a load something has already superseded, and it may not write.
+   *
+   * `showing.current` does not cover this, and the difference is the same one
+   * `loadFailed` was bitten by — see the note in the mount effect. That ref
+   * distinguishes **articles**; this distinguishes **loads of one article**, of
+   * which `StrictMode` deliberately starts two. Merging is no defence there,
+   * because the stale snapshot has the same conversations in it, one message
+   * shorter. Found by GPT Sol reviewing the composer under the list, 2026-08-27.
+   */
+  const load = useRef(0);
+
   /**
    * Ask the server what this article's conversations actually are.
    *
-   * Two callers, and they want different amounts of it. On arrival there is
-   * nothing on screen worth keeping, so the whole list is replaced. After a 409
-   * the screen is not merely out of date, it is *wrong* — it is showing an edit
-   * that did not happen, with the turns it would have discarded already gone —
-   * but only for **one conversation**, and that is all that gets replaced.
+   * Two callers, and they want different amounts of it. On arrival the answer
+   * is merged over what is already there rather than written across it — see
+   * `mergedArrival`, which says what the fetch's own duration lets the reader do
+   * in the meantime. After a 409 the screen is not merely out of date, it is
+   * *wrong* — it is showing an edit that did not happen, with the turns it would
+   * have discarded already gone — but only for **one conversation**, and that is
+   * all that gets replaced.
    *
    * That narrowing is not tidiness. Replacing the whole list put a snapshot
    * taken before an unrelated send over the top of that send's optimistic rows,
    * and every later frame of it then patched a row that was not there any more:
    * an answer that arrives nowhere, or a spinner that never clears. A 409 in one
    * conversation has nothing to say about another. Found by a GPT-5.6 review,
@@ -577,24 +662,31 @@ export function useChat(slug: string): ChatApi {
    * caller that cares — a per-thread refresh failing later says nothing about
    * whether the list itself ever arrived. See `loadFailed`.
    */
   const refresh = useCallback(
     async (only?: string): Promise<boolean> => {
       const mine = slug;
+      /* Claimed before anything is awaited, so two loads of one article are
+         ordered by when they were *asked*, not by when they answered. */
+      const generation = only === undefined ? (load.current += 1) : load.current;
       try {
         const body = await readJson<{ threads?: ChatThread[]; error?: string }>(
           await apiFetch(`/api/chat/${encodeURIComponent(mine)}`),
         );
         if (showing.current !== mine) return false;
+        if (only === undefined && generation !== load.current) return false;
         if (body.error) {
           setError(body.error);
           return false;
         }
         const fresh = body.threads ?? [];
         if (only === undefined) {
-          setThreads(fresh);
+          /* Read here, outside the updater, so what it is handed is a value
+             rather than a ref — see `mergedArrival`. */
+          const deleted = new Set(gone.current);
+          setThreads((prev) => mergedArrival(prev, fresh, deleted));
           return true;
         }
         // More than one means somebody else is still writing here — this run is
         // counted too, and it is the one that failed.
         if ((running.current.get(only) ?? 0) > 1) return true;
         const server = fresh.find((t) => t.id === only);
@@ -1310,12 +1402,13 @@ export function useChat(slug: string): ChatApi {
       at: string | null,
       useProfile = true,
       onThreadId?: (id: string) => void,
       anchor?: ChatAnchor,
       kind?: ThreadKind,
       stance?: ReviewStance,
+      sourceCommentId?: string,
     ): string => {
       const id = threadId ?? mintId();
       const now = new Date().toISOString();
       const pendingId = mintId();
 
       /* Both rows go in optimistically, before the request leaves. The reader's
@@ -1385,12 +1478,13 @@ export function useChat(slug: string): ChatApi {
           ...(anchor ? { anchor } : {}),
           /* Sent only when it is a review. A body with no `kind` means chat,
              which is what every caller written before this feature meant, and
              what keeps an old tab working. */
           ...(kind === "review" ? { kind } : {}),
           ...(stance ? { stance } : {}),
+          ...(sourceCommentId ? { sourceCommentId } : {}),
         },
         pendingId,
         onThreadId,
       );
       return id;
     },
```

**One thing to know about how I got here, because it is the crux.** My first version of
`mergedArrival` was narrower: it kept this tab's copy of a conversation only while a send into it
was **still running** (`running.current`, the counter `refresh(only)` uses), and otherwise took the
server's row. I then convinced myself that leaves a window open — the GET's storage read happens
while the answer is half written, its response crawls back over a slow connection, and by the time
it lands the send has *finished*, so the count is zero and the server's half copy replaces a
complete answer. I widened it to "a row already on screen wins", with no timing in it, and added a
test that fails against the narrower rule (`does not take away an answer that finished while it was
still in flight`).

Questions I actually want answered:

- **Is "a row already on screen wins" safe?** My argument is that it is safe *only* because this is
  the arrival load: the mount effect calls `setThreads([])` synchronously before `refresh()`, so
  everything in `prev` when the response lands was put there afterwards, by this tab. Is there any
  path — slug change, `StrictMode`, a mode switch that unmounts and remounts, a `refresh(only)`
  after a 409 interleaving with the arrival load, the handoff in `chat-handoff.ts` — where `prev` at
  arrival time can hold a row that came from the **server** and is now stale or since deleted, so
  that keeping it is wrong?
- **Was widening it from the `running` rule actually right,** or did I talk myself into a race that
  cannot happen? If the window I describe is real, is there a *third* thing it also breaks that I
  have not noticed?
- **What can a stale arrival snapshot still do under the new rule?** It can only *add* rows. Is
  there a reachable case where adding is itself wrong — a conversation deleted from another tab
  between the two server reads, say — and does the `deleted` set cover enough of it?
- **Is the generation guard correct and sufficient?** `load.current` is bumped only for
  `only === undefined`, and read again after the await. Per-thread refreshes (`refresh(only)`, after
  a 409) neither bump it nor are suppressed by it. Is there a bad interleaving of a per-thread
  refresh and an arrival load?
- **Does reading `gone.current` outside the updater and passing the set in actually make the updater
  pure**, and is the snapshot taken at the right moment? A thread deleted between the snapshot and
  the updater running — what happens to it?
- **Ordering.** `mergedArrival` puts this tab's rows first and appends the server's. I claim nothing
  reads that order — `ThreadList` sorts by `updatedAt`, the panel finds the open conversation by id.
  Check that claim in `src/web/ChatPanel.tsx`.
- Anything else that is now wrong because the arrival branch no longer replaces. In particular the
  `loadFailed` / `loaded` flags, and `tests/load-failed-flags.test.ts`, which fixed a closely
  related bug in the same effect a day ago.

The tests are `tests/chat-arrival-race.test.ts`, six cases. Each was watched failing against the old
`setThreads(fresh)`; the finished-answer one was watched failing against the narrower `running`
rule; the superseded-load one was watched failing against the merge with the generation guard
removed. So each half of the fix has a test that fails without it. **Are they testing the thing, or
testing the fix's own shape?** In particular: does mounting under real `StrictMode` genuinely
produce two in-flight requests, and is `expect(call).toBe(2)` enough to keep that honest?

## Change 2 — a test for the one line between the panel and the hook

Context, briefly: the chat panel's list of past conversations now ends in a text box that starts a
new conversation and sends the typed question into it in one action
(`docs/plans/chat-mode.md § The box under the list, which saves the click`). An earlier review of
that work found a HIGH bug: the box was wired to the panel's ordinary `onSend`, which
`ConversationBand` resolves against the `?thread=` query parameter — and `?thread=` is **not**
always null while the list is showing, because the panel picks between list and conversation with
`threads.find`, so a bookmarked conversation that has not arrived yet leaves the list on screen.
The reader's question was appended to that stored conversation under a placeholder promising a new
one. The fix was a separate `onSendNew` prop that always passes `null` as the thread id.

`tests/chat-list-composer.test.tsx` pins the panel's half of that (which callback, and when the box
is offered at all) with `onSendNew` mocked. `tests/use-chat-recovery.test.ts` pins the hook's half,
that `send(null, …)` mints. The line between them — `ConversationBand`'s `onSendNew` in
`src/web/App.tsx` — was untested, and it is the exact line the bug was in.

`tests/conversation-band-send-new.test.tsx` (new) mounts the real `ConversationBand` with the real
`useChat`, `apiFetch` stubbed and `ChatPanel` replaced by a stub that captures its props, with
`?thread=` naming a stored conversation. It asserts the POST body's `threadId` is not the stored
one, that `?thread=` follows, and that the focus nonce rises. I watched all three against a copy of
`App.tsx` wired back to `thread`: two go red, the `?thread=` one does not, because it compares
against the id that was actually sent.

Questions:

- Is this test load-bearing, or does its stubbing let the regression through? It stubs `ChatPanel`
  entirely, so it proves the *band* passes `null`; it does not prove the panel calls `onSendNew`
  rather than `onSend`. Is the division of labour between this file and
  `tests/chat-list-composer.test.tsx` complete, or is there a mutation of the source that both
  files would stay green for?
- The `?thread=` assertion needs a real 100ms wait, because nuqs writes the address on a timer of
  its own. Is that flaky, and is there a better way to establish it?
- Is exporting a component from `App.tsx` purely for a test the right call, or is there a cheaper
  seam I have missed? The only precedent for testing App.tsx wiring is
  `tests/glossary-band-wiring.test.ts`, which reads the file as text and says so.

## Change 3 — the plan document, and one tidy-up

`docs/plans/chat-mode.md`, two new sections plus a corrected rationale on the composer's guard: the
guard (`loaded && threads.length > 0`) went in for a safety reason that Change 1 has now fixed at
source, so the doc now says the guard is presentational and no longer load-bearing. **Is that
right?** Is there any remaining safety reason to keep the box off the screen during the load, now
that the arriving list cannot wipe what the reader started?

Separately: `ChatBand` was renamed `ConversationBand` in commit `2dd6311` and eleven references to
the old name were left behind in comments across `src/web/App.tsx`, `src/web/ChatPanel.tsx` and
`src/web/useChatAnchors.ts`. Those are now updated. Plan documents written *before* that rename
still say `ChatBand`, and I have deliberately left those alone as historical record. Say if you
think that is the wrong call.

## What to check it with

- `npx vitest run tests/chat-arrival-race.test.ts tests/conversation-band-send-new.test.tsx tests/chat-list-composer.test.tsx tests/chat-list-loading.test.tsx tests/use-chat-recovery.test.ts tests/load-failed-flags.test.ts`
- `npm run typecheck` (filter to `useChat`, `App.tsx`, `chat-arrival-race`, `conversation-band`)

Finish with a one-line verdict: **ship** or **do not ship**, and if the latter, the smallest change
that would make it shippable.
