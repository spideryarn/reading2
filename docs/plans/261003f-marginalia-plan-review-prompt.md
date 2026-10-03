You are reviewing a PLAN (not code) in the repo at the current working directory: docs/plans/261003f-marginalia-relation-words-and-timeline-events.md. Read-only: do not edit any file.

Context to read: docs/project/marginalia.md, src/web/marginalia/notes.ts, src/web/marginalia/MarginaliaColumn.tsx, src/web/reader/Reader.tsx (search "marginalia"), src/web/useTimeline.ts, src/web/TimelinePanel.tsx (datingWords, yearsOf), docs/project/timeline.md, docs/project/mode.md section "The artefact, if the mode shows one", src/faq.ts and src/arc.ts as the model for a new step, src/web/useAutoRun.ts and src/web/activation.ts (armActivation), docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md (stage 2), experiments/decorated/build.mjs CONNECTIVE table, docs/project/vision.md anti-goals.

Find what is wrong or missing with the plan, ranked P0/P1/P2, each with the concrete scenario. In particular:
1. Is the auto-run trigger right (armActivation on the Marginalia press + useAutoRun in OwnerMarginFeed)? Does activation/useAutoRun actually support a target that is not a mode/band, and what breaks (e.g. claimActivation owner semantics, the press arriving before OwnerMarginFeed mounts, the margin being already open)? Is there a simpler correct trigger?
2. Is the registry list complete for a new step (anything the plan misses that is not compile-checked)?
3. Timeline placement and the dated/words filter: any wrongness (e.g. occurrences quote check, withYear decision, stale list).
4. Product: drawn set (so, but, why, e.g., vs) vs density; position of the word in the note; whether visitors should get it.
5. Anything simpler that does the same job.
Be concise; under 900 words.
