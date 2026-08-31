# The shape of the chat client, and what to do about it

**Status:** step 1 built, 2026-08-28. Steps 2–4 written down and not built.

Greg asked, 2026-08-28:

> Get input from GPT Sol about whether there's a rearchitecture or long-term-best way to rejig this
> and related areas to make them cleaner, more robust, etc.

This is the answer, what was built from it, and what was deliberately left.

## Why the question was asked

`src/web/useChat.ts` had accumulated **twelve concurrency bugs in three days**, each found by a
reviewer or a reader rather than by anything structural, and each fixed on its own terms by adding
another ref, another guard, or another narrowing. Every fix is individually correct. The sequence is
the finding.

Two of the twelve are the tell. Both were "a superseded load wrote something it was not entitled to
write". The first was `loadFailed` (2026-08-27). The second was `error`, in the `catch` of the same
function, found **the next day** (2026-08-28) — because the guard had been added to every success
path and the failure path was a separate place to remember. The same bug, in the same file, twice.

Counted rather than felt, before the change:

| | `useChat.ts` | `useComments.ts` |
| --- | --- | --- |
| lines | 1682 | 600 |
| `useRef` | 11 | 1 |
| `setThreads` / `setComments` call sites | 11, each with its own merge rule | 10 |
| post-`await` staleness guards | 10 sites, drawn from **four** different vocabularies | 1, used consistently |

The four vocabularies were `showing` (which article), `load` (which load of it), `live` (which run of
the effect) and `stillOurs` (which watch). Every asynchronous continuation picked a subset by hand.
Bugs 10 and 12 were both wrong subsets.

## Sol's diagnosis

The full consultation is in [260828p-chat-client-architecture-sol.md](260828p-chat-client-architecture-sol.md); the
prompt it answered is in [260828p-chat-client-architecture-prompt.md](260828p-chat-client-architecture-prompt.md).
The review of the code built from it — which returned **do not ship**, and was right to — is in
[260828p-chat-client-architecture-review-sol.md](260828p-chat-client-architecture-review-sol.md).
It read the hook, the panel, the server routes and the store. Its verdict:

> Yes. Much of this complexity is reducible.
>
> The missing concept is not quite "client or server owns this row." The server always owns durable
> truth. The missing client concept is:
>
> > Every asynchronous action is an operation with its own identity, phase, intent, and exclusive
> > right to update a particular projection.
>
> Today, row IDs stand in for operation IDs. That cannot work reliably because retry deliberately
> reuses an answer row, while the server correctly distinguishes attempts. The refs are an informal
> operation ledger assembled one concern at a time.
>
> — GPT Sol, 2026-08-28

It named the three things tangled in one `threads` array: **server facts**, **this tab's
projection**, and **the processes currently changing that projection**. The third has no
first-class representation, and every ref is a piece of it.

That is a sharper statement of the same thing than the one I had reached independently ("there is no
single answer to *who owns this row right now*"), and the difference matters: the unit is the
**operation**, not the row, because a retry deliberately reuses a row.

Sol also corrected two things I had written down wrong. There are 11 refs, not 12 — I had counted
the import line. And it found a comment in `ChatPanel.tsx` still describing the wipe that commit
`748f116` had removed the day before. Both checked and fixed.

## What was built (step 1)

Sol's step 1 was "make arrival loading an explicit operation now", via a small reducer. **What was
built is simpler than that, and gets the same guarantee**, from a hint in Sol's own evidence:
`useComments` has never had bugs 10 or 12, and its guard is a per-run `live` flag **in the effect,
where the writes are**.

`useChat` needed two staleness concepts only because the load lived in a `useCallback` that did its
own `setThreads`, so the effect's `live` could not reach the writes. So the load moved to where the
guard already worked.

Three changes, in `src/web/useChat.ts`:

1. **`askForThreads(slug)`** — a module-level function that asks the server and returns
   `{ ok: true, threads } | { ok: false, error }`. **It writes nothing and it does not throw.** A
   body that says `error`, a non-2xx and a dead network all come back the same way, because to a
   reader waiting for a list they are the same thing and used to be handled in three places.
2. **The arrival load moved into the mount effect**, where one `settle` function is the only thing
   that writes and `if (!live) return` is the only gate. A guard cannot be missing from a path that
   does not exist. The `.catch` maps to an outcome rather than handling one, so that it joins the
   single path instead of becoming a second.
3. **`refresh(only?)` became `refreshThread(only)`** — one job, no branching on whether it was given
   an argument.

And two smaller things that fall out of it:

- **`loaded` + `loadFailed` became one `phase`** of `"loading" | "ready" | "failed"`. Two booleans
  are four combinations of which three are legal, and the illegal one — not loaded, but failed — is
  the state bug 10 put the panel into. `ChatApi` still exposes both names, derived at the bottom of
  the hook; the panel should not have to learn a third word.

  **This is expressiveness, not the safety fix**, and the difference is worth keeping straight: what
  stops a superseded load setting `failed` over a list that loaded fine is the `live` gate. `phase`
  only makes the one meaningless *combination* unwritable. Sol caught the overclaim in the first
  draft of this paragraph.
- **The `load` generation ref is gone.** 11 refs → 10.

### The evidence that it holds

The gate was **watched failing**. Removing the single `if (!live) return;` from a probe copy turns
three tests red at once — one from each of the two historical bug classes plus the write case:

```
× lets a superseded load write nothing, even when it answers first
× says nothing when a superseded load fails after the current one worked
× ignores an earlier fetch failing after a later one succeeded
```

That is the point of the change in one screenful. Those three used to need three separate guards at
three separate sites, and the file twice shipped with one of them missing.

## Two bugs found while doing it

**An error outlived the article it was about.** The mount effect cleared the threads and the load
state on an article change and never cleared `error`, which has been true since chat was written.
One line, and `tests/chat-error-scope.test.ts` watched it fail first.

**No reader has seen it, though**, and the first draft of this document said they had. `Reader` is
keyed on the slug and both mounts of `useChat` are under it, so changing article remounts the hook
and takes the error with it. What the fix buys is the hook keeping its own promise rather than
leaning on a caller two files away. Sol made that correction — and had made the same one the day
before, about a different claim, in the same file. Twice now I have assumed a slug can change under
this hook in production. It cannot.

**A guard with no test, and I was wrong about why.** `refreshThread`'s `showing.current !== mine`
check could be deleted with every test in the repo still green. I wrote in the code that half of it
was unobservable — that the thread a stale repair would rewrite is not in the new article's list, so
both branches of its `setThreads` are no-ops.

**That assumes thread ids are global, and they are deliberately not.** `chat_threads` is keyed
`(article_id, id)`, and the schema says why: ids "are minted per article by the same `mintId()` and
are not promised to be globally unique". So a stale repair *can* find its id in the new slug's list
and replace a different conversation with it, or delete one by the other branch. Sol found this by
reading the schema rather than the code. There is now a test for the write as well as for the error,
and both were watched failing against a probe with the guard deleted.

**And this one is hook-level too — which I then got wrong in the other direction.** Having just
corrected the error claim, I wrote a fresh reader-visible story for the write: a conversation being
replaced under the reader's eyes. It cannot happen for the same reason, the remount, and Sol caught
it on the re-check. Three times in one day, in one file, I claimed a reader could reach a state that
requires the slug to change under a hook that production always remounts.

So the lesson is not "check your claims", which I would have said I was doing. It is that **the
reachability of a state is a separate question from whether the code handles it**, and I kept
answering the second and reporting the first. The guard is right and the tests are right; what was
wrong every time was the sentence about who would see it. A comment that says a thing cannot happen
is load-bearing — the first version of this one contradicted a contract written down two files away
— and being wrong quietly in prose is worse than being wrong in code, because nothing runs it.

And one thing deliberately left undone. `setError(null)` is not the whole of the promise it makes:
`askToStop`, `askToCancel` and `remove` all write to `error` from a `catch` with no slug guard, so
one of them failing late would still land after the reset. Guarding three more call sites by hand is
the exact habit that produced the four staleness vocabularies — step 2 closes them all at once, and
that is where it should happen.

## Steps 2–4, not built

Sol's staged path, kept because the next feature on this file should pay for it rather than buy
another local guard. Roughly 5–8 days in total.

2. **The operation reducer** (3–5 days). Every asynchronous result carries an `opId`, and one
   admission rule sits above all branches:

   ```ts
   const op = state.operations.get(event.opId);
   if (!op || !accepts(op, event)) return unchanged(state);
   ```

   `threads` becomes a projection of `base + operations − tombstones`, so a 409 drops the one refused
   operation and reapplies the unrelated local ones instead of replacing a thread wholesale. Migrate
   one path at a time: send → begin → delta → done; then retry/edit and 409 repair; then stop/cancel
   intent; then lost-stream recovery; then rename/delete. `ChatApi` stays as it is throughout.
3. **Extract a controller and driver** (1–2 days, overlapping). A pure transition function decides
   state and emits commands; a driver performs fetch/SSE/timers and sends events back. The payoff is
   a harness where `begin`, delete, load success, load failure, disconnect, recovery and done can be
   delivered **in any order without React in the way** — today `tests/chat-arrival-race.test.ts`
   spins up `createRoot` and `act` to exercise what is nearly a pure function.
4. **Only then** consider one controller per article lifted above the mounted surfaces.

Where each of the 10 remaining refs goes is in Sol's answer under *What happens to the refs*.
`released` disappears too: moving from streaming to recovering becomes a real transition, so React
no longer needs a counter to notice that a ref changed.

## What we are deliberately not doing

- **No state library.** Not Redux, Zustand, XState, TanStack Query or Jotai. Sol agreed unprompted:
  the machinery needed is a discriminated union, a pure transition function and a small driver, and
  a dependency would be a third framework exception without buying the project-specific invariants.
  See [vision.md § Principles](../project/vision.md#principles).
- **No naïve "put it all in `useReducer`."** Without operation ids and one admission gate that
  relocates the races rather than removing them.
- **No stream sequence numbers.** One fetch body is already read in order. They would not fix stale
  GETs, deletion, provisional ids, wrong attempts or remounts. Worth it only if streams ever support
  replay or reconnection.
- **No version column on the chat list.** [`src/store/pg-chat.ts`](../../src/store/pg-chat.ts) turned
  this down already and for a good reason: `where updated_at = $expected` would 409 two concurrent
  *appends* that both succeed today, which is a failure mode invented by the storage change.
  `expectedTailId` on the destructive operation is the right narrow guard.
- **Not moving reconciliation server-side.** The server cannot know which optimistic projection this
  tab has shown, or that a response was delayed past the reader leaving.
- **Not refactoring `ChatPanel.tsx`.** 1976 lines, but already eighteen components rather than a
  monolith, and its size is view behaviour. Its per-conversation `busy` derived from the final
  message is right and should stay.
- **Not touching `useComments` or `useSearch` yet.** They are the same family — tombstones,
  provisional ids, per-row ordering — with materially simpler lifecycles. Copy the operation model
  into the next sibling that *needs* it, rather than inventing a generic streaming-hook framework in
  advance.

  One thing was checked while asking: `useComments` still replaces its whole list on arrival, the
  same shape fixed in chat on 2026-08-27. It is milder there for a reason worth knowing before
  anybody "fixes" it by copying the merge machinery across — its `put` **appends when the row is
  missing**, where `useChat`'s only patches, so a wiped optimistic comment heals on the next stream
  frame instead of stranding the answer.

## Still open

**The other-tab resurrection.** A slow arrival response can still bring back a conversation deleted
in *another tab*, because the tombstone set is per-tab. No client state machine can reject a deletion
it has never heard about, and Sol is explicit that a server revision or `deletedAt` does not fix it
alone — an already-captured older response still arrives first. The boring 80/20 is to broadcast a
successful deletion over `BroadcastChannel` and revalidate on visibility return. Separate work, not
started.
