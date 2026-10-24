# An asynchronous intent without its target adopts the next render's target

Up: [postmortems.md](../project/postmortems.md). Review of
[261024n](../plans/261024n-admin-commands-in-the-command-bar-and-an-author-gift-without-leaving-the-article.md)
found that an administrator's author-gift dialog could move from one article to another during
client-side navigation. **Nothing reached a reader:** this was uncommitted work after `13fd49387`,
and the reproduction used mocked requests.

## What happened

`useAuthorGiftDialog` remembered that the module had loaded, a dialog was wanted after the command
bar closed, and the dialog was open. It did not remember which article the press was for. Rendering
supplied the current prop:

```tsx
<Dialog key={slug} slug={slug} open={open} onClose={close} />
```

When React reused `Dock` and `CommandBar` for another article, `open` survived while `slug` changed.
The key unmounted the old child and immediately mounted a fresh, open dialog for the new slug, whose
hook made another admin read. The first lazy import had the same race: if the route changed while it
loaded, the completed press used whichever slug the latest render supplied.

The red-first test opened the dialog on `a-piece`, rerendered the same Dock position for
`another-piece`, and found an open dialog plus another read. It expected no dialog and only the
original read. The server could not detect the mistake: both slugs were legitimately the
administrator's. Authorization proves permission, not which article the earlier press meant.

## The class: target identity omitted from surviving asynchronous intent

A boolean such as `wanted` or `open` says that something should happen, not what it should happen
to. If the component outlives the entity named by its props, the next render supplies a different
target to the old intent. `key={slug}` isolated only the child's state; the parent's open intent
survived and opened the replacement child.

The tree has correct siblings: article hooks use `current()` checks or slug-keyed state to discard
late replies, and `find-more-handoff.ts` stores the slug in the press. This is also the UI sibling of
[Incomplete identity turns a targeted lookup into an ambient one](261011e-incomplete-identity-turns-a-targeted-lookup-into-an-ambient-one.md).

## Which commit introduced it

No commit did. `13fd49387` contains neither the hook nor the dialog; the faulty lifecycle was in the
uncommitted working tree after it.

## Why nothing went red

The original test pressed and waited on one article. It proved the happy path, lazy load and modal
handoff, but never crossed the target lifetime boundary. The plan correctly asked to keep the
dialog mounted after first use but did not separate the downloaded component's lifetime from one
article's open intent and form state. Types and the server gate saw individually valid values and
could not express the missing temporal relationship.

## What would have caught it, ranked by ease against value

1. **Cross a real target boundary in tests for a stateful article action.** Done: the regression
   rerenders the real Dock at the same React position and asserts both the dialog and request count.
2. **Carry target identity inside every intent that survives an await or render.** Done: the slug is
   captured at the press and consumed only while it still matches the page.
3. **Change slug before a controllable lazy import settles.** Deferred unless a loader seam can be
   added without production indirection. The target-bearing state covers it, while the current test
   directly proves the already-open ordering.
4. **Key the whole Dock or CommandBar by slug.** Rejected: it resets unrelated state and makes a
   distant parent responsible for a local write's identity.
5. **Cancel the dynamic import.** Rejected: module imports are not usefully cancellable, and that
   would not protect already-loaded open state. Validate the target when work resumes.

## The fix that is right for the long term

The lifecycle records `forSlug`, captured before the import. It renders only while `forSlug` equals
the current slug and clears wanted, open and target state after navigation. The successfully loaded
component is cached separately: code may survive navigation, but the person's form state and intent
may not. This review fix is the long-term fix; there was no shipped patch.

## The thing I would tell myself

“Keep the dialog mounted” contained two lifetimes. Downloaded code may live as long as the command
bar; an open request belongs to the article whose row was pressed. If state can survive a prop
changing, the identity behind that prop belongs inside the state.
