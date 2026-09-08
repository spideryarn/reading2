# A design call, not a review: how to make every environment-variable read in this repo checkable

The repo is at `/home/greg/code/spideryarn2/.claude/worktrees/env-names-literal`, branch
`worktree-env-names-literal`, based on `origin/dev` at `fd7aa74d`. Nothing is changed yet — this is
a decision to take **before** anything is built. Read whatever you want.

## Background, in one paragraph

`docs/postmortems/260827b-health-check-green-while-uploads-dead.md` asked twice for a static check
that every environment variable read under `src/` is accounted for in `src/vercel-health.ts`'s
`EXPECTED` table (or in a deliberate exclusion list). Yesterday somebody built that check. You
reviewed it twice and refused it twice — `docs/plans/260907e-stage4-review-sol.md` and
`docs/plans/260907e-stage4-review-sol-2.md` — for **nine established P1s of one class**: an
environment read that is *silently skipped* rather than refused. The check was not landed. The
candidate is parked, non-executing, at `docs/plans/260907e-stage4-candidate.ts.txt` (1,754 lines);
both your reviews cite it by line. What did land is six `EXPECTED` entries, all `breaks: null`.

The write-up, including the nine attacks as a ready-made control spec, is
`docs/plans/260907e-small-uncontested-postmortem-preventions-batch.md` § "Stage 4, as a brief for
whoever picks it up".

**Your two reviews are the strongest evidence in this prompt, and I am not asking you to defend
them.** Contradict them freely if the tree says otherwise.

## The measured state of the tree, today

108 lines under `src/` mention `process.env`, `import.meta.env` or `globalThis.process`. Most are
comments or literal reads. The reads that are **not** `process.env.LITERAL` /
`import.meta.env.LITERAL` are these, and they are the whole problem:

| Site | Shape | Resolvable? |
|---|---|---|
| `src/jobs.ts:441` | `process.env[CONCURRENCY_ENV]` | `CONCURRENCY_ENV` is a module-level string literal |
| `src/hierarchy-deepen.ts:1641` | `process.env[DEEPEN_ENV]` | same |
| `src/hierarchy-deepen.ts:1747` | `process.env[REASK_ENV]` | same |
| `src/hierarchy-deepen.ts:1896` | `process.env[DEEPEN_RECORDS_ENV]` | same |
| `src/fetch.ts:602` | `const seen = (name) => "... " + process.env[name] ...` | a local helper; three call sites, all string literals |
| `src/web/lib/supabase.ts:34` | `import.meta.env[name]` | a helper; call sites are literals |
| `src/models.ts:1092` | `process.env[envVar]`, `envVar` from `MODEL_ENV_VAR[task]` | **inherently computed** — 12 names, all `SPIDERYARN_*_MODEL` |
| `src/vercel-health.ts:530` | `process.env[name]` inside `value(name)` | **inherently computed** — it is the reporter iterating `EXPECTED` |
| `src/env.ts:85` | `const INHERITED = { ...process.env }` | whole object |
| `src/env.ts:113` | `applyEnvFile(text, process.env, INHERITED)` | whole object passed to a function |
| `src/env.ts:194` | `chooseTargetUrl(choice.shellWins, INHERITED, process.env)` | whole object |
| `src/env.ts:287` | `env: withoutGitVars(process.env)` | whole object |
| `src/env.ts:341/346` | `env[name]` read and write inside `applyEnvFile`, `name` from the file's own text | genuinely dynamic by design |
| `src/env.ts:373` | `env[PINNED]`, `PINNED = "SPIDERYARN_ENV_PINNED"` | literal, but two hops from `process.env` |

`src/env.ts:373` is the one that matters most as evidence: `SPIDERYARN_ENV_PINNED` is a real
variable that **no inventory anywhere knew about**, found only because something tried to enumerate
these.

## The two routes already on the table

**A — make the tree literal, not the check clever.** Rewrite the six resolvable-by-const sites as
`process.env.SPIDERYARN_…` (and `import.meta.env.VITE_…`), leaving `models.ts` and
`vercel-health.ts` as two named exemptions. Claim: this deletes the resolution problem, and what
remains is a ~150-line check with no alias-following, no scope analysis, no binding resolution — the
machinery every one of your nine P1s lived in.

**B — sign off the read sites instead.** Leave `src/` alone. Inventory only the trivially sound
forms, **refuse every other read**, and hold the refused ones against a small explicit table naming,
per site, the names a human verified it yields — plus a fifteen-line check per row that the site
really is only called with those literals (e.g. "every call of `seen` in `fetch.ts` is
`seen("LITERAL")`, and the literal set equals this row").

## What I actually want from you

**Answer these in order, and lead with the recommendation.**

1. **A, B, a hybrid, or neither?** If neither — if the honest answer is that this postmortem item
   should be closed as *not worth building* and the six `EXPECTED` entries are the whole return —
   say so plainly. That is a legitimate answer and I will take it. It has now been asked for twice
   over twelve days and refused twice in review; "it keeps failing because it is not worth its
   complexity" is a real hypothesis.

2. **`src/env.ts` is the hole in both routes, and I think neither A nor B addresses it.** It handles
   the environment as an *object*: spread at line 85, passed whole to three functions, indexed by
   names that come from a file's own text at 341/346. Route A cannot make that literal. Route B
   must either exempt the file — which is exactly the exemption that hid `SPIDERYARN_ENV_PINNED`
   (your F13) — or reason about a passed-around object, which is the machinery A exists to delete.
   **What is the right treatment of `src/env.ts` specifically?** Be concrete. If the answer is
   "restructure `env.ts` so the environment stops travelling as a value", say what that looks like
   and whether it is worth it.

3. **Where should the refusal line sit so that soundness needs no claim?** Your round-2 F16 broke
   round-1's "root-object refusal is now sound" the moment somebody tested it. I want a design where
   nobody ever has to assert "this gate is now sound" — refuse by default, resolve only the
   trivially literal. Is that achievable here at all, and what exactly is the *smallest* set of AST
   shapes that can be accepted without a soundness argument? Name them.

4. **Is `import.meta.env` a second problem or the same one?** Vite rewrites it at build time and the
   client bundle's reads are compiled in. Does the check treat both doors identically, or is the
   client half a different question that should be answered differently (or not at all)?

5. **One operational question, and I want your read on it rather than a decision.**
   `SPIDERYARN_OWNER_ID` is in `EXPECTED` with `breaks: null`. `environmentOwnerId()`
   (`src/owner.ts`, ~line 271) *throws* when it is unset and `NODE_ENV === "production"` or `VERCEL`
   is set. `docs/project/deployment.md` covers it. Should it be promoted to a real `breaks` clause —
   i.e. is a production deployment without it definitionally broken, or is there a legitimate
   deployment that does not want it? Read the code and the doc rather than taking my summary.

## Rules of engagement

- **Read the source, not my table.** If any row above is wrong about the tree, that is itself a
  finding and I want it.
- **Rank by cost.** Say roughly what each route costs in lines changed, files touched, and how many
  of your nine P1s it structurally cannot have.
- **Be concrete about file and line numbers.**
- **Check your recommendation against the nine attacks** in the plan doc's control spec before you
  write it. If your recommended route would not go red on all nine, say which and why that is
  acceptable.
- Do not change any file.

## Severity, if you raise defects along the way

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Put an ID on every finding (`P1-1`, `P2-1`, …).

## My own leaning, which is worth less than yours — read it last

I lean A, and so did Fable when it arbitrated yesterday. My worry about A is that it is a change to
*production code* to make a *test* easier, which is usually the wrong direction, and that
`process.env[CONCURRENCY_ENV]` with a named const at the top of the file is arguably better code
than an inline literal. My worry about B is that "a human verified this row" is a comment, and this
whole batch exists because comments decay while checks do not.

I also suspect the right answer is A **plus** a much smaller B for the two inherently-computed sites,
and that `src/env.ts` wants its own answer that is neither.
