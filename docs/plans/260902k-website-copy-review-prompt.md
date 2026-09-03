# Review prompt: the homepage and features page, in Greg's words

You are reviewing a small web change and, more importantly, its copy. Answer in plain prose,
findings first, ranked by severity, each with the file and line and what you would change. Be
specific and be willing to say "no findings" for a section.

## What was built

Spideryarn Reading is an AI-assisted reading app: one hard non-fiction article at a time, with an AI
beside the reader that helps them understand it rather than summarising it away. The product owner
(Greg) is writing the marketing site and insisted on one rule: **the copy must be his words, not an
agent's, and the two must be distinguishable.** He answered four interview questions and handed
over a set of dictated notes; everything else came from his dated quotes in the project docs.

The change (diff attached below) does four things:

1. Rewrites `src/web/LandingPage.tsx`, the signed-out homepage, in his words, written "as if we're
   in Beta and taking payments" while sign-up is still an invite list — hence one honest strip.
2. Adds `src/web/FeaturesPage.tsx` at `/features`, every mode with a screenshot and a sentence of
   intent, and the three plans (Free 3 for life; Reader $10/£8/€9 for 20 a month; Researcher
   $50/£40/€45 for 150; reading never gated).
3. Adds `src/web/shots.ts` (the screenshot record, checked against bytes on disk by
   `tests/landing-assets.test.ts`) and `src/web/SiteBits.tsx` (shared figure/heading/row).
4. Routes `/features` through `router.ts`, `page-title.ts`, `App.tsx`, with tests; updates
   `docs/project/vision.md` (a corrected tiebreak and three roadmap bullets, approved by Greg),
   `positioning.md`, `website-text.md`, `README.md`, and adds three research docs.

## What to check, in order of value

**A. Provenance of every sentence of copy.** Each sentence on the two pages must be one of: Greg's
words (a comment beside it names the date), a product fact, or connective tissue marked `[tissue]`.
Read the attached interview guide and notes, then read the two page files and flag any sentence
that is presented as his but is not traceable to a quote, or any quote that has been altered in
meaning (punctuation and pronouns are allowed). This is the finding Greg cares about most.

**B. Truth of every product claim against the code.** The landing page once said "six diagrams"
when there were four. For each claim (mode names, what a mode does, the plans, "reading is never
gated", "audio never touches our server", "public articles share their annotations", the export
button), say whether the attached code and docs support it. Flag anything the page promises that
the app does not do. Note in particular: the pages are written as if in beta and paid; the app is
an invite-list alpha with no Stripe yet. Is the honest strip sufficient, or does any other sentence
mislead a stranger about what they can do today?

**C. The pages as pages.** Anything a visitor would trip on: a heading that promises more than its
paragraph delivers, a figure caption that describes something not in the picture (the screenshots'
alt texts are in `shots.ts`; the captures were made from a real article), the plans table, the
mailto strip, the footer, the order of sections.

**D. The code.** Small, but check: the `features` route is reachable signed out and signed in, is
not a prefix of anything, and survives `settleAddress`; the assets test now reads `shots.ts`;
nothing else imported the removed images; `Plans` is exported from a page module and imported by
another (is that the right home?); Tailwind class prefixes.

**E. vision.md.** The tiebreak was changed at Greg's instruction from "which option leaves more of
the thinking with the reader?" to "which option will best help the reader form their own rich,
updated internal representation". Does the new paragraph read as his intent, and does the rest of
the doc still agree with it?

## Attached

The full diff against `origin/dev`, then the interview guide, then Greg's notes, then the two page
files in full.
