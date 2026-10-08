# GPT Sol plan review: 261008i, text styles for the recurring lines in a mode band

You are reviewing a plan, read-only. Do not edit any file. Write your answer as your final message.

Repo: this worktree (Spideryarn, a reading app). The plan is
`docs/plans/261008i-text-styles-for-the-recurring-lines-in-a-mode-band.md` (untracked file; read it
from disk). Background: `docs/plans/261006k-text-size-adjust-for-a-landscape-phone-and-a-quick-review-of-fonts-and-sizes.md`
§ The quick review and § Questions for Greg, `docs/user-feedback/questions/q-dhnbhw.md`,
`docs/project/typography.md`, `docs/project/fonts.md`, `src/web/styles/tokens.css`, and the band
stylesheets in `src/web/styles/` (skim, timeline, faq, glossary, quiz, quotes, ideas, citations,
debate, referee, summary, mode-band). The design page is `src/web/DesignPage.tsx`.

Greg's instruction is quoted at the top of the plan: steps toward a small set of named text styles
that new modes reuse, without disrupting what looks fine, with lots of screenshots.

Please check:

1. Are the five roles the right cut? Is any one not a real recurring job, or is a real one missing
   (look at the stylesheets yourself)? Is each selector in the table actually doing the job it is
   listed under (read the components in `src/web/` where a class name is ambiguous)?
2. Are the values sensible, given the faces (author serif, the model's IBM Plex Mono, Geist chrome)
   and given the aim of minimal visible change?
3. The scope cuts (Marginalia, Structure, outline, chat, non-band pages): right or wrong?
4. The test, especially the ratchet: will it be robust (comments, `@media` blocks, `em` values,
   shorthand `font:`), and is the friction worth it? A simpler mechanism?
5. Anything in the plan that would silently not work: e.g. a selector overridden later by a more
   specific rule or a `@media` block, so moving the base rule changes nothing on screen; a token
   defined somewhere the band cannot see it; Tailwind v4 namespace clashes.
6. Is there a simpler or better plan for what Greg asked?

Severity scale: P0 (plan is wrong / would ship broken), P1 (must change before building),
P2 (should change), P3 (nit). Give each finding an ID (F1, F2, ...), a severity, the evidence
(file and line), and the change you recommend. End with a verdict line: `VERDICT: approve`,
`VERDICT: approve with changes`, or `VERDICT: rework`.

My own suspicions, last: Quiz's question may be large on purpose (it is a question the reader
answers); `.skim-place` is the model's title in mono and may not really be the "main line"; there
may be `@media` overrides of these selectors in `narrow-window.css` or elsewhere.
