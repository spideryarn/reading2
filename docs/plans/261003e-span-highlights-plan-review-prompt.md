# Plan review: 261003e span highlights with a colour

You are reviewing a PLAN, read-only, at commit 66a93c36f in this worktree. The plan is
docs/plans/261003e-span-highlights-with-a-colour.md. Read it first, then the code it touches:

- docs/project/comments.md (§ What a comment is now, § Anchoring, § One <mark> per text node, § Every mark says which of three it is, § Deliberate limits, § A shared link carries them)
- src/web/annotate.ts (annotateHtml, resolveMark, MarkKind), src/web/selection.ts
- src/web/TableView.tsx onMouseUp (around line 1388), src/web/reader/Reader.tsx selectProse (around line 2108)
- src/web/AnnotateDialog.tsx, src/web/CommentDialog.tsx, src/web/comment-nav.ts (commentKind)
- src/routes.ts comment routes (header comment near line 53, PATCH …/mark), src/store/pg-comments.ts, src/types.ts Comment
- src/web/styles/annotations.css § mark.cmt, styles/tokens.css
- docs/project/block-ids.md, docs/project/security-map.md (the public projection of comments)

Questions to answer:
1. Is "a highlight is a comment with a nullable colour" the right model, or does it break an
   invariant (constraints such as comments_whole_block_is_free, the share projection, the sweep,
   linkThread, export) in a way the plan misses?
2. Is the overlap rule (newest comment's colour wins, all ids still listed) implementable in
   annotateHtml as it stands, and is it right? Is "no ✳ on a wordless highlight" safe for the click
   paths (a wordless highlight must still open on click)?
3. The floating selection menu: what will go wrong, given how onMouseUp/selectProse/AnnotateDialog
   interact today (focus, Escape ownership across surfaces, the selection being left alone, the
   "loaded" gate on save, visitors, Referee mode)? Name the specific seams.
4. Anything simpler that gets most of the value.
5. Anything the plan should defer that it doesn't, or vice versa.

My own suspicions, last: the one-press save must respect useComments' `loaded` gate the way
AnnotateDialog's Save does (docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md);
and a stale menu could save against a passage the reader has since moved away from.

Severity: P0 (data loss/security), P1 (wrong behaviour a reader will hit), P2 (worth fixing),
P3 (nit). Give each finding an ID (S1, S2, …), a severity, the file/line evidence, and a concrete
change to the plan. End with an overall verdict: build as planned / build with changes / rethink.
