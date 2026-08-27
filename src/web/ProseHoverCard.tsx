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
import { useCallback, useMemo } from "react";
import {
  BookA,
  BookMarked,
  BookOpen,
  CornerDownRight,
  ExternalLink,
  FileText,
  Globe,
  LoaderCircle,
} from "lucide-react";
import { FloatingArrow, FloatingPortal } from "@floating-ui/react";
import type { BlockId, GlossaryEntry } from "../types.js";
import { hostOf } from "../urls.js";
import { entryProse } from "./GlossaryPanel.js";
import { useHoverCard } from "./useHoverCard.js";
import { describeLink, type ExternalPreview, type LinkPreview } from "./link-preview.js";
import { useLinkFacts, type LinkFacts } from "./link-facts.js";
import { Link } from "./Link.js";
import { readHref } from "./router.js";
import { internalTarget } from "./internal-links.js";

/** What the pointer found: a term, a link, or both over the same words. */
interface Hit {
  /** Glossary entry ids, in the order the mark lists them. May be empty. */
  termIds: string[];
  /** The href, already described. Null when the pointer is on a bare term. */
  link: LinkPreview | null;
  /** For an in-article anchor: the block it resolves to. */
  anchor: { blockId: BlockId; text: string } | null;
  /** The raw href, for the foot of the card. */
  href: string | null;
}

export function ProseHoverCard({
  entries,
  sourceUrl,
  blockText,
  onOpenTerm,
  onJump,
}: {
  entries: GlossaryEntry[];
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
  /** Show this term in the glossary band — the card's one way out to the list. */
  onOpenTerm(id: string): void;
  /** Go to the block an in-article anchor points at. */
  onJump(id: BlockId): void;
}) {
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

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

      // Nothing to say. A bare `<a>` we cannot describe is not worth a panel.
      if (termIds.length === 0 && !link) return null;
      if (termIds.length === 0 && link?.kind === "anchor" && !anchor) return null;
      return { termIds, link, anchor, href };
    },
    [byId, sourceUrl, blockText],
  );

  const { shown, close, anchorProps, arrowRef, context } = useHoverCard<Hit>({
    /* **Named places, not `a[href]`.** The listener is delegated on the
       document, so a bare `a[href]` meant *every* anchor on the page — the
       masthead's "Library", the `read it here` button inside this very card,
       the source list at the foot of an answer. A relative href does not parse,
       so `describeLink` returned `{kind: "other"}` and the reader got a panel
       saying `link` over `/library`. Nobody had reported it, which is what an
       ignorable wart looks like; narrowing it was needed anyway to let chat's
       links in, so it was done there. docs/plans/chat-web-links.md.

       Three places earn a card, and they are the three where the reader is
       deciding whether to follow an address somebody else chose: the article's
       own hyperlinks, the links a chat answer writes into its prose
       (`cited-link`, Cited.tsx), and the sources listed under an answer. */
    selector: "mark.term, .prose a[href], a.cited-link, .chat-sources a[href]",
    /* Both containers survive their own re-render, which is the whole
       requirement — see `host`. A chat answer's `<p>` does not, so the
       fallback would leave a card pinned to a detached node as an answer
       streams. */
    host: ".prose, .chat-turn",
    read,
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
       the word goes from unreachable to zero. docs/plans/touch-glossary-card.md. */
    tapSelector: "mark.term",
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
    onCommit: ({ data }) => {
      const ids = data.termIds.filter((id) => byId.has(id));
      const only = ids.length === 1 ? ids[0] : undefined;
      if (!only) return;
      close();
      onOpenTerm(only);
    },
  });

  /* Before the early return, because it is a hook. It is handed the *shown*
     link rather than the hovered one on purpose: a card takes 320ms of rest to
     open, so a pointer crossing the prose asks Wikipedia about nothing.
     link-facts.ts § What Wikipedia is told has the caveat to that. */
  const facts = useLinkFacts(shown?.data.link ?? null, sourceUrl);

  if (!shown) return null;
  const { termIds, link, anchor, href } = shown.data;
  const found = termIds
    .map((id) => byId.get(id))
    .filter((e): e is GlossaryEntry => e !== undefined);
  if (found.length === 0 && !link) return null;

  const label = [
    ...found.map((e) => e.name),
    link?.kind === "external" ? link.host : link?.kind === "anchor" ? "in this article" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <FloatingPortal>
      {/* `dialog`, not `tooltip`: WAI's tooltip pattern is for text describing
          the thing you point at, and says outright that a tooltip does not take
          focus and should not contain focusable controls. This one holds a link
          and a button. Flagged by a GPT Sol review, 2026-08-26. */}
      <div {...anchorProps} role="dialog" aria-label={label}>
        <div className="tooltip prose-card">
          {/* More than one term only where two overlap the same words —
              "attention" inside "attention head", commoner now that the whole
              list is drawn. Both are shown: picking one would be picking for
              the reader, and which matched the longer phrase is not a thing the
              mark records. */}
          {found.map((entry) => (
            <TermCard key={entry.id} entry={entry} onOpen={() => { close(); onOpenTerm(entry.id); }} />
          ))}
          {/* The link half, under the term half when there is one. That order
              is deliberate: the reader is in the middle of a sentence, and what
              the word means comes before where it would take them. */}
          {link && (
            <LinkCard
              link={link}
              anchor={anchor}
              href={href}
              facts={facts}
              divided={found.length > 0}
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
 * and complete from the href alone; a shelf match or a Wikipedia summary is a
 * section that appears under it a moment later. Nothing above waits, and a
 * lookup that fails or finds nothing leaves a card that was already worth
 * reading. That is what lets those lookups be allowed to be slow.
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
  divided,
  onJump,
}: {
  link: LinkPreview;
  anchor: { blockId: BlockId; text: string } | null;
  href: string | null;
  /** What the two lookups found, and whether either is still outstanding. */
  facts: LinkFacts;
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
            <CornerDownRight size={9} />
            elsewhere in this article
          </p>
          {/* The destination's own words. Trimmed rather than summarised: a
              paragraph's first sentence is the author's, and a gist of it would
              be ours — and the reader can see the whole thing by following the
              link, which is one click away and already works. */}
          <p className="prose-card-text prose-card-quote">{clip(anchor.text, 260)}</p>
          <p className="prose-card-foot">
            <button
              type="button"
              className="prose-card-open"
              onClick={() => onJump(anchor.blockId)}
            >
              <CornerDownRight size={10} />
              go there
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

    return <ExternalBody link={link} facts={facts} href={href} />;
  };

  const content = body();
  if (!content) return null;
  return <div className={`prose-card-body${divided ? " divided" : ""}`}>{content}</div>;
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
  href,
}: {
  link: ExternalPreview;
  facts: LinkFacts;
  href: string | null;
}) {
  const { library, wiki, loading } = facts;
  /* A real title supersedes the path trail rather than joining it. The trail is
     a guess read off an address; a title is a title, and printing both would
     show the reader our working next to the answer. */
  const titled = library !== null || wiki !== null;

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
          <p className="prose-card-title">{library.entry.title}</p>
          {library.entry.gist && (
            <p className="prose-card-text">{clip(library.entry.gist, 220)}</p>
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
      </p>
    </>
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
function TermCard({ entry, onOpen }: { entry: GlossaryEntry; onOpen(): void }) {
  const prose = entryProse(entry);

  return (
    <div className="prose-card-body">
      <p className="prose-card-head">
        <span className="prose-card-name">{entry.name}</span>
        {entry.kind !== "term" && entry.kind !== "other" && (
          <span className="gloss-kind">{entry.kind}</span>
        )}
      </p>

      {prose.legacy ? (
        /* `glossary/1` wrote one blended field, and there is no honest label for
           a blend — see `entryProse`. It renders unlabelled here exactly as it
           does in the panel. */
        <p className="prose-card-text">{prose.lead}</p>
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
          <p className="prose-card-label">
            <Globe size={9} />
            checked on the web
          </p>
          <p className="prose-card-text">{entry.lookup.answer}</p>
        </div>
      )}

      <p className="prose-card-foot">
        {entry.url && (
          /* `noreferrer` as well as `noopener`, as in the panel: the article's
             own URL is a reading history and a model-supplied link should not be
             handed ours. The scheme was checked server-side by `safeUrl`. */
          <a className="prose-card-link" href={entry.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={10} />
            {hostOf(entry.url)}
          </a>
        )}
        {/* The way out to the full entry. Without it the underline is a
            dead end: the mark itself stays inert to a click, because pressing
            prose has always meant selecting it. */}
        <button type="button" className="prose-card-open" onClick={onOpen}>
          <BookA size={10} />
          in the glossary
        </button>
      </p>
    </div>
  );
}
