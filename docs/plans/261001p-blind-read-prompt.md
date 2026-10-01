# Blind fidelity read: 54 plain-words summary levels against their articles

You are reading short plain-words summaries of three articles and finding **every factual fault**:
a sentence that says something the article does not say, says the opposite, gets a direction or a
number wrong, calls one thing by the article's name for a different thing, or states a hedged claim
as settled. Plain wording is the point of these summaries, so simplification is not a fault in
itself; a simplification that changes what is true is.

Files (read-only; do not edit anything):

- `data/probes/261001p-blind/articles.md` — every body passage of the three articles, each prefixed
  with its id, like `[spya-k3m9qt]`.
- `data/probes/261001p-blind/levels.md` — 54 summary levels, keyed `L01`…`L54`. Each paragraph names
  the passages it cites. **Judge each paragraph against the whole article, not only its cited
  passages**: a claim true elsewhere in the article is not a fault.

The levels come from more than one writer, shuffled. Do not try to work out which wrote which, and
do not look for any other file that might say.

For the PID article (`entropy-24-00930-spya-pywwkq`) be careful with the three connection types it
defines side by side (feedforward, feedback, recurrent) and their opposite effects on synergy.

## What to write

For every level, one line, even when it is clean:

```
L01 | clean
L02 | fault | para 2 | major | "quoted words" — what the article actually says, with the passage id
L03 | fault | para 1 | minor | ...
```

Several faults in one level: one line each. **major** = a reader would come away believing something
false about a finding or the argument. **minor** = an imprecision a careful reader would object to
but which does not change the takeaway. If unsure whether something is a fault at all, write it as
`doubt` with the same fields, rather than forcing it either way.

Finish with the count of levels with at least one major fault, at least one minor, and clean.
