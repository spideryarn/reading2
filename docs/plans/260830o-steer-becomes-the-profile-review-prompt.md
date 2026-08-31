# Review prompt: deleting the summary steer

Adversarial review of **built code**, before it is committed. I want what is wrong, not a summary.

Working directory is the repo root.

## What this change is

The summary panel had a free-text **steer** — *"What are you reading this for?"*, placeholder
*"e.g. I care about the evidence, not the history"* — beside the button that rewrites the summaries.
The reader profile's per-article half asks *"Why you're reading this one"*, placeholder *"e.g. I want
the evidence, not the history"*. One question, asked twice, with a precedence rule in `SYSTEM`
between the two answers.

Greg deleted the steer (2026-08-30): *"No need for a Summary-specific steer"*, and *"I don't care if
we lose existing data as a one-off"*. The profile already reaches the summary prompt and
`useProfile: false` already withholds it, so the behaviour he asked for was the existing plumbing
minus a duplicate box.

## What to read

- **The diff:** `/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/b36c98ed-ec65-4770-916b-26bfe8f11401/scratchpad/steer.diff`
- **The plan:** `docs/plans/260830o-steer-becomes-the-profile.md`
- **The doc:** `docs/project/reader-profile.md` § *There was a third box*
- Neighbours worth having open: `src/profile.ts` (`PROFILE_RULES`, `profileSection`),
  `src/summarise.ts` (`SYSTEM`, `renderPrompt`), `src/jobs.ts` (`workKeyFor`, `sameWork`,
  `enqueue`), `src/routes.ts` (`parseJobRequest`, `checkUploadOrigin`), `src/db/schema.ts` (jobs).

## The judgment call I made, which is the thing most worth attacking

`SYSTEM` carried a section for the steer — `IF THE READER ASKS FOR SOMETHING IN PARTICULAR` — and
Greg's original ask for the box had been *"make sure the LLM doesn't overweight this and give a
really distorted summary"*. Deleting the rules along with the box would have answered a request by
removing what satisfied it.

I read its five clauses against `PROFILE_RULES` and judged that **two had no equivalent**:

- *Never add, sharpen, or bend a claim to fit the request. If the article does not say it, it does
  not go in.* — `PROFILE_RULES` had only the general *"it never changes what the article says"*.
- *Keep the article's own proportions. A request cannot promote a passing remark into the main point
  of a section.* — `PROFILE_RULES` had **nothing about proportions at all**.

So those two moved into `PROFILE_RULES`, reworded from "a request" to "a description of the reader".
The other three I judged already covered.

**Check that reading clause by clause.** Was I right that three were covered — or have I dropped a
constraint by deciding it was a paraphrase of one that is weaker? And are the two I moved reworded
in a way that still bites, given they now sit in a list about *who the reader is* rather than about
*what they asked for*? The steer was a request; a profile is a description. A rule phrased for one
may not land on the other.

Also: `PROFILE_RULES` is now appended to five prompts rather than one. Does either new clause do
harm in the glossary, chat, explain or tweets — e.g. does "keep the piece's own proportions" mean
anything coherent for a glossary entry or a chat answer, or is it noise that dilutes the rules
around it?

## What else I want attacked

Rank by damage; give the concrete sequence, not the category.

1. **The positional-argument hazard.** `workKeyFor(names, forced, guidance?, profile?, upload?, url?)`
   and `sameWork(job, names, forced, guidance?, profile?, upload?, url?)` both lost their third
   parameter, and `guidance` and `profile` were **both `string | undefined`** — so a call site left
   with its arguments shifted would compile and would hash the profile into the upload slot. Same
   for `write(force?, guidance?, useProfile?)` → `write(force?, useProfile?)`, where the types do
   differ. Find any call site, in `src/` or `tests/`, that is now passing the wrong thing.
2. **`sameWork` / `workKeyFor` must agree.** They are held together by a grid in
   `tests/jobs.test.ts`. Two of that grid's rows differed only in `guidance`; I replaced them with
   two that differ only in `profile` so the intent dimension is still exercised rather than
   collapsing into duplicates of row zero. Is the grid still able to distinguish a comparison that
   reads a field from one that ignores it?
3. **`guidance` is now ignored rather than refused.** `parseJobRequest` drops it silently, and
   `checkUploadOrigin` no longer lists it among the fields an upload request may not carry. Is
   ignoring right in both places? Is there a path where a `guidance` still reaches a prompt, a job
   row, or a stored artefact — and note the cap and the type check went with `readGuidance`, so
   anything that *did* still carry it would now carry it uncapped.
4. **The database column stayed.** `jobs.guidance` is nullable and is now neither written nor read;
   dropping it is a migration against real data, which is Greg's call. Is leaving it actually safe —
   any NOT NULL, any index, any `select *`, any export/import path, any parity test between the
   filesystem and Postgres stores that compares whole rows?
5. **Old artefacts still carry `guidance` inside their stored JSON**, and `Summaries` no longer
   declares the field. Two leak tests keep it via a cast, on the argument that the state is real
   rather than invented. Does anything else read a `Summaries` in a way that now type-lies about
   what is in the row — the public projection, the Postgres read seam, an export?
6. **A bug I found and fixed while deleting.** `SummaryPanel` called
   `owner.write(true, guidance)` — no third argument — so `useProfile` defaulted to `true` and
   unticking "Use your profile" before "Write them again" wrote a profiled artefact anyway, stamped
   with a `profileHash` the reader had just declined. Check the fix is complete and that no sibling
   panel (glossary, ideas, tweets, chat) has the same shape.
7. **The tests.** Which of the new or changed ones would pass against a real bug of the kind it
   names? I mutation-tested three (both moved clauses deleted → red; a steer header left in the
   renderer → red). I did **not** mutation-test the jobs grid, the upload-ignores case, or the
   `useProfile`-reaches-the-request case. Say which of those is weakest.
8. **Anything the plan and I both missed.** The CLI's `argv[3]`. The `guidance` still named in a
   historical comment in `types.ts` about a past disclosure bug (deliberate — it is accurate
   history). Docs that still describe a box that no longer exists.

Do not restate the code back to me. Where you agree, one line and move on.
