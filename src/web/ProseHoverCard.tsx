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
import { BookA, CornerDownRight, ExternalLink, FileText, Globe } from "lucide-react";
import { FloatingArrow, FloatingPortal } from "@floating-ui/react";
import type { BlockId, GlossaryEntry } from "../types.js";
import { hostOf } from "../urls.js";
import { entryProse } from "./GlossaryPanel.js";
import { useHoverCard } from "./useHoverCard.js";
import { describeLink, type LinkPreview } from "./link-preview.js";
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
  /** Where the article itself came from, so a link can say if it leaves. */
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
    selector: "mark.term, a[href]",
    read,
    /* True here and false for a bare term, and the difference is not a
       preference: an `<a>` is a tab stop already, so a reader moving through
       the prose by keyboard lands on one whether we listen or not, and opening
       the card their pointer would have got is the whole of what parity costs.
       A `<mark>` takes no focus, and making several hundred of them into tab
       stops would be worse than the gap it leaves. */
    focusable: true,
  });

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
 *  - **A link out** — the host, whether it leaves the publication, what the
 *    path says if it says anything, and whether it is a file rather than a
 *    page. All of it read off the href; see link-preview.ts for why those
 *    facts and not others.
 *  - **Something else** — `mailto:`, or an href we could not parse. Said
 *    plainly rather than dressed up as a page.
 */
function LinkCard({
  link,
  anchor,
  href,
  divided,
  onJump,
}: {
  link: LinkPreview;
  anchor: { blockId: BlockId; text: string } | null;
  href: string | null;
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
        {link.trail.length > 0 && (
          <p className="prose-card-text prose-card-trail">{link.trail.join(" › ")}</p>
        )}
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
        </p>
      </>
    );
  };

  const content = body();
  if (!content) return null;
  return <div className={`prose-card-body${divided ? " divided" : ""}`}>{content}</div>;
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
