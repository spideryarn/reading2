# Review: plan 261006f, and the stage 1 code already built from it

You are a read-only reviewer with a **security focus**. Change no file.

## The candidate

- The plan: `docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md` (both stages).
- Stage 1 is built and committed: commit `6ef640e0f`. `git show 6ef640e0f` is the whole diff. Paths:
  `src/web/lib/api.ts`, `src/web/log-buffer.ts`, `tests/api-fetch.test.ts`, `docs/project/auth.md`,
  `docs/project/security-map.md`, `docs/project/web-client.md`,
  `docs/postmortems/261006g-work-made-for-one-reader-outlives-a-change-of-reader.md`, and the plan.
  Start there; it does not limit scope.
- Stage 2 is **not built**. Review its plan only.

Background: `docs/postmortems/261006g-work-made-for-one-reader-outlives-a-change-of-reader.md` and
`docs/project/auth.md` § *A request made for one reader is never sent as another*.

## What to do

1. Attack stage 1 independently first. The threat: two accounts in one browser; another tab signs
   in as reader B while this tab is reader A's. A request made for A must never be sent with B's
   token. Also the opposite failure: a reader's own ordinary request must never be refused.
   Read the installed Supabase SDK (`node_modules/@supabase/auth-js`) where the argument rests on
   its behaviour: the order subscribers are notified in, what `getSession()` reads, how a
   cross-tab sign-in reaches this tab, and whether any event leaves `cachedTokenOwner` naming a
   reader other than the one the screen was drawn for.
2. Run `npx vitest run tests/api-fetch.test.ts` yourself (it needs nothing outside the tree).
3. Review the stage 2 plan: is the list of leaks right, is each proposed fix sufficient, is
   anything a reader's words or money missing, and is "empty the module stores from the auth
   listener" sound.
4. Check the doc edits against the code.

## Severity, and what a refusal takes

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give every finding an ID (F1, F2, …), a severity, and say whether it is **established** (direct
evidence: a failing run, an exact reachable path) or **reasoned**. Refuse only on an established
P0 or P1. End with one verdict line: `VERDICT: approve`, `approve with fixes` or `refuse`.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The sentence I would least like to be wrong about: *"`api.ts` subscribes before any component, so
  `cachedTokenOwner` is never behind the screen that made the call"*. If it can be behind, stage 1
  refuses a reader's own requests, on every page. The plan's § *The retreat* is the fallback.
- A call made while the tab holds nobody is unfenced. Is there a path where that carries reader
  A's words (for example a sign-out event followed by a sign-in as B, with A's page still up)?
- `TOKEN_REFRESHED` or a session object with no `user` sets `cachedTokenOwner` to null, which
  unbinds later calls.
