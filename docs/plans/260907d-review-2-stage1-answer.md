## Verdict

**Refuse as-is** on three established P1s: F9–F11. The shipped prompt can produce malformed questions, and its gist-echo guard misses the production-required V4 shape.

### F9 — P1 — established: valid long hints receive a second `?`

[a question with a prompt-compliant 47-character hint](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy.ts:296) becomes:

```text
Evidence — how should we compare these accounts? (a comparison across historical and modern cases)?
```

That line is only 15 words, uses an answer-shape rather than answer content, and satisfies every stated prompt constraint. The undocumented 40-character limit rejects it.

The supposed bound test does not test the bound: [its input has no `?` before the parenthesis](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/tests/summaries-eval.test.ts:226), so both the bounded and unbounded regexes reject it.

Smallest fix:

```ts
if (/\?(?:[ \t]*\([^()\r\n]+\))?$/.test(q)) return q;
```

Replace the current test with one using a `?` followed by a hint longer than 40 characters, and retain the no-`?` parenthetical case as a separately named fallback test.

### F10 — P1 — established: the V4-shaped gist echo is not caught

The passing test at [summaries-eval.test.ts:218](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/tests/summaries-eval.test.ts:218) omits V4’s mandatory topic prefix. The production-shaped input:

```ts
gist:
  "Four independent arguments undermine computation."

question:
  "Computational functionalism — Four independent arguments undermine computation? (4 arguments)"
```

is kept verbatim by `questionFor`. The topic prefix prevents equality, even though everything after it is exactly the gist re-asked. Because Summary renders `question ?? gist`, the reader gets the wall rather than the intended door.

Smallest fix is a question-specific normaliser that removes V4 syntax before comparison:

```ts
function bareWords(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ");
}

function bareQuestionWords(s: string): string {
  const withoutHint = s.trim().replace(/\?[ \t]*\([^()\r\n]+\)$/, "?");
  const withoutTopic = withoutHint.replace(/^[^—\r\n]+—[ \t]*/, "");
  return bareWords(withoutTopic);
}

// …
if (
  mn.gist !== undefined &&
  bareQuestionWords(q) === bareWords(mn.gist)
) return undefined;
```

Add tests for both `<topic> — <gist>? (<hint>)` and `<topic> — <gist>?`.

### F11 — P1 — established: `bareWords` changes unrelated inputs and strips gist content

[The new replacement](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/src/hierarchy.ts:267) runs on both question and gist, and removes every terminal parenthetical—not merely a hint following `?`.

This disproves the explicit “every other shape unchanged” claim:

```ts
gist:     "The treatment works."
question: "The treatment works (tentatively)"
```

Parent output:

```text
The treatment works (tentatively)?
```

Candidate output:

```ts
undefined
```

It also lets an exact echo survive when the gist itself ends with a substantive parenthetical and no final punctuation:

```ts
gist:
  "Systems can compute without awareness (in principle)"

question:
  "Systems can compute without awareness (in principle)? (a thought experiment)"
```

The candidate keeps the question because the gist loses `(in principle)` while the question retains it.

Smallest fix: use the purpose-specific `bareQuestionWords` above and delete parenthetical stripping from `bareWords`. Add both examples as regressions.

### F12 — P2 — established: the stub’s V4 branch is unreachable

[The stub checks `arm.variant === "V4"`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/run.ts:226), but no arm has that variant after `v4` was removed. Five current arms carry the V4 prompt; zero receive V4-shaped stub output. Therefore `--stub` no longer exercises the trailing-hint seam it claims to exercise.

Smallest fix:

```ts
return async ({ system, user }) => {
  const trailingHintShape =
    system.includes('"<topic> — <question>? (<shape hint>)"');

  // …
  entry.question = trailingHintShape
    ? `STUB topic — what does ${id} argue? (2 reasons)`
    : `STUB topic (2 reasons): why does ${id} argue what it argues?`;
};
```

### F13 — P2 — established: the V4 half of the control is still live, not pinned

[`questions-toc6`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/arms.ts:335) pins its old QUESTIONS block, but its comparator [`gists-toc6`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/arms.ts:289) has neither `variant` nor `shippedQuestions`. Consequently [it resolves through `productionQuestions()`](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/arms.ts:389).

Change one word in the live QUESTIONS block and the purportedly pinned V4 half changes. This directly contradicts “both halves stay put when `src/hierarchy.ts` moves again.”

Smallest fix: pin V4 on both members of the gist-length pair:

```ts
{
  name: "gists-toc5",
  shippedGists: "toc/5",
  variant: "V4",
  // …
},
{
  name: "gists-toc6",
  shippedGists: "toc/6",
  variant: "V4",
  // …
},
```

Then update `LENGTH_PAIR_DELTAS` and the tests to compare their QUESTIONS block with `readVariants().questions.get("V4")`, not the live production slice.

### F14 — P2 — established: duplicate pinned sections silently select one copy

[The new shipped-QUESTIONS discovery loop](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/variants-file.ts:174) uses a `Map`, while `fencedUnder` always finds the first matching heading.

I supplied two `## The shipped QUESTIONS block, toc/6` sections, poisoned the first with `always "which example"`, and retained the strings current tests pin. `readVariants` returned successfully, used the poisoned block, and reported one map entry despite two headings.

Smallest fix:

```ts
if (shippedQuestions.has(version)) {
  throw new Error(
    `variants.md: duplicate shipped QUESTIONS section for ${version}`,
  );
}
```

Apply the same uniqueness rule to discovered variants and shipped GISTS, then mutation-test duplicate headings.

### F15 — P3 — established: the parser’s language-tag guarantee is false

[The parser header](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/variants-file.ts:16) says losing a fence’s language tag throws. Every current prompt fence in `variants.md` is untagged, and parsing succeeds.

Smallest correction:

```text
A section that moved, a fence that disappeared, or an anchor row that
stopped being a table row: each throws…
```

### F16 — P3 — established: removal of `v4` left stale executable documentation

Three live comments still describe the retired arrangement:

- [generate.ts:269](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/generate.ts:269): “six of the seven arms, V4’s patch”
- [score.ts:77](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/evals/summaries/score.ts:77): production “mangles” V4
- [summaries-eval.test.ts:580](/home/greg/code/spideryarn2/.claude/worktrees/fb1v-socratic-v4-and-the-eval/tests/summaries-eval.test.ts:580): same obsolete claim

Replace them respectively with:

```text
Put every question through production's questionFor.
```

```text
The hint sits after the `?`, which is V4's shape and production's since toc/7.
```

```text
reads V4's post-question hint shape
```

## Checks that held

- Production’s QUESTIONS block is byte-identical to V4.
- The pinned toc/6 QUESTIONS block is byte-identical to the parent commit’s block.
- The old and new checkpoint keys independently recompute to `9022c4cb6b7395b1` and `8e314a56003e9d89`.
- `toc/7` does not backfill existing trees.
- Removing the standalone `v4` arm is otherwise sound: its live recipe is represented by `gists-only`, and historical run reporting does not resolve arms through today’s registry.
- `npx vitest run tests/summaries-eval.test.ts`: 63/63 passed, demonstrating that F9–F12 are gaps in what the green test measures.
- No files were changed.