/**
 * **The switcher between Skim briefs** — the ▾ beside *Reading for: …* and
 * the short list it opens: the default (the article's *why you're reading*),
 * each added brief, and *New brief…*. Owner only. Plan
 * docs/plans/261027d-several-skim-briefs-per-article-and-a-picker-between-them.md
 * § The picker (option A, Greg's choice) and § Log, stage 4.
 *
 * **A Radix `Popover`, the shelf's tag editor's** (ShelfTags.tsx), on the
 * menus' surface (menu.ts § `MENU_SURFACE`), rather than a `DropdownMenu`:
 * each row carries buttons of its own — Edit, and Chat's two-press bin
 * (`ArmedDelete`) — and a menu item cannot hold a second control a keyboard
 * reaches. Tab walks the rows, Escape and a press outside close it.
 *
 * **Nothing is written inside it.** Choosing writes the address (`choose`);
 * *Edit* and *New brief…* close it and open the band's own box, on the route
 * concerned (`BriefIntent`), so the typing, the microphone and the error all
 * live where the default's *Edit* already put them (SkimPurpose.tsx).
 */
import { type ReactNode, type RefObject, useRef, useState } from "react";
import { Check, ChevronDown, Pencil, Plus } from "lucide-react";
import { Popover } from "radix-ui";
import { SKIM_BRIEFS_MAX, type SkimBriefSummary } from "../types.js";
import { mintId } from "../ids.js";
import { ArmedDelete } from "./ArmedDelete.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { MENU_SURFACE } from "./menu.js";
import { usePurpose } from "./purpose.js";
import type { SkimBriefs } from "./skim-briefs.js";
import { voiceClass } from "./voice.js";

/**
 * What the band does first on a route, once it is the one drawn — carried
 * across the band's remount per route (SkimMode.tsx § `SkimBand`), which is
 * why it lives above it. `brief` is the route's (`null`: the default).
 *
 * - `edit`: open that route's box over its sentence.
 * - `new`: open the *New brief* box on the route already drawn.
 * - `plan`: a brief just created — ask for its route (`ensure`), once.
 * - `ensure`: a saved Edit finished after its route unmounted — ask when that
 *   route is next drawn, without taking over the reader's navigation.
 */
export interface BriefIntent {
  brief: string | null;
  box: "edit" | "new" | "plan" | "ensure";
  /** One logical New press keeps one id through a lost reply and a remount. */
  createId?: string;
}

export type BriefDraftBox = "edit" | "new";

/**
 * Everything the picker and the boxes need from the band: one per `SkimBand`.
 * Drafts and submitted actions deliberately live here, above
 * `SkimRouteBand`'s route key, so Back/Forward cannot erase prose or turn one
 * press into two writes.
 */
export interface BriefPicking {
  slug: string;
  /** The route drawn: an added brief's id, or `null` for the default. */
  current: string | null;
  /** The list, read only once something has asked for it (`wantList`). */
  briefs: SkimBriefs;
  /** The switcher has opened: read the list from now on. */
  wantList(): void;
  /**
   * Draw another route: `brief`, `stop` and `depth` in **one** address write,
   * since the three are one position (Sol F7), with `then` waiting for the
   * band that arrives.
   */
  choose(brief: string | null, then?: "edit" | "plan"): void;
  intent: BriefIntent | null;
  setIntent(intent: BriefIntent | null): void;
  /** Typed prose lives above the route-keyed remount, one box per route. */
  draft(brief: string | null, box: BriefDraftBox): string | undefined;
  setDraft(brief: string | null, box: BriefDraftBox, value: string | undefined): void;
  /** A submitted box stays busy across the route-keyed remount. */
  busy(brief: string | null, box: BriefDraftBox): boolean;
  begin(brief: string | null, box: BriefDraftBox): boolean;
  end(brief: string | null, box: BriefDraftBox): void;
}

/** Whether `intent` is for this route and asks for `box`. */
export function intends(picking: BriefPicking | undefined, brief: string | null, box: BriefIntent["box"]): boolean {
  return picking?.intent?.box === box && picking.intent.brief === brief;
}

/** At the server's limit (src/store/pg-skim-briefs.ts), said before the press rather than after. */
export const BRIEFS_FULL = `This article has ${SKIM_BRIEFS_MAX} briefs besides its own, the most it can hold. Delete one to add another.`;

/** A row's choose button: a menu item's look (menu.ts § `MENU_ITEM`), without Radix's highlight attribute. */
const ROW =
  "tw:flex tw:min-h-10 tw:w-full tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2 tw:rounded-[3px] tw:px-2 tw:py-1.5 tw:text-left tw:text-sm tw:leading-snug tw:text-foreground tw:outline-none tw:hover:bg-highlight/10 tw:focus-visible:bg-highlight/10";

export function BriefPicker({
  picking,
  defaultSentence,
}: {
  picking: BriefPicking;
  /** The article's purpose, when the line already holds it; otherwise read when the list opens. */
  defaultSentence?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /* Focus has somewhere to go when the bin it was on goes with its row. */
  const first = useRef<HTMLButtonElement>(null);
  /* Only read when the line did not have it: an added brief's line. */
  const purpose = usePurpose(open && defaultSentence === undefined ? picking.slug : null);
  const ownPurpose =
    defaultSentence !== undefined ? defaultSentence : purpose.state === "ready" && !purpose.purposeFailed ? purpose.purpose : null;
  const { briefs, current } = picking;
  const full = briefs.status === "ready" && briefs.briefs.length >= SKIM_BRIEFS_MAX;

  const close = () => setOpen(false);
  const go = (brief: string | null) => {
    close();
    if (brief !== current) picking.choose(brief);
  };
  const edit = (brief: string | null) => {
    close();
    if (brief === current) picking.setIntent({ brief, box: "edit" });
    else picking.choose(brief, "edit");
  };
  const remove = async (brief: SkimBriefSummary) => {
    setProblem(null);
    first.current?.focus();
    try {
      await briefs.remove(brief.id);
    } catch (err) {
      setProblem(`Couldn't delete that brief. ${describeFetchFailure(err as Error)}`);
      return;
    }
    /* The route on screen is gone: back to the default, with its position. */
    if (brief.id === current) {
      close();
      picking.choose(null);
    }
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setProblem(null);
          picking.wantList();
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className="chat-icon skim-brief-trigger"
          aria-label="Choose what to skim for"
          data-tip="Skim for something else"
          data-tip-describes="off"
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={10}
          aria-label="Skim briefs"
          className={`${MENU_SURFACE} skim-briefs tw:w-[min(22rem,calc(100vw-1.75rem))]`}
        >
          <ul className="skim-briefs-list">
            <BriefRow
              chooseRef={first}
              current={current === null}
              sentence={ownPurpose}
              fallback="Your profile alone — no purpose said for this piece"
              tag="default"
              onChoose={() => go(null)}
              onEdit={() => edit(null)}
              editTip="Edit why you're reading this piece"
            />
            {briefs.briefs.map((brief) => (
              <BriefRow
                key={brief.id}
                current={current === brief.id}
                sentence={brief.brief}
                onChoose={() => go(brief.id)}
                onEdit={() => edit(brief.id)}
                editTip="Edit this brief"
                bin={
                  <ArmedDelete
                    size={12}
                    tip="Delete this brief"
                    armedTip="Press again to delete this brief and its route"
                    onDelete={() => void remove(brief)}
                  />
                }
              />
            ))}
          </ul>
          {briefs.status === "loading" && <p className="skim-briefs-note">Reading your briefs…</p>}
          {briefs.error !== null && (
            <p className="gloss-error" role="alert">
              {`Couldn't read your briefs. ${briefs.error}`}
            </p>
          )}
          {problem !== null && (
            <p className="gloss-error" role="alert">
              {problem}
            </p>
          )}
          <button
            type="button"
            className={ROW}
            disabled={full}
            onClick={() => {
              close();
              picking.setIntent({ brief: current, box: "new", createId: mintId() });
            }}
          >
            <Plus size={14} aria-hidden="true" className="tw:shrink-0" />
            <span>New brief…</span>
          </button>
          {full && <p className="skim-briefs-note">{BRIEFS_FULL}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function BriefRow({
  current,
  sentence,
  fallback,
  tag,
  onChoose,
  onEdit,
  editTip,
  bin,
  chooseRef,
}: {
  current: boolean;
  sentence: string | null;
  /** Said when there is no sentence. */
  fallback?: string;
  tag?: string;
  onChoose(): void;
  onEdit(): void;
  editTip: string;
  bin?: ReactNode;
  chooseRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <li className="skim-brief-row">
      <button ref={chooseRef} type="button" className={ROW} aria-current={current ? "true" : undefined} onClick={onChoose}>
        <span className="skim-brief-mark" aria-hidden="true">
          {current && <Check size={14} />}
        </span>
        <span className="skim-brief-words">
          {sentence !== null && sentence !== "" ? (
            <span className={voiceClass("reader")}>{sentence}</span>
          ) : (
            <span className="skim-brief-fallback">{fallback ?? ""}</span>
          )}
          {tag && <span className="skim-brief-tag">{tag}</span>}
        </span>
      </button>
      <button
        type="button"
        className="chat-icon"
        aria-label={editTip}
        data-tip={editTip}
        data-tip-describes="off"
        onClick={onEdit}
      >
        <Pencil size={12} aria-hidden="true" />
      </button>
      {bin}
    </li>
  );
}
