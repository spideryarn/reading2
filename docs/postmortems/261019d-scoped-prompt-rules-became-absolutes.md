# Scoped prompt rules became absolutes

Commit `385f08e55` made the guide default to treating every reader as not having read the article,
even after they said they had, and made the spoken guide lead every answer with a reading
suggestion, including direct questions about the article. Review caught both before the commit
landed on `dev`; nothing reached a reader.

The intended rules were conditional: default to language for somebody about to read unless they
say otherwise, and suggest first when they ask how to read or say why they are reading. The typed
and spoken prompts each dropped one of those conditions. The plan's own shorthand helped with the
first; a mechanical translation into the separately maintained spoken prompt caused the second.

## The class: scope erasure turns a default into an invariant

Prompt changes are often made by moving a useful phrase into sibling prompts. The nouns and verbs
survive; the small clause that says *when* does not. A default then reads as an absolute, and an
instruction that is right for one turn fights a more general rule on every other turn.

## Why nothing went red

The new typed test asserted only that *Do not assume they have read it* was present. It never
asserted the boundary for a reader who says they have. The Live tests asserted that
`SPOKEN_GUIDE` reached both voice stacks, but nothing about its semantics. The investigation
explicitly did not measure spoken Guide, and its one not-read case exercised only the default.

## What would have caught it, ranked by ease against value

1. **Assert the condition and its forbidden absolute together** — done in
   `tests/guide-kind.test.ts` and `tests/live-guide.test.ts`; both assertions were red on
   `385f08e55` before the fix.
2. **Compare every sibling prompt against the plan's condition, not only its action** — cheap review
   discipline. A brief should quote *when X, do Y*, not merely ask whether Y appears everywhere.
3. **Run a paid spoken-guide eval for every wording change** — rejected as the default. It is slower
   and dearer than the direct contradiction check, though worthwhile when spoken behaviour itself
   changes substantially.

## The long-term fix

The shipped fix restores the missing clauses and adds boundary assertions. The stronger long-term
design is to share semantic prompt fragments where typed and spoken rules truly have the same
condition, while keeping their presentation separate. That should be done only when another drift
shows the abstraction pays for itself; one premature prompt builder would make these rules harder,
not easier, to read.

## The thing I would tell myself

When a requirement says *do not assume*, I must test both the unknown case and the explicit
counterexample. When I copy a rule into a sibling prompt, the condition is part of the rule.

