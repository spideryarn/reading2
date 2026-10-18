# Plan review: modes say what the wider world thinks, labelled

You are reviewing a PLAN, read-only. Repo root is your working directory. Base commit: d4f62ce65 (origin/dev).
Candidate: the untracked file `docs/plans/261018h-modes-say-what-the-wider-world-thinks-labelled.md` (read it first, in full).
No code has been written yet.

Context you should read yourself (do not trust my summary):
- src/converse.ts: `CLAIM_ORIGINS` (~line 594), Chat `SYSTEM` (~618), `LEARN_SYSTEM` (~847, esp. WHAT YOU ARE AND ARE NOT ENTITLED TO SAY, WHAT IS WORTH RAISING, LENGTH, YOUR TOOLS ~1089), `TUTORIAL_SYSTEM` (~1157, YOUR TOOLS ~1334), `EXPLORE_SYSTEM` (~1411, THE WIDER WORLD ~1567), `provenanceLine` (~2549) and the recency reminders near ~2583.
- src/quiz-mark.ts: `QUIZ_MARK_SYSTEM` (~159).
- src/plain-words.ts (precedent for a shared prompt section), docs/project/prompting-guide.md (house rules for prompts and how to measure a prompt change).
- docs/project/learn-mode.md § The prompt is the feature; docs/project/quiz.md § A reference answer is not an answer key, § What a mark says.
- evals/learn-recall.ts, evals/quiz.ts (existing evals the new one would imitate).
- tests/fixtures/data-root/data/noema-mythology-of-conscious-ai/blocks.json (the eval article; see blocks spya-zg9me8, spya-ahtr6e, spya-qu7j89).
- docs/project/vision.md (what the product is for: augment reading, not replace it).

The report is from the product owner (admin), so "should we build it" is settled; the question is HOW, and whether this plan is the right simplest version.

Attack it independently first:
1. Will the shared section break the entitlement rules in Recall/Quiz (the model using outside knowledge to tell a reader who correctly repeated the piece that they are wrong)? Is rule 4 worded/positioned strongly enough, given LEARN_SYSTEM ranks its rules?
2. Will it make the model add tangents on most turns, blowing Recall's length/one-question limits or Quiz's "no inventory"? Is the "only when it bears on what they are taking from the piece" bar operational?
3. Are the three-source labels distinguishable to a reader with words alone? Is there an existing UI element (e.g. ChatPanel "From the web", Cited.tsx) that already does part of this, or that the plan conflicts with?
4. Is the eval design sound per prompting-guide.md (control arm, blind pairing, fidelity question)? Are the cases right, and is the Antikythera dating claim correct (article says ~2,000 BCE)?
5. Is the scope right: should Explain, the live backend, or Glossary `background` be in or out? Anything that should be smaller?
6. Anything in the repo (tests pinning prompt text, version stamps, plain-words coverage, paperwork coverage) that the plan forgot will need changing.

My own suspicions, worth less, last: (a) Quiz marking has no search, so "say Chat can check it" may read as an ad; (b) Recall's LENGTH says exactly one question mark, and an outside note phrased as a question would break it; (c) Chat's SYSTEM already says "USE web search unless you are genuinely sure", so rule 3 may be redundant there.

Severity scale: P0 data loss/security/charging/unusable; P1 user-visible wrong behaviour or authoritative contract violated; P2 design/maintainability risk; P3 prose. Give every finding an ID (F1, F2…), severity, evidence (file:line), and a concrete fix. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REVISE.
