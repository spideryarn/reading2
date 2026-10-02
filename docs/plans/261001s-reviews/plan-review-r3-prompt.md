# Plan review r3 (new scope): 261001s

Read-only. Candidate: commit 56a0858ba, file
`docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md`, revision 3. Your rounds 1 and 2
are in `docs/plans/261001s-reviews/`. Since round 2 the scope widened at Greg's request: structured
outputs (`output_config.format`, strict JSON schema) become the primary fix for every model call
that expects JSON; the one-re-draw helper is no longer built; plus a survey and rollout, a doc
rule, and a lower-effort re-test. A probe on our wire is summarised in the plan (§ The evidence);
its script is the untracked `evals/paperwork/_probe-structured.ts`.

This is a review of the new scope, not a third round on the old. Attack:

1. Is structured outputs the right primary fix here? Check our Messages wire
   (`src/messages-stream.ts`, `src/openrouter-stream.ts`, how `output_config` is merged at ~line 477),
   the three existing users (`src/pdf-figure-locate.ts`, `src/pdf-frontmatter.ts`,
   `src/paper-metadata.ts`), the cost ledger, and prompt caching (`docs/project/prompt-caching.md`,
   cache groups like arc/tweets). What breaks or costs silently?
2. The probe finding: at effort `low`, with a schema, adaptive thinking went to zero (n=2), against
   ~7k thinking tokens without. Is the plan's response (a quality panel in stage 2, the trade put to
   Greg) adequate? Is the stage-2 shipping gate well defined given this?
3. Stage 1's shared helper: is it the right seam, and what must its tests catch (cycles,
   `additionalProperties`, unsupported keywords like minLength/maximum, the high-power effort merge)?
   Is the starts-only converter design now right per your G1?
4. Stage 3's survey: what criteria are missing (streaming partial parse, citations, refusal/
   truncation handling under a schema, chat-completions vs Messages wire)? Which callers do you
   already expect not to fit, and why? Name files.
5. Ordering and size: is anything here better cut, deferred, or merged? Greg's standing priority is
   value for effort.
6. Anything false.

P0–P3 as before, IDs H1…, file:line evidence, the plan change you want, one-line verdict.
