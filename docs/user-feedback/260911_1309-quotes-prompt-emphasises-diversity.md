# Quotes: the prompt asks for lines that say different things

**[SPIDERYARN-READING2-2X](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2X)** · reported
2026-09-11 13:09 UTC · report `spya-q4mud4` · sent from
`/read/temporal-context-reinstatement-spya-dhqkf9`, build `607b57a0`

**Ending: shipped.** On `dev`, not deployed. The Sentry issue should be marked *resolved*. This
session has no Sentry sign-in, so the next feedback sweep sets that from this line.

## What Greg said

> Perhaps make a minimal tweak to the Quotes prompt to slightly emphasise diversity (i.e. to avoid
> ending up with loads of quotes that say basically the same thing)

## What we did

A short paragraph and one clause in the prompt, `quotes/5` —
[260911e](../plans/260911e-quotes-prompt-asks-for-diverse-lines.md). The first pass is now told that
each quote should say something the others do not, and to keep the best statement of a point the
piece makes several times. Find more is now told not to return a point a line you already have
makes, in other words, as well as not the same sentence. That covers both places repeats come from:
the larger importance-first first pass, and the Find-more tail.

New runs only. Every existing list will say it was chosen by an earlier prompt version, as they all
did after `quotes/4`. Whether lists repeat less has not been measured.
