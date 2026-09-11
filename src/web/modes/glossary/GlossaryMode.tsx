/**
 * **Glossary mode's controller.** The band an owner gets, the band a visitor
 * gets, and the hook underneath both: `?term=`, `?sort=`, `?gate=`, and the
 * selection the prose draws its emphasis from.
 *
 * Lifted out of `App.tsx` unchanged on 2026-09-06, in the shape `IdeasMode.tsx`
 * established a day earlier: a mode's controller, its visitor twin and its hook
 * move together into `src/web/modes/<feature>/`, keeping their props
 * byte-for-byte, so `App.tsx` stops knowing what is inside them. See
 * docs/plans/260906c-separate-article-access-reader-composition-and-mode-controllers.md.
 */

import { useEffect, useLayoutEffect } from "react";
import { useQueryState } from "nuqs";
import type { BlockId, GlossaryEntry } from "../../../types.js";
import type { PublicGlossary } from "../../../public-types.js";
import { formsOf } from "../../../term-match.js";
import type { TermSelection } from "../../annotate.js";
import { gateParam, sortParam, termParam, type TermSort } from "../../params.js";
import { useRenderCount } from "../../perf.js";
import { NO_TERMS } from "../../reader-capability.js";
import { useGlossary, type GlossaryRead } from "../../useGlossary.js";
import {
  effectiveSort,
  GlossaryPanel,
  PRIORITY_GATE,
  visibleEntries,
} from "../../GlossaryPanel.js";

/**
 * The glossary's jobs and verbs. The read itself belongs to `Reader`.
 *
 * A component of its own for the reason `ConversationBand` above is — but **no longer
 * the same reason it used to be**, and the old one is worth deleting rather
 * than leaving to mislead. It used to say: `useGlossary` fetches on mount, so
 * calling it up in `Reader` would charge every reader of every article for a
 * list almost none of them will open. That stopped being true on 2026-08-26,
 * when the dotted underlines became a standing property of the article and the
 * list had to be fetched for everyone anyway.
 *
 * What survives is the other half: **a mounted `useJobs` holds the job engine
 * on its idle cadence**, and that is a request every eight seconds for the life
 * of the panel. A reader who never opens the band should not pay for it. Hooks
 * cannot be called conditionally, so the condition has to be a component
 * boundary — this one.
 * The band's own mount revalidation rides on the same boundary.
 *
 * `?term=` and `?sort=` live here too, for the same reason: both are
 * meaningless outside glossary mode, and reading them in `Reader` would put two
 * parameter subscriptions on every render of the reading view for values only
 * this component uses.
 *
 * `onSelected` is the one thing that goes back out, and it is the seam
 * described on `term` in `Reader`: the panel knows which entry is selected, the
 * prose is where its underlines are drawn, and those are two different
 * components.
 */
export function GlossaryBand({
  slug,
  read,
  onJump,
  onSelected,
  onAskChat,
}: {
  slug: string;
  /**
   * The read, owned by `Reader`.
   *
   * There is no `onEntries` any more, and its absence is the change: the list
   * used to be fetched twice and pushed back up from here, which needed a
   * `pushed` ref to stop the slower copy overwriting the fresher one. One
   * owner, one list, nothing to push.
   */
  read: GlossaryRead;
  onJump(id: BlockId): void;
  onSelected(selection: TermSelection | null): void;
  /**
   * Hand a term to chat, for the one thing the glossary cannot answer.
   *
   * The *Look up a term* box explains what the piece says and nothing else, so
   * a word the piece never uses has no answer in this band at any price. Chat
   * is the surface that may go outside the article, and the panel offers it
   * rather than leaving the reader at a dead end. **The term goes up to
   * `Reader`**, which owns both the mode and the handoff into the conversation
   * band; this band used to be given `onMode` and switch to an empty chat. See
   * `AskATerm` in GlossaryPanel.tsx.
   */
  onAskChat(term: string): void;
}) {
  useRenderCount("GlossaryBand");
  const glossary = useGlossary(slug, read);
  const band = useGlossaryMode(glossary.glossary?.entries ?? NO_TERMS, onSelected);

  return (
    <GlossaryPanel
      access={{ kind: "owner", owner: glossary, glossary: glossary.glossary }}
      {...band}
      onJump={onJump}
      onAskChat={onAskChat}
    />
  );
}

/**
 * **The same panel, for somebody who does not own the article.**
 *
 * No `useGlossary`, no `useJobs`, no fetch of any kind: the list came in the
 * page's own payload (src/public-types.ts § PublicArtefactSet), so this
 * component is the query parameters and nothing else.
 *
 * A second *band* rather than a second *panel*, and the difference is the whole
 * design. `GlossaryBand` above exists because hooks cannot be called
 * conditionally, so "a visitor does not poll the job list" has to be a component
 * boundary — but everything a reader looks at is drawn by one `GlossaryPanel`
 * with its data injected. Two panels for one list is how the owner's glossary
 * and the visitor's glossary drift into two designs for one thing, which a
 * browser pass caught once already in a drawer heading.
 */
export function VisitorGlossaryBand({
  glossary,
  onJump,
  onSelected,
}: {
  glossary: PublicGlossary;
  onJump(id: BlockId): void;
  onSelected(selection: TermSelection | null): void;
}) {
  useRenderCount("VisitorGlossaryBand");
  const band = useGlossaryMode(glossary.entries, onSelected);
  return <GlossaryPanel access={{ kind: "visitor", glossary }} {...band} onJump={onJump} />;
}

/**
 * Everything the glossary band does that is not a fetch — the three parameters
 * and the selection it pushes back up.
 *
 * A hook rather than a base component, because two bands need all of it and
 * only one of them may call `useGlossary`. `?term=`, `?sort=` and `?gate=` live
 * here for the reason they used to live in the band: all three are meaningless
 * outside glossary mode, and reading them in `Reader` would put three parameter
 * subscriptions on every render of the reading view for values only this mode
 * uses.
 */
function useGlossaryMode(
  entries: readonly GlossaryEntry[],
  onSelected: (selection: TermSelection | null) => void,
) {
  const [termId, setTermId] = useQueryState("term", termParam);
  const [sort, setSort] = useQueryState("sort", sortParam);
  /* Null is "nobody has touched the threshold", which the panel resolves to
     `PRIORITY_GATE`. Kept as null rather than defaulted here so the default
     stays one number in one file — see `gateParam` in params.ts. */
  const [gate, setGate] = useQueryState("gate", gateParam);

  /**
   * **A term the bar has hidden cannot stay selected.**
   *
   * The rule search already held at `SearchBand` below, and it arrived here
   * with the 2026-09-03 change: the panel resolves `?term=` against the whole
   * glossary, independently of what it is drawing, so a raised gate used to
   * take the row away while the term stayed emphasised in the prose — and
   * lowering the gate later silently reopened a selection the reader had
   * watched disappear. "Open" is a thing the reader can see, and a hidden one
   * is a claim about the page that the page is not making.
   *
   * **Only the selected emphasis goes.** The dotted underline under every
   * glossary term is drawn from the full list in every mode (`termSelections`
   * in `Reader`) and is not the selection. It stays.
   *
   * Scoped to prioritised order, because that is the only order with a gate:
   * `?gate=` sitting in a URL must not clear a selection in a list nobody is
   * looking at a threshold for.
   */
  const order = effectiveSort(entries, sort);
  const hiddenSelection =
    termId !== null &&
    order === "prioritised" &&
    !visibleEntries(entries, gate ?? PRIORITY_GATE).visible.some((e) => e.id === termId);
  useEffect(() => {
    if (hiddenSelection) void setTermId(null);
  }, [hiddenSelection, setTermId]);

  /* `find` returns the entry object out of the list, so its identity is stable
     across renders until the list itself is replaced — which is what keeps the
     effect below from firing on every render. Null in the render itself the
     moment the bar hides it, rather than a tick later when `?term=` clears:
     waiting for the parameter would leave a frame with the prose emphasising a
     term the panel is not showing. */
  const selected = hiddenSelection ? null : (entries.find((e) => e.id === termId) ?? null);

  /* **`useLayoutEffect`, not `useEffect`**, and nulling `selected` above is not
     enough on its own — which is what the comment there used to claim. The
     value the prose actually draws from is `Reader`'s own state, and it only
     gets there through this call: a passive effect runs *after* the browser has
     had the chance to paint, so the panel could commit without the row while
     `TableView` still emphasised the term. One frame, and it is the frame in
     which the page says two different things about what is open.

     The same pairing, for the same reason, as `QuotesBand` above and
     `SearchBand` below: a layout effect on every change, and an unmount-only
     clear underneath. GPT Sol's second finding on the built code, 2026-09-03. */
  useLayoutEffect(() => {
    onSelected(
      selected ? { id: selected.id, forms: formsOf(selected), blocks: selected.blocks } : null,
    );
  }, [selected, onSelected]);

  /* Leaving glossary mode must take the *highlight* off the pressed term. Not
     the underlines, which since 2026-08-26 are a standing property of the
     article and outlive the band — this comment said otherwise until a GPT Sol
     review noticed it was describing the old behaviour.

     Its own effect, with no dependency on `selected`, so it runs on unmount and
     only on unmount — folding it into the cleanup of the effect above would
     clear the selection on every change and set it again immediately, which is
     a visible flicker. */
  useEffect(() => () => onSelected(null), [onSelected]);

  return {
    termId,
    onTerm: (id: string | null) => void setTermId(id),
    sort,
    onSort: (next: TermSort) => void setSort(next),
    gate,
    onGate: (next: number | null) => void setGate(next),
  };
}
