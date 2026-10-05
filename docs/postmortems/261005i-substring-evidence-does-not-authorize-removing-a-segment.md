# Substring evidence does not authorize removing a segment

Up: [postmortems.md](../project/postmortems.md) · Change:
[261005j](../plans/261005j-a-small-model-tidies-an-imported-title.md)

Caught in review of built, uncommitted code. Nothing reached a reader. The title checker
approved `A Title — The Nature of Time` becoming `A Title` when the declared site was
`Nature`. It also approved cutting `Nature -` from `Nature -based Research` and all of
`[The Order of Time]` from `[The Order of Time] A Review`.

The introducing change is uncommitted, so there is no introducing commit to name.
The root-cause audit ran in a separate review subagent.

## The class: substring evidence treated as authority

The site's name was checked with `includes`, but that evidence authorized deletion of the
whole segment beside a separator. The segment could contain extra title words, digits or
symbols. A common word or a one-letter site made this especially easy. The prefix separator
also required space before a hyphen but not after it; the bracket matcher treated every
bracketed phrase as an identifier. Each check established less than its caller relied on.

The existing negative tests used a completely different site name, so they exercised a
missing match rather than an overbroad match. The prompt's prohibition on dropping words
could not repair the acceptance predicate.

## The fix and the countermeasures, ranked

1. **Compare the entire candidate removal against its evidence.** Strip only the outer
   separator and whitespace, then require equality with the declared site. Require space on
   both sides of an ASCII hyphen and after the word processor's stamp; accept bracketed
   identifiers as single tokens containing a
   digit. Implemented, with negative common-word, one-letter, extra-punctuation and bracketed
   prose cases. These reproduce the original failures.
2. **Establish boundaries before transforming text.** The old guard searched lowercase text
   and sliced the source at those offsets. It disabled all cuts when lower-casing expanded
   `İ`, refusing a good answer. The replacement walks original code-point boundaries and
   compares retained spans afterwards, with Turkish, Greek sigma, NFC and astral controls.
3. **Independent context-aware deletion classifier — rejected.** More model calls and more
   judgments would not strengthen an equality contract that code can check directly.

The long-term fix is the implemented one: authorize exactly the characters whose removal
has been justified, then compare what remains. Broadly banning short site names would hide
this instance while leaving the class intact for longer common names.
