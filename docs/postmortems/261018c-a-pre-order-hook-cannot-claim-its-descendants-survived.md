# A pre-order hook cannot claim its descendants survived

Code review of commit `d7724a7d9` found that an article link could lose its only accessible name
when its `title` was moved to `data-author-title`. Nothing reached a reader: the commit had not been
pushed. The same review found that the fallback missed SVG links because their `tagName` is
lowercase.

## What happened

`moveAuthorTitle` ran in DOMPurify's `afterSanitizeAttributes` hook and asked whether a titled link
already had a name by reading its `textContent` and descendants with `alt`. DOMPurify walks in
pre-order, so the parent hook ran before its children crossed the sanitisation boundary. A later
removed `<script>` could contribute text, and a later forbidden `<input alt="…">` could contribute
an `alt`; either made the link look named inside the hook and then vanished:

```text
<a href="/" title="Home"><script>not a name</script></a>
→ <a href="/" data-author-title="Home"></a>
```

The sibling namespace mistake came from asking `tagName === "A"`: true in HTML and false for SVG,
where `localName === "a"` is the parser-independent spelling.

## A boundary-derived fact was decided before the boundary had finished

The defect was not that one removable tag was forgotten. The code tried to derive a fact about the
sanitised subtree from a subtree that was not sanitised yet. Copying DOMPurify's current removal
rules into `hasAName` would patch today's examples while preserving the class: the copy would drift
at the next DOMPurify or policy change.

Namespace casing is the same boundary mistake in smaller form. A parser-facing API was treated as
though every element belonged to HTML even though this policy deliberately preserves SVG and
MathML.

## Why nothing went red

The accessibility tests used either plain text or an allowed `<img alt="">`, so the descendants
looked the same before and after sanitising. The namespace parity corpus proved that the server and
client produced equal, idempotent SVG bytes; both could be equally wrong, and were. The plan review
asked about hook timing and namespaces but concluded they were sound without an adversarial output
assertion. This is the same silent-success shape in three forms: each check proved agreement while
sharing the implementation's happy-path assumption.

## What would have caught it, ranked by ease against value

1. **One disappearing-child test and one SVG output assertion** — both were added red-first. They
   prove the accessible name in the final bytes, not merely that two bindings agree.
2. **When a hook reads descendants, identify whether its traversal is pre- or post-order** — if a
   later step can mutate those descendants, move the derived decision after that step.
3. **Keep parity and idempotence tests, but do not spend them as semantic evidence** — equality says
   neither side drifted; it does not say either answer is right.
4. **Mirror DOMPurify's allowlist inside the hook** — rejected. It is cheaper today and silently
   wrong after the first library or policy change.
5. **Put `aria-label` on every titled link** — rejected. It would replace useful visible link names
   with citation-style hover text across the corpus.

## The long-term fix

The title-to-data move stays in the sanitiser hook, where the attribute is cleaned and renamed once.
The accessible-name decision now runs in the shared `sanitizeArticleHtml` finaliser over the fully
sanitised DOM fragment, before that fragment is serialised. Both bindings call the same function,
and elements are identified by `localName`. The fast string path remains for fragments with no
author-title attribute, so the fix does not tax every ordinary block.

The narrower patch would have special-cased `<script>`, `<input>` and SVG in `hasAName`. That was not
shipped because it leaves the underlying ordering error in place.

## The thing I would tell myself

I cannot infer a post-sanitisation property from a pre-order callback, however complete the helper
looks. I need to place the decision after the mutation boundary and make the test assert the final
observable result.
