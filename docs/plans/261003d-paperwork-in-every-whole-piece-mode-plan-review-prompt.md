You are reviewing a plan before it is built, in the repo at the current directory (Spideryarn, an AI-assisted reading app). Read-only: do not edit files.

The plan: docs/plans/261003d-paperwork-in-every-whole-piece-mode.md
Prior work it extends (read these): src/paperwork.ts; docs/plans/261001p-summaries-skip-the-paperwork-and-lead-with-the-takeaway.md; docs/project/prompting-guide.md (esp. § Measuring a prompt change); tests/plain-words-coverage.test.ts (the template for the proposed coverage test).
The prompts it changes: src/sketch.ts, src/illustrated.ts, src/faq.ts, src/quiz.ts, src/ideas.ts, src/quotes.ts, src/glossary.ts, src/timeline.ts, src/arc.ts. Version stamps and how a bump shows to readers: grep for PROMPT_VERSION / *_VERSION in those files and their isStale / outdated logic in src/store/pg.ts.

Please check, with file:line evidence:
1. Mode choice: is any included mode wrong to include (paperwork is its legitimate content), or any excluded one wrong to exclude? Check the exclusion reasons against the code.
2. The two new kinds' wording ("pick", "part"): will they cause collateral loss of real content (e.g. a glossary person who is also argued with in the body; a timeline event the body narrates that also appears in a funding line; quiz/faq), or conflict with each prompt's existing rules? Is "part" right for arc given arc's own first/last-part rules, and its output schema?
3. Stamps: is bumping each right, including quiz given its own note at src/quiz.ts ~585? Does any bump have a cost the plan misses (e.g. regenerating something automatically and spending money, an illustrated/sketch dependency, tests pinning a value, client bundles comparing a version)?
4. The coverage test design: would detecting articleWithIds( / articleText( by syntax find the right files? What would it miss?
5. The measurement: is the block-citation screen sound per mode (does each mode's output actually carry block ids — check quotes, glossary, sketch, ideas, faq, quiz, timeline, arc output types)? Is the arm design enough? Anything cheaper and just as convincing?
Rank findings P0/P1/P2, concise. End with a one-line verdict.
