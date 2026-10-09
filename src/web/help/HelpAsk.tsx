/**
 * ***Ask about Spideryarn*** — the box on the Help pages that answers a
 * question from the Help's own words. Plan docs/plans/261007k-help-chatbot.md
 * (§ After the plan review overrides its design where they differ);
 * docs/project/help-page.md § Ask about Spideryarn.
 *
 * Greg, `spya-ucftjt`, 2026-10-06:
 *
 * > you can ask it stuff like, This is what I'm trying to achieve, or I'm
 * > stuck, or What does this do? or Why is this parting that color? […] But if
 * > anything else, it would kind of know, like, Hang on, yeah, that's not what
 * > I'm here for.
 *
 * ## One question at a time
 *
 * The server takes `{ question }` and nothing else (src/help-chat.ts § One
 * question, no history), so this holds the last question and its answer and a
 * new question replaces both. Nothing is kept: leaving the page, or another
 * question, and it is gone.
 *
 * ## Signed in only, for now
 *
 * The route is behind the gate, so a stranger sees a line that says to sign
 * in, in the same place. Whether strangers may ask is Greg's question (plan §
 * For Greg: the signed-out door). Which shell is drawn is `SignedInShell`'s
 * answer, as for `DocumentPage` around this, never a session call of its own.
 *
 * ## A microphone, like every other box that sends
 *
 * Greg, `spya-y5gfpf`, 2026-10-08: *"Add a voice dictate button to the help
 * chat."* The three lines of docs/project/dictation.md § Adding it to a box,
 * with the Feedback dialog as the twin: no article, so the vocabulary place is
 * `profile` (the app's own words and the reader's profile prose), and a double
 * press on Stop sends. **The hook lives in `useHelpAsk`, not in the box**, for
 * the same reason the question does: the box is remounted when the reader
 * follows a link from `/help` to a page, and a hook in it would stop the
 * microphone mid-sentence (GPT Sol's plan review of 261009a, finding 1).
 *
 * ## The answer is a model's
 *
 * Drawn through `CitedMarkdown`'s walk — no HTML, anything it does not know
 * as the characters typed — with web links off, and a link drawn only to an
 * address the Help itself has (help-answer-links.ts). In the model's face
 * (docs/project/fonts.md); the question box in the reader's.
 */
import { useContext, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { HELP_CHAT_PATH, MAX_HELP_QUESTION_CHARS, type HelpChatDone } from "../../help-chat.js";
import { SignedInShell } from "../BackLink.js";
import { CitedMarkdown } from "../Cited.js";
import { DictationButton, DictationStrip } from "../DictationStrip.js";
import { keepDictation } from "../dictation-keep.js";
import { useReaderTranscriber } from "../dictation-upload.js";
import { isHeldSendEnter, isImeComposing, isSendEnter } from "../key-chord.js";
import { apiFetch, readJson } from "../lib/api.js";
import { describeFetchFailure } from "../lib/describe-failure.js";
import { ReaderFacingError } from "../lib/reader-facing.js";
import { readAnswerStream } from "../lib/sse.js";
import { Link } from "../Link.js";
import { loginHref } from "../router.js";
import { type UseDictationField, useDictationField } from "../useDictationField.js";
import { voiceClass } from "../voice.js";
import { helpAnswerHref } from "./help-answer-links.js";
import { HELP_LINK_CLASS } from "./help-parts.js";

/** Where the last question has got to. */
type Asked =
  | { readonly kind: "arriving"; readonly text: string }
  | { readonly kind: "answered"; readonly text: string; readonly complete: boolean }
  /** The reader pressed Stop: what had arrived stays, said to be cut short. */
  | { readonly kind: "stopped"; readonly text: string }
  /** `text` is whatever had arrived before it failed, often nothing. */
  | { readonly kind: "failed"; readonly text: string; readonly message: string };

/** No article, so no block for a citation to name: every `spya-…` is text. */
const NO_BLOCKS: Map<string, string> = new Map();
const NO_JUMP = () => {};

/** A link in the answer: one of the Help's own pages, moved to inside the app, or nothing. */
function helpLink(url: string, label: ReactNode): ReactNode | null {
  const href = helpAnswerHref(url);
  if (href === null) return null;
  return (
    <Link href={href} className={HELP_LINK_CLASS}>
      {label}
    </Link>
  );
}

/** The answer's own elements, which come out of the walk with Cited's `fmt-*` classes and no styling here. */
const ANSWER_CLASS =
  "tw:mt-3 tw:flex tw:flex-col tw:gap-2 tw:text-sm tw:leading-relaxed tw:text-foreground tw:[overflow-wrap:anywhere] tw:[&_p]:m-0 tw:[&_ul]:m-0 tw:[&_ol]:m-0 tw:[&_ul]:pl-5 tw:[&_ol]:pl-5 tw:[&_li]:mt-1 tw:[&_li:first-child]:mt-0 tw:[&_strong]:font-semibold tw:[&_code]:font-mono tw:[&_code]:text-xs tw:[&_pre]:m-0 tw:[&_pre]:overflow-x-auto tw:[&_pre]:whitespace-pre-wrap tw:[&_blockquote]:m-0 tw:[&_blockquote]:border-l-2 tw:[&_blockquote]:border-rule tw:[&_blockquote]:pl-3 tw:[&_.fmt-h]:m-0 tw:[&_.fmt-h]:text-sm tw:[&_.fmt-h]:font-semibold";

const NOTE_CLASS = "tw:m-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground";

const HEADING_CLASS =
  "tw:m-0 tw:mb-2 tw:font-sans tw:text-xs tw:font-semibold tw:tracking-wide tw:text-ink-faint tw:uppercase";

/**
 * **The question and its answer, held by the page** rather than by the box,
 * because the box is drawn in two places: under the search on the contents
 * page, and in the column on every other. Moving from one to the other is a
 * different parent, so a box that held its own state would be remounted — and
 * the first link a reader followed out of an answer on `/help` would throw
 * that answer away. HelpPage.tsx calls this once and hands it to whichever
 * box is drawn.
 */
export interface HelpAskState {
  readonly value: string;
  setValue(v: string): void;
  readonly asked: Asked | null;
  /**
   * Sends the question, unless something refuses it: an answer still
   * arriving, an empty box, `over`, or the microphone (`dictate.busy`). The
   * one path the Ask button, Enter and a double press on Stop all take.
   */
  ask(): void;
  stop(): void;
  /**
   * Longer than the server takes. `maxLength` stops typing past it, not a
   * transcript, so dictation can get here; the words are never cut, the
   * reader is told and trims them (GPT Sol's plan review of 261009a, F2).
   */
  readonly over: boolean;
  /** The textarea, whichever of the two boxes is drawn. */
  readonly box: RefObject<HTMLTextAreaElement | null>;
  readonly dictate: UseDictationField;
}

export function useHelpAsk(): HelpAskState {
  const [value, setValue] = useState("");
  const [asked, setAsked] = useState<Asked | null>(null);
  /**
   * The request in flight, and the admission record: two presses in one tick
   * both see `asked` unchanged, so the ref is what refuses the second
   * (useGlossary.ts § `look` has the same rule).
   */
  const live = useRef<AbortController | null>(null);
  /** Stopped by the reader, not by a failure — the catch reads it. */
  const stoppedBy = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  /* The server's count: after trimming (src/help-chat.ts § parseHelpChatRequest). */
  const over = value.trim().length > MAX_HELP_QUESTION_CHARS;

  /* Leaving Help stops the answer, and the server's `gone` stops the paid
     call behind it (src/routes.ts § streamHelpAnswer). */
  useEffect(
    () => () => {
      live.current?.abort();
      live.current = null;
    },
    [],
  );

  async function run(question: string): Promise<void> {
    const controller = new AbortController();
    live.current = controller;
    const mine = () => live.current === controller;
    let text = "";
    setAsked({ kind: "arriving", text });
    try {
      const res = await apiFetch(HELP_CHAT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        /* The refusals — a bad body, the allowance, the day's fuse — come
           before the stream as JSON with a reader's sentence, which
           `readJson` throws. */
        await readJson(res);
        throw new ReaderFacingError(`The server replied ${res.status}.`);
      }
      const done = await readAnswerStream<HelpChatDone>(res.body, {
        delta: (so) => {
          text = so;
          if (mine()) setAsked({ kind: "arriving", text });
        },
        done: (data) => {
          const d = data as Partial<HelpChatDone> | null;
          return typeof d?.answer === "string" && typeof d.complete === "boolean"
            ? { answer: d.answer, complete: d.complete }
            : undefined;
        },
      });
      if (mine()) setAsked({ kind: "answered", text: done.answer, complete: done.complete });
    } catch (err) {
      if (!mine()) return;
      if (stoppedBy.current === controller) setAsked({ kind: "stopped", text });
      else setAsked({ kind: "failed", text, message: describeFetchFailure(err as Error) });
    } finally {
      if (mine()) live.current = null;
    }
  }

  /* Every refusal, so the double press's `onDone` — called on the render
     after the words land, with `busy` false — takes the same road. */
  const ask = () => {
    const question = value.trim();
    if (live.current || question === "" || over || dictate.busy) return;
    void run(question);
  };

  /* No article in scope, so `profile`: the app's own words and the reader's
     profile prose, as in the Feedback dialog. One kept box for all of Help,
     and keepDictation partitions it by reader. */
  const transcribe = useReaderTranscriber();
  const dictate = useDictationField({
    value,
    onChange: setValue,
    box,
    context: { kind: "profile" },
    transcribe,
    keep: keepDictation("help-ask"),
    /* A double press on Stop also sends (dictation.md § A double press). */
    onDone: ask,
  });

  return {
    value,
    setValue,
    asked,
    over,
    box,
    dictate,
    ask,
    stop() {
      const controller = live.current;
      if (!controller) return;
      stoppedBy.current = controller;
      controller.abort();
    },
  };
}

/**
 * The box, or for a stranger the line that says to sign in. `className` is the
 * caller's spacing: under the search on the contents page, in the column on
 * every other.
 */
export function HelpAsk({ state, className }: { state: HelpAskState; className?: string }) {
  const signedIn = useContext(SignedInShell);
  return (
    <section aria-label="Ask about Spideryarn" className={className}>
      <h2 className={HEADING_CLASS}>Ask about Spideryarn</h2>
      {signedIn ? (
        <AskBox state={state} />
      ) : (
        <p className={NOTE_CLASS}>
          {/* Back here afterwards: loginHref's `next`, which the sign-in page
              only uses once somebody actually signs in (auth-return.ts). */}
          <Link
            href={loginHref({ next: location.pathname + location.search + location.hash })}
            className={HELP_LINK_CLASS}
          >
            Sign in
          </Link>{" "}
          to ask a question about Spideryarn.
        </p>
      )}
    </section>
  );
}

function AskBox({ state }: { state: HelpAskState }) {
  const { value, setValue, asked, ask, stop, over, box, dictate } = state;
  const arriving = asked?.kind === "arriving";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask();
  };

  return (
    <>
      <form onSubmit={onSubmit} className="tw:flex tw:flex-col tw:gap-2">
        <textarea
          ref={box}
          value={value}
          readOnly={dictate.readOnly}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          /* The server's number. It counts after trimming and this counts as
             typed, so the box can only be the stricter of the two. */
          maxLength={MAX_HELP_QUESTION_CHARS}
          /* Enter really does send here, as in Chat's composer, so the soft
             keyboard may say so (docs/project/touch.md § What the Enter key
             promises). Shift+Enter is a new line. */
          enterKeyHint="send"
          placeholder="What does the orange line mean? How do I…?"
          aria-label="Ask a question about Spideryarn"
          onKeyDown={(e) => {
            if (isSendEnter(e)) {
              e.preventDefault();
              ask();
              return;
            }
            if (isHeldSendEnter(e)) e.preventDefault();
            /* Escape stops an answer that is arriving, then empties the box;
               with neither to do it is left to whoever else listens, as on
               the search box above. Never an input method's Escape. */
            if (e.key === "Escape" && !isImeComposing(e)) {
              if (arriving) {
                e.stopPropagation();
                stop();
              } else if (value !== "") {
                e.stopPropagation();
                setValue("");
              }
            }
          }}
          /* `any-pointer-coarse` at 16px or more: iOS zooms into a smaller
             field (HelpPage.tsx § SearchBox says why a bare `text-base` is not
             enough). */
          className={`${voiceClass("reader")} tw:box-border tw:block tw:w-full tw:resize-y tw:rounded-md tw:border tw:border-border tw:bg-transparent tw:px-3 tw:py-1.5 tw:text-sm tw:leading-relaxed tw:text-foreground tw:any-pointer-coarse:text-[max(1rem,16px)] tw:placeholder:text-ink-faint tw:focus-visible:border-highlight-text tw:focus-visible:outline-none`}
        />
        {over && (
          <p className={NOTE_CLASS}>
            {value.trim().length} characters — a question can be at most {MAX_HELP_QUESTION_CHARS}.
          </p>
        )}
        <div className="tw:flex tw:items-center tw:justify-end tw:gap-2">
          {/* The microphone every other box has, left of Ask. Hidden where the
             browser cannot open one; off while an answer is arriving, as
             chat's is while it is busy. */}
          {dictate.dictation.supported && (
            <DictationButton
              dictation={dictate.dictation}
              toggle={dictate.toggle}
              disabled={arriving}
              again={dictate.again}
              sendingAfter={dictate.sendingAfter}
            />
          )}
          {/* Two keys, so Stop and Ask are never one reused <button>. Reused,
             its type flipped from "button" to "submit" while a Stop click was
             still being dispatched (React renders a discrete event's update
             before the default action), and the click posted the question
             again: the server's 429 instead of "Stopped.", seen in a browser. */}
          {arriving ? (
            <Button key="stop" type="button" variant="outline" size="sm" onClick={stop}>
              <Square fill="currentColor" className="tw:size-3" />
              Stop
            </Button>
          ) : (
            <Button key="ask" type="submit" size="sm" disabled={value.trim() === "" || over || dictate.busy}>
              Ask
            </Button>
          )}
        </div>
      </form>
      <DictationStrip dictation={dictate.dictation} sendingAfter={dictate.sendingAfter} />
      <Answer asked={asked} />
    </>
  );
}

/** The last answer, as far as it got, and what became of it. */
function Answer({ asked }: { asked: Asked | null }) {
  if (asked === null) return null;
  const text = asked.text;
  return (
    /* `aria-live` on the box that is always there once something was asked,
       polite and not atomic, so a screen reader hears it arrive. */
    <div aria-live="polite" className="tw:mt-1">
      {text !== "" && (
        <div className={`${voiceClass("ai")} ${ANSWER_CLASS}`}>
          <CitedMarkdown
            text={text}
            blocks={NO_BLOCKS}
            onJump={NO_JUMP}
            partial={asked.kind === "arriving"}
            ownLink={helpLink}
          />
        </div>
      )}
      {asked.kind === "arriving" && text === "" && <p className={`${NOTE_CLASS} tw:mt-3`}>Reading the Help…</p>}
      {asked.kind === "answered" && !asked.complete && (
        <p className={`${NOTE_CLASS} tw:mt-2`}>This answer was cut short.</p>
      )}
      {asked.kind === "stopped" && <p className={`${NOTE_CLASS} tw:mt-2`}>Stopped.</p>}
      {asked.kind === "failed" && (
        <p role="alert" className={`${NOTE_CLASS} tw:mt-2`}>
          {asked.message}
        </p>
      )}
    </div>
  );
}
