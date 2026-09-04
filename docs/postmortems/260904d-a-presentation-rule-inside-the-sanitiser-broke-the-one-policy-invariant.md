# A presentation rule inside the sanitiser broke the one-policy invariant

Two tests went red on `dev` on 2026-09-04 and stayed red for a day:

```
tests/sanitize-client.test.ts > the two bindings are one policy > agree on: prose
tests/sanitize-client.test.ts > the browser pass is a no-op on already-sanitised HTML
```

Nothing a reader could see was wrong. The feature that broke them
([links should open in a new tab](../user-feedback/260904_1240-links-should-open-in-a-new-tab.md))
worked, and still works. What broke was the property that makes the sanitiser *checkable*.

## The line

`0f754742` added this to [`src/web/sanitize.ts`](../../src/web/sanitize.ts), the browser binding:

```js
purify.addHook("afterSanitizeAttributes", (node) => {
  const el = node as Element;
  if (el.tagName !== "A") return;
  if (!leavesTheApp(el.getAttribute("href"))) return;
  el.setAttribute("target", "_blank");
  el.setAttribute("rel", "noopener noreferrer");
});
```

The article's HTML is sanitised twice, in two different HTML parsers — jsdom on the server at stage
3, Chrome in the browser at ingress — because a disagreement between two parsers about the same
bytes is the entire mechanism of mutation XSS ([security.md](../project/security.md)). The two
bindings share one config, and `tests/sanitize-client.test.ts` pins the two things that make that
setup worth having:

1. `sanitizeBlockHtml(x) === sanitizeOnServer(x)` over a corpus of attack and prose shapes;
2. `sanitizeBlockHtml(sanitizeOnServer(x)) === sanitizeOnServer(x)` — the browser pass is a no-op on
   the server's output, which is the common case by far.

A hook that *adds* two attributes the server does not add breaks both, by construction. The comment
at the top of that test file had already written down why that matters: two passes that disagree
"look like defence in depth and are really two half-policies".

## The class: a presentation rule placed inside a security seam

Not "a hook in the wrong file". The general shape is **a decision about how something is *presented*
put inside the component that decides what is *allowed***, because that component happened to be
holding a parsed DOM at the convenient moment. The seam then stops being a function anybody can
check against a reference implementation, and every later change to presentation costs an argument
about the security test.

It is attractive every time, for the same three reasons it was attractive here: the sanitiser
already parses the HTML, so the walk is free; it runs at exactly the right moment; and the attribute
being added is *security-positive* (`noopener noreferrer`), which makes "this is not a relaxation"
sound like a complete argument. It is not a complete argument — the invariant the test pins is
**equality**, not **safety**, and equality is what makes the safety checkable at all.

The near-miss recorded with this fix: the obvious remedy was to loosen the test to normalise
`target`/`rel` before comparing. That would have been true, defensible, and one notch of the ratchet
in the wrong direction.

## The fix that is right for the long term

The rule moved to [`src/web/external-links.ts`](../../src/web/external-links.ts) and is applied by
`sanitizeArticle` **immediately after** `sanitizeBlockHtml`, per block, at ingress. Same behaviour,
same timing, same string; the sanitiser is one policy again and both assertions are true as
originally written.

**Not at the render sink**, which was the other candidate and is the one worth writing down as
rejected. `block.html` reaches the DOM at three places, not one — `TableView.tsx`'s prose column,
`notes-view.ts` § `notePreviewHtml` (a floating footnote-preview card, outside `.prose`, whose links
are live and mostly external), and `Lightbox.tsx`. Confirmed in Chrome, 2026-09-04: the note preview
card is `insideProse: false` and carries a live external link. A sink-level rule would have had to
be written three times, and the one everybody would forget is the card. `useSketch.ts` had already
written down the same principle for its own artefact — *"at ingress, exactly as `sanitizeArticle`
does in App.tsx: not at the sink, where four different components would each have to remember."*

The ordering carries the safety argument now, and is documented as such: the sanitiser strips an
author's own `target`, so a pass that runs after it is the only thing that can write one. Swap the
two and a publisher can aim a link at `_top` — and can opt into the touch card's reveal-then-commit
rule, which is keyed on `target="_blank"`.

## What would have caught the class

Ranked by value, and the first two are done:

- **The test that did catch it** — `tests/sanitize-client.test.ts` reported this correctly and
  immediately. The failure was not detection; it was that a red `dev` was left standing for a day.
  Nothing to add here, and it is worth saying so: the invariant paid for itself the first time it was
  challenged.
- **A comment on the seam that names the trap** (done). `sanitizeBlockHtml` now says in its
  docstring that it is the policy and nothing else, and names this incident — so the next agent
  holding a convenient parsed DOM reads the reason before writing the hook.
- **A corpus round-trip test** (done). `tests/prose-links-new-tab.test.ts` now runs the new pass over
  three committed fixture articles and asserts that nothing but `target`/`rel` changes and that it is
  idempotent, with a `toBeGreaterThan(0)` guard so a corpus with no outbound links cannot pass by
  testing nothing. Measured over the whole local store the same day: 5,301 blocks, 1,104 rewritten, 0
  structural differences, 0 non-idempotent.
- **A cross-family review of the moved code, not just of the move** (done, GPT Sol, 2026-09-04). It
  agreed with the placement and then found the thing the fix had inherited from the hook it replaced:
  the rule covered `<a href>` and nothing else, so an `<area>` and an SVG `<a xlink:href>` — both of
  which the policy allows through — still took the app away in place. Zero of either exist in 5,301
  stored blocks, which is exactly why no test and no browser pass would ever have reported it. It
  also caught an ingress that was not idempotent on its second run (the author's own `rel` left ours
  in a different attribute order) and a comment that claimed a false equivalence about the parse
  context. All three are fixed and pinned.
- **Not built: a lint rule forbidding `addHook` outside `src/sanitize-policy.ts`.** It would catch
  exactly this spelling and nothing else — the same rule written as a post-`sanitize` string
  rewrite inside `sanitizeBlockHtml` would sail past it — so it buys a narrow guard over a seam that
  already has a sharp test. Named here so the next person decides it rather than rediscovers it.

## See also

- [links.md § Every link that leaves the app opens a new tab](../project/links.md#every-link-that-leaves-the-app-opens-a-new-tab)
- [security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
- [260904_1240-links-should-open-in-a-new-tab.md](../user-feedback/260904_1240-links-should-open-in-a-new-tab.md)
  — the report the rule came from, and what shipped
