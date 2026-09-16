# A memo that read a map it did not depend on

**Cost: nothing, because it was caught before it shipped** — by a browser agent on a real article,
and by `npm run lint`, which had been naming it in plain words the whole time and which nobody read.
That second half is the reason this file exists.

## What broke

Citations marked in the prose (SPIDERYARN-READING2-3M,
[260916b](../plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md)) did not
appear — on one article. On the next article they did. Nothing in the data told the two apart: the
panel listed all 42 works from the same response the prose was drawing nothing from, which is the one
disagreement [`useCitations.ts`](../../src/web/useCitations.ts) states outright cannot happen, since
*"the panel and the prose read the same `CitationsRead`"*.

Every test passed. Sixty-odd of them, including nine written specifically for the marks, one of which
renders the real annotator over real blocks and checks the exact `<mark>` element.

## The real root cause

`proseHtml` in [`TableView.tsx`](../../src/web/TableView.tsx) is a `useMemo` that builds every
block's html. The change added a third mark source to it:

```ts
const cited = citeMarksByBlock.get(block.id) ?? NO_MARKS;
…
}, [blocks, marksByBlock, termMarksByBlock, hitMarks, openTerm]);   // ← no citeMarksByBlock
```

The map was read inside the memo and left out of its dependency array. The citations are a separate
`GET`, so the list always lands *after* the first render — and the memo, having no reason to
recompute, kept the html it had already built.

**Why it looked intermittent, which is the interesting part.** The memo has five other dependencies,
and any of them moving afterwards recomputes everything. A comment resolving, a search running, a
glossary term being pressed, a re-extraction — each one silently repaired the page. So whether the
feature worked came down to whether anything else happened to change after the citations arrived,
which varies by article, by what else has been generated for it, and by what the reader does next.

Keep asking why and it stops being about this line. The memo is a cache whose key is written by hand
in a second place, several dozen lines away from the reads it is supposed to cover. Adding a source
means editing two places, and only one of them is where you are thinking. The type system cannot
help: a dependency array is a `unknown[]`, and every wrong version of it type-checks.

## The class

**A hand-maintained cache key that has to be edited in step with the reads it covers** — and whose
failure is *staleness*, not a crash, so it presents as "the feature works here and not there" rather
than as an error.

Two properties make this class worth a name. Its symptom is a **disagreement between two surfaces
reading one state**, which reads as impossible and therefore sends you looking in the wrong place;
and it is **masked by unrelated activity**, so the more a page does, the less likely you are to see
it. A quiet article shows the bug and a busy one hides it.

It is a cousin of, and not the same as,
[silent-success.md](../reusable/silent-success.md): nothing here reported success while doing
nothing — the memo honestly did nothing and said nothing.

## Which commit introduced it

`5c8e4213` and `5ad4585b`, both mine, both on 2026-09-16 — the `cites` prop was threaded through
`TableView` in the second. The commit message describes the seam at length and says nothing about the
dependency array, which is the shape of the mistake: the author was thinking about the data flowing
in, and the memo key is a statement about *invalidation*, which is a different subject that lives in
the same function.

## The fix

One line — `citeMarksByBlock` added to the array — with a comment saying what it cost, plus a test in
[`tests/prose-not-rebuilt.test.tsx`](../../tests/prose-not-rebuilt.test.tsx) that renders `TableView`
with no citations, asserts nothing is marked, re-renders with a list, and asserts marks appear. It
was watched red before the fix.

**That is also the right long-term fix here**, and the tempting larger one should be resisted. The
obvious "real" fix is to delete the hand-written key — derive the memo's inputs from one object, or
drop the memo and lean on the `proseCache` beneath it. But that cache is load-bearing for a measured
reason: without it a scroll rebuilt 18,734 prose subtrees and put layout recalculation above script
in a production profile. Restructuring it to fix a dependency array would trade a known bug for an
unknown regression in the thing the file exists for.

## What would have caught the class

Ranked by value against effort.

1. **`npm run lint` on the files you touched — which already caught it, and was not read.** Biome's
   `useExhaustiveDependencies` named this exact memo and this exact missing name. It is not a gate
   because the repository baseline is not clean ([AGENTS.md](../../AGENTS.md) calls it advice), and
   the practical consequence is that its true findings sit in a pile of tolerated ones. **The cheap,
   real improvement is not to fix the baseline but to run it scoped** — `npx biome lint <the files
   you changed>` — where the signal-to-noise is completely different: eight files here produced four
   errors, three of them the known complexity/`innerHTML` baseline and one of them this bug. That is
   a habit, not a mechanism, and it is written into AGENTS.md's *Before you call it finished* for
   that reason.
2. **A test that renders in two steps rather than one.** Every test written for this feature handed
   the component its blocks and its citations together, in the first render — which is the one
   sequence the app never performs. The general lesson: **where a feature's data arrives on a second
   request, a test that supplies it on the first render is testing a state the reader never sees.**
   The new test is one line of harness different from the ones that passed, and that line is the
   whole of it.
3. **A browser on a real article.** It is what actually found it, and it is why the plan listed *how
   it looks* as unverified rather than quietly skipping it. Expensive, slow, and not something to
   rely on for a class this mechanical — but it is the only one of the three that had no chance of
   sharing an assumption with the code.
4. **Rejected: making lint a gate.** It would have caught this, and it would also have required
   clearing or suppressing a baseline of pre-existing findings across the tree, which is a large
   change to make on the strength of one bug and would put the cost on everybody else's next commit.
   Worth revisiting on its own merits, not as this bug's remedy.

---

Up: [postmortems.md](../project/postmortems.md)
