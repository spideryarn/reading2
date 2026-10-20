/**
 * **The guide's next steps, as a row of buttons under its latest answer** —
 * plan
 * docs/plans/261009u-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md.
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
 * - **chat** starts a fresh Chat with the words as its first question, and
 *   sends it: the list's own *new conversation* box (`onSendNew`), since the
 *   guide only ever opens in Chat's band. Drawn first, and the one orange
 *   button, because Greg watched readers miss the guide's suggestions (plan
 *   docs/plans/261012f-guide-hands-content-questions-to-a-new-chat.md):
 *
 *   > I guess this needs to be pretty sort of prominent because when I watch
 *   > people using the guide, they often didn't notice that it was suggesting
 *   > actions for them to take.
 *   >
 *   > — Greg, 2026-10-12, `spya-es283p`
 *
 * - **mode** is the chip `[cmd:mode:<key>]` would be (CommandChip.tsx), so
 *   `chipFor` decides at the draw and at the press whether this reader can
 *   open it here; a mode it refuses draws nothing.
 * - **search** is a box holding the words, which the reader may change, and
 *   the `quick-search` chip for whatever is in it, which runs the search under
 *   the answer (ChatSearchCard.tsx, plan 261011aa).
 * - **share** goes to Metadata's *Access & sharing* card, where the bar's
 *   *Share this article* goes: the private link and the public switch are
 *   pressed there, with their own confirmation.
 * - **archive** goes to Metadata, whose top *Archive* or *Put back* button does it.
 *
 * **Never pressed by the guide**: each is a button the reader presses, like
 * every chip in a guide answer (plan 261011m).
 *
 * Drawn under the latest settled answer only, from that answer's last valid
 * offer: three buttons is the most on screen at once (Greg's *"maybe three
 * would be about right"*), and an older answer's steps would be stale.
 */
import { Archive, Hourglass, LoaderCircle, MessageSquare, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { checkNextSteps } from "../next-steps.js";
import { preparable } from "../preparable-modes.js";
import { takeAnsweredHere } from "./chat/answered-here.js";
import { type PrepareOutcome, pressFor, pressPrepare } from "./prepare-press.js";
import type { ChatMessage, NextStep, ToolRun } from "../types.js";
import { chipFor } from "./chat-commands.js";
import { CommandChip, useChatCommands } from "./CommandChip.js";
import { type CommandExecutor, formatProposalToken } from "./command-proposal.js";
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
  chat: "Ask in Chat:",
  share: "Share this article…",
  archive: "Archive or put back…",
} as const;

/**
 * **The steps an answer draws**: the last offer's, checked again — a run is
 * stored JSON. `null` for an answer that made no valid offer; page-specific
 * checks such as `chipFor` happen later in `drawable`.
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

/**
 * **The order the row draws**: a `chat` step first, the rest as the model put
 * them. The press most worth not missing goes where the eye lands.
 */
export function inDrawOrder(steps: readonly NextStep[]): NextStep[] {
  return [...steps.filter((s) => s.kind === "chat"), ...steps.filter((s) => s.kind !== "chat")];
}

export function GuideNextSteps({
  slug,
  threadId,
  message,
  blocks,
  onAsk,
  onChat,
}: {
  slug: string;
  /** The guide conversation, which a `prepare` step's automatic press claims. Absent: no prepare step. */
  threadId?: string | undefined;
  /** The conversation's latest message; the row is drawn only under a settled answer. */
  message: ChatMessage | undefined;
  blocks: ReadonlyMap<string, string>;
  onAsk(words: string): void;
  /**
   * Start a fresh Chat and send `words` as its first question. Absent where
   * nothing can start one, and then a `chat` step draws nothing.
   */
  onChat?: ((words: string) => void) | undefined;
}) {
  const commands = useChatCommands();
  if (!mayShowSteps(message)) return null;
  const reasonOffered = offersAReason(message.tools);
  const steps = inDrawOrder(
    (stepsIn(message.tools) ?? []).filter((step) =>
      drawable(step, commands, blocks, onChat !== undefined, reasonOffered),
    ),
  );
  if (steps.length === 0) return null;
  return (
    <fieldset className="chat-suggest guide-next-steps">
      {/* Seen, not only announced: readers missed an unlabelled row (plan 261012f). */}
      <legend className="guide-next-steps-legend">Next steps</legend>
      <ul>
        {steps.map((step) => (
          /* The same suggestion can recur in a later answer. Its search box
             and CommandChip status belong to that answer, not merely to the
             step's words, so the message id is part of the identity. */
          <li key={`${message.id}:${JSON.stringify(step)}`}>
            <Step
              step={step}
              slug={slug}
              threadId={threadId}
              answerId={message.id}
              blocks={blocks}
              commands={commands}
              onAsk={onAsk}
              onChat={onChat}
            />
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/**
 * **Can this page draw this step now?** A mode only where `chipFor` would make
 * it a chip here (not experimental-and-off, not unknown, in this Dock), and a
 * mode or search only with an executor; filtered before the list is drawn, so a
 * row of refused modes is no row rather than an empty group (GPT Sol's F3).
 * The search's own chip is checked again for the reader's words as they type.
 */
function drawable(
  step: NextStep,
  commands: CommandExecutor | null,
  blocks: ReadonlyMap<string, string>,
  canChat: boolean,
  reasonOffered: boolean,
): boolean {
  switch (step.kind) {
    case "mode":
      return commands !== null && chipFor(formatProposalToken({ id: "mode", key: step.mode }), commands, blocks) !== null;
    /* Only a mode this reader could open here, as a mode step; and never Skim
       beside an offer of their reason, whose save lands after the answer, so
       a route started now would be planned on the old one. The server refuses
       that pair too, when the offer comes first; this holds it whichever
       order the model wrote them (GPT Sol's F4 on plan 261019p § Stage 2b). */
    case "prepare":
      return (
        commands !== null &&
        preparable(step.mode) !== undefined &&
        !(reasonOffered && preparable(step.mode)?.step === "skim") &&
        chipFor(formatProposalToken({ id: "mode", key: step.mode }), commands, blocks) !== null
      );
    case "search":
      return commands !== null && chipFor(formatProposalToken({ id: "quick-search", words: step.words }), commands, blocks) !== null;
    case "chat":
      return canChat;
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
  threadId,
  answerId,
  blocks,
  commands,
  onAsk,
  onChat,
}: {
  step: NextStep;
  slug: string;
  threadId: string | undefined;
  answerId: string;
  blocks: ReadonlyMap<string, string>;
  commands: CommandExecutor | null;
  onAsk(words: string): void;
  onChat: ((words: string) => void) | undefined;
}) {
  switch (step.kind) {
    case "ask":
      return (
        <button type="button" className="chat-suggest-btn" onClick={() => onAsk(step.words)}>
          <span className={voiceClass("ai")}>{step.words}</span>
        </button>
      );
    /* What is on the button is what is sent, as with `ask`: the words in the
       model's face, after our own label. */
    case "chat":
      return onChat === undefined ? null : <ChatStep words={step.words} onChat={onChat} />;
    /* `drawable` has checked both; `null` here only if the page changed
       between that and this, and then nothing rather than raw characters. */
    case "mode":
      return commands === null ? null : (
        <CommandChip raw={formatProposalToken({ id: "mode", key: step.mode })} commands={commands} blocks={blocks} />
      );
    case "search":
      return commands === null ? null : <SearchStep words={step.words} commands={commands} blocks={blocks} />;
    case "prepare":
      return threadId === undefined ? null : (
        <PrepareStep slug={slug} threadId={threadId} answerId={answerId} mode={step.mode} now={step.now} />
      );
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

/** Did this answer offer to save the reader's reason (a card, pressed or saving itself)? */
export function offersAReason(tools: readonly ToolRun[] | undefined): boolean {
  return (tools ?? []).some((run) => run.name === "offer_to_save" && run.status === "done" && run.offer?.field === "purpose");
}

/** The words a prepare step shows, in each state. Ours, not the model's. */
export const PREPARE_WORDS = {
  idle: (name: string) => `Get ${name} ready`,
  pressing: (name: string) => `Getting ${name} ready…`,
  started: (name: string) => `Started: ${name} will be ready soon`,
  ready: (name: string) => `${name} is ready`,
  failed: (name: string) => `Could not start ${name}. Try again`,
} as const;

/**
 * **Get a mode ready, without opening it** — plan 261019p § Stage 2b, Greg's
 * reply to q-y4p2ct. The reader's press (B), or, for a step the guide marked
 * `now`, the page's own, once, on an answer this tab watched being written
 * (`takeAnsweredHere`, the save card's rule): never on a reload, never twice
 * (A). Either way the button says what happened, so a start is never hidden,
 * and it never says *ready* until the server found the mode made. A `now`
 * press the conversation had already spent comes back as an ordinary button.
 */
function PrepareStep({
  slug,
  threadId,
  answerId,
  mode,
  now,
}: {
  slug: string;
  threadId: string;
  answerId: string;
  mode: string;
  now: boolean;
}) {
  const name = preparable(mode)?.name ?? mode;
  const [state, setState] = useState<"idle" | "pressing" | PrepareOutcome["kind"]>("idle");
  const live = useRef(true);
  const press = (auto: boolean) => {
    setState("pressing");
    void pressPrepare(slug, { mode, threadId, now: auto }, answerId).then((outcome) => {
      if (live.current) setState(outcome.kind === "refused" ? "idle" : outcome.kind);
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per mount; the answer id keys the row, and `takeAnsweredHere` is true once
  useEffect(() => {
    live.current = true;
    const earlier = pressFor(answerId, mode);
    if (earlier) {
      setState("pressing");
      void earlier.then((outcome) => live.current && setState(outcome.kind === "refused" ? "idle" : outcome.kind));
    } else if (now && takeAnsweredHere(answerId, `prepare:${mode}`)) {
      press(true);
    }
    return () => {
      live.current = false;
    };
  }, []);
  const words =
    state === "idle"
      ? PREPARE_WORDS.idle(name)
      : state === "pressing"
        ? PREPARE_WORDS.pressing(name)
        : state === "started"
          ? PREPARE_WORDS.started(name)
          : state === "ready"
            ? PREPARE_WORDS.ready(name)
            : PREPARE_WORDS.failed(name);
  const pressable = state === "idle" || state === "failed";
  return (
    <button
      type="button"
      className="chat-suggest-btn"
      disabled={!pressable}
      aria-live="polite"
      onClick={() => pressable && press(false)}
    >
      {state === "pressing" ? (
        <LoaderCircle size={13} className="cmt-spinner" aria-hidden="true" />
      ) : (
        <Hourglass size={13} aria-hidden="true" />
      )}{" "}
      {words}
    </button>
  );
}

/**
 * **One activation, one fresh Chat.** Navigation normally removes this button
 * straight after the press, but two click events can arrive before React paints
 * that navigation. The ref closes that synchronous window; `disabled` tells the
 * reader the press was taken while the new conversation replaces the guide.
 * Plan 261012f.
 */
function ChatStep({ words, onChat }: { words: string; onChat(words: string): void }) {
  const sent = useRef(false);
  const [disabled, setDisabled] = useState(false);
  const send = () => {
    if (sent.current) return;
    sent.current = true;
    setDisabled(true);
    onChat(words);
  };
  return (
    <button type="button" className="guide-next-chat" disabled={disabled} onClick={send}>
      <MessageSquare size={14} aria-hidden="true" />
      <span>
        {STEP_WORDS.chat} <span className={voiceClass("ai")}>{words}</span>
      </span>
    </button>
  );
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
        /* Enter presses the chip beside it, as Enter in the Dock's own quick
           search runs it: the press is still the chip's, with its checks. */
        enterKeyHint="search"
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>("button.cmd-chip")?.click();
        }}
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
