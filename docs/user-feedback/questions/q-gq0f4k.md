---
id: q-gq0f4k
report: spya-c8z66b
status: answered
asked: 2026-10-17
title: Should figure stops in Skim's route reach visitors to a shared article too?
refs: qi-at6acbtb · qi-6297kfn6 · docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md · docs/plans/261018m-skim-figure-stops-cross-to-visitors.md · docs/user-feedback/261015_2040-figures-in-the-skim-route.md · spya-c8z66b · SPIDERYARN-READING2-J5 · src/public/dto.ts publicSkim · docs/project/security-map.md
acted: spya-qj6qzz
---
Skim's Gist, More and Most walks can now stop at a figure, as you asked (your 1B and 2A). Only you, the owner, see those figure stops. Someone reading an article you have shared walks the same route with the figures left out. Should they see them too?

A. Yes, visitors see the figure stops (recommended). Their walk is the same as yours. It means adding one field to the list of what a shared article sends to a stranger. That list is guarded on purpose, which is why I am asking rather than doing it. What would cross: which figures the route stops at (blocks the visitor's page already shows) and the one-line reason for each, which is the same kind of line as a quote stop's question, and those already cross.
B. No, visitors keep the quotes-only walk. Nothing changes. A visitor's walk is a stop or two shorter than yours when yours has figures, and never shows one.

Recommendation: A.

Details

What this is about. On 2026-10-15 you suggested, from Skim on your Mental Imagery paper, including some figures along with the quotes in the Gist, More and Most walks, as the AI sees fit. On 2026-10-17 you chose a figure as a stop of its own, with a short line saying why it is there, chosen by the AI. That is now built and on dev.

How it works now. When the route is planned, the AI also sees the article's figures (their captions and where they sit) and may put a figure straight after the quote it goes with, in that quote's pass: at most one figure in Gist, two in More, three in Most. In test runs on your Mental Imagery paper it chose Figure 1 (imagery as weak perception) and Figure 2 (the visual hierarchy), each after the quote that talks about it. The row shows the figure's caption, with a line above it like "Read the left graph first: how does the effect of a prior stimulus change as its strength grows, and where does imagery sit?" Stepping to it brings the figure into view.

Why visitors do not get it yet. What a shared article sends to someone who is not signed in is built field by field from a fixed list, so that nothing private leaks by accident. Changes to that list are yours to approve. So for now a visitor's route is the quotes only, and the short map at the top of each pass is written never to mention a figure, so that it is right for both.

What each choice would look like. With A, a visitor stepping through Gist on your shared paper would meet the same figure stop you do, after the same quote. With B, they step from that quote straight to the next quote.

What would make you pick B: if you would rather shared articles carry as little AI-written text as possible.

## Greg's answer, 2026-10-18 (in the Feedback dialog, reply `spya-qj6qzz`)

> A

Built: a visitor to a shared or public article now walks the same figure stops as the owner, each
after the same quote, with its line saying why it is there. It is one more field in the visitor
allowlist (`PublicSkim.figures`, src/public/dto.ts), copied field by field and recorded in
security-map.md; who the route was planned for still does not cross. On `dev`, not deployed. Plan
[261018m](../../plans/261018m-skim-figure-stops-cross-to-visitors.md), queue item `qi-6297kfn6`.
