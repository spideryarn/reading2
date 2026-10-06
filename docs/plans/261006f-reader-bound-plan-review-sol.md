**Stage 1 has a demonstrated false refusal. Stage 2 needs broader coverage before its isolation claims hold.** I changed no files.

`npx vitest run tests/api-fetch.test.ts` passed: **48 tests**. Those tests mock the SDK; the installed SDK exposes an ordering case they miss.

1. **F1 — P1, established: B’s own request can be refused.**  
   [api.ts:541](/var/tmp/spideryarn-worktrees/reader-bound-requests/src/web/lib/api.ts:541) assumes its earlier subscription cannot lag React’s reader. Shared notifications invoke callbacks in registration order, but **`INITIAL_SESSION` is different**: each subscriber independently reads storage and receives its own callback.

   I reproduced this with installed `@supabase/auth-js` 2.112.4 and the actual `apiFetch`:
   - API listener receives A.
   - Another tab’s shared-storage update installs B, before its broadcast is delivered.
   - A newly mounted `useSession` subscriber receives `INITIAL_SESSION` for B.
   - B’s ordinary request binds to cached A; `getSession()` returns B.

   Result: `{"screenReader":"B","exception":"NotThisReader","fetchCalls":0}`.

   The plan’s “never behind the screen” argument is false, and its **retreat condition has been met**. Taking that retreat would restore availability but reopen unnamed-request fencing; the docs must then say so. A durable repair needs React and request binding to consume the same identity snapshot.

2. **F2 — P0, established: the deferred spoken retry can store A’s transcript for B.**  
   The [stage 2 exclusion](/var/tmp/spideryarn-worktrees/reader-bound-requests/docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md:112) assumes A’s thread ID prevents B’s token from opening it. A **first spoken exchange creates its thread**, however.

   [appendSpoken](/var/tmp/spideryarn-worktrees/reader-bound-requests/src/web/chat/effects.ts:275) retries after a gap without `madeFor`. If A’s first attempt fails, B signs in during the gap, and B owns the same article slug, the retry uses B’s token. [`withSpokenTurn`](/var/tmp/spideryarn-worktrees/reader-bound-requests/src/chat.ts:499) accepts an absent thread when `expectedTailId` is null and creates one containing A’s words. I ran that function against an empty thread list and confirmed both transcript strings were retained.

   Fence the entire exchange, including retries, with the reader captured before the first attempt. This is a confirmed cross-account disclosure, not a suspicion to defer.

3. **F3 — P0, established: `/profile` can overwrite B’s profile with A’s text.**  
   [App.tsx:653](/var/tmp/spideryarn-worktrees/reader-bound-requests/src/web/App.tsx:653) mounts an unkeyed `ProfilePage`. Its [`useProfile`](/var/tmp/spideryarn-worktrees/reader-bound-requests/src/web/useProfile.ts:82) neither depends on the reader nor reloads when the reader changes.

   On direct A → B, A’s loaded profile and draft remain mounted. A pending idle save, blur, or departure can send that text to `/api/reader` as B. Stage 1 accepts it because the request is **made after** the switch. The planned `ProfilePanel` cleanup fix misses this page and its ordinary saves.

   Include `/profile`; reset its state on reader changes and fence both ordinary and departure saves with their original reader.

4. **F4 — P1, established counterexample to the plan: known-to-known clearing misses A → signed out → B.**  
   [Stage 2’s clearing condition](/var/tmp/spideryarn-worktrees/reader-bound-requests/docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md:97) covers a change between known readers. Another tab can sign out A and then sign in B; this tab receives null between them. Its module stores survive the signed-out render, leaving A’s drafts available when B opens the same slug.

   Clear on departure from a known reader, including sign-out. Test this sequence separately from direct A → B.

5. **F5 — P1, reasoned: clearing `link-facts` alone permits late refill by A.**  
   [`applyShelf`](/var/tmp/spideryarn-worktrees/reader-bound-requests/src/web/link-facts.ts:339) installs a completed response without checking a reader or invalidation generation. A request already sent as A can finish after the proposed clear and refill the global shelf with A’s entries before B’s read finishes.

   The plan should require invalidating outstanding work and resetting pending/error state. Summaries already have a generation fence through `forgetSummaries`; the shelf needs equivalent protection. Add a test that delivers A’s response **after** the reset.

6. **F6 — P3, established: the postmortem prematurely marks stage 2 closed.**  
   [The new closure statement](/var/tmp/spideryarn-worktrees/reader-bound-requests/docs/postmortems/261006g-work-made-for-one-reader-outlives-a-change-of-reader.md:107) says “both items” are closed, although the reading-view fixes remain unbuilt. Mark stage 1 separately and keep stage 2 open.

The remaining doc edits generally describe the implemented comparison correctly. Their subscriber-order guarantee needs correction under F1.

The reading-view unmount argument is supported by `useArticleAccess`’s synchronous reader check. Capturing the mounted reader is sound for delayed writes **if propagated through every continuation and retry**. Feedback’s retained state also warrants the proposed reader key. The live accounting routes explicitly check session ownership, so I did not establish a path charging B for A’s meter flush. Normal `TOKEN_REFRESHED` handling supplies the returned session; I found no ordinary refresh path that deliberately strips its user.

VERDICT: refuse