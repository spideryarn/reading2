# Review: the Debate lean rename — the code built from your round-5 findings

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode`, branch `worktree-critiques-mode`.
TypeScript + ESM, `strict` and `noUncheckedIndexedAccess` on. This is **round 6**; findings so far run
to **F70**, so number anything new from **F71** up.

## The candidate

Committed: `6b5e99a1` (the code), on top of `e49ea50a` (the plan section you reviewed in round 5).

    git diff b293a54b..6b5e99a1

Changed paths — 25 files:

    docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md
    docs/plans/260906b-schema-repair-review-sol.md          (your round-5 answer, committed as-is)
    docs/postmortems/260908b-an-enum-whose-vocabulary-asked-a-different-question-than-the-field.md
    evals/debate/{journal-rows,label-sheet,run,score,verify-fixture}.ts
    src/debate.ts
    src/types.ts
    src/web/DebatePanel.tsx
    src/web/styles/debate.css
    tests/debate-bar.test.ts
    tests/debate-eval-journal-rows.test.ts
    tests/debate-eval-score.test.ts
    tests/debate-identification.test.ts
    tests/debate-label-sheet.test.ts
    tests/debate-legacy-lean.test.tsx          (new)
    tests/debate-panel.test.tsx
    tests/debate-passes.test.ts
    tests/debate-prompt-target.test.ts         (new)
    tests/debate-step-registration.test.ts
    tests/debate.test.ts
    tests/every-mode-draws-its-surface.test.tsx
    tests/mode-surface-changes-no-markup.test.tsx

Start with `src/types.ts` (`DebateRelation`, `DebateLean`, `DebateRowBase.lean`, and the new
`readStoredLean` near `isDebateDocument`), `src/debate.ts` (`LEAN_MEMBERS`/`LEANS`, the coercion in
`readShared`, and the `READING` / `DIRECT_SYSTEM` / `CLAIMS_SYSTEM` prompt blocks), and
`src/web/DebatePanel.tsx` (`LEAN_APPEARANCE` and the `Row` component). That is where to begin, not the
limit of scope — the manifest above is.

## What it does, and what it deliberately does not

**You refused the discriminated union in round 5 and I accepted every finding.** `lean` is on every
relation, `unclear` included (F66). Nothing here forbids an opposite pair. § 4's two honest examples
are intact, and one of them is now quoted *in the prompt* as the case where relation and lean come
apart truthfully.

What shipped instead:

1. **`DebateValence` → `DebateLean`**, the field `valence` → `lean`, and the values from sentiment
   words to agreement words: `leans-for | leans-against | neither | cannot-tell`. Rationale: the old
   vocabulary could be answered without the target at all, which is the mistake the three bad rows
   made. Reader-facing labels are unchanged.
2. **Both prompts now rule out "whatever the outside piece is itself discussing"**, which neither did.
   The claims prompt ruled out the article-as-a-whole and tone, and those are still ruled out.
3. **Group one gets a target binding**, which it never had.
4. **`relation` is rescoped** from the outside *page* to the *quoted passage*, so both fields name the
   same subject and target (F54).
5. **`readStoredLean`** — your F68. One accessor, called by the panel, mapping the four legacy values
   and defaulting to `cannot-tell`.
6. Docblocks: `"Orthogonal … and the two must stay that way"` is softened to *strongly associated in
   practice, not functionally dependent*, per your F65 wording.

**Deliberately not done:** anything that would claim the interpretation is fixed. Per your F67 and
F70, a rename removes an invitation and does not make a model judgement checkable, and the same
collapse may migrate into `relation`. No paid run has happened; the F63 smoke is still unasked.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. `npx vitest run
tests/<one>.test.ts` works and so does `node --import tsx <script>`. **No network and no Postgres**, so
anything touching the database will skip.

Worth running, because both were written to fail and I want you to check that claim rather than take
it: `tests/debate-legacy-lean.test.tsx` and `tests/debate-prompt-target.test.ts`.

## The claims I want checked, each at its stated strength

Not "is this good". Each of these is a statement I have made in a commit message, a docblock or a
postmortem, and the question is **whether it is accurate**:

- **C1.** `readStoredLean` makes every row written before this commit render correctly and without
  throwing — for all four legacy values, for a row with neither field, and for junk in either field.
  **Is there a path to the appearance table that does not go through it?** That is the failure I most
  expect to have missed, and grep is the right instrument.
- **C2.** The vocabulary is total by construction in every place that holds one: `LEAN_MEMBERS` in
  `src/debate.ts`, `LEAN_KEYS` in `evals/debate/score.ts`, `LEAN_APPEARANCE` in `DebatePanel.tsx`, and
  `LEAN_MEMBERS` again in `src/types.ts`. **Four mapped types over one union — is that four guards or
  one guard and three copies that can drift?** I think it is fine because each is a mapped type over
  `DebateLean`, so omitting a member is a compile error in each. Tell me if a member can be *added*
  somewhere without one of them noticing.
- **C3.** Nothing outside Debate was caught by the rename. Referee mode has its own unrelated
  numeric `valence` (`Comment.valence`, `src/web/valence.ts`, `CriteriaPanel`, `routes.ts`, the
  `dhue=valence` URL param), and none of it was touched. **Check I did not clip any of it, and that I
  did not miss a Debate one.**
- **C4.** The two new test files can actually fail. I mutated the panel to bypass the seam
  (`TypeError: Cannot read properties of undefined (reading 'icon')`, four tests red) and deleted the
  negation clause from the prompts (two tests red), then restored both. **Are these tests tautological
  in any other respect** — in particular, does `tests/debate-prompt-target.test.ts` assert anything
  that would survive the prompt being rewritten to mean the opposite?
- **C5.** The prompt still parses as an instruction to a model, and the answer-format examples match
  the vocabulary the parser accepts. This is F62's free half. Read `READING`, `DIRECT_SYSTEM` and
  `CLAIMS_SYSTEM` as if you were the model answering them, and say whether any instruction is
  ambiguous, self-contradictory, or now says something we did not intend. **The worked example about
  supplements is load-bearing and I would like your opinion on whether it teaches the right rule.**

## Previous findings

| ID | Disposition | What changed |
|----|-------------|--------------|
| F65 | **fixed** — union abandoned entirely | `lean` on every relation; § 4's examples quoted in the prompt as honest divergence |
| F66 | **fixed** | `unclear` carries a lean like every other relation |
| F67 | **accepted, not fixed — recorded** | Plan § E″ "What this does not fix"; the postmortem's "fix that is right for the long term"; the commit message |
| F68 | **fixed** | `readStoredLean` + `tests/debate-legacy-lean.test.tsx`, mutation-checked |
| F69 | **fixed (prose)** | Plan now says content-conditional *and* still stochastic, in your words |
| F70 | **accepted, not fixed — recorded** | The three packets are named as regression fixtures, not evidence; F62 and F63 both survive |

Treat all of the above as unreviewed code written by someone else.

## My own suspicions — read last

Already my doubts, so confirming them is worth less than anything you find yourself.

- The rename touched ~20 test files mechanically, largely by a subagent. A fixture that had its
  *meaning* changed rather than its spelling is the thing I would least likely notice. One assertion
  did change meaning on purpose: `tests/debate-label-sheet.test.ts` dropped `"lean"` from a list of
  field names that must never appear in the blind sheet, because the sheet's own instruction contains
  the word "leans". Check that the blinding is genuinely unweakened.
- `evals/debate/run.ts` and `verify-fixture.ts` contain synthetic model responses that I changed to
  the new vocabulary. If those fixtures are meant to be *historical* records of what a model once
  said, changing them was wrong and I would rather know.
- `sourceIsCopy` remains a loss reason no corpus row has ever triggered. Unrelated to this change,
  and I mention it only so it is not mistaken for something this commit introduced.

Do not change any file.
