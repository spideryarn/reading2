You are reviewing a plan before it is built, in the Spideryarn repo (read-only review).

Read, in this order:
1. docs/plans/261009w-the-guide-offers-referee-to-a-reader-who-says-they-are-refereeing.md — the plan under review.
2. docs/research/261009b-what-a-peer-reviewer-needs-and-where-sources-and-referee-divide.md — the research behind it (also review its product reasoning briefly: is the Sources/Referee line sound, are the "ideas for later" well ranked by evidence, is anything overstated against docs/research/261009b-peer-reviewer-web-pass-sonnet.md).
3. The code it touches: src/guide.ts (modeWordsSection, button, experimental), src/acts-alone.ts, src/mode-catalog.ts (ModeCatalogEntry comments, referee row), src/web/reader/Reader.tsx (chipModes useMemo near `modeDoor(`), src/web/command-runners.ts (modeDoor, modeRunner), src/web/chat-commands.ts (chipFor), src/web/Dock.tsx (visibleModes), src/web/CommandBar.tsx (subModeRows), src/web/experimental-visibility.ts, src/converse.ts (GUIDE_SYSTEM), src/web/guide-acts.ts (how the page acts on an "opens at once" token), evals/guide/offers.ts.
4. docs/project/referee-mode.md § Confidentiality and § The rules the whole mode obeys; docs/project/experimental-features.md.

Context: another session is concurrently renaming the "Peer review" mode to "Sources" (docs/plans/261009s-peer-review-becomes-sources-all-the-way-down.md may not be in this tree; it owns Sources' rows and Referee's aliases).

Find: correctness gaps (will a Referee token actually render as a working chip and act for a reader with the experimental switch off — trace chipFor → door → modeRunner → the Dock's activators; does the "opens at once" path through guide-acts work; anything in the activators or in RefereeMode that assumes the switch is on), places the plan misses (other consumers of the chip door, the live/spoken guide, visitors, phone), whether a pure `chipDoorRows` is the right seam, whether the separate record vs a field is the right shape, prompt-injection risk (an article claiming the reader is a referee), the eval design, and anything simpler. Also: is offering a hidden mode via the guide a change to a security defence per docs/project/security-map.md? (It must not be; say if you think it is.)

Write findings as a numbered list, each with severity (P0–P3), the file/line evidence, and a concrete fix. Be concise. End with a one-line verdict.
