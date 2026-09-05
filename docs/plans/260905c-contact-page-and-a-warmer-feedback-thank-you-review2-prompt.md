# Review, round 2 — narrowly scoped to the fixes for F1–F4

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/feedback-contact-page`, branch
`worktree-feedback-contact-page`. React 19 SPA, TypeScript + ESM, vitest under jsdom.

**This is not a fresh review and discovery is closed.** You refused round one on F1 as an established
P0. This round is the narrowly scoped check of *the fixes for the four findings you raised*, and
nothing else. Treat the fixes as unreviewed code written by someone else.

## The candidate

Live pre-commit; base `15f2cb39963b735c6243cee0b5da69976bbeab41`, same manifest as round one. The
files whose fixes you are checking:

```
src/web/FeedbackDialog.tsx      F1, F2
src/web/ContactPage.tsx         F3
src/web/SiteFooter.tsx          F4
docs/project/website-text.md    F3, F4
tests/feedback-dialog.test.tsx  the red→green tests for F1 and F2
```

Untracked new files: `src/web/ContactPage.tsx`,
`docs/plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md`, this prompt, and your round-one
answer at `docs/plans/260905c-contact-page-and-a-warmer-feedback-thank-you-review-sol.md`.

## Previous findings

| ID | Finding, verbatim (abbreviated to its claim) | Disposition | What changed |
|----|---|---|---|
| F1 | successful submission can erase words that were never filed | **fixed, narrowly** | The `sent` stage now carries `sentBody`, the body as posted. The reset effect calls `discard(body !== stage.sentBody)`, and `discard(keepDraft)` leaves the body, kind, consent and screenshot alone when `keepDraft` — it still mints a new `reportId` and returns the stage to `editing`. A second guard, `thanksSeen`, stops the effect firing for a report that landed while the dialog was shut, so the reader reopens onto the thank-you rather than an empty box. |
| F2 | a late screenshot enters the next report | **fixed** | `shotGeneration` moved above `discard`, and `discard` bumps it. |
| F3 | the contact page makes false telemetry/UI claims | **fixed** | The visible paragraph now begins *"If you are signed in"* and claims only that the report carries that page's address. The doc sentence now puts passage ids, recent requests and the Vercel id behind the tick-box, and leaves only the address and the article slug in the always-on set. |
| F4 | several count comments are already false | **fixed differently from your suggestion** | The counts are **deleted** rather than corrected, in `SiteFooter.tsx` and in the plan. Two of them had already been wrong once each for the same reason. |
| — | the deferred half of F1 | **disagreed / deferred, named** | After a *failed* send, an edit and a retry carry the same `reportId`, and `src/store/pg-feedback.ts` answers `duplicate` with the row it already holds, so the edit is dropped server-side. Same lost-update class, also older than this change. Closing it needs the payload snapshot, the immutable form and an explicit *Start a new report* that you described — a redesign of this dialog rather than a guard, and outside what either user report asked for. It is written down as a deferral in the plan doc's § What the review changed. |

## What to check, and only this

1. **Does the F1 fix actually close the sequence you reproduced?** Type `A`, Send, edit to `A+B`
   while the request is open, resolve it successfully, dismiss the thank-you. Is `A+B` still in the
   box, and does the next Send file it under a *different* `reportId`?
2. **Does either new guard introduce something worse?** In particular: can the reset effect now fail
   to fire when it should, leave a stale thank-you, loop, clear a draft it should keep, or keep one
   it should clear? `thanksSeen` is a ref written inside the same effect that reads it — say if that
   is wrong.
3. **Does the F2 fix close it, and does bumping `shotGeneration` inside `discard` break any other
   caller of `takeFile`?**
4. **Are the new F3 sentences now true of the code** — the page's paragraph and the doc's paragraph,
   both. Check them against `src/web/App.tsx`, `src/web/FeedbackButton.tsx` and
   `src/feedback-payload.ts` rather than against my description.
5. **Are the two new tests honest?** They are meant to be red without the fix and green with it; I
   ran both arms and they were. Are they asserting the thing that matters, or something adjacent?

## What you can and cannot run

Tree read-only for you; `/tmp` writable. `npx vitest run tests/feedback-dialog.test.tsx` works and is
worth running. No network, not even loopback. `npm test` and `npm run typecheck` are mine: typecheck
is green, and the full suite has four failures, none of them in a file this change touches (two need
`npm run build` to have produced `api-dist/`, one is a timing ratio that passes when run alone, and
one is `tests/jobs.test.ts` drifting against `store-migration-registry`, inherited from the base
commit).

## Severity and refusal

Same scale as round one: **P0** data loss, exploitable security, incorrect charging, or the service
broadly unusable; **P1** user-visible wrong behaviour or an authoritative contract violated; **P2**
design or maintainability risk with no wrong behaviour today; **P3** non-behavioural prose defect.

Give every finding an ID. **Reuse F1–F4 only for the same finding**; number anything new from F5, and
note that new findings outside the five checks above are out of scope for this round and will be
recorded rather than acted on.

Refuse only on an **established** P0 or P1 *in the fixes themselves*.

Do not change any file.
