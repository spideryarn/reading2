You are reviewing a plan before it is built. Read-only: do not edit any file.

The plan: docs/plans/261001s-fb93-long-pdf-hierarchy-asks-again.md (read it in full first).

The code it changes: src/hierarchy.ts — `planChildRanges` (~line 1278), `recordBoundaryFaults`,
`buildTree`'s `visit` (~line 1700, the "has no [start, end] block range" throw), `generateHierarchy`
(~line 2244; the structure call, `treeFrom`, the checkpoint read/write). Also src/heading-snap.ts
(`snapStartsToHeadings`, which reads children's ranges), src/pipeline.ts (~line 2680–2730, how the
step is called and logged), src/jobs.ts (`LEASE_MS`, `DEADLINE_MARGIN_MS`, `STEP_BUDGET_MS`), and
docs/project/hierarchy.md (§ "The partition is derived, not checked", and the asymmetry with
`normaliseExpansion` in src/hierarchy-cascade.ts). Tests that mock the structure call:
tests/hierarchy-structure-checkpoint.test.ts, tests/hierarchy-write-guard.test.ts.

The evidence (production, read-only): two structure answers for a 1,041-block book were refused —
one by `buildTree` with "The node at root > child 3 > child 4 > child 1 has no [start, end] block
range." (after 9 mended boundaries), one by `parseStructureAnswer` with "not valid JSON: it breaks at
position 24682 of 24685 characters". Both calls ended with a normal stop reason. Since 2026-09-06,
0 of 2 hierarchy steps over 700 blocks finished; 240 of 243 overall did.

Questions I want answered, most important first:

1. Is the root-cause statement right, and is the fix the right one for it? Is there a simpler or more
   general fix I am missing — or a reason either part is wrong?
2. Part 1 (rangeless child = a child with no claim): walk `planChildRanges`, `recordBoundaryFaults`
   and `snapStartsToHeadings` with a rangeless first, middle and last child. Where would a `!`
   non-null assertion or an index now crash, or a fault be mis-measured? Is distinguishing "missing
   range" from "invented id" sound, and what exactly should count as "missing" (absent; not an array;
   wrong length; non-string members; an empty string)?
3. Part 2 (re-ask once): is "only failures thrown by `treeFrom`" the right boundary? Is the deadline
   rule right (the first call's own duration plus what margin)? Any interaction with the checkpoint
   read/write, the abort signal, cost tracking (`collectSpend` / ai_calls), the progress line, or the
   lease that could make this bill twice for nothing or wedge a job?
4. Anything in the "passes over" list that should be in scope instead, or anything in scope that
   should be deferred.

Answer as a numbered list of findings, each with severity (P0–P3), the file and line, the concrete
failure scenario, and the change you recommend. Say plainly if you find nothing wrong with a part.
