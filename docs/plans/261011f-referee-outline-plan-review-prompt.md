# Plan review: Referee › Outline (261011f)

You are reviewing a **plan**, read-only, before anything is built. Repo: this worktree. Plan at
commit e2a006517869b0ffc2cfc63c5b8b76ef1c03c72b:
`docs/plans/261011f-referee-outline-your-notes-sorted-major-and-minor.md`. Read it first.

Context to read (start with these; they do not limit scope):
- `docs/project/referee-mode.md` (§ The rules the whole mode obeys, § Mirror, § The five sub-modes)
- `docs/project/comments.md` (§ What a comment is now, § The five operations, § A shared link carries them)
- `docs/project/export.md`
- `docs/research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md` (idea 4)
- Code: `src/store/contracts.ts` (CommentStore), `src/store/pg-comments.ts` (patchColour, patchMark),
  `src/routes.ts` (the `/colour` and `/mark` PATCH routes), `src/store/export.ts` (comment row),
  `src/store/public-reader.ts` (PUBLIC_COMMENTS_WHERE), `src/web/referee-views.ts`,
  `src/web/sub-modes.ts`, `src/web/activation.ts`, `src/web/modes/referee/RefereeMode.tsx`,
  `src/web/useComments.ts` (recolour), `src/web/comment-nav.ts`, `src/db/schema.ts`, `src/types.ts` (Comment).

Do an independent pass. Ask: is the product shape right and minimal; does it really stay out of
Greg's vetoed "draft my referee report" scaffold; is anything a model wrote able to leak into the
copied text; what places that must hear about a new comment field or a new Referee sub-mode does
the plan miss (import path, MCP, Mirror's input, shared links, db:import, tests that enumerate
sub-modes, the command bar, help page); is the data model right (column vs alternative); are there
race or idempotency issues with the new PATCH and the client's per-comment write queue.

Severity scale: P0 (wrong/unsafe, must change before building), P1 (should change), P2 (worth
considering), P3 (nit). Give every finding an ID (F1, F2…), the file/section, and a concrete fix.
End with a one-line verdict: BUILD AS IS / BUILD WITH CHANGES / RETHINK.

Author's own doubts (consider only after your independent pass):
- Should "Not sorted yet" go into the copied text, or be left out?
- Should sorting also be possible in the comment boxes from day one?
- Is "Outline" the right chip name, and is placement after Mirror right?
- A sorted reading note (no criterion) still goes out on a public shared link (without the field).
