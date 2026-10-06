# Plan review: the seventh sweep's umbrella

Read-only. Do not change any file; your reply is the review.

**The plan:** `docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md` at commit `b7a0d9253`.
**Its evidence:** the sixteen documents it links under `docs/investigations/261006d-*` (eight
investigations, eight cross-reviews), same commit. The method it claims to follow:
`docs/reusable/improve-the-codebase.md`. Earlier rejections: the sixth and fifth umbrellas,
`docs/plans/261006j-…` and `docs/plans/261003f-…`, § Considered and rejected.

**Whose decisions.** The product owner (Greg) asked for the sweep and said that anything
"consequential, requires tradeoffs, product decisions, or is hard to reverse" is discussed first;
he approved a one-hook spike of the read type. Every clustering, tiering and "built rather than
asked" call in the plan is the orchestrator's (Claude's). Three clusters are already being built
(C1, C2, C3); the rest are not started.

**What to check.** You may run `git`, `grep`, `node --import tsx <script>` and a single
`npx vitest run tests/<file>` that needs nothing outside the tree; no network, no database.

1. **Faithfulness.** For each cluster item, does the plan say what the investigations and BOTH
   reviews support? List every place where the umbrella is stronger than its evidence (an R that
   was a C, a "both families" that was one, a count that changed), or drops a reviewer's
   correction or qualification. Check the numbers in § The short version and § For Greg against
   the documents.
2. **Dropped findings.** Every finding ID in the sixteen documents (SV, SVO, SVR, WC, WCO, PQ, PQO,
   DB, DBO, NEW) must be in a cluster, in Tier 3, in § For Greg, or in § Considered and rejected.
   List the ones that are nowhere.
3. **The line between "build" and "ask the owner".** Name any item the plan builds that changes
   what a reader sees or does beyond fixing the defect, is hard to reverse, or decides policy.
   Three to judge specifically: C5's trim that lets a criteria list exceed twenty; C7 item 5,
   dropping a duplicate index without asking; C10's "applying the existing written rule" for the
   rewrite hold (does such a written rule exist? where?). Conversely, name anything sent to the
   owner that is plainly safe to build.
4. **File sets and order.** Which clusters collide on a file the table does not admit? Is the
   order right for the migrations in C7 (journal and snapshot conflicts), and for C9 against C10?
5. **Each refusal a cluster adds** (a 409, a 404, a CHECK, a throw): can an ordinary request, or
   today's production data as counted, reach it? The plan gives counts for C7; are any missing?
6. **Re-proposals.** Does anything here rebuild what an earlier sweep rejected, without new
   evidence?
7. **§ For Greg.** Could a person who has not read the code answer each question as written? Which
   are not really questions (obvious, or not his)? Is any recommendation unsupported?
8. **§ One level up.** Is the claim ("an invariant enforced in one layer and not carried to the
   next") borne out by the findings, or imposed on them? Count the findings that fit and the ones
   that do not.

**Format.** Findings U1, U2, …; severity P0 (would ship harm or lose data) / P1 (the plan as
written builds the wrong thing or hides a decision from the owner) / P2 (should change before
build) / P3 (note). For each: the evidence (document and section, or code path) and the smallest
change to the plan. End with a verdict: ready / ready with these fixes / not ready.
