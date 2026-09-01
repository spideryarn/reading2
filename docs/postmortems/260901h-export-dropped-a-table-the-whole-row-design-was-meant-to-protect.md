# The export dropped the columns its design existed to protect

The reader's export ([export.md](../project/export.md)) shipped for a few hours without `byline`,
`siteName`, `excerpt`, `publishedAt`, `note`, `wordCount`, `rootGist` or twenty-three other columns
of `article_revisions` in any machine-readable file. They survived only incidentally, inside article
prose and inside `index.html`'s escaped header.

Caught by the second GPT Sol review and, independently, by an adversarial subagent review, both run
before anybody used the feature. Fixed in `434304d`. Nothing reached a reader.

## What makes it worth writing down

Not the missing columns. **The bundle's entire reason for existing was to make this impossible.**

The CLI rollback ([`src/store/export.ts`](../../src/store/export.ts)) writes a legacy format pinned
byte-for-byte by `tests/store-roundtrip.test.ts`, so it names its fields by hand — and that is how
`tools`, `stance`, `criterionId` and `valence` each went missing from it, one at a time. The whole
argument for a second projection was:

> the bundle serialises **whole rows** rather than naming fields … so `passages`, `interrupted` and a
> real `candidates` kind survive **by construction, not by being remembered**.

That was true of nine tables. It was false of the tenth, which is the largest and the one carrying
everything a reader would call "the article's details". `rowJson` was simply never called on it:
`contentFiles()` named three columns, `augmentationFiles()` named ten, `manifestJson()` named one.

So the design did not fail. **The design was not applied, and its own documentation asserted that it
had been** — in the file's docstring, in `export.md`, and in the plan.

## Root cause

Three things had to line up, and they did.

**1. The exception was invisible because it looked like the rule.** `article_revisions` genuinely
does need special handling: `stampedHtml` and the artefact columns become their own files, because a
50 KB HTML string does not belong inline in a JSON row. Having written that special handling,
nobody asked what happened to the rest of the row. The columns that needed splitting out were
handled; the columns that needed nothing were the ones that got nothing.

**2. The audit only ever looked one way.** Every check in this work — the parity diff, the fidelity
tests, the sentinel controls — was built to answer *"did the bundle inherit one of the rollback's
losses?"*. That framing cannot see a loss the bundle has and the rollback does not. And that is
exactly what happened: `meta.json` writes `byline`, `siteName`, `excerpt`, `publishedAt` and `note`.
**On this table the deliberately-lossy exporter was the more faithful one.**

**3. The guard was column-blind, and this was known.** GPT Sol's *plan-stage* review said so in
writing — *"It cannot detect a newly added column being omitted"* — and it is quoted in the plan at
the time. Stage B fixed the other half of that finding (a projection that receives a row and
discards it) and the stage was marked done. One column of forty-six, `title` into `manifest.json`,
satisfied the guard for the entire table.

The deepest cause is (3): **a review finding was half-implemented and the stage was closed.** The
other two are the kind of thing a guard exists to catch.

## Which commit introduced it

`bb0aff5`, the commit that created `src/store/export-bundle.ts` — the same commit whose message
claims fidelity "by construction, not by memory". It was never right; it was only ever right about
nine tables.

## The fix, and the fix for the class

**The bug:** `content/revision.json`, built with `rowJson` like every other table, dropping only `id`
and the sixteen payload columns already written as their own files.

**The class:** a **column-level** guard in `tests/store-export-covers-tables.test.ts`. For every
table the record says the bundle exports, it unions the keys actually emitted and compares them
against `Object.keys(getTableColumns(table))`; every difference must appear in a declared list with
a written reason of more than thirty characters. It checks **both directions**, so a column declared
"left out" that has quietly started shipping is also red.

It was watched failing before the fix, naming all thirty missing columns while the other ten tables
passed — a specific failure, not a new test failing everything. Then watched again on `byline`
alone, because thirty columns at once does not prove a check catches one.

The rollback is deliberately outside that check, and the test says why: its projection renames as it
goes (`extract_method` → `method`), so there is no key set to compare, and `store-roundtrip` already
pins its bytes.

## What would have caught it earlier

- **Writing the column-level guard when the review asked for it**, instead of the half that was
  easier to see how to do. The finding was in the plan doc, in Sol's words, unaddressed, while the
  stage above it carried a ✅.
- **Auditing in both directions.** "Does the new thing lose anything the old thing keeps?" is a
  different question from "does the new thing inherit the old thing's losses?", and only the second
  was ever asked. `diff <(rollback fields) <(bundle fields)` would have taken a minute.
- **Opening the artefact.** Real bundles *were* built and inspected during Stage C — and the entry
  list looked complete, because the missing data had no file of its own to be missing. Listing
  filenames proves nothing about what is inside them. Grepping the zip for a known value
  (`"8283"`, the word count) is what actually found it.

## The related claim that was also too strong

While fixing this, a second over-claim came out. The rollback's output was proven unchanged
byte-for-byte, and reported as "the rollback did not move". True for a fixed database — but Stage A
had turned an N+1 per-thread read into one eager parallel read, changing its **concurrency**
behaviour, which no static output diff can see. Sol's second review caught it, and the walk is now
one repeatable-read snapshot ([article-rows.ts](../../src/store/article-rows.ts)); the plan records
the ~12 ms it costs.

The lesson is the same shape as the main one: **evidence is only evidence for the claim it actually
tests**, and a diff of outputs says nothing about the order the reads happened in.
