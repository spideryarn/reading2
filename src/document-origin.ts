/**
 * **Where a document came from: an address, or a reader's disk.**
 *
 * Two words, and a whole module for them, because four files need this fact and
 * one of them cannot import the others.
 *
 * **The one that cannot.** [`src/messages.ts`](messages.ts) has to name the two
 * origins to choose between two refusal sentences — an upload has no address to
 * be sent back to, and from 2026-09-07 to 2026-09-08 it was told to go and look
 * at one anyway. That module is inside the browser client's type closure, and
 * [`src/source.ts`](source.ts) reaches [`src/fetch.ts`](fetch.ts) and its
 * untyped packages, so even a **type-only** import from there fails the client
 * project with TS7016: `tsc` walks a type-only import for its types like any
 * other. `src/web/tsconfig.json` predicts this in its own comment and names the
 * remedy — *"the fix, then and next time, is to move the shared piece into a
 * module that imports nothing"*. This is that module, and **it must go on
 * importing nothing**, or the problem comes back by the same route.
 *
 * **It replaced three hand-written copies of `"url" | "upload"`** — `SourceOrigin`'s
 * discriminant, `RawManifest.origin`, and a fourth this stage nearly added in
 * `messages.ts` with a two-way assignability assertion holding it to the others.
 * The assertion worked and was checked red both ways; it was still one union
 * short, because `RawManifest.origin` was never in it. ⟨GPT Sol, F25,
 * 2026-09-08⟩ A leaf type cannot be one union short.
 *
 * **`SourceOrigin` still spells the literals**, because they are the
 * discriminant of a union and each arm carries different fields —
 * `kind: "url"` cannot be written `kind: DocumentOrigin` without collapsing the
 * two arms into one. The agreement is asserted there instead, in one line, and
 * that is the only spelling left that this file does not directly own.
 */
export type DocumentOrigin = "url" | "upload";
