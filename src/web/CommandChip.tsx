/**
 * **A command a chat answer proposed, as a button the reader presses** — the
 * command bar's own row (the same label, the same `generates` marker), drawn
 * in the transcript. Plan 261003f, Stage 2.
 *
 * The line it holds is the accepted one
 * (docs/project/chat-llm-help-commands-vision.md § Decided): the model never
 * causes a run. **Nothing here runs on render**; a press runs the proposal
 * through the executor the reading view built for the bar
 * (command-runners.ts § `chatExecutor`), so the bookmark is Reader's memoised
 * one (GPT Sol's F6) and the tags are the shelf row's controller (F4).
 *
 * Which tokens get here at all is chat-commands.ts § `chipFor`, and it is
 * asked **twice**: by Cited.tsx to decide between a chip and plain text, and
 * again inside the press, so availability is never remembered from the draw.
 */
import { createContext, useContext, useRef, useState, type ReactElement, type ReactNode } from "react";
import type { ActionOutcome } from "./command-match.js";
import { chipFor, doneWords } from "./chat-commands.js";
import type { Known } from "./citations.js";
import {
  type CommandExecutor,
  GENERATES_MARKER,
  NOT_HERE,
  proposalWords,
  runProposal,
} from "./command-proposal.js";
import { voiceClass } from "./voice.js";

/**
 * **The executor chat's chips press through**, from the reading view to the
 * answer (ChatPanel.tsx § `Answer`) without passing through the five
 * components between them — BlockLinkCard.tsx's reason for a context.
 *
 * `null` is the default and it means *no chips*: Remember, Candidates and a
 * test that mounts a panel alone draw a token as text. Reader.tsx provides it
 * around chat and the chat dialog only, which are owner-only.
 */
const ChatCommandsContext = createContext<CommandExecutor | null>(null);

export function ChatCommands({
  executor,
  children,
}: {
  executor: CommandExecutor;
  children: ReactNode;
}): ReactElement {
  return <ChatCommandsContext.Provider value={executor}>{children}</ChatCommandsContext.Provider>;
}

export function useChatCommands(): CommandExecutor | null {
  return useContext(ChatCommandsContext);
}

/** What a run that threw says — an exception must not end up as a chip that sits busy. */
const RUN_FAILED = "That didn't work. Try again in a moment.";

type Said = { readonly kind: "pending" } | { readonly kind: "message"; readonly text: string } | null;

/**
 * **A label with the model's word in the model's face.** The sentence is ours
 * and the quoted argument — the tag, the phrase, the term — is what the model
 * chose (docs/project/fonts.md § Whose voice is it: *inside such a sentence,
 * wrap only the model's words*). `proposalWords` quotes it with “ ”, so that is
 * where it is cut; a label with no quotes is all ours.
 */
function voiced(label: string): ReactNode {
  const open = label.indexOf("“");
  const close = label.lastIndexOf("”");
  if (open === -1 || close < open) return label;
  return (
    <>
      {label.slice(0, open + 1)}
      <span className={voiceClass("ai")}>{label.slice(open + 1, close)}</span>
      {label.slice(close)}
    </>
  );
}

export function CommandChip({
  raw,
  commands,
  blocks,
}: {
  /** The token exactly as the model wrote it. */
  raw: string;
  commands: CommandExecutor;
  blocks: Known;
}): ReactElement {
  const [said, setSaid] = useState<Said>(null);
  /* A ref as well as the state: two presses in one frame both see the state
     from before the first — CommandBar.tsx § `inFlight`. */
  const inFlight = useRef(false);
  const chip = chipFor(raw, commands, blocks);
  // Cited.tsx only mounts this for a token that is a chip; if it stopped being
  // one (the article's blocks changed under it), it is its own characters.
  if (chip === null) return <>{raw}</>;

  const { label, description, generates } = proposalWords(chip.proposal, chip.shown);

  const settle = (outcome: ActionOutcome, done: string | null) => {
    switch (outcome.kind) {
      case "stay":
        setSaid({ kind: "message", text: outcome.message });
        return;
      case "close":
        setSaid(done === null ? null : { kind: "message", text: done });
        return;
      default: {
        const never: never = outcome;
        return never;
      }
    }
  };

  const press = () => {
    if (inFlight.current) return;
    /* Asked again now, not remembered from the draw: the owner, the runner and
       the block are all facts about this moment. */
    const now = chipFor(raw, commands, blocks);
    if (now === null || !now.enabled) {
      setSaid({ kind: "message", text: NOT_HERE });
      return;
    }
    const done = doneWords(now.proposal.id);
    let outcome: ReturnType<typeof runProposal>;
    try {
      outcome = runProposal(commands.runners, now.proposal);
    } catch {
      outcome = { kind: "stay", message: RUN_FAILED };
    }
    if (outcome === null) {
      setSaid({ kind: "message", text: NOT_HERE });
      return;
    }
    if (!(outcome instanceof Promise)) {
      settle(outcome, done);
      return;
    }
    inFlight.current = true;
    setSaid({ kind: "pending" });
    void outcome
      .catch((): ActionOutcome => ({ kind: "stay", message: RUN_FAILED }))
      .then((settled) => {
        inFlight.current = false;
        settle(settled, done);
      });
  };

  const pending = said?.kind === "pending";
  return (
    <span className="cmd-chip-wrap">
      <button
        type="button"
        className="cmd-chip"
        title={description}
        disabled={!chip.enabled}
        aria-busy={pending}
        onClick={press}
      >
        <span className="cmd-chip-name">{voiced(label)}</span>
        {generates && <span className="cmd-chip-generates">{GENERATES_MARKER}</span>}
      </button>
      {said !== null && (
        <span className="cmd-chip-said" role="status">
          {said.kind === "pending" ? "Working…" : said.text}
        </span>
      )}
    </span>
  );
}
