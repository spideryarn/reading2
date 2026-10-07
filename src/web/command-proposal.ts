/**
 * **A command with its argument, as a value** — what the command bar's typed
 * argument rows and chat's command chips are both made of, and the one function
 * that runs one.
 *
 * Plan 261003f, Stage 1 part 0, and GPT Sol's F8 on that plan: the first draft
 * had the bar parse free text and chat re-parse its own answer's sentences, two
 * routes to "what does this ask for" that would drift. So there is one
 * descriptor, `CommandProposal`, and two ways to arrive at it — the bar's verb
 * table (command-match.ts § `parseArgumentQuery`, then `resolveArgument` here)
 * and a stored token (`parseProposalToken`) that is an exact id and an encoded
 * argument, never a sentence. Both end in `runProposal`, against the runners
 * the page the reader is standing on supplies.
 *
 * Pure, no React, no browser API — command-match.ts's reason: everything here
 * that can be wrong is testable without a DOM (tests/command-proposal.test.ts).
 *
 * The line every row here sits on is the one Greg accepted on 2026-10-02
 * (docs/project/chat-llm-help-commands-vision.md § Decided): *navigate freely,
 * **propose** anything that writes or spends — the reader presses — and never
 * destroy or publish from a sentence.* `RISK` is that line, per id.
 */
import { ASKED_TERM_REFUSED, parseAskedTerm } from "../asked-term.js";
import { COMMAND_TOKEN_SOURCE } from "../command-token.js";
import { isSpideryarnId } from "../ids.js";
import { normaliseTag } from "../tags.js";
import type { BlockId, GlossaryEntry } from "../types.js";
import { type ActionOutcome, type ArgumentQuery, canonical } from "./command-match.js";
import type { FindMoreMode } from "./find-more.js";

/**
 * **Everything a proposal can ask for.** Nine ids, and an argument each.
 *
 * `bookmark` has no verb in the bar — a reader has no block id to type — and
 * is here for chat (Stage 2), which can name the passage it is talking about.
 *
 * **`mode` and `quick-search` since 2026-10-07**, for Chat and the guide both
 * (docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md;
 * Greg: *"all of the main chats should probably have all the same tools"*).
 * Neither has a verb in the bar either: the bar has its own mode rows and its
 * own *Quick search “X”* row, and these are those rows as a model may name
 * them. A `mode` key is a command-pick catalogue id — `mode:glossary`,
 * `submode:learn:tutorial` (command-match.ts § `commandId`) — and parsing it
 * says only that it is shaped like one: whether the reader can open it *here*
 * is the live set's to say (`ArgumentSources.modes`, GPT Sol's F3).
 */
export type CommandProposal =
  | { readonly id: "jump-first"; readonly words: string }
  | { readonly id: "find"; readonly words: string }
  | { readonly id: "glossary-open"; readonly termId: BlockId }
  | { readonly id: "glossary-ask"; readonly term: string }
  | { readonly id: "tag-add"; readonly tag: string }
  | { readonly id: "tag-remove"; readonly tag: string }
  | { readonly id: "bookmark"; readonly blockId: BlockId }
  | { readonly id: "mode"; readonly key: string }
  | { readonly id: "quick-search"; readonly words: string };

export type ProposalId = CommandProposal["id"];
type ProposalOf<K extends ProposalId> = Extract<CommandProposal, { id: K }>;

/** Moves the reader, writes the reader's own data (reversibly), or spends a model call. */
export type Risk = "navigate" | "writes" | "spends";

/**
 * **What pressing each one does to the world** — moves the reader, writes the
 * reader's own data (reversibly), or spends a model call.
 *
 * A `Record` over the ids, so a tenth id is a compile error here before it
 * is a row. The bar's `generates` marker is read off this
 * (`proposalWords`), never written beside it, so the two cannot disagree.
 *
 * **`mode` is the one id whose answer is its target's** (`"per-mode"`): opening
 * Structure moves the reader, opening Summary may write one (GPT Sol's F3 on
 * plan 261007j). One id cannot honestly say both, so `proposalRisk` asks the
 * mode itself — `modeGenerates` / `subModeGenerates` in activation.ts, the
 * table the bar's own mode rows read — through the resolved `ModeTarget`.
 */
export const RISK: Readonly<Record<ProposalId, Risk | "per-mode">> = {
  "jump-first": "navigate",
  find: "navigate",
  "glossary-open": "navigate",
  "glossary-ask": "spends",
  "tag-add": "writes",
  "tag-remove": "writes",
  bookmark: "writes",
  mode: "per-mode",
  /* A quick search is a model call and a saved row — the bar's own row says
     `generates` for it (CommandBar.tsx § `quickSearchRow`). */
  "quick-search": "spends",
};

/**
 * **What this press does to the world**, `RISK` with the one per-target id
 * resolved. A `mode` with no target in hand says `spends`: over-warning is the
 * direction that costs nothing (activation.ts § `modeGenerates`).
 */
export function proposalRisk(proposal: CommandProposal, target?: ModeTarget): Risk {
  const risk = RISK[proposal.id];
  if (risk !== "per-mode") return risk;
  return target === undefined || target.generates ? "spends" : "navigate";
}

export const PROPOSAL_IDS = Object.keys(RISK) as readonly ProposalId[];

/** Longest a `find` or jump phrase may be in a token — a ceiling, not a design limit. */
const MAX_WORDS = 200;

/**
 * **The shape of a catalogue key for a mode or a sub-mode** — `commandId`'s
 * two mode arms (command-match.ts). Only the shape: what the key names, and
 * whether it can be opened here, is `ArgumentSources.modes`'.
 */
const MODE_KEY = /^(?:mode:[a-z-]+|submode:[a-z-]+:[a-z-]+)$/;

/**
 * **A proposal whose argument its own command accepts**, or `null`.
 *
 * Each id's rule is the one its command already has, imported rather than
 * restated: `normaliseTag` (which also gives the stored spelling), the block-id
 * pattern, `parseAskedTerm` (the glossary ask's server-side rule). A token
 * carrying something the bar would refuse is therefore `null`, and chat shows
 * it as plain text.
 */
function checked(id: ProposalId, argument: string): CommandProposal | null {
  switch (id) {
    /* A quick search takes what a typed `find X` would: the bar draws its
       *Quick search “X”* row for exactly those words (CommandBar.tsx §
       `argumentRowsFor`). */
    case "jump-first":
    case "find":
    case "quick-search": {
      const words = argument.replace(/\s+/g, " ").trim();
      return words === "" || words.length > MAX_WORDS ? null : { id, words };
    }
    case "mode":
      return MODE_KEY.test(argument) ? { id, key: argument } : null;
    case "glossary-open":
      return isSpideryarnId(argument) ? { id, termId: argument } : null;
    case "bookmark":
      return isSpideryarnId(argument) ? { id, blockId: argument } : null;
    case "glossary-ask": {
      const parsed = parseAskedTerm(argument);
      return parsed.ok ? { id, term: parsed.term } : null;
    }
    case "tag-add":
    case "tag-remove": {
      const spelling = normaliseTag(argument);
      return spelling.ok ? { id, tag: spelling.tag } : null;
    }
    default: {
      const never: never = id;
      return never;
    }
  }
}

/** The one argument of a proposal, whichever field holds it. */
function argumentOf(proposal: CommandProposal): string {
  switch (proposal.id) {
    case "jump-first":
    case "find":
    case "quick-search":
      return proposal.words;
    case "mode":
      return proposal.key;
    case "glossary-open":
      return proposal.termId;
    case "glossary-ask":
      return proposal.term;
    case "tag-add":
    case "tag-remove":
      return proposal.tag;
    case "bookmark":
      return proposal.blockId;
    default: {
      const never: never = proposal;
      return never;
    }
  }
}

/**
 * **Percent-encoding of everything but letters, digits and `-`** — tighter
 * than `encodeURIComponent`, which leaves `*`, `_`, `(` and `)` alone. The
 * token sits in Markdown prose (Stage 2), where those are emphasis and link
 * syntax, so none of them may appear inside it.
 */
function encodeArgument(argument: string): string {
  return encodeURIComponent(argument).replace(
    /[^A-Za-z0-9%-]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

/* The shape is src/command-token.ts's, shared with the server's citation
   counters; anchored here, since this parses exactly one token. */
const TOKEN = new RegExp(`^${COMMAND_TOKEN_SOURCE}$`);

/**
 * **The stored form of a proposal**: `[cmd:<id>:<encoded argument>]`, the
 * shape chat's block chips already have (`[spya-…]`), so it can live in an
 * answer's text and be found there.
 */
export function formatProposalToken(proposal: CommandProposal): string {
  return `[cmd:${proposal.id}:${encodeArgument(argumentOf(proposal))}]`;
}

/**
 * **A token back to a proposal — or `null`**, for anything that is not exactly
 * one: a sentence, an unknown id, an argument that does not decode, or one its
 * command refuses. Never a guess: chat's text is parsed, never trusted (the
 * accepted line).
 */
export function parseProposalToken(text: string): CommandProposal | null {
  const match = TOKEN.exec(text);
  if (match === null) return null;
  const [, id, encoded] = match;
  if (id === undefined || encoded === undefined) return null;
  if (!(PROPOSAL_IDS as readonly string[]).includes(id)) return null;
  let argument: string;
  try {
    argument = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  return checked(id as ProposalId, argument);
}

/**
 * **The glossary the reader can see, as the bar may match against it** —
 * handed in by the reading view, the only page with a glossary read.
 *
 * `terms` is the **visible** list (GPT Sol's F2 on plan 261003f): Reader's
 * `terms`, after `shownEntries`, so a term the owner hid is never offered.
 * `ready` is the read having settled with a glossary in it (F1): loading or a
 * failed read is not evidence a term is absent, and an article with no
 * glossary would *generate one on open* — so the ask row waits for `ready`.
 */
export interface GlossaryLookupSource {
  readonly ready: boolean;
  readonly terms: readonly Pick<GlossaryEntry, "id" | "name" | "aliases">[];
}

/**
 * **A mode or sub-mode the reader can open here, now**, as a `mode` proposal
 * resolves to it — built by the reading view from the Dock's own reachable
 * set (command-runners.ts § `modeDoor`), never from the whole catalogue.
 */
export interface ModeTarget {
  /** The catalogue key: `mode:glossary`, `submode:learn:tutorial`. */
  readonly key: string;
  /** Its name as the reader sees it: `Glossary`, `Learn › Tutorial`. */
  readonly label: string;
  /** The bar's own sentence about it. */
  readonly description: string;
  /** Whether opening it may start work — `modeGenerates` / `subModeGenerates`. */
  readonly generates: boolean;
}

/** What a typed argument can be matched against where the reader is standing. */
export interface ArgumentSources {
  readonly glossary?: GlossaryLookupSource | undefined;
  /**
   * **The modes and sub-modes the reader can open here now, by catalogue
   * key** (GPT Sol's F3 on plan 261007j): the Dock's reachable set — the
   * experimental switch, the mode open now — and its sub-mode rows, exactly as
   * the command bar lists them. Absent means no `mode` proposal resolves.
   */
  readonly modes?: ReadonlyMap<string, ModeTarget> | undefined;
}

/**
 * **One argument row, before it is a command** — a proposal ready to run, or
 * the words the reader typed and why they cannot be one. A refused row is
 * still drawn: its Enter keeps the bar open with the reason (an invalid tag),
 * rather than the row vanishing and the reader not knowing why.
 *
 * `shown` is a display name where the proposal's argument is an id — a term's
 * name for `glossary-open`.
 */
export type ProposedRow =
  | { readonly kind: "ready"; readonly proposal: CommandProposal; readonly shown?: string }
  | { readonly kind: "refused"; readonly id: ProposalId; readonly shown: string; readonly reason: string };

/**
 * **What a parsed query offers, against what is here.** Find and jump pass
 * straight through; a tag is normalised or refused; glossary words are matched.
 *
 * **The glossary match, in order** (F2): entries whose *name* is the words,
 * then entries with an alias that is, compared as `canonical` compares — so
 * `FE` and `fe` are one, and nothing is folded further. An alias two entries
 * share is one row each; which one the reader meant is theirs to say. No match
 * and a settled glossary offers the ask, refused with the server's own
 * sentence if the server would refuse it (src/asked-term.ts).
 */
export function resolveArgument(query: ArgumentQuery, sources: ArgumentSources): readonly ProposedRow[] {
  switch (query.kind) {
    case "find":
    case "jump-first":
      return [{ kind: "ready", proposal: { id: query.kind, words: query.words } }];
    case "tag-add":
    case "tag-remove": {
      const spelling = normaliseTag(query.words);
      return spelling.ok
        ? [{ kind: "ready", proposal: { id: query.kind, tag: spelling.tag } }]
        : [{ kind: "refused", id: query.kind, shown: query.words, reason: spelling.reason }];
    }
    case "glossary":
      return glossaryRows(query.words, sources.glossary);
    default: {
      const never: never = query;
      return never;
    }
  }
}

function glossaryRows(words: string, glossary: GlossaryLookupSource | undefined): readonly ProposedRow[] {
  if (glossary === undefined) return [];
  const wanted = canonical(words);
  const named = glossary.terms.filter((t) => canonical(t.name) === wanted);
  const aliased = glossary.terms.filter(
    (t) => !named.includes(t) && t.aliases.some((a) => canonical(a) === wanted),
  );
  const matches = [...named, ...aliased];
  if (matches.length > 0) {
    return matches.map((t) => ({
      kind: "ready",
      proposal: { id: "glossary-open", termId: t.id },
      shown: t.name,
    }));
  }
  if (!glossary.ready) return [];
  const parsed = parseAskedTerm(words);
  return parsed.ok
    ? [{ kind: "ready", proposal: { id: "glossary-ask", term: parsed.term } }]
    : [{ kind: "refused", id: "glossary-ask", shown: words, reason: ASKED_TERM_REFUSED[parsed.fault] }];
}

/** A row's words, in the bar's shape (command-match.ts § `CommandWords`). */
export interface ProposalWords {
  readonly label: string;
  readonly description: string;
  readonly generates: boolean;
}

/**
 * **What a proposal's row says** — and, from `RISK`, whether it carries the
 * `generates` marker. `shown` is the display name a `glossary-open` row needs
 * (its argument is an id); the others ignore it. `target` is what a `mode`
 * proposal resolved to here, which carries its name and its own marker.
 */
export function proposalWords(proposal: CommandProposal, shown?: string, target?: ModeTarget): ProposalWords {
  const generates = proposalRisk(proposal, target) === "spends";
  switch (proposal.id) {
    case "jump-first":
      return {
        label: `Jump to the first “${proposal.words}”`,
        description: "The first place the article says it. Back returns you here.",
        generates,
      };
    case "find":
      return {
        label: `Find “${proposal.words}” in this article`,
        description: "Search mode, every place these words appear.",
        generates,
      };
    case "glossary-open":
      return {
        label: `Glossary: “${shown ?? "this term"}”`,
        description: "Its entry in this article's glossary.",
        generates,
      };
    case "glossary-ask":
      return {
        label: `Look up “${proposal.term}” in this article`,
        description: "Finds it in the piece, explains the passage, and adds it to your glossary.",
        generates,
      };
    case "tag-add":
      return {
        label: `Add the tag “${proposal.tag}”`,
        description: "One of your own tags on this article. Only you see them.",
        generates,
      };
    case "tag-remove":
      return {
        label: `Remove the tag “${proposal.tag}”`,
        description: "Takes it off this article; your other articles keep theirs.",
        generates,
      };
    case "bookmark":
      return { label: "Bookmark this passage", description: "In your comments, with no note.", generates };
    /* The bar's own words for both: a mode row's label and sentence, and the
       *Quick search “X”* row's (CommandBar.tsx § `quickSearchRow`). No quotes
       round a mode's name: it is ours, not the model's (CommandChip.tsx §
       `voiced`). */
    case "mode":
      return {
        label: `Open ${target?.label ?? "that mode"}`,
        description: target?.description ?? "",
        generates,
      };
    case "quick-search":
      return {
        label: `Quick search “${proposal.words}”`,
        description: "Search mode, a fast first pass for the passages about this.",
        generates,
      };
    default: {
      const never: never = proposal;
      return never;
    }
  }
}

/** What a runner hands back — the bar's `ActionOutcome`, now or later. */
export type Outcome = ActionOutcome | Promise<ActionOutcome>;

/**
 * **What can be run where the reader is standing** — one optional runner per
 * id, each built by the page from the controller that already owns that state
 * (plan 261003f, F3, F4, F6): the reading view's `jumpTo`, its
 * `openTermInGlossary`, the glossary-ask hand-off, its memoised bookmarker;
 * the shelf row's tags controller on either page.
 *
 * **Absent means not offered here**, never a row that fails: the Metadata page
 * has no prose and no glossary read (F1), so its runners are the tags alone.
 */
export type ProposalRunners = {
  readonly [K in ProposalId]?: (proposal: ProposalOf<K>) => Outcome;
};

/**
 * **The one dispatcher** — the runner for this proposal's id, pressed once, or
 * `null` where there is none. The `switch` is what lets each arm hand its
 * runner the narrowed proposal; the `never` makes an eighth id a compile error.
 */
export function runProposal(runners: ProposalRunners, proposal: CommandProposal): Outcome | null {
  switch (proposal.id) {
    case "jump-first":
      return runners["jump-first"]?.(proposal) ?? null;
    case "find":
      return runners.find?.(proposal) ?? null;
    case "glossary-open":
      return runners["glossary-open"]?.(proposal) ?? null;
    case "glossary-ask":
      return runners["glossary-ask"]?.(proposal) ?? null;
    case "tag-add":
      return runners["tag-add"]?.(proposal) ?? null;
    case "tag-remove":
      return runners["tag-remove"]?.(proposal) ?? null;
    case "bookmark":
      return runners.bookmark?.(proposal) ?? null;
    case "mode":
      return runners.mode?.(proposal) ?? null;
    case "quick-search":
      return runners["quick-search"]?.(proposal) ?? null;
    default: {
      const never: never = proposal;
      return never;
    }
  }
}

/**
 * **What the bar and a chat chip say when a row's runner went between drawing
 * and pressing** — the executor is rebuilt on every Reader render, so a row
 * drawn a moment ago may find its page no longer offers it (a comments read
 * that failed since).
 */
export const NOT_HERE = "That can't be done from here any more.";

/**
 * **What a reader is told about a row that would start work**, and it is one
 * plain verb rather than a glyph or a figure.
 *
 * Fable's reasoning, 2026-09-07, arbitrating GPT Sol's F1: a glyph needs a
 * tooltip to mean anything and *"a tooltip is not read by anybody in a hurry"*
 * (this repo's own words, 260906b); a coin would make it about money, which
 * readers do not pay per call since they hold slots; a spark would read as "AI
 * magic", which is the flattening voice vision.md rejects. `generates` names
 * what happens.
 *
 * Which rows carry it is `commandGenerates` in CommandBar.tsx. For a mode that
 * is `modeGenerates` in activation.ts, derived from a table that is already
 * total — so mode fifteen gets its marker decided by the row it must already
 * write. That docblock has what the marker deliberately does not say, and
 * where it over-warns. Here rather than in CommandBar.tsx since 2026-10-03,
 * because chat's chips draw it too (CommandChip.tsx).
 */
export const GENERATES_MARKER = "generates";

/** Whether there is a runner for this id here — the bar's gate on drawing a row. */
export function canRun(runners: ProposalRunners, id: ProposalId): boolean {
  return runners[id] !== undefined;
}

/**
 * **What a page can do with a proposal, and what it can match one against** —
 * the executor the plan names (F8), handed to the bar by the reading view
 * (Reader.tsx), the one page that has prose to jump in and a glossary to look
 * in. The tags runners are not in it: they come with the shelf row on either
 * page (CommandBar.tsx § `ShelfRow.tags`, F4), and the bar adds them.
 */
export interface CommandExecutor {
  readonly runners: ProposalRunners;
  readonly sources: ArgumentSources;
  /**
   * **The bands whose *Find more* the bar may press, each with its press** —
   * since 2026-10-04, plan 261004k. Not a proposal: it takes no argument, so
   * it is a row of the bar's own (find-more.ts § `findMoreCommand`) and chat's
   * chips never see it (command-runners.ts § `chatExecutor`).
   *
   * **A band is in here only while its list can be added to**, as the reading
   * view's own read says (Reader.tsx, find-more.ts § `glossaryAppendOnOffer`)
   * — absent means no row, the rule `runners` follows.
   */
  readonly findMore?: FindMorePresses | undefined;
  /**
   * **Run a quick search for these words** — since 2026-10-05, plan 261005i:
   * what the bar's *Quick search “X”* row presses, drawn in front of every
   * *Find “X”* row. The bar's own row, like `findMore`; a chat *Find “X”*
   * chip stays the exact-words address. **Since 2026-10-07 a chat chip can
   * run the same search** as the `quick-search` proposal, whose runner calls
   * this same press (command-runners.ts § `readingExecutor`).
   *
   * **Absent means not offered**: the reading view hands it over for the
   * owner alone, the cut the bar's own quick-search box makes (Dock.tsx §
   * `hasQuickSearch`), because only the owner's band can ask.
   */
  readonly quickSearch?: ((words: string) => ActionOutcome) | undefined;
  /**
   * **Put a question about the debate, seen from this angle, in Chat's box** —
   * since 2026-10-05, plan 261005k: what the bar's suggested lens row presses.
   * The reading view's own waiting handoff (Reader.tsx §
   * `suggestedLensInChat`), deliberately not the sending wrapper Debate's box
   * calls, so nothing is sent until the reader presses Send. The bar's own,
   * like `quickSearch`: chat's chips never see it.
   *
   * **Absent means not offered**: handed over for the owner alone, because
   * Chat is the owner's.
   */
  readonly askThroughLens?: ((lens: string) => ActionOutcome) | undefined;
}

/** One press per band that offers an append now; a band not named offers none. */
export type FindMorePresses = { readonly [M in FindMoreMode]?: () => ActionOutcome };

/**
 * **A refused row's words** — the label its proposal would have had, made from
 * what the reader typed, so *Add the tag “a, b”* is drawn and its Enter says
 * why it cannot be.
 */
export function rowWords(row: ProposedRow): ProposalWords {
  if (row.kind === "ready") return proposalWords(row.proposal, row.shown);
  return proposalWords(unchecked(row.id, row.shown));
}

/** A proposal for display only — the argument as typed, never run. */
function unchecked(id: ProposalId, shown: string): CommandProposal {
  switch (id) {
    case "jump-first":
    case "find":
      return { id, words: shown };
    case "glossary-open":
      return { id, termId: shown };
    case "glossary-ask":
      return { id, term: shown };
    case "tag-add":
    case "tag-remove":
      return { id, tag: shown };
    case "bookmark":
      return { id, blockId: shown };
    case "mode":
      return { id, key: shown };
    case "quick-search":
      return { id, words: shown };
    default: {
      const never: never = id;
      return never;
    }
  }
}
