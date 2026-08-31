Do not commit yet.

1. **BLOCKER — the moved claim rule breaks other profiled features.** `PROFILE_RULES` now ends with “If the piece does not say it, it does not go in” ([profile.ts:192](/Users/greg/Dropbox/dev/experim/spideryarn2/src/profile.ts:192)). That directly contradicts:

   - Ideas’ valuable `assumed` half: the piece “never states it” ([ideas.ts:608](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ideas.ts:608)).
   - Glossary background: explicitly knowledge outside the article ([glossary.ts:857](/Users/greg/Dropbox/dev/experim/spideryarn2/src/glossary.ts:857)).
   - Explain’s web/external-context path ([explain.ts:195](/Users/greg/Dropbox/dev/experim/spideryarn2/src/explain.ts:195)).
   - Chat’s web, library, and reasoning answers ([converse.ts:323](/Users/greg/Dropbox/dev/experim/spideryarn2/src/converse.ts:323)).

   The shared rule appears last, so with a profile enabled the model can obey it by omitting every assumed idea or refusing the missing context Explain exists to provide. It reaches seven consumers, not five: Ideas and Sketch were missed too.

   Keep “never add/sharpen/bend what the piece says,” but scope it to claims attributed to the piece. The absolute second sentence belongs only in Summary/Tweets.

2. **HIGH — old steered summaries become undisclosed but remain current.** Existing `summary/3` JSON still contains `guidance`; this change removes its only visible explanation while leaving `PROMPT_VERSION` at `summary/3` ([summarise.ts:98](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:98)). The read path’s `stale` test compares only the article hash ([summarise.ts:757](/Users/greg/Dropbox/dev/experim/spideryarn2/src/summarise.ts:757)). Sequence: reader generated an economics-steered summary → deploy lands → identical prose still displays → no steer or stale indication explains its bias. That recreates the exact provenance failure the old design guarded against.

   Bumping to `summary/4` is necessary but insufficient because `SummariesResponse` has no `outdated` state. Explicitly hide/discard legacy guidance-bearing summaries, or retain read-only provenance.

3. **HIGH — all persisted consumers missed prompt-version bumps.** The shared system prompt changed, but `summary/3`, `glossary/3`, `tweets/2`, and `ideas/1` stayed fixed. The sharpest failure is Glossary: “Find more” accepts an existing `/3`, appends entries generated under the new rules, and stamps the mixed artefact `/3`. Ideas is especially material because the new rule changes what an idea may be. Sketch has a latent versioning hole: its documented prompt version is currently unused.

4. **MEDIUM — the owning doc still says the deleted feature is live.** [summaries.md:522](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/summaries.md:522) still documents the box, old SYSTEM section, `Summaries.guidance`, cap, and `sameWork` rule in present tense. [reader-profile.md:243](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/reader-profile.md:243) also says profile is carried “exactly as guidance already is.” Several source comments remain similarly stale, including [useStepJob.ts:77](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useStepJob.ts:77) and the orphaned comment at [jobs.ts:1140](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1140).

5. **LOW — the client deletion is incomplete.** `useStepJob` still accepts, trims, and posts `guidance` ([useStepJob.ts:188](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useStepJob.ts:188)). The server drops it before enqueue, so it cannot currently reach a prompt, row, or artefact, but the supposedly removed wire path remains and the test mock blesses it.

Clause audit:

- “Do not answer the reader’s question” was not preserved. “Never address/mention them” is weaker; arbitrary purpose prose can still act as a second request.
- “Lead with/give room where genuinely relevant” is covered.
- “Where irrelevant, write normally and never say so” is covered near-verbatim.
- “Never bend a claim” is worth retaining, but its shared rewording is unsafe.
- Proportions already existed in `profileSection` ([profile.ts:240](/Users/greg/Dropbox/dev/experim/spideryarn2/src/profile.ts:240)). The new SYSTEM wording strengthens it but is noisy for Chat/Explain, where focusing on a passing remark is often the requested task. Phrase it as “do not represent a passing remark as the piece’s main point.”

Tests:

- Weakest: the new `useProfile` test calls `useSummaries.write` directly ([step-job-force.test.tsx:213](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/step-job-force.test.tsx:213)). Reverting the actual panel call to `owner.write(true)` leaves it green.
- The jobs grid catches one implementation reading profile while the other ignores it, but both ignoring profile still passes ([jobs.test.ts:697](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs.test.ts:697)).
- The upload-ignore test adequately catches refusal or propagation.
- The no-steer panel test omits the `status: "none"` rendering branch.

Checked and okay: all positional call sites are shifted correctly; all three SummaryPanel calls now pass `withProfile`; sibling panels do too; ignoring stale-client guidance is safe in both request shapes; the nullable, unindexed database column is safe to leave; public projection still drops legacy guidance; export deliberately preserves it. Targeted tests and typecheck exited successfully.