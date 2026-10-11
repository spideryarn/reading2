/**
 * **A search button in a chat answer, run where it is** — plan
 * docs/plans/261011aa-guide-and-chat-run-in-article-searches-in-place-and-link-the-article-readily.md.
 *
 * > I wanted a little bit of UI that would show, okay, this is the search text
 * > that I'm about to run. Click this button to initiate it … It shouldn't take
 * > me to the search mode because that's really disorienting, and I might want
 * > to search for multiple things.
 * >
 * > — Greg, 2026-10-11, `spya-ma72mx`
 *
 * The button is the chip CommandChip.tsx draws, words and `generates` marker
 * included, and the reader still presses it: `chipFor` is asked again at the
 * press (`recheck`), as for every chip. What the press does here is the
 * difference. A `quick-search` runs the quick search in place
 * (chat-searches.ts) and a `find` matches the exact words in place
 * (`findLiteral`, Search's own words matcher), and the button's place becomes
 * what was found: the passages as block links, which jump the article and
 * leave the conversation where it is, and *Open in Search* for the whole view.
 *
 * Drawn only inside a chat surface that provided `ChatSearchHere` (Reader.tsx,
 * around the chat band and the passage chat dialog). Anywhere else a search
 * chip presses through the executor as it always did.
 */
import { createContext, useContext, useState, type ReactElement, type ReactNode } from "react";
import type { Block, BlockId } from "../types.js";
import { BlockRef } from "./BlockRef.js";
import { findHref, searchRunHref } from "./search-hrefs.js";
import { NOT_HERE } from "./command-proposal.js";
import { findLiteral } from "./search-hits.js";
import { startChatSearch, useChatSearch } from "./chat-searches.js";
import { useMadeFor } from "./lib/made-for.js";
import { carriedSearch, navigate } from "./router.js";

/** What a chat surface hands its search buttons: the article, and its jump. */
export interface ChatSearchPlace {
  readonly slug: string;
  readonly blocks: readonly Block[];
  jump(blockId: BlockId): void;
}

const ChatSearchContext = createContext<ChatSearchPlace | null>(null);

export function ChatSearchHere({ place, children }: { place: ChatSearchPlace; children: ReactNode }): ReactElement {
  return <ChatSearchContext.Provider value={place}>{children}</ChatSearchContext.Provider>;
}

export function useChatSearchPlace(): ChatSearchPlace | null {
  return useContext(ChatSearchContext);
}

/** How many passages a card lists before it says how many more Search has. */
export const SHOWN = 12;

type Props = {
  readonly kind: "quick" | "find";
  readonly words: string;
  readonly place: ChatSearchPlace;
  /** The chip, as CommandChip drew it: the label, and the `generates` marker. */
  readonly button: ReactNode;
  /**
   * The label alone, for the box once the search has run: the `generates`
   * marker says a press will spend, which is no longer true of a search that
   * already ran (the browser pass's finding, 2026-10-11).
   */
  readonly name: ReactNode;
  readonly description: string;
  readonly enabled: boolean;
  /** `chipFor` asked again at the press: is this still a button here, now? */
  recheck(): boolean;
};

export function ChatSearchCard(props: Props): ReactElement {
  return props.kind === "quick" ? <QuickCard {...props} /> : <FindCard {...props} />;
}

function QuickCard({ words, place, button, name, description, enabled, recheck }: Props): ReactElement {
  const reader = useMadeFor();
  const search = useChatSearch(reader, place.slug, words);
  const [refused, setRefused] = useState(false);
  const known = new Set(place.blocks.map((b) => b.id as string));
  const unusableSaved =
    search.status === "done" && search.saved === true && !search.run.hits.every((h) => known.has(h.blockId));
  const press = () => {
    if (!recheck()) {
      setRefused(true);
      return;
    }
    setRefused(false);
    /* A saved answer whose passages no longer exist is deliberately drawn as
       a runnable button. Tell the store not to let that hidden `done` row
       swallow this press. */
    startChatSearch(reader, place.slug, words, { ignoreSaved: unusableSaved });
  };
  /* **A saved answer is drawn only while every passage it found is still
     here.** The saved list carries no fingerprint of the article now
     (search.md § Searches started from a chat), so this is the check we can
     make; an answer that names a passage the article no longer has is left
     as the button, for the reader to ask again. And it says when it was
     found, since it was not found just now. */
  const shown = unusableSaved ? ({ status: "idle" } as const) : search;
  switch (shown.status) {
    case "checking":
      return (
        <span className="cmd-chip-wrap chat-search">
          <button type="button" className="cmd-chip" title={description} disabled aria-busy="true">
            {button}
          </button>
          <span className="cmd-chip-said" role="status">Checking saved searches…</span>
        </span>
      );
    case "idle":
    case "error":
      return (
        <span className="cmd-chip-wrap chat-search">
          <button type="button" className="cmd-chip" title={description} disabled={!enabled} onClick={press}>
            {button}
          </button>
          {(refused || shown.status === "error") && (
            <span className="cmd-chip-said" role="status">
              {refused ? NOT_HERE : shown.status === "error" ? shown.message : null}
            </span>
          )}
        </span>
      );
    case "searching":
      return (
        <Found
          what={name}
          status={
            shown.hits.length === 0
              ? "Searching…"
              : `Searching… ${passages(new Set(shown.hits.map((h) => h.blockId)).size)} so far`
          }
          ids={shown.hits.map((h) => h.blockId)}
          place={place}
          busy
        />
      );
    case "done": {
      const ids = shown.run.hits.map((h) => h.blockId);
      const said = ids.length === 0 ? "Nothing found" : passages(new Set(ids).size);
      const when = shown.saved === true ? ` (searched ${day(shown.run.finishedAt ?? shown.run.createdAt)})` : "";
      return (
        <Found
          what={name}
          status={`${said}${when}.`}
          ids={ids}
          place={place}
          open={searchRunHref(place.slug, here(), shown.run.id)}
        />
      );
    }
    default: {
      const never: never = shown;
      return never;
    }
  }
}

function FindCard({ words, place, button, name, description, enabled, recheck }: Props): ReactElement {
  /* Free and instant, so the press works it out there and then; nothing to
     keep across a redraw that a second press would not give back at once. */
  const [found, setFound] = useState<readonly BlockId[] | null>(null);
  const [refused, setRefused] = useState(false);
  if (found !== null) {
    return (
      <Found
        what={name}
        status={found.length === 0 ? "Not in this article." : `${passages(new Set(found).size)}.`}
        ids={found}
        place={place}
        open={findHref(place.slug, here(), words)}
      />
    );
  }
  return (
    <span className="cmd-chip-wrap chat-search">
      <button
        type="button"
        className="cmd-chip"
        title={description}
        disabled={!enabled}
        onClick={() => {
          if (!recheck()) {
            setRefused(true);
            return;
          }
          setFound(findLiteral([...place.blocks], words).map((f) => f.blockId));
        }}
      >
        {button}
      </button>
      {refused && (
        <span className="cmd-chip-said" role="status">
          {NOT_HERE}
        </span>
      )}
    </span>
  );
}

/**
 * **What a search found, in the button's place**: the words it ran, a line
 * saying how it went, the passages as block links in the article's order, and
 * the way to the whole thing in Search.
 */
function Found({
  what,
  status,
  ids,
  place,
  open,
  busy = false,
}: {
  what: ReactNode;
  status: string;
  ids: readonly BlockId[];
  place: ChatSearchPlace;
  open?: string;
  busy?: boolean;
}): ReactElement {
  const order = new Map(place.blocks.map((b, i) => [b.id, i] as const));
  const unique = [...new Set(ids)].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const shown = unique.slice(0, SHOWN);
  const more = unique.length - shown.length;
  return (
    <span className="cmd-chip-wrap chat-search chat-search-ran" aria-busy={busy}>
      <span className="chat-search-what">{what}</span>
      <span className="chat-search-status" role="status">
        {status}
        {open !== undefined && (
          <>
            {" "}
            <a
              className="chat-search-open"
              href={open}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                navigate(open);
              }}
            >
              {more > 0 ? `${more} more in Search` : "Open in Search"}
            </a>
          </>
        )}
      </span>
      {shown.length > 0 && (
        <span className="chat-search-hits">
          {shown.map((id) => (
            <BlockRef key={id} id={id} onJump={place.jump} />
          ))}
        </span>
      )}
    </span>
  );
}

/** "11 Oct", the day a saved search was answered. */
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

const passages = (n: number) => (n === 1 ? "1 passage" : `${n} passages`);

/** The address bar's query, for a link that keeps the reader's other settings. */
const here = () => carriedSearch(typeof window === "undefined" ? "" : window.location.search);
