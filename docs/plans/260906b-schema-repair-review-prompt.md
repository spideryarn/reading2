# Review: the Debate valence bug is a schema defect, not a prompt defect — and the fix is a discriminated union

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/critiques-mode`, branch `worktree-critiques-mode`.
TypeScript + ESM, `strict` and `noUncheckedIndexedAccess` on. You have reviewed this plan three times
before (rounds 1–4, findings F1–F64); **number anything new from F65 up.**

## The candidate

**A design decision, not code — nothing is implemented yet.** That is deliberate: I want this ruled
on before it is built, because it reverses two of your own earlier findings.

Live pre-commit: base `121d9164`; scoped path:
`docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md`, the new section
**`### E″ — and then the free evidence said E′ was fixing the wrong thing, 2026-09-08`**; untracked:
none. (Not durable — I will record the resulting commit SHA here once it lands.)

Start with that section, then `src/types.ts` (`DebateRelation` and `DebateValence`, ~3500–3550, and
`DebateRowBase` below them), `src/debate.ts` (the `READING` prompt block ~1080, `DIRECT_SYSTEM`,
`CLAIMS_SYSTEM`, and the coercion in `parsePass` ~800), and `src/web/DebatePanel.tsx`
(`VALENCE_APPEARANCE` ~225, `Row` ~1152). This is where to begin, not the limit of scope.

## The bug

Debate mode lists outside web pages responding to the article being read. Each row carries two
model-produced fields, `relation` (`disputes | qualifies | extends | corroborates | unclear`) and
`valence` (`positive | negative | neutral | unknown`). `valence` draws a coloured chip:
positive→"Supportive" green, negative→"Critical" red, the other two grey.

Three stored rows draw a chip that contradicts the row. All three are real, all from one run:

| stored | source | the model's own `applies` sentence |
|---|---|---|
| `disputes`/**positive** | psi-encyclopedia | "…Geller did appear to bend metal, **contradicting** the implication from Feynman's own null result…" |
| `corroborates`/**negative** | skepticalinquirer | "**Backs** Feynman's skeptical result… **supporting** the 'nothing happened' conclusion." |
| `disputes`/**positive** | psi-encyclopedia | "A pro-parapsychology source **pushes back** on the picture of vanishing… ESP results…" |

Note that `relation` and `applies` are **correct in all three**. Only the enum drifted, to the
source's stance toward *its own* subject — psi, Geller — rather than toward the row's target.

## The evidence, and how it was gathered

Two crosstabs, both free, both read-only, both reproducible.

**(1) 26 raw reported rows** from the three real journalled runs (`evals/debate/journal-rows.ts`
against `output/debate-runs/*`, excluding the `-check` runs, which replay one synthetic
`bakingreview.example` fixture twelve times):

```
                positive  negative   neutral   unknown
disputes               0        12         0         0
qualifies              0         3         4         0
extends                2         0         0         0
corroborates           5         0         0         0
unclear                0         0         0         0
```

**(2) 35 kept rows** from `spideryarn.article_revisions.debate` (two articles; four of the six
revisions are near-identical re-runs, so treat the independent count as ~13): `disputes` 9 negative
and **2 positive**, `qualifies` 10 neutral, `extends` 5 positive, `corroborates` 6 positive and
**1 negative**, `unclear` 2 unknown. The three bold cells are the three bugs above.

## The claim I want you to check, stated at its true strength

Not "is this design sound" — that has no floor. **These four statements, and whether each is
accurate:**

- **S1.** Across the 61 real rows measured, `valence` is *entailed* by `relation` on `disputes`,
  `corroborates` and `unclear` — 0 of 32 rows where it says anything `relation` had not already
  said — and *open* on `qualifies`, where it splits 3 against / 4 neither and the distinction is
  correct on inspection. `extends` is 7 rows, all positive, and the evidence there is too thin to
  call.
- **S2.** Therefore `disputes`+`positive` and `corroborates`+`negative` are **contradictions under
  the plan's § 4 definitions of the two fields**, not judgement calls — so a type that cannot spell
  them removes the observed failure class entirely, and the remaining question is a compile error
  rather than a rate.
- **S3.** That is **not** the derived-valence rendering rule your F9 and F35 refused. Those refused a
  chip that overrides a field the model is still asked for. This stops asking for a stance where the
  stance is entailed, so there is nothing to override.
- **S4.** The failure is **article-conditional, not stochastic**: it needs a source population whose
  own polarity opposes its stance toward the article (believer pages disputing a sceptic). Feynman
  has one and scored 3/7; the Constitution article does not and scored 0/15. So the earlier framing
  "3/22, stochastic" was wrong, and any paid verification sweep is uninformative unless it includes a
  sceptic-versus-believer article.

**If S1–S4 hold, the paid work is unnecessary** — C′'s repetition harness, D′'s hand-labelling and
F63's live smoke run all stop being on the critical path, because the red-then-green test is the
three known packets replayed for free. **That inference is itself S5, and it is the one I most want
attacked**, because it is the conclusion that saves the money and is therefore the one I am most
motivated to believe.

## The change proposed

- `relation` keeps its five values. A `lean` rides **only** on `qualifies` (and `extends`, on thin
  evidence — say whether to include it). A discriminated union, so `disputes` + a stance cannot be
  spelled.
- `parsePass` reads the model's stance only on those relations and discards it elsewhere — the same
  seam as the existing `RELATIONS.has(...) ? ... : "unclear"` coercion, not a new kind of repair.
- The chip is derived for the entailed relations and read from `lean` for the open ones. Every one of
  the 32 correct rows draws exactly the chip it draws today; the three wrong ones become impossible.
- `lean`'s values are renamed from sentiment words to agreement words
  (`leans-against | neither | leans-for | cannot-tell`), because `positive | negative` is
  sentiment-analysis vocabulary and is what invites reading the source's own subject.
- Prompt: group one currently never binds the word *target* at all (group two does, at ~1192), and
  neither group rules out the source's own subject. Both get that; `relation` and `valence` are given
  the same subject and target.
- Docs: `DebateRelation`'s docblock says *"Orthogonal to `DebateValence` below, and the two must stay
  that way."* The data refutes it and it goes.

## What you can and cannot run

The tree is read-only; `/tmp` and the `node_modules` caches are writable. You can run one test file
(`npx vitest run tests/debate.test.ts`) and a script (`node --import tsx <script>`). You have **no
network and no Postgres**, so crosstab (2) you cannot re-derive — its script is
`/tmp/claude-1000/.../opus-crosstab.mts` and I accept you must take it on my word. Crosstab (1) you
**can** re-derive: `output/debate-runs/` is in the tree and `evals/debate/journal-rows.ts` reads it.
Please do, and tell me if my numbers are wrong — I got them wrong once already this session by
counting the synthetic fixture twelve times.

## Attack it

Independently, before you read my suspicions below. **The invariant to break: that there exists no
real row in which a stance field carries information on `disputes`, `corroborates` or `unclear` that
`relation` does not already carry.** One counter-example sinks S1 and most of what follows.

For each finding give:
- an ID (**F65 upward**), a severity (P0/P1/P2/P3), and whether it is established or reasoned
- (a) what shows it fails its own claim — for a plan, the concrete scenario it does not handle or the
  authoritative contract it contradicts
- (b) the smallest change that closes it — exact replacement wording, or a code block

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Refuse only on an **established** P0 or P1, and name what established it.

## Previous findings this reverses

| ID | Finding, verbatim (abridged) | Disposition |
|----|------------------------------|-------------|
| F9 | Refused deriving the icon from `relation`: "an author's own later post can dispute, qualify, extend or corroborate their earlier piece… derived valence makes it neutral by construction and throws the useful part away." | **Disputed.** Under § 4's definition that author *is* negative toward the earlier claim. What F9 protects is that the row not read as *hostile* — which is **provenance**, and the same docblock already rules provenance out of `relation`. Tell me if this reading is wrong. |
| F35 | An opposite pair is not a contradiction; it is an inspection mark only. | **Partly disputed.** Still true as a *rendering* rule. But on `disputes` and `corroborates` specifically, the pair is a contradiction under § 4, and the corpus contains no honest instance. |
| F54, F58, F61, F62, F63 | The prompt repair, the repetition harness, the raw-vocabulary gate, the live smoke run. | **Superseded or demoted** if S5 holds. F62's raw-vocabulary gate I intend to keep regardless. |

You wrote all of these. **I would rather you defend them than concede them** — if F9 was right and I
have talked myself out of it with a small corpus, that is the single most useful thing you can tell
me today.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.

- The corpus is **two to three articles**. `qualifies`'s 3-versus-4 split rests on three rows. I may
  be generalising a habit of one model on one week's articles into a schema.
- `extends` at 7/7 positive is thin, and I am inclined to give it a `lean` mainly out of nerves.
- A discriminated union over `relation` makes every consumer of `DebateRow` handle five cases where
  it handled one field. That may be a worse braid than the one it removes.
- Stored JSONB written before this change has `valence` on every row. Readers of old artefacts must
  keep working, and I have not designed that part.

Do not change any file.
