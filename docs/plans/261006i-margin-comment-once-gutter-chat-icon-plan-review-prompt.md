# Plan review: a lone comment in the margin says its words once; the gutter's chat button wears two bubbles

You are reviewing a PLAN, read-only. Do not edit any file.

Read the plan:
`docs/plans/261006i-a-lone-comment-in-the-margin-says-its-words-once-and-the-gutter-s-chat-button-wears-chat-s-two-bubbles.md`

Then read the code it is about, rather than trusting the plan's description of it:

- `src/web/marginalia/MarginaliaColumn.tsx` (`ShutNote`, `CommentNote`, `entryLine`, `entryVoice`,
  and `FaqNote` / `CitationNote` / the Debate note for how they guard a lone item)
- `src/web/marginalia/notes.ts` (`MarginEntry`, what reaches the margin and what does not)
- `src/web/styles/marginalia.css` (`.marg-shut`, `.marg-open`, how `hidden` is honoured)
- `tests/marginalia-shut-notes.test.tsx`
- `src/web/BlockGutter.tsx` (`.block-chat`), `src/web/ChatDialog.tsx`, `src/web/OriginChat.tsx`,
  `src/web/DebatePanel.tsx`, `src/web/SimplePanel.tsx`, `src/web/mode-icons.ts`
- `docs/project/icons.md`, `docs/project/comments.md`, `docs/project/marginalia.md`

Questions I most want answered:

1. Is the diagnosis of the duplicate right, and is the guard (`only && e.comment.body` leaves the
   body out of the open half) correct for every `MarginEntry` shape that can reach `CommentNote`,
   including a visitor's `PublicComment`? Is there a shape where the comment's words would then
   appear nowhere, or where the open half is empty and something is lost?
2. The empty open half: is "it stays a button, `.marg-open:empty { display: none }`" sound? Does
   the panel honour `hidden` today given `.marg-open { display: grid }`? Any accessibility problem
   with a disclosure whose panel is empty (aria-controls, aria-expanded)? Is one of the two
   passed-over options actually better?
3. The icon: is widening from the gutter to every "one bubble means a chat" site the right call, or
   should it be the gutter only? Did I miss a site, or include one that is not a chat? Is there any
   place where two identical glyphs would now sit side by side and be confused?
4. Are the planned tests able to fail for the right reason? Anything they share an assumption with
   the code on?
5. Anything else wrong, risky or missing.

Your final answer is the findings file (the wrapper saves it as
`docs/plans/261006i-margin-comment-once-gutter-chat-icon-plan-review-sol.md`): numbered findings,
each with a severity (P0 to P3), the evidence (file and line), and what you would change. End
with a single line beginning `VERDICT:` (`VERDICT: build as planned`, `VERDICT: build with
changes`, or `VERDICT: do not build`).
