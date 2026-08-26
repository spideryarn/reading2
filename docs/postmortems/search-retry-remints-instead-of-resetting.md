# The retry that mints a second run instead of resetting the first

**2026-08-26.** Flagged by a GPT-5.6 review of the search feature, not found by hand — the failure
needs a model call to actually fail, which nobody had hit yet. Already tracked as
[simplification-audit.md §0.2](../plans/simplification-audit.md) — *"under investigation, not yet
confirmed."* Confirmed here by reading the whole path rather than trusting the summary: it is real,
and it is worse than the one-line version, because the row left behind does not just sit there wrong
— it spins forever.

## What the code did

A saved search is minted client-side, exactly as a comment id is, so `?run=` can name it from the
first frame ([search.md](../project/search.md), [comments.md](../project/comments.md)). Retrying a
failed one resends that same id:

```ts
// src/web/useSearch.ts, retry()
const retry = useCallback(
  (id: string) => {
    const existing = runs.find((r) => r.id === id);
    if (existing) send(existing.id, existing.criterion, existing.createdAt);
  },
  [runs, send],
);
```

`send` puts a local `pending` row over the old one — same id, so React sees it as the same row — then
POSTs `{ id, criterion }`. The server is where it goes wrong. `beginRun` treats *any* id already in
the file as a collision to defend against, never as "this is your own row, reset it":

```ts
// src/searches.ts, beginRun()
const taken = new Set(runs.map((r) => r.id));
stored = {
  id: wantedId && isSpideryarnId(wantedId) && !taken.has(wantedId)
    ? wantedId
    : mintUniqueId(taken),
  criterion, createdAt: now(), status: "pending", hits: [],
};
return [...runs, stored].slice(-MAX_RUNS); // always appends
```

A retry's `wantedId` is the id of the run that just failed — which is still sitting in the file with
`status: "error"`, because nothing ever removed it. `taken.has(wantedId)` is true, so `beginRun` mints
a brand new id and **appends** a second row. The old one is never touched again.

## What the reader sees

Press "try again" on a failed search:

1. The client's optimistic `put(pending)` flips the *old* row to a spinner, locally.
2. The server writes a second row, under a new id, and starts the model call against that one.
3. The response comes back naming the *new* id. `useSearch.ts`'s `put` appends anything whose id it
   does not recognise — the same rule `useComments.ts` uses — so it adds a third-in-effect row rather
   than resolving the spinner:

```ts
// src/web/useSearch.ts, put()
const put = useCallback((next: SearchRun) => {
  setRuns((prev) =>
    prev.some((r) => r.id === next.id) ? prev.map((r) => (r.id === next.id ? next : r)) : [...prev, next],
  );
}, []);
```

The old row's id was never mentioned again by the server, so nothing ever flips it out of `pending`.
**The spinner the reader is looking at never stops** — the exact "permanent spinner nothing can
clear" failure `finishRun`'s own doc comment in `src/searches.ts` says appending must never cause,
happening anyway because `beginRun` appends on the *other* end of the same run's life. The real
answer lands in a row that is not open (`?run=` still names the old id — nothing in `SearchPanel.tsx`
or `App.tsx` repoints it; `onRetry={retry}` is wired straight through with no id update), so the
reader never sees it land at all, in that session. Reload, and the picture rearranges rather than
fixes itself: the old row reverts to `error` (that is what is actually on disk), and a second,
completed row for the identical criterion now sits beside it forever — an unexplained duplicate with
no visible connection to the failure next to it.

## Root cause

Commit `cb1f269`, "Open search on meaning, and give every result a place as well as a score",
2026-08-26 10:50:51 — the commit that created both `src/searches.ts` and `src/web/useSearch.ts` in
one pass, by copying `src/comments.ts` and `src/web/useComments.ts`. The file header even says so:

> The sibling of useComments.ts, and shaped on it rather than on useChat.ts, because a search result
> is a list rather than a stream

The copy carried over the tombstone (delete-wins-over-a-late-answer) correctly — that is the part the
header calls out and the part `tests/searches.test.ts:111` pins. It did **not** carry over the other
half of `createComment`'s contract, the part that makes a retry safe:

```ts
// src/comments.ts, createComment() — the branch searches.ts does not have
const existing = comments.find((c) => c.id === input.id);
reset = existing !== undefined;
if (existing) {
  stored = { id: existing.id, blockId: input.blockId, quote: input.quote,
             start: input.start, createdAt: existing.createdAt, status: "pending" };
  return comments.map((c) => (c.id === stored.id ? stored : c));
}
// only past here is an id ever treated as "taken" and reminted
```

`createComment` asks two different questions depending on whether the id is *yours*: "is this you,
retrying?" first, and only "is this a stranger colliding with you?" second. `beginRun` only ever asks
the second question. That is the whole bug — not a typo, a dropped branch — and it is legible from
the doc comment `beginRun` was given, which describes only the collision case ("accepted only if it
is one of ours and free... That is what makes a duplicate send harmless rather than a way to overwrite
somebody else's saved search") and never mentions retry at all, because the branch that would have
needed the mention was never written.

Why the branch matters here and would matter less for, say, a search that never fails: a failed run's
id survives on disk specifically *because* it failed — `finishRun` writes the error over the pending
row rather than deleting it, so the reader can see what broke and try again. That surviving row is
exactly what makes the id "taken" on the next attempt. The bug is invisible on the happy path (no
failure, no retry, nothing to collide with) and on the very first retry after any failure at all,
which is presumably why two reviews and whatever manual testing happened before now went past it —
the same shape [half-swapped-message-ids.md](half-swapped-message-ids.md) already named: *"the half
that was tested was the half that worked."*

## Does `useComments.ts` have the same bug?

No, and it is worth saying plainly rather than assuming by association. `useComments.ts`'s `retry`
and `deepen` both resend `existing.id`, exactly as `useSearch.ts`'s does — but `createComment`'s
reset-in-place branch above means the server never reminds a comment's own id back at it. The `begin`
SSE frame's remap code in `useComments.ts`:

```ts
if (begun.id !== id) {
  const stale = id;
  setComments((prev) => prev.filter((c) => c.id !== stale));
  id = begun.id;
}
```

exists for a narrower case — a **freshly minted** id from `ask()` colliding with an unrelated
existing comment, which `mintId`'s randomness makes vanishingly rare (`docs/project/block-ids.md`)
— not for retry, which never reaches this branch because `begun.id === id` on every retry. It looks
like it should be search's safety net too, but it is not load-bearing for the bug in question; the
actual safety net comments has that search doesn't is the reset branch above, which has no client-side
analogue to speak of because the client never needs one.

## The fix

> **Correction, made while implementing this.** The version below keys the reset on the id alone,
> and that is wrong: it deletes a property the suite already pins. `tests/searches.test.ts` §
> *"mints its own id rather than overwriting a run that already has that one"* sends the same id with
> a **different criterion** and requires a fresh id back — *"what makes a duplicate send harmless
> instead of a way to write over somebody else's saved search."* Resetting on the id alone turns that
> test red and hands back the thing it was defending against.
>
> The discriminator is the **criterion**. `retry()` resends `existing.criterion` verbatim, so a retry
> is same-id-*and*-same-criterion; a duplicate send asking a different question is not, and still
> gets a minted id. When both match, resetting is right anyway — it is the same question. What
> shipped is `runs.find((r) => r.id === wantedId && r.criterion === criterion)`.
>
> Worth keeping as its own small lesson: the fix that makes the new red test green is not
> automatically the right fix, and the test that objects may be the one holding the requirement.

Give `beginRun` the branch `createComment` has: if `wantedId` names a run already in the file, reset
that run in place rather than treating it as taken.

```ts
export async function beginRun(
  slug: string,
  criterion: string,
  wantedId?: string,
  now: () => string = () => new Date().toISOString(),
): Promise<SearchRun> {
  let stored!: SearchRun;
  await update(slug, (runs) => {
    const existing = wantedId ? runs.find((r) => r.id === wantedId) : undefined;
    if (existing) {
      stored = { id: existing.id, criterion, createdAt: existing.createdAt, status: "pending", hits: [] };
      return runs.map((r) => (r.id === stored.id ? stored : r));
    }
    const taken = new Set(runs.map((r) => r.id));
    stored = {
      id: wantedId && isSpideryarnId(wantedId) ? wantedId : mintUniqueId(taken),
      criterion, createdAt: now(), status: "pending", hits: [],
    };
    return [...runs, stored].slice(-MAX_RUNS);
  });
  log("store").info({ slug, runId: stored.id }, "search started");
  return stored;
}
```

Nothing on the client needs to change. `useSearch.ts`'s `send`/`put` already assume the id it POSTed
is the id the answer comes back under — that assumption was simply false for a retry, and this makes
it true again, the same way it is already true for comments. Considered and rejected:

- **The client adopts whatever id the server hands back** (a `remap(oldId, newId)`, mirroring the
  `begin`-frame code in `useComments.ts`). Works, but search has no stream to carry a
  before-the-answer frame in — it is one POST, one response — so the remap could only happen after
  the model call finished, by which point the reader has already been staring at a spinner for up to
  the better part of a minute for nothing. It also treats a plain retry as a fundamentally
  server-driven rename, when the actual intent on both ends is "same row, again."
- **The server never reminds on this route at all** — always overwrite whatever id is sent. Wrong for
  a different reason: it would let a stray or guessed id overwrite somebody else's saved search, which
  is precisely the attack `beginRun`'s existing collision defence exists to close. The fix above keeps
  that defence; it only adds the case the defence was missing.

The right contract, matching what `createComment` already states as policy: **retry and reset-in-place
are one operation, and "mint a new id because this one is taken" is a different one that only fires
when the id is a stranger's.** `beginRun` needs to tell those apart, not the client.

This also settles [simplification-audit.md §2.4](../plans/simplification-audit.md), which proposes
pulling a shared `useTombstonedList` hook out of `useSearch` and `useComments`. Fix this first. The
two hooks currently *look* symmetric — same `put`, same tombstone, same retry shape — and a hook
extracted from them today would carry the asymmetry in the thing it is not supposed to touch: the
server contract each hook is silently relying on. `useComments.ts` gets away with a bare "resend the
id" retry because `createComment` resets in place; `useSearch.ts` cannot, because `beginRun` doesn't.
Extract the client shape without noticing that, and the shared hook enshrines "retry sometimes forks
a new row," available to whichever *next* tombstoned-list feature reuses it and does not happen to
have `createComment`'s branch either.

## A failing test that reproduces it

Belongs in [`tests/searches.test.ts`](../../tests/searches.test.ts), beside the existing collision
test at line 67 — same fixture, same shape, opposite claim: that beginRun asked with *your own*
already-present id in the file, resets it, rather than reminting.

```ts
it("resets a run in place when the retry sends its own id back, rather than minting a second one", async () => {
  // The shape of a retry: beginRun, then finishRun with an error — the failed
  // row stays on disk, same as any other failure — then beginRun again with
  // the *same* id, exactly what useSearch.ts's retry() sends.
  const first = await beginRun(SLUG, "arguments against the main claim", "spya-k3m9qt");
  await finishRun(SLUG, first.id, { status: "error", error: "the model timed out" });

  const retried = await beginRun(SLUG, "arguments against the main claim", "spya-k3m9qt");

  expect(retried.id).toBe(first.id); // currently fails: mints a fresh id instead
  expect(retried.status).toBe("pending");
  const runs = await loadRuns(SLUG);
  expect(runs).toHaveLength(1); // currently fails: two rows, the error and a new pending one
});
```

Against the code as it stands, `retried.id` is a freshly minted id (not `spya-k3m9qt`), and
`loadRuns` returns two rows rather than one — the exact duplicate-and-stuck-spinner shape above, made
deterministic and model-free.

## What would have caught this earlier, and what should now

**A test for the retry contract itself**, which existed for `createComment` (`src/comments.ts`'s
reset-in-place branch is exercised, in effect, by every test that calls it twice with the same id) but
was never written for `beginRun` — `tests/searches.test.ts` tests the *first* attempt and the
*collision-between-two-different-searches* case thoroughly, and never tests calling `beginRun` twice
with the same id, which is the one call shape retry actually produces. The general form, matching
[half-swapped-message-ids.md](half-swapped-message-ids.md#the-lesson-worth-carrying): a function
copied from a sibling file needs a test for the behaviour that made the sibling safe, not only for the
behaviour the copy was written to add. "The docs comment says why the collision defence is safe" was
mistaken for "the docs comment says why retry is safe" — it doesn't, because the branch it would be
describing was never copied.

**Nothing rearchitected.** The three-file pattern (`comments.ts` / `chat.ts` / `searches.ts`) is sound
and `beginRun` needed one missing branch, not a redesign. The one process change worth stating: when a
new module is "shaped on" an existing one, grep the original for every branch its own tests exercise,
not just the branch the new feature needed — the same advice logging.md already gives for the
`error`-string leak that hit these same three files (comments, chat, and now this file's neighbour in
spirit) one at a time.

## See also

- [search.md](../project/search.md) — the feature this bug is in
- [comments.md](../project/comments.md) — `createComment`'s reset-in-place branch, which this file
  needed and didn't get
- [simplification-audit.md](../plans/simplification-audit.md) §2.4 — the shared-hook proposal this
  bug has to be fixed ahead of
- [half-swapped-message-ids.md](half-swapped-message-ids.md) — the same "the half that was tested was
  the half that worked" shape, one file over
- [silent-success.md](../reusable/silent-success.md) — the pattern: nothing about a stuck spinner
  looks like success, but nothing forced anyone to retry a failed search before now either
