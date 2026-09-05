/**
 * **The `data-spya-*` namespace, and the scrub that makes it ours.**
 *
 * Readability deletes the markup that says what a piece of the article *is* —
 * `keepClasses: false`, containers unwrapped, whole elements dropped — so the
 * only way for stage 2 to tell stage 3 what the author wrote is to leave a mark
 * on an element that survives. Two features do that today (footnotes,
 * src/notes.ts; callouts, src/callouts.ts) and a third inside stage 3 itself
 * (author anchors, src/blocks.ts).
 *
 * Each of them arrived with its own copy of the same two obligations, and that
 * is what this file replaces:
 *
 *  1. **Scrub every copy the document arrived carrying, before writing ours.**
 *     The attributes are ours and therefore forgeable: a page that gets one past
 *     us has its own prose dressed as something we vouched for. After the scrub,
 *     every stamp in the document was written by us.
 *  2. **Never carry a value the page supplied *into an artefact*.** Every value
 *     written through here is an id we minted, and stage 3 re-validates its
 *     shape before it reaches `blocks.json`, Postgres or the public payload.
 *     The one exception is `wasId`/`wasName`, which exist precisely to carry the
 *     article's own `id` and `<a name>` across the sanitiser — and which are
 *     therefore erased the moment they have been read, before a single block's
 *     html is serialised. Two lifetimes, one namespace; the difference is on the
 *     entries themselves below.
 *
 * The rule, which `tests/reserved.test.ts` enforces by scanning `src/` for the
 * literal prefix:
 *
 * > **Only this file may name a `data-spya-*` attribute.** A recogniser
 * > registers one here and uses `scrubReserved`; it does not write its own.
 *
 * That is what stops a fourth family being written by somebody who has not read
 * any of this — which is the actual failure mode, since each copy of the scrub
 * so far has been correct and the risk was never the code that exists.
 *
 * **This is not GPT Sol's full recommendation**, which is one opaque token in
 * the DOM plus a typed `markup-facts.json` beside `article.html` carrying the
 * meaning and the provenance. That buys debuggability rather than behaviour and
 * costs a new artefact kind across both stores; it is deliberately not built.
 * See docs/plans/260831af-carrying-markup-facts-past-readability.md and its
 * design answer. The consequence for this file is that **the attribute name is
 * still the type**, which is why `CONTEXT_ATTRS` maps one to the other rather
 * than assuming there will only ever be one.
 *
 * No imports, deliberately: stage 2, stage 3 and the tests all reach it, and a
 * module that decides what is trusted should not be able to pull anything in
 * behind it.
 */

/** Every attribute we write into a document we did not write. */
export const RESERVED_ATTRS = {
  /** src/notes.ts — on the one container every note is moved into. */
  notesContainer: "data-spya-notes",
  /** src/notes.ts — on a note's body. The value is its noteId. */
  note: "data-spya-note",
  /** src/notes.ts — on a marker in the prose. The value is the noteId it points at. */
  noteRef: "data-spya-note-ref",
  /** src/notes.ts — on a back-link inside a note. The value is the noteId it belongs to. */
  noteBack: "data-spya-note-back",
  /**
   * src/callouts.ts — on a callout's container and on every block inside it.
   * The value is the context id the blocks share.
   */
  callout: "data-spya-callout",
  /**
   * src/blocks.ts — what the *article* called this element, recorded before the
   * sanitiser can delete the id and take every link to it. Unlike the others
   * this one carries a value the page supplied, lives only inside stage 3, and
   * is removed the moment it has been read: nothing with it on has ever reached
   * blocks.json. See `stampAuthorAnchors`.
   */
  wasId: "data-spya-was-id",
  /** src/blocks.ts — the same, for `<a name>`. See `wasId`. */
  wasName: "data-spya-was-name",
  /**
   * src/extract.ts — **which source element this was**, before Readability.
   *
   * A counter in document order, stamped on every element of the *source*
   * document so that Readability's `serializer` option can hand back a DOM whose
   * nodes still say where they came from. That is what lets an instrument answer
   * "what did extraction drop?" by identity rather than by matching text, which
   * 260827ab measured getting wrong eight different ways.
   *
   * **Instrumentation only, and it must stay that way.** Nothing in the shipping
   * pipeline stamps this: `runExtract` calls `readArticle`, which does not, and
   * `readArticleWithProvenance` is called by evals and tests alone. So unlike
   * the others in this list, no artefact has ever carried it — and like `wasId`
   * it has a lifetime rather than a life, ending when the eval does.
   */
  sourceRef: "data-spya-src",
} as const;

export type ReservedAttr = (typeof RESERVED_ATTRS)[keyof typeof RESERVED_ATTRS];

/** The prefix the test scans for. Written once, here, for the same reason as the rest. */
export const RESERVED_PREFIX = "data-spya-";

/**
 * Which authored grouping an attribute means, for the blocks that carry it.
 *
 * One entry today. It is a map rather than a constant because the type is
 * carried by the attribute *name* until the sidecar exists — see the header —
 * and because the next context type must not have to invent this lookup again.
 */
export const CONTEXT_ATTRS: ReadonlyArray<{ attr: ReservedAttr; type: "callout" }> = [
  { attr: RESERVED_ATTRS.callout, type: "callout" },
];

/**
 * Take a set of our attributes off every element in `root`, **including the
 * ones `querySelectorAll` cannot see**.
 *
 * A `<template>`'s children live in a separate document fragment: a query walks
 * straight past them while `outerHTML` serialises them in full, so a stamp
 * inside a template survived two scrubs and reached `blocks.json` once —
 * inert, but the invariant that said it could not happen was false, which is
 * worse than not having claimed it. GPT Sol found it, 2026-08-26.
 *
 * **The root is cleared too**, which a query alone does not do:
 * `el.querySelectorAll` matches descendants only, so scrubbing an *element*
 * left the element itself carrying whatever it arrived with. Today's callers
 * pass a document — where `<html>` and `<body>` are matched as descendants of
 * the document node, and where it matters most, since those two sit outside the
 * subtree the sanitiser rewrites — so no caller was wrong. A general function
 * that is right only for the way it happens to be called is the kind of thing
 * that is discovered by the fifth caller. GPT Sol, 2026-08-31.
 */
export function scrubReserved(root: ParentNode, attrs: readonly ReservedAttr[]): void {
  const selector = attrs.map((a) => `[${a}]`).join(", ");
  const roots = "removeAttribute" in root ? [root as unknown as Element] : [];
  for (const el of [...roots, ...Array.from(root.querySelectorAll(selector))]) {
    for (const attr of attrs) el.removeAttribute(attr);
  }
  for (const t of Array.from(root.querySelectorAll("template"))) {
    scrubReserved((t as HTMLTemplateElement).content, attrs);
  }
}

/**
 * The shape of a context id, and the only shape stage 3 will carry into a
 * `Block`.
 *
 * The belt to the scrub's braces: whatever else goes wrong upstream, the string
 * that reaches `blocks.json`, Postgres and the public payload is a letter and
 * ten hex digits, not a page's text. `NOTE_ID_PATTERN` in src/notes.ts is the
 * same idea for the same reason.
 *
 * **It is shape, not provenance, and the difference matters.** A page can spell
 * a value that matches this perfectly; what makes a stamp ours is the scrub that
 * removed every copy the document arrived with, and nothing else. This is the
 * belt: it bounds what a hole upstream could put into a database column.
 *
 * The suffix arm allows exactly what `mintContextId` can produce — `-2`
 * upwards, no leading zeros — because a pattern looser than the minter is a
 * pattern that admits strings this codebase cannot explain. It used to allow
 * `-0`, `-007` and any number of digits. GPT Sol, 2026-08-31.
 */
export const CONTEXT_ID_PATTERN = /^c-[0-9a-f]{10}(?:-(?:[2-9]|[1-9][0-9]+))?$/;

/**
 * A context id: stable across re-runs, and derived from what the context
 * contains rather than from where it is.
 *
 * **Stability is for the diff, not for the reader.** Nothing addresses a context
 * — comments, URLs and the tree address block ids, which are the permanent
 * identity (docs/project/block-ids.md) — so a fresh id every run would be
 * *correct*. It would also rewrite every context row on every re-extraction and
 * make a real change impossible to see. Hashing the text is what src/notes.ts
 * does for `noteId`, and copying its choice is cheaper than having two answers.
 *
 * `taken` makes a collision explicit rather than silently merging two contexts
 * that happen to hold the same words — a page with the same aside twice.
 */
export function mintContextId(text: string, taken: Set<string>): string {
  const base = `c-${hash10(text)}`;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/**
 * Ten hex digits of FNV-1a over the string.
 *
 * Not a cryptographic hash and not required to be one: this is an identity for
 * something nobody can address and nothing trusts. `node:crypto` would work and
 * would make this module import something, which the header says it must not —
 * it is reached from the browser bundle's module graph through src/types.ts's
 * neighbours, and a scrub policy that can pull in Node is how that stops being
 * true quietly.
 */
function hash10(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 10);
}
