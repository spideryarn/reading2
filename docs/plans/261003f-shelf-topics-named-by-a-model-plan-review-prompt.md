# Plan review: shelf topics named by a model (261003f)

You are reviewing a **plan and the evidence behind it**, read-only. Do not edit any file. Nothing
has been built; the plan stops for the owner (Greg) with three questions. Your job is to find what
is wrong, missing or overstated before he reads it.

Read, in this order:

1. `docs/plans/261003f-shelf-topics-named-by-a-model-as-concepts-not-phrases.md` — the plan.
2. `docs/investigations/261003b-shelf-topics-as-concepts-not-phrases.md` — the eval write-up.
3. `docs/research/261003a-topic-models-and-clustering-for-shelf-topics.md` — the options.
4. The evidence: `evals/shelf-topic-clusters/` (`run.ts`, `summarise.ts`, `make-pairs.ts`,
   `tally.ts`, `file-one.ts`, `results/summary.md`, `results/pairs/`, `results/pairs-key.json`,
   `results/judgements/`, `results/file-one.txt`) and the new synthetic shelf
   `evals/shelf-topics/synthetic/greg-wide.json`.
5. What exists today: `docs/project/shelf-terms.md`, `src/shelf-terms/model-scores.ts`,
   `src/shelf-topics.ts`, `src/store/pg-shelf-terms.ts`, `src/shelf-terms/choose.ts`, and the
   client (`src/web/useShelfTerms.ts`, `src/web/ShelfTermChip.tsx`, `src/web/topic-colour.ts`).

Check in particular, and say so plainly where the plan is wrong:

- **The conclusion.** Does the evidence support "the model proposing topics beats today's list and
  beats embedding clustering"? Is the eval fair to production and to the clustering arm (look at
  how each arm is built in `run.ts`, at the post-hoc neighbour-count change, at greg-wide's short
  texts, at the judge prompt's wording as described in the investigation)? Recompute the tally from
  the judgement files and the key yourself. Is anything in the investigation's numbers not what the
  files say?
- **The cost table.** Recompute every figure from the measured per-call numbers in the result
  files. Is the arithmetic right, are the assumptions stated, is anything missing (the two scopes,
  retries, reasoning tokens, the allowance)? Is "stage 1 capped at 150 is under half a cent per
  added article" true?
- **The design against the real code.** Does "everything around the model call is kept" hold?
  Look for what the plan has not noticed: how `inputHash` and the refresh trigger behave when the
  stored labels are fed back into the prompt (does the hash then change on every refresh and loop?);
  what `articles[].count` is used for on the client and what breaks when there is no phrase count;
  how `topic-colour.ts`, the More-detail view, `?topics=` key dropping, and the "a key it did not
  score is left out" rule behave with model topics; exact-copy works; articles added after the
  stored answer; the `active` and `all` scopes; skipped (non-English) articles; the fallback when
  the stored row has `topics` from an older shelf.
- **Stage 2.** Is filing one article at a time against a fixed list sound? What is the failure
  shape (an article that fits nothing, label drift, a re-think that renames everything, races
  between a filing and a re-think)? Is the 25% trigger sensible?
- **Security.** Titles and gists are untrusted web text and the label is now model output shown on
  screen. Read `docs/project/security-map.md` as far as it bears on this. Is the plan's paragraph
  enough?
- **The questions for Greg.** Could he answer each from what is written, without knowing the code?
  Is any option mis-described, or a better option missing? Is there a simpler product decision that
  would take a lot of the engineering out?
- **Anything the plan calls measured that is arithmetic, or the reverse.**

Report findings numbered, most serious first, each with: what is wrong, the evidence (file and
line, or the recomputed number), and what you would change. Mark each P0 (the conclusion or a
question for Greg is wrong), P1 (a real gap in the design), or P2 (wording, minor). End with one
line: is this ready to put in front of Greg once the P0s and P1s are dealt with?
