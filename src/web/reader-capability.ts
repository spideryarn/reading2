/**
 * **What this reader may do with this article** — the capability seam.
 *
 * ## Why this is an object and not a boolean
 *
 * The first draft of docs/plans/public-read-only-access.md said the reading
 * view would take a `readOnly` prop. GPT Sol went and read the reading view,
 * and returned the finding this file exists because of:
 *
 * > The difficulty is not passing a fetch function. Hooks cannot be
 * > conditionally skipped inside one component, so this needs component
 * > boundaries and a discriminated capability object.
 * > — GPT Sol, answer 8, 2026-08-28
 *
 * `Reader` mounts `useComments`, `useChatAnchors` and `useGlossaryRead`, and
 * each of them fetches an authenticated endpoint on mount. `if (readOnly)`
 * cannot stop a hook running: React forbids calling one conditionally. So a
 * boolean would have produced a page that renders correctly and fires a stream
 * of 401s behind it — and, worse, an ownerless request to every endpoint the
 * bands poll, which is exactly what the acceptance test for this slice forbids.
 *
 * The seam is therefore two components — `OwnedReader` and `VisitorArticle` in
 * App.tsx — and this union is what they hand down. **The point is that the
 * `visitor` member has no `comments` field to be empty:** there is nothing for a
 * later edit to accidentally read, because there is nothing there.
 *
 * ## What "visitor" means
 *
 * Anyone who does not own the document. Signed out, or signed in and reading
 * somebody else's — they get the same page, keyed on *is this mine* rather than
 * on *am I signed in*. That is Greg's rule and it is what makes the read-only
 * chrome one thing rather than two.
 */
import type { Glossary, ThreadSummary } from "../types.js";
import type { PublicArtefacts } from "../public-types.js";
import type { GlossaryRead } from "./useGlossary.js";
import type { ChatAnchorsApi } from "./useChatAnchors.js";
import type { ClientComment, CommentsApi } from "./useComments.js";

export type ReaderCapability =
  | {
      kind: "owner";
      /** Passages this reader has marked, and the verbs on them. `useComments`. */
      comments: CommentsApi;
      /** Which conversations are anchored where. `useChatAnchors`. */
      chatAnchors: ChatAnchorsApi;
      /** The opening glossary read, shared with the band. `useGlossaryRead`. */
      glossary: GlossaryRead;
    }
  | {
      kind: "visitor";
      /**
       * Which artefacts this piece has, from `GET /api/public/metadata/:slug` —
       * or `null` when that request did not land.
       *
       * The only thing a visitor's capability carries, and it decides one thing:
       * which of two true sentences a marked mode shows. visitor.ts.
       */
      available: PublicArtefacts | null;
    };

/**
 * The empty lists a visitor's reading view draws from.
 *
 * **Module constants, not `[]` written at the call site**, and that is a
 * performance fact rather than tidiness. `Reader` memoises the comment anchors,
 * the chat marks and the term patterns on these arrays by identity, and a fresh
 * `[]` every render would invalidate every one of those memos on every render —
 * including the article-wide re-annotation, which is O(blocks × marks) and is
 * the one job on this page big enough to be felt. The same reasoning as the
 * memos in TableView.tsx.
 *
 * Typed rather than left as bare `[]` so that the compiler still checks what
 * `Reader` does with them — an untyped empty array is assignable to anything,
 * which is precisely the property that would let a wrong one through.
 */
export const NO_COMMENTS: ClientComment[] = [];
export const NO_THREADS: ThreadSummary[] = [];
export const NO_TERMS: Glossary["entries"] = [];
