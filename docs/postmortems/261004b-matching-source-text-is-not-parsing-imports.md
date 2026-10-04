# Matching source text is not parsing imports

Review of sweep stage A found that a valid single-quoted shared-prompt import was
missing from the eval source fingerprint. Nothing reached a reader; the failure
was in the provenance a future paid run would record.

The class is **a lexical approximation treated as a dependency parser**. The
regex added in `32ed6903c` matched only `from "./name.js"`, including those bytes
inside comments and prompt prose. Its tests used the same double-quote spelling
and contained no misleading text, so both false negatives and false positives
were invisible. The same class had already led `tests/fleet-imports.test.ts` and
`tests/no-undeclared-spend.test.ts` to use a parser.

Two new cases in [eval-source-fingerprint.test.ts](../../tests/eval-source-fingerprint.test.ts)
were red before the fix: editing `paperwork.ts` after a single-quoted import kept
the fingerprints equal; import-like comments and prose added two phantom files.
Both pass after [source-fingerprint.ts](../../evals/plain-words/source-fingerprint.ts)
reads static import and re-export nodes with the repo's existing `@babel/parser`.

The durable fix is the shipped fix: use the language parser for the bounded
static-import question. The registry and one-hop limit remain deliberate and are
now explicit in the helper's header.

Countermeasures ranked by ease against value:

1. **Tests with alternative syntax and misleading surrounding text** — done.
   They distinguish a dependency check from a match on its preferred spelling.
2. **Use the already declared parser** — done; no new dependency or graph walker.
3. **Add single quotes to the regex** — rejected as the final fix: it closes one
   example while still treating prose as code.
4. **Hash every transitive source file or every assembled request** — rejected
   here: it changes the intended bounded fingerprint and spans other stages.

Up: [postmortems.md](../project/postmortems.md)
