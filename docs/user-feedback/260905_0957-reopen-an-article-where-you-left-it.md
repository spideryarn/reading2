# Reopen an article where you left it

**[SPIDERYARN-READING2-1W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1W)** · reported
2026-09-05 09:57 UTC · kind: suggestion · *shipped*

## What the reader said

> If I close and then reopen an article, it should ideally return me to the position/state/view that
> I was in. It's fine for this to be local to the device/browser, or whatever is simplest

## What we did

Took *"whatever is simplest"* at its word, which the app had already earned: everything about how
you are looking at an article is one string, the query string
([url-state.md](../project/url-state.md)). So the whole feature is **copy that string into
`localStorage` under the slug as the reader moves, and put it back when they open the article at an
address that says nothing** — [`src/web/last-view.ts`](../../src/web/last-view.ts), about a hundred
lines of which two are impure. Per-device, no server, no schema.

A shared link always wins over the memory, or sending somebody a link would stop working. `?note=`,
`?panel=`, `?thread=` and search mode's matcher are not put back — a dialog, a drawer, a
conversation and a search are things you did, not places you were. Nor are three values of `?mode=`
(`chat`, `diagram`, `remember`), because each starts something merely by being arrived in: nothing
opens a conversation or spends a model call on your behalf. The pictures and sub-modes are still
remembered, so pressing the button gets you back to the one you had chosen.

Deferred and named in the plan: anything cross-device, remembering the matcher, remembering which of
the article's three pages you were on.

[The plan](../plans/260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md)
§ Stage 2;
[url-state.md § Reopening an article where you left it](../project/url-state.md#reopening-an-article-where-you-left-it)
is the doc.
