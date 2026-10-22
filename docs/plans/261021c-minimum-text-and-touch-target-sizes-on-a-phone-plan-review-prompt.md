# Plan review: minimum text and touch-target sizes on a phone (261021c)

You are reviewing a PLAN, read-only. Repo: this worktree (branch from origin/dev at HEAD). The plan is the untracked file
`docs/plans/261021c-minimum-text-and-touch-target-sizes-on-a-phone.md`. Read it, then the code it names:
src/web/styles/tokens.css, prose.css (`.block-ref`), mode-band.css (`.cite-chips`, `.cited-link-host`, `.chat-icon`,
`.chat-thread*`, `.chat-from-btn`, `.chat-sources`, `.bring-in*`, `.chat-to-bottom`, `.chat-origin-back`), footnotes.css
(`.gloss-where`), quiz.css, tap-target.css (its chip-halo arithmetic), close.css, narrow-window.css § a coarse pointer and
§ a field iOS zooms into; docs/project/touch.md § How big a thing has to be to press it, controls.md § The numbers,
typography.md § Text roles in a band and § The reader's text size scales the root.

Questions:
1. Is `max(var(--text-min), X)` with `--text-min: 0px` default sound everywhere it would be used (em contexts, inherited
   font-size, `font: inherit` shorthands, the reader text-size root scaling, cascade layers vs Tailwind utilities)?
   Any place where defining the token on :root under a media query fails (shadow roots, iframes, dialogs, portals)?
2. Does flooring `.block-ref` to 13px under any-pointer: coarse break tap-target.css's halo arithmetic (1.3rem tall
   halos, row-gap .75rem rules) or line layout in chip rows / gist ranges / sketch cards / summary sentences
   (summary.css overrides `.block-ref` for `.simple-sentence` — would a floor fight that)?
3. Is the pointer vs any-pointer split right? Is 13px / 40px the right pair given house precedent?
4. Is the CSS ratchet test a good idea or noise? Better shape?
5. Anything simpler that gets Greg the same result.

Severity scale: P0 (ships broken), P1 (wrong behaviour likely), P2 (worth fixing), P3 (nit). Give each finding an ID
(R1, R2…), file:line evidence, and a concrete fix. Write your findings only to your answer; edit nothing.
