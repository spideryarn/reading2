## Findings

**F1 — P1 — established: the plan adds a second admin gate and edits a listed defence.**

(a) The candidate protects comments, questions, and `answers` inside ordinary `GET`/`POST /api/feedback` handlers with `isAdmin(user.id)` ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:121)). The authoritative contract says the `/api/admin` namespace check is the whole server-side admin gate ([admin.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/project/admin.md:46), [admin.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/project/admin.md:50)), and the security map lists `src/routes.ts` as a defence ([security-map.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/project/security-map.md:93)). This is exactly the second, remembered-per-handler authorization check that the prefix gate was designed to eliminate, and it is outside the unattended run’s authority.

(b) Replace Decisions 5–6 with:

> Agent comments and questions are available only through routes under `/api/admin/feedback/questions`; replies are posted under that same namespace. They are rows in the existing authenticated route table, behind the unchanged `/api/admin` prefix gate. `GET` and `POST /api/feedback` contain no admin-only branch and no new `isAdmin` authorization check. The builder must not edit `requireUser`, `serveAuthenticatedApi`’s admin-namespace check, or any other listed defence.

---

**F2 — P1 — established: an answer stored as a feedback report is dispatched and displayed as a second report.**

(a) Every new feedback row goes through the Sentry mirror and notice path ([routes.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/routes.ts:7780)). The notice correctly skips an admin ([feedback-notice.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/feedback-notice.ts:195)), but Sentry does not. `listMine` lists every owner row ([pg-feedback.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/store/pg-feedback.ts:377)); `/admin/feedback` selects every row ([pg-admin-feedback.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/store/pg-admin-feedback.ts:240)); and `feedback-unswept` lists any uncovered, non-ignored row ([feedback-unswept.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/scripts/feedback-unswept.ts:344)). Therefore one reply appears both beneath its question and as a new Open report, creates a Sentry feedback event, appears in the admin inbox, and starts a second report workflow. The plan explicitly relies on that fan-out ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:125)) but does not adapt those consumers. Shipped email does not immediately mail it because Greg is an admin.

(b) Replace Decision 6 with:

> Answers live in `feedback_question_answers`, keyed by a minted answer id and question id, with the verified admin owner, body, and creation time. The admin questions endpoint writes and reads them. A read-only sweep command exposes new answers to agents. Answers never enter the Earlier report list, `/admin/feedback`, Sentry feedback, report endings, or shipped-email reconciliation.

This is fewer effective parts than adding a discriminator to `feedback` and teaching every report consumer to exclude or specially render answer rows.

---

**F3 — P1 — established: many seeded questions would not appear in “Needs a decision.”**

(a) The plan gives `shipped` precedence over `waiting` ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:80)), draws a tied question under its report ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:121)), and seeds every current awaiting-approval item ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:224)). Several current questions belong to reports whose notes say `ending: shipped`, including `spya-n8cuqq`, `spya-ar65p3`, and `spya-jghnva` ([awaiting-approval.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/awaiting-approval.md:16), [dictation note](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/user-feedback/261006_2202-dictation-cut-off-at-five-minutes-with-no-sign.md:1)). Those reports remain in Shipped, so their questions are absent from the place Greg was told holds questions needing him.

(b) Replace the placement rule with:

> The Needs a decision view begins with every open question, whether report-linked or free-standing. A linked question shows the report’s `#number` and can expand or link to that report; it does not depend on the report itself matching the waiting filter. Report status and question status remain separate facts.

---

**F4 — P1 — established: the non-admin status change exceeds the request and contradicts the current Ignore contract.**

(a) Both source reports are Greg’s ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:12)), but the candidate deliberately sends all four statuses to non-admin readers, including `aside` derived from `ignored_at` ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:96)). Today the contract says Ignore changes nothing a reader sees ([feedback.md](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/project/feedback.md:683), [schema.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/db/schema.ts:5488)). The plan’s claim that the four statuses say nothing a note does not already decide is also false for an ignored row: that fact comes from the database, not a note.

(b) Replace with:

> The four-status view, comments, and questions are an admin enhancement to Greg’s Earlier tab. Other readers retain All · Shipped · Not shipped and receive no `ignored_at`, declined/awaiting classification, agent comment, or question. Showing richer outcomes to report owners is a separate product decision.

---

**F5 — P1 — established: `waiting` before `aside` makes an explicitly ignored report still demand a decision.**

(a) The proposed precedence is shipped → waiting → aside ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:80)). If an awaiting report is later marked Ignore, `feedback-unswept` drops it from the queue ([feedback-unswept.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/scripts/feedback-unswept.ts:147)), but Earlier still says Needs a decision. The two operational surfaces then give opposite instructions.

(b) Replace the precedence with:

> Status is `shipped` when the combined ending is shipped; otherwise `aside` when `ignored_at` is set or the ending is declined; otherwise `waiting` when the ending is awaiting; otherwise `open`. An ignored row without a note comment shows the fixed explanation “Set aside from /admin/feedback on \<date\>.”

---

**F6 — P1 — reasoned: the number migration omits advancing the sequence past the backfill.**

(a) The migration recipe says backfill numbers, then add the sequence default, `not null`, and uniqueness ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:197)). If the backfill writes `1…N` without consuming or advancing the sequence, the next old-server insert receives `1` and fails the unique index. The suspected between-statement race is not the problem: Drizzle applies all pending migrations in one transaction ([deploy-checks.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/scripts/deploy-checks.ts:58)), so live inserts wait and then see the default.

(b) Replace the migration wording with:

> Create the sequence first; backfill in total `(created_at, owner_id, id)` order while consuming `nextval`, or explicitly `setval` it to the backfilled maximum. Then attach the default, add `not null` and uniqueness, and test that an insert made by unchanged pre-deploy code receives a number above every backfilled row. The migration is atomic, so no live insert can occur between those statements.

---

**F7 — P1 — reasoned: the production-reading scripts need old-schema compatibility before deployment.**

(a) Stage 1 changes `feedback-unswept` and `feedback-reporter` to select/print `number`; Stage 2 adds `answers` ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:204), [plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:223)). Those scripts run from `dev` against production before the next deployment. A direct reference to either absent column makes provenance and the unswept sweep fail. The existing `ignored_at` code documents and handles precisely this window ([feedback-unswept.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/scripts/feedback-unswept.ts:317)).

(b) Add:

> Production-reading scripts must work both before and after each migration. Read optional new columns through an absent-safe projection such as `to_jsonb(f)->>'number'`/`answers`, and keep `spya-` lookup working against the old schema. Numeric lookup before deployment must fail with a specific “numbering is not deployed yet” result, not make every report unverifiable.

---

**F8 — P1 — established: the plan immediately creates two authoritative homes for each open question.**

(a) The plan puts the same questions in both `awaiting-approval.md` and individual question files ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:180)), then defers reconciling those homes ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:240)). That directly violates the repository’s “one home per fact” documentation rule and creates divergent `open`/`answered` states.

(b) Replace with:

> Question files become the sole live record in Stage 2. The active “Waiting on Greg now” section of `awaiting-approval.md` is replaced by a signpost to the question directory, and the sweep reads those files directly. Historical answered material may remain where it is.

---

**F9 — P2 — established: the pill counts cannot retain their current meaning once free-standing questions are added.**

(a) The plan adds report-free questions to the Needs a decision count ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:121)). Today counts are counts of reports, `all = shipped + unshipped`, and the validator checks both that equality and list length against the selected count ([FeedbackEarlier.tsx](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/web/FeedbackEarlier.tsx:93)). Adding a question to one status but not All makes the arithmetic false; adding it to All makes “N reports” false even though the question is not displayed there.

(b) Replace with:

> Pill counts remain report counts. Needs a decision separately shows “N open questions” beside or beneath its report count. Question cards do not participate in report pagination, `more`, or the sum of report-status counts.

---

**F10 — P2 — established: the comment-selection rule has no answer for an incomplete split report.**

(a) The plan says to use the comment from the note whose ending decided the combined ending ([plan](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/docs/plans/261007d-earlier-tab-says-what-became-of-each-report-numbers-them-and-asks-greg-questions-in-place.md:92)). But `combineEndings` returns `awaiting` when fewer notes exist than `parts`, even if every existing note says `shipped` or `declined` ([feedback-endings.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/scripts/feedback-endings.ts:124)). There is then no awaiting note whose comment can be selected.

(b) Replace with:

> Comment selection mirrors combination: newest explicit awaiting note; otherwise, when `notes.length < parts`, the newest note declaring the maximum `parts`; otherwise newest shipped note for shipped; otherwise newest declined note. A test covers a lone `ending: shipped, parts: 2` note.

---

**F11 — P2 — established: Decision 8 asks an already-answered compatibility question and misses the opposite direction.**

(a) The current old-client validator ignores surplus report and response fields, so an old client already tolerates a new server that preserves `shipped` and the old count keys ([FeedbackEarlier.tsx](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/web/FeedbackEarlier.tsx:93)). The real uncovered skew is a new strict client reading an old server without `number`, `status`, or `questions`, especially after rollback; a new reply client posting `answers` to the old exact allowlist is refused at `[fb-field]` ([routes.ts](/var/tmp/spideryarn-worktrees/fbcnbv8f-earlier-tab-deferred-and-ask/src/routes.ts:7635)).

(b) Replace Decision 8 with:

> Old client → new server is compatible because the current validator permits extra keys; preserve `shipped`, `counts.shipped`, `counts.unshipped`, and `?show=unshipped`. New client → old server is handled explicitly as a legacy response: render the old three-filter view when new fields are absent. Question replies use the admin endpoint and retain the draft with a reload/retry message if that endpoint is unavailable.

The generated comments/questions remaining server-only is sound provided no client module imports either generated file. The migration is also not an unattended production write: the Overseer applies it during deployment, while Greg’s reply is the user-originated write.

VERDICT: refuse — established P1 findings F1–F5 and F8 show an unauthorized second admin gate, answer rows entering unrelated report machinery, shipped questions missing from Needs a decision, and contradictions with the current visibility and queue contracts.