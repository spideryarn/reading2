# Review this plan before it is built

You are reviewing a plan doc in the Spideryarn repo (TypeScript + ESM, Postgres/Supabase, Vercel).
Your working directory is a full checkout. **Read the plan first:**
`docs/plans/260903e-sweep-recorded-rather-than-fixed-defects.md`.

## The job the plan is for

Greg, after a postmortem about a quiz bug, wrote:

> `truncatedMessage` was correctly diagnosed, written up, and deliberately left — and the identical
> mistake was made eight days later by someone who could have read that note. **A written-down defect
> with an unchanged default is a defect with a paper trail, not a mitigation.** There are a few other
> "recorded rather than fixed" notes in the docs; they're probably worth a sweep at some point.

So: sweep the tree for defects we recorded and left, fix them, and decide what to build so the next
deferral cannot be just a sentence.

## What has already happened

- **Fable** was asked to arbitrate between (A) a `docs/known-defects.md` register with a consistency
  test, (B) no machinery, and (C) something else. It chose (C), argued the register is *"the disease
  presenting as the cure"* because it *"makes recording the sanctioned endpoint of finding a bug"*,
  and proposed instead a rule: **a deferral must leave behind something that runs** — either a
  `DEFECT:`-named test pinning today's behaviour, or an observable trigger. The plan adopts this.
- **Three evidence trawls** ran: `docs/project/` + `docs/reusable/`; all 57 postmortems'
  recommendations checked against the code; and the source comments. Their findings are in the plan.

## What I most want challenged

Please be adversarial. I would rather lose a stage than ship a bad one.

1. **The central empirical claim.** The postmortem audit reports that the *top-ranked* prevention was
   built in ~44 of ~50 postmortems, and that items ranked 2-and-below, and anything a postmortem
   itself labelled "not done", essentially never land. The plan pivots on this. **Spot-check it.**
   Pick three or four postmortems in `docs/postmortems/` yourself, read their ranked recommendations,
   and grep for whether each was built. If the "top item lands, the rest do not" pattern does not
   hold, the plan's central conclusion is wrong and I need to know now.

2. **Is Stage 1 actually one stage?** It bundles six unrelated defects — a script's env resolution, a
   store guard, a PDF cache check, a chat history filter, five React hooks, a CSS breakpoint —
   united only by the abstract claim that each is "a fix that exists elsewhere in the tree and was not
   applied here". Is that a real organising principle or am I making a pleasing story out of six
   chores? Would you split it, reorder it, or drop items?

3. **Stage 3 item 2, the block-id one, is the one I am least sure of.** `src/pipeline.ts:1736`
   deliberately does not flag a *partial* block-id loss, reasoning that "any cutoff would be a guess
   and a guessed alarm gets ignored". I think that reasoning is right, and that the flaw is the
   fallback — "one query away" — sitting three lines below the same comment's own verdict that "a
   line in a log nobody is tailing is not a defence". Block ids are this app's core contract; every
   comment and highlight anchors to one, and a partial loss silently detaches them.
   **Read `src/blocks.ts` § `assertIdsCarried`, `src/pipeline.ts` around 1705-1740, and
   `docs/project/block-ids.md`, and tell me what should actually happen here.** Is there a version
   that needs no guessed threshold? Should it refuse, record, or surface? Or is the existing comment
   right and I should leave it entirely?

4. **The convention itself.** Is "a deferral must leave behind something that runs" a real control or
   just a better-dressed paragraph? Fable's own argument against it is that a pinned `DEFECT:` test is
   *pressure-neutral* — it goes red when the defect is **fixed**, never when it **matters**. That is a
   real weakness and I have not answered it. Can you do better? Note that `test.fails` was considered
   and rejected because it passes on *any* throw (`docs/reusable/silent-success.md`).

5. **Scope.** Four stages, ~12 changes. This is an alpha, speed wins, and CLAUDE.md says "simplest
   version first" and treats new machinery as a proposal rather than a licence. Is this too much? Is
   the "deliberately out of scope" section hiding something that should be in scope — particularly the
   content-extraction one, which silently degrades the app's flagship feature?

6. **Anything the plan asserts that you can falsify.** Check the file:line claims. Several came from
   subagents; I verified `db-export.ts`, `pgCommentStore`, `src/quiz.ts` and `src/pipeline.ts:1736`
   myself, but not all of them. **Two of Fable's four claimed findings turned out to be already
   fixed** and saying so in the same sentence, so this failure mode is live.

## Please also

Run at least one test file yourself rather than reasoning about it —
`npx vitest run tests/step-failure-seam.test.ts` is small and relevant. The plan claims a reported
order-dependent failure in it did not reproduce; check whether you agree that is the right way to
record an unresolved flake.

Give me a verdict per numbered point, findings ranked by how much they would change the plan, and say
plainly if you think the whole framing is wrong.
