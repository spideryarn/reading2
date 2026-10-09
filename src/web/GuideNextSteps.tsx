/**
 * **The guide's next steps, as a row of buttons under its latest answer** —
 * plan
 * docs/plans/261009r-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md.
 *
 * > I think the ideal would be if the chat has the ability to add certain
 * > simple UI components like buttons to kick things off […] so that it can
 * > take what the user has asked for and enable them to manually initiate
 * > things.
 * >
 * > — Greg, 2026-10-09, reply `spya-ujstyz` to q-w2740x
 *
 * The guide's `offer_next_steps` tool (src/chat-tools.ts) runs nothing: it
 * puts at most three checked steps on the turn's run (`ToolRun.steps`), and
 * this row is where each becomes a button the reader presses. Every press goes
 * through machinery that already exists, so there is still one way to do each
 * thing:
 *
 * - **ask** sends the words as the reader's own message, as a greeting start
 *   does. The words are the model's, so they are set in its face
 *   (docs/project/fonts.md), and drawn in full: what is on the button is
 *   exactly what is sent.
 * - **mode** is the chip `[cmd:mode:<key>]` would be (CommandChip.tsx), so
 *   `chipFor` decides at the draw and at the press whether this reader can
 *   open it here; a mode it refuses draws nothing.
 * - **search** is a box holding the words, which the reader may change, and
 *   the `quick-search` chip for whatever is in it: Search mode, its spinner.
 * - **share** goes to Metadata's *Access & sharing* card, where the bar's
 *   *Share this article* goes: the private link and the public switch are
 *   pressed there, with their own confirmation.
 * - **archive** goes to Metadata, whose top *Archive* button does it.
 *
 * **Never pressed by the guide.** This row is drawn outside the answer's
 * `GuideActContext` (ChatPanel.tsx), so a mode here is a press like a chip in
 * Chat; the guide's one act stays the inline chip's.
 *
 * Drawn under the latest settled answer only, from that answer's last valid
 * offer: three buttons is the most on screen at once (Greg's *"maybe three
 * would be about right"*), and an older answer's steps would be stale.
 */
import { Archive, Share2 } from "lucide-react";
import { useState } from "react";
import { checkNextSteps } from "../next-steps.js";
import type { ChatMessage, NextStep, ToolRun } from "../types.js";
import { chipFor } from "./chat-commands.js";
import { CommandChip, useChatCommands } from "./CommandChip.js";
import { type CommandExecutor, formatProposalToken } from "./command-proposal.js";
import { GuideActContext } from "./guide-acts.js";
import { withSection } from "./params.js";
import { carriedSearch, navigate, readHref } from "./router.js";
import { voiceClass } from "./voice.js";

/**
 * Our words for the two buttons that take the reader somewhere. Archive's
 * names both directions: this row does not know whether the article is
 * archived, and a fixed *Archive* over an archived one would say the opposite
 * of what Metadata offers (article-commands.ts § `archiveCommand`, GPT Sol's
 * F5 on the plan).
 */
export const STEP_WORDS = {
  share: "Share this article…",
  archive: "Archive or put back…",
} as const;

/**
 * **The steps an answer draws**: the last offer's, checked again — a run is
 * stored JSON. `null` for an answer that offered none, or none this page can
 * draw.
 */
export function stepsIn(tools: readonly ToolRun[] | undefined): NextStep[] | null {
  let last: NextStep[] | null = null;
  for (const run of tools ?? []) {
    if (run.name !== "offer_next_steps" || run.status !== "done" || run.steps === undefined) continue;
    const { steps } = checkNextSteps(run.steps);
    if (steps.length > 0) last = steps;
  }
  return last;
}

/** May this message carry the row: a finished answer, not one stopped or cut short. */
export function mayShowSteps(message: ChatMessage | undefined): message is ChatMessage {
  return (
    message !== undefined &&
    message.role === "assistant" &&
    message.status === "done" &&
    message.stopped !== true &&
    message.truncated !== true
  );
}

/** The Metadata page for this article, keeping the reader's place, at a section or at the top. */
function metadataHref(slug: string, section?: "access-sharing"): string {
  const here = carriedSearch(typeof window === "undefined" ? "" : window.location.search);
  return readHref(slug, section === undefined ? here : withSection(here, section), "metadata");
}

export function GuideNextSteps({
  slug,
  message,
  blocks,
  onAsk,
}: {
  slug: string;
  /** The conversation's latest message; the row is drawn only under a settled answer. */
  message: ChatMessage | undefined;
  blocks: ReadonlyMap<string, string>;
  onAsk(words: string): void;
}) {
  const commands = useChatCommands();
  if (!mayShowSteps(message)) return null;
  const steps = (stepsIn(message.tools) ?? []).filter((step) => drawable(step, commands, blocks));
  if (steps.length === 0) return null;
  return (
    /* **No act reaches in here**, wherever the row is drawn: a mode chip under
       a `GuideActContext` would press itself (CommandChip.tsx), and none of
       these may. ChatPanel draws the row outside every answer's context as
       well; this makes it true of the row, not of where it was put. */
    <GuideActContext.Provider value={null}>
      <fieldset className="chat-suggest guide-next-steps" aria-label="Next steps">
        <ul>
          {steps.map((step) => (
            <li key={JSON.stringify(step)}>
              <Step step={step} slug={slug} blocks={blocks} commands={commands} onAsk={onAsk} />
            </li>
          ))}
        </ul>
      </fieldset>
    </GuideActContext.Provider>
  );
}

/**
 * **Can this page draw this step now?** A mode only where `chipFor` would make
 * it a chip here (not experimental-and-off, not unknown, in this Dock), and a
 * mode or search only with an executor; filtered before the list is drawn, so a
 * row of refused modes is no row rather than an empty group (GPT Sol's F3).
 * The search's own chip is checked again for the reader's words as they type.
 */
function drawable(step: NextStep, commands: CommandExecutor | null, blocks: ReadonlyMap<string, string>): boolean {
  switch (step.kind) {
    case "mode":
      return commands !== null && chipFor(formatProposalToken({ id: "mode", key: step.mode }), commands, blocks) !== null;
    case "search":
      return commands !== null && chipFor(formatProposalToken({ id: "quick-search", words: step.words }), commands, blocks) !== null;
    case "ask":
    case "share":
    case "archive":
      return true;
    default: {
      const never: never = step;
      return never;
    }
  }
}

function Step({
  step,
  slug,
  blocks,
  commands,
  onAsk,
}: {
  step: NextStep;
  slug: string;
  blocks: ReadonlyMap<string, string>;
  commands: CommandExecutor | null;
  onAsk(words: string): void;
}) {
  switch (step.kind) {
    case "ask":
      return (
        <button type="button" className="chat-suggest-btn" onClick={() => onAsk(step.words)}>
          <span className={voiceClass("ai")}>{step.words}</span>
        </button>
      );
    /* `drawable` has checked both; `null` here only if the page changed
       between that and this, and then nothing rather than raw characters. */
    case "mode":
      return commands === null ? null : (
        <CommandChip raw={formatProposalToken({ id: "mode", key: step.mode })} commands={commands} blocks={blocks} />
      );
    case "search":
      return commands === null ? null : <SearchStep words={step.words} commands={commands} blocks={blocks} />;
    case "share":
      return (
        <button type="button" className="chat-suggest-btn" onClick={() => navigate(metadataHref(slug, "access-sharing"))}>
          <Share2 size={13} aria-hidden="true" /> {STEP_WORDS.share}
        </button>
      );
    case "archive":
      return (
        <button type="button" className="chat-suggest-btn" onClick={() => navigate(metadataHref(slug))}>
          <Archive size={13} aria-hidden="true" /> {STEP_WORDS.archive}
        </button>
      );
    default: {
      const never: never = step;
      return never;
    }
  }
}

/**
 * **A quick search the reader can change before pressing** — Greg: *"it would
 * show an input box and a button and you could tweak the input and then press
 * the button. That way we're de-risking it."* The button is the
 * `quick-search` chip for what is in the box now, so its label, its spinner,
 * its refusal and `chipFor`'s check at the press are the chip's. An empty box
 * draws no button.
 */
function SearchStep({
  words,
  commands,
  blocks,
}: {
  words: string;
  commands: CommandExecutor;
  blocks: ReadonlyMap<string, string>;
}) {
  const [now, setNow] = useState(words);
  const trimmed = now.replace(/\s+/g, " ").trim();
  const raw = formatProposalToken({ id: "quick-search", words: trimmed });
  return (
    <div className="guide-next-search">
      <input
        type="search"
        className="guide-next-search-box"
        aria-label="Words to search this article for"
        value={now}
        maxLength={120}
        onChange={(event) => setNow(event.target.value)}
      />
      {trimmed !== "" && chipFor(raw, commands, blocks) !== null && (
        <CommandChip
          /* Keyed by the words, so a chip that said something after a press
             starts fresh for new words. */
          key={trimmed}
          raw={raw}
          commands={commands}
          blocks={blocks}
        />
      )}
    </div>
  );
}
