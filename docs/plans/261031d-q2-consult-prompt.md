# Consult: should the Sources digest's readers be allowed to search again after reading a page?

You are advising, not editing. Do not change any file. Read, think, answer.

## Context

Spideryarn is an AI-assisted reading app (repo at the working directory). "Sources › Digest" is a new
owner-only, experimental sub-mode: a planner (Sonnet) reads only the article and writes 8–16 "leads"
(questions about what the piece cites, who cites it, what it missed, citations worth checking), each with
1–2 web searches (Exa via OpenRouter). One Haiku reader per lead reads up to 8 returned pages (fenced as
untrusted, no tools) and returns a verdict and quotes (checked word for word in code). Opus writes the
digest from checked quotes only. Readers also return "dig further" as words only, shown under More; the
reader's own chat (with its own web search, on the reader's press) is where digging happens.

Read: `docs/plans/261030b-sources-digest-a-prose-digest-of-what-it-cites-and-who-cites-it.md` (especially
"No searches written after reading a page"), `docs/plans/261030b-plan-review-sol.md` F1, the header of
`src/sources-digest.ts`, the header of `src/situate.ts` and its `validateQueries`,
`docs/plans/261024o-sources-situate-a-paper-in-the-literature-hands-free-with-margin-notes.md` § Passed over
(S3, S11), `docs/project/security-map.md`, `docs/project/security-risks.md`.

The question put to Greg (the owner):

- A. No, as built: every search planned from the article alone; "worth digging into" is words; chat is how
  you dig.
- B. Yes, one extra search per reader, about +$0.30 a run, once a security design for it has been reviewed
  on its own.
- The risk in B: a hostile web page could steer what we search for and spend.

Greg replied: "not sure, maybe B? what do you think is best for the user?"

Facts: the digest has never run live yet (the OpenRouter key was at its limit until 1 November). A
measurement of real runs on three or four articles is already queued (qi-dykn3xjh). Building B itself is a
separate queued item (qi-xgnn5fpb) that requires its own security design and its own review; we are
deciding direction now, not building B.

## What I want from you

1. What is best for the reader (the person reading the paper), weighing depth of digging, cost (about $1 a
   run now), wait (up to about 11 minutes), trust in what the digest says, and the security risk. Be
   concrete about what the hostile-page risk actually is here: who could exploit it, what they gain
   (steering what is found? spending our money? getting article text into a query sent to Exa — does the
   attacker ever see the query?), and how far caps, quote checking and code-side query validation bound it.
2. Your recommendation: A, B, or a specific variant (for example B gated on the measurement showing the
   readers often say "could not tell"; or a constrained follow-up whose query code builds from a work the
   planner already named; or a follow-up whose query must share words with the lead's planned searches).
3. If B or a variant: the three to six minimum security properties the design must have, and what in the
   measurement (qi-dykn3xjh) would tell us whether it is worth building at all.

Answer in under 600 words, verdict first.
