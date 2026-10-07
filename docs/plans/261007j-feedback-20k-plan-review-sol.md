**The core design is sound, but the plan needs amendments before build.** I found one missed response-size dependency and two verification/documentation gaps. Review was read-only; I changed nothing and ran no database tests.

1. **P1 — Medium: the reader’s “Earlier” tab can now exceed Vercel’s response limit.**  
   [`listMine`](/var/tmp/spideryarn-worktrees/feedback-20k/src/store/pg-feedback.ts:357) returns 50 complete bodies through `GET /api/feedback`. A valid 20,000-character body containing `\u0001` serializes to 120,002 bytes; 50 produce roughly **6 MB**, exceeding [Vercel’s 4.5 MB response limit](https://vercel.com/docs/functions/limitations#request-body-size). The previous cap kept this case below the limit. Include this endpoint in the size work, preserving complete bodies. If returning fewer rows, update [`FeedbackEarlier`’s validation and count wording](/var/tmp/spideryarn-worktrees/feedback-20k/src/web/FeedbackEarlier.tsx:103), which currently assumes `more` means exactly 50 returned.

2. **P2 — Medium: the test plan misses existing fixtures that depend on the old cap.**  
   In [`feedback-route.test.ts`](/var/tmp/spideryarn-worktrees/feedback-20k/tests/feedback-route.test.ts:847), the “past the cap” fixture is **15,300 characters**, so it will become valid. Generate it from the new constant. The “largest report” test still uses three legacy answers totaling 12,000 characters; add the current 20,000-character body with six-byte JSON escapes, maximum screenshot and diagnostics together. For size paging, explicitly test multibyte/escaped bodies, a size boundary inside equal timestamps, and an exhausted final page.

3. **P3 — Low: current documentation and comments need updating.**  
   [`dictation.md`](/var/tmp/spideryarn-worktrees/feedback-20k/docs/project/dictation.md:618) still says Feedback takes 12,000 and raising the database cap awaits Greg’s decision. Comments in `types.ts`, `schema.ts`, `routes.ts`, and the store boundary test describe the legacy fold as equal to the database ceiling, or legacy reports as longer than the current dialog permits. Preserve historical migration files, but update present-tense claims.

The **admin paging algorithm is correct**, provided it returns a contiguous prefix capped by both count and bytes:

- `hasMore = rows.length > returnedCount`, including a cut caused by size.
- Build the cursor from the **last returned raw row**, retaining `createdAtExact` and both primary-key fields.
- Stop at the first overflowing row; return at least one to ensure progress.
- Define the budget numerically. Either 3,000,000 bytes or 3 MiB leaves ample room for commas, wrapper and cursor below Vercel’s ceiling. Assert the size of the complete serialized response.

The existing admin client already follows `hasMore` and `nextCursor`; it needs no change.

I found **no separate body-length cap in email, the Sentry envelope guard, or client draft storage**. The request byte allowance follows the shared constant automatically. Existing Sentry attachment caps leave room for the larger message. The database is written before either mirror, and a failed submission preserves the draft. Unsent drafts remain memory-only, so a full reload can lose them; that is an existing limitation.

**Sentry Relay:** I cannot confirm the deployed service’s behavior for a 20,000-character message. Upstream Relay assigns the feedback context an [8,192-byte budget](https://github.com/getsentry/relay/blob/master/relay-event-schema/src/protocol/contexts/mod.rs), and its [trimming processor](https://github.com/getsentry/relay/blob/master/relay-event-normalization/src/trimming.rs) shortens strings against the remaining budget. That is concrete evidence of truncation risk, though not proof of the hosted ingestion path’s result. Record this evidence in the plan; the complete database row remains authoritative even if Sentry’s copy is shortened.