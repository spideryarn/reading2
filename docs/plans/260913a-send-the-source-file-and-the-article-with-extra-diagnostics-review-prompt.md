You are reviewing a PLAN, read-only. Do not change any file.

Repo: this worktree. The plan is committed at HEAD:
docs/plans/260913a-send-the-source-file-and-the-article-with-extra-diagnostics.md

Context files to read (cite line numbers in findings):
- src/feedback.ts (mirrorFeedback — the Sentry mirror)
- src/feedback-envelope.ts (the envelope guard that rebuilds feedback envelopes from a registration)
- src/routes.ts: fileFeedback (~line 6172), parseFeedback (~6073), sendSource (grep "async function sendSource")
- src/store/pg-source.ts (readPdf, sourceReferenceQuery, ownedSlug), src/store/raw-document.ts
- src/store/contracts.ts (SourceStore), src/store/index.ts (loadArticle), src/types.ts (Article ~1534, ArticleMetadata ~2092)
- src/web/FeedbackDialog.tsx (~line 1001, the tick-box), src/web/PrivacyPage.tsx (~465, the bug-report section)
- docs/project/feedback.md § The one rule, docs/project/privacy.md § What a bug report carries, docs/project/logging.md

The conclusion I most want checked: "attaching the original source file and the page's article
payload server-side, only when consented + slug + reporter owns the article, widens nothing a
reader did not consent to, and cannot leak another reader's article." Try hard to break that.

Specific suspicions, lowest confidence last:
1. Does the request's owner context (AsyncLocalStorage owner box) still hold when mirrorFeedback runs
   after `send(res, ...)` in fileFeedback? If not, owner-filtered reads would fail or — worse — run
   unfiltered.
2. Is `loadArticle` genuinely owner-filtered for every path (including public articles and admins)?
3. Does the 10 MiB cap + 20 MB compressed-envelope reasoning hold, including how Sentry's node
   transport and the envelope serialisation handle Uint8Array attachments?
4. Does the Article payload or ArticleMetadata carry anything reader-authored beyond the article
   (notes, comments, chats, profile/purpose text)? The proposed copy promises it does not.
5. Is the proposed reader-facing wording accurate and complete? Is anything promised that the code
   will not do?
6. Is there a simpler design that gets the same value?

Severity scale: P0 (ships a leak or breaks reports), P1 (wrong behaviour or false copy), P2
(worth changing), P3 (nit). Give every finding an ID (R1, R2, …), a severity, file:line evidence,
and a concrete fix. End with a one-line verdict: BUILD AS IS / BUILD WITH CHANGES / RETHINK.
