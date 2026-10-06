# Code review, security focus: plan 261006f, both stages as built

You are a **reviewer who fixes**. You may write in this worktree. Fix what is inside this work,
narrowly, each finding with a test that you see fail first. **Report, do not fix, anything wider.**
Do not commit. Do not invent quotations from anybody, and do not attribute any decision to a named
person in a doc.

## The candidate

Two commits: `6ef640e0f` (stage 1) and `b005c9f81` (stage 2, which also answers your own earlier
review, `docs/plans/261006f-plan-review-sol.md`, F1 to F6). `git show --stat 6ef640e0f b005c9f81`
lists every path; the tree is clean at `b005c9f81`, so `git diff` afterwards is exactly your work.

The plan: `docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md`. Read it as a
reviewer of its conclusions as well as of the code.

Start with: `src/web/lib/session.ts`, `src/web/lib/api.ts`, `src/web/lib/reader-change.ts`,
`src/web/lib/made-for.ts`, `src/web/useSession.ts`, `src/web/experimental-store.ts`,
`src/web/chat/effects.ts`, `src/web/useChat.ts`, `src/web/App.tsx`, `src/web/FeedbackButton.tsx`,
`src/web/useProfile.ts`, `src/web/useComments.ts`, `src/web/useReadingTime.ts`,
`src/web/link-facts.ts`. That does not limit scope.

## The threat

Two accounts in one browser. Another tab signs in as reader B while this tab is reader A's
(directly, or A signs out and B signs in). Then:

- nothing made for A may be sent with B's token (words, a profile, a comment, a spoken transcript,
  reading time, a paid call);
- nothing A typed or was shown may be shown to B;
- and the opposite failure: a reader's own ordinary request must never be refused, and the page
  must not get stuck refusing.

## What to do

1. Attack it independently first, against the installed `@supabase/auth-js` where the argument
   rests on SDK behaviour. In particular whether the single subscription in `session.ts` plus
   `sessionObserved` really gives the screen and the request fence one answer in every ordering,
   and whether `sessionObserved` can adopt something it should not.
2. Check each of your earlier findings F1 to F6 is actually closed, not just described as closed.
3. Look for late senders this work missed: grep `apiFetch(`, `fetchOk(`, `leavingFetch(` under
   `src/web` for calls made from an effect cleanup, a timer, a retry loop, `pagehide` /
   `visibilitychange`, or a module-level service, that pass no reader. Fix any that can carry one
   reader's words, settings or money to another; list the rest.
4. Run the tests that need nothing outside the tree, at least: `tests/api-fetch.test.ts`,
   `tests/session-one-snapshot.test.tsx`, `tests/use-session.test.ts`,
   `tests/chat-spoken-reader-change.test.ts`, `tests/profile-page-reader-change.test.tsx`,
   `tests/reader-change-empties-the-stores.test.tsx`,
   `tests/reading-view-owed-writes-on-reader-change.test.tsx`, `tests/feedback-dialog.test.tsx`.
   `npm run typecheck` after any edit.
5. Check the doc edits (`docs/project/auth.md`, `security-map.md`, `web-client.md`, the postmortem
   261006g, the plan) against the code.

## Severity, and what a refusal takes

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Every finding gets an ID (C1, C2, …), a severity, **established** or **reasoned**, and whether you
fixed it. Refuse only on an established P0 or P1 you could not fix. End with one line:
`VERDICT: approve`, `approve with fixes` or `refuse`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The sentence I would least like to be wrong about: *"with one subscription the screen's reader
  and the request's bound reader cannot differ"*. Components that get a reader from somewhere other
  than `useSession` (a prop cached in a ref, `lastKnownUser()`, `jobEngine`) could still disagree.
- `sessionObserved` calls subscribers synchronously from inside a `getSession()` continuation.
- `live/meter.ts` flush on stop was left alone on your earlier note that the server checks session
  ownership.
- Known and deliberately not done: `spya.lastView.<slug>` and the thorough-search pair in browser
  storage carry no reader id.
