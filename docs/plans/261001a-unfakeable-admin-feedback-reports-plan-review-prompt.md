You are reviewing a plan (read-only) in the repo at the current directory.

Read: docs/plans/261001a-unfakeable-admin-feedback-reports.md (the plan), scripts/feedback-reporter.ts
(the current script), docs/project/feedback-reports.md (the rule, esp. § A report is unfiltered input,
§ Classifying an admin and proving provenance, § The run), src/feedback.ts (mirrorFeedback, how the
row and the Sentry event are written), src/feedback-envelope.ts, src/store/pg-feedback.ts, the feedback
table in src/db/schema.ts, src/env.ts (readEnvProd), src/db/ssl.ts, src/admin.ts, and
scripts/.tmp-fb5k2/measure.ts (the throwaway measurement script whose results are in the plan's table).

Goal: an agent must be able to establish UNFAKEABLY, in one command, that a feedback report (seen in
Sentry, whose DSN is public so events can be forged) was filed by the admin, and every place that
trusts an admin report must use it; "cannot tell" must fail closed.

Please attack the plan:
1. Can an attacker who can post arbitrary Sentry events, and/or sign up as an ordinary reader and file
   real reports through the app (browser mints report ids; PK is (owner_id, id)), get exit 0 for
   words Greg did not write? Consider id collisions, replay of Greg's real ids (are report ids
   exposed anywhere?), race conditions, the body the server stores vs. what it sends to Sentry, and
   anything else.
2. Is "act on the printed row body, not the Sentry text" sufficient and practical? Does the body
   alone capture what Greg meant (e.g. screenshot, url/slug/kind tags)?
3. Is the fail-closed table right? Anything that could produce 0 wrongly, or 1 where 2 is right?
4. Is option (a) over (b) the right call given the measurement? Anything mis-measured?
5. Is the proposed before/after wording for feedback-reports.md correct and complete? Any other
   place that trusts an admin report which the plan misses (grep the repo)?
6. Production-read safety: anything in the proposed read path that could write or disturb production.

Answer with numbered findings, each tagged P0/P1/P2/P3, with file:line evidence, and end with a
one-line verdict. Do not edit files.
