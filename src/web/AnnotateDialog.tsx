/**
 * The box a selection opens — see docs/plans/260828a-comments-and-bookmarks.md.
 *
 * Select a sentence and this appears over the article: the words you chose, a
 * place to say something about them, and two buttons: **Save**, and **Ask AI**
 * if you also want the model's help. **Saving is free**, and so is pressing Ask
 * AI: it saves, and opens the chat composer on those words for you to send.
 *
 * ## What it replaced, twice
 *
 * Until 2026-08-26, letting go of the mouse spent a model call on the spot and
 * streamed an explanation into a panel. Then a selection opened an *ask box* —
 * still free until you pressed Ask, but the only thing you could do with a
 * passage was ask about it. Greg, 2026-08-27:
 *
 * > someone might want to simply add bookmarks or comments to the text, without
 * > wanting an AI response … you can select some text, and that bookmarks it.
 * > You can optionally add a comment. And you can request (when you do so)
 * > whether you want an AI response (in which case it kicks off a Chat).
 *
 * So the free thing is the default and the paid thing was a tick-box, until
 * 2026-10-03.
 *
 * ## Three details that are decisions, not styling
 *
 * **A checkbox rather than a second button — until 2026-10-03, when it became
 * the button.** The argument for the checkbox was that two buttons that both
 * save, one of which also costs money, are two things a reader has to read
 * carefully every time; the checkbox made the paid outcome something you opt
 * into, and the primary button renamed itself to say what pressing it cost.
 * GPT Sol's review argued for that over the two buttons the first plan had.
 *
 * What it missed is that **a ticked box looks like an action taken**. Greg:
 *
 * > I highlighted a word I didn't understand and clicked highlight or comment,
 * > and then I ticked the save and ask AI, and then clicked something else, and
 * > I don't know what happened, but it disappeared. So maybe save and ask AI
 * > should be a button, or I think it should auto-save, and so then ask AI
 * > would be a button. And it's just generally a bit confusing.
 * >
 * > — Greg, 2026-10-03 (spya-pnnamg)
 *
 * So the box ends in `Discard … [Ask AI] [Save]`. **Ask AI does exactly what
 * the ticked box plus Save did** — the comment is stored and the chat composer
 * opens pre-filled — and it spends nothing itself: the model is called when the
 * reader sends from that composer. Save is the only submit button, so no key
 * can press Ask AI by accident.
 * docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md.
 *
 * **Enter inserts a newline.** The old box sent on Enter, and rebinding that to
 * "save for free" would have been financially safe and still a trap: the same
 * keystroke in the same-looking box quietly doing a different thing. A comment
 * is also the first text in this app somebody might want two paragraphs of. So
 * it is a `textarea`, Enter is a newline, and ⌘/Ctrl+Enter presses the visible
 * primary button — the same chord `useDictationField` already commits on.
 *
 * **An empty box is a bookmark, not an error.** Saving with nothing written is
 * the whole "just mark this passage" case, so the button is never disabled.
 * Ask AI with nothing written asks chat to explain the passage — which is what
 * the old ask box did with an empty composer.
 *
 * ## And a fourth, since 2026-09-01: it is where a referee places a passage
 *
 * In Referee mode the box grows a *"Place on a criterion"* section
 * (PlaceOnCriterion.tsx, which carries the argument for why it is here and not
 * beside the model's own valence in `CriteriaPanel`). It changes nothing about
 * the three decisions above: placing is optional, saving with no placement is
 * the ordinary case, and it stays one press.
 *
 * ## And a fifth, since 2026-09-05: a selection is not always a comment
 *
 * Opening this box takes the focus and the selection with it, so a reader who
 * only wanted the sentence on their clipboard had to re-select it in here.
 * `CopyQuote`, at the foot of this file, is the one press that replaces that,
 * and carries the reasoning.
 *
 * ## And a sixth, since 2026-10-03: no way out silently discards a draft
 *
 * The other half of Greg's report above. Everything in this box was a draft in
 * React state until Save, and five things threw it away without a word: Cancel,
 * the ×, Escape, another selection in the prose, and leaving the page. The rule
 * now:
 *
 * - A draft **the reader did something to** — words, a changed colour, or a
 *   Referee placement (`hasIntent`) — is stored on every way out but one: the ×,
 *   the box's Escape, another selection, the box unmounting for any reason, and
 *   `pagehide`. Stored exactly as Save would store it, and never asking the AI.
 *   If `pagehide` put the tab in bfcache, `pageshow` reconciles that save and
 *   closes the old box.
 * - **Discard** (it was *Cancel*) is that one, and it says so.
 * - **An untouched box is stored by no exit the reader did not choose** (the
 *   seventh decision, below, is what the × and Escape do with one). Storing a
 *   mark the moment the box opened would leave one behind every time a reader
 *   selects words to copy them (the fifth decision, above).
 * - The textarea's own first Escape still clears what was typed. That is the
 *   reader removing their words, not the box losing them.
 *
 * ## And a seventh, since 2026-10-04: Yellow is picked, and closing saves it
 *
 * > I like the new human highlights when I select text - can we default to the
 * > yellow colour, and default to saving it, so that it requires fewer clicks?
 * >
 * > — Greg, 2026-10-03 (spya-ur8kum)
 *
 * The colour row opens on Yellow, and the × and Escape store what the box
 * shows, so a highlight is one press after the selection instead of two. Three
 * things hold that back from being "every selection is a highlight":
 *
 * - **The exits nobody chose still store nothing from an untouched box**:
 *   another selection, an unmount, `pagehide`. Letting go of a drag opens this
 *   box, so a mis-drag would otherwise leave a highlight per attempt — and
 *   StrictMode's mount → cleanup → mount would store one in development.
 * - **Copy, then close, stores nothing** when nothing else was done: that
 *   reader wanted the sentence. The hint says so once Copy is pressed, and Save
 *   still saves.
 * - **Referee mode opens on No colour.** A selection there records evidence
 *   against a criterion; adding a reading highlight nobody picked would mix two
 *   meanings. Chosen at mount, and not changed if the mode is.
 *
 * The two gates are `hasSomething` and `hasIntent`, and `flush` says which exit
 * asks which.
 * docs/plans/261004a-a-selection-s-highlight-is-yellow-by-default-and-closing-the-box-saves-it.md.
 *
 * **One instance is one draft.** Every caller keys the whole box on its passage
 * (`annotateKey`), so an instance owns one anchor, one draft id and one latch
 * for its whole life, and a new selection is nothing but the old instance
 * unmounting. That is what stops passage A's words being stored against
 * passage B (GPT Sol's plan review, D1).
 *
 * What it does not promise is in docs/project/comments.md § Deliberate limits: a
 * write that fails after the box has closed is still lost, and a crashed or
 * killed browser fires no event at all.
 */
import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, Copy, MessageSquarePlus, TriangleAlert, X } from "lucide-react";

import type { ChatAnchor, HighlightColour } from "../types.js";
import { mintId } from "../ids.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { HighlightSwatches } from "./HighlightSwatches.js";
import { type Mark, NO_MARK, PlaceOnCriterion } from "./PlaceOnCriterion.js";
import { parseRoute } from "./router.js";
import { keepDictation } from "./dictation-keep.js";
import { sendForTranscription } from "./dictation-upload.js";
import { useCopy } from "./useCopy.js";
import { useDictationField } from "./useDictationField.js";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { keyboardInsetStyle, useVisualViewport } from "./useVisualViewport.js";

/** The passage a box is about. Always a selection, never a bare block. */
type Anchor = Extract<ChatAnchor, { quote: string }>;

/**
 * **The key every caller mounts this box under.**
 *
 * `<AnnotateDialog key={annotateKey(anchor)} anchor={anchor} … />`. It is what
 * makes one instance one draft: a new selection unmounts the old box, whose
 * cleanup stores its draft against its own passage, and mounts an empty one.
 * Without the key the instance would be reused and, since the box keeps the
 * anchor it was mounted with, would go on showing — and saving against — the
 * first passage. Wrong in plain sight rather than silently, which is the point
 * of holding the anchor.
 *
 * Also how a caller asks *"is this the box that just saved?"* — two anchors are
 * the same passage exactly when their keys are equal.
 */
export function annotateKey(anchor: Pick<Anchor, "blockId" | "start" | "quote">): string {
  return `${anchor.blockId}:${anchor.start}:${anchor.quote}`;
}

/** What a box hands its caller to store: the draft, and how it came to be sent. */
export interface AnnotateDraft {
  /**
   * **The passage the draft was written about** — the box's own, not whatever
   * the caller's selection state holds by now. A draft stored because the
   * reader selected something else arrives *after* that state has moved on.
   */
  anchor: Anchor;
  /** This draft's id, minted once — see the note on `draftId` below. */
  id: string;
  /** The reader's words, trimmed. Empty is a bookmark, or a wordless highlight. */
  body: string;
  /**
   * **The Ask AI button was pressed.** The caller stores the comment either
   * way, and opens the chat composer on it as well when this is true. False for
   * Save and for every automatic store: nothing but a press on the button that
   * says so may open a conversation.
   */
  ask: boolean;
  /**
   * The referee's placement, `NO_MARK` when they made none — which is the
   * ordinary case and the one this dialog is mostly used for.
   */
  mark: Mark;
  /**
   * The highlight colour the box showed, `null` for none. Yellow unless the
   * reader changed it; none by default in Referee mode.
   */
  colour: HighlightColour | null;
  /**
   * **The page is going away** (`pagehide`): store this with a request that
   * outlives the page — `leavingFetch`, src/web/lib/api.ts — started at once,
   * with nothing awaited first. An ordinary fetch from a page being torn down
   * often never leaves. How to do that is the caller's business; this box knows
   * nothing about requests.
   */
  leaving: boolean;
}

interface Props {
  /**
   * The passage, and the block it sits in. **Read once, at mount** — mount the
   * box under `annotateKey(anchor)`.
   */
  anchor: Anchor;
  /**
   * **Referee mode is open**, so this passage can be placed on a criterion.
   *
   * A prop rather than something read from the address, because the mode lives
   * in `App`'s state and this box has no business parsing it. False everywhere
   * else, and then nothing here fetches a criterion — the hook that does is
   * inside the section, so an ordinary reader's selection makes no request.
   */
  placing: boolean;
  /**
   * Store this draft. Called **at most once per way of sending** — a press
   * (Save or Ask AI), or one automatic store on the way out — and it may be
   * called while this box is unmounting, or after the caller's selection has
   * moved to another passage. So: use `draft.anchor`, and close only the box
   * that matches it.
   */
  onSave(draft: AnnotateDraft): void;
  /**
   * **Has the article's comment list come back — answered, failed or given up
   * on?** `useComments`'s `loaded`, and the two buttons wait for it: that GET's
   * answer replaces the list, so a comment saved while it was out vanished from
   * the tab when it landed. Typing, dictation and the colour all carry on
   * meanwhile; only the press waits.
   * docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md.
   *
   * **An automatic store does not wait for it** — the box is going away and
   * there is no button to wait at. `useComments.create` holds such a create
   * until the read settles instead, which is the same order kept one layer down.
   *
   * Required rather than defaulting to `true`, so a new caller has to answer
   * the question instead of inheriting a yes.
   */
  loaded: boolean;
  /**
   * Close the box. Discard, the × and Escape all end here; the last two have
   * stored a draft with something in it first.
   */
  onCancel(): void;
  /**
   * **Does Escape belong to this box?** False while `CommentDialog` or
   * `ChatDialog` is in front of it — both are reachable with a selection still
   * live, both paint over this one at the same z-70, and until 2026-09-07 one
   * press closed this box *and* the one in front, discarding a half-typed
   * annotation on the way.
   *
   * The rule is *the surface the reader sees in front owns the press*, and this
   * is how the caller says so. It is not mutual exclusion: this box stays
   * mounted with its draft and becomes the owner again the moment the surface in
   * front closes. Nothing else changes — the ×, Discard and the textarea's own
   * two-stage Escape are untouched.
   *
   * **Defaults to `true`**, so the previews and tests that mount this box alone
   * behave exactly as they did. That default is also why
   * tests/one-escape-closes-one-surface.test.tsx reads `Reader.tsx`'s source:
   * every behavioural assertion about yielding would pass with the real caller
   * never passing this at all. docs/reusable/silent-success.md.
   */
  escapeEnabled?: boolean;
}

/** The colour the row opens on outside Referee mode. Greg, 2026-10-03 (spya-ur8kum). */
const DEFAULT_HIGHLIGHT: HighlightColour = "yellow";

/** The three things a reader can put in the box, and two things they can do. */
interface Fields {
  body: string;
  mark: Mark;
  colour: HighlightColour | null;
  /** The reader changed the colour row from what it opened on. */
  colourChanged: boolean;
  /** The reader pressed Copy — at the press, whatever the clipboard then said. */
  copyPressed: boolean;
}

/**
 * **Is there anything here to store?** True of an untouched box outside
 * Referee mode, which shows Yellow.
 *
 * The placement is read **structurally**, not by identity with `NO_MARK`: the
 * section hands back a fresh object when a placement is cleared, which is not
 * `NO_MARK` and is not a placement either. GPT Sol's plan review of 261003i, D4.
 */
function hasSomething(fields: Fields): boolean {
  return fields.body.trim() !== "" || fields.colour !== null || fields.mark.criterionId !== null;
}

/**
 * **Did the reader do anything that says they want this kept?** Words, a
 * placement, or a change to the colour row. Opening the box is not one, and nor
 * is Copy.
 */
function hasIntent(fields: Fields): boolean {
  return fields.body.trim() !== "" || fields.mark.criterionId !== null || fields.colourChanged;
}

export function AnnotateDialog({
  anchor: mountedOn,
  placing,
  onSave,
  loaded,
  onCancel,
  escapeEnabled = true,
}: Props) {
  /* **The passage this instance was mounted on, for good** — see `annotateKey`.
     State with no setter rather than a ref, because it is read while
     rendering. */
  const [anchor] = useState(mountedOn);
  const [body, setBody] = useState("");
  /* The placement, as a draft. Nothing is stored until the box is saved or
     left, so unlike `CommentDialog`'s — which is controlled by the stored
     comment because a failed write must not look like a successful one — this
     one is local: there is nothing on a server yet for it to disagree with. */
  const [mark, setMark] = useState<Mark>(NO_MARK);
  /* The highlight colour, a draft like the placement. Yellow from the start,
     except in Referee mode; read once, so a mode change under an open box does
     not recolour its draft (plan 261004a). */
  const [colour, setColour] = useState<HighlightColour | null>(placing ? null : DEFAULT_HIGHLIGHT);
  const [colourChanged, setColourChanged] = useState(false);
  const [copyPressed, setCopyPressed] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  /**
   * The id this draft is stored under, minted **once per box**.
   *
   * It is the idempotency key the server matches on, and that only works if a
   * second attempt at the *same* Save carries the *same* id. Minting one per
   * click would mean a reader whose first Save succeeded on the server but
   * whose response was lost would press Save again and store a second comment
   * on the same words — with the server's same-id rule having nothing to match.
   * GPT Sol, reviewing the built code, 2026-08-28.
   *
   * A different passage is a different box, and so a different id.
   */
  const draftId = useRef(mintId());
  /**
   * **What has become of this draft**, and the one latch every way of sending
   * it goes through.
   *
   * - `open` — nothing has been sent.
   * - `left` — `pagehide` sent it with the keepalive write. A `pagehide` is not
   *   always the end: the page can come back from the back/forward cache with
   *   this box still on it. `pageshow` then replays the frozen snapshot through
   *   ordinary create and closes it; a later press must not reuse this id with
   *   changed words, which the server correctly treats as a collision.
   * - `done` — sent by a press or an automatic store, or thrown away by
   *   Discard. Nothing more is ever sent.
   *
   * A ref, synchronous on purpose: `disabled` only takes effect on the next
   * render, and two clicks inside one frame — Save twice, Ask AI then Save —
   * both get through it. The id above makes a duplicate harmless on the server;
   * this stops it being sent at all.
   */
  const fate = useRef<"open" | "left" | "done">("open");

  /* **What the cleanup and the `pagehide` listener read.** Both are registered
     once and outlive the render that made them, so they take the draft and the
     caller's `onSave` from here. An effect that *depended* on the fields would
     run its cleanup on every keystroke, and its cleanup is "store the draft". */
  const fields: Fields = { body, mark, colour, colourChanged, copyPressed };
  const latest = useRef({ fields, onSave, onCancel });
  latest.current = { fields, onSave, onCancel };

  /**
   * Record a field synchronously as well as through React state.
   *
   * `flush` is allowed to run before React renders a state update: Copy and the
   * adjacent × can both be pressed in one frame, as can a colour and the ×. The
   * ref is the draft those exit handlers read, so changing state alone would
   * make Copy save an unwanted Yellow highlight, or make Green save as Yellow.
   * The next render replaces this snapshot with the same values from state.
   */
  const remember = (changed: Partial<Fields>) => {
    latest.current.fields = { ...latest.current.fields, ...changed };
  };
  const changeBody = (next: string) => {
    remember({ body: next });
    setBody(next);
  };
  const changeMark = (next: Mark) => {
    remember({ mark: next });
    setMark(next);
  };

  /* The other box in this app with an article in scope, so transcription gets
     the glossary as its vocabulary — the reader is writing about a passage they
     have just read, and the words in it are the words they are about to say.
     The slug comes from the address rather than a prop, for the reason
     `CommentDialog` gives: this only ever exists over an article, and the
     address is what says which one. */
  const route = parseRoute(location.pathname);
  const dictate = useDictationField({
    value: body,
    onChange: changeBody,
    box,
    context: route.kind === "read" ? { kind: "article", slug: route.slug } : { kind: "profile" },
    transcribe: sendForTranscription,
    /* One box per passage, as the draft itself is. */
    keep: keepDictation(`annotate:${anchor.blockId}:${anchor.start}`),
  });

  useEffect(() => {
    box.current?.focus();
  }, []);

  /** Hand the draft to the caller, as it stands. Every send ends here. */
  const send = (ask: boolean, leaving: boolean) => {
    const { fields: now, onSave: store } = latest.current;
    store({
      anchor,
      id: draftId.current,
      body: now.body.trim(),
      ask,
      mark: now.mark,
      colour: now.colour,
      leaving,
    });
  };

  /** **A press: Save (`ask` false), or Ask AI.** */
  const press = (ask: boolean) => {
    /* **Not while the microphone is involved, and that is two states.**
       `readOnly` stops typing and not the keyboard chord, so without it the
       reader's rough first-pass words get stored a moment before the good ones
       land — and `armed`, the microphone still recording, is the one everybody
       forgets: ⌘+Enter mid-sentence saves Chrome's live guesses, or on Safari
       and Firefox saves nothing that was said at all. The same pair, for the
       same reason, as the follow-up box in `CommentDialog`.
       docs/project/dictation.md § Adding it to a box. */
    if (dictate.busy) return;
    /* Before the latch, so a press refused for this reason is not remembered
       as a Save on its way — the next one, once loaded, has to get through. */
    if (!loaded) return;
    if (fate.current === "done") return;
    fate.current = "done";
    send(ask, false);
  };

  /**
   * **The box is going, and nobody pressed Save or Ask AI: store the draft if
   * this exit should.** Never asks the AI.
   *
   * Two kinds of exit, two gates (plan 261004a):
   *
   * - `chosen` — the × and Escape, which the reader pressed. Stores whatever
   *   the box shows, an untouched Yellow included; except after Copy with
   *   nothing else done, which was a reader after the sentence.
   * - not `chosen` — an unmount or `pagehide`. Stores only what the reader did
   *   something to.
   *
   * The gate is asked before `fate` moves, so an exit that stores nothing
   * leaves the box as live as it was: StrictMode's simulated unmount, and an
   * untouched `pagehide` that turns out to be a bfcache suspend.
   *
   * It has neither of `press`'s guards, deliberately. Not `loaded`: there is no
   * button left to wait at, and `useComments.create` orders the write after the
   * opening read itself. Not the microphone: `press` refuses mid-dictation
   * because better words are about to arrive, and here nothing better will —
   * unmounting aborts the transcription — so the choice is the words the reader
   * could see, or none, and a rough note can be edited where a lost one cannot.
   * The recording itself stays on the device (`keep`, above) to be offered back
   * in this passage's next box. Arbitrated by Opus, 2026-10-03 (plan 261003i,
   * D4).
   *
   * Reads only refs, so the copy an effect registered at mount is as good as
   * this render's.
   */
  const flush = (leaving: boolean, chosen: boolean) => {
    if (fate.current !== "open") return;
    const now = latest.current.fields;
    if (!hasSomething(now)) return;
    if (chosen ? now.copyPressed && !hasIntent(now) : !hasIntent(now)) return;
    fate.current = leaving ? "left" : "done";
    send(false, leaving);
  };

  /* **Unmount, for any reason** — another selection (the key changed), the
     reader leaving the article inside the app, the reading view going away.
     `[]`, so the cleanup runs once and only then.

     Safe under StrictMode's mount → cleanup → mount: that cleanup runs before
     anyone could have typed, an untouched draft has no intent behind it, and
     nothing is sent. The refs survive the simulated remount, so a draft sent later is
     still sent once. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `flush` reads refs only, and this must run once
  useEffect(() => () => flush(false, false), []);

  /* **And when the page goes rather than the box**: a reload, a closed tab, a
     link out. React runs no cleanup then. `pagehide` is the last event a page
     reliably gets, and the caller is told to use the request that survives it.

     `pagehide` can instead put the page in the back/forward cache. On
     `pageshow`, replay the exact frozen snapshot through ordinary `create` so
     this tab learns about the row, then close the builder. Leaving it open
     would let changed words be sent later under an id the keepalive write has
     already used; the store correctly answers that as a 409 collision.

     A crash or a killed browser fires nothing at all — that limit is named in
     docs/project/comments.md § Deliberate limits. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `flush` reads refs only
  useEffect(() => {
    const leaving = () => flush(true, false);
    const returning = () => {
      if (fate.current !== "left") return;
      fate.current = "done";
      send(false, false);
      latest.current.onCancel();
    };
    window.addEventListener("pagehide", leaving);
    window.addEventListener("pageshow", returning);
    return () => {
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("pageshow", returning);
    };
  }, []);

  /** The × and Escape: keep the draft, then go. */
  const close = () => {
    flush(false, true);
    onCancel();
  };
  /** The one thing that throws a draft away. */
  const discard = () => {
    fate.current = "done";
    onCancel();
  };

  useEscapeToClose(close, escapeEnabled);

  /* Mounted means on screen: the selection opens this and closing it unmounts. */
  const visible = useVisualViewport(true);

  /* Both microphone states and the list still loading, matching the guards in
     `press` — a lit button over a handler that returns is a press that does
     nothing and says nothing. */
  const waiting = !loaded || dictate.busy;

  return (
    <aside
      className="annotate-dialog"
      /* Up out of the keyboard's way, exactly as its two neighbours in the same
         corner are — and this box exists to be typed into.
         useVisualViewport.ts. */
      style={keyboardInsetStyle(visible)}
      role="dialog"
      aria-label="Comment on this passage"
    >
      <header>
        <span className="annotate-label">
          <MessageSquarePlus size={12} aria-hidden="true" />
          Comment
        </span>
        <span className="annotate-head-actions">
          {/* **Its tick is a claim about the clipboard, so it must go with the
              passage it was made about.** Copy A, select B inside 1.6s, and a
              button that outlived the selection sat there saying "copied" over
              B's words with A still on the clipboard. Until 2026-10-03 this
              button carried a key of its own for that; since then the whole box
              is keyed on the passage (`annotateKey`), which remounts this with
              it, state and in-flight write included. GPT Sol's review of the
              built code, 2026-09-05; tests/annotate-dialog-copy.test.tsx. */}
          <CopyQuote
            text={anchor.quote}
            onCopyPressed={() => {
              remember({ copyPressed: true });
              setCopyPressed(true);
            }}
          />
          <button
            type="button"
            className="annotate-close close-x"
            onClick={close}
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </span>
      </header>

      <div className="annotate-body">
        {/* The reader's own selection, quoted back — without it the box is a
            question about words you can no longer see once the page scrolls. */}
        <blockquote className="annotate-quote">{anchor.quote}</blockquote>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            press(false);
          }}
        >
          <textarea
            ref={box}
            value={body}
            readOnly={dictate.readOnly}
            onChange={(e) => changeBody(e.target.value)}
            onKeyDown={(e) => {
              /* Escape closes the panel from a window listener, which would eat
                 half-written words without warning. Stopped here so the first
                 Escape clears the box and the second closes the panel — the
                 same two-stage escape the follow-up box has. */
              if (e.key === "Escape" && body) {
                e.stopPropagation();
                changeBody("");
                return;
              }
              /* The chord is the **free** Save, never Ask AI. */
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                press(false);
              }
            }}
            placeholder={
              colour !== null
                ? "Add a comment, or just save the highlight…"
                : "Add a comment, or just save to bookmark it…"
            }
            aria-label="Your comment on this passage"
            rows={3}
          />

          {/* Referee mode only, and `route` is what says which article — the
              same read `useDictationField` above is already making, for the
              reason this file's header gives. */}
          {placing && route.kind === "read" && (
            <PlaceOnCriterion slug={route.slug} value={mark} onChange={changeMark} />
          )}

          {/* A highlight is this same comment with a colour; no words and a
              colour is a wordless highlight. Not gated on `loaded` — picking is
              part of the draft, and only the two buttons wait. */}
          {/* The row only calls back when the colour differs, so a press on
              the one already picked is not a change — and must stay that way,
              because `CommentDialog` PATCHes on this callback. */}
          <HighlightSwatches
            value={colour}
            onChange={(next) => {
              remember({ colour: next, colourChanged: true });
              setColour(next);
              setColourChanged(true);
            }}
          />

          <div className="annotate-actions">
            {dictate.dictation.supported && (
              <DictationButton dictation={dictate.dictation} toggle={dictate.toggle} />
            )}
            {/* **Discard, not Cancel**: it is the only control here that throws
                the reader's words away, and it says so. */}
            <button type="button" className="linky" onClick={discard}>
              Discard
            </button>
            {/* **`type="button"`, and it matters.** Enter in a form presses its
                first submit button, and this one opens a conversation: the only
                thing a key may press here is the free Save. It stores the
                comment and opens the chat composer on it, pre-filled; it sends
                nothing itself. */}
            <button
              type="button"
              className="annotate-ask-ai"
              disabled={waiting}
              onClick={() => press(true)}
              title="Save this, and open a conversation about it"
            >
              Ask AI
            </button>
            {/* Never disabled for being empty: saving nothing is a bookmark,
                which is the point. The only submit button in the box. */}
            <button type="submit" className="annotate-save" disabled={waiting}>
              Save
            </button>
          </div>
          <DictationStrip dictation={dictate.dictation} />
        </form>

        {/* Said out loud, because the two behaviours this box has replaced both
            spent a model call and a reader who learned that needs telling it
            has stopped — and, since 2026-10-03, because a box that keeps your
            words when you close it is not what a reader expects of a × either. */}
        <p className="annotate-hint">
          {/* The one reason the button is off that the reader cannot see for
              themselves, so it takes the hint's place until it passes. */}
          {!loaded
            ? "Loading your comments on this article — Save will be ready in a moment."
            : copyPressed && !hasIntent(fields)
              ? /* The one close that keeps nothing without being Discard, so
                   it is said where the reader is looking. */
                "Copied. Closing leaves no highlight; press Save to keep it."
              : colour !== null
                ? "Closing this saves the highlight; Discard throws it away. Nothing is asked unless you press Ask AI."
                : "Nothing is asked unless you press Ask AI. Closing this keeps what you wrote."}
        </p>
      </div>
    </aside>
  );
}

/**
 * Put the selected passage on the clipboard.
 *
 * **Why this exists.** Selecting prose opens this box, and the box takes the
 * focus — so a reader who was only trying to copy a sentence finds their
 * selection gone and has to re-select the quote in here to get it. Greg,
 * 2026-09-05. One press instead.
 *
 * What is copied is `anchor.quote` — the reader's own words, exactly as the
 * blockquote above shows them, with no id and no attribution bolted on. This is
 * the ordinary "I want that sentence" case; the block's citable address is a
 * different thing and already has its own button in the gutter (BlockGutter).
 *
 * The write itself is `useCopy`'s: the guard for a browser with no clipboard,
 * the newest-press-wins token and the timer that takes the tick away again are
 * explained once, in useCopy.ts. What is here is what this button shows and
 * says.
 *
 * **The live region is a sibling of the button, not a child of it, and that is
 * the one place this deliberately departs from `ChatPanel`'s `CopyAnswer`.** `button` is one
 * of the ARIA roles whose children are *presentational*, so a live region
 * nested inside one is announced at the screen reader's discretion and several
 * of them drop it — which would leave the failure case silent in the very
 * component written to stop a silent failure. Outside the button it is an
 * ordinary live region with nothing arguing about it. `CopyAnswer` has the same
 * shape and the same doubt; it was left alone here rather than changed
 * underneath a feature it is not part of.
 */
function CopyQuote({ text, onCopyPressed }: { text: string; onCopyPressed(): void }) {
  /* 1.6 seconds for a tick and for a refusal alike. */
  const { state: said, copy } = useCopy({ copiedMs: 1600, failedMs: 1600 });
  return (
    <>
      <button
        type="button"
        className="annotate-copy"
        title={
          said === "failed"
            ? "Your browser would not allow the copy — an insecure connection is the usual reason"
            : "Copy the passage"
        }
        /* Fixed, never the outcome. A control whose name changes under the
           reader is a different control as far as anything scripted or spoken
           is concerned; what happened is the status region's job, below. */
        aria-label="Copy the passage"
        onClick={() => {
          /* Before the clipboard is asked anything: what the box does at its
             next close hangs on the reader having pressed this, not on a
             promise that may still be out, or refused. */
          onCopyPressed();
          copy(text);
        }}
      >
        {said === "copied" ? (
          <ClipboardCheck size={15} />
        ) : said === "failed" ? (
          /* **Not an X**, which is the glyph on the Close button six pixels to
             the right: a failed copy drew a second X beside the first one, and
             the only thing distinguishing them was a `title` no touch device
             shows. */
          <TriangleAlert size={15} />
        ) : (
          <Copy size={15} />
        )}
      </button>
      {/* Drawn *and* announced. A glyph swapping inside a button is not an
          event, so without this a screen reader cannot tell a copy that worked
          from one the browser refused.

          **Outside the button, and that is the one place this departs from
          `ChatPanel`'s `CopyAnswer`.** `aria-label` on a button hides its
          descendants from assistive technology, and `button` is in any case one
          of the roles whose children are presentational — so a status region
          nested in one is announced at the screen reader's discretion, which
          would leave the failure silent in the very component written to stop a
          silent failure. `CopyAnswer` has the same shape and the same doubt; it
          was left alone rather than changed underneath a feature it is not part
          of.

          `role="status"` rather than a bare `aria-live`, and rendered at every
          state including the empty one: a region has to be in the document
          *before* its text changes, and one that appears already holding its
          message is announced by nobody. */}
      <span className="sr-only" role="status" aria-atomic="true">
        {said === "copied"
          ? "Passage copied."
          : said === "failed"
            ? "Copy refused by the browser."
            : ""}
      </span>
    </>
  );
}
