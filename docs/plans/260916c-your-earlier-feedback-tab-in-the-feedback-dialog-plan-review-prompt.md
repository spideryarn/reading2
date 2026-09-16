# Plan review: an "Earlier" tab in the Feedback dialog

Repo: this worktree. Candidate: commit `0702f495` — one new file,
`docs/plans/260916c-your-earlier-feedback-tab-in-the-feedback-dialog.md`. Read it first. It does not
limit scope.

Then read the code it builds on (reading list, not a limit):

- `src/web/FeedbackDialog.tsx` — the dialog. Note the draft-loss history around `discard`,
  `thanksSeen`, the `useLayoutEffect` open/close sync, the ⌘Enter handler.
- `src/store/pg-feedback.ts`, `src/store/contracts.ts § feedback` — owner scoping via
  `currentOwnerId()`.
- `src/routes.ts` — `fileFeedback`, the `POST /api/feedback` table row (~line 7045), and
  `GET /api/admin/feedback` (~line 6845) for the `no-store` precedent.
- `docs/project/feedback.md`, `docs/project/security-map.md`, `tests/authenticated-api-route-contract.test.ts`.

Do not change any file. This is a read-only plan review.

## What to attack

1. Is the owner scoping of `GET /api/feedback` genuinely the same shape as existing owner-scoped
   reads, i.e. does it change no defence? Anything in the gate/dispatch (e.g. a GET-specific path,
   public routes, caching, `serveApi` headers, the Vercel function split) that makes a new GET on
   this path different from the POST?
2. The client design: hidden-not-unmounted Write panel, view reset on open, ⌘Enter guard,
   generation counter for the fetch, focus management inside a modal `<dialog>` when a panel with
   focus becomes `hidden`. What breaks?
3. Anything the plan does not mention that a test in this repo will trip (route inventories, client
   import allowlists, owner-isolation greps, messages.ts conventions, doc-links).
4. Is there a simpler version that gives Greg the same thing?

## Severity scale and format

P0 data loss / exploitable security / service broadly unusable; P1 user-visible wrong behaviour or
authoritative contract violated; P2 design or maintainability risk; P3 prose. Refuse only on an
established P0/P1 (direct evidence, no unresolved material inference). Give each finding an ID
(F1, F2, …), severity, established/reasoned, file:line evidence, and the fix you recommend. End with
a verdict line: `VERDICT: approve` or `VERDICT: refuse`.

## My own suspicions (worth less; spend most of the run elsewhere)

- Focus: if the textarea has focus and the reader clicks the Earlier tab, focus is on the tab, fine;
  but arrow-key tab switching then `hidden` on a container holding the previously focused element —
  probably fine since the tab has focus.
- Whether `limit + 1` with `order by created_at desc, id desc` has an index.
