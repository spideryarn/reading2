You are reviewing a plan, read-only, in the Spideryarn repo (this worktree). Do not edit any file.

The plan: docs/plans/261019l-structure-recovers-a-start-that-splices-the-line-number-into-the-id.md

Read it, then the code it changes and its neighbours:
- src/start-ranges.ts (`deriveStartRanges`, the two policies)
- src/structure-starts.ts (`modelNodeFromStarts`, the whole-document caller)
- src/structure-cascade.ts around `normaliseExpansion` (the scoped caller, which must stay unchanged)
- src/heading-snap.ts (`snapStartsToHeadings`, which runs after resolution)
- src/structure-prompt.ts (`renderBlocks` — the `[i] id <tag>:` line the model copies from)
- src/structure.ts (`BuildReport`, `treeFrom`/`parseWholeDocumentAnswer`, the in-step re-ask)
- src/supplement.ts (`splitBlocks` — confirm the array rendered is the array `deriveStartRanges` indexes)
- tests/structure-step-starts.test.ts, tests/structure-whole-document-toc11.test.ts
- docs/project/structure-step.md § "The one thing it loses, and what still throws"

Evidence, so you can check the diagnosis: four re-runs of the production request over the same 648
blocks returned bad starts "x", "spya-582", "spya-76k5k8x", "spya-582xcf0dz", "spya-582", "spya-76bd1a",
"spya-582xcf". Block 582's id is spya-xcf0dz (an h1, "PART VI. EVIDENCE GAPS"); block 76's is
spya-k5k8pf ("Our framework"). Production's refusals were "root > child 9: start not a block id
(a 14-character string, withheld)" twice and "root > child 3 > child 2 … 13-character" once. All
four re-runs had 0 thinking tokens at effort low.

Questions I want answered, plus anything else you see:
1. Is the diagnosis right? Is there a reading of the evidence it misses?
2. Is each of the four rules safe — can any of them attach a section's title and gist to the wrong
   prose in a way the existing repairs do not already accept? Especially rule 2 (index decode) when
   N is a valid index but the model meant something else, and rule 3's bounds when the next start
   is itself unresolved.
3. Is ignoring a first child's start correct for the whole-document policy (the clamp, the pin, and
   the heading snap's treatment of k=0)?
4. The one-in-five ceiling: right shape? per sibling set or per answer? Is it needed at all?
5. Does anything downstream (checkpoint writes, the in-step re-ask, `assertTreeSound`, the cascade
   seeing a slice derived here) behave differently once an answer that used to throw now builds?
6. Is there a simpler design that gets the same reader outcome?

Write your findings to the answer file only, as a numbered list, each with severity (high/medium/low),
the file and line, and what you would change. End with a one-line verdict: build / revise / rethink.
