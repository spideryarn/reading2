## Verdict

Refuse the discriminated union as written. F65 and F68 are established P1s: the proposed schema contradicts the existing §4 contract, and it has no compatible read path for stored JSONB.

Your raw crosstab is correct: 26 rows, with the exact five cells reported, after excluding all `-check` runs. All three journals reported zero completeness problems. `npx vitest run tests/debate.test.ts` also passes: 55/55.

| Statement | Ruling |
|---|---|
| S1 | False. The tables show association, not entailment; `unclear` alone supplies a counterexample. |
| S2 | False under the current §4 definitions. It would become true only after a stronger, currently unstated contract change. |
| S3 | Partly true. Removing a field differs mechanically from overriding it, and your reading of F9’s self-correction example is right. F35 still blocks the union. |
| S4 | False. The risk is content-conditional and still stochastic. |
| S5 | False. Free replay proves a projection rule, not the revised model behaviour, live wire contract, or legacy compatibility. |

### F65 — P1, established: the union contradicts the plan’s own authoritative contract

(a) Earlier in the same plan, §4 defines `relation` as the argumentative move and `valence` as the overall stance, then gives two explicitly honest opposite pairs:

- “10% is wrong; it is at least 30%, which makes the warning stronger” → `disputes` + supportive.
- “The reported figures are right, but the conclusion … is indefensible” → `corroborates` + critical.

Those remain in the candidate as valid examples at [the plan](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md:48), while E″ calls the same pairs contradictions at [line 638](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md:638).

Giving both fields the same subject and target does not resolve this: a passage can dispute one proposition while supporting the target’s broader conclusion. This is particularly unavoidable in group one, where the target is an entire article, not an atomic claim.

The crosstab cannot overturn that contract. Of the 35 directional `disputes`/`corroborates` observations, 32 align and three diverge; calling the three divergences errors before using the remaining 32 to establish entailment is circular.

(b) Smallest correction:

> The crosstabs show that `relation` and stance are strongly associated in this corpus; they do not establish a functional dependency. `relation` describes the passage’s argumentative move, while `lean` describes its overall stance toward a potentially composite target. Retain `lean` on every relation, while renaming its values and repairing the target wording.

If the union is still desired, first make the separate product decision that `relation` describes the passage’s overall directional relationship to one atomic proposition, and explicitly reclassify both §4 counterexamples. That contract does not fit current group-one rows without further redesign.

### F66 — P1, reasoned: `unclear` does not entail `cannot-tell`

(a) A passage can say, “I agree with the article’s conclusion,” while the available extract does not reveal whether it corroborates it, extends it, or merely endorses it. Its stance is clearly `leans-for`; its relation is legitimately `unclear`.

The current contract deliberately treats `unclear` and `unknown` as separate facts, and says each uncertainty should be believed ([types.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/types.ts:3517)). Deriving “Could not tell” from `relation: unclear` throws away a clear stance and breaks the proposed invariant directly. The two stored `unclear`/`unknown` rows show only that this did not arise in the tiny corpus.

(b) At minimum:

```ts
type DebateReading =
  | { relation: "disputes"; lean: DebateLean }
  | { relation: "qualifies"; lean: DebateLean }
  | { relation: "extends"; lean: DebateLean }
  | { relation: "corroborates"; lean: DebateLean }
  | { relation: "unclear"; lean: DebateLean };
```

So yes: include `lean` on `extends`, and also on `unclear`. Under the present contract, include it everywhere.

### F67 — P1, reasoned: the type cannot make the visible failure class impossible

(a) Model JSON enters as `unknown`; enum membership is imposed at runtime ([debate.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/debate.ts:796)). A future answer can legally normalize to:

```ts
{
  relation: "disputes",
  applies: "Backs Feynman’s skeptical result and supports his conclusion."
}
```

The proposed union accepts it and derives a red Critical chip. Therefore it makes only a `relation`/`lean` contradiction unrepresentable after parsing. It cannot make “the chip contradicts the row” impossible, because neither `applies` nor the source evidence is type-related to `relation`.

This is also how wrong-target behaviour can migrate: after stance is removed, the model can apply the same mistaken polarity when choosing `relation`.

(b) Replace the compile-error claim with:

> The schema removes disagreement between two stored categorical fields. It does not make target or interpretation errors impossible: `relation` and `applies` remain model judgments. Regression and evaluation must therefore score `relation` against the source and target, not merely assert that the rendered chip follows it.

### F68 — P1, established: legacy JSONB has no compatible read design

(a) Stored rows all have `valence` and none has `lean`. The database reader casts JSONB to `Debate`; `isDebateDocument` validates only that two arrays exist ([types.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/types.ts:3981)). The panel then accesses the categorical field directly ([DebatePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/web/DebatePanel.tsx:1152)).

If that becomes `LEAN_APPEARANCE[row.lean]`, every legacy row reaches the renderer with `undefined`; dereferencing `look.icon` then crashes. This exact repository already needed `lossesOf` because TypeScript did not describe old JSONB ([types.ts](/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode/src/types.ts:3877)).

(b) Add one explicit compatibility seam before consumers switch on the new type:

```ts
function storedLean(row: {
  lean?: unknown;
  valence?: unknown;
}): DebateLean {
  if (isDebateLean(row.lean)) return row.lean;

  switch (row.valence) {
    case "positive": return "leans-for";
    case "negative": return "leans-against";
    case "neutral": return "neither";
    default: return "cannot-tell";
  }
}
```

Use it in one normalization/accessor function, not separately in each consumer, and test a pre-change artefact containing all four legacy values. If relation-derived rendering is nevertheless chosen, that accessor must document which legacy values it intentionally ignores.

### F69 — P2, established: content-conditional does not mean non-stochastic

(a) A polarity-inverting source population is an opportunity condition, not a deterministic cause. Model sampling can still handle or mishandle that opportunity. The plan already records the same Feynman article producing correct labels in a later run; that evidence supports stochasticity rather than refuting it.

The Constitution result establishes only that its measured rows supplied fewer or no such opportunities. It cannot establish a zero error probability for that article class.

(b) Exact replacement:

> The risk is content-conditional and still stochastic. Sources whose stance toward their own subject opposes their stance toward the article create the opportunity for wrong-target classification; sampling determines whether it manifests. Aggregate `3/22` obscures that stratum, so semantic evaluation must include and report polarity-inverting packets separately.

### F70 — P2, reasoned: S5 removes checks that exercise different contracts

(a) Replaying the three old answers through a new parser tests only normalization and rendering. It never sends the revised prompt, never tests conditional `lean` omission, and cannot reveal whether the mistake migrated into `relation`. It also cannot exercise the live fenced response or old JSONB reader.

Consequently:

- F62’s raw-vocabulary/schema gate remains necessary.
- F63’s live smoke remains necessary as an integration check, though it is not evidence of semantic improvement.
- Any claim that the wrong-target interpretation was fixed still needs labelled, opportunity-bearing packets and repeated generation.
- The large generic sweep can be dropped if no statistical improvement claim is made.

(b) Replace S5 with:

> The three legacy packets are free parser/renderer regressions, not evidence about the revised model behaviour. They replace no live-schema or semantic check. Keep the raw-vocabulary gate and one live integration smoke. If the change is claimed only as a deterministic display policy, stop there; if it is claimed to fix wrong-target interpretation, retain a small labelled repeated comparison concentrated on polarity-inverting sources.

Your reassessment of F9 is correct in the narrow sense: an author correcting their own claim is against that claim, not “hostile,” and authorship is provenance. But F9’s obsolete example does not rescue the union; F35’s part-versus-whole counterexamples still do.

During the review the section landed as commit `e49ea50a` and was subsequently merged at `b293c9f0`. No code has been implemented, and I changed no files.