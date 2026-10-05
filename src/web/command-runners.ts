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
import type { ActionOutcome } from "./command-match.js";
import type {
  CommandExecutor,
  CommandProposal,
  FindMorePresses,
  GlossaryLookupSource,
  Outcome,
} from "./command-proposal.js";
import { FIND_MORE_MODES, type FindMoreMode } from "./find-more.js";
import { handOffFindMore } from "./find-more-handoff.js";
import { handOffGlossaryAsk } from "./glossary-ask-handoff.js";
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
      return { kind: "stay", message: `Couldn't ${verb} that tag. ${(err as Error).message}` };
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
 *    the owner while that band's list can be added to (`findMoreRunners`).
 */
export function readingExecutor({
  slug,
  blocks,
  jump,
  glossary,
  bookmark,
  findMore,
}: {
  slug: string;
  blocks: Block[];
  /** The deliberate jump — `jumpTo` from reader/useReadingPosition.ts (F3). */
  jump(blockId: BlockId): void;
  glossary?: (GlossaryLookupSource & { openTerm(termId: BlockId): void; openGlossary(): void }) | undefined;
  bookmark?: ((blockId: BlockId) => Promise<boolean>) | undefined;
  findMore?: FindMoreOpeners | undefined;
}): CommandExecutor {
  return {
    runners: {
      "jump-first": jumpFirstRunner(blocks, jump),
      ...(glossary === undefined ? {} : glossaryRunners({ slug, ...glossary })),
      ...(bookmark === undefined ? {} : { bookmark: bookmarkRunner(blocks, bookmark) }),
    },
    sources: glossary === undefined ? {} : { glossary: { ready: glossary.ready, terms: glossary.terms } },
    ...(findMore === undefined ? {} : { findMore: findMoreRunners(slug, findMore) }),
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
 * **Not the reading view's `findMore`**: that is a row of the bar's, not a
 * proposal, and no chip token names it.
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
