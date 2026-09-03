You are reviewing a small piece of work in the Spideryarn repo (worktree at
/home/greg/code/spideryarn2/.claude/worktrees/cite-not-restate — read files there, not in the primary).

## Background

An agent complained that "three separate times in this lineage, someone has confidently stated an
inventory that was wrong". Greg asked what to do about the general problem, proposing a docs policy:
one source of truth per fact, docs signpost to the canonical place (the code) rather than restating,
cite the source with a date or confidence. I trawled 97 session transcripts from the last four days
with eight Sonnet readers. The write-up, with the evidence and the proposals, is
docs/research/260903b-facts-that-were-wrong.md — read it first, including the appendix.

## What was built

One mechanical guard, in tests/doc-links.test.ts (the diff is in the file named below):

1. An evergreen doc (AGENTS.md, docs/project/**, docs/reusable/*, infra/hetzner/README.md) may not
   cite a line number into this repo (`src/foo.ts:123`, `src/foo.ts#L123`). Six of six such
   citations checked on 2026-09-03 pointed at the wrong line; the existing link check was green on
   all of them because it only checks the file exists.
2. A `` `src/foo.ts` § `symbol` `` citation must name a string the file still contains.

It went red on nine citations, which were rewritten to the symbol form (see the diff), and a mutated
symbol turns it red again. Plans/postmortems/research keep their line numbers.

A new reusable doc, docs/reusable/trawl-session-transcripts.md, records the trawl recipe.

## What I want from you

The agent's own question was: "is that guard real or just another check that agrees with the bug?"
Answer it for this guard. Specifically:

A. **Is the guard real?** Find a way an evergreen doc could carry a rotten code citation that this
   test passes. Consider: the regex shapes (what citation forms slip through — bare `foo.ts:12`
   without a directory, `foo.ts` line 12 in words, `L123`, ranges, links whose text differs from
   the target); the resolution (`resolveCodePath` tries repo root, doc-relative, `src/`,
   `src/web/` — is that over- or under-resolving, and does the `path.isAbsolute` exemption hide
   anything?); `stripFences` (does it strip inline code, and should it?); and the symbol check —
   `includes(symbol)` is a substring test, so `§ \`save\`` passes on `saved`. Is that acceptable,
   and if not what is the cheapest tightening? Say concretely which of these you consider a real
   hole versus theoretical.

B. **The positive control.** `recognises each shape of citation` is meant to prove the parser
   matches. Does it prove enough? Would you add a case?

C. **The research doc's conclusions.** The doc argues that Greg's policy is right but insufficient
   on its own, because the transcripts contain five cases of a loaded rule not holding, and that
   what held was "form a test or reviewer can check". Is that argument sound on the evidence given?
   Is there a finding in the appendix that cuts the other way? Are any of the ranked proposals
   (2–5) wrong-headed or missing something cheaper?

D. **The proposed AGENTS.md wording** (below) — it will replace the existing "One source of truth"
   sentence inside the "Signpost heavily" bullet. Is it short enough for a file loaded on every
   turn, and does it say the checkable thing? Offer a tighter variant if you have one.

   > **Cite, don't restate.** A fact has one home. If the code holds it — a constant, a default,
   > what a module does — write `` `src/models.ts` § `STAGE_EFFORT` `` and let the reader look;
   > never a value, never a line number (the doc-links test refuses both a line number and a
   > symbol the file no longer has). If a command could produce it — a count, a list of call
   > sites — write the command and the date it was run, and the answer only as an example. If
   > neither, say who, when and how sure: *"Greg, 2026-09-02"*, *"decided 2026-08-30, not built —
   > check the code"*, *"four observations, all from one input"*. A bare number or a bare claim is
   > a second copy that nothing keeps in step, and the trawl behind
   > [260903b](260903b-facts-that-were-wrong.md) found forty of them wrong in four days.

   Also the proposed fourth species for docs/reusable/written-down-is-not-checked.md — "An
   inventory: a count or a list of places, right when it was taken" — and a status line for plans
   in write-planning-doc.md. Are those the right homes?

## Evidence

- The scoped diff: /tmp/claude-1000/-home-greg-code-spideryarn2/4445f83f-e1f3-4cbf-aae0-51f4d819c4dd/scratchpad/diff.patch
- The test file after the change: tests/doc-links.test.ts in the worktree (the new block is at the end).
- The research doc: docs/research/260903b-facts-that-were-wrong.md
- The recipe doc: docs/reusable/trawl-session-transcripts.md
- You may run `npx vitest run tests/doc-links.test.ts` in the worktree; you may also mutate a doc
  to try to slip a citation past it, but restore it afterwards.

Be concrete and be brief. Number your findings, most important first, and for each say whether it
is a hole you demonstrated or one you reason about. End with a verdict: ship / ship with changes
(named) / do not ship.
