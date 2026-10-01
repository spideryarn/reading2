Review the plan docs/plans/261001l-pdf-stacked-bylines.md before it is built. Read-only.

The code it changes is src/pdf-authors.ts (verifyAuthors and helpers); tests are tests/pdf-authors.test.ts. Background: docs/plans/260930e-pdf-transcription-glitches.md § Stage 2, § Deferred and named, and the code-review table (C2, C4).

The invariant that matters most: an author printed in the byline must never be silently dropped from a stored author list or a names-only byline. Please:
1. Look for any way the proposed gap accounting (emails + already-verified affiliations of earlier authors, and of all authors for the trailing words) lets a printed person disappear without a refusal. Construct concrete inputs if you find one.
2. Say whether "earlier authors' affiliations" (not just the previous author's) is right, and whether trailing accounting should use all authors' affiliations.
3. Whether the email regex approach on raw byline characters is safe (e.g. could an email-span swallow a name?).
4. Whether the eval design (fixed answers + derived drop-one negatives) measures the right thing, and anything missing.
5. Anything simpler that gets the same result.
Give findings numbered, each with severity (P0/P1/P2), and a verdict line at the end: "build as is", "build with changes", or "revise before build".
