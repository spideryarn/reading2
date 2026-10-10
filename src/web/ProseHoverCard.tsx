/**
 * The card that appears when the pointer rests on something in the prose — a
 * glossary term, one of the article's own hyperlinks, or a phrase that is both.
 *
 * ## One card, not two, and that is the design
 *
 * 13% of the hyperlinks in this corpus have a glossary term as their link text
 * — "computational functionalism", "autopoiesis", "corrigibility". Those are
 * the most interesting links in an essay, and two components listening for two
 * selectors would have raced to put two panels over the same three words.
 *
 * They are also the case where one card is *better* than either alone, because
 * the two halves answer different questions about the same phrase: the glossary
 * says **what this author means by it**, and the link says **where they are
 * sending you to read about it**. So `read` below looks up from whatever the
 * pointer hit and collects both, and the card is sections rather than a choice.
 *
 * ## Why the machinery is a hook rather than this file
 *
 * See useHoverCard.ts. The short version is that the prose is injected HTML, so
 * the targets are not React elements and there is no ref to hand a component;
 * one panel is positioned against whichever node the pointer is on. That was
 * written for glossary terms and links needed the identical thing a day later,
 * which is what moved it out.
 *
 * A survey of the libraries that do this — Radix `HoverCard`, Base UI
 * `PreviewCard`, Ariakit `Hovercard` — is in docs/project/tooltips.md; all of
 * them are a `Trigger` wrapping one React element, which is the property that
 * rules them out. What a link *can* honestly say is docs/project/links.md.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactElement } from "react";
import {
  Asterisk,
  BookCheck,
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  CornerUpLeft,
  ExternalLink,
  FileText,
  Globe,
  MessagesSquare,
  LoaderCircle,
  Plus,
  Quote as QuoteIcon,
  Search,
  /* The house mark for "a model wrote this" — `SearchPanel`'s meaning search and
     `QuotesPanel` both use it for the same distinction, and using a different
     icon here would make the same claim in a second vocabulary. */
  Sparkles,
  Trash2,
} from "lucide-react";
import { FloatingArrow, FloatingPortal } from "@floating-ui/react";
import {
  type BlockId,
  type CitedWork,
  type GlossaryEntry,
  type Job,
  MAX_MENTIONS,
  type PagePreview,
  type Quote,
} from "../types.js";
import { LABEL as QUOTE_SCORE_LABEL } from "./QuotesPanel.js";
import { Excerpt } from "./Excerpt.js"; // quotes drawn from the block's markup (plan 261009k)
import { aiProvenance } from "./quote-band-rows.js";
import { urlKey } from "../ingest.js";
import { hostOf } from "../urls.js";
import { BlockRef } from "./BlockRef.js";
import type { JumpAim } from "./flash.js";
import { citePassageKey } from "./rows.js";
/* The same words-per-minute the masthead and the shelf card use. A second
   arithmetic here would be a card and a masthead disagreeing about one page,
   which is the drift src/reading-time.ts exists to make impossible. */
import { readingMinutes } from "../reading-time.js";
import { entryProse } from "./GlossaryPanel.js";
import { ASK_ENTRY_IN_CHAT, ASK_IN_CHAT, ASK_IN_CHAT_SAYS, ASK_WORK_IN_CHAT } from "./OriginChat.js";
/* **The band's own provenance function, not a second opinion.** `sourceOf`
   decides whether a row has an address or only a search, and it is total over
   `linkFrom` — so importing it is what stops this card and the band teaching a
   reader two different rules about the same work. See `CiteCard`. */
import {
  assessedOf,
  byLineOf,
  CITE_DOES_LABEL,
  CITE_ENTRY_NOTE,
  CITE_QUOTE_LABEL,
  CITE_VERDICT_LABEL,
  CITE_WHY_LABEL,
  showsWhy,
  InSpideryarn,
  readNoteOf,
  registryConflictNote,
  registryFilledMark,
  registryFilledNote,
  sourceOf,
  verdictText,
  workByLine,
} from "./CitationsPanel.js";
import { HOVER_DELAY, useHoverCard } from "./useHoverCard.js";

/**
 * **How long a pointer rests on a quote before its card opens** — longer than
 * the ordinary 320ms, because a quote is often a whole paragraph and the
 * pointer rests in it while the reader reads, so a fast card would keep
 * popping up over the text. 900ms from 2026-10-02; 600ms since 2026-10-07,
 * because a reader asked for a tooltip on quotes that already had one
 * (spya-tpmde9), which suggests 900ms hid the card from people who would use
 * it. A guess to be felt in a browser, not a measurement
 * (docs/project/quotes.md). Exported for the test that pins it.
 */
export const QUOTE_OPEN_MS = 600;
import { TermJump } from "./TermJump.js";
import { describeLink, type ExternalPreview, type LinkPreview } from "./link-preview.js";
import {
  PUBLIC_COPY_ON_THE_CARD,
  PUBLIC_COPY_OWN_ON_THE_CARD,
  PUBLIC_COPY_READ_ON_THE_CARD,
  REPEAT_PASTE_ON_THE_CARD,
  worthRetrying,
} from "../messages.js";
import { blockOfLink, refreshShelf, useLinkFacts, type LinkFacts } from "./link-facts.js";
import { leavesTheApp } from "./external-links.js";
import { QuotaNotice } from "./QuotaNotice.js";
import { useJobs } from "./useJobs.js";
import { forgetOnReaderChange } from "./lib/reader-change.js";
import { Link } from "./Link.js";
import { helpHref, modeAnchor } from "./help/help-anchors.js";
import { readHref } from "./router.js";
import { internalTarget } from "./internal-links.js";
import { GlossaryKindIcon } from "./GlossaryKindIcon.js";
import { MODE_ICON } from "./mode-icons.js";
import { MODE_LABEL } from "../title-text.js";
import type { Mode } from "../modes.js";
import {
  isBackLink,
  noteMarkerAt,
  notePreviewHtml,
  NOTE_REF_ATTR,
  type NoteIndex,
  type NoteMarker,
} from "./notes-view.js";
import { articleTitleVoice, gistVoice, voiceClass } from "./voice.js";

/** What the pointer found: a term, a citation, a link, or several over the same words. */
interface Hit {
  /** Glossary entry ids, in the order the mark lists them. May be empty. */
  termIds: string[];
  /**
   * Cited-work ids, in the order the mark lists them. May be empty.
   *
   * More than one where a single phrase names two works — "(Tulving 1983;
   * Baddeley 1974)" is one run of characters — and the card then draws a
   * section for each, exactly as it does for two overlapping terms.
   */
  citeIds: string[];
  /**
   * The quotes' mark keys (`quoteMarkKey`) the pointer is inside, filtered
   * against the listed quotes. Usually none or one: quotes do not overlap (Find
   * more's taken spans win every overlap, src/quotes.ts), but nothing here
   * depends on that.
   */
  quoteKeys: string[];
  /** The href, already described. Null when the pointer is on a bare term. */
  link: LinkPreview | null;
  /** For an in-article anchor: the block it resolves to. */
  anchor: { blockId: BlockId; text: string } | null;
  /**
   * **The block the anchor itself sits in** — where the reader is standing,
   * rather than where the link goes, which is `anchor` above.
   *
   * `null` off the prose: a link in a chat answer or in the sources under one is
   * in no article's block, and the summary route refuses those anyway.
   */
  inBlock: BlockId | null;
  /** The raw href, for the foot of the card. */
  href: string | null;
  /**
   * A footnote marker, and the whole note behind it.
   *
   * The card this produces is not a description of a destination — it is the
   * destination, in full. "make the hover preview good enough that most visits
   * never jump at all" (docs/plans/260828o-footnotes.md § The fisheye).
   */
  note: NoteMarker | null;
  /** A note's back-link: the same machinery pointing the other way. */
  back: boolean;
}

/**
 * The card, and beside it **the keyboard's way to the same entries**: G from a
 * paragraph opens its term in the glossary, which is what this card's foot
 * button does for a pointer (TermJump.tsx). Mounted here because the terms and
 * the opener already meet here, and every reading view that has the card has
 * the key.
 */
export function ProseHoverCard(props: Parameters<typeof HoverCard>[0]) {
  return (
    <>
      <TermJump entries={props.entries} onOpenTerm={props.onOpenTerm} />
      <HoverCard {...props} />
    </>
  );
}

function HoverCard({
  entries,
  works,
  slug,
  sourceUrl,
  blockText,
  notes,
  onOpenTerm,
  onJump,
  onFollowNote,
  lookUpLinks,
  canAddToShelf,
  showInSpideryarn,
  termActions,
  onAskTerm = null,
  onAskCitedWork = null,
  onOpenCitedWork = null,
  quotes = null,
}: {
  entries: GlossaryEntry[];
  /**
   * **The works the piece cites** — the whole list, so a citation mark in any
   * mode can find the work it belongs to.
   *
   * Empty for a visitor, because Reader.tsx takes it only from the owner's
   * read (`owner?.citations`). That is a choice in Reader, not a property of
   * the data: a visitor's band has its own public projection since 260929c
   * (src/web/visitor.ts), so the owner-only *parts* of a row are gated here
   * by name too — see `showInSpideryarn` (docs/project/citations.md § Who
   * sees it).
   *
   * A list rather than a `Map`, matching `entries`; `byWork` below does the
   * indexing once for the same reason `byId` does.
   */
  works: readonly CitedWork[];
  /**
   * **Which article the reader is in**, and both server-side sources are
   * article-scoped: `GET /api/link-preview` and, since 2026-09-05,
   * `GET /api/link-summary`.
   *
   * Neither will touch a URL until it has proved the caller owns this article
   * *and* that this article really points at that URL — which is what turns an
   * arbitrary-URL fetch endpoint into one that can only ever reach things an
   * author already published in a piece this reader owns. GPT Sol, 2026-09-05,
   * P1-1; src/link-previews.ts.
   *
   * **The slug means something different to each of them, and the difference is
   * the whole shape of the feature.** To the preview it is the *permission* and
   * nothing more: what a page says about itself is a property of the address, so
   * that cache is keyed on the address alone and shared with everybody. To the
   * summary it is part of the *question* — how this destination stands to *this*
   * piece — so that cache is keyed on the reader, the article and the address
   * together, and is shared with nobody. src/link-summary.ts.
   *
   * `null` in any context that has no article — the card then keeps its two
   * href-and-Wikipedia lookups and asks the server nothing.
   */
  slug: string | null;
  /**
   * Where the article itself came from.
   *
   * Two jobs, and the second is why it is not just a display detail: a link can
   * say whether it *leaves* this publication, and a link back to this very
   * article can say so instead of offering to open the page you are on.
   */
  sourceUrl: string | null;
  /** The rendered text of a block, for previewing an in-article anchor. */
  blockText: Map<BlockId, string>;
  /**
   * The article's footnotes, indexed once — see notes-view.ts.
   *
   * Built in App rather than here because `read` runs on every `pointerover`
   * that hits a link, and a note is a *range* of blocks: the index is what makes
   * "which note is this, and what is all of it" two map lookups.
   */
  notes: NoteIndex;
  /** Show this term in the glossary band — the card's one way out to the list. */
  onOpenTerm(id: string): void;
  /**
   * Go to the block an in-article anchor points at — or, from a citation's
   * card, to a passage that cites the work, aimed at its citing words
   * (`citePassageKey`; plan 261009e).
   */
  onJump(id: BlockId, aim?: JumpAim): void;
  /**
   * Go to a note, remembering the passage it was cited from.
   *
   * Separate from `onJump` because the return journey is the half that is easy
   * to get wrong: one Wikipedia note is marked thirteen times, so the note's
   * thirteen back-links all look alike, and only the caller can say which one
   * the reader should be looking at when they land.
   */
  onFollowNote(from: BlockId | null, marker: NoteMarker): void;
  /**
   * **May this card look a link up, or only describe it?**
   *
   * `useLinkFacts` asks two things about an external link: `GET /api/library`,
   * to say whether the reader already has that page on their shelf, and
   * Wikipedia, for a summary. The first is authenticated and the second leaves
   * our origin entirely.
   *
   * A visitor gets neither, and **the seam is that `useLinkFacts` is not
   * called** rather than called with nothing — see `WithLinkFacts` below. GPT
   * Sol found this reviewing the client half on 2026-08-28, and it is the
   * sharpest finding of the set: the acceptance test says *a signed-out browser
   * issues no request outside `/api/public/`*, and that was already false on
   * the most ordinary interaction there is. The trace could not see it because
   * a trace records requests and this one needs a **hover** to happen first.
   *
   * What survives for a visitor is everything `describeLink` derives from the
   * href alone — the host, whether it leaves this publication, whether it is an
   * in-article anchor and which block it lands on. That is the bulk of the
   * card.
   */
  lookUpLinks: boolean;
  /**
   * **May this reader put a link on a shelf?**
   *
   * A second boolean rather than a reuse of `lookUpLinks`, even though App.tsx
   * derives both from the same `owner !== null` today. They are different
   * questions — *may this card ask about a link* and *may this reader add to a
   * shelf* — and the first is about reading while the second spends a metered
   * ingest slot (docs/project/billing.md). The day either one moves, it moves
   * on its own: a signed-in reader looking at somebody else's article could
   * plausibly be allowed the lookups and not the button, and there is no
   * expression here that would have to be untangled to say so.
   *
   * The enforcement is the same one `lookUpLinks` uses and for the same
   * reason: **`useJobs` is not called**, because `WithAddToShelf` is not
   * rendered. A prop read inside a hook would be a card that draws no button
   * and still subscribes a visitor's tab to a job queue it has no business
   * knowing about. src/web/reader-capability.ts is the written-up version.
   */
  canAddToShelf: boolean;
  /**
   * **May the citation half say a work is already an article here?** The
   * band's *In your library* / *On the public shelf* line (plan 261001i).
   * Owner-only, like the band's own `showInSpideryarn`: the public DTO never
   * carries the field, and this is the second lock, so a malformed or
   * future visitor payload still draws nothing (GPT Sol, plan review).
   */
  showInSpideryarn: boolean;
  /**
   * **What an owner may do to a term's place in their glossary from the
   * card** — *Hide*. Greg, 2026-10-02: *"it would be great if the new
   * clickable Glossary hover-card also includes a 'Hide' action"* (plan
   * 261002c § 3).
   *
   * `null` for a visitor, and then no *Hide* is drawn: a hide is the owner's
   * own view of their own article. Reader passes its `GlossaryRead`, which is
   * only on the owner's arm of the capability (reader-capability.ts), so a
   * visitor has nothing to pass.
   */
  termActions: TermActions | null;
  /**
   * ***Ask in chat* on a term's card** — the Glossary band's own sender. Greg,
   * 2026-10-02: *"We have a 'Dig deeper' in Glossary mode. Add that to the
   * in-text glossary tooltip."* (spya-p09u4s); the card's Dig deeper became
   * this on 2026-10-09, as the band's did (plan 261009k). Its own capability,
   * not part of `termActions`, so Hide and the chat do not hang off each other
   * (GPT Sol's plan review of 261009k, F1). `null` or absent for a visitor,
   * who has no chat.
   */
  onAskTerm?: AskAboutTerm | null;
  /**
   * ***Ask in chat* on a cited work's card** — the Citations rows' own sender.
   * Greg, 2026-10-03 (report `spya-c2qmbg`): *"What I was hoping is that it
   * would have a button for dig deeper in the tooltip."* Plan 261004b; it
   * became *Ask in chat* on 2026-10-09 (plan 261009k). `null` or absent for a
   * visitor, who has no chat.
   */
  onAskCitedWork?: ((work: CitedWork) => void) | null;
  /**
   * ***Open in Sources* on a cited work's card** — Reader's
   * `openBibliographyWork`, which opens Bibliography and brings the work's row
   * into view. Report `spya-zux9w6`, Greg, 2026-10-09: *"Citation tooltips
   * should include a link to take you to the citations mode"* (plan 261010d).
   * `null` or absent and no button is drawn; the marks are the owner's only.
   */
  onOpenCitedWork?: ((workId: string) => void) | null;
  /**
   * **The quotes the prose fills, and what the card's buttons do with one**
   * — `QuoteCard`. `null` where there are none to point at; then `read` never
   * looks for one. A visitor gets it too: the scores and the reason are on the
   * public list already (src/public-types.ts § `PublicQuotes`), and stepping
   * and opening Quotes write only the URL. Optional, absent meaning none, so a
   * surface with no quotes need not know the half exists.
   */
  quotes?: QuoteCardSource | null;
}) {
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  /* The same indexing for the citations, for the same reason: `read` runs on
     every `pointerover` and must look things up rather than scan. */
  const byWork = useMemo(() => new Map(works.map((w) => [w.id, w])), [works]);

  /* Called on every hover, so it looks things up and scans nothing.

     It reads **upwards and downwards**, which is what lets one machine serve
     both shapes. Upwards: the pointer is usually on a text node inside a
     `<mark>` inside an `<a>`, and `closest` finds each. Downwards: a keyboard
     focus lands on the `<a>` itself, whose terms are its descendants — without
     the `querySelectorAll` a tabbed-to link would lose the glossary half of its
     card for no reason a reader could see. */
  const read = useCallback(
    (el: HTMLElement): Hit | null => {
      const mark = el.closest("mark.term");
      const anchorEl = el.closest("a[href]");

      const marks = mark ? [mark] : anchorEl ? [...anchorEl.querySelectorAll("mark.term")] : [];
      const termIds = [
        ...new Set(marks.flatMap((m) => (m.getAttribute("data-term") ?? "").split(" "))),
      ].filter((id) => byId.has(id));

      /* The citations, read the same two ways for the same reason — and
         separately from the terms, because a phrase can carry both and they are
         two different `<mark>` *classes* on what may be one element. `closest`
         is asked for each, so neither can shadow the other.

         **Filtered against the list**, exactly as the terms are, which is what
         makes a stale mark and a forged one the same harmless case: the prose
         can outlive the list it was marked from, and an id we do not have draws
         no section. */
      const citeMark = el.closest("mark.cite");
      const citeEls = citeMark
        ? [citeMark]
        : anchorEl
          ? [...anchorEl.querySelectorAll("mark.cite")]
          : [];
      const citeIds = [
        ...new Set(citeEls.flatMap((m) => (m.getAttribute("data-cite") ?? "").split(" "))),
      ].filter((id) => byWork.has(id));

      /* **The quote, read upwards only**: a quote is a `mark.hit[data-quote]`,
         and its `data-hit` lists every hit on that run — a search's keys too —
         so it is filtered against the listed quotes, which is also what makes a
         stale or forged key draw nothing. Not downwards from a link: a quote
         is a passage, and a link inside one is not "on" it.
         docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md § 2. */
      const quoteMark = quotes ? el.closest("mark.hit[data-quote]") : null;
      const quoteKeys = quoteMark
        ? [...new Set((quoteMark.getAttribute("data-hit") ?? "").split(" "))].filter(
            (key) => quotes?.byKey.has(key) ?? false,
          )
        : [];

      const href = anchorEl?.getAttribute("href") ?? null;
      const link = href ? describeLink(href, sourceUrl) : null;

      /* `internalTarget` is the same resolver a click goes through, so the card
         and the jump can never disagree about where a fragment lands — and it
         returns null for a fragment this document does not answer to, which is
         the honest "we cannot tell you" rather than a card about nothing. */
      let anchor: Hit["anchor"] = null;
      if (anchorEl && link?.kind === "anchor") {
        const blockId = internalTarget(anchorEl, document);
        const text = blockId ? blockText.get(blockId) : undefined;
        if (blockId && text) anchor = { blockId, text };
      }

      /* A footnote marker, recognised by its stamp **and** by what the stamp
         resolves to — notes-view.ts says why both. It wins over the ordinary
         anchor card: "elsewhere in this article", with the note's first 260
         characters under it, is a worse answer than the note. */
      const note = anchorEl ? noteMarkerAt(anchorEl, document, notes) : null;

      /* **Which paragraph the pointer is in**, read the way `onFollowNote` and
         TableView's own link handler read it: the row is the block, and
         `data-block` is the id every feature here addresses text by
         (docs/project/block-ids.md). It is what tells the summary which of two
         mentions of one destination the reader is actually looking at.
         link-facts.ts § `blockOfLink` has the rule, and the one place a row
         is not the answer. */
      const inBlock = blockOfLink(anchorEl);

      if (note) return { termIds, citeIds, quoteKeys, link, anchor, inBlock, href, note, back: false };

      // Nothing to say. A bare `<a>` we cannot describe is not worth a panel.
      const marked = termIds.length > 0 || citeIds.length > 0 || quoteKeys.length > 0;
      if (!marked && !link) return null;
      if (!marked && link?.kind === "anchor" && !anchor) return null;
      return {
        termIds,
        citeIds,
        quoteKeys,
        link,
        anchor,
        inBlock,
        href,
        note: null,
        back: !!anchorEl && isBackLink(anchorEl),
      };
    },
    [byId, byWork, sourceUrl, blockText, notes, quotes],
  );

  const { shown, close, anchorProps, arrowRef, context } = useHoverCard<Hit>({
    /* **Named places, not `a[href]`.** The listener is delegated on the
       document, so a bare `a[href]` meant *every* anchor on the page — the
       masthead's "Library", the `read it here` button inside this very card,
       the source list at the foot of an answer. A relative href does not parse,
       so `describeLink` returned `{kind: "other"}` and the reader got a panel
       saying `link` over `/library`. Nobody had reported it, which is what an
       ignorable wart looks like; narrowing it was needed anyway to let chat's
       links in, so it was done there. docs/plans/260827ao-chat-web-links.md.

       Three places earn a card, and they are the three where the reader is
       deciding whether to follow an address somebody else chose: the article's
       own hyperlinks, the links a chat answer writes into its prose
       (`cited-link`, Cited.tsx), and the sources listed under an answer. */
    /* **`:not(.xref)` on both marks: a cross-reference wins the words it is
       on** (Sol F5). A term or a citation over the same phrase is one merged
       `<mark class="term xref">`, and two cards over one phrase — this one and
       BlockLinkCard's — would be two answers to one hover. The xref's card is
       the block preview, and the term keeps its underline and the glossary.
       docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md. */
    /* **And a quote's mark, since 2026-10-02** — Greg, spya-mtyquy. Pointer
       and keyboard-focus of a link only: it is not in `tapSelector`, because a
       quote is the one mark a tap selects its paragraph through
       (TableView.tsx § `NOT_A_BLOCK_SELECTION`), which is how a finger
       annotates. `:not(.xref)` for the reason the other two marks have it.
       docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md § 2. */
    selector:
      "mark.term:not(.xref), mark.cite:not(.xref), mark.hit[data-quote]:not(.xref), .prose a[href], a.cited-link, .chat-sources a[href]",
    /* Both containers survive their own re-render, which is the whole
       requirement — see `host`. A chat answer's `<p>` does not, so the
       fallback would leave a card pinned to a detached node as an answer
       streams. */
    host: ".prose, .chat-turn",
    read,
    /* **A quote and nothing else waits longer** (`QUOTE_OPEN_MS`): it is a
       passage the reader rests in while reading, not a word they point at to
       ask. A quote that is also a term, a citation or a link keeps the
       ordinary rest, because the reader may be asking about those. */
    openDelay: (hit) =>
      hit.quoteKeys.length > 0 &&
      hit.termIds.length === 0 &&
      hit.citeIds.length === 0 &&
      !hit.link &&
      !hit.note
        ? QUOTE_OPEN_MS
        : HOVER_DELAY.open,
    /* True here and false for a bare term, and the difference is not a
       preference: an `<a>` is a tab stop already, so a reader moving through
       the prose by keyboard lands on one whether we listen or not, and opening
       the card their pointer would have got is the whole of what parity costs.
       A `<mark>` takes no focus, and making several hundred of them into tab
       stops would be worse than the gap it leaves. */
    focusable: true,
    /* A finger opens the card on an underlined **term**, and on nothing else.
       Every link in that selector already does something under a tap — it
       navigates, or TableView jumps to the fragment — and replacing that with a
       preview would take away a working affordance to give a slower one.

       A term *inside* a link is the interesting case, and it goes to the term:
       13% of this corpus's links have a glossary term as their link text, the
       card carries both halves, and its foot still has "open in a new tab". So
       the link goes from zero taps away to one, and what the author means by
       the word goes from unreachable to zero. docs/plans/260827ak-touch-glossary-card.md. */
    /* **And a footnote marker, which is the exception that proves the rule.**
       A marker is a link, so by the paragraph above a tap should be left to
       navigate — and navigating is the one thing a marker should not do under a
       finger. The jump recentres all three panels on "Notes", so the reader's
       place in the argument leaves every column for the sake of a citation they
       have not read yet. First tap shows the note, second tap goes there: the
       spine's `bandPress` rule, which this card already uses for a term. */
    /* **And a link out of the app**, since 2026-09-04, for the reason the two
       above are here: a finger has no hover, so committing blind is the only
       thing a first tap can mean.

       > What I wanted was for it to first show me a pop up about the web link.
       > And then perhaps if I click again it should open it in a new page.
       >
       > — Greg, 2026-09-04 (SPIDERYARN-READING2-10)

       **Keyed on `target="_blank"`, not on the href**, and that is the honest
       spelling: this rule is "a link that is about to take you out of the app
       reveals itself first", and the attribute is exactly the set of links that
       do. Only our own ingress can write one — the sanitiser strips the
       author's, and src/web/external-links.ts writes ours immediately after —
       so a publisher cannot opt a link into or out of this.

       **A glossary term inside a link still wins**, and nothing here had to be
       written to make it so: `closest` returns the innermost match, so a tap on
       the underlined words finds the `mark.term` and the link is never the hit.
       That keeps the rule the reader has already learnt — second tap opens the
       glossary — for the 13% of this corpus's links whose text is a term. The
       link half of that card is still one press away, at its foot. Decided by
       the orchestrator on GPT Sol's review, 2026-09-04. */
    /* **And a citation, since 2026-09-16.** Not an extra: leaving it out is what
       breaks the page rather than what keeps it simple. `mark.cite` matches
       `NOT_A_BLOCK_SELECTION`'s `"mark:not(.hit)"` entry in TableView.tsx, so a
       tap on one already does not select the paragraph — and if nothing here
       acts on it either, every citation becomes a small dead hole in the prose
       where a finger reaches neither the card nor the gutter. A densely-cited
       paragraph would be peppered with them, which is precisely what the quote
       carve-out in that list was written to prevent.

       **A bare citation needs no `onCommit` branch.** The first tap reveals the
       card, and the card is where a citation's action lives — the link out,
       which the card takes pointer events for. A second tap falls through every
       branch below and leaves the card up, which is the right thing for it to
       do. The exception is a citation inside an author's internal link: because
       the hook has intercepted that link in order to reveal the citation, the
       anchor branch below preserves its established second-tap jump. Were there
       a foot button here, the precedence between a term and a citation on one
       `<mark>` would have to be decided; there is not, so it does not. */
    /* `:not(.xref)` for the selector's reason, and here it decides more than a
       card: a tap this hook claims is a reveal, so a term under a
       cross-reference would take the first tap and the jump would need a second.
       Excluded, the tap falls through to TableView's click and jumps, as a
       `BlockRef` does. */
    tapSelector: `mark.term:not(.xref), mark.cite:not(.xref), a[${NOTE_REF_ATTR}], .prose a[target="_blank"]`,
    /* The second tap on the same words, which is what the foot's "in the
       glossary" button does. Both, rather than the button alone: on a touch
       screen the words are a far bigger target than a 10px-tall row of text,
       and the reader should not have to hit the small one.

       **Only when the mark carries exactly one term.** Where two overlap the
       same phrase the card draws both, and it says why in as many words: which
       matched the longer phrase is not a thing the mark records, so picking one
       would be picking for the reader. A second tap cannot honour that and also
       commit, so it does nothing and leaves the card open with its two named
       buttons — the reader chooses, which is the same answer the card was
       already giving. Raised by a GPT Sol review, 2026-08-27. */
    onCommit: ({ el, data }) => {
      /* A marker's second tap is the jump it would have made on the first,
         which is why the swallowed navigation is not a loss. */
      if (data.note) {
        close();
        onFollowNote(el.closest("tr[data-block]")?.getAttribute("data-block") ?? null, data.note);
        return;
      }
      const ids = data.termIds.filter((id) => byId.has(id));
      const only = ids.length === 1 ? ids[0] : undefined;
      if (ids.length > 0) {
        if (only) {
          close();
          onOpenTerm(only);
        }
        /* More than one deliberately does nothing: the reader chooses between
           the card's named term buttons. Do not let a link or citation sharing
           those words turn that ambiguity into a jump or an outbound tab. */
        return;
      }
      /* `mark.cite` can be nested in the author's own internal link. It is the
         tap target in that case, so the hook cancels the anchor's click on both
         taps; preserve the ordinary second-tap jump just as the external branch
         below preserves the ordinary second-tap tab. Notes and glossary terms
         keep precedence above. */
      if (data.link?.kind === "anchor" && data.anchor) {
        close();
        onJump(data.anchor.blockId);
        return;
      }
      /* **The link's own tab, on the second tap.** Last of the three, so a
         marker and a term both still get the answer they had — and reached only
         when the hit *is* the anchor, which a tap on a glossary term inside a
         link never is (see `tapSelector`).

         `window.open` rather than letting the click through, because the hook
         cancels the click of every tap on a link and decides it itself
         (useHoverCard.ts § clicked) — which is what stops a first tap escaping
         to the destination, SPIDERYARN-READING2-3Y. This runs inside that
         `click` listener, so it is a user activation and not a popup for a
         blocker to refuse. `noopener,noreferrer` is the
         pair the anchor itself carries — a `window.open` does not inherit it. */
      if (data.link?.kind === "external" && data.href) {
        close();
        window.open(data.href, "_blank", "noopener,noreferrer");
      }
    },
  });

  if (!shown) return null;
  const { termIds, citeIds, quoteKeys, link, anchor, inBlock, href, note, back } = shown.data;
  const found = termIds
    .map((id) => byId.get(id))
    .filter((e): e is GlossaryEntry => e !== undefined);
  /* Resolved here rather than carried on `Hit`, as the terms are: `read` runs on
     every hover and the list can be replaced between the hover and the paint. */
  const cited = citeIds.map((id) => byWork.get(id)).filter((w): w is CitedWork => w !== undefined);
  /* The same, for the quotes: the list can be replaced (a Find more, a moved
     bar) between the hover and the paint. */
  const quoted = quoteKeys
    .map((key) => quotes?.byKey.get(key))
    .filter((q): q is Quote => q !== undefined);
  if (found.length === 0 && cited.length === 0 && quoted.length === 0 && !link) return null;

  const label = [
    ...found.map((e) => e.name),
    ...cited.map((w) => w.title),
    ...quoted.map(() => "quote"),
    note
      ? `note ${note.label}`.trim()
      : link?.kind === "external"
        ? link.host
        : link?.kind === "anchor"
          ? "in this article"
          : null,
  ]
    .filter(Boolean)
    .join(", ");

  /**
   * The card, given whatever we were able to find out.
   *
   * A function rather than the JSX directly, because the two readers reach it
   * by different routes: an owner through `WithLinkFacts`, which mounts the
   * lookups, and a visitor straight from here with a constant. One body, drawn
   * the same way, and the difference is entirely in what was asked of the
   * network before it ran.
   */
  const card = (facts: LinkFacts, add: AddToShelf) => (
    <FloatingPortal>
      {/* `dialog`, not `tooltip`: WAI's tooltip pattern is for text describing
          the thing you point at, and says outright that a tooltip does not take
          focus and should not contain focusable controls. This one holds a link
          and a button. Flagged by a GPT Sol review, 2026-08-26. */}
      <div {...anchorProps} role="dialog" aria-label={label}>
        {/* `note` widens the card and nothing else: a whole footnote in a
            21rem column is a very tall, very narrow object. styles.css. */}
        <div className={`tooltip prose-card${note ? " has-note" : ""}`}>
          {/* More than one term only where two overlap the same words —
              "attention" inside "attention head", commoner now that the whole
              list is drawn. Both are shown: picking one would be picking for
              the reader, and which matched the longer phrase is not a thing the
              mark records. */}
          {found.map((entry) => (
            <TermCard
              key={entry.id}
              entry={entry}
              onOpen={() => { close(); onOpenTerm(entry.id); }}
              actions={termActions}
              onAsk={onAskTerm}
              onClose={close}
            />
          ))}
          {/* The citation half, under the term half and above the link half.
              That order is the one the link half already argues for: the reader
              is in the middle of a sentence, so what the word means comes first,
              then what work is being leaned on, and only then where either
              would take them.

              More than one where a phrase names two works, for the same reason
              two terms can both be drawn: which of them the mark's characters
              "belong" to is not a thing the mark records, so picking one would
              be picking for the reader. */}
          {cited.map((w) => (
            <CiteCard
              key={w.id}
              work={w}
              showInSpideryarn={showInSpideryarn}
              onAsk={onAskCitedWork}
              onOpen={
                onOpenCitedWork
                  ? () => {
                      close();
                      onOpenCitedWork(w.id);
                    }
                  : null
              }
              here={shown.el.closest("tr[data-block]")?.getAttribute("data-block") ?? null}
              onJump={(id) => {
                close();
                onJump(id, citePassageKey(w.id));
              }}
              onClose={close}
            />
          ))}
          {/* The quote half, under the term and the citation and above the
              link: what the words mean and whom they lean on come first, then
              why we kept them, then where a link would take you. */}
          {quotes &&
            quoted.map((q) => <QuoteCard key={q.id} quote={q} source={quotes} onClose={close} />)}
          {/* The note in full, in place of the link half rather than under it.
              A marker IS a link into this article, so `LinkCard` would happily
              draw it — as "elsewhere in this article" over 260 clipped
              characters of the note. The whole point of this stage is that the
              reader does not have to go and look. */}
          {note && (
            <NoteCard
              note={note}
              divided={found.length > 0 || quoted.length > 0}
              onGo={() => {
                close();
                onFollowNote(
                  shown.el.closest("tr[data-block]")?.getAttribute("data-block") ?? null,
                  note,
                );
              }}
              onJump={(id) => { close(); onJump(id); }}
            />
          )}
          {/* The link half, under the term half when there is one. That order
              is deliberate: the reader is in the middle of a sentence, and what
              the word means comes before where it would take them. */}
          {link && !note && (
            <LinkCard
              link={link}
              anchor={anchor}
              href={href}
              facts={facts}
              add={add}
              back={back}
              divided={found.length > 0 || quoted.length > 0}
              onJump={(id) => { close(); onJump(id); }}
            />
          )}
          <FloatingArrow
            ref={arrowRef}
            context={context}
            className="tooltip-arrow"
            width={12}
            height={6}
            tipRadius={1}
            fill="var(--surface-raised)"
            stroke="var(--rule-strong)"
            strokeWidth={1}
          />
        </div>
      </div>
    </FloatingPortal>
  );

  /* The **shown** link is handed to the lookups rather than the hovered one, on
     purpose: a card takes 320ms of rest to open, so a pointer crossing the
     prose asks Wikipedia about nothing. link-facts.ts § What Wikipedia is told
     has the caveat to that. */
  const withFacts = (add: AddToShelf) =>
    lookUpLinks ? (
      <WithLinkFacts link={link} sourceUrl={sourceUrl} slug={slug} inBlock={inBlock}>
        {(facts) => card(facts, add)}
      </WithLinkFacts>
    ) : (
      card(NO_LINK_FACTS, add)
    );

  /**
   * **The second gate, wrapped around the first rather than folded into it.**
   *
   * Two conditions, two component boundaries: each one's rule is "this hook is
   * not called", and in React the only way to say that is a component that does
   * not exist. Combining them into one wrapper would make the two questions one
   * question, which is exactly what `canAddToShelf`'s comment says they are not.
   *
   * `leavesTheApp` as well as `kind === "external"`, because `describeLink`
   * calls any http(s) address external — including one pointing back at
   * Spideryarn, which is a page rather than an article and has nothing to
   * ingest. It is the same predicate that decided this link opens in a new tab
   * (external-links.ts), so the card cannot disagree with the anchor about
   * whether the link leaves.
   *
   * **Outside `WithLinkFacts`, so it does not know whether the shelf already
   * has this page.** A card over an article the reader owns therefore mounts a
   * `useJobs` subscriber it will draw nothing with, which costs one idle poll
   * for as long as the pointer rests there. The other order would put the
   * subscriber *under* an answer that arrives late, so the component would
   * mount and unmount as the lookup landed — a worse trade than one poll. The
   * "already on the shelf" rule is applied in `ExternalBody` instead.
   *
   * **A link to the piece the reader is standing in is refused here, from the
   * href alone.** `useLinkFacts` works the same equality out, but only hands it
   * back *inside* a `LibraryMatch` — so until the shelf has loaded there is
   * nothing to suppress the button with, and the noema essay links to itself in
   * its own prose. Offering to ingest the article you are reading is the worst
   * thing this button could do with a metered slot, and the href already knows.
   * GPT Sol, 2026-09-05, P1-1.
   */
  const addable =
    canAddToShelf &&
    link?.kind === "external" &&
    leavesTheApp(link.url) &&
    !(sourceUrl !== null && urlKey(sourceUrl) === urlKey(link.url))
      ? link.url
      : null;
  if (addable === null) return withFacts(NO_ADD_TO_SHELF);
  return <WithAddToShelf url={addable}>{withFacts}</WithAddToShelf>;
}

/**
 * **The asynchronous half of a link card, and the component boundary that keeps
 * it away from a visitor.**
 *
 * A render prop rather than a prop on the card, because the rule it enforces is
 * about *calling* `useLinkFacts` at all. A hook cannot be skipped conditionally
 * inside one component, and passing the hook itself down as a prop would change
 * the number of hooks a component calls the moment the prop changed — which
 * React answers with a thrown error rather than a fetch. So the condition is
 * this component existing, which is the same shape `OwnedReader` uses for the
 * comments, chat and glossary reads. reader-capability.ts.
 */
function WithLinkFacts({
  link,
  sourceUrl,
  slug,
  inBlock,
  children,
}: {
  link: LinkPreview | null;
  sourceUrl: string | null;
  slug: string | null;
  inBlock: BlockId | null;
  children: (facts: LinkFacts) => ReactElement;
}) {
  return children(useLinkFacts(link, sourceUrl, slug, inBlock));
}

/**
 * What a visitor's card knows: whatever the href itself says, and no more.
 *
 * `shelfKnown: false` is the literal truth — nobody asked — and it is also the
 * safe value, since it is what stops the Add button being drawn. A visitor is
 * already kept from it by `canAddToShelf`; this is the second lock on the same
 * door, and it costs a word.
 */
const NO_LINK_FACTS: LinkFacts = {
  loading: false,
  library: null,
  wiki: null,
  shelfKnown: false,
  /* And no server fetch on their behalf either — `/api/link-preview` is
     authenticated and article-scoped, so a visitor could not call it if the
     card tried. This is the same second lock on the same door. */
  page: null,
  /* And nothing bought on their behalf. `/api/link-summary` is behind the same
     gate and, unlike the fetch, spends money — so this is the second lock on a
     door that costs something to have opened. */
  summary: null,
};

/* ------------------------------------------------- add it to my shelf --- */

/**
 * **What the card may say and do about putting this link on the reader's own
 * shelf.**
 *
 * > It should show an Add to Spideryarn button, which would kick off ingestion
 * > of that article to my shelf. … I don't want to open in a new tab, because
 * > that's disruptive when I've added Spideryarn to my Homepage on iPad …
 * > Card shows progress is fine for now — eventually we'll want a richer
 * > per-article-queue progress bar for this and other per-article jobs.
 * >
 * > — Greg, 2026-09-05
 *
 * A union rather than a button plus a bag of optionals, because exactly one of
 * these is true at a time and every other combination is a card that cannot be
 * drawn: a spinner next to an enabled button, a refusal next to a running job.
 *
 * **Where the compiler actually helps is `describeAdd`**, whose two `switch`es
 * have no `default` — so a new `JobStatus` or a new `Asked` member stops the
 * build rather than falling through to whichever arm happened to be last.
 * `ExternalBody` draws each member with a `kind ===` test and is *not* checked
 * for exhaustiveness; a sixth member added here needs a line adding there, and
 * would otherwise simply draw nothing.
 */
type AddToShelf =
  /**
   * Nothing to offer, and the four reasons are all different: a visitor, a
   * link that does not leave the app, an article already on the shelf, or the
   * piece the reader is standing in.
   */
  | { kind: "none" }
  /**
   * There is something to press.
   *
   * `after` is the sentence explaining why this is a *second* attempt, or null
   * for the ordinary first one — the button says "try again" rather than "add
   * to Spideryarn" when it is set. One arm rather than two, because the two
   * differ only in what is printed above the same button doing the same thing.
   */
  | { kind: "offer"; add(): void; after: string | null }
  /** The POST is in flight, or the job it made is still going. */
  | { kind: "working"; line: string }
  /** It finished, and the shelf has not caught up. See `describeAdd`. */
  | { kind: "added" }
  /**
   * **The reader already had it**, so nothing was added and nothing spent:
   * the server answered a repeat paste with the article
   * (docs/plans/261007k-repeat-paste-is-free-and-says-so.md). The slug comes
   * from that answer, not from the shelf, because the shelf this card reads
   * does not find every article the server does (a paper by the link it was
   * asked for, an archived one) — waiting for it could wait for ever.
   */
  | { kind: "have"; slug: string }
  /**
   * **Somebody else has already made it public**, so nothing was added and
   * nothing spent: the reader chooses between reading that, free, and their own
   * copy, which `addOwn` asks for and which is the ordinary paid add.
   * docs/plans/261009j-a-public-copy-offered-at-import.md.
   */
  | { kind: "public"; slug: string; addOwn(): void }
  /**
   * It went wrong and **another press would not help**, so this arm has no
   * action in it at all. `message` is the server's own sentence and may be a
   * quota refusal, which is why it goes to `QuotaNotice` rather than into a
   * paragraph — a 402 needs the way out beside it, and that way out is a link
   * to a pricing page, never a button that spends the slot again.
   */
  | { kind: "refused"; message: string };

/** A visitor's card, and every card with nothing addable under the pointer. */
const NO_ADD_TO_SHELF: AddToShelf = { kind: "none" };

/**
 * **What this tab has already asked about a URL** — keyed by `urlKey`, and
 * module-level because the card is not a place to keep anything.
 *
 * The card is torn down when the pointer leaves *and* by the `MutationObserver`
 * in `useHoverCard` whenever the prose re-renders, so component state here has
 * the lifetime of a hover. Three things have to outlive that, and GPT Sol named
 * all three reviewing the plan on 2026-09-05 (finding P2-1):
 *
 *  - **An add that has been pressed and not yet answered.** Until `add()`
 *    resolves there is no job for the engine to know about, so a reader who
 *    presses, moves away and re-hovers would be shown a second enabled button.
 *    A second press is deduplicated by the queue, but it can still transiently
 *    reserve or be refused a slot (docs/project/billing.md).
 *  - **A refusal.** `lastFailure()` is a ref inside one `useJobs` subscriber
 *    (useJobs.ts § lastFailure), so a message kept only in the card is gone the
 *    instant the pointer moves — and a 402 the reader never got to read is a
 *    slot spent for nothing.
 *  - **Which job this URL became**, so a re-hover watches *that* job by id
 *    rather than guessing from the slug. AddPage.tsx § What it does with the URL
 *    is where that trap is written up.
 *
 * **`urlKey` rather than the exact address**, which is the one place this
 * deliberately differs from the plan review's wording. `urlKey` is what decides
 * whether two spellings are the same article — it is what the shelf is indexed
 * by, two files away — so two hrefs in one essay that differ only by `www.` or
 * a `?utm_source=` are one entry here, exactly as they are one article on the
 * shelf and one job in the queue. Keying by the raw href would put an enabled
 * button on the second spelling of an article already being added. The review's
 * own finding P1-2 draws the same line: `urlKey` for reader-facing equivalence,
 * an exact target only for what we ask the network for — and nothing here asks
 * the network for anything.
 *
 * Never pruned. It holds one small record per URL a reader actually pressed a
 * button on, and it dies with the tab.
 *
 * **In development it also dies on every edit to this file**, and that is worth
 * knowing before it wastes somebody's afternoon: exporting `describeAdd` — a
 * function rather than a component — makes React Fast Refresh give up on this
 * module (`hmr invalidate … "describeAdd" export is incompatible`), so vite
 * re-evaluates it and this map starts empty. An add pressed a moment ago then
 * looks un-pressed. It cost one inconclusive browser pass on 2026-09-05. The
 * export stays because the alternative is an untested five-arm state machine,
 * and `entryProse` in GlossaryPanel.tsx already makes the same trade; the fix
 * if it ever matters is to move the pure half into a `.ts` of its own.
 */
type Asked =
  | { kind: "sending"; wait: Promise<void> }
  | { kind: "queued"; jobId: string }
  | { kind: "have"; slug: string }
  | { kind: "public"; slug: string }
  /* The kind of POST is retained so a retry does not turn the reader's chosen
     own copy back into the public-copy question. */
  | { kind: "refused"; message: string; ownCopy?: true };

const asked = new Map<string, Asked>();

/**
 * Jobs whose completion has already been spent on a shelf refresh.
 *
 * Also module-level, and for the same reason as `asked`: the completion is
 * noticed by whichever card happens to be open when the job goes terminal — or,
 * more often, by the next one to open — and without this every subsequent hover
 * of that link would re-read `GET /api/library`.
 */
const refreshedFor = new Set<string>();
let askedGeneration = 0;
forgetOnReaderChange(() => {
  askedGeneration += 1;
  asked.clear();
  refreshedFor.clear();
});

/** The line while no step is running — before the first, and between two. */
const ADDING = "adding it to your shelf…";

/**
 * **The add control, and the component boundary that keeps it away from a
 * visitor.**
 *
 * A render prop for the same reason `WithLinkFacts` is one: the rule it
 * enforces is about *calling* `useJobs` at all, a hook cannot be skipped
 * conditionally inside one component, and the only conditional React has is
 * whether a component exists. And it earns the shape twice over here, because
 * what it hands down is drawn in two places — the progress line in the body of
 * the card, and the button in its foot.
 *
 * **Everything durable is read, never held.** The state below carries nothing
 * at all: `tick` exists only to re-render when the module map or the job engine
 * has moved on, which is `useLinkFacts`'s trick and for the same reason — an
 * answer derived during render cannot disagree with the URL the rest of the
 * card was drawn from.
 */
function WithAddToShelf({
  url,
  children,
}: {
  /** The address to add. Non-null: the caller decides whether there is one. */
  url: string;
  children: (add: AddToShelf) => ReactElement;
}) {
  /* Watches the queue even at rest, so a card left open on touch holds the idle
     poll. Quiet until an add is pending is deferred (Sol F3):
     docs/plans/260912a-ipad-battery-drain-the-reading-view-polls-the-job-queue-every-eight-seconds-at-rest.md
     § Deferred, named. */
  const queue = useJobs("watches-queue");
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const key = urlKey(url);
  const state = asked.get(key);

  /* Wake when the POST answers.

     **Keyed on the record itself, which is safe because every write to `asked`
     replaces the object rather than mutating it.** That is what makes a module
     map usable as an effect dependency at all: pressing the button stores a
     fresh `sending` record and bumps, so the next render sees a new identity
     and this arms; the record it settles into is a new identity again, so this
     tears down. A `tick` counter in the list here would only re-arm it on
     renders where nothing about the add had changed. */
  useEffect(() => {
    if (state?.kind !== "sending") return;
    let live = true;
    void state.wait.then(() => {
      if (live) bump();
    });
    return () => {
      live = false;
    };
  }, [state]);

  /* **By job id, out of the engine's own snapshot** — never by slug, and never
     from a completion callback. `useJobs`'s `onFinished` announces only jobs that
     finish while it is mounted, and this component's whole problem is that it
     usually is not: the reader presses, moves the pointer away, and the card is
     gone long before the ingest is. Reading the terminal status off the list
     replays that history on the next hover; a callback silently would not.
     GPT Sol, 2026-09-05, finding P2-1. */
  const job: Job | null =
    state?.kind === "queued" ? (queue.jobs.find((j) => j.id === state.jobId) ?? null) : null;

  /* **The loop that makes this feature compound.** link-facts.ts's shelf is
     read once per page load, so without this the card goes on offering to add
     an article the reader has just watched arrive, until they reload. Guarded
     by job id in a module set, so the refresh happens once however many cards
     see the same finished job. */
  const finished = job?.status === "done" ? job.id : null;
  useEffect(() => {
    if (finished === null || refreshedFor.has(finished)) return;
    /* Marked before, so two cards over the same finished job make one request —
       and **un-marked if it did not work**, which is the half that was missing.
       A refresh that failed is not a refresh that happened, and remembering it
       as one leaves the card on *added to your shelf* with nothing ever asking
       again. GPT Sol, 2026-09-05, P2-1. */
    refreshedFor.add(finished);
    /* No `bump` on the way back: `refreshShelf` wakes every `useLinkFacts`,
       and it is that hook — a descendant of this component — whose re-render
       turns "add to Spideryarn" into "read it here". */
    void refreshShelf().then((installed) => {
      if (!installed) refreshedFor.delete(finished);
    });
  }, [finished]);

  const add = (options?: { ownCopy?: true }) => {
    const generation = askedGeneration;
    const ownCopy = options?.ownCopy === true;
    const wait = (async () => {
      /* `options` is read for the one flag only: a plain press passes the click event here. */
      const started = await queue.add(url, ownCopy ? { ownCopy: true } : undefined);
      /* An answer made for the previous reader must not refill the cleared map. */
      if (generation !== askedGeneration) return;
      /* **Read straight after the await.** `error` on the queue is engine state
         that this action's own follow-up poll clears milliseconds later;
         `lastFailure()` is the durable one, and three surfaces got this wrong
         before it existed. useJobs.ts § lastFailure. */
      const why = started ? null : queue.lastFailure();
      if (started && "article" in started) asked.set(key, { kind: "have", slug: started.article });
      else if (started && "publicCopy" in started) asked.set(key, { kind: "public", slug: started.publicCopy.slug });
      else if (started) asked.set(key, { kind: "queued", jobId: started.id });
      else if (why) asked.set(key, { kind: "refused", message: why, ...(ownCopy ? { ownCopy: true as const } : {}) });
      /* Refused with nothing to say — which should not happen, since every
         refusal carries the server's sentence. Put the button back rather than
         leave a silent dead end. */
      else asked.delete(key);
    })();
    asked.set(key, { kind: "sending", wait });
    bump();
  };

  return children(describeAdd(state, job, add));
}

/**
 * What the card draws, given what we asked and where that got to.
 *
 * Split out and exported so it can be tested as arithmetic: this is a five-way
 * decision over two inputs that can disagree, and every wrong branch of it is a
 * card that lies about a metered action.
 */
export function describeAdd(
  state: Asked | undefined,
  job: Job | null,
  add: (options?: { ownCopy?: true }) => void,
): AddToShelf {
  if (!state) return { kind: "offer", add, after: null };
  switch (state.kind) {
    case "sending":
      return { kind: "working", line: ADDING };
    case "have":
      return { kind: "have", slug: state.slug };
    case "public":
      return { kind: "public", slug: state.slug, addOwn: () => add({ ownCopy: true }) };
    case "refused":
      /* **`worthRetrying` decides whether there is a button at all**, and it is
         the same question `AddArticle.tsx` asks of a failed job. A `[pay-free]`
         refusal says in its own words that the pricing page is the way forward;
         putting *try again* under that sentence invites the reader to spend the
         attempt the sentence has just told them will not work. src/messages.ts. */
      return worthRetrying(state.message)
        ? { kind: "offer", add: state.ownCopy ? () => add({ ownCopy: true }) : add, after: state.message }
        : { kind: "refused", message: state.message };
    case "queued":
      /* The POST has answered and the engine has not polled since — the common
         case, and it lasts about a second, because `useJobs` pokes the poller
         the moment an action returns.

         **It also covers a job that has left the list**, which the card cannot
         distinguish and therefore goes on calling "going" — retention is
         bounded, so a reader who neither hovers nor reloads between completion
         and the record ageing out keeps this line. Named rather than fixed:
         closing it properly needs a tab-level observer over the engine, and
         Greg's answer to this whole surface is that the durable home is the
         per-article queue that does not exist yet. GPT Sol, 2026-09-05, P2-2. */
      if (!job) return { kind: "working", line: ADDING };
      switch (job.status) {
        case "queued":
        case "running": {
          /* The pipeline's own present-tense label — "Fetching the page". A
             line and a spinner, deliberately: this is a hover card, not
             AddArticle.tsx's `JobCard`, so there is no Stop, no elapsed clock
             and nothing that needs re-rendering every second under a pointer.
             Greg asked for exactly this much, and named the richer per-article
             queue as the thing that comes later. */
          const step = job.steps.find((s) => s.status === "running");
          return { kind: "working", line: step?.label ?? ADDING };
        }
        case "done":
          /* Normally invisible: by the time this renders, the shelf refresh has
             usually landed and the caller has switched to `none` with "on your
             shelf" above it. What it covers is the case where it has not — a
             refresh still in flight or refused, or an ingest whose canonical URL
             keys differently from the href the author wrote. */
          return { kind: "added" };
        case "error":
          /* **The sentence, and no button** — even when the failure is one
             another go could fix. Retrying an ingest is `POST /api/jobs/:id/retry`,
             which keeps the slug and the steps that already succeeded; this card
             holds a URL, so the only thing it could press is a fresh `add`,
             which is a different and worse action wearing the same label. Retry
             lives on the job card that knows `jobWorthRetrying` and can call the
             right route (AddArticle.tsx). GPT Sol, 2026-09-05, P1-2. */
          return job.error
            ? { kind: "refused", message: job.error }
            : { kind: "offer", add, after: null };
        case "cancelled":
          /* You stopped it, which is not the same as not wanting it — and
             nothing failed, so there is no sentence to print. */
          return { kind: "offer", add, after: null };
      }
  }
}

/**
 * Where a link goes, as far as we can say without asking anybody.
 *
 * The three shapes are the three honest answers, and they are visibly different
 * so a reader learns to tell them apart at a glance:
 *
 *  - **An anchor into this article** — the one case where we can show the
 *    destination itself, because it is on this page. The target paragraph's
 *    own words, which is strictly better than any description of them.
 *  - **A link out** — the host, whether it leaves the publication, any
 *    scholarly id the path carries, and whether it is a file rather than a
 *    page, all read off the href (link-preview.ts) — plus, when somebody can
 *    tell us, a real title and first paragraph (link-facts.ts) — plus the full
 *    address, so the reader can judge it themselves.
 *  - **Something else** — `mailto:`, or an href we could not parse. Said
 *    plainly rather than dressed up as a page.
 *
 * **The asynchronous half is additive, never load-bearing.** The card is drawn
 * and complete from the href alone; a shelf match, a Wikipedia summary, what the
 * page says about itself, and — since 2026-09-05 — a model's line on how that
 * page stands to the piece being read are all sections that appear under it a
 * moment later. Nothing above waits, and a lookup that fails or finds nothing
 * leaves a card that was already worth reading. That is what lets those lookups
 * be allowed to be slow, and the last of them to be allowed to *stream*.
 *
 * One thing above *does* change, and it is deliberate rather than a wobble: a
 * real title replaces the path trail rather than sitting under it, so the guess
 * we read off the address disappears the moment somebody can tell us the
 * answer. Everything else only grows downwards.
 */
function LinkCard({
  link,
  anchor,
  href,
  facts,
  add,
  back,
  divided,
  onJump,
}: {
  link: LinkPreview;
  anchor: { blockId: BlockId; text: string } | null;
  href: string | null;
  /** What the two lookups found, and whether either is still outstanding. */
  facts: LinkFacts;
  /** Whether this reader may put it on their shelf, and where that has got to. */
  add: AddToShelf;
  /**
   * This anchor is a note's back-link — the same resolution pointing the other
   * way, and the one place "elsewhere in this article" is true and useless.
   *
   * A note cited thirteen times has thirteen of these, side by side and
   * identical apart from where they go, so saying **which passage** each one
   * leads to is what makes them thirteen rather than one.
   */
  back: boolean;
  /** A rule above it, because a term card is sitting on top. */
  divided: boolean;
  onJump(id: BlockId): void;
}) {
  const body = () => {
    if (link.kind === "anchor") {
      if (!anchor) return null;
      return (
        <>
          <p className="prose-card-label">
            {back ? <CornerUpLeft size={9} /> : <CornerDownRight size={9} />}
            {back ? "cited here" : "elsewhere in this article"}
          </p>
          {/* The destination's own words. Trimmed rather than summarised: a
              paragraph's first sentence is the author's, and a gist of it would
              be ours — and the reader can see the whole thing by following the
              link, which is one click away and already works. */}
          <p className="prose-card-text prose-card-quote"><Excerpt blockId={anchor.blockId} words={clip(anchor.text, 260)} /></p>
          <p className="prose-card-foot">
            <button
              type="button"
              className="prose-card-open"
              onClick={() => onJump(anchor.blockId)}
            >
              {back ? <CornerUpLeft size={10} /> : <CornerDownRight size={10} />}
              {back ? "back to the passage" : "go there"}
            </button>
          </p>
        </>
      );
    }

    if (link.kind === "other") {
      return (
        <>
          <p className="prose-card-label">{link.scheme ? `${link.scheme} link` : "link"}</p>
          <p className="prose-card-text prose-card-url">{link.url}</p>
        </>
      );
    }

    return <ExternalBody link={link} facts={facts} add={add} href={href} />;
  };

  const content = body();
  if (!content) return null;
  return <div className={`prose-card-body${divided ? " divided" : ""}`}>{content}</div>;
}

/**
 * **What the page says about itself**, fetched by our server once and cached for
 * everybody — the third source, and the only one that can answer for an
 * arbitrary destination. src/link-previews.ts, docs/project/links.md.
 *
 * Every line of it is the destination's own words, so it is labelled as theirs
 * in the same way Wikipedia's is: this is not a summary, and there is nothing
 * here that we wrote.
 *
 * **The description and the opening paragraph are not both drawn.** Where a page
 * has both they are usually the same sentences twice — an `og:description` is
 * very often the first line of the piece — and the opening is the better of the
 * two when it survived the sanity check (`saneParagraph` in
 * src/link-previews.ts), because it is prose the author wrote rather than a
 * field somebody's CMS filled in.
 *
 * Its own component rather than four more lines in `ExternalBody`, for the
 * reason that function's own comment gives about the complexity lint: the branch
 * had already become a card, and a fourth source in it would have been the same
 * signal a second time.
 */
function PageSaid({ page }: { page: PagePreview }) {
  const opening = page.firstParagraph ?? page.description;
  return (
    <div className="prose-card-part prose-card-part-page">
      <p className="prose-card-label">
        <Globe size={9} />
        {page.siteName ? clip(page.siteName, 40) : "from the page itself"}
      </p>
      {page.title && <p className="prose-card-title">{clip(page.title, 120)}</p>}
      {opening && <p className="prose-card-text">{clip(opening, 260)}</p>}
      {page.words !== undefined && (
        <p className="prose-card-meta">
          {page.words.toLocaleString()} words · ~{readingMinutes(page.words)} min
        </p>
      )}
    </div>
  );
}

/**
 * **How the destination stands to the piece in your hands** — the one part of
 * this card that we wrote, and the only one that costs money.
 *
 * Every other section is quoted: the shelf's own gist, Wikipedia's lead
 * paragraph, the page's own `og:description`. This one is a model's answer, so
 * it is labelled differently — *"in relation to what you're reading"* rather
 * than a source's name — because a reader is owed the difference between a page
 * saying something about itself and us saying something about it.
 *
 * **It streams, and the cursor is why the flag exists.** A paragraph that has
 * stopped growing and a paragraph still arriving look identical, and the second
 * one ending mid-sentence is a stream that broke rather than a summary that
 * chose to stop. `LinkFacts.summary` carries `streaming` for exactly this.
 *
 * There is deliberately **no spinner before the first token**. The card is
 * already useful and already complete-looking by then, and an empty section with
 * a heading reads as a lookup that broke — `readSummary`'s rule, one source up.
 * What the reader sees is nothing, and then a paragraph appearing.
 */
function LinkRelation({ summary }: { summary: { text: string; streaming: boolean } }) {
  return (
    <div className="prose-card-part prose-card-part-relation">
      <p className="prose-card-label">
        <Sparkles size={9} />
        in relation to what you're reading
      </p>
      <p className="prose-card-text">
        {/* **Clipped, and the number is a bound on the card rather than an
            editorial view.** `.tooltip` has a width cap and no height cap, so an
            answer that ran long would make a card taller than a phone with
            nothing to scroll. Nine hundred characters is about a hundred and
            fifty words against a prompt that asks for under a hundred, so it
            should never bite — and if it starts biting, the prompt is what to
            look at. The other sections clip at 220–260 for a different reason:
            they are somebody else's blurb, and this is the section the reader is
            here for. */}
        {clip(summary.text, 900)}
        {summary.streaming && <span className="prose-card-caret" aria-hidden="true" />}
      </p>
    </div>
  );
}

/**
 * A link out — the commonest case, and the only one with more than one source.
 *
 * Its own component rather than a branch of `LinkCard`, because it is the half
 * that grew: the href facts, then the shelf match, then Wikipedia, then the
 * address itself. Four sources in one arrow function tripped the complexity
 * lint at 30, which was the honest signal that the branch had become a card.
 *
 * The order is the order a reader needs them in. Where it goes; what it is
 * called, once anyone can say; what the address literally is, for the reader
 * who wants to judge it rather than take our reading of it; and then the ways
 * out.
 */
function ExternalBody({
  link,
  facts,
  add,
  href,
}: {
  link: ExternalPreview;
  facts: LinkFacts;
  add: AddToShelf;
  href: string | null;
}) {
  const { library, wiki, loading, shelfKnown, page, summary } = facts;
  /**
   * **Nothing to add when we already have it — or when we cannot yet say.**
   *
   * `library !== null` is the easy half: an article on the shelf, which the
   * foot already offers to open. It is also what keeps the foot to two controls
   * at most, since "read it here" and "add to Spideryarn" are mutually
   * exclusive by construction and the three-control wrap this was expected to
   * need never arises (GPT Sol, P2-4).
   *
   * `!shelfKnown` is the half that had to be added: `library` is null while the
   * shelf is still loading and again if the request failed, so a card drawn in
   * either state would offer to add an article the reader already owns — and
   * pressing it spends a metered slot. **Under uncertainty about a metered
   * action, offer nothing**, which costs at most a few hundred milliseconds on
   * the first hover of a session. GPT Sol, P1-1.
   */
  const adding: AddToShelf = library !== null || !shelfKnown ? NO_ADD_TO_SHELF : add;
  /**
   * **What the destination itself said, but only when nobody better placed
   * already answered.**
   *
   * The three sources overlap and their order is a ranking rather than a
   * layout: an article on the reader's own shelf has a title, our gist and a
   * real length, and Wikipedia's summary is a lead paragraph written by people.
   * Both beat `og:description`. `link-facts.ts` already declines to *ask* in
   * those two cases, and this is the same rule applied to drawing — because the
   * shelf can arrive after the answer did, and a card is not a place to show
   * two descriptions of one page and let the reader pick.
   */
  const said = library === null && wiki === null ? page : null;
  /* A real title supersedes the path trail rather than joining it. The trail is
     a guess read off an address; a title is a title, and printing both would
     show the reader our working next to the answer. */
  const titled = library !== null || wiki !== null || said?.title !== undefined;

  return (
    <>
      <p className="prose-card-label">
        <Globe size={9} />
        {/* Null is "we cannot tell" — an uploaded PDF has no source host —
            and it prints nothing rather than guessing one of the two. */}
        {link.sameSite === true
          ? "elsewhere on this site"
          : link.sameSite === false
            ? "leaves this site"
            : "goes to"}
      </p>
      <p className="prose-card-host">
        {link.host}
        {link.file && <span className="prose-card-file">{link.file}</span>}
      </p>
      {/* `arXiv 2212.13345`. The one thing the path carries that is worth
          keeping even though it is not words — see `Citation`. */}
      {link.citation && (
        <p className="prose-card-cite">
          <span className="prose-card-cite-label">{link.citation.label}</span>
          {link.citation.id}
        </p>
      )}
      {!titled && link.trail.length > 0 && (
        <p className="prose-card-text prose-card-trail">{link.trail.join(" › ")}</p>
      )}

      {/* We already read this one. Stage 2 ran Readability over that page at
          ingest, so the title, the first-sentence gist and the length are a
          lookup rather than a fetch — the richest thing any source here can
          produce, and the cheapest. link-facts.ts. */}
      {library && (
        <div className="prose-card-part prose-card-part-shelf">
          <p className="prose-card-label">
            <BookOpen size={9} />
            {library.self ? "this is the piece you are reading" : "on your shelf"}
          </p>
          <p className="prose-card-title">
            <span className={voiceClass(articleTitleVoice(Boolean(library.entry.titleOverridden)))}>
              {library.entry.title}
            </span>
          </p>
          {/* The model's gist or the article's excerpt, on a span because
              `.prose-card-text` sets the app's face (voice.ts § `gistVoice`). */}
          {library.entry.gist && (
            <p className="prose-card-text">
              <span className={voiceClass(gistVoice(library.entry))}>
                {clip(library.entry.gist, 220)}
              </span>
            </p>
          )}
          <p className="prose-card-meta">
            {library.entry.words.toLocaleString()} words · ~{library.entry.minutes} min
          </p>
        </div>
      )}

      {/* Wikipedia's own summary, which is a real lead paragraph written by
          people rather than a gist written by us — so it is quoted as theirs,
          under a label saying whose it is. */}
      {wiki && (
        <div className="prose-card-part prose-card-part-wiki">
          <p className="prose-card-label">
            <BookMarked size={9} />
            from wikipedia
          </p>
          <p className="prose-card-title">{wiki.title}</p>
          {wiki.description && <p className="prose-card-meta">{wiki.description}</p>}
          <p className="prose-card-text">{clip(wiki.extract, 260)}</p>
        </div>
      )}

      {/* **What the page says about itself**, fetched by our server once and
          cached for everybody — the third source, and the only one that can
          answer for an arbitrary destination. Every line of it is the
          destination's own words, so it is labelled as theirs in the same way
          Wikipedia's is; this is not a summary and there is nothing here we
          wrote. src/link-previews.ts, docs/project/links.md.

          The description and the opening paragraph are not both drawn. Where a
          page has both they are usually the same sentences twice — an
          `og:description` is very often the first line of the piece — and the
          opening is the better of the two when it survived the sanity check
          (`saneParagraph`), because it is prose the author wrote rather than a
          field somebody's CMS filled in. */}
      {said && <PageSaid page={said} />}

      {/* **And what it has to do with the piece in your hands** — the only
          section here that we wrote, streamed in under the destination's own
          words once they have landed. It comes last on purpose: the reader
          should meet what the page says about itself before they meet what a
          model says about it, so the quoted half is never framed by ours.
          src/link-summary.ts, docs/project/links.md. */}
      {summary && <LinkRelation summary={summary} />}

      {/* Only while something is genuinely outstanding, and only when there is
          nothing yet to show — a spinner *under* an answer that has already
          arrived reads as the answer being incomplete. The card is drawn and
          useful before this resolves, which is the whole reason it can be
          allowed to be slow. */}
      {loading && !titled && (
        <p className="prose-card-text prose-card-waiting">
          <LoaderCircle className="cmt-spinner" size={11} />
          looking it up…
        </p>
      )}

      {/* **What the reader asked for, and where it has got to** — a line, in
          the same shape as the lookup's own. It sits here rather than in the
          foot because it is news about this link, like the sections above it,
          and because the foot is two controls and a rule rather than a place
          things happen.

          Unlike the spinner above, this one is drawn *whatever else is on the
          card*: the reader pressed a button and is owed an answer, where a
          lookup nobody asked for is not worth a line under an answer that has
          already arrived. */}
      {adding.kind === "working" && (
        <p className="prose-card-text prose-card-waiting">
          <LoaderCircle className="cmt-spinner" size={11} />
          {adding.line}
        </p>
      )}
      {adding.kind === "added" && (
        <p className="prose-card-text prose-card-waiting">
          <BookCheck size={11} />
          added to your shelf
        </p>
      )}
      {adding.kind === "have" && (
        <p className="prose-card-text prose-card-waiting">
          <BookCheck size={11} />
          {REPEAT_PASTE_ON_THE_CARD}
        </p>
      )}
      {adding.kind === "public" && (
        <p className="prose-card-text prose-card-waiting">
          <BookCheck size={11} />
          {PUBLIC_COPY_ON_THE_CARD}
        </p>
      )}
      {/* **Why it did not go through** — the refusal that ends it, and the one
          the reader may press past, drawn identically because they read
          identically to whoever is looking.

          A 402 has three shapes and three different places to send somebody,
          and `QuotaNotice` is the one component that knows which; everything
          else it is handed renders as the plain sentence it already was. A
          generic "couldn't add it" here would be a slot spent and no way to
          spend the next one. QuotaNotice.tsx. */}
      <QuotaNotice
        message={
          adding.kind === "refused" ? adding.message : adding.kind === "offer" ? adding.after : null
        }
        className="prose-card-text prose-card-refused"
      />

      {/* The address itself. Everything above is us deciding what matters about
          this URL, and a reader who wants to judge it for themselves — a paywall
          they recognise, a tracking parameter, a host they do not trust — needs
          the thing rather than our reading of it.

          **Three lines is a cap on what is drawn, not a truncation**, and the
          difference needed making real: the part a clamp hides is the *tail*,
          which is exactly where a tracking payload lives, and a card that showed
          the harmless half of a URL and cut the interesting half would be worse
          than one that showed none of it. So the whole string is in the DOM,
          selectable, and on `title`. Raised by a GPT Sol review, 2026-08-27. */}
      <p className="prose-card-text prose-card-url" title={link.url}>
        {link.url}
      </p>

      <p className="prose-card-foot">
        {/* `noreferrer` as well as `noopener`: the article's own URL is a
            reading history, and a link the article supplied should not be
            handed ours as a referrer. Same rule the glossary's link follows. */}
        <a
          className="prose-card-link"
          href={href ?? link.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {link.file ? <FileText size={10} /> : <ExternalLink size={10} />}
          open in a new tab
        </a>
        {/* Not offered for a link back to this article: "read it here" would
            take the reader to the page they are already on, which is the one
            button that can only disappoint. */}
        {library && !library.self && (
          /* `Link`, not a bare `<a>`: this one goes to a page of ours, and a
             full reload to reach it would throw away the article the reader is
             halfway through for no reason. Same component the shelf's cards use. */
          <Link className="prose-card-open" href={readHref(library.entry.slug)}>
            <BookOpen size={10} />
            read it here
          </Link>
        )}
        {/* **The other way in, for a page we have not got.** The same
            `POST /api/jobs { url }` the shelf's own Add box sends, so slot
            admission, deduplication and the 402 all arrive here without being
            re-implemented — and the reader never leaves the piece they are in
            the middle of, which is Greg's whole reason for not opening a tab.

            Never beside "read it here": `adding` is `none` whenever the library
            found something, so the foot is at most this and "open in a new
            tab".

            **And there is no button under a refusal that says another go will
            not help.** `describeAdd` has already asked `worthRetrying`, so the
            only refusal that reaches `offer` is one worth pressing — a reader
            at their quota gets the sentence and the link to the page that
            answers it, and nothing to spend the next attempt on. */}
        {/* The repeat's own way there: `library` did not find it, or this
            arm would be `none`, so the link above is not drawn. */}
        {adding.kind === "have" && (
          <Link className="prose-card-open" href={readHref(adding.slug)}>
            <BookOpen size={10} />
            read it here
          </Link>
        )}
        {/* Somebody else's public copy: theirs to read free, or your own. */}
        {adding.kind === "public" && (
          <>
            <Link className="prose-card-open" href={readHref(adding.slug)}>
              <BookOpen size={10} />
              {PUBLIC_COPY_READ_ON_THE_CARD}
            </Link>
            <button type="button" className="prose-card-open" onClick={adding.addOwn}>
              <Plus size={10} />
              {PUBLIC_COPY_OWN_ON_THE_CARD}
            </button>
          </>
        )}
        {adding.kind === "offer" && (
          <button type="button" className="prose-card-open" onClick={adding.add}>
            <Plus size={10} />
            {adding.after === null ? "add to Spideryarn" : "try again"}
          </button>
        )}
      </p>
    </>
  );
}

/**
 * ***Open in <Mode>*: every card on a mark a mode made ends with this.**
 * Report `spya-zux9w6`, Greg, 2026-10-09: *"Anything else that's an annotation
 * on the text should … have a tooltip, and there should be a way to take you
 * to its mode."* One control, so the glossary's, the citation's and the
 * quote's ways in look and read alike (controls.md § Controls that do the same
 * job look the same): the mode's own Dock icon and name, pushed right.
 *
 * What the press does is the caller's — open the mode and bring the item's row
 * into view, selecting it where the mode has a selection. It is drawn in its
 * own mode too, where the same press re-lands the row. The survey of which
 * marks have a card at all is docs/project/tooltips.md § Every card on a
 * mode's mark has a way into its mode; plan 261010d.
 */
export function OpenInMode({ mode, onPress }: { mode: Mode; onPress(): void }) {
  const Icon = MODE_ICON[mode];
  return (
    <button type="button" className="prose-card-open" onClick={onPress}>
      <Icon size={10} aria-hidden="true" />
      Open in {MODE_LABEL[mode]}
    </button>
  );
}

/**
 * **What the card knows about the quotes**: the list the prose fills, and
 * what pressing does. Built by `Reader` through `quoteCardQuotes`, so the card
 * walks those marks in document order even when the band is sorted another
 * way.
 * docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md § 2.
 */
export interface QuoteCardSource {
  /** The quotes filled in the prose, in document order. */
  listed: readonly Quote[];
  /** The same quotes by their mark key (`quoteMarkKey`), which is what `data-hit` holds. */
  byKey: ReadonlyMap<string, Quote>;
  /**
   * When the list was last written — the *on or before* bound for a quote with
   * no `addedAt` of its own (`aiProvenance`). An owner's artefact and a
   * visitor's public list both carry it; optional for a surface that has none.
   */
  generatedAt?: string | undefined;
  /** Write `?quote=` for Quotes mode and go to the quote's block. */
  onGo(quote: Quote): void;
  /** Reveal and select it, then open Quotes mode on its row. */
  onOpenInQuotes(quote: Quote): void;
}

/**
 * **What a quote is, in the card's first line.** Each claim is one the code
 * keeps: *a passage*, not a line (src/quotes.ts § `SYSTEM`); *the AI picked
 * out*, since only a model's quote reaches this card and a reader's own
 * highlight is another mark; *the article's own words*, never "the author's"
 * (mode-catalog.ts § quotes says why that cannot be claimed).
 */
export const QUOTE_CARD_SAYS = "A passage the AI picked out as worth keeping, in the article’s own words.";

/**
 * **What the strength of the purple means**, said only on a quote that has a
 * score: beside *Not scored.* it would be a sentence about some other quote.
 * `quoteTier` and `quoteAlpha` both read `priorityOf`, the higher of the
 * scores the card prints below. True in this direction only: the fade has a
 * floor, so two low scores can draw alike.
 */
export const QUOTE_CARD_PURPLE = "Stronger purple means a higher Importance or Striking score.";

/**
 * **A quote, from the fill the reader is pointing at** — Greg, 2026-09-11
 * (spya-mtyquy): *"tooltip to show our quantitative scores and perhaps
 * Previous/Next icon-buttons to jump to the next Quote, and a button to open
 * Quotes mode"*. That button is `OpenInMode`, as on every card here.
 *
 * - **The numbers, printed as well as drawn**: this card is where the band's
 *   rows send them ("the numbers are in the tooltip", quotes.md). Each raw
 *   score the quote has, never the `max` composite, which is our arithmetic
 *   rather than the model's judgment.
 * - **Why**, the reason the band keeps behind its ⓘ (Greg, 2026-08-31: *"with
 *   reason as a tooltip"*) — the model's words, so in the model's face.
 * - **‹ ›** step the filled quotes down the page, whatever order the band is
 *   using. Disabled at either end; the card closes on a step, and the reader
 *   points at the next.
 * - **Who chose it, and when**, last and in the app's face — the line the
 *   band's ⓘ ends with too (`aiProvenance`). Greg, 2026-10-03 (spya-ma5h9b):
 *   *"quotes should as well, maybe saying when it was applied and whether it's
 *   AI generated or human highlights."*
 */
function QuoteCard({
  quote,
  source,
  onClose,
}: {
  quote: Quote;
  source: QuoteCardSource;
  onClose(): void;
}) {
  const at = source.listed.findIndex((q) => q.id === quote.id);
  const prev = at > 0 ? source.listed[at - 1] : undefined;
  const next = at >= 0 ? source.listed[at + 1] : undefined;
  const scores = [
    ...(quote.importance !== undefined ? [{ key: "importance" as const, value: quote.importance }] : []),
    ...(quote.striking !== undefined ? [{ key: "striking" as const, value: quote.striking }] : []),
  ];
  const go = (q: Quote) => {
    onClose();
    source.onGo(q);
  };
  return (
    <div className="prose-card-body prose-card-quote-card">
      <p className="prose-card-label">
        <QuoteIcon size={9} />
        quote
        {at >= 0 && (
          <span className="prose-card-quote-at">
            {at + 1} of {source.listed.length}
          </span>
        )}
      </p>
      {/* **What a quote is**, first, because the fills are in the prose in
          every mode and this card is where a reader who has never opened
          Quotes meets one. Greg, 2026-10-06 (spya-tpmde9): *"so readers know
          what they are"*. From the viewer's side, so it is true for a visitor
          too. docs/plans/261006j-the-card-on-a-quote-in-the-prose-says-what-a-quote-is.md. */}
      <p className="prose-card-meta prose-card-quote-what">
        {scores.length > 0 ? `${QUOTE_CARD_SAYS} ${QUOTE_CARD_PURPLE}` : QUOTE_CARD_SAYS}{" "}
        <Link
          className="prose-card-quote-help"
          href={helpHref(modeAnchor("quotes"))}
          onClick={(event) => {
            /* `Link` leaves a modified click to the browser so it can open Help
               elsewhere. Close only when this tab is actually following it. */
            if (event.defaultPrevented || event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            onClose();
          }}
        >
          More in Help →
        </Link>
      </p>
      {scores.length > 0 ? (
        <dl className="prose-card-scores">
          {scores.map((s) => (
            <div key={s.key} className="prose-card-score" title={QUOTE_SCORE_LABEL[s.key]}>
              <dt>{s.key === "importance" ? "Importance" : "Striking"}</dt>
              <dd>
                <span className="score-bar" aria-hidden="true">
                  <span
                    className={`score-bar-fill ${s.key}`}
                    style={{ width: `${Math.round(Math.max(0, Math.min(1, s.value)) * 100)}%` }}
                  />
                </span>
                <span className="prose-card-score-n">{s.value.toFixed(2)}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="prose-card-meta">Not scored.</p>
      )}
      {quote.reason && (
        <p className="prose-card-text">
          <span className={voiceClass("ai")}>{quote.reason}</span>
        </p>
      )}
      <p className="prose-card-meta prose-card-quote-prov">{aiProvenance(quote, source.generatedAt)}</p>
      <p className="prose-card-foot prose-card-quote-foot">
        <button
          type="button"
          className="prose-card-open prose-card-quote-step"
          aria-label="Previous quote"
          disabled={!prev}
          onClick={() => prev && go(prev)}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          className="prose-card-open prose-card-quote-step"
          aria-label="Next quote"
          disabled={!next}
          onClick={() => next && go(next)}
        >
          <ChevronRight size={14} />
        </button>
        {/* Drawn in Quotes mode too since plan 261010d: the press selects the
            quote, and Quotes brings a selected row into view. */}
        <OpenInMode
          mode="quotes"
          onPress={() => {
            onClose();
            source.onOpenInQuotes(quote);
          }}
        />
      </p>
    </div>
  );
}

/**
 * **A footnote, whole, where the reader is standing.**
 *
 * This is the card the footnote feature is for. A jump to the notes recentres
 * all three panels on "Notes" and takes the reader's place in the argument out
 * of every column; the plan's answer to that is not cleverness in the panels but
 * "make the hover preview good enough that most visits never jump at all"
 * (docs/plans/260828o-footnotes.md § The fisheye). So: the note's full text, over the
 * note's whole *range* of blocks, with its own hyperlinks live.
 *
 * Three things it does not do, each of them deliberate:
 *
 *  - **It does not clip.** A long note scrolls inside the card. Cutting a note
 *    at 260 characters and saying nothing is how a preview lies about the thing
 *    it is previewing, and the whole reason a reader trusts it enough to stay.
 *  - **It does not inject the stored html as-is.** That would put duplicate
 *    block ids in the document — see notes-view.ts § Why the preview is rebuilt.
 *  - **It does not leave its links to `TableView`.** The card is in a portal, so
 *    the delegated handler that turns an in-article fragment into a recorded
 *    jump never sees them, and they would navigate the page out from under the
 *    reader. Hence the handler below, which is that handler's rules in one
 *    place: modified clicks and `target` are the browser's, an in-article
 *    fragment is a jump, and anything else is left alone.
 */
function NoteCard({
  note,
  divided,
  onGo,
  onJump,
}: {
  note: NoteMarker;
  divided: boolean;
  /** Go to the note itself, remembering where we came from. */
  onGo(): void;
  /** Follow a link the note itself makes into the article. */
  onJump(id: BlockId): void;
}) {
  /* Rebuilt when the note changes and not on every render of the card: an
     external lookup finishing, or the pointer moving inside the panel, must not
     re-parse a note's html. */
  const html = useMemo(() => notePreviewHtml(note.note, document), [note.note]);
  const places = note.note.citedBy.length;

  return (
    <div className={`prose-card-body${divided ? " divided" : ""}`}>
      <p className="prose-card-label">
        <Asterisk size={9} />
        {note.label ? `note ${note.label}` : "note"}
      </p>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the click handled is always
          on a real <a> inside the note — Enter on a focused link fires a click that
          lands here — and this is standing in for TableView's delegated handler,
          which cannot reach into a portal. */}
      <div
        className="note-preview"
        onClick={(e) => {
          // A modified click is the reader asking for a new tab, and the href is
          // a real fragment: leaving it to the browser is the right answer.
          if (e.defaultPrevented || e.button !== 0) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          const link = (e.target as Element).closest?.("a[href]");
          if (!link) return;
          const to = link.getAttribute("target")?.toLowerCase();
          if (to && to !== "_self") return;
          const blockId = internalTarget(link, document);
          if (!blockId) return; // a link out to the web — the browser's job
          e.preventDefault();
          onJump(blockId);
        }}
        /* The article's own stored html, sanitised at ingest, with every id
           stripped out of the copy — notes-view.ts. Unsuppressed, like the
           prose column's own (TableView.tsx): the rule is right in general and
           the two places it is wrong are both this one fact. */
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <p className="prose-card-foot">
        {/* What the preview cannot show, because it strips them: the note's
            back-links, which are one per place it is cited. Saying how many
            there are is what tells a reader this note is load-bearing before
            they go anywhere. */}
        {places > 1 && <span className="prose-card-meta">cited in {places} passages</span>}
        <button type="button" className="prose-card-open" onClick={onGo}>
          <CornerDownRight size={10} />
          go to the note
        </button>
      </p>
    </div>
  );
}

/** Enough of a paragraph to recognise it, cut at a word. */
function clip(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

/**
 * One entry, as the hover card shows it.
 *
 * The same shape the open row in the panel has, and deliberately so — the two
 * are the same entry and a reader who has seen one should recognise the other.
 * `entryProse` is the shared rule about which fields to show and under which
 * label, so the provenance story ("in this piece" is the article, "background"
 * is the model) cannot come out differently in the two places.
 *
 * What it leaves out is the panel's *machinery*: the difficulty and centrality
 * scores, which belong to sorting a list, and the "check the web" button, which
 * spends money and therefore wants a deliberate press rather than a hover.
 * An answer that has *already* been fetched is shown, because by then it is
 * simply part of the entry.
 */
/**
 * **One work the piece cites**, as a section of the card — SPIDERYARN-READING2-3M.
 *
 * Fable's brief for it, 2026-09-16, and the ordering is its answer to *what does
 * a reader hovering a citation actually want*: what this is, and can I get it.
 * So the title and its link come first, then who wrote it and when, then `why` —
 * the one line here that is ours rather than the author's, and the reason this
 * is augmentation rather than a prettier bibliography.
 *
 * ## The provenance is `sourceOf`, not a second opinion
 *
 * The band's own function, imported rather than reimplemented, and that is the
 * whole point. Citations mode has one safety property — **every address a row
 * presents as the work's own was in the article, and code found it** — and it is
 * kept by drawing a `search` row *as a search*: the title is not a link, and the
 * one link says so. A card that quietly drew the Scholar query as the work's
 * address would teach a reader the opposite of what the band teaches them, from
 * the same data, two panels apart. `sourceOf` is total over `linkFrom`, so there
 * is no fifth case for this file to get wrong.
 * docs/project/citations.md § The one safety property.
 *
 * ## What is deliberately not here
 *
 * - **The two score bars.** Glossary parity: the card says what a thing means,
 *   the band says what we scored it. A relevance bar in a hover panel is a
 *   number with nothing to compare it against.
 * - **A kept *Dig deeper* answer.** The verdict's short version is here
 *   (`CiteCardReading`); the long reading stays on the row, which has the room.
 * - **A selected row in Citations mode.** There is no `?cite=`. What the card
 *   has instead, since plan 261010d, is *Open in Sources*, which opens
 *   Bibliography and brings the work's row into view — a one-shot focus
 *   (item-focus.ts), not a selection.
 *
 * ## And one thing that was not here until 2026-10-04: a button
 *
 * This list used to say a card that opens because a pointer rested somewhere is
 * the wrong place for a press that spends money. Greg asked for one by name
 * (report `spya-c2qmbg`), the glossary's card had the same button since
 * 261002c, and the press is a deliberate one on a labelled button, not the
 * hover. It was *Dig deeper*, which started the row's own dig and opened
 * Citations on that row, until 2026-10-09; since plan 261009k it is *Ask in
 * chat*, the band's own sender: `CiteActions`.
 *
 * ## And a count instead of more marks
 *
 * `mentions` is capped at three; `citedAt` is not. So past three we know only
 * *which paragraph*, and marking a whole paragraph to mean "something in here
 * cites something" is the vague version of the question the mark exists to
 * answer. The honest close is words — *cited in 7 paragraphs* — which is Fable's
 * call and costs nothing. Since 2026-10-09 each of those paragraphs is also a
 * numbered jump beside the count (`CitedAtJumps`, plan 261009e), so the card on
 * a reference entry leads back to where the work is cited.
 */
function CiteCard({
  work,
  showInSpideryarn,
  onAsk,
  onOpen,
  here,
  onJump,
  onClose,
}: {
  work: CitedWork;
  showInSpideryarn: boolean;
  /** `null` for a visitor: no Ask in chat. */
  onAsk: ((work: CitedWork) => void) | null;
  /** *Open in Sources*, closing the card first; `null` draws no button. */
  onOpen: (() => void) | null;
  /** The block the card was opened from, which is not a jump (plan 261009e). */
  here: BlockId | null;
  /** Go to one of the passages that cite the work. The caller closes the card. */
  onJump(id: BlockId): void;
  onClose(): void;
}) {
  const source = sourceOf(work);
  const by = byLineOf(work);
  const line = workByLine(work);

  return (
    /* No `divided` prop, unlike `LinkCard` and `NoteCard`: the rule between
       sections is `.prose-card-body + .prose-card-body` in prose-hover-card.css,
       which fires for any sibling and needs nothing passed. `TermCard` above
       relies on the same thing, and copying its two-spellings-of-one-rule
       neighbours would have been a second way to say what the stylesheet
       already says. */
    <div className="prose-card-body">
      <p className="prose-card-head prose-card-cite-title">
        {source.kind === "address" ? (
          /* `noreferrer` as well as `noopener`, as everywhere outbound here: the
             article's own URL is a reading history. The scheme was settled
             server-side — `linkFor` in src/citations.ts builds every one of
             these from an identifier or an anchor the article itself carried. */
          <a
            className="prose-card-name"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {work.title}
            <ExternalLink size={10} />
          </a>
        ) : (
          /* **Not a link, and that is the safety property in one line.** Where
             the article gave no address, `source.url` is a Google Scholar query
             — so a link on the title would be this card saying *here is the
             work* about a search we built. The search is offered in the foot,
             drawn as a search. */
          <span className="prose-card-name">{work.title}</span>
        )}
      </p>
      {by && (
        <p className="prose-card-text prose-card-cite-by">
          {by}
          {/* Where the registry filled in what the article does not give: said
              on the card itself, with the sentence on hover (plan 261001a stage 5). */}
          {line.filled && <span title={registryFilledNote(line.filled)}> · {registryFilledMark(line.filled)}</span>}
        </p>
      )}
      {line.conflict && <p className="prose-card-cite-read">{registryConflictNote(line.conflict)}</p>}
      {/* Already an article here — the band's line, from the band's component
          (plan 261001i). Owner-only, and gated by name as well as by the
          data: the public DTO has no such field. */}
      {showInSpideryarn && work.inSpideryarn && <InSpideryarn match={work.inSpideryarn} />}
      {/* The entry as the article gives it — journal, conference, volume
          (SPIDERYARN-READING2-6K, plan 260930i). Here in full rather than in a
          tooltip: a card is what a finger gets, and it has the room. */}
      {work.entry && (
        <div className="prose-card-part prose-card-cite-entry">
          <p className="prose-card-text cite-entry">{work.entry}</p>
          <p className="prose-card-cite-read">{CITE_ENTRY_NOTE}</p>
        </div>
      )}

      <div className="prose-card-part prose-card-part-why">
        {/* `why` only beside the verdict that was checked against it
            (CitationsPanel.tsx § showsWhy, plan 261003j). The lookup alone:
            this card draws no *Dig deeper* answer. */}
        {showsWhy({ lookup: work.lookup }) && (
          <>
            <p className="prose-card-label">{CITE_WHY_LABEL}</p>
            <p className="prose-card-text">{work.why}</p>
          </>
        )}
        {/* The band's line, from the band's function: what we have read of
            the work. CitationsPanel.tsx § what we have and have not read. */}
        <p className="prose-card-cite-read">{readNoteOf(work)}</p>
      </div>
      <CiteCardReading work={work} />
      {work.citedInBody && (
        <CitedAtJumps
          citedAt={work.citedAt}
          atLeast={work.mentions.length >= MAX_MENTIONS}
          here={here}
          onJump={onJump}
        />
      )}

      <p className="prose-card-foot prose-card-foot-wraps prose-card-cite-foot">
        {source.kind === "address" ? (
          <span className="prose-card-cite-source">
            {source.host} · {source.how}
          </span>
        ) : (
          <a
            className="prose-card-link"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title="The article gives no link for this work, so this is a Google Scholar search for its title — not a link the article gave"
          >
            <Search size={10} />
            search Scholar
          </a>
        )}
        {/* A bibliography-only work is not "cited in 0 paragraphs": the band
            already has the honest phrase for that first-class state. Where it
            is cited, the count and a jump to each place are their own line
            above (`CitedAtJumps`). */}
        {!work.citedInBody && <span className="prose-card-cite-where">only in the references</span>}
        {/* The owner's verbs, last and pushed right as one group, the term
            card's shape: *Ask in chat*, where *Dig deeper* was until
            2026-10-09 (plan 261009k), then the way into the mode. Ask is the
            band's own sender, so the chat records the same origin as a press
            on the row would. The card closes on either press. */}
        {(onAsk || onOpen) && (
        <span className="prose-card-acts">
        {onAsk && (
          <button
            type="button"
            className="prose-card-act prose-card-cite-ask"
            aria-label={ASK_WORK_IN_CHAT}
            title={`${ASK_WORK_IN_CHAT}. ${ASK_IN_CHAT_SAYS}`}
            onClick={() => {
              onAsk(work);
              onClose();
            }}
          >
            <MessagesSquare size={10} aria-hidden="true" />
            {ASK_IN_CHAT}
          </button>
        )}
        {onOpen && <OpenInMode mode="sources" onPress={onOpen} />}
        </span>
        )}
      </p>
    </div>
  );
}

/** Past this many the row ends in *and N more*; the count before it stays exact. */
export const CITED_AT_JUMPS_SHOWN = 20;

/**
 * **Every passage that cites the work, one jump each** — Greg, 2026-10-09
 * (report `spya-tsd470`): *"I often want to be able to jump back from the list
 * of references to the places where it's cited."* The reference entry was
 * already marked, and already opened this card; until then the card could only
 * say how many paragraphs cite the work.
 *
 * Numbers rather than words, in document order, because `citedAt` holds the
 * known citing blocks while `mentions` (the citing words) stops at three: a row
 * mixing three phrases with seventeen bare paragraphs would say less than a
 * row of positions. Each is a `BlockRef`, so its own card names the section and
 * the paragraph before the reader commits. The jump is aimed at the work's
 * marks (`citePassageKey`), so it flashes the citing words where the paragraph
 * has them and the whole paragraph where it does not (flash.ts falls back to
 * the cell). The singular is written out rather than "(s)", because one is a
 * real and common answer.
 *
 * The paragraph the card was opened from is drawn but not linked: a jump to
 * where you already are is a scroll that does nothing. From the reference
 * entry, which is never in `citedAt`, every number is a link.
 * docs/plans/261009e-citation-card-jumps-back-to-every-passage-that-cites-the-work.md.
 */
function CitedAtJumps({
  citedAt,
  atLeast,
  here,
  onJump,
}: {
  citedAt: readonly BlockId[];
  /** The work has `MAX_MENTIONS` direct mentions, so there may be more paragraphs than `citedAt` holds. */
  atLeast: boolean;
  here: BlockId | null;
  onJump(id: BlockId): void;
}) {
  const total = citedAt.length;
  /* Cited only in the paragraph you are reading: there is nowhere to go, and a
     lone unlinked "1" would be a number for its own sake. */
  const listed = citedAt.some((id) => id !== here) ? citedAt.slice(0, CITED_AT_JUMPS_SHOWN) : [];
  return (
    <p className="prose-card-cite-jumps">
      <span className="prose-card-cite-where">
        cited in {atLeast ? "at least " : ""}
        {total} {total === 1 ? "paragraph" : "paragraphs"}
      </span>
      {listed.map((id, i) =>
        id === here ? (
          <span key={id} className="prose-card-cite-jump is-here" aria-current="location">
            <span className="prose-card-cite-jump-number" aria-hidden="true">
              {i + 1}
            </span>
            <span className="sr-only">
              Citing paragraph {i + 1} of {total}, this paragraph
            </span>
          </span>
        ) : (
          <BlockRef key={id} id={id} className="prose-card-cite-jump" onJump={onJump}>
            <span className="prose-card-cite-jump-number" aria-hidden="true">
              {i + 1}
            </span>
            <span className="sr-only">
              Citing paragraph {i + 1} of {total}
            </span>
          </BlockRef>
        ),
      )}
      {listed.length > 0 && total > listed.length && (
        <span className="prose-card-cite-where">and {total - listed.length} more</span>
      )}
    </p>
  );
}


/**
 * **After *Look it up*, the short version of the band's reading** — plan
 * 260929g stage 2, Greg's *"in the tool tip"*. The verdict, labelled as the
 * AI's reading of the extract, and **one** quote labelled as the extract's:
 * the verdict's own when it has one, otherwise `paperDoes` with the sentence it
 * bears out. The labels and the verdict's words are the band's
 * (CitationsPanel.tsx), so the two surfaces cannot say it differently. Nothing
 * for a lookup that read nothing: the line above already says so. No button —
 * see `CiteCard` § What is deliberately not here.
 */
function CiteCardReading({ work }: { work: CitedWork }) {
  const lookup = assessedOf(work);
  if (lookup === null) return null;
  const { verdict, paperDoes } = lookup;
  const quote = verdict.support !== "not-in-extract" ? verdict.quote : (paperDoes?.quote ?? null);
  return (
    <div className="prose-card-part prose-card-cite-reading">
      <div className="prose-card-cite-verdict">
        <p className="prose-card-label">{CITE_VERDICT_LABEL}</p>
        <p className="prose-card-text prose-card-cite-verdict-text">{verdictText(verdict.support)}</p>
      </div>
      {verdict.support === "not-in-extract" && paperDoes && (
        <p className="prose-card-text prose-card-cite-does">
          <span className="prose-card-cite-does-label">{CITE_DOES_LABEL}:</span>{" "}
          <span className="prose-card-cite-does-text">{paperDoes.says}</span>
        </p>
      )}
      {quote !== null && (
        /* Text, never markup: a slice of a stranger's page. */
        <figure className="prose-card-cite-quote">
          <blockquote>“{quote}”</blockquote>
          <figcaption>{CITE_QUOTE_LABEL}</figcaption>
        </figure>
      )}
    </div>
  );
}

/**
 * **Start a fresh chat about this entry and send its first question** — the
 * Glossary band's sender (`askGlossaryEntryInChat` in Reader.tsx), so a chat
 * started from a card records the same origin as one started from the entry.
 */
export type AskAboutTerm = (entry: Pick<GlossaryEntry, "id" | "name">) => void;

/**
 * **The owner's verb on a term's place in their glossary**, as the card needs
 * it — a structural slice of `GlossaryRead` (src/web/useGlossary.ts), which
 * Reader passes whole. On the read rather than the band so the card can use it
 * in any mode: plan 261002c, GPT Sol's plan review finding 1. It carried
 * *Dig deeper*'s `look` too until 2026-10-09; *Ask in chat* is its own prop
 * (`AskAboutTerm`), plan 261009k.
 */
export interface TermActions {
  /** Pessimistic: resolves once the server has it and the list is re-read; throws a sentence. */
  setHidden(id: string, hidden: boolean): Promise<void>;
  hiding: ReadonlySet<string>;
}

/**
 * **A glossary entry as a card**: what it means here, in general, what the web
 * said, and one row of *Ask in chat · Hide · Open in Glossary*.
 *
 * Exported since 2026-10-06 for Skim's term chips (SkimPanel.tsx § `TermChip`,
 * plan 261006e), which draw it inside the shared `Tooltip` rather than this
 * file's own card. It mounts none of the prose hover machinery.
 */
export function TermCard({
  entry,
  onOpen,
  actions,
  onAsk = null,
  onClose,
}: {
  entry: GlossaryEntry;
  /**
   * The way out to the full entry. **Absent, no *Open in Glossary* is drawn**: a
   * Skim reader whose Glossary control is hidden has nowhere to be sent. The
   * prose always passes it.
   */
  onOpen?: (() => void) | undefined;
  /** `null` for a visitor: no Hide. */
  actions: TermActions | null;
  /** *Ask in chat*: `null` or absent for a visitor, who has no chat. */
  onAsk?: AskAboutTerm | null | undefined;
  onClose(): void;
}) {
  const prose = entryProse(entry);
  /* Why the Hide pressed here did not go through. The card's own line, because
     the band's error surface may not be on screen — GPT Sol's plan review,
     finding 5: a failed card hide must say so where the press was. */
  const [hideFailed, setHideFailed] = useState<string | null>(null);

  const hiding = actions?.hiding.has(entry.id) ?? false;

  /**
   * **Ask in chat, then close the card** — the press is the Send, and the
   * answer is in Chat, so the 18rem card that goes when the pointer leaves has
   * nothing left to show. Never disabled: a chat needs no passage, so a term
   * the article never quotes can be asked about too. Until 2026-10-09 this was
   * *Dig deeper*, which started a lookup and opened the Glossary band on the
   * term (plan 261009k).
   */
  const ask = () => {
    if (!onAsk) return;
    onAsk(entry);
    onClose();
  };

  const hide = async () => {
    if (!actions) return;
    setHideFailed(null);
    try {
      await actions.setHidden(entry.id, true);
      onClose();
    } catch (err) {
      setHideFailed((err as Error).message);
    }
  };

  return (
    <div className="prose-card-body">
      <p className="prose-card-head">
        {/* The glossary's canonical name, which the model writes — so a class of
            its own: the citation card reuses `prose-card-name` for a work's title. */}
        <span className="prose-card-name prose-card-term-name">{entry.name}</span>
        <GlossaryKindIcon kind={entry.kind} />
      </p>

      {prose.legacy ? (
        /* `glossary/1` wrote one blended field, and there is no honest label for
           a blend — see `entryProse`. It renders unlabelled here exactly as it
           does in the panel. */
        <p className="prose-card-text prose-card-term-lead">{prose.lead}</p>
      ) : (
        prose.sections.map((section) => (
          <div key={section.key} className={`prose-card-part prose-card-part-${section.key}`}>
            <p className="prose-card-label">{section.label}</p>
            <p className="prose-card-text">{section.text}</p>
          </div>
        ))
      )}

      {/* What the web said, if somebody has already asked. Kept under its own
          label for the reason the panel keeps it apart: a reader who cannot
          tell the checked answer from the remembered one has lost the thing
          the labels exist to give them. */}
      {entry.lookup && (
        <div className="prose-card-part prose-card-part-looked">
          {/* **Only "on the web" when the model searched.** `searches: 0` is a
              real answer — the panel draws it as *no web search* — and every
              term a reader adds from *Look up a term* (plan 261002f) carries a
              lookup, often with no search; the card used to call all of them
              checked on the web. */}
          <p className="prose-card-label">
            {entry.lookup.searches > 0 ? (
              <>
                <Globe size={9} />
                checked on the web
              </>
            ) : (
              "explained, without a web search"
            )}
          </p>
          <p className="prose-card-text">{entry.lookup.answer}</p>
        </div>
      )}

      {/* **One row**, since 2026-10-03. Greg (spya-za77hj): *"it shows a
          tooltip with dig deeper, hide, and in the glossary. They should all
          be on the same row to minimize vertical space"*. Until then the
          owner's two verbs were a second row under this one (plan 261002c § 3).
          The row wraps rather than overflowing: an entry with a link and all
          three buttons is wider than the card. */}
      {/* No foot at all with nothing to put in it: a visitor in Skim with no
          Glossary to open, on a term with no link. */}
      {(entry.url || actions || onAsk || onOpen) && (
      <p className="prose-card-foot prose-card-foot-wraps prose-card-term-foot">
        {entry.url && (
          /* `noreferrer` as well as `noopener`, as in the panel: the article's
             own URL is a reading history and a model-supplied link should not be
             handed ours. The scheme was checked server-side by `safeUrl`. */
          <a className="prose-card-link" href={entry.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={10} />
            {hostOf(entry.url)}
          </a>
        )}
        {/* **The three buttons are one group that never breaks**, pushed right.
            When a link beside them leaves no room, the group moves to a line
            of its own whole, rather than *Hide* parting from *Ask in chat* or
            *Open in Glossary* landing alone (GPT Sol, plan review of 261003h). */}
        <span className="prose-card-acts">
        {/* The owner's two verbs, beside the way out. Plain buttons, like
            that one: a tap inside the card is left entirely alone by the touch
            path (useHoverCard.ts § "Inside the card"), so they work on a
            finger as it does. */}
        {/* Chat's two bubbles (icons.md § A chat is two bubbles), in the
            card's own button rather than the band's `AskInChatButton`: the
            row's other two are `.prose-card-act`, and a 32px outline Button
            among them would be a second kind of thing. */}
        {onAsk && (
          <button
            type="button"
            className="prose-card-act prose-card-term-ask"
            aria-label={ASK_ENTRY_IN_CHAT}
            title={`${ASK_ENTRY_IN_CHAT}. ${ASK_IN_CHAT_SAYS}`}
            onClick={ask}
          >
            <MessagesSquare size={10} aria-hidden="true" />
            {ASK_IN_CHAT}
          </button>
        )}
        {actions && (
          <>
            <button
              type="button"
              className="prose-card-act"
              disabled={hiding}
              /* Statements, not two instructions in one run — spya-d886ah's rule
                 (Tooltip.tsx § `ControlTip.press`). Until 2026-10-02 it ended
                 "Unhide it from the glossary's Hidden list." */
              title="Takes this term out of your glossary and its underlines, for you only. The glossary's Hidden list brings it back."
              onClick={() => void hide()}
            >
              <Trash2 size={10} />
              Hide
            </button>
          </>
        )}
        {/* The way out to the full entry. Without it the underline is a
            dead end: the mark itself stays inert to a click, because pressing
            prose has always meant selecting it. It said "in the glossary" until
            2026-10-03; Greg asked for a label that says what pressing it does.
            *Open glossary* until plan 261010d, which made it every card's
            `OpenInMode`. */}
        {onOpen && <OpenInMode mode="glossary" onPress={onOpen} />}
        </span>
      </p>
      )}
      {hideFailed && <p className="prose-card-text prose-card-failed">{hideFailed}</p>}
    </div>
  );
}
