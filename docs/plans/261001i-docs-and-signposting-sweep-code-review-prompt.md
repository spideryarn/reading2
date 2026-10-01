# Stage review: docs and signposting sweep (stages 2–4)

You are reviewing **and fixing**, in this worktree, the committed change `4a7862f3..cb24adb7`
(`git diff 4a7862f3 cb24adb7`). It is almost entirely documentation, plus comment-only header changes
in eight `src/` files and one new test in `tests/doc-links.test.ts`.

Read first: `docs/plans/261001i-docs-and-signposting-sweep.md` (the plan, Sol's plan review and how
each finding was settled — especially R3, the approval boundary), `docs/reusable/documentation-policy.md`
(the standard; its diff is part of this change), `docs/reusable/edit-important-docs.md`.

**Do not open** `docs/plans/261001i-probes/holdout-tasks.md` or any `key-H*` / `before-H*` file there;
they are a held-out measurement.

## What to check

1. **Truth.** The writers replaced stale claims about the code with new claims and citations. Sample
   them hard — especially `architecture.md` (the pipeline diagram, § Shared code (server), the
   counts replaced by citations), `web-client.md` § Shared code (client), `comments.md` § streaming,
   `database.md`, `ai-gateway.md`, `ingest-queue.md`'s new lead block, `email.md`, `mode.md`'s
   new sections, `url-state.md`'s new parameter rows, and the new `debate.md`, `structure.md`,
   `tweets.md`. For each claim you check, open the code: does the cited file hold the cited symbol,
   and does the sentence say what the code does? A wrong signpost is worse than none.
2. **Rule wording that slipped through.** Under R3, a sentence that tells an agent to do something
   new, or changes what a rule says, should not be in this diff except in
   `documentation-policy.md` (Greg asked for that one by name). Find any such sentence in the other
   files. Don't fix these by deleting knowledge: revert only the instruction-shaped wording, and list
   each in your answer so it can be added to `docs/plans/261001i-probes/proposals.md`.
3. **Greg's quotes.** Each new blockquote attributed to Greg: is it verbatim from the cited source
   file, with the right date? Grep the source. A quote that is not verbatim is a P1.
4. **Moves kept their wording.** `sketch.md` and `illustrated.md` were cut from `diagram.md`;
   `debate.md`, `structure.md` and `tweets.md` took paragraphs from `reading-view-overview.md`. Did
   anything get lost or changed in the move?
5. **The new test** in `tests/doc-links.test.ts` ("links each claimed doc back up to its owner" and
   its control). Run `npx vitest run tests/doc-links.test.ts`. Is it sure (no false positives),
   cheap, and could it go green while the property is false? Mutate it once to see it go red.
6. **`documentation-policy.md`.** Is each new paragraph general (no project specifics — it is a
   reusable doc), true, and short? Is anything in it redundant with what was already there?
7. **The `src/` header comments** — comment-only? Do the bare `doc.md#anchor` references resolve?

## How to work

Fix what is inside this change, narrowly: a wrong citation, a misquote, a broken claim, an
instruction that slipped in. Report — do not fix — anything wider. No code changes beyond comments.
Do not commit. Run `npx vitest run tests/doc-links.test.ts` after your edits.

Severity scale: P0 (wrong in a way that will mislead agents into breaking something), P1 (a false
claim, a misquote, or rule wording without approval), P2 (worth changing), P3 (nit). Give each
finding an ID (C1, C2, …), the severity, file and section, the evidence, and whether you fixed it.
Lead with the highest severity. Under 150 lines.
