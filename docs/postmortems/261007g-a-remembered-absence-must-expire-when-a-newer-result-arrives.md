# A remembered absence must expire when a newer result arrives

The write-capable review of [the Generate-button change](../plans/261007g-keep-the-generate-button-and-drop-the-unused-queue-column.md)
found a stale fallback in an unkeyed Glossary hook. The test reproduced wrong state; no production
incident or duplicate charge was established. The actual reading view keys `OwnedArticle` by slug
([ArticlePage.tsx](../../src/web/article/ArticlePage.tsx)), so the demonstrated route is a latent
hook-contract defect, rated P2, rather than an established reader-facing P1.

## A fallback remembered forever is historical evidence presented as current evidence

Commit `9676afee2ba2a33227d39814394f6ede064bc7e0` introduced `saidNoneFor` into twelve
artefact hooks. Its purpose was to retain the empty-state Generate button after a failed
*Try again*. Each valid empty reply recorded the slug; a failed read returning from `loading`
consulted that ref. No successful result cleared it.

The ref therefore answered “has this article ever been empty?” where the catch needed “was the
latest accepted answer empty?”. Matching the slug prevented one article's absence from answering
another's question, but did not prevent a superseded answer from answering its own question.

The review added the test **“Glossary's cleared list on returning to a slug cannot revive a
superseded none answer”** in [read-error-matrix.test.tsx](../../tests/read-error-matrix.test.tsx).
It reads no glossary for A, then a glossary for A, switches the same mounted hook to B with a
transport failure, then returns to A with a transport failure and retries. Glossary's render-time
slug reset clears the displayed list and enters `loading`; the old ref still names A. The red
assertion was **expected `error`, received `none`**. At that point the latest successful answer
for A was a list, and the hook no longer held it.

## Why the existing checks agreed

The original coverage checked an initial absence followed by failed reads, an unanswered new slug,
and retention of an existing list after a failed refresh. The last case stayed `ready`, bypassing
the ref entirely. None combined a superseding result with loss of the displayed state followed by
failure. The same write-only ref appeared in all twelve hooks, although Glossary's explicit slug
reset supplied the demonstrated route into its stale fallback.

## What catches this class, ranked by ease against value

1. **Exercise replacement and loss of fallback state together.** The added A → B → A test went
   red on the original code. Ordinary absence → failure and result → failure tests cannot expose
   a historical ref that is consulted only after the result state has been cleared.
2. **Expire remembered absence on every accepted nonempty answer.** The review fix clears
   `saidNoneFor` before `ready` in all twelve hooks, preserving its purpose for a still-empty
   article while making the remembered answer follow later evidence.
3. **A generic artefact-reader hook — rejected for this fix.** The parsers, checked-empty picture
   replies and state shapes differ; adding an abstraction solely for this small fallback would
   add an API and migration without deleting the substantive per-mode branches. A shared helper
   becomes worthwhile if more common read-state policy accumulates, rather than because this
   review counted twelve sites.

The long-term fix here is the same narrow invalidation: retained evidence must follow the newest
accepted answer. Slug-keyed component lifetime remains useful protection, but it should not be
the only thing preventing a ref from contradicting later evidence. Other unkeyed-hook slug-state
behaviour was outside the reviewed changes and was not altered.

Up: [Postmortems](../project/postmortems.md).
