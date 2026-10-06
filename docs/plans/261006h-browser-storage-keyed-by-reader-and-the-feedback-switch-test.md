# Browser storage keyed by reader, a second local reader, and the Feedback switch test

Two follow-ups to
[261006f-every-request-is-bound-to-the-reader-at-its-start.md](261006f-every-request-is-bound-to-the-reader-at-its-start.md),
queued as `qi-9wyhwqre` and `qi-5p5c6jhw`. Greg, 2026-10-04, on the Overseer's list of small queued
fixes:

> If you're confident, address all of the Q-queue-yeses

Both come from GPT Sol's code review of 261006f
([261006f-reader-bound-code-review-sol.md](261006f-reader-bound-code-review-sol.md)): finding C7
(P2, reported and deliberately left out of that work), and the Feedback test that was written for
the account switch and never checks it.

## What is wrong today

Two readers, A and B, use one browser profile. A signs out, or B signs in from another tab.

1. **`spya.lastView.<slug>`** ([src/web/last-view.ts](../../src/web/last-view.ts)) holds the query
   string A last had on an article. It carries no reader, so when B opens the same slug at a bare
   address B is put where A was reading, in A's mode. Both can open the same slug when the article
   is public; a slug only one of them owns is refused by the server before this matters.
2. **`spya.search.thoroughPair.<meaningId>`**
   ([src/web/modes/search/stored-pairs.ts](../../src/web/modes/search/stored-pairs.ts)) holds
   `{slug, quickId, meaningId, words}`: the words A searched for. Nothing shows them to B, and
   `tidyPair` checks each record against the loaded rows before deleting anything, but A's words
   sit in storage for as long as B uses the browser, and `storedPairs.of(slug)` hands them to B's
   tab.
3. **Nothing can drive this in a browser.** The local stack has one account that signs in
   (`dev-admin@spideryarn.local`), so no A-to-B switch has ever been driven for real, here or in
   261006f, whose browser checks are still outstanding for that reason.
4. **`tests/feedback-dialog-has-its-reader.test.tsx`** asserts only that the dialog is made for A.
   The case it was written for (switch to B: nothing written as B, A's draft gone) is missing; its
   `writtenAsB` helper was unused and was deleted on 2026-10-06 to green typecheck.

## Stage 1: `qi-9wyhwqre`

### 1a. A second local reader

A fourth entry in `SEEDED_ACCOUNTS` ([scripts/seed-accounts.ts](../../scripts/seed-accounts.ts)):
`dev-reader-b@spideryarn.local`, a fixed id not used anywhere in the tree, `signsIn: true`, **not**
in `ADMIN_USER_IDS`. It shares the machine's generated password file, so there is still one secret
per machine and nothing in git. `npm run db:seed-owner` creates it and proves it signs in, as it
does for the admin; `assertCanSignIn` must stop recording *this* account's address as the admin
address (`writeAdminEmail` is for the admin row only).

[scripts/browser-sign-in.ts](../../scripts/browser-sign-in.ts) learns to sign in as it:
`signIn(page, base, { as: "second" })` and a `--as second` flag, with the same two proofs (the
grant's `sub` is the second reader's id; `/api/library` answers JSON). `devCredentials` stays the
admin by default so no existing caller changes.

For the browser check B needs something on a shelf that A can open too. The simplest thing that
works decides it: whichever of the committed fixtures is already public locally, or, if none is,
`db-seed-dev` is left alone and the check uses `/read/public`. No new seed data unless the check
cannot be done without it; if it cannot, say so here before adding any.

Docs: [supabase-local.md](../project/supabase-local.md) and
[browser-testing-playwright.md](../project/browser-testing-playwright.md) get the second account
and the flag; [auth.md](../project/auth.md) names the storage rule below.

### 1b. Key both by reader

- **Last view.** The key becomes `spya.lastViewFor.<readerId>.<slug>`, with `signed-out` as the
  reader for nobody. `readLastView`, `writeLastView` and `claimFirstOpen` take the reader;
  `useLastView` takes it as an argument from `ArticlePage`'s own `readerId` prop, and it is part of
  the hook's restore identity and of every effect's dependencies. **Not `useMadeFor()`**, which the
  first draft of this plan said: that answer is frozen at mount, and `ArticlePage` is not
  remounted when the reader changes, so B's movements would have been written under A's key (Sol,
  plan review F1). A new prefix rather than a longer old
  one, so an old key can never be parsed as a new one.
- **The legacy key is adopted once, then deleted.** A reader with no new-style entry for a slug and
  a legacy `spya.lastView.<slug>` gets the legacy value moved under their own key, and the legacy
  key removed. Why not just drop the legacy keys: a missing entry is how
  `claimFirstOpen` recognises a first open, so on the deploy day every article every reader has
  ever opened would reopen at the first-open default (Summary) with its position lost. Adoption
  keeps that for the ordinary one-reader browser. Its cost: in a browser two readers share, the
  first to open a slug after the deploy inherits whatever was last written there, once, which is
  today's behaviour one last time. Two tabs that both read the legacy value before either removes
  it both adopt it; that is accepted, not serialised (Sol, F4): it is the same one-time
  inheritance, and a lock in `localStorage` is more machinery than the case is worth.
- **Search pairs.** The record gains `readerId`. The key stays `…thoroughPair.<meaningId>` (a row
  id is unique across readers, and the one-key-per-pair property is why that file is shaped as it
  is). `storedPairs.of(slug, readerId)` returns only that reader's; `add` requires it. Both callers
  change: the tidy in `auto-thorough.ts`, and "Select all" in `SearchMode.tsx`, which forgets
  every pair `of(slug)` returns and must forget only this reader's (Sol, F3). A legacy
  record with no reader is **deleted when read**, not adopted: it holds words, and the only price
  is the documented one, a pair not tidied after a reload. Another reader's record is left alone
  (it is theirs, and they may come back), which means A's words do remain in storage while B uses
  the browser; they are no longer handed to any code running as B. Signing out does not clear
  them, for the same reason the last view is not cleared: the pair is still A's to tidy.

**The simpler option passed over:** clear both families of key on sign-out or on a change of
reader. It is less code, and it loses every reader's place on every sign-out, and it does not
cover the case 261006f is about, where the reader changes in another tab with no sign-out in this
one.

### Tests, each red first

- `readLastView` as B does not return what A wrote for the same slug; as A it still does.
- A legacy key is adopted by the first reader and gone afterwards; a second reader gets nothing.
- `useLastView` **kept mounted** while its reader changes from A to B: B's movements are written
  under B's key and A's entry is untouched; and a fresh mount as B at a bare address is not
  rewritten to A's view.
- "Select all" as B leaves A's pair record in storage.
- `storedPairs.of(slug, B)` is empty after A's `add`; a legacy record is deleted on read.
- The auto-thorough tidy, run as B, deletes no row and leaves A's record.
- The seed: `SEEDED_ACCOUNTS` has a second sign-in account whose id is not an admin id, and the
  admin-email file is written for the admin only.

## Stage 2: `qi-5p5c6jhw`

Test only. In `tests/feedback-dialog-has-its-reader.test.tsx` (or a sibling file if the probe mock
there cannot be lifted for one case): draw the **real** `FeedbackDialog` as A, type a draft, switch
to B, and assert that no non-GET request carries `Bearer TOKEN-B` and that the draft is gone. Seen
red by putting `SignedInReader.Provider` back inside `FeedbackHost` (the pre-`c15e885f0` shape),
then restored. If the real dialog turns out to keep its draft or send as B *with* the fix in
place, that is a defect in 261006f, not in the test: stop and report it rather than weakening the
assertion.

**Sol's plan review (F2) and the builder agreed on the same correction**: typing a draft and
switching schedules no write, so "no non-GET as B" would pass trivially. The write that outlives
the switch is dictation's upload callback (`useReaderTranscriber`), so the test keeps A's callback,
switches, and calls it; and B's own callback is a positive control. The draft is cleared by a
different fix (`key={readerId}` on the dialog, `b005c9f81`), seen red on its own mutation.

## Done

`npm test`, `npm run typecheck`, lint on the touched files; a GPT Sol code review of each stage; a
Sonnet browser check at desktop, iPad and phone widths that signs in as A, moves on a shared
article, signs in as B in the same profile, and finds B at the article's default rather than at
A's place, then A again and finds A's place kept.

## What landed

**Stage 2** landed as `0026fa06e`, as described above.

**Stage 1** landed as planned, with these differences, each found by the builder:

- **A change of reader with the article still on screen.** B is treated as arriving at a bare
  address: the article's own parameters are stripped from the URL, then B's stored view or B's
  first-open default applies. Leaving the URL alone would have shown B where A was and then saved
  it under B's key. A's still-subscribed `save` listener also had to be fenced, or it wrote the
  stripped address over A's place; that has its own red test.
- **Row ids are not unique across readers by construction** (this plan said they were): they are
  minted at random in the browser. So `forget`, `invalidate` and `add` leave a record naming
  another reader alone, and the store is `storedPairsFor(readerId)` so no verb can omit the reader.
- **Search gets its reader from `useMadeFor()`**, which is right there and wrong in `useLastView`:
  the search band is under the access gate, which unmounts on a change of reader; `ArticlePage`
  is not.
- **Only a signed-in reader adopts the legacy key.** A signed-out visit to your own public article
  would otherwise consume it and lose your place.
- **`signOut(page, base)` in `scripts/browser-sign-in.ts`**, because `/login` redirects a
  signed-in visitor, so `signIn` alone cannot change reader in one profile.
- The second reader is `dev-reader-b@spideryarn.local`, `00000000-0000-4000-8000-000000000004`.
  No seed data was added: the local database already holds public articles both can open.

**One behaviour changed that nobody asked for, and it is Greg's to confirm.** A signed-out visit
used to use up an article's first open, so signing in afterwards did not open it at the Summary
default. Signed-out visits are now recorded under `signed-out`, so the reader's first signed-in
open gets the default, and does not inherit the place they reached signed out. It falls out of
keying by reader; keeping the old behaviour needs a special case (adopt the `signed-out` entry on
first sign-in), which reintroduces a small version of the leak this plan closes.
