You are reviewing STAGE 1 of plan 260913a in this worktree, and you may FIX what you find inside
the stage. Stay narrowly on the task: fix only problems in the stage-1 files listed below,
red-first where a test is involved (write or tighten the test, watch it fail, then fix). Anything
wider you notice — report it, do not fix it. Do not run any git command that writes; the caller
commits. Do not edit the plan doc, src/web/**, or docs/** (stage 2, already reviewed).

The plan is the spec — read § What ships, § What does not change, § Why 10 MiB, § Facts checked,
§ What the plan review changed, and stage 1:
  docs/plans/260913a-send-the-source-file-and-the-article-with-extra-diagnostics.md

Stage 1 is commit 6c5945ff — review exactly `git show 6c5945ff`. Its files are server code:
src/feedback-article.ts (new — the gatherer), src/feedback.ts (mirrorFeedback),
src/feedback-envelope.ts (the envelope guard, now keyed on a server nonce), anything the builder
threaded through src/store/** for the size cap, and tests/feedback-mirror.test.ts (+ any other test
it touched).

The conclusion I most want checked, and would least like to be wrong about:
"The article and source file reach Sentry ONLY when the reader ticked the box AND the report names
a slug AND the reporter owns that article; nothing is read at all otherwise; the reader's profile
and purpose never reach the envelope; and two owners' concurrent reports can no longer get each
other's registration." Try hard to break each clause. In particular:

1. Ownership: the gatherer runs after `send(res, …)` in fileFeedback (src/routes.ts). Is every read
   it makes owner-filtered (loadSource, loadArticle, articleMetadata, and any NEW size-check query
   the builder added — does that one go through ownedSlug too, or does it read raw_sources /
   article_revisions by slug without the owner clause?). tests/owner-isolation.test.ts greps the
   store for unfiltered spellings — does the new code pass it, and would it catch a regression?
2. Consent: can any path call the gatherer, or read a byte, when `report.consented` is false or
   slug is null? When there is no Sentry client?
3. Build, don't copy: is article.json built field by field, and is anything reader-authored in it
   beyond the (disclosed) shelf title? Does anything else in `Article` carry reader text?
4. Caps: 10 MiB source, 5 MiB JSON measured as UTF-8 byteLength, exact bytes attached. Is too_large
   distinguished from failed correctly? Is a 50 MiB object downloaded before being refused?
5. The nonce: minted server-side, never written back into the rebuilt envelope, and an envelope with
   a missing/unknown nonce emptied? Does the guard still write everything from the registration and
   nothing from the envelope? Any regression in the guard's existing guarantees?
6. Never throws / never fails the request: a gatherer failure must still mirror the reader's words.
   Does the added work stay after the response, and inside MIRROR_ACK_MS's intent?
7. Logs: lengths and outcomes only, never bytes or text (docs/project/logging.md).

KNOWN GAP — PLEASE FIX (red first): the gatherer has no timeout. The builder reports that a hung
bucket or database read would hold the Sentry capture until the serverless function itself times
out, so the reader's report — words included — would then never reach Sentry at all. That is worse
than before this change, when a report with no attachments went out at once. Put a ceiling on the
gathering (a small constant beside MIRROR_ACK_MS, whatever is idiomatic here), mapping a timeout
to `failed` for whichever outcome did not finish, so the report always mirrors. Test it with a
loader that never settles.
8. Tests: does each test actually fail if the property it names is broken? Mutate the code to check
   (remove the consented check; copy ArticleMetadata wholesale; key the guard on report_id again;
   check `.length` instead of byteLength) — report which mutations the suite catches.

Run: npx vitest run tests/feedback-mirror.test.ts tests/feedback-route.test.ts tests/feedback-payload.test.ts
plus any test file that imports feedback-envelope, feedback-article or mirrorFeedback (grep). Tests
that need Postgres cannot run in your sandbox — say which you could not run; the caller will.

Severity: P0 (a leak or a broken report), P1 (wrong behaviour), P2 (worth changing), P3 (nit). ID
every finding (S1-1, S1-2, …) with file:line evidence, and for each: FIXED (with the red→green test)
or REPORTED (and why you did not fix it). End with a one-line verdict.
