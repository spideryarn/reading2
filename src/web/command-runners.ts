/**
 * **What an argument row does when it is pressed** — one small factory per
 * proposal id (command-proposal.ts), each closing over the controller the page
 * already owns for that state, so the bar and the page's own controls are one
 * state and cannot disagree. Plan 261003f, Stage 1, and GPT Sol's F3, F4 and
 * F6 on it: the deliberate jump, the shelf row's tags controller, the
 * memoised bookmarker — never a second copy made for the bar.
 *
 * No React here. The reading view (Reader.tsx) and the Metadata page build
 * their runners from these, and tests/command-runners.test.ts presses each.
 */
import type { Block, BlockId } from "../types.js";
import { MODE_LABEL } from "../title-text.js";
import { modeGenerates, subModeGenerates } from "./activation.js";
import { type ActionOutcome, type Command, commandId, commandText } from "./command-match.js";
import type {
  CommandExecutor,
  CommandProposal,
  FindMorePresses,
  GlossaryLookupSource,
  ModeTarget,
  Outcome,
} from "./command-proposal.js";
import { FIND_MORE_MODES, type FindMoreMode } from "./find-more.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { handOffFindMore } from "./find-more-handoff.js";
import { handOffGlossaryAsk } from "./glossary-ask-handoff.js";
import { searchDraftFor } from "./search-draft.js";
import { findLiteral, MIN_FIND_CHARS } from "./search-hits.js";

type Runner<K extends CommandProposal["id"]> = (proposal: Extract<CommandProposal, { id: K }>) => Outcome;

const CLOSE: ActionOutcome = { kind: "close" };

/**
 * **Jump to the first place the article says these words** — the first of
 * `findLiteral`'s hits, the same matcher as Search's words mode, so *first*
 * means the first hit that search would light up.
 *
 * `jump` is the reading view's deliberate jump (F3): it pushes a history entry
 * and stamps the return chip, so Back comes home. Not `?at=`, which is the
 * debounced replace the reader's own scrolling writes.
 *
 * No hit keeps the bar open and says so — the reader learns it at once rather
 * than watching the bar shut over a press that went nowhere. Fewer characters
 * than Search looks for is not "not there", so it says that instead.
 */
export function jumpFirstRunner(blocks: Block[], jump: (blockId: BlockId) => void): Runner<"jump-first"> {
  return ({ words }) => {
    if (words.trim().length < MIN_FIND_CHARS) {
      return { kind: "stay", message: `Type at least ${MIN_FIND_CHARS} characters to look for.` };
    }
    const first = findLiteral(blocks, words)[0];
    if (first === undefined) return { kind: "stay", message: `“${words}” isn't in this article.` };
    jump(first.blockId);
    return CLOSE;
  };
}

/**
 * **The reader's own tags on this article, as the bar may edit them** — the
 * `TagEditor`'s save on the Metadata page (which also updates the editor on
 * screen, F4), or a plain `editArticleTags` on the reading view. Resolves to
 * the tags as stored; throws the server's sentence on a refusal.
 */
export interface TagsControl {
  edit(change: { add?: string[]; remove?: string[] }): Promise<readonly string[]>;
}

/** Add and remove, awaited, a refusal kept in the bar with its sentence. */
export function tagRunners(tags: TagsControl): {
  readonly "tag-add": Runner<"tag-add">;
  readonly "tag-remove": Runner<"tag-remove">;
} {
  const edit = async (change: { add?: string[]; remove?: string[] }, verb: string): Promise<ActionOutcome> => {
    try {
      await tags.edit(change);
      return CLOSE;
    } catch (err) {
      /* The server's refusal passes through; a lost connection or a bug is
         said in our words, not its own (lib/describe-failure.ts). */
      return { kind: "stay", message: `Couldn't ${verb} that tag. ${describeFetchFailure(err as Error)}` };
    }
  };
  return {
    "tag-add": ({ tag }) => edit({ add: [tag] }, "add"),
    "tag-remove": ({ tag }) => edit({ remove: [tag] }, "remove"),
  };
}

/**
 * **Bookmark one passage** through the reading view's memoised bookmarker
 * (F6) — `bookmarkBlock` in Reader.tsx, which keeps one comment id per block
 * across a retry, so a press that failed and a press that retries are one
 * comment, not two. A block id the article lacks is refused before anything is
 * written: the id came from somewhere else (chat, Stage 2).
 */
export function bookmarkRunner(
  blocks: readonly Pick<Block, "id">[],
  bookmark: (blockId: BlockId) => Promise<boolean>,
): Runner<"bookmark"> {
  return async ({ blockId }) => {
    if (!blocks.some((b) => b.id === blockId)) {
      return { kind: "stay", message: "That passage isn't in this article." };
    }
    return (await bookmark(blockId))
      ? CLOSE
      : { kind: "stay", message: "Couldn't save that bookmark. Try again in a moment." };
  };
}

/**
 * **Open a term, or ask for one** — the reading view's two glossary runners.
 *
 * `openTerm` is Reader's `openTermInGlossary`, which lowers the threshold if
 * the term is below it. A term no longer in the visible list is refused (it was
 * hidden since the row was drawn; F2).
 *
 * The ask exists only once the read is `ready` (F1), and it neither asks nor
 * arms: it leaves the term in the hand-off (glossary-ask-handoff.ts) and opens
 * the band with `openGlossary`, which must be the plain mode setter, never the
 * Dock's press — the band's *Look up a term* box takes the term and makes the
 * one call.
 */
export function glossaryRunners({
  slug,
  terms,
  ready,
  openTerm,
  openGlossary,
}: GlossaryLookupSource & {
  slug: string;
  openTerm(termId: BlockId): void;
  openGlossary(): void;
}): { readonly "glossary-open": Runner<"glossary-open">; readonly "glossary-ask"?: Runner<"glossary-ask"> } {
  const open: Runner<"glossary-open"> = ({ termId }) => {
    if (!terms.some((t) => t.id === termId)) {
      return { kind: "stay", message: "That term isn't in your glossary any more." };
    }
    openTerm(termId);
    return CLOSE;
  };
  if (!ready) return { "glossary-open": open };
  return {
    "glossary-open": open,
    "glossary-ask": ({ term }) => {
      handOffGlossaryAsk(slug, term);
      openGlossary();
      return CLOSE;
    },
  };
}

/**
 * **How to open each band whose list can be added to right now** — the plain
 * mode setter for each, from the reading view. A band left out, or
 * `undefined`, gets no press and so no row.
 */
export type FindMoreOpeners = { readonly [M in FindMoreMode]?: (() => void) | undefined };

/**
 * **The bar's *Find more* presses** (plan 261004k, Stage 2) — one per band the
 * reading view says can be added to. A press posts nothing and arms nothing:
 * it leaves the one-shot hand-off (find-more-handoff.ts) and opens the band
 * with `open`, which must be the plain mode setter, never the Dock's press —
 * that arms generate-on-open, and the band's own button is about to be
 * pressed. The band takes the hand-off and presses it (useFindMoreHandOff.ts).
 */
export function findMoreRunners(slug: string, open: FindMoreOpeners): FindMorePresses {
  return Object.fromEntries(
    FIND_MORE_MODES.flatMap((mode) => {
      const show = open[mode];
      if (show === undefined) return [];
      const press = (): ActionOutcome => {
        handOffFindMore(slug, mode);
        show();
        return CLOSE;
      };
      return [[mode, press] as const];
    }),
  );
}

/**
 * **The bar's *Quick search “X”* press** (plan 261005i) — the Enter of the
 * bar's own quick-search box (DockQuickSearch.tsx), without the box: the words
 * into the article's shared draft, an `enter` handoff sealed with them, then
 * Search mode. The band takes the handoff, turns itself to *quick* and asks
 * (modes/search/SearchMode.tsx § `useBarHandoff`), so there is still exactly
 * one place that asks, and a quick search already being typed is revised
 * rather than joined by a second.
 *
 * The handoff is left **before** `open`, so a band that mounts for this finds
 * it there. `open` is the reading view's own opener for Search, which also
 * brings back a rail the reader had hidden (Reader.tsx § `openQuickSearch`).
 */
export function quickSearchPress(slug: string, open: () => void): (words: string) => ActionOutcome {
  return (words) => {
    const draft = searchDraftFor(slug);
    draft.set(words);
    draft.handOff("enter");
    open();
    return CLOSE;
  };
}

/** A mode row or a sub-mode row of the bar — the two a `mode` proposal can name. */
export type ModeCommand = Extract<Command, { kind: "mode" | "submode" }>;

/**
 * **How a `mode` proposal opens what it names** (plan 261007j, GPT Sol's F3):
 * the targets the reader can open here now, by catalogue key, and the press.
 */
export interface ModeDoor {
  readonly targets: ReadonlyMap<string, ModeTarget>;
  open(key: string): void;
}

/**
 * **The bar's own mode and sub-mode rows, as a door a chat chip can use.**
 *
 * `commands` are the rows the command bar lists on this page now — the Dock's
 * reachable set (`visibleModes`) and its sub-mode rows (`subModeRows`), built
 * by the reading view from the same two functions the Dock and the bar call —
 * so a key resolves exactly where the bar would offer that row, and nowhere
 * else: not behind the experimental switch, not a mode this page does not draw.
 *
 * `activate` is the Dock's own pair (Dock.tsx § `useActivateMode`,
 * `useActivateSubMode`), handed in by reference: a press arms what the Dock's
 * press arms and moves the band the way it does, so the chip's `generates`
 * marker (`modeGenerates`, `subModeGenerates`) is a statement about what the
 * press will do, not a guess beside it.
 */
export function modeDoor(
  commands: readonly ModeCommand[],
  activate: {
    mode(command: Extract<ModeCommand, { kind: "mode" }>): void;
    sub(command: Extract<ModeCommand, { kind: "submode" }>): void;
  },
): ModeDoor {
  const byKey = new Map<string, ModeCommand>();
  const targets = new Map<string, ModeTarget>();
  for (const command of commands) {
    const key = commandId(command);
    const { label, description } = commandText(command);
    byKey.set(key, command);
    targets.set(key, {
      key,
      /* A sub-mode's own label is one word of its parent's (*Tutorial*), so
         the chip names both, as the plan's sketch does: *Open Learn › Tutorial*. */
      label: command.kind === "submode" ? `${MODE_LABEL[command.sub.mode]} › ${label}` : label,
      description,
      generates: command.kind === "mode" ? modeGenerates(command.mode) : subModeGenerates(command.sub),
    });
  }
  return {
    targets,
    open(key) {
      const command = byKey.get(key);
      if (command === undefined) return;
      if (command.kind === "mode") activate.mode(command);
      else activate.sub(command);
    },
  };
}

/**
 * **Open the mode a chip names** — refused, in a sentence, if the door no
 * longer offers it (it went behind the switch between draw and press).
 */
export function modeRunner(door: ModeDoor): Runner<"mode"> {
  return ({ key }) => {
    if (!door.targets.has(key)) return { kind: "stay", message: "That mode isn't available here any more." };
    door.open(key);
    return CLOSE;
  };
}

/**
 * **The reading view's executor, built once** — what Reader.tsx hands the Dock
 * (command-proposal.ts § `CommandExecutor`), from the controllers it already
 * owns. A function rather than an object literal in Reader so that *what is
 * offered to whom* is stated, and tested, in one place
 * (tests/command-runners.test.ts § the reading view's executor):
 *
 *  - **the jump is everybody's** — it moves the reader and writes nothing,
 *    like the `find` row a visitor already has;
 *  - **the glossary is the owner's**, and absent otherwise: the read whose
 *    `ready` gates the ask (F1) is an owner-only fetch, and the ask spends;
 *  - **the bookmark exists only when the page hands one in**, which it does
 *    once the opening comments read has landed without error (F6);
 *  - **a Find more exists only for a band the page names**, which it does for
 *    the owner while that band's list can be added to (`findMoreRunners`);
 *  - **a quick search exists only when the page hands in Search's opener**,
 *    which it does for the owner: a visitor's band cannot ask
 *    (`quickSearchPress`) — as the bar's row and, since 2026-10-07, as the
 *    `quick-search` proposal a chat chip presses, one press for both;
 *  - **a mode exists only when the page hands in its door** (`modeDoor`),
 *    which it does for the owner, from the Dock's own reachable set.
 */
export function readingExecutor({
  slug,
  blocks,
  jump,
  glossary,
  bookmark,
  findMore,
  openQuickSearch,
  askThroughLens,
  modes,
}: {
  slug: string;
  blocks: Block[];
  /** The deliberate jump — `jumpTo` from reader/useReadingPosition.ts (F3). */
  jump(blockId: BlockId): void;
  glossary?: (GlossaryLookupSource & { openTerm(termId: BlockId): void; openGlossary(): void }) | undefined;
  bookmark?: ((blockId: BlockId) => Promise<boolean>) | undefined;
  findMore?: FindMoreOpeners | undefined;
  /** Open Search mode, for the *Quick search “X”* row — Reader.tsx § `openQuickSearch`. */
  openQuickSearch?: (() => void) | undefined;
  /**
   * Hand a lens to Chat, unsent, for the bar's suggested lens row —
   * Reader.tsx § `suggestedLensInChat` (plan 261005k).
   */
  askThroughLens?: ((lens: string) => void) | undefined;
  /** The modes a chip may open, and how — `modeDoor` (plan 261007j). */
  modes?: ModeDoor | undefined;
}): CommandExecutor {
  const quickSearch = openQuickSearch === undefined ? undefined : quickSearchPress(slug, openQuickSearch);
  return {
    runners: {
      "jump-first": jumpFirstRunner(blocks, jump),
      ...(glossary === undefined ? {} : glossaryRunners({ slug, ...glossary })),
      ...(bookmark === undefined ? {} : { bookmark: bookmarkRunner(blocks, bookmark) }),
      /* The bar's own press, so a chip's quick search and the bar's row are one search. */
      ...(quickSearch === undefined ? {} : { "quick-search": ({ words }: { words: string }) => quickSearch(words) }),
      ...(modes === undefined ? {} : { mode: modeRunner(modes) }),
    },
    sources: {
      ...(glossary === undefined ? {} : { glossary: { ready: glossary.ready, terms: glossary.terms } }),
      ...(modes === undefined ? {} : { modes: modes.targets }),
    },
    ...(findMore === undefined ? {} : { findMore: findMoreRunners(slug, findMore) }),
    ...(quickSearch === undefined ? {} : { quickSearch }),
    ...(askThroughLens === undefined
      ? {}
      : {
          askThroughLens: (lens: string): ActionOutcome => {
            askThroughLens(lens);
            return CLOSE;
          },
        }),
  };
}

/**
 * **What a chip in a chat answer can press** (plan 261003f, Stage 2) — the
 * reading view's executor above, widened for a surface that has no bar around
 * it:
 *
 *  - **the reading view's own runners, by reference**: the bookmark is the
 *    memoised one (F6), the glossary pair the gated one (F1) — never a second
 *    copy made for chat;
 *  - **the tags**, which the bar takes from its shelf row instead (F4);
 *  - **a find**, which in the bar is an address rather than a runner;
 *  - **the jump of the surface the chat is drawn in** — the band's, which
 *    steps a covering band aside on a phone, or the dialog's plain one.
 *
 * **Not the reading view's `findMore`, nor its `quickSearch` row**: each is a
 * row of the bar's, not a proposal. A chat *Find “X”* chip goes on opening the
 * exact-words search; a quick search reaches chat as its own proposal,
 * `quick-search`, whose runner is in `reading.runners` above (since
 * 2026-10-07, plan 261007j), and so is a `mode`.
 *
 * Chat is the owner's, so this is only ever built for one.
 */
export function chatExecutor({
  reading,
  blocks,
  jump,
  tags,
  find,
}: {
  reading: CommandExecutor;
  blocks: Block[];
  jump(blockId: BlockId): void;
  tags: TagsControl;
  /** Open Search on these words — CommandBar.tsx § `findHref`. */
  find(words: string): void;
}): CommandExecutor {
  return {
    runners: {
      ...reading.runners,
      ...tagRunners(tags),
      "jump-first": jumpFirstRunner(blocks, jump),
      find: ({ words }) => {
        find(words);
        return CLOSE;
      },
    },
    sources: reading.sources,
  };
}
