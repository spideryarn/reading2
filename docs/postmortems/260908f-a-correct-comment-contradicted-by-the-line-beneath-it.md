# A correct comment contradicted by the line beneath it

`parseAttentionList` in `tools/overseer/store.ts` read a missing `sessionsUnreadable` as `0`. Zero is
a positive claim that every session the pass scanned was successfully judged — the exact completeness
claim that field exists to **withhold**. It arrived through the parser rather than from anything that
had looked.

Introduced `2f849e7b` (2026-09-08 15:11), *"The attention inbox's deciding half"*. Found the same
afternoon by GPT Sol, reviewing the **dashboard's** half of the seam, and relayed by
`claude-agents-dashboard`. Fixed in `290b1ac3`, about ninety minutes after it landed.

## The class: a comment that states the right rule, and a line that breaks it

This is the part worth carrying, and it is not "a bad default".

```ts
// Absent on a list written before the field existed. Read as 0 rather than
// refused: the field says how much we FAILED to judge, and a producer that
// never had it made no claim either way — refusing the whole list over it would
// pay the expensive remedy for the cheap problem, which is this parser's rule.
const unreadable = u["sessionsUnreadable"];
...
sessionsUnreadable: typeof unreadable === "number" ? unreadable : 0,
```

Every clause of that comment is true. *A producer that never had it made no claim either way* is
precisely the right analysis. *Refusing the whole list would pay the expensive remedy for the cheap
problem* is also right, and it is that parser's stated rule. The comment reasons its way to the edge
of the correct answer — **and then the code substitutes a number, which is the one thing the analysis
forbids.**

The usual defence against a wrong default is a comment explaining the intent. Here the comment **was**
the intent, correctly stated. So the defence was present, was accurate, and pointed at the bug
without noticing it — and a reviewer reading the comment to check the code came away reassured. As
the session that relayed it put it: *a reviewer's eye slides straight over it.*

Name the class: **the reasoning and the line disagreed, and the reasoning was load-bearing for
trust.** Its signature is a comment ending in a conclusion, followed by code that does something
adjacent to that conclusion rather than that conclusion. It is not a stale comment (the usual
failure, where the comment describes an older behaviour); the comment describes the behaviour we
*want*, right now, and the code does not implement it.

### A second instance, in a different register

One example is an anecdote, so here is the other one from the same day, reported by
`claude-agents-dashboard`. It nearly wrote an auto-memory asserting *"the repo's guard does not cover
`tools/`"* — plausible, consistent with a pattern it had found that morning, and **false**. It was
caught only because it opened the test in order to cite it.

Different artefact, same shape one level up: **something authored specifically to be trusted later,
written without a check, in a place nobody re-derives.** A comment is trusted by the next reader of
the function; a memory is trusted by the next session, which has even less ability to test it. Both
are load-bearing precisely because they are the thing you consult *instead of* re-reading the code.

That is what separates this class from
[written-down-is-not-checked.md](../reusable/written-down-is-not-checked.md), which is the general
case — prose cannot fail, so nobody checks it. Here the prose **was** checked, by whoever read the
comment to verify the code, and it passed, and it vouched for the defect underneath it.

### The worst form: a documented absence looks like a decision

The third instance is from later the same day, and it is the same class at its strongest.

Mutation-testing the awk probe in
[260908h](../plans/260908h-one-shared-reader-for-a-claude-command-line.md) left one survivor. I
judged it an **equivalent mutant** — no command line can distinguish the guard from its absence —
kept the line, and wrote into both the commit message and the awk comment that *no test holds this
line, and here is why it cannot*. GPT Sol produced a command line that distinguishes it in about a
minute: a hand-set `CLAUDE_SESSION_ID` beginning with a dash, which this very file documents as a
supported case. I had checked the space I had in mind — valid uuids — and called it the whole space.

**An equivalence claim is a claim about the entire input domain.** But that is not what makes it the
worst form. A wrong equivalence claim is **self-sealing**: it tells the next reader that the missing
test is expected, so the one gap it names is the one gap nobody will re-examine. A missing test is an
absence somebody can notice. *A documented absence looks like a decision.*

Which is uncomfortable, because writing down what a test cannot see is a **good** discipline — the
dashboard session shipped a guard the same day whose docstring says outright that jsdom cannot see
the bug it guards against, and that sentence is worth having. The two are the same sentence and only
one of them is true. So the discipline is not "stop writing them"; it is that **a sentence claiming
something is untestable has to be earned to a higher standard than the test it replaces**, because it
is load-bearing precisely to the degree people believe it.

### What all three have in common, stated once

**A judgement about what cannot happen, made against the space you had in mind rather than the space
the code runs in.**

That is the sentence the whole day converges on, and it covers more than this file:

- *"No command line can distinguish that mutant"* — true of uuids, false of a hand-set
  `CLAUDE_SESSION_ID`, which the same file has an arm for.
- *"A `--print` inside the prompt must not be read as headless"* — a claim about a CLI, written as a
  property, and false: `claude` parses options after a positional, measured.
- *"D5 is a coincidence, not a design"* — I wrote that a headless pane could not actually be typed at,
  because a downstream screen check happened to cover it. Two red-first tests then **sent the
  message** — `send-keys -l -- "keep going"`, then `Enter`. It was not covered at the layer the code
  runs in.

The third is the worst of them, and not because it is the biggest: it is the only one where the wrong
answer **had already reached a keyboard**. The other two were waiting.

The remedy is not "be more careful". It is that a claim of impossibility is a claim about a **domain**,
so it has to name its domain — *no command line **whose id is a uuid*** — and then somebody has to ask
whether the code is restricted to it. Written that way the mutant claim disproves itself in one
reading, because `sessionState` has an arm for the ids it excludes.

## Why the obvious checks could not see it

- **The type system could not.** `AttentionList.sessionsUnreadable` is `number`, and `0` is a
  `number`. Nothing here is a wrong state the compiler could refuse — the wrongness is entirely in
  what the value *claims*. This is the limit of "let the types catch it": the flag was reachable
  because the type said "a count" where the honest domain is "a count, or nobody said".
- **The tests could not.** Every test wrote a list through the producer, and the producer always
  writes the field. The absent case was only reachable across a version boundary, which no fixture
  crossed.
- **The reviewer of this file could not**, for the reason above.

It took a reviewer of the **other side of the seam** — reading the consumer, asking what the consumer
could be made to believe — to see it.

## The fix, and the one I did not take

The list now degrades to `{kind:"unknown"}` carrying the reason. It **does not** refuse the whole
checkpoint: that would discard the register too, which is the expensive remedy the comment correctly
rejects. It self-clears on the next pass, two minutes later, and lands in an arm the consumer already
renders.

The items are lost, and that is the honest cost. They are real — but **a list that cannot say how
much it failed to read is not a list anybody can act on.**

The rejected alternative was bumping `STORE_SCHEMA` to 3, so a pre-field checkpoint is refused at the
schema gate and the register is rebuilt from the log. Defensible — a reader that ignored this field
is *wrong* rather than merely poorer, which is that constant's own bump rule, so arguably the field
should have arrived with a bump. But it pays a whole-register replay for an attention-list problem,
and the surgical fix is available.

## What would have caught the class, cheapest first

1. **When a parser has an `?? default` for an absent field, ask what the default CLAIMS.** Not
   "is it a sensible value" but "if I say this out loud, who is asserting it?" Here: *we scanned
   eleven sessions and judged all eleven*. Nobody said that. This is a five-second question and it
   would have caught it at the keyboard.
2. **Review the consumer, not the producer, when the bug is about meaning.** The producer's author
   knows what the field means and cannot un-know it. Sol found this by asking what the dashboard
   could be made to believe. That is an argument for the cross-family review being pointed at the
   *other* side of a seam at least once.
3. **A test that crosses a version boundary** — write the previous producer's output as a literal
   fixture and parse it. Cheap, and it is the only test that can reach a compatibility branch.
   Generalisable: every `if (x === undefined)` in a parser is a version boundary with no fixture.
4. **Make the honest domain the type.** `sessionsUnreadable: number | "not-stated"` cannot be
   defaulted into a lie. More expensive here — it is a wire change with a consumer mid-build — but it
   is the version of this fix that cannot regress, and it is what I would do if this field is ever
   touched again.

## Related

The principle this violated is already written down in three places, reached independently by three
modules — the health gap contract, the dashboard's `unknown` band, and `absenceGap` in
`tools/overseer/usage.ts`: **an incomplete observation may not be read as a negative one.** That it
was violated anyway, in a field built *specifically* to carry that principle, is the strongest
argument the codebase has for check (1) above: knowing the rule is not the same as noticing you are
about to break it.

See also [silent-success.md](../reusable/silent-success.md) — the house failure mode, of which this is
the parser-shaped variant.
