Overall: the direction is sound, but the plan is not build-ready. The import detail and save-state UI are straightforward; the one-shot prompt and feedback prefill need tighter state/lifecycle definitions. I found no P0 issues.

## P1

1. Existing articles will be marked for the first-open prompt

[Plan:109](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/docs/plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md:109>) says to mark only a newly completed, silently auto-opened import—not an article already on the shelf.

But [AddPage.tsx:551](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/AddPage.tsx:551>) combines three completion sources: a finished job, `alreadyArticle`, and `articleAnswer`. The auto-open effect at [AddPage.tsx:571](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/AddPage.tsx:571>) does not retain which source completed. URL re-adds are also adopted from the shelf in [jobs.ts:3967](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/jobs.ts:3967>), but that provenance is absent from the public `Job`.

Failing scenarios:

- Uploading a file already retained as an article follows `alreadyArticle`, silently opens, and gets marked.
- Re-adding a URL already on the shelf can produce a normal-looking successful job and get marked.
- `articleAnswer` can similarly represent an existing article.

Fix: make completion provenance explicit, such as `newImport | existingArticle`, across the API/client boundary. Only the `newImport` branch may write the marker. Do not infer novelty from `status === "done"`.

2. “Never touched the box” is implemented as “is not focused right now”

The plan relies on the current condition at [AddPage.tsx:573](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/AddPage.tsx:573>), but `focusedRef` records current focus, not whether the reader ever interacted. It is set back to false on blur at [AddPage.tsx:948](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/AddPage.tsx:948>).

Failing scenario: the reader focuses the empty box, clicks Retry or Report, the box blurs, then the retry succeeds. The completion effect sees an empty, unfocused box and silently opens and marks the article despite the reader having touched it.

Fix: introduce a monotonic `purposeTouchedRef` that changes to true on focus or input and never returns to false for that add attempt. Reset it only when beginning a genuinely different source.

3. Consuming the session marker before the purpose read turns a transient failure into a permanent missed prompt

The plan says the reader “takes” the marker on mount, removing it before `usePurpose` finishes. However, `usePurpose` can return both `failed` and `ready` with `purposeFailed` at [purpose.ts:51](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/purpose.ts:51>).

Failing scenario: the first `/api/reader` request fails temporarily. The marker is already gone, so a reload never offers the prompt.

StrictMode makes a naïve consuming initializer worse: the application mounts under `StrictMode` at [main.tsx:217](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/main.tsx:217>), where initializers/effects are deliberately replayed in development. The second invocation can observe that the first already deleted the marker.

Fix: peek rather than consume initially. Remove the marker only after a definitive result:

- Purpose exists: consume and do not prompt.
- Purpose is definitively absent and the prompt is about to be shown: consume then show.
- Read failed or `purposeFailed`: retain it for a later attempt.

Add a mounted-under-StrictMode test, not only a pure helper test.

4. `useAutosavedText` needs an explicit seed and cannot directly support “Done waits”

The plan says to compose `ProfileBox` with `useAutosavedText`, but an absent purpose leaves the hook unseeded. At [useAutosavedText.ts:140](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/useAutosavedText.ts:140>), `commit()` returns immediately while `saved` and `stored` are null. The hook’s `commit` also returns `void`, not an awaitable save result, at [useAutosavedText.ts:79](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/useAutosavedText.ts:79>).

Failing scenario: the purpose read succeeds with `null`; the reader types and presses Done. Unless the component first calls `seed("")`, the hook remains effectively uninitialised and no save occurs.

Fix:

- On definitive `ready / purpose === null / !purposeFailed`, call `seed("")` exactly once.
- Implement Done as a requested-close latch: call `commit()`, then close only when hook state becomes clean/saved; keep the prompt open on error.
- Base refusal text on hook state rather than awaiting `commit()`.

The existing seed pattern in [Metadata.tsx:605](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/Metadata.tsx:605>) is the useful precedent.

5. “Owner only” must be a component boundary, not a conditional around an unconditional hook

`Reader` serves both owners and visitors, as documented at [Reader.tsx:180](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/reader/Reader.tsx:180>). The established boundary is `OwnedReader` in [ArticlePage.tsx:416](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/article/ArticlePage.tsx:416>).

Failing implementation: `Reader` calls `usePurpose()` for everyone but renders the prompt only when `owner` is true. The visitor test sees no dialog and passes, while visitors still make an owner-only reader API call.

Fix: put the hook inside an owner-only child component or `OwnedReader`, so it is never mounted for visitors. The visitor test should assert no reader-purpose network request, not merely absence of visible UI.

6. The planned feedback body breaks the feedback data boundary

The prefill at [Plan:64](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/docs/plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md:64>) includes the source URL or upload filename and a free-form step error.

The relevant rule is stronger than “none is article prose.” Feedback fields are meant to be reader-typed text, closed vocabulary, or a disclosed page fact at [feedback.md:396](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/docs/project/feedback.md:396>); structured diagnostics use identifiers, closed vocabulary, numbers, and timestamps at [feedback-payload.ts:28](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/feedback-payload.ts:28>). Feedback bodies are forwarded as messages at [feedback.ts:181](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/feedback.ts:181>).

Failing scenarios:

- A pasted source URL contains a private query token.
- An upload filename contains personal information.
- A reader-facing step error later starts incorporating unbounded source/model text.
- The generated prefill plus an existing draft exceeds the dialog’s 4,000-character limit, making Send unavailable.

Fix: prefill only safe identifiers and closed values: job id, slug, status, step name, and timestamps. Keep source URL, filename, and error prose visible on the card but out of the submitted body. If they must be included, that needs explicit disclosure/consent and length limiting, not merely visible prepopulation.

The proposed `href` itself is safe provided it is gated by `isWebUrl`: [urls.ts:37](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/urls.ts:37>) restricts it to HTTP(S), and the plan includes the right `noopener noreferrer`.

## P2

7. Feedback prefill needs a one-request lifecycle

`FeedbackHost` currently exposes only `open(): void` at [FeedbackButton.tsx:105](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/FeedbackButton.tsx:105>), while `FeedbackDialog` deliberately preserves drafts across dismissal at [FeedbackDialog.tsx:503](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/FeedbackDialog.tsx:503>).

A prefill applied in an “open changed” effect can append twice under StrictMode or when the host rerenders. Also, changing an existing Suggestion draft to Problem silently changes the meaning of the reader’s preserved draft.

Fix: open with an immutable request `{ id, kind, prefill }`; the dialog applies each request id once. For a nonempty draft, append safely but preserve its existing kind, or ask before merging. Test StrictMode, closing/reopening, and two different reports in sequence.

`useFeedbackOpen` may legitimately return null at [FeedbackButton.tsx:157](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/FeedbackButton.tsx:157>). Production is wrapped by `FeedbackHost`, but isolated JobCard uses and tests are not. Omit or disable Report when no host exists; do not render a button that throws or does nothing.

8. Error jobs are not guaranteed to have a failed step, and `createdAt` is not “Started”

The `Job` contract explicitly allows a runner failure with no failed step at [types.ts:3110](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/types.ts:3110>). Any helper that non-null asserts a failed step will break on those jobs.

The plan’s example labels `createdAt` as Started, but `Job` has distinct `createdAt` and optional `startedAt` fields at [types.ts:3087](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/types.ts:3087>).

Fix:

- Treat failed step as optional and fall back to job-level status/error metadata.
- Label `createdAt` as Created/Queued, or use `startedAt` when present.
- Add a job-level failure test with no failed step.

9. Relative time does not refresh as the plan claims

[Plan:58](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/docs/plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md:58>) claims the page rerenders on every poll. But identical snapshots are suppressed by `sameJobs` at [jobEngine.ts:132](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/jobEngine.ts:132>), and completed JobCards stop their own clock at [AddArticle.tsx:551](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/AddArticle.tsx:551>). A completed “1 minute ago” value may therefore remain unchanged indefinitely.

Additionally, `timeAgo` switches to an absolute date after 30 days at [relative-time.ts:67](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/relative-time.ts:67>), so rendering it alongside `exactly()` can show the same kind of absolute date twice.

Fix: give visible history a minute-level shared clock, or explicitly accept a frozen completion-relative label. Suppress the second label when `timeAgo` returns an absolute date.

10. A save refusal remains visible after the reader edits the text

`saveAndOpen` records an error phase at [AddPage.tsx:599](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/AddPage.tsx:599>), but `PurposeBox` input changes at [AddPage.tsx:941](</home/greg/code/spideryarn2/.claude/worktrees/fb8a-8c-imports-detail-and-why/src/web/AddPage.tsx:941>) do not clear it.

Failing scenario: Save fails, the reader edits the purpose to correct it, but the new status line still says “Not saved — [old reason]”.

Fix: clear the refusal on the next edit, or associate it with the exact submitted value and show it only while the draft still matches that value.

No files were changed.