/**
 * **What this reader may do with this article** — the capability seam.
 *
 * ## Why this is an object and not a boolean
 *
 * The first draft of docs/plans/260827ai-public-read-only-access.md said the reading
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
import type { PublicArtefactSet, PublicArtefacts } from "../public-types.js";
import type { GlossaryRead } from "./useGlossary.js";
import type { ChatAnchorsApi } from "./useChatAnchors.js";
import type { ClientComment, CommentsApi } from "./useComments.js";
import type { UseArc } from "./useArc.js";

export type ReaderCapability =
  | {
      kind: "owner";
      /** Passages this reader has marked, and the verbs on them. `useComments`. */
      comments: CommentsApi;
      /** Which conversations are anchored where. `useChatAnchors`. */
      chatAnchors: ChatAnchorsApi;
      /** The opening glossary read, shared with the band. `useGlossaryRead`. */
      glossary: GlossaryRead;
      /**
       * The arc, and whether one is being written right now. `useArc`.
       *
       * **Here rather than on `Article` because only an owner can cause one.**
       * Since 2026-08-29 the arc is not built by every ingest, so an article can
       * be opened without one — and the thing that asks for one is a POST, which
       * a visitor must never issue. So "the arc as the reader will see it" is an
       * owner-shaped answer, and the visitor arm below keeps taking its arc from
       * the payload alone.
       */
      arc: UseArc;
    }
  | {
      kind: "visitor";
      /**
       * **The artefacts this piece has, as data rather than as a loader.**
       *
       * This is what slice 1b added, and the shape is the point. The owner's
       * arm above carries three *hooks' results* — a `CommentsApi`, a
       * `ChatAnchorsApi`, a `GlossaryRead`, each of which has a status, an
       * error and a set of verbs, because each of them is a request in flight.
       * A visitor's glossary is none of those things: it arrived inside the
       * page's own payload, so there is nothing to be loading, nothing to have
       * failed, and nothing to ask for.
       *
       * GPT Sol's design for this slice specified a four-state
       * `PublicArtefactRead<T>` — loading, ready, not-generated, unavailable —
       * because it also specified four sibling endpoints. Greg's decision that
       * there are none takes all four states with it: **an artefact that exists
       * is a key that is present.** src/public-types.ts § PublicArtefactSet.
       *
       * Which is also why this is not `GlossaryRead` with its fields left null.
       * The rule this file exists to keep is one member up: the visitor arm has
       * no `comments` field to be empty, so there is nothing for a later edit
       * to read. A nulled-out owner shape would have put that back.
       */
      artefacts: PublicArtefactSet;
      /**
       * The same fact as five booleans, derived once at the seam.
       *
       * The marked modes and the visitor's metadata page both ask *does this
       * piece have one* rather than *give me the list*, and they ask it about
       * `arc` too, which is not in the set above because it has ridden inside
       * the article payload since slice 1a. Derived rather than fetched:
       * `GET /api/public/metadata/:slug` used to answer this and the second
       * request is gone. public-artefacts.ts.
       *
       * **Not nullable any more.** It was `PublicArtefacts | null`, where
       * `null` meant that second request had failed — which is the state slice
       * 1b deleted along with the request. visitor.ts § VisitorGap.
       */
      available: PublicArtefacts;
      /**
       * **Whether there is a session — the one question the chrome asks that is
       * not "is this mine".**
       *
       * Everything else about this page keys on ownership, deliberately: a
       * signed-in reader on somebody else's shared document sees exactly what a
       * stranger sees, and that is the whole rule. The **call to action** is the
       * exception, and a browser pass found it, 2026-08-28: *"Make a free
       * account"* was being offered to somebody who already had one. Not wrong
       * — that reader genuinely cannot do more with this article — but it reads
       * as a page that has not noticed them.
       *
       * So the reason is shown to everybody and the offer only to somebody who
       * could take it up.
       */
      signedIn: boolean;
      /**
       * **Whether we could confirm that session** — and it is on the chrome,
       * not on what may be done.
       *
       * `GET /api/article/:slug` answered 401 (after `apiFetch` spent its one
       * refresh and one retry) while the public route answered 200, so this
       * reader is being served the shared article and told why it went
       * read-only. A 401 says nothing about the public entitlement, and the two
       * are kept independent on purpose — finding C3,
       * docs/plans/260902j-public-read-only-access-audit-and-improvements.md.
       *
       * **It grants and withholds nothing.** A visitor is a visitor whichever
       * way this reads: the owner-only hooks live inside `OwnedReader` and are
       * unreachable rather than skipped, exactly as they are for a stranger. So
       * it belongs beside `signedIn` — the other field here that only the
       * wording depends on — rather than beside `artefacts`.
       */
      sessionUnconfirmed: boolean;
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
