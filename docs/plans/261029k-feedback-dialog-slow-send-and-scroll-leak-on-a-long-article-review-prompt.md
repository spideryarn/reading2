# Plan review: 261029k

You are reviewing a plan before it is built, read-only. Repo: Spideryarn (React + Vite reading app). Read, in order:

1. docs/plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md (the plan)
2. docs/investigations/261029a-feedback-dialog-cost-on-a-long-article-measured-at-six-times-throttle.md (the evidence: Chrome at 6x CPU throttle, selector stats, A/B by deleting rules via CSSOM)
3. The CSS rules it changes: `grep -rn ":has(" src/web --include=*.css` — especially src/web/styles/shell.css (the `--bar-bottom` specificity ladder around lines 675-910), narrow-window.css (~660-750, the dock guard; ~1531), dock.css (158, 335, 1082), crumbs.css (176), table.css (120).
4. The components that would set flags: src/web/reader/Reader.tsx (`showBar`, `showCrumbs`, `bandCovers`, `.controls` ~line 5006), src/web/BandBackChip.tsx, src/web/InstallHint.tsx, src/web/Dock.tsx (`MORE_OPEN`, drawer), src/web/reader/SkipToModes.tsx, CommentDialog/ChatDialog/AnnotateDialog.
5. Already built (stage 1.1): `git diff origin/dev -- src/web/FeedbackDialog.tsx tests/` — the `StillWhileHidden` memo and its test.

Questions, answer each:
A. Is the diagnosis sound? In particular: is it right that `:root:has(<descendant argument>)` rules are re-evaluated by a document walk after unrelated DOM mutations (Blink and WebKit), and that modal `<dialog>` inertness is a document-wide restyle in both engines? Anything in the evidence that contradicts it?
B. Stage 1.2 (JS-set root flags): is this the right shape? What will break — specificity ties in the ladder, timing (layout effect vs the frame the element appears, e.g. a band mounting, a dialog unmounting, the Radix menu's data-state), focus-within emulation (focusout to an iframe/body, relatedTarget null, a removed focused element), SSR/hydration (there is none?), multiple Reader mounts, the reader leaving the page (flags left behind on <html>), and jsdom tests that currently assert on these CSS behaviours (find them). Is there a simpler correct alternative (e.g. scoping `:has(> body > #root > …)` with child combinators) and why/why not?
C. Stage 1.1 StillWhileHidden: any behaviour a hidden-and-frozen Earlier panel used to have that is now lost (effects keyed on props while hidden, the Needs-a-decision count, reply drafts, dictation in a reply box, the thread scroll-reset)?
D. Stage 1.4's check: is "a :has() on :root/html/body/.reader whose argument does not start with >" the right class line? Too strict or too loose?
E. Stage 2 (a non-inerting modal) — is the recommendation right, and is it right to ask the owner rather than build it now?
F. Anything missing that would make the reported symptoms persist after stage 1 on an iPad.

Write findings ranked P0/P1/P2 with file:line and a concrete fix each. Be terse. Do not edit files.
